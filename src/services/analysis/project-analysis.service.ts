import { getAdoAnalyticsService, type AdoAnalyticsService, type DeliveryMetrics } from '../azure-devops/analytics.service.js';
import { getProjectService, type ProjectService } from '../azure-devops/project.service.js';
import { getSprintService, type SprintProgress, type SprintService } from '../azure-devops/sprint.service.js';
import { getWorkItemService, type WorkItemService } from '../azure-devops/work-item.service.js';
import { getDeadlineService, type DeadlineService } from './deadline.service.js';
import { getDependencyService, type DependencyService } from './dependency.service.js';
import { getWorkloadService, type TeamWorkloadFacts, type WorkloadService } from './workload.service.js';
import {
    buildEnvelope,
    toItemRef,
    worstRating,
    type AnalysisEnvelope,
    type HealthRating,
    type ItemRef,
    type RatedDimension
} from './types.js';

export interface ProjectHealthFacts {
    project: string;
    team: string;
    currentSprint: {
        name: string;
        daysRemaining: number | null;
        items: number;
        completed: number;
        completionRate: number | null;
        carryOverCount: number;
    } | null;
    counts: {
        openItems: number;
        activeItems: number;
        overdueItems: number;
        blockedItems: number;
        unassignedItems: number;
        highPriorityUnassigned: number;
        dueThisWeek: number;
        unresolvedDependencies: number;
        crossTeamDependencies: number;
    };
    delivery: {
        completedLast30Days: number;
        throughputPerWeek: number | null;
        reopenedCount: number;
        cycleTimeAverageDays: number | null;
    };
    workload: {
        memberCount: number;
        maxOpenPerMember: number | null;
        medianOpenPerMember: number | null;
        membersWithOverdue: number;
    };
    workItemCounts: Record<string, number>;
    keyItems: {
        overdue: ItemRef[];
        blocked: ItemRef[];
        unassignedHighPriority: ItemRef[];
        likelyCarryOver: ItemRef[];
    };
}

export interface ProjectHealth {
    overall: HealthRating;
    dimensions: {
        delivery: RatedDimension;
        schedule: RatedDimension;
        workload: RatedDimension;
        blockedWork: RatedDimension;
        sprintHealth: RatedDimension;
        dependencyRisk: RatedDimension;
        assignmentCoverage: RatedDimension;
    };
}

/**
 * Whole-project analysis: gathers real Azure DevOps data across sprints, work
 * items, deadlines, dependencies and workload, then rates each dimension using
 * published thresholds.
 */
export class ProjectAnalysisService {
    constructor(
        private readonly projects: ProjectService = getProjectService(),
        private readonly sprints: SprintService = getSprintService(),
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly deadlines: DeadlineService = getDeadlineService(),
        private readonly dependencies: DependencyService = getDependencyService(),
        private readonly workload: WorkloadService = getWorkloadService(),
        private readonly analytics: AdoAnalyticsService = getAdoAnalyticsService()
    ) {}

    /** Collects every input the health rating needs, in as few round trips as possible. */
    async collectFacts(): Promise<{
        facts: ProjectHealthFacts;
        sprintProgress: SprintProgress | null;
        deliveryMetrics: DeliveryMetrics | null;
        workloadFacts: TeamWorkloadFacts | null;
    }> {
        const overview = await this.projects.getOverview();
        const sprint = overview.currentSprint;

        const [sprintProgress, deadlineFacts, blocked, unassigned, deliveryMetrics, workloadFacts, dependencyAnalysis, crossTeam] =
            await Promise.all([
                sprint ? this.sprints.getSprintProgress(sprint).catch(() => null) : Promise.resolve(null),
                this.deadlines.getDeadlineFacts(7).catch(() => null),
                this.workItems.blocked({ limit: 300 }).catch(() => []),
                this.workItems.unassigned({ limit: 500 }).catch(() => []),
                this.analytics.getDeliveryMetrics(30).catch(() => null),
                this.workload.getTeamWorkloadFacts().catch(() => null),
                this.dependencies.findDependencies(300).catch(() => null),
                this.dependencies.findCrossTeamDependencies(300).catch(() => null)
            ]);

        const unassignedHighPriority = unassigned.filter(item => item.priority !== null && item.priority <= 2);
        const memberCounts = workloadFacts?.members.map(member => member.counts.assignedOpen) ?? [];

        const facts: ProjectHealthFacts = {
            project: overview.project.name,
            team: overview.team.name,
            currentSprint: sprint
                ? {
                      name: sprint.name,
                      daysRemaining: sprint.daysRemaining,
                      items: sprintProgress?.totals.items ?? 0,
                      completed: sprintProgress?.totals.completed ?? 0,
                      completionRate: sprintProgress?.completionRate ?? null,
                      carryOverCount: sprintProgress?.carryOver.length ?? 0
                  }
                : null,
            counts: {
                openItems: overview.openWork.total,
                activeItems: overview.workItemCounts.byStateCategory.InProgress ?? 0,
                overdueItems: deadlineFacts?.counts.overdue ?? overview.openWork.overdue,
                blockedItems: blocked.length,
                unassignedItems: unassigned.length,
                highPriorityUnassigned: unassignedHighPriority.length,
                dueThisWeek: deadlineFacts?.counts.dueThisWeek ?? 0,
                unresolvedDependencies: dependencyAnalysis?.facts.unresolvedCount ?? 0,
                crossTeamDependencies: crossTeam?.facts.count ?? 0
            },
            delivery: {
                completedLast30Days: deliveryMetrics?.completed.items ?? 0,
                throughputPerWeek: deliveryMetrics?.throughputPerWeek ?? null,
                reopenedCount: deliveryMetrics?.reopened.count ?? 0,
                cycleTimeAverageDays: deliveryMetrics?.cycleTimeDays.average ?? null
            },
            workload: {
                memberCount: workloadFacts?.members.length ?? overview.team.memberCount,
                maxOpenPerMember: workloadFacts?.distribution.max ?? null,
                medianOpenPerMember: workloadFacts?.distribution.median ?? null,
                membersWithOverdue: workloadFacts?.members.filter(member => member.counts.overdue > 0).length ?? 0
            },
            workItemCounts: overview.workItemCounts.byType,
            keyItems: {
                overdue: (deadlineFacts?.overdue ?? []).slice(0, 10).map(entry => entry.item),
                blocked: blocked.slice(0, 10).map(toItemRef),
                unassignedHighPriority: unassignedHighPriority.slice(0, 10).map(toItemRef),
                likelyCarryOver: (sprintProgress?.carryOver ?? []).slice(0, 10).map(entry => ({
                    id: entry.id,
                    type: 'Carry-over',
                    title: entry.title,
                    state: entry.state,
                    assignedTo: entry.assignedTo,
                    dueDate: null,
                    webUrl: null
                }))
            }
        };

        return { facts, sprintProgress, deliveryMetrics, workloadFacts };
    }

    /**
     * Rates each health dimension.
     *
     * Every threshold below is stated in the returned `methodology`, so a rating
     * can always be traced back to the counts that produced it.
     */
    rate(facts: ProjectHealthFacts): ProjectHealth {
        const delivery = rateDelivery(facts);
        const schedule = rateSchedule(facts);
        const workload = rateWorkload(facts);
        const blockedWork = rateBlocked(facts);
        const sprintHealth = rateSprint(facts);
        const dependencyRisk = rateDependencies(facts);
        const assignmentCoverage = rateAssignment(facts);

        return {
            overall: worstRating([
                delivery.rating,
                schedule.rating,
                workload.rating,
                blockedWork.rating,
                sprintHealth.rating,
                dependencyRisk.rating,
                assignmentCoverage.rating
            ]),
            dimensions: { delivery, schedule, workload, blockedWork, sprintHealth, dependencyRisk, assignmentCoverage }
        };
    }

    async getProjectHealth(): Promise<AnalysisEnvelope<ProjectHealthFacts & { health: ProjectHealth }>> {
        const { facts } = await this.collectFacts();
        const health = this.rate(facts);

        const concerns: string[] = [];
        const recommendations: string[] = [];
        for (const [name, dimension] of Object.entries(health.dimensions)) {
            if (dimension.rating === 'Good') continue;
            concerns.push(`${humanise(name)}: ${dimension.rating} - ${dimension.reasons.join(' ')}`);
        }

        for (const item of facts.keyItems.blocked.slice(0, 3)) {
            recommendations.push(`Review blocked ${item.type} #${item.id} "${item.title}".`);
        }
        for (const item of facts.keyItems.unassignedHighPriority.slice(0, 3)) {
            recommendations.push(`Consider assigning high-priority ${item.type} #${item.id} "${item.title}".`);
        }
        for (const item of facts.keyItems.overdue.slice(0, 3)) {
            recommendations.push(
                `Follow up on overdue ${item.type} #${item.id} "${item.title}"${item.assignedTo ? ` with ${item.assignedTo}` : ' (unassigned)'}.`
            );
        }
        if (facts.currentSprint && facts.currentSprint.carryOverCount > 0) {
            recommendations.push(
                `${facts.currentSprint.carryOverCount} item(s) already carried into ${facts.currentSprint.name}; review whether sprint scope is realistic.`
            );
        }

        return buildEnvelope(
            'project_health',
            { ...facts, health },
            {
                observations: [
                    `Overall rating: ${health.overall}.`,
                    `${facts.counts.openItems} open item(s), ${facts.counts.activeItems} in progress, ${facts.counts.overdueItems} overdue, ${facts.counts.blockedItems} blocked, ${facts.counts.unassignedItems} unassigned.`,
                    facts.currentSprint
                        ? `${facts.currentSprint.name}: ${facts.currentSprint.completed}/${facts.currentSprint.items} complete${
                              facts.currentSprint.completionRate === null ? '' : ` (${facts.currentSprint.completionRate}%)`
                          }, ${facts.currentSprint.daysRemaining} day(s) remaining.`
                        : 'No current sprint is configured for the team.'
                ],
                concerns,
                recommendations,
                methodology: HEALTH_METHODOLOGY
            }
        );
    }

    /** The full project analysis: health, plus the supporting sprint and delivery detail. */
    async analyzeProject(): Promise<
        AnalysisEnvelope<
            ProjectHealthFacts & {
                health: ProjectHealth;
                sprint: SprintProgress | null;
                deliveryMetrics: DeliveryMetrics | null;
            }
        >
    > {
        const { facts, sprintProgress, deliveryMetrics } = await this.collectFacts();
        const health = this.rate(facts);
        const base = await this.getProjectHealth().catch(() => null);

        const observations = base?.observations ?? [];
        const concerns = base?.concerns ?? [];
        const recommendations = [...(base?.recommendations ?? [])];

        if (deliveryMetrics && deliveryMetrics.reopened.count > 0) {
            concerns.push(
                `${deliveryMetrics.reopened.count} reopen event(s) across ${deliveryMetrics.reopened.itemsInspected} inspected item(s), which can indicate incomplete hand-offs or unclear acceptance criteria.`
            );
        }
        if (deliveryMetrics?.cycleTimeDays.average !== null && deliveryMetrics?.cycleTimeDays.p85 !== null && deliveryMetrics) {
            observations.push(
                `Cycle time over the last 30 days: average ${deliveryMetrics.cycleTimeDays.average} day(s), 85th percentile ${deliveryMetrics.cycleTimeDays.p85} day(s), measured on ${deliveryMetrics.cycleTimeDays.measured} item(s).`
            );
        }
        if (facts.counts.crossTeamDependencies > 0) {
            recommendations.push(
                `${facts.counts.crossTeamDependencies} dependency link(s) sit outside the team's area paths; confirm ownership with the other team.`
            );
        }

        return buildEnvelope(
            'project_analysis',
            { ...facts, health, sprint: sprintProgress, deliveryMetrics },
            {
                observations,
                concerns,
                recommendations,
                methodology: [
                    ...HEALTH_METHODOLOGY,
                    ...(deliveryMetrics?.methodology ?? []),
                    'Sprint detail (including carry-over evidence) comes from the team iteration APIs and work-item revision history.'
                ]
            }
        );
    }
}

const HEALTH_METHODOLOGY = [
    'Delivery: Good when sprint completion >= 70% (or, with no sprint, >= 5 items completed in 30 days); Moderate Risk 50-69%; At Risk 30-49%; High Risk < 30%. Reopened items add one severity step when 3 or more are found.',
    'Schedule: Good with 0 overdue items; Moderate Risk 1-2; At Risk 3-5; High Risk more than 5.',
    'Workload: Good when the busiest member holds < 2x the team median; Moderate Risk at >= 2x; At Risk when >= 2x and 2+ members carry overdue work; High Risk when the busiest holds >= 3x the median.',
    'Blocked Work: Good with 0 blocked items; Moderate Risk 1-2; At Risk 3-5; High Risk more than 5.',
    'Sprint Health: rated on carry-over and unfinished scope against the days remaining in the iteration.',
    'Dependency Risk: Good with no unresolved dependency links; Moderate Risk 1-4; At Risk 5-9; High Risk 10 or more, escalated one step when cross-team links are involved.',
    'Assignment Coverage: Good when every open item has an assignee; Moderate Risk with any unassigned item; At Risk when 1-2 unassigned items are high priority; High Risk when 3 or more are.',
    'The overall rating is the worst of the individual dimensions. These are heuristic categories chosen for triage, not statistical forecasts.'
];

function rateDelivery(facts: ProjectHealthFacts): RatedDimension {
    const reasons: string[] = [];
    const rate = facts.currentSprint?.completionRate ?? null;
    let rating: HealthRating;

    if (rate === null) {
        const completed = facts.delivery.completedLast30Days;
        rating = completed >= 5 ? 'Good' : completed >= 1 ? 'Moderate Risk' : 'At Risk';
        reasons.push(`No sprint completion rate available; ${completed} item(s) completed in the last 30 days.`);
    } else if (rate >= 70) {
        rating = 'Good';
        reasons.push(`Sprint completion at ${rate}% (>= 70%).`);
    } else if (rate >= 50) {
        rating = 'Moderate Risk';
        reasons.push(`Sprint completion at ${rate}% (50-69%).`);
    } else if (rate >= 30) {
        rating = 'At Risk';
        reasons.push(`Sprint completion at ${rate}% (30-49%).`);
    } else {
        rating = 'High Risk';
        reasons.push(`Sprint completion at ${rate}% (< 30%).`);
    }

    if (facts.delivery.reopenedCount >= 3) {
        rating = escalate(rating);
        reasons.push(`${facts.delivery.reopenedCount} reopen event(s) detected, escalating the rating one step.`);
    }
    if (facts.delivery.throughputPerWeek !== null) {
        reasons.push(`Throughput approximately ${facts.delivery.throughputPerWeek} item(s) per week over 30 days.`);
    }
    return { rating, reasons };
}

function rateSchedule(facts: ProjectHealthFacts): RatedDimension {
    const overdue = facts.counts.overdueItems;
    const rating: HealthRating = overdue === 0 ? 'Good' : overdue <= 2 ? 'Moderate Risk' : overdue <= 5 ? 'At Risk' : 'High Risk';
    const reasons = [`${overdue} overdue item(s).`];
    if (facts.counts.dueThisWeek > 0) reasons.push(`${facts.counts.dueThisWeek} item(s) due this week.`);
    return { rating, reasons };
}

function rateWorkload(facts: ProjectHealthFacts): RatedDimension {
    const { maxOpenPerMember, medianOpenPerMember, membersWithOverdue } = facts.workload;
    const reasons: string[] = [];
    let rating: HealthRating = 'Good';

    if (maxOpenPerMember === null || medianOpenPerMember === null || medianOpenPerMember === 0) {
        reasons.push('Not enough per-member workload data to judge balance.');
        return { rating: 'Good', reasons };
    }

    const ratio = maxOpenPerMember / medianOpenPerMember;
    reasons.push(`Busiest member holds ${maxOpenPerMember} open item(s) against a median of ${medianOpenPerMember} (${ratio.toFixed(1)}x).`);
    if (ratio >= 3) rating = 'High Risk';
    else if (ratio >= 2 && membersWithOverdue >= 2) rating = 'At Risk';
    else if (ratio >= 2) rating = 'Moderate Risk';

    if (membersWithOverdue > 0) reasons.push(`${membersWithOverdue} member(s) carry overdue work.`);
    return { rating, reasons };
}

function rateBlocked(facts: ProjectHealthFacts): RatedDimension {
    const blocked = facts.counts.blockedItems;
    const rating: HealthRating = blocked === 0 ? 'Good' : blocked <= 2 ? 'Moderate Risk' : blocked <= 5 ? 'At Risk' : 'High Risk';
    return { rating, reasons: [`${blocked} blocked item(s) detected with evidence.`] };
}

function rateSprint(facts: ProjectHealthFacts): RatedDimension {
    if (!facts.currentSprint) {
        return { rating: 'Moderate Risk', reasons: ['No current sprint is configured for the team, so sprint health cannot be tracked.'] };
    }
    const { items, completed, carryOverCount, daysRemaining, name } = facts.currentSprint;
    const remaining = items - completed;
    const reasons = [`${name}: ${completed}/${items} complete, ${remaining} item(s) outstanding, ${daysRemaining} day(s) remaining.`];
    let rating: HealthRating = 'Good';

    if (daysRemaining !== null && daysRemaining >= 0 && items > 0) {
        // Outstanding work per remaining day, versus the pace already achieved.
        if (daysRemaining <= 2 && remaining > completed) {
            rating = 'High Risk';
            reasons.push('More work is outstanding than completed with 2 days or less remaining.');
        } else if (daysRemaining <= 5 && remaining > items * 0.5) {
            rating = 'At Risk';
            reasons.push('Over half the sprint scope is outstanding with 5 days or less remaining.');
        } else if (remaining > items * 0.7) {
            rating = 'Moderate Risk';
            reasons.push('Over 70% of sprint scope is still outstanding.');
        }
    }
    if (carryOverCount >= 3) {
        rating = escalate(rating);
        reasons.push(`${carryOverCount} item(s) were carried in from a previous iteration, escalating the rating one step.`);
    }
    return { rating, reasons };
}

function rateDependencies(facts: ProjectHealthFacts): RatedDimension {
    const unresolved = facts.counts.unresolvedDependencies;
    let rating: HealthRating = unresolved === 0 ? 'Good' : unresolved <= 4 ? 'Moderate Risk' : unresolved <= 9 ? 'At Risk' : 'High Risk';
    const reasons = [`${unresolved} unresolved dependency link(s).`];
    if (facts.counts.crossTeamDependencies > 0) {
        rating = escalate(rating);
        reasons.push(`${facts.counts.crossTeamDependencies} of them cross out of the team's area paths, escalating the rating one step.`);
    }
    return { rating, reasons };
}

function rateAssignment(facts: ProjectHealthFacts): RatedDimension {
    const { unassignedItems, highPriorityUnassigned } = facts.counts;
    const reasons = [`${unassignedItems} unassigned open item(s), ${highPriorityUnassigned} of them high priority.`];
    let rating: HealthRating = 'Good';
    if (highPriorityUnassigned >= 3) rating = 'High Risk';
    else if (highPriorityUnassigned >= 1) rating = 'At Risk';
    else if (unassignedItems > 0) rating = 'Moderate Risk';
    return { rating, reasons };
}

function escalate(rating: HealthRating): HealthRating {
    const order: HealthRating[] = ['Good', 'Moderate Risk', 'At Risk', 'High Risk'];
    const index = order.indexOf(rating);
    return order[Math.min(index + 1, order.length - 1)] ?? rating;
}

function humanise(key: string): string {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, character => character.toUpperCase());
}

let sharedProjectAnalysis: ProjectAnalysisService | null = null;

export function getProjectAnalysisService(): ProjectAnalysisService {
    sharedProjectAnalysis ??= new ProjectAnalysisService();
    return sharedProjectAnalysis;
}

export function setProjectAnalysisServiceForTesting(service: ProjectAnalysisService | null): void {
    sharedProjectAnalysis = service;
}
