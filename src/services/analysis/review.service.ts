import { toDateOnly } from '../../utils/dates.js';
import { MINIMAL_WORK_ITEM_FIELDS } from '../../azure-devops/field-profiles.js';
import { getSprintService, type SprintProgress, type SprintService } from '../../azure-devops/sprint.service.js';
import { getWorkItemService, type WorkItemService } from '../../azure-devops/work-item.service.js';
import { getAssignmentService, type AssignmentService } from './assignment.service.js';
import { getDeadlineService, type DeadlineItem, type DeadlineService } from './deadline.service.js';
import { OVERDUE_RULE } from './overdue.js';
import { getWorkloadService, type WorkloadService } from './workload.service.js';
import { buildEnvelope, toItemRef, type AnalysisEnvelope, type ItemRef, type HealthRating } from './types.js';

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
    teamWorkload: { member: string; open: number; active: number; proposed: number; overdue: number; blocked: number }[];
    overdueRules: { label: string; count: number }[];
    health: { overall: HealthRating; dimensions: Record<string, { rating: HealthRating; reasons: string[] }> };
    suggestedAssignments: { workItem: ItemRef; suggested: string | null; reasons: string[] }[];
    kpis: {
        active: number;
        proposed: number;
        blocked: number;
        overdueDueDate: number;
        overduePlannedEnd: number;
        unassigned: number;
        completion: number | null;
    };
    overdueDueDateIds: number[];
    overduePlannedEndIds: number[];
    unassignedIds: number[];
}

export class ReviewService {
    constructor(
        private readonly sprints: SprintService = getSprintService(),
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly deadlines: DeadlineService = getDeadlineService(),
        private readonly workload: WorkloadService = getWorkloadService(),
        private readonly assignments: AssignmentService = getAssignmentService()
    ) {}

    async generateDailyTeamReview(): Promise<AnalysisEnvelope<DailyTeamReviewFacts>> {
        const [sprint, deadlineFacts, workloadFacts, blockedIds, unassignedIds, highPriorityIds, recentIds] =
            await Promise.all([
                this.sprints.getCurrentSprint().catch(() => null),
                this.deadlines.getDeadlineFacts(14, { sampleLimit: 5 }),
                this.workload.getTeamWorkloadFacts({ includeExamples: false }),
                this.workItems.blockedSignalIds({ limit: 200 }),
                this.workItems.unassignedIds({ limit: 200 }),
                this.workItems.highPriorityIds(2, { limit: 200 }).catch(() => [] as number[]),
                this.workItems.recentlyChangedIds(1, { limit: 50 }).catch(() => [] as number[])
            ]);

        const progress: SprintProgress | null = sprint
            ? await this.sprints.getSprintProgress(sprint, { includeCarryOver: false }).catch(() => null)
            : null;

        const sample = async (ids: number[], n: number) =>
            (await this.workItems.getByIds(ids.slice(0, n), { profile: MINIMAL_WORK_ITEM_FIELDS })).map(toItemRef);

        const blockedSample =
            blockedIds.length <= 3
                ? await this.workItems.blocked({ limit: 3, includeDependencyBlockers: false }).catch(() => [])
                : (await this.workItems.blocked({ limit: 5, includeDependencyBlockers: false }).catch(() => [])).slice(0, 5);

        const unassignedWork = unassignedIds.length <= 3
            ? await sample(unassignedIds, 3)
            : [];
        const highPriorityWork = await sample(highPriorityIds, 3);
        const changedYesterday = await sample(recentIds, 3);

        const overall: HealthRating =
            deadlineFacts.counts.overdueDueDate > 0 || blockedIds.length >= 2 ? 'At Risk' : 'Good';
        const health = {
            overall,
            dimensions: {
                deadlines: {
                    rating: (deadlineFacts.counts.overdueDueDate > 0 ? 'At Risk' : 'Good') as HealthRating,
                    reasons: [`${OVERDUE_RULE.dueDate.label}: ${deadlineFacts.counts.overdueDueDate}`]
                },
                blocked: {
                    rating: (blockedIds.length > 0 ? 'Moderate Risk' : 'Good') as HealthRating,
                    reasons: [`Blocked count (tag/state/field): ${blockedIds.length}`]
                }
            }
        };

        const assignmentSuggestions =
            unassignedIds.length > 0 && unassignedIds.length <= 5
                ? await this.assignments.recommendAssignments(Math.min(3, unassignedIds.length)).catch(() => null)
                : null;

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
                inProgress: [],
                changedYesterday
            },
            overdueWork: deadlineFacts.overdue,
            blockedWork: blockedSample.map(entry => ({
                item: toItemRef(entry),
                signals: entry.blockedSignals.map(signal => signal.evidence)
            })),
            highPriorityWork,
            upcomingDeadlines: deadlineFacts.upcoming.filter(entry => entry.daysUntilDue > 0),
            unassignedWork,
            teamWorkload: workloadFacts.members.map(member => ({
                member: member.member.displayName,
                open: member.counts.assignedOpen,
                active: member.counts.active,
                proposed: member.counts.proposed,
                overdue: member.counts.overdueDueDate,
                blocked: member.counts.blocked
            })),
            overdueRules: deadlineFacts.overdueRules.map(r => ({ label: r.label, count: r.count })),
            health,
            suggestedAssignments: (assignmentSuggestions?.facts.recommendations ?? []).map(entry => ({
                workItem: entry.workItem,
                suggested: entry.suggested,
                reasons: entry.reasons
            })),
            kpis: {
                active: workloadFacts.totals.activeItems,
                proposed: workloadFacts.members.reduce((sum, m) => sum + m.counts.proposed, 0),
                blocked: blockedIds.length,
                overdueDueDate: deadlineFacts.counts.overdueDueDate,
                overduePlannedEnd: deadlineFacts.counts.overduePlannedEnd,
                unassigned: unassignedIds.length,
                completion: progress?.completionRate ?? null
            },
            overdueDueDateIds: deadlineFacts.overdueDueDateIds,
            overduePlannedEndIds: deadlineFacts.overduePlannedEndIds,
            unassignedIds
        };

        const observations: string[] = [];
        const concerns: string[] = [];
        const recommendations: string[] = [];

        observations.push(`Overall project health: ${health.overall}.`);
        if (facts.currentSprint) {
            observations.push(
                `${facts.currentSprint.name}: ${facts.currentSprint.completed} done, ${facts.currentSprint.inProgress} in progress, ${facts.currentSprint.notStarted} not started, ${facts.currentSprint.daysRemaining} day(s) remaining.`
            );
        }
        observations.push(
            `${OVERDUE_RULE.dueDate.label}: ${facts.kpis.overdueDueDate}. ${OVERDUE_RULE.plannedEnd.label}: ${facts.kpis.overduePlannedEnd}.`
        );

        for (const [dimension, rating] of Object.entries(health.dimensions)) {
            if (rating.rating === 'Good') continue;
            concerns.push(`${dimension}: ${rating.rating} - ${rating.reasons.join(' ')}`);
        }

        for (const entry of facts.overdueWork.slice(0, 3)) {
            recommendations.push(
                `Follow up on overdue ${entry.item.type} #${entry.item.id} "${entry.item.title}"${entry.item.assignedTo ? ` with ${entry.item.assignedTo}` : ' (unassigned)'} - ${entry.relative}.`
            );
        }
        for (const entry of facts.blockedWork.slice(0, 3)) {
            recommendations.push(`Unblock ${entry.item.type} #${entry.item.id} "${entry.item.title}" - ${entry.signals[0] ?? 'blocked'}.`);
        }
        if (facts.kpis.unassigned > 0) {
            recommendations.push(`Triage ${facts.kpis.unassigned} unassigned item(s).`);
        }

        return buildEnvelope('daily_team_review', facts, {
            observations,
            concerns,
            recommendations,
            methodology: [
                'Standup facts are aggregate-first: WIQL ID/count queries plus bounded samples (≤5 bodies).',
                `${OVERDUE_RULE.dueDate.label}: ${OVERDUE_RULE.dueDate.description}`,
                `${OVERDUE_RULE.plannedEnd.label}: ${OVERDUE_RULE.plannedEnd.description}`,
                'Blocked count uses tag/state/field WIQL, not a full predecessor-link scan.',
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
