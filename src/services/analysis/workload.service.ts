import { parseAdoDate, startOfDay } from '../../utils/dates.js';
import { getAdoAnalyticsService, type AdoAnalyticsService } from '../azure-devops/analytics.service.js';
import { getSprintService, type Sprint, type SprintService } from '../azure-devops/sprint.service.js';
import { getTeamService, type TeamMember, type TeamService } from '../azure-devops/team.service.js';
import { getWorkItemService, type BlockedWorkItem, type WorkItemService } from '../azure-devops/work-item.service.js';
import type { WorkItem } from '../azure-devops/types.js';
import { buildEnvelope, toItemRef, type AnalysisEnvelope, type ItemRef } from './types.js';

export interface MemberWorkload {
    member: { displayName: string; email: string | null };
    counts: {
        assignedOpen: number;
        active: number;
        proposed: number;
        blocked: number;
        overdue: number;
        dueThisWeek: number;
        highPriority: number;
        completedLast30Days: number;
        inCurrentSprint: number;
    };
    effort: { remainingHours: number | null; storyPointsOpen: number | null };
    /** Sprint capacity from Azure DevOps, when the team maintains capacity. */
    sprintCapacityHoursPerDay: number | null;
    items: {
        active: ItemRef[];
        blocked: ItemRef[];
        overdue: ItemRef[];
        highPriority: ItemRef[];
    };
}

export interface TeamWorkloadFacts {
    team: string;
    currentSprint: { name: string; path: string; daysRemaining: number | null } | null;
    members: MemberWorkload[];
    unassigned: { count: number; items: ItemRef[] };
    totals: { openItems: number; activeItems: number; blockedItems: number; overdueItems: number };
    distribution: {
        openItemsPerMember: Record<string, number>;
        mean: number | null;
        median: number | null;
        min: number | null;
        max: number | null;
        spread: number | null;
        /** Coefficient of variation of open items per member, when computable. */
        variationRatio: number | null;
    };
}

/**
 * Workload analysis for the configured team.
 *
 * Counts come from Azure DevOps work-item queries. The imbalance judgement is
 * generated interpretation and states its own thresholds.
 */
export class WorkloadService {
    constructor(
        private readonly teams: TeamService = getTeamService(),
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly sprints: SprintService = getSprintService(),
        private readonly analytics: AdoAnalyticsService = getAdoAnalyticsService()
    ) {}

    /** Gathers the raw data every workload view needs, in one pass. */
    private async collect(): Promise<{
        members: TeamMember[];
        open: WorkItem[];
        blocked: BlockedWorkItem[];
        completed: WorkItem[];
        sprint: Sprint | null;
        sprintItems: WorkItem[];
        capacity: { member: string; capacityPerDay: number; daysOff: number }[] | null;
    }> {
        const [members, open, blocked, completed, sprint] = await Promise.all([
            this.teams.getMembers(),
            this.workItems.query([], { limit: 1000 }),
            this.workItems.blocked({ limit: 300 }).catch(() => [] as BlockedWorkItem[]),
            this.analytics.getCompletedWork(30, { limit: 500 }).catch(() => [] as WorkItem[]),
            this.sprints.getCurrentSprint().catch(() => null)
        ]);

        const sprintItems = sprint ? await this.sprints.getSprintWorkItems(sprint).catch(() => []) : [];
        const capacity = sprint ? await this.sprints.getCapacity(sprint).catch(() => null) : null;

        return { members, open, blocked, completed, sprint, sprintItems, capacity };
    }

    private buildMemberWorkload(
        member: TeamMember,
        data: {
            open: WorkItem[];
            blocked: BlockedWorkItem[];
            completed: WorkItem[];
            sprintItems: WorkItem[];
            capacity: { member: string; capacityPerDay: number; daysOff: number }[] | null;
        }
    ): MemberWorkload {
        const matches = (item: WorkItem): boolean => isSamePerson(item, member);
        const today = startOfDay();
        const weekEnd = startOfDay(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000));

        const openItems = data.open.filter(matches);
        const active = openItems.filter(item => item.stateCategory === 'InProgress');
        const proposed = openItems.filter(item => item.stateCategory === 'Proposed');
        const blocked = data.blocked.filter(matches);
        const overdue = openItems.filter(item => {
            const due = parseAdoDate(item.dueDate ?? item.targetDate);
            return due !== null && startOfDay(due) < today;
        });
        const dueThisWeek = openItems.filter(item => {
            const due = parseAdoDate(item.dueDate ?? item.targetDate);
            if (!due) return false;
            const day = startOfDay(due);
            return day >= today && day <= weekEnd;
        });
        const highPriority = openItems.filter(item => item.priority !== null && item.priority <= 2);

        let remainingHours: number | null = null;
        for (const item of openItems) {
            if (item.remainingWork === null) continue;
            remainingHours = (remainingHours ?? 0) + item.remainingWork;
        }
        let points: number | null = null;
        for (const item of openItems) {
            const value = item.storyPoints ?? item.effort;
            if (value === null) continue;
            points = (points ?? 0) + value;
        }

        const capacityEntry = data.capacity?.find(
            entry => entry.member.toLowerCase() === member.displayName.toLowerCase()
        );

        return {
            member: { displayName: member.displayName, email: member.email },
            counts: {
                assignedOpen: openItems.length,
                active: active.length,
                proposed: proposed.length,
                blocked: blocked.length,
                overdue: overdue.length,
                dueThisWeek: dueThisWeek.length,
                highPriority: highPriority.length,
                completedLast30Days: data.completed.filter(matches).length,
                inCurrentSprint: data.sprintItems.filter(matches).length
            },
            effort: {
                remainingHours: remainingHours === null ? null : round(remainingHours),
                storyPointsOpen: points === null ? null : round(points)
            },
            sprintCapacityHoursPerDay: capacityEntry ? round(capacityEntry.capacityPerDay) : null,
            items: {
                active: active.map(toItemRef),
                blocked: blocked.map(toItemRef),
                overdue: overdue.map(toItemRef),
                highPriority: highPriority.map(toItemRef)
            }
        };
    }

    async getMemberWorkload(memberQuery: string): Promise<MemberWorkload> {
        const member = await this.teams.resolveMember(memberQuery);
        const data = await this.collect();
        return this.buildMemberWorkload(member, data);
    }

    /** Work for a member, split into the categories a Team Lead actually asks about. */
    async getMemberWork(memberQuery: string): Promise<{
        member: { displayName: string; email: string | null };
        assigned: ItemRef[];
        active: ItemRef[];
        completedLast30Days: ItemRef[];
        overdue: ItemRef[];
        blocked: { item: ItemRef; signals: string[] }[];
        carryOverInCurrentSprint: ItemRef[];
        currentSprintItems: ItemRef[];
    }> {
        const member = await this.teams.resolveMember(memberQuery);
        const data = await this.collect();
        const matches = (item: WorkItem): boolean => isSamePerson(item, member);
        const today = startOfDay();

        const openItems = data.open.filter(matches);
        const carryOver: ItemRef[] = [];
        if (data.sprint) {
            const progress = await this.sprints.getSprintProgress(data.sprint).catch(() => null);
            for (const entry of progress?.carryOver ?? []) {
                const item = data.sprintItems.find(candidate => candidate.id === entry.id);
                if (item && matches(item)) carryOver.push(toItemRef(item));
            }
        }

        return {
            member: { displayName: member.displayName, email: member.email },
            assigned: openItems.map(toItemRef),
            active: openItems.filter(item => item.stateCategory === 'InProgress').map(toItemRef),
            completedLast30Days: data.completed.filter(matches).map(toItemRef),
            overdue: openItems
                .filter(item => {
                    const due = parseAdoDate(item.dueDate ?? item.targetDate);
                    return due !== null && startOfDay(due) < today;
                })
                .map(toItemRef),
            blocked: data.blocked
                .filter(matches)
                .map(item => ({ item: toItemRef(item), signals: item.blockedSignals.map(signal => signal.evidence) })),
            carryOverInCurrentSprint: carryOver,
            currentSprintItems: data.sprintItems.filter(matches).map(toItemRef)
        };
    }

    async getTeamWorkloadFacts(): Promise<TeamWorkloadFacts> {
        const data = await this.collect();
        const team = await this.teams.getConfiguredTeam();

        const members = data.members.map(member => this.buildMemberWorkload(member, data));
        const unassigned = data.open.filter(item => !item.assignedTo);

        const counts = members.map(entry => entry.counts.assignedOpen);
        const openItemsPerMember: Record<string, number> = {};
        for (const entry of members) openItemsPerMember[entry.member.displayName] = entry.counts.assignedOpen;

        return {
            team: team.name,
            currentSprint: data.sprint
                ? { name: data.sprint.name, path: data.sprint.path, daysRemaining: data.sprint.daysRemaining }
                : null,
            members,
            unassigned: { count: unassigned.length, items: unassigned.map(toItemRef) },
            totals: {
                openItems: data.open.length,
                activeItems: data.open.filter(item => item.stateCategory === 'InProgress').length,
                blockedItems: data.blocked.length,
                overdueItems: data.open.filter(item => {
                    const due = parseAdoDate(item.dueDate ?? item.targetDate);
                    return due !== null && startOfDay(due) < startOfDay();
                }).length
            },
            distribution: buildDistribution(openItemsPerMember, counts)
        };
    }

    /** Team workload plus generated interpretation of the distribution. */
    async analyzeWorkDistribution(): Promise<AnalysisEnvelope<TeamWorkloadFacts>> {
        const facts = await this.getTeamWorkloadFacts();
        const observations: string[] = [];
        const concerns: string[] = [];
        const recommendations: string[] = [];

        const withWork = facts.members.filter(member => member.counts.assignedOpen > 0);
        const idle = facts.members.filter(member => member.counts.assignedOpen === 0);
        const sorted = [...facts.members].sort((a, b) => b.counts.assignedOpen - a.counts.assignedOpen);
        const busiest = sorted[0];
        const lightest = sorted[sorted.length - 1];

        observations.push(
            `${facts.members.length} member(s) on ${facts.team}; ${withWork.length} currently hold open work items.`
        );
        if (busiest && lightest && busiest !== lightest) {
            observations.push(
                `Highest load: ${busiest.member.displayName} (${busiest.counts.assignedOpen} open). Lowest load: ${lightest.member.displayName} (${lightest.counts.assignedOpen} open).`
            );
        }
        if (facts.distribution.spread !== null && facts.distribution.mean !== null) {
            observations.push(
                `Open items per member range across ${facts.distribution.spread} item(s), mean ${facts.distribution.mean}.`
            );
        }

        // Imbalance rule: the busiest member holds at least double the median and
        // at least 4 more items than the lightest. Both thresholds are stated.
        const median = facts.distribution.median;
        if (busiest && median !== null && median > 0 && busiest.counts.assignedOpen >= median * 2 && busiest.counts.assignedOpen - (lightest?.counts.assignedOpen ?? 0) >= 4) {
            concerns.push(
                `Workload looks uneven: ${busiest.member.displayName} holds ${busiest.counts.assignedOpen} open items against a team median of ${median}.`
            );
            recommendations.push(
                `Review ${busiest.member.displayName}'s queue and consider moving lower-priority items to a member with spare capacity${
                    idle.length > 0 ? ` (for example ${idle.slice(0, 3).map(member => member.member.displayName).join(', ')})` : ''
                }.`
            );
        }

        for (const member of facts.members) {
            if (member.counts.overdue >= 3) {
                concerns.push(`${member.member.displayName} has ${member.counts.overdue} overdue item(s).`);
                recommendations.push(`Follow up with ${member.member.displayName} on the overdue items before assigning new work.`);
            }
            if (member.counts.blocked >= 2) {
                concerns.push(`${member.member.displayName} has ${member.counts.blocked} blocked item(s), so part of that load is not progressing.`);
            }
            if (member.counts.active >= 5) {
                concerns.push(
                    `${member.member.displayName} has ${member.counts.active} items in progress simultaneously, which often signals context switching.`
                );
            }
        }

        if (facts.unassigned.count > 0) {
            concerns.push(`${facts.unassigned.count} open item(s) have no assignee.`);
            recommendations.push(
                `Triage the ${facts.unassigned.count} unassigned item(s); use analysis_assignment_recommendation for a suggested owner per item.`
            );
        }
        if (idle.length > 0 && facts.unassigned.count > 0) {
            recommendations.push(
                `${idle.map(member => member.member.displayName).join(', ')} currently hold no open items and could absorb unassigned work.`
            );
        }

        return buildEnvelope('team_work_distribution', facts, {
            observations,
            concerns,
            recommendations,
            methodology: [
                'Open items: work items in the team\'s area paths whose state category is Proposed or InProgress.',
                'Overdue: an open item whose DueDate (or TargetDate when DueDate is unused) is earlier than today.',
                'Blocked: detected from state, tags, the Blocked field, or an unfinished predecessor link - each with evidence.',
                'Imbalance is flagged when the busiest member holds at least twice the team median open items AND at least 4 more than the lightest member.',
                'Completed counts cover the last 30 days of Completed/Resolved state changes.'
            ]
        });
    }

    /**
     * Members with spare capacity, ranked. The ranking is a heuristic and lists
     * the factors that produced it.
     */
    async findAvailableMembers(): Promise<
        AnalysisEnvelope<{
            team: string;
            candidates: {
                member: string;
                email: string | null;
                openItems: number;
                activeItems: number;
                overdueItems: number;
                blockedItems: number;
                remainingHours: number | null;
                capacityHoursPerDay: number | null;
                availabilityScore: number;
                availability: 'High' | 'Moderate' | 'Low';
                factors: string[];
            }[];
        }>
    > {
        const facts = await this.getTeamWorkloadFacts();
        const counts = facts.members.map(member => member.counts.assignedOpen);
        const mean = counts.length > 0 ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0;

        const candidates = facts.members
            .map(member => {
                const factors: string[] = [];
                // Availability heuristic: start at 100, subtract load signals.
                let score = 100;
                score -= member.counts.active * 12;
                score -= member.counts.proposed * 4;
                score -= member.counts.overdue * 15;
                score -= member.counts.blocked * 5;
                score -= member.counts.highPriority * 6;
                if (mean > 0 && member.counts.assignedOpen > mean) {
                    score -= Math.round((member.counts.assignedOpen - mean) * 5);
                    factors.push(`Above team average open items (${member.counts.assignedOpen} vs mean ${round(mean)})`);
                }
                if (member.counts.assignedOpen === 0) factors.push('No open items assigned');
                if (member.counts.active > 0) factors.push(`${member.counts.active} item(s) in progress`);
                if (member.counts.overdue > 0) factors.push(`${member.counts.overdue} overdue item(s)`);
                if (member.counts.blocked > 0) factors.push(`${member.counts.blocked} blocked item(s)`);
                if (member.effort.remainingHours !== null) {
                    factors.push(`${member.effort.remainingHours}h remaining work booked`);
                }
                if (member.sprintCapacityHoursPerDay !== null) {
                    factors.push(`Sprint capacity ${member.sprintCapacityHoursPerDay}h/day configured in Azure DevOps`);
                }

                const bounded = Math.max(0, Math.min(100, score));
                return {
                    member: member.member.displayName,
                    email: member.member.email,
                    openItems: member.counts.assignedOpen,
                    activeItems: member.counts.active,
                    overdueItems: member.counts.overdue,
                    blockedItems: member.counts.blocked,
                    remainingHours: member.effort.remainingHours,
                    capacityHoursPerDay: member.sprintCapacityHoursPerDay,
                    availabilityScore: bounded,
                    availability: bounded >= 70 ? ('High' as const) : bounded >= 40 ? ('Moderate' as const) : ('Low' as const),
                    factors
                };
            })
            .sort((a, b) => b.availabilityScore - a.availabilityScore);

        return buildEnvelope(
            'available_team_members',
            { team: facts.team, candidates },
            {
                observations: [
                    candidates.length === 0
                        ? 'No team members are visible for the configured team.'
                        : `${candidates.filter(candidate => candidate.availability === 'High').length} member(s) rated High availability, ${candidates.filter(candidate => candidate.availability === 'Low').length} rated Low.`
                ],
                methodology: [
                    'Availability starts at 100 and subtracts: 12 per in-progress item, 4 per proposed item, 15 per overdue item, 5 per blocked item, 6 per high-priority item, and 5 per item above the team mean.',
                    'High >= 70, Moderate 40-69, Low < 40. The score is a relative heuristic for triage, not a measure of individual performance or effort.'
                ]
            }
        );
    }
}

/** Matches a work item's assignee against a team member, by email then display name. */
export function isSamePerson(item: { assignedTo: string | null; assignedToEmail: string | null }, member: TeamMember): boolean {
    if (!item.assignedTo && !item.assignedToEmail) return false;
    const memberEmail = member.email?.toLowerCase() ?? member.uniqueName?.toLowerCase() ?? null;
    if (memberEmail && item.assignedToEmail && item.assignedToEmail.toLowerCase() === memberEmail) return true;
    return item.assignedTo?.toLowerCase() === member.displayName.toLowerCase();
}

function buildDistribution(openItemsPerMember: Record<string, number>, counts: number[]): TeamWorkloadFacts['distribution'] {
    if (counts.length === 0) {
        return { openItemsPerMember, mean: null, median: null, min: null, max: null, spread: null, variationRatio: null };
    }
    const sorted = [...counts].sort((a, b) => a - b);
    const total = counts.reduce((sum, value) => sum + value, 0);
    const mean = total / counts.length;
    const middle = Math.floor(sorted.length / 2);
    const median =
        sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    return {
        openItemsPerMember,
        mean: round(mean),
        median: round(median),
        min,
        max,
        spread: max - min,
        variationRatio: mean > 0 ? round(stdDev / mean) : null
    };
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

let sharedWorkloadService: WorkloadService | null = null;

export function getWorkloadService(): WorkloadService {
    sharedWorkloadService ??= new WorkloadService();
    return sharedWorkloadService;
}

export function setWorkloadServiceForTesting(service: WorkloadService | null): void {
    sharedWorkloadService = service;
}
