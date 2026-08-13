import { toDateOnly } from '../../utils/dates.js';
import { getSprintService, type SprintProgress, type SprintService } from '../azure-devops/sprint.service.js';
import { getWorkItemService, type WorkItemService } from '../azure-devops/work-item.service.js';
import { getAssignmentService, type AssignmentService } from './assignment.service.js';
import { getDeadlineService, type DeadlineItem, type DeadlineService } from './deadline.service.js';
import { getDependencyService, type DependencyService } from './dependency.service.js';
import { getProjectAnalysisService, type ProjectAnalysisService, type ProjectHealth } from './project-analysis.service.js';
import { getWorkloadService, type WorkloadService } from './workload.service.js';
import { buildEnvelope, toItemRef, type AnalysisEnvelope, type ItemRef } from './types.js';

export interface DailyTeamReviewFacts {
    date: string;
    team: string;
    currentSprint: {
        name: string;
        startDate: string | null;
        finishDate: string | null;
        daysRemaining: number | null;
        completed: number;
        inProgress: number;
        notStarted: number;
        completionRate: number | null;
        carryOverCount: number;
    } | null;
    todaysWork: { dueToday: DeadlineItem[]; inProgress: ItemRef[]; changedYesterday: ItemRef[] };
    overdueWork: DeadlineItem[];
    blockedWork: { item: ItemRef; signals: string[] }[];
    highPriorityWork: ItemRef[];
    upcomingDeadlines: DeadlineItem[];
    unassignedWork: ItemRef[];
    teamWorkload: { member: string; open: number; active: number; overdue: number; blocked: number }[];
    health: ProjectHealth;
    suggestedAssignments: { workItem: ItemRef; suggested: string | null; reasons: string[] }[];
}

/**
 * The daily stand-up view: everything a Team Lead needs to run a morning review,
 * in one call.
 *
 * Facts come from Azure DevOps. Risks, follow-ups and suggested assignment changes
 * are generated analysis, and the server cannot apply any of them.
 */
export class ReviewService {
    constructor(
        private readonly sprints: SprintService = getSprintService(),
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly deadlines: DeadlineService = getDeadlineService(),
        private readonly workload: WorkloadService = getWorkloadService(),
        private readonly dependencies: DependencyService = getDependencyService(),
        private readonly projectAnalysis: ProjectAnalysisService = getProjectAnalysisService(),
        private readonly assignments: AssignmentService = getAssignmentService()
    ) {}

    async generateDailyTeamReview(): Promise<AnalysisEnvelope<DailyTeamReviewFacts>> {
        const [sprint, deadlineFacts, blockedAnalysis, unassigned, highPriority, recentlyChanged, workloadFacts, healthData] =
            await Promise.all([
                this.sprints.getCurrentSprint().catch(() => null),
                this.deadlines.getDeadlineFacts(14),
                this.dependencies.findBlockedItems(200).catch(() => null),
                this.workItems.unassigned({ limit: 100 }).catch(() => []),
                this.workItems.highPriority(2, { limit: 100 }).catch(() => []),
                this.workItems.recentlyChanged(1, { limit: 100 }).catch(() => []),
                this.workload.getTeamWorkloadFacts(),
                this.projectAnalysis.collectFacts()
            ]);

        const progress: SprintProgress | null = sprint ? await this.sprints.getSprintProgress(sprint).catch(() => null) : null;
        const health = this.projectAnalysis.rate(healthData.facts);
        const inProgress = workloadFacts.members.flatMap(member => member.items.active);
        const assignmentSuggestions = unassigned.length > 0 ? await this.assignments.recommendAssignments(5).catch(() => null) : null;

        const facts: DailyTeamReviewFacts = {
            date: toDateOnly(new Date()),
            team: workloadFacts.team,
            currentSprint:
                sprint && progress
                    ? {
                          name: sprint.name,
                          startDate: sprint.startDate,
                          finishDate: sprint.finishDate,
                          daysRemaining: sprint.daysRemaining,
                          completed: progress.totals.completed,
                          inProgress: progress.totals.inProgress,
                          notStarted: progress.totals.proposed,
                          completionRate: progress.completionRate,
                          carryOverCount: progress.carryOver.length
                      }
                    : null,
            todaysWork: {
                dueToday: deadlineFacts.upcoming.filter(entry => entry.daysUntilDue === 0),
                inProgress,
                changedYesterday: recentlyChanged.map(toItemRef)
            },
            overdueWork: deadlineFacts.overdue,
            blockedWork: (blockedAnalysis?.facts.items ?? []).map(entry => ({
                item: entry.item,
                signals: entry.signals.map(signal => signal.evidence)
            })),
            highPriorityWork: highPriority.map(toItemRef),
            upcomingDeadlines: deadlineFacts.upcoming.filter(entry => entry.daysUntilDue > 0),
            unassignedWork: unassigned.map(toItemRef),
            teamWorkload: workloadFacts.members.map(member => ({
                member: member.member.displayName,
                open: member.counts.assignedOpen,
                active: member.counts.active,
                overdue: member.counts.overdue,
                blocked: member.counts.blocked
            })),
            health,
            suggestedAssignments: (assignmentSuggestions?.facts.recommendations ?? []).map(entry => ({
                workItem: entry.workItem,
                suggested: entry.suggested,
                reasons: entry.reasons
            }))
        };

        const observations: string[] = [];
        const concerns: string[] = [];
        const recommendations: string[] = [];

        observations.push(`Overall project health: ${health.overall}.`);
        if (facts.currentSprint) {
            observations.push(
                `${facts.currentSprint.name}: ${facts.currentSprint.completed} done, ${facts.currentSprint.inProgress} in progress, ${facts.currentSprint.notStarted} not started, ${facts.currentSprint.daysRemaining} day(s) remaining.`
            );
        } else {
            observations.push('No current sprint is configured, so sprint progress is unavailable.');
        }
        observations.push(
            `Today: ${facts.todaysWork.dueToday.length} due, ${facts.todaysWork.inProgress.length} in progress, ${facts.todaysWork.changedYesterday.length} changed in the last day.`
        );

        for (const [dimension, rating] of Object.entries(health.dimensions)) {
            if (rating.rating === 'Good') continue;
            concerns.push(`${dimension}: ${rating.rating} - ${rating.reasons.join(' ')}`);
        }

        for (const entry of facts.overdueWork.slice(0, 5)) {
            recommendations.push(
                `Follow up on overdue ${entry.item.type} #${entry.item.id} "${entry.item.title}"${entry.item.assignedTo ? ` with ${entry.item.assignedTo}` : ' (unassigned)'} - ${entry.relative}.`
            );
        }
        for (const entry of facts.blockedWork.slice(0, 5)) {
            recommendations.push(`Unblock ${entry.item.type} #${entry.item.id} "${entry.item.title}" - ${entry.signals[0] ?? 'blocked'}.`);
        }
        for (const entry of facts.suggestedAssignments.slice(0, 5)) {
            if (!entry.suggested) continue;
            recommendations.push(
                `Consider assigning #${entry.workItem.id} "${entry.workItem.title}" to ${entry.suggested} (${entry.reasons[0] ?? 'available capacity'}).`
            );
        }
        const highRiskToday = facts.upcomingDeadlines.filter(entry => entry.risk === 'High Risk');
        if (highRiskToday.length > 0) {
            recommendations.push(`Raise ${highRiskToday.length} High Risk deadline item(s) at stand-up: ${highRiskToday.slice(0, 5).map(entry => `#${entry.item.id}`).join(', ')}.`);
        }

        return buildEnvelope('daily_team_review', facts, {
            observations,
            concerns,
            recommendations,
            methodology: [
                'Sections are assembled from live Azure DevOps reads: team iterations, work-item queries, revision history and relation links.',
                '"Changed in the last day" uses System.ChangedDate within the last 1 day.',
                'Deadline risk, health ratings and assignment suggestions are generated analysis with published thresholds; see analysis_deadline_risk, analysis_project_health and analysis_assignment_recommendation for the rules.',
                'Every recommendation is advisory. This server cannot change Azure DevOps.'
            ]
        });
    }
}

let sharedReviewService: ReviewService | null = null;

export function getReviewService(): ReviewService {
    sharedReviewService ??= new ReviewService();
    return sharedReviewService;
}

export function setReviewServiceForTesting(service: ReviewService | null): void {
    sharedReviewService = service;
}
