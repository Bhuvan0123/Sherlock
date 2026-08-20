import { parseAdoDate, startOfDay } from '../../utils/dates.js';
import { getAdoAnalyticsService, type AdoAnalyticsService, type DeliveryMetrics } from '../../azure-devops/analytics.service.js';
import { getSprintService, type Sprint, type SprintService } from '../../azure-devops/sprint.service.js';
import { getTeamService, type TeamService } from '../../azure-devops/team.service.js';
import { getWorkItemService, type WorkItemService } from '../../azure-devops/work-item.service.js';
import { getWorkloadService, isSamePerson, type TeamWorkloadFacts, type WorkloadService } from './workload.service.js';
import { buildEnvelope, type AnalysisEnvelope } from './types.js';

export interface SprintDeliverySnapshot {
    sprint: string;
    startDate: string | null;
    finishDate: string | null;
    items: number;
    completed: number;
    completionRate: number | null;
    carryOverIn: number;
    unplannedItems: number;
    storyPointsCommitted: number | null;
    storyPointsCompleted: number | null;
}

export interface TeamProductivityFacts {
    team: string;
    delivery: DeliveryMetrics;
    sprintHistory: SprintDeliverySnapshot[];
    currentWorkload: {
        members: { member: string; open: number; active: number; overdue: number; blocked: number; completedLast30Days: number }[];
        unassignedOpen: number;
        distributionSpread: number | null;
        distributionVariationRatio: number | null;
    };
    signals: {
        blockedItems: number;
        overdueItems: number;
        carryOverCurrentSprint: number;
        unplannedCurrentSprint: number;
        reopenedEvents: number;
    };
    coverage: {
        /** Says plainly what the numbers could and could not be measured from. */
        notes: string[];
    };
}

export interface MemberSprintHistoryEntry {
    sprint: string;
    startDate: string | null;
    finishDate: string | null;
    assigned: number;
    completed: number;
    completionRate: number | null;
    carriedIn: number;
}

/**
 * Team delivery analysis.
 *
 * Deliberately does not compute a single productivity score for a team or an
 * individual. It reports delivery indicators, trends across sprints, and the
 * conditions around the work (blocked, carry-over, unplanned, reopened), and
 * labels every interpretation as generated analysis.
 */
export class ProductivityService {
    constructor(
        private readonly analytics: AdoAnalyticsService = getAdoAnalyticsService(),
        private readonly sprints: SprintService = getSprintService(),
        private readonly workload: WorkloadService = getWorkloadService(),
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly teams: TeamService = getTeamService()
    ) {}

    async getSprintHistory(count = 3): Promise<SprintDeliverySnapshot[]> {
        const [current, past] = await Promise.all([
            this.sprints.getCurrentSprint().catch(() => null),
            this.sprints.getPastSprints(Math.max(count - 1, 1)).catch(() => [] as Sprint[])
        ]);
        const sprints = [...past.reverse(), ...(current ? [current] : [])].slice(-count);

        return await Promise.all(
            sprints.map(async sprint => {
                const [progress, items] = await Promise.all([
                    this.sprints.getSprintProgress(sprint).catch(() => null),
                    this.sprints.getSprintWorkItems(sprint).catch(() => [])
                ]);
                const unplanned = await this.analytics.getUnplannedWork(sprint, items).catch(() => null);
                return {
                    sprint: sprint.name,
                    startDate: sprint.startDate,
                    finishDate: sprint.finishDate,
                    items: progress?.totals.items ?? items.length,
                    completed: progress?.totals.completed ?? 0,
                    completionRate: progress?.completionRate ?? null,
                    carryOverIn: progress?.carryOver.length ?? 0,
                    unplannedItems: unplanned?.items.length ?? 0,
                    storyPointsCommitted: progress?.storyPoints.committed ?? null,
                    storyPointsCompleted: progress?.storyPoints.completed ?? null
                } satisfies SprintDeliverySnapshot;
            })
        );
    }

    async getFacts(sprintCount = 3, windowDays = 30): Promise<TeamProductivityFacts> {
        const [delivery, sprintHistory, workloadFacts, blocked, currentSprint, team] = await Promise.all([
            this.analytics.getDeliveryMetrics(windowDays),
            this.getSprintHistory(sprintCount),
            this.workload.getTeamWorkloadFacts(),
            this.workItems.blocked({ limit: 300 }).catch(() => []),
            this.sprints.getCurrentSprint().catch(() => null),
            this.teams.getConfiguredTeam()
        ]);

        const currentSnapshot = sprintHistory.find(entry => entry.sprint === currentSprint?.name) ?? null;
        const notes: string[] = [];
        if (delivery.cycleTimeDays.measured === 0) {
            notes.push('Cycle time could not be measured: no completed item had both an ActivatedDate and a ClosedDate.');
        } else if (delivery.cycleTimeDays.measured < delivery.completed.items) {
            notes.push(
                `Cycle time measured on ${delivery.cycleTimeDays.measured} of ${delivery.completed.items} completed item(s); the rest were missing ActivatedDate or ClosedDate.`
            );
        }
        if (!delivery.reopened.complete) {
            notes.push(
                `Reopen detection inspected the revision history of ${delivery.reopened.itemsInspected} completed item(s), not all ${delivery.completed.items}.`
            );
        }
        if (delivery.completed.storyPoints === null) {
            notes.push('Story points are not recorded on these work items, so point-based velocity is unavailable.');
        }
        if (sprintHistory.length < sprintCount) {
            notes.push(`Only ${sprintHistory.length} iteration(s) with data were available, so trend comparison is limited.`);
        }

        return {
            team: team.name,
            delivery,
            sprintHistory,
            currentWorkload: {
                members: workloadFacts.members.map(member => ({
                    member: member.member.displayName,
                    open: member.counts.assignedOpen,
                    active: member.counts.active,
                    overdue: member.counts.overdue,
                    blocked: member.counts.blocked,
                    completedLast30Days: member.counts.completedLast30Days
                })),
                unassignedOpen: workloadFacts.unassigned.count,
                distributionSpread: workloadFacts.distribution.spread,
                distributionVariationRatio: workloadFacts.distribution.variationRatio
            },
            signals: {
                blockedItems: blocked.length,
                overdueItems: workloadFacts.totals.overdueItems,
                carryOverCurrentSprint: currentSnapshot?.carryOverIn ?? 0,
                unplannedCurrentSprint: currentSnapshot?.unplannedItems ?? 0,
                reopenedEvents: delivery.reopened.count
            },
            coverage: { notes }
        };
    }

    async analyzeTeamProductivity(sprintCount = 3, windowDays = 30): Promise<
        AnalysisEnvelope<TeamProductivityFacts & { trends: string[] }>
    > {
        const facts = await this.getFacts(sprintCount, windowDays);
        const observations: string[] = [];
        const trends: string[] = [];
        const concerns: string[] = [];
        const recommendations: string[] = [];

        observations.push(
            `${facts.delivery.completed.items} item(s) completed in the last ${facts.delivery.window.days} days (about ${facts.delivery.throughputPerWeek} per week).`
        );
        if (facts.delivery.cycleTimeDays.average !== null) {
            observations.push(
                `Cycle time: average ${facts.delivery.cycleTimeDays.average} day(s), median ${facts.delivery.cycleTimeDays.median}, 85th percentile ${facts.delivery.cycleTimeDays.p85}, from ${facts.delivery.cycleTimeDays.measured} measured item(s).`
            );
        }
        const typeBreakdown = Object.entries(facts.delivery.completed.byType)
            .map(([type, count]) => `${count} ${type}`)
            .join(', ');
        if (typeBreakdown) observations.push(`Completed work by type: ${typeBreakdown}.`);

        // Trends across sprints, stated as directional comparisons rather than scores.
        const rates = facts.sprintHistory.filter(entry => entry.completionRate !== null);
        if (rates.length >= 2) {
            const first = rates[0];
            const last = rates[rates.length - 1];
            if (first && last) {
                const delta = (last.completionRate ?? 0) - (first.completionRate ?? 0);
                trends.push(
                    `Sprint completion moved from ${first.completionRate}% in ${first.sprint} to ${last.completionRate}% in ${last.sprint} (${delta >= 0 ? '+' : ''}${Math.round(delta)} points).`
                );
            }
        }
        const carryTrend = facts.sprintHistory.map(entry => `${entry.sprint}: ${entry.carryOverIn}`).join(', ');
        if (facts.sprintHistory.length > 0) trends.push(`Carry-over items per iteration - ${carryTrend}.`);
        const unplannedTrend = facts.sprintHistory.map(entry => `${entry.sprint}: ${entry.unplannedItems}`).join(', ');
        if (facts.sprintHistory.length > 0) trends.push(`Work added mid-sprint - ${unplannedTrend}.`);
        const committed = facts.sprintHistory.filter(entry => entry.storyPointsCommitted !== null);
        if (committed.length >= 2) {
            trends.push(
                `Story points committed vs completed - ${committed
                    .map(entry => `${entry.sprint}: ${entry.storyPointsCompleted}/${entry.storyPointsCommitted}`)
                    .join(', ')}.`
            );
        }

        if (facts.signals.blockedItems > 0) {
            concerns.push(`${facts.signals.blockedItems} item(s) are blocked, so some capacity is committed but not producing throughput.`);
            recommendations.push('Work through the blocked list at the next stand-up; unblocking usually moves throughput faster than adding work.');
        }
        if (facts.signals.overdueItems > 0) {
            concerns.push(`${facts.signals.overdueItems} item(s) are past their due date.`);
        }
        if (facts.signals.carryOverCurrentSprint >= 3) {
            concerns.push(
                `${facts.signals.carryOverCurrentSprint} item(s) carried into the current sprint, which suggests the previous commitment exceeded capacity.`
            );
            recommendations.push('Compare committed scope against recent throughput when planning the next sprint.');
        }
        if (facts.signals.unplannedCurrentSprint >= 3) {
            concerns.push(
                `${facts.signals.unplannedCurrentSprint} item(s) were created after the current sprint started, so planned scope is competing with incoming work.`
            );
            recommendations.push('Consider reserving explicit capacity for unplanned work if mid-sprint arrivals are routine.');
        }
        if (facts.signals.reopenedEvents >= 3) {
            concerns.push(`${facts.signals.reopenedEvents} reopen event(s) detected, which can point at unclear acceptance criteria or thin review.`);
        }
        if (facts.currentWorkload.unassignedOpen > 0) {
            recommendations.push(`Triage the ${facts.currentWorkload.unassignedOpen} unassigned open item(s).`);
        }
        if ((facts.currentWorkload.distributionVariationRatio ?? 0) >= 0.75) {
            concerns.push(
                `Open work is spread unevenly across the team (variation ratio ${facts.currentWorkload.distributionVariationRatio}).`
            );
            recommendations.push('Review the workload distribution with analysis_work_distribution before assigning new work.');
        }

        return buildEnvelope(
            'team_productivity',
            { ...facts, trends },
            {
                observations,
                concerns,
                recommendations,
                methodology: [
                    ...facts.delivery.methodology,
                    'Carry-over is evidence-based: an item counts only when its revision history shows its IterationPath changed into the sprint from a different iteration.',
                    'Unplanned work is defined as sprint items created after the sprint start date.',
                    'Variation ratio is the standard deviation of open items per member divided by the mean; 0.75 is used as the "uneven" threshold.',
                    'No single productivity score is produced for the team or for any individual, by design. Delivery indicators depend on how consistently the team records dates, estimates and states in Azure DevOps.',
                    ...facts.coverage.notes
                ]
            }
        );
    }

    /** Per-sprint delivery for one member, from real iteration membership. */
    async getMemberSprintHistory(memberQuery: string, sprintCount = 3): Promise<
        AnalysisEnvelope<{ member: string; sprints: MemberSprintHistoryEntry[] }>
    > {
        const member = await this.teams.resolveMember(memberQuery);
        const [current, past] = await Promise.all([
            this.sprints.getCurrentSprint().catch(() => null),
            this.sprints.getPastSprints(Math.max(sprintCount - 1, 1)).catch(() => [] as Sprint[])
        ]);
        const sprints = [...past.reverse(), ...(current ? [current] : [])].slice(-sprintCount);

        const entries: MemberSprintHistoryEntry[] = [];
        for (const sprint of sprints) {
            const items = await this.sprints.getSprintWorkItems(sprint).catch(() => []);
            const mine = items.filter(item => isSamePerson(item, member));
            const completed = mine.filter(item => item.stateCategory === 'Completed' || item.stateCategory === 'Resolved');
            const progress = await this.sprints.getSprintProgress(sprint).catch(() => null);
            const carriedIn = (progress?.carryOver ?? []).filter(entry =>
                mine.some(item => item.id === entry.id)
            ).length;

            entries.push({
                sprint: sprint.name,
                startDate: sprint.startDate,
                finishDate: sprint.finishDate,
                assigned: mine.length,
                completed: completed.length,
                completionRate: mine.length > 0 ? Math.round((completed.length / mine.length) * 100) : null,
                carriedIn
            });
        }

        return buildEnvelope(
            'member_sprint_history',
            { member: member.displayName, sprints: entries },
            {
                observations: [
                    entries.length === 0
                        ? 'No iterations with data were available for this member.'
                        : `${member.displayName} was assigned work in ${entries.filter(entry => entry.assigned > 0).length} of the last ${entries.length} iteration(s).`
                ],
                methodology: [
                    'Assignment is matched on Azure DevOps identity email first, then display name.',
                    'Sprint membership comes from the work item IterationPath at read time; items moved between iterations appear in their current iteration only.',
                    'These are delivery counts in context, not a performance rating. Item counts do not account for item size, complexity or interruptions.'
                ]
            }
        );
    }

    /** Team-level delivery metrics without interpretation, for reporting tools. */
    async getTeamDeliveryMetrics(days = 30): Promise<AnalysisEnvelope<{ team: string; metrics: DeliveryMetrics; workload: TeamWorkloadFacts['totals'] }>> {
        const [metrics, workloadFacts, team] = await Promise.all([
            this.analytics.getDeliveryMetrics(days),
            this.workload.getTeamWorkloadFacts(),
            this.teams.getConfiguredTeam()
        ]);

        return buildEnvelope(
            'team_delivery_metrics',
            { team: team.name, metrics, workload: workloadFacts.totals },
            {
                observations: [
                    `${metrics.completed.items} item(s) completed in ${days} days; ${workloadFacts.totals.openItems} open, ${workloadFacts.totals.blockedItems} blocked.`
                ],
                methodology: metrics.methodology
            }
        );
    }

    /** Completed work for one member over a window, with the same caveats attached. */
    async getMemberCompletedWork(memberQuery: string, days = 30): Promise<
        AnalysisEnvelope<{ member: string; windowDays: number; completed: { id: number; title: string; type: string; closedDate: string | null }[] }>
    > {
        const member = await this.teams.resolveMember(memberQuery);
        const completed = await this.analytics.getCompletedWork(days, { limit: 500 });
        const mine = completed.filter(item => isSamePerson(item, member));
        const today = startOfDay();

        return buildEnvelope(
            'member_completed_work',
            {
                member: member.displayName,
                windowDays: days,
                completed: mine.map(item => ({
                    id: item.id,
                    title: item.title,
                    type: item.type,
                    closedDate: item.closedDate ?? item.resolvedDate ?? item.stateChangeDate
                }))
            },
            {
                observations: [
                    `${mine.length} item(s) recorded as completed by ${member.displayName} in the last ${days} days (as of ${today.toDateString()}).`
                ],
                methodology: [
                    'Completion is attributed by the current AssignedTo value, which is the person the item was assigned to when it closed only if it was not reassigned afterwards.',
                    'Item counts are not a measure of effort or output quality.'
                ]
            }
        );
    }
}

/** Days between two ISO dates, or null when either is missing. */
export function daysBetweenIso(from: string | null, to: string | null): number | null {
    const start = parseAdoDate(from);
    const end = parseAdoDate(to);
    if (!start || !end) return null;
    return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

let sharedProductivityService: ProductivityService | null = null;

export function getProductivityService(): ProductivityService {
    sharedProductivityService ??= new ProductivityService();
    return sharedProductivityService;
}

export function setProductivityServiceForTesting(service: ProductivityService | null): void {
    sharedProductivityService = service;
}
