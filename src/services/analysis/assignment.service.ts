import { READ_ONLY_REFUSAL_MESSAGE } from '../../security/read-only-policy.js';
import { getAdoAnalyticsService, type AdoAnalyticsService } from '../../azure-devops/analytics.service.js';
import { getSprintService, type SprintService } from '../../azure-devops/sprint.service.js';
import { getTeamService, type TeamMember, type TeamService } from '../../azure-devops/team.service.js';
import { MINIMAL_WORK_ITEM_FIELDS } from '../../azure-devops/field-profiles.js';
import { getWorkItemService, type WorkItemService } from '../../azure-devops/work-item.service.js';
import type { WorkItem } from '../../azure-devops/types.js';
import { getWorkloadService, isSamePerson, type MemberWorkload, type WorkloadService } from './workload.service.js';
import { buildEnvelope, toItemRef, type AnalysisEnvelope, type ItemRef } from './types.js';

export interface AssignmentCandidate {
    member: string;
    email: string | null;
    /** Relative suitability, 0-100. A ranking aid, not a measurement. */
    suitability: number;
    recommendation: 'Recommended' | 'Possible' | 'Not recommended';
    workloadSummary: {
        openItems: number;
        activeItems: number;
        overdueItems: number;
        blockedItems: number;
        remainingHours: number | null;
        sprintCapacityHoursPerDay: number | null;
    };
    experience: {
        completedSameType: number;
        completedSameArea: number;
        completedSameTags: number;
        completedTotalLast90Days: number;
    };
    reasons: string[];
    cautions: string[];
}

export interface AssignmentRecommendation {
    workItem: ItemRef & { type: string; areaPath: string | null; iterationPath: string | null; priority: number | null; tags: string[] };
    currentAssignee: string | null;
    topCandidate: AssignmentCandidate | null;
    candidates: AssignmentCandidate[];
    /** Restated on every recommendation so the boundary is never ambiguous. */
    actionRequired: string;
}

/** Experience window for "has done similar work before". */
const EXPERIENCE_WINDOW_DAYS = 90;

/**
 * Assignment recommendations.
 *
 * This service recommends and explains; it cannot assign. Azure DevOps is
 * read-only for this server, so applying a recommendation is always a manual step
 * for the Team Lead.
 */
export class AssignmentService {
    constructor(
        private readonly teams: TeamService = getTeamService(),
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly workload: WorkloadService = getWorkloadService(),
        private readonly analytics: AdoAnalyticsService = getAdoAnalyticsService(),
        private readonly sprints: SprintService = getSprintService()
    ) {}

    /** Historical completions used to judge familiarity with similar work. */
    private async getExperienceBase(): Promise<WorkItem[]> {
        return await this.analytics.getCompletedWork(EXPERIENCE_WINDOW_DAYS, { limit: 80 }).catch(() => []);
    }

    private scoreCandidate(
        member: TeamMember,
        workloadEntry: MemberWorkload,
        target: WorkItem,
        history: WorkItem[],
        teamMean: number
    ): AssignmentCandidate {
        const reasons: string[] = [];
        const cautions: string[] = [];

        const mine = history.filter(item => isSamePerson(item, member));
        const sameType = mine.filter(item => item.type === target.type).length;
        const sameArea = mine.filter(item => item.areaPath !== null && item.areaPath === target.areaPath).length;
        const targetTags = new Set(target.tags.map(tag => tag.toLowerCase()));
        const sameTags =
            targetTags.size === 0 ? 0 : mine.filter(item => item.tags.some(tag => targetTags.has(tag.toLowerCase()))).length;

        // Suitability: capacity first, then demonstrated familiarity. Weights are
        // published in the methodology so the ranking can be checked or ignored.
        let score = 50;

        const load = workloadEntry.counts.assignedOpen;
        if (load === 0) {
            score += 20;
            reasons.push('No open items currently assigned');
        } else if (load <= teamMean) {
            score += 12;
            reasons.push(`Open workload at or below the team average (${load} vs mean ${round(teamMean)})`);
        } else {
            const excess = load - teamMean;
            score -= Math.min(25, Math.round(excess * 5));
            cautions.push(`Open workload above the team average (${load} vs mean ${round(teamMean)})`);
        }

        score -= workloadEntry.counts.active * 4;
        if (workloadEntry.counts.active > 0) reasons.push(`${workloadEntry.counts.active} item(s) in progress`);

        if (workloadEntry.counts.overdue > 0) {
            score -= workloadEntry.counts.overdue * 12;
            cautions.push(`${workloadEntry.counts.overdue} overdue item(s) already assigned`);
        } else {
            score += 8;
            reasons.push('No overdue items');
        }

        if (workloadEntry.counts.blocked > 0) {
            cautions.push(`${workloadEntry.counts.blocked} blocked item(s) assigned`);
        }
        if (workloadEntry.counts.highPriority > 0) {
            score -= workloadEntry.counts.highPriority * 4;
            cautions.push(`${workloadEntry.counts.highPriority} high-priority item(s) already assigned`);
        }

        if (sameType > 0) {
            score += Math.min(15, sameType * 3);
            reasons.push(`Completed ${sameType} ${target.type}(s) in the last ${EXPERIENCE_WINDOW_DAYS} days`);
        } else {
            cautions.push(`No ${target.type} completed in the last ${EXPERIENCE_WINDOW_DAYS} days`);
        }
        if (sameArea > 0) {
            score += Math.min(12, sameArea * 3);
            reasons.push(`Completed ${sameArea} item(s) in the same area path (${target.areaPath ?? 'n/a'})`);
        }
        if (sameTags > 0) {
            score += Math.min(8, sameTags * 2);
            reasons.push(`Completed ${sameTags} item(s) sharing tags with this work item`);
        }

        if (workloadEntry.effort.remainingHours !== null && workloadEntry.sprintCapacityHoursPerDay !== null) {
            reasons.push(
                `${workloadEntry.effort.remainingHours}h booked against ${workloadEntry.sprintCapacityHoursPerDay}h/day configured sprint capacity`
            );
        }
        if (workloadEntry.counts.inCurrentSprint > 0) {
            reasons.push(`Already working in the current sprint (${workloadEntry.counts.inCurrentSprint} item(s))`);
        }

        const bounded = Math.max(0, Math.min(100, Math.round(score)));
        return {
            member: member.displayName,
            email: member.email,
            suitability: bounded,
            recommendation: bounded >= 65 ? 'Recommended' : bounded >= 40 ? 'Possible' : 'Not recommended',
            workloadSummary: {
                openItems: workloadEntry.counts.assignedOpen,
                activeItems: workloadEntry.counts.active,
                overdueItems: workloadEntry.counts.overdue,
                blockedItems: workloadEntry.counts.blocked,
                remainingHours: workloadEntry.effort.remainingHours,
                sprintCapacityHoursPerDay: workloadEntry.sprintCapacityHoursPerDay
            },
            experience: {
                completedSameType: sameType,
                completedSameArea: sameArea,
                completedSameTags: sameTags,
                completedTotalLast90Days: mine.length
            },
            reasons,
            cautions
        };
    }

    async recommendAssignment(workItemId: number): Promise<AnalysisEnvelope<AssignmentRecommendation>> {
        const [target, members, workloadFacts, history] = await Promise.all([
            this.workItems.getById(workItemId),
            this.teams.getMembers(),
            this.workload.getTeamWorkloadFacts({ includeExamples: false }),
            this.getExperienceBase()
        ]);

        const counts = workloadFacts.members.map(member => member.counts.assignedOpen);
        const teamMean = counts.length > 0 ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0;

        const candidates = members
            .map(member => {
                const entry = workloadFacts.members.find(
                    candidate => candidate.member.displayName.toLowerCase() === member.displayName.toLowerCase()
                );
                if (!entry) return null;
                return this.scoreCandidate(member, entry, target, history, teamMean);
            })
            .filter((candidate): candidate is AssignmentCandidate => candidate !== null)
            .sort((a, b) => b.suitability - a.suitability);

        const top = candidates[0] ?? null;
        const observations: string[] = [];
        const recommendations: string[] = [];

        if (target.assignedTo) {
            observations.push(`#${target.id} is currently assigned to ${target.assignedTo}.`);
        } else {
            observations.push(`#${target.id} is currently unassigned.`);
        }
        if (top) {
            recommendations.push(
                `Suggested owner for ${target.type} #${target.id} "${target.title}": ${top.member}. ${top.reasons.slice(0, 4).join('; ')}.`
            );
            if (top.cautions.length > 0) {
                observations.push(`Cautions for ${top.member}: ${top.cautions.join('; ')}.`);
            }
            const runnerUp = candidates[1];
            if (runnerUp) {
                recommendations.push(`Alternative: ${runnerUp.member} (${runnerUp.reasons.slice(0, 2).join('; ') || 'available capacity'}).`);
            }
        } else {
            observations.push('No team members are available to recommend.');
        }

        return buildEnvelope(
            'assignment_recommendation',
            {
                workItem: {
                    ...toItemRef(target),
                    type: target.type,
                    areaPath: target.areaPath,
                    iterationPath: target.iterationPath,
                    priority: target.priority,
                    tags: target.tags
                },
                currentAssignee: target.assignedTo,
                topCandidate: top,
                candidates,
                actionRequired: READ_ONLY_REFUSAL_MESSAGE
            },
            {
                observations,
                recommendations,
                methodology: ASSIGNMENT_METHODOLOGY
            }
        );
    }

    /** Recommendations for every unassigned open item, highest priority first. */
    async recommendAssignments(limit = 10): Promise<
        AnalysisEnvelope<{
            unassignedCount: number;
            recommendations: { workItem: ItemRef; suggested: string | null; suitability: number | null; reasons: string[] }[];
            actionRequired: string;
        }>
    > {
        const [unassigned, members, workloadFacts, currentSprint] = await Promise.all([
            this.workItems.unassigned({ limit: Math.max(1, Math.min(limit, 10)), profile: MINIMAL_WORK_ITEM_FIELDS }),
            this.teams.getMembers(),
            this.workload.getTeamWorkloadFacts({ includeExamples: false }),
            this.sprints.getCurrentSprint().catch(() => null)
        ]);
        const history: WorkItem[] = [];

        // Prioritise: current sprint first, then by priority, then by due date.
        const ranked = [...unassigned].sort((a, b) => {
            const aInSprint = currentSprint && a.iterationPath === currentSprint.path ? 0 : 1;
            const bInSprint = currentSprint && b.iterationPath === currentSprint.path ? 0 : 1;
            if (aInSprint !== bInSprint) return aInSprint - bInSprint;
            const aPriority = a.priority ?? 9;
            const bPriority = b.priority ?? 9;
            if (aPriority !== bPriority) return aPriority - bPriority;
            return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
        });

        const counts = workloadFacts.members.map(member => member.counts.assignedOpen);
        const teamMean = counts.length > 0 ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0;

        // Track provisional allocations so the same person is not suggested for everything.
        const provisionalLoad = new Map<string, number>();
        const recommendations: { workItem: ItemRef; suggested: string | null; suitability: number | null; reasons: string[] }[] = [];

        for (const item of ranked.slice(0, Math.max(1, Math.min(limit, 50)))) {
            const scored = members
                .map(member => {
                    const entry = workloadFacts.members.find(
                        candidate => candidate.member.displayName.toLowerCase() === member.displayName.toLowerCase()
                    );
                    if (!entry) return null;
                    const candidate = this.scoreCandidate(member, entry, item, history, teamMean);
                    const provisional = provisionalLoad.get(candidate.member) ?? 0;
                    return { ...candidate, suitability: Math.max(0, candidate.suitability - provisional * 10) };
                })
                .filter((candidate): candidate is AssignmentCandidate => candidate !== null)
                .sort((a, b) => b.suitability - a.suitability);

            const best = scored[0] ?? null;
            if (best) provisionalLoad.set(best.member, (provisionalLoad.get(best.member) ?? 0) + 1);

            recommendations.push({
                workItem: toItemRef(item),
                suggested: best?.member ?? null,
                suitability: best?.suitability ?? null,
                reasons: best?.reasons.slice(0, 3) ?? []
            });
        }

        return buildEnvelope(
            'assignment_recommendations',
            { unassignedCount: unassigned.length, recommendations, actionRequired: READ_ONLY_REFUSAL_MESSAGE },
            {
                observations: [
                    `${unassigned.length} unassigned open item(s); suggestions produced for ${recommendations.length}.`,
                    'Suggestions are spread across the team: each provisional suggestion reduces that member\'s suitability for the next item by 10 points.'
                ],
                recommendations: recommendations
                    .filter(entry => entry.suggested !== null)
                    .slice(0, 10)
                    .map(entry => `#${entry.workItem.id} "${entry.workItem.title}" -> ${entry.suggested}`),
                methodology: ASSIGNMENT_METHODOLOGY
            }
        );
    }
}

const ASSIGNMENT_METHODOLOGY = [
    'Suitability starts at 50. Capacity: +20 with no open items, +12 at or below the team mean, otherwise -5 per item above the mean (capped at -25); -4 per in-progress item; +8 with no overdue work, otherwise -12 per overdue item; -4 per high-priority item already held.',
    `Familiarity: +3 per completed work item of the same type (max +15), +3 per completed item in the same area path (max +12), +2 per completed item sharing a tag (max +8), measured over the last ${EXPERIENCE_WINDOW_DAYS} days.`,
    'Recommended >= 65, Possible 40-64, Not recommended < 40.',
    'Skills are inferred only from what Azure DevOps records - completed work-item types, area paths and tags. There is no separate skills database, so the signal is limited to observable delivery history.',
    'This is a ranking aid for a human decision. It cannot see leave plans, side commitments, pairing arrangements or growth goals.',
    'This server cannot assign work items. Applying a recommendation is a manual action in Azure DevOps.'
];

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

let sharedAssignmentService: AssignmentService | null = null;

export function getAssignmentService(): AssignmentService {
    sharedAssignmentService ??= new AssignmentService();
    return sharedAssignmentService;
}

export function setAssignmentServiceForTesting(service: AssignmentService | null): void {
    sharedAssignmentService = service;
}
