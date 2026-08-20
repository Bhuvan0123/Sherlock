import { startOfWeek, toDateOnly } from '../../utils/dates.js';
import { getDeadlineService, type DeadlineService } from '../analysis/deadline.service.js';
import { getDependencyService, type DependencyService } from '../analysis/dependency.service.js';
import { getProductivityService, type ProductivityService } from '../analysis/productivity.service.js';
import { getProjectAnalysisService, type ProjectAnalysisService } from '../analysis/project-analysis.service.js';
import { getWorkloadService, type WorkloadService } from '../analysis/workload.service.js';
import { buildEnvelope, type AnalysisEnvelope } from '../analysis/types.js';
import { getActivityService, type ActivityService, type ActivitySummary } from './activity.service.js';

export interface TlProductivityFacts {
    window: { days: number; from: string };
    activity: ActivitySummary;
    /** What the Team Lead's monitoring is (and is not) covering, from live Azure DevOps state. */
    teamState: {
        overdueItems: number;
        blockedItems: number;
        unassignedItems: number;
        highPriorityUnassigned: number;
        workloadSpread: number | null;
        projectHealth: string;
    };
    followUp: {
        /** Items the Team Lead looked at repeatedly that are still unresolved. */
        repeatedlyReviewedStillOpen: { subjectRef: string; occurrences: number; lastSeen: string }[];
        blockedItemsUnchangedFiveDaysPlus: number;
    };
}

export interface TlWeeklyReviewFacts {
    weekOf: string;
    activity: ActivitySummary;
    delivery: {
        completedThisPeriod: number;
        throughputPerWeek: number | null;
        sprintCompletionTrend: string[];
    };
    attention: {
        overdue: number;
        blocked: number;
        unassigned: number;
        crossTeamDependencies: number;
        projectHealth: string;
        healthConcerns: string[];
    };
    workload: { member: string; open: number; overdue: number; blocked: number }[];
}

/**
 * Team Lead-facing reviews.
 *
 * These combine the local audit trail (what the Team Lead did through this server)
 * with live Azure DevOps state (what the team's work actually looks like). They
 * report observed patterns and improvement areas, and deliberately never produce a
 * "TL productivity = N%" figure, because no defensible methodology exists for one.
 */
export class TeamLeadReviewService {
    constructor(
        private readonly activity: ActivityService = getActivityService(),
        private readonly projectAnalysis: ProjectAnalysisService = getProjectAnalysisService(),
        private readonly deadlines: DeadlineService = getDeadlineService(),
        private readonly dependencies: DependencyService = getDependencyService(),
        private readonly workload: WorkloadService = getWorkloadService(),
        private readonly productivity: ProductivityService = getProductivityService()
    ) {}

    /**
     * Patterns in how the Team Lead is using this assistant, cross-checked against
     * what the team's work currently needs.
     */
    async analyzeTlProductivity(days = 14): Promise<AnalysisEnvelope<TlProductivityFacts>> {
        const activitySummary = this.activity.getSummary(days);
        const [healthData, blockedAnalysis, workloadFacts] = await Promise.all([
            this.projectAnalysis.collectFacts().catch(() => null),
            this.dependencies.findBlockedItems(200).catch(() => null),
            this.workload.getTeamWorkloadFacts().catch(() => null)
        ]);

        const health = healthData ? this.projectAnalysis.rate(healthData.facts) : null;
        const staleBlocked = (blockedAnalysis?.facts.items ?? []).filter(entry => (entry.daysInState ?? 0) >= 5).length;
        // A repeatedly reviewed subject that is still open is the clearest
        // "follow-up did not land" signal available without ADO write access.
        const stillOpenSubjects = activitySummary.repeatedSubjects.filter(entry => {
            const match = /work-item:(\d+)/.exec(entry.subjectRef);
            if (!match?.[1]) return true;
            const id = Number(match[1]);
            const openIds = new Set([
                ...(healthData?.facts.keyItems.overdue ?? []).map(item => item.id),
                ...(healthData?.facts.keyItems.blocked ?? []).map(item => item.id),
                ...(healthData?.facts.keyItems.unassignedHighPriority ?? []).map(item => item.id)
            ]);
            return openIds.has(id);
        });

        const facts: TlProductivityFacts = {
            window: { days: activitySummary.window.days, from: activitySummary.window.from },
            activity: activitySummary,
            teamState: {
                overdueItems: healthData?.facts.counts.overdueItems ?? 0,
                blockedItems: healthData?.facts.counts.blockedItems ?? 0,
                unassignedItems: healthData?.facts.counts.unassignedItems ?? 0,
                highPriorityUnassigned: healthData?.facts.counts.highPriorityUnassigned ?? 0,
                workloadSpread: workloadFacts?.distribution.spread ?? null,
                projectHealth: health?.overall ?? 'unknown'
            },
            followUp: {
                repeatedlyReviewedStillOpen: stillOpenSubjects,
                blockedItemsUnchangedFiveDaysPlus: staleBlocked
            }
        };

        const observations: string[] = [];
        const concerns: string[] = [];
        const recommendations: string[] = [];

        observations.push(
            `${activitySummary.totalActions} action(s) through this assistant over ${activitySummary.window.days} day(s), on ${activitySummary.byDay.length} distinct day(s).`
        );
        const monitoring =
            (activitySummary.byCategory.find(entry => entry.category === 'project_review')?.count ?? 0) +
            (activitySummary.byCategory.find(entry => entry.category === 'team_review')?.count ?? 0) +
            (activitySummary.byCategory.find(entry => entry.category === 'analysis')?.count ?? 0);
        observations.push(`${monitoring} monitoring/analysis action(s) recorded.`);
        observations.push(
            `Current team state: ${facts.teamState.overdueItems} overdue, ${facts.teamState.blockedItems} blocked, ${facts.teamState.unassignedItems} unassigned; project health ${facts.teamState.projectHealth}.`
        );

        if (facts.followUp.blockedItemsUnchangedFiveDaysPlus > 0) {
            concerns.push(
                `${facts.followUp.blockedItemsUnchangedFiveDaysPlus} blocked item(s) have not changed state for 5+ days, so earlier follow-ups have not moved them.`
            );
            recommendations.push('Escalate the long-blocked items or explicitly park them, so the blocked list stays meaningful.');
        }
        if (facts.followUp.repeatedlyReviewedStillOpen.length > 0) {
            concerns.push(
                `${facts.followUp.repeatedlyReviewedStillOpen.length} subject(s) were reviewed more than once and still appear in the overdue, blocked or unassigned lists.`
            );
            recommendations.push(
                `Repeated review without a change of state usually means a decision is needed rather than more information: ${facts.followUp.repeatedlyReviewedStillOpen
                    .slice(0, 3)
                    .map(entry => entry.subjectRef)
                    .join(', ')}.`
            );
        }
        if (facts.teamState.highPriorityUnassigned > 0) {
            concerns.push(`${facts.teamState.highPriorityUnassigned} high-priority item(s) are still unassigned.`);
            recommendations.push('Assign the high-priority unassigned items; analysis_assignment_recommendations proposes owners for each.');
        }
        if (activitySummary.byDay.length <= 2 && activitySummary.window.days >= 7) {
            recommendations.push(
                'Monitoring is concentrated in very few days. A short daily review keeps overdue and blocked work from building up unseen.'
            );
        }

        return buildEnvelope('tl_productivity_analysis', facts, {
            observations,
            concerns,
            recommendations,
            methodology: [
                'Two data sources are combined: the local audit trail of this MCP server (tool calls) and live Azure DevOps reads (overdue, blocked, unassigned, health).',
                'The audit trail cannot see work the Team Lead does directly in Azure DevOps or elsewhere, so a low action count does not mean low activity.',
                'No percentage or score is produced. "Observed patterns", "potential improvement areas" and "recommended actions" are the only outputs, by design.',
                'Follow-up effectiveness is inferred from state that has not changed (blocked items unchanged for 5+ days, repeatedly reviewed items still open), which is evidence of a stalled item rather than proof of a missed follow-up.'
            ],
            dataSource: 'Local MCP audit trail + Azure DevOps REST API (live read)'
        });
    }

    /** How the Team Lead's own work-management habits look, based on the audit trail. */
    async analyzeTlWorkManagement(days = 30): Promise<
        AnalysisEnvelope<{
            window: { days: number };
            toolUsage: { tool: string; count: number }[];
            categoryMix: { category: string; count: number }[];
            coverage: {
                daysWithActivity: number;
                daysInWindow: number;
                busiestDay: { day: string; count: number } | null;
                averageActionsPerActiveDay: number | null;
            };
            reviewDiscipline: { analysisActions: number; queryActions: number };
        }>
    > {
        const summary = this.activity.getSummary(days);
        const busiestDay = [...summary.byDay].sort((a, b) => b.count - a.count)[0] ?? null;
        const analysisActions = summary.byCategory.find(entry => entry.category === 'analysis')?.count ?? 0;
        const queryActions = summary.byCategory.find(entry => entry.category === 'query_management')?.count ?? 0;

        const facts = {
            window: { days: summary.window.days },
            toolUsage: summary.byTool,
            categoryMix: summary.byCategory,
            coverage: {
                daysWithActivity: summary.byDay.length,
                daysInWindow: summary.window.days,
                busiestDay,
                averageActionsPerActiveDay:
                    summary.byDay.length > 0 ? Math.round((summary.totalActions / summary.byDay.length) * 10) / 10 : null
            },
            reviewDiscipline: { analysisActions, queryActions }
        };

        const observations: string[] = [
            `Activity recorded on ${facts.coverage.daysWithActivity} of ${facts.coverage.daysInWindow} day(s)${
                facts.coverage.averageActionsPerActiveDay === null ? '' : `, averaging ${facts.coverage.averageActionsPerActiveDay} action(s) per active day`
            }.`
        ];
        if (facts.toolUsage.length > 0) {
            observations.push(`Most used tools: ${facts.toolUsage.slice(0, 5).map(entry => `${entry.tool} (${entry.count})`).join(', ')}.`);
        }

        const concerns: string[] = [];
        const recommendations: string[] = [];
        if (facts.coverage.daysWithActivity <= Math.max(1, Math.floor(facts.coverage.daysInWindow / 7)) && facts.coverage.daysInWindow >= 14) {
            concerns.push('Monitoring is sparse relative to the window, so most days had no recorded review.');
        }
        if (analysisActions > 0 && queryActions === 0) {
            recommendations.push(
                'Analysis is being run without saved-query follow-through. Create team-scoped queries for recurring findings that need tracking.'
            );
        }

        return buildEnvelope('tl_work_management', facts, {
            observations,
            concerns,
            recommendations,
            methodology: [
                'Derived entirely from the local audit trail of this MCP server.',
                'Counts describe interaction with this assistant, not the Team Lead\'s overall workload or effectiveness.'
            ],
            dataSource: 'Local MCP audit trail'
        });
    }

    /** The weekly review: what happened, what needs attention, what to do next. */
    async generateWeeklyReview(): Promise<AnalysisEnvelope<TlWeeklyReviewFacts>> {
        const weekStart = startOfWeek();
        const daysThisWeek = Math.max(1, Math.ceil((Date.now() - weekStart.getTime()) / 86_400_000));
        const activitySummary = this.activity.getSummary(daysThisWeek);

        const [healthEnvelope, productivityEnvelope, workloadFacts, crossTeam, deadlineFacts] = await Promise.all([
            this.projectAnalysis.getProjectHealth().catch(() => null),
            this.productivity.analyzeTeamProductivity(3, 7).catch(() => null),
            this.workload.getTeamWorkloadFacts().catch(() => null),
            this.dependencies.findCrossTeamDependencies(200).catch(() => null),
            this.deadlines.getDeadlineFacts(7).catch(() => null)
        ]);

        const facts: TlWeeklyReviewFacts = {
            weekOf: toDateOnly(weekStart),
            activity: activitySummary,
            delivery: {
                completedThisPeriod: productivityEnvelope?.facts.delivery.completed.items ?? 0,
                throughputPerWeek: productivityEnvelope?.facts.delivery.throughputPerWeek ?? null,
                sprintCompletionTrend: (productivityEnvelope?.facts.sprintHistory ?? []).map(
                    entry => `${entry.sprint}: ${entry.completionRate === null ? 'n/a' : `${entry.completionRate}%`} (${entry.completed}/${entry.items})`
                )
            },
            attention: {
                overdue: deadlineFacts?.counts.overdue ?? healthEnvelope?.facts.counts.overdueItems ?? 0,
                blocked: healthEnvelope?.facts.counts.blockedItems ?? 0,
                unassigned: healthEnvelope?.facts.counts.unassignedItems ?? 0,
                crossTeamDependencies: crossTeam?.facts.count ?? 0,
                projectHealth: healthEnvelope?.facts.health.overall ?? 'unknown',
                healthConcerns: healthEnvelope?.concerns ?? []
            },
            workload: (workloadFacts?.members ?? []).map(member => ({
                member: member.member.displayName,
                open: member.counts.assignedOpen,
                overdue: member.counts.overdue,
                blocked: member.counts.blocked
            }))
        };

        const observations: string[] = [
            `Week of ${facts.weekOf}: ${activitySummary.totalActions} assistant action(s) across ${activitySummary.byDay.length} day(s).`,
            `Delivery: ${facts.delivery.completedThisPeriod} item(s) completed in the last 7 days.`,
            `Project health: ${facts.attention.projectHealth}.`
        ];
        if (facts.delivery.sprintCompletionTrend.length > 0) {
            observations.push(`Sprint completion trend - ${facts.delivery.sprintCompletionTrend.join('; ')}.`);
        }

        const concerns = [...facts.attention.healthConcerns];
        const recommendations: string[] = [];
        if (facts.attention.overdue > 0) {
            recommendations.push(`Clear or re-date the ${facts.attention.overdue} overdue item(s) before the next sprint boundary.`);
        }
        if (facts.attention.blocked > 0) {
            recommendations.push(`Work the ${facts.attention.blocked} blocked item(s) as the first agenda item of the week.`);
        }
        if (facts.attention.unassigned > 0) {
            recommendations.push(`Assign the ${facts.attention.unassigned} unassigned item(s) so nothing enters the sprint ownerless.`);
        }
        if (facts.attention.crossTeamDependencies > 0) {
            recommendations.push(`Raise ${facts.attention.crossTeamDependencies} cross-team dependency link(s) with the owning teams.`);
        }
        const overloaded = facts.workload.filter(member => member.overdue >= 3);
        for (const member of overloaded) {
            recommendations.push(`One-to-one with ${member.member}: ${member.overdue} overdue item(s) against ${member.open} open.`);
        }

        return buildEnvelope('tl_weekly_review', facts, {
            observations,
            concerns,
            recommendations,
            methodology: [
                'Week starts on Monday in the local time zone of the machine running this server.',
                'Assistant activity comes from the local audit trail; delivery, health, workload and dependency figures come from live Azure DevOps reads.',
                'Recommendations are advisory. This server cannot modify Azure DevOps.'
            ],
            dataSource: 'Local MCP audit trail + Azure DevOps REST API (live read)'
        });
    }
}

let sharedTlReviewService: TeamLeadReviewService | null = null;

export function getTeamLeadReviewService(): TeamLeadReviewService {
    sharedTlReviewService ??= new TeamLeadReviewService();
    return sharedTlReviewService;
}

export function setTeamLeadReviewServiceForTesting(service: TeamLeadReviewService | null): void {
    sharedTlReviewService = service;
}
