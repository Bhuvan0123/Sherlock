import { businessDaysBetween, daysBetween, describeRelativeDays, parseAdoDate, startOfDay } from '../../utils/dates.js';
import { getSprintService, type Sprint, type SprintService } from '../azure-devops/sprint.service.js';
import { getWorkItemService, type WorkItemService } from '../azure-devops/work-item.service.js';
import type { WorkItem } from '../azure-devops/types.js';
import { getWorkloadService, type WorkloadService } from './workload.service.js';
import { buildEnvelope, toItemRef, type AnalysisEnvelope, type ItemRef, type RiskLevel } from './types.js';

export interface DeadlineItem {
    item: ItemRef;
    dueDate: string;
    dueField: string;
    daysUntilDue: number;
    workingDaysUntilDue: number;
    relative: string;
    state: string;
    stateCategory: string | null;
    remainingWorkHours: number | null;
    risk: RiskLevel;
    riskReasons: string[];
}

export interface DeadlineFacts {
    horizonDays: number;
    dueDateField: string | null;
    currentSprint: { name: string; finishDate: string | null; daysRemaining: number | null } | null;
    counts: { overdue: number; dueToday: number; dueThisWeek: number; withinHorizon: number; withoutDueDate: number };
    overdue: DeadlineItem[];
    upcoming: DeadlineItem[];
    /** Open items with no due date at all - a real gap, reported rather than guessed at. */
    itemsWithoutDueDate: ItemRef[];
}

/**
 * Deadline intelligence.
 *
 * Risk is a category, never a fabricated probability. Each rating lists the rules
 * that fired, all of which are computed from real Azure DevOps values: due date,
 * state category, remaining work, blocked signals, assignment, and the sprint's
 * remaining days.
 */
export class DeadlineService {
    constructor(
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly sprints: SprintService = getSprintService(),
        private readonly workload: WorkloadService = getWorkloadService()
    ) {}

    /**
     * Rates one item's deadline risk.
     *
     * Rules, all additive:
     *  - already past due                              -> High
     *  - not started and due within 2 working days     -> High
     *  - blocked and due within the horizon            -> High
     *  - remaining work exceeds the working hours left -> High
     *  - unassigned and due within 5 days              -> Medium (High if <= 2)
     *  - due after the sprint ends                     -> Medium
     *  - in progress with room to spare                -> Low
     */
    private rateItem(
        item: WorkItem,
        due: Date,
        options: {
            dueField: string;
            sprint: Sprint | null;
            blockedIds: Set<number>;
            overloadedAssignees: Set<string>;
            now: Date;
        }
    ): DeadlineItem {
        const { now, sprint, blockedIds, overloadedAssignees, dueField } = options;
        const daysUntil = daysBetween(now, due);
        const workingDaysUntil = daysUntil < 0 ? 0 : businessDaysBetween(now, due);
        const reasons: string[] = [];
        const risks: RiskLevel[] = [];

        const isStarted = item.stateCategory === 'InProgress';
        const isDone = item.stateCategory === 'Completed' || item.stateCategory === 'Resolved';

        if (daysUntil < 0) {
            risks.push('High Risk');
            reasons.push(`Due date passed ${Math.abs(daysUntil)} day(s) ago and the item is still ${item.state}.`);
        }
        if (!isStarted && !isDone && daysUntil >= 0 && workingDaysUntil <= 2) {
            risks.push('High Risk');
            reasons.push(`Not started (state ${item.state}) with only ${workingDaysUntil} working day(s) until the due date.`);
        }
        if (blockedIds.has(item.id)) {
            risks.push('High Risk');
            reasons.push('Item is currently blocked, so it is not progressing towards its due date.');
        }
        if (item.remainingWork !== null && workingDaysUntil >= 0) {
            // Assume a nominal 6 productive hours per working day when the team has
            // no configured capacity; stated here so the comparison is auditable.
            const availableHours = Math.max(workingDaysUntil, 0) * 6;
            if (item.remainingWork > availableHours) {
                risks.push('High Risk');
                reasons.push(
                    `${item.remainingWork}h remaining work against roughly ${availableHours}h of working time before the due date (6h/working day assumed).`
                );
            }
        }
        if (!item.assignedTo && !isDone) {
            if (daysUntil <= 2) {
                risks.push('High Risk');
                reasons.push('No assignee with the due date 2 days away or less.');
            } else if (daysUntil <= 5) {
                risks.push('Medium Risk');
                reasons.push('No assignee and the due date is within 5 days.');
            }
        }
        if (item.assignedTo && overloadedAssignees.has(item.assignedTo.toLowerCase())) {
            risks.push('Medium Risk');
            reasons.push(`Assignee ${item.assignedTo} is carrying an above-average open workload.`);
        }
        if (sprint?.finishDate) {
            const sprintEnd = parseAdoDate(sprint.finishDate);
            if (sprintEnd && startOfDay(due) > startOfDay(sprintEnd) && item.iterationPath === sprint.path) {
                risks.push('Medium Risk');
                reasons.push(`Due date falls after the end of ${sprint.name}, so the item will carry over.`);
            }
        }

        let risk: RiskLevel = 'Low Risk';
        if (risks.includes('High Risk')) risk = 'High Risk';
        else if (risks.includes('Medium Risk')) risk = 'Medium Risk';

        if (risk === 'Low Risk') {
            reasons.push(
                isStarted
                    ? `In progress with ${workingDaysUntil} working day(s) of runway.`
                    : `${workingDaysUntil} working day(s) until the due date; no risk rule triggered.`
            );
        }

        return {
            item: toItemRef(item),
            dueDate: due.toISOString(),
            dueField,
            daysUntilDue: daysUntil,
            workingDaysUntilDue: workingDaysUntil,
            relative: describeRelativeDays(due, now),
            state: item.state,
            stateCategory: item.stateCategory,
            remainingWorkHours: item.remainingWork,
            risk,
            riskReasons: reasons
        };
    }

    async getDeadlineFacts(horizonDays = 14): Promise<DeadlineFacts> {
        const horizon = Math.max(1, Math.min(horizonDays, 180));
        const now = startOfDay();
        const dueField = await this.workItems.dueDateField();

        const [openItems, overdueItems, upcomingItems, blocked, sprint] = await Promise.all([
            this.workItems.query([], { limit: 1000 }),
            this.workItems.overdue({ limit: 500 }),
            this.workItems.dueBetween(0, horizon, { limit: 500 }),
            this.workItems.blocked({ limit: 300 }).catch(() => []),
            this.sprints.getCurrentSprint().catch(() => null)
        ]);

        const blockedIds = new Set(blocked.map(item => item.id));
        const overloaded = await this.findOverloadedAssignees();

        const rate = (items: WorkItem[]): DeadlineItem[] =>
            items
                .map(item => {
                    const due = parseAdoDate(item.dueDate ?? item.targetDate);
                    if (!due) return null;
                    return this.rateItem(item, due, {
                        dueField: item.dueDate ? (dueField ?? 'DueDate') : 'TargetDate',
                        sprint,
                        blockedIds,
                        overloadedAssignees: overloaded,
                        now
                    });
                })
                .filter((entry): entry is DeadlineItem => entry !== null)
                .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

        const overdue = rate(overdueItems);
        const upcoming = rate(upcomingItems);
        const withoutDueDate = openItems.filter(item => !item.dueDate && !item.targetDate);
        const weekEndOffset = (7 - (new Date().getDay() === 0 ? 7 : new Date().getDay())) % 7;

        return {
            horizonDays: horizon,
            dueDateField: dueField,
            currentSprint: sprint
                ? { name: sprint.name, finishDate: sprint.finishDate, daysRemaining: sprint.daysRemaining }
                : null,
            counts: {
                overdue: overdue.length,
                dueToday: upcoming.filter(entry => entry.daysUntilDue === 0).length,
                dueThisWeek: upcoming.filter(entry => entry.daysUntilDue >= 0 && entry.daysUntilDue <= weekEndOffset).length,
                withinHorizon: upcoming.length,
                withoutDueDate: withoutDueDate.length
            },
            overdue,
            upcoming,
            itemsWithoutDueDate: withoutDueDate.slice(0, 50).map(toItemRef)
        };
    }

    /** Assignees holding more open items than the team average. */
    private async findOverloadedAssignees(): Promise<Set<string>> {
        const overloaded = new Set<string>();
        try {
            const facts = await this.workload.getTeamWorkloadFacts();
            const counts = facts.members.map(member => member.counts.assignedOpen);
            if (counts.length === 0) return overloaded;
            const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
            for (const member of facts.members) {
                if (member.counts.assignedOpen > mean) overloaded.add(member.member.displayName.toLowerCase());
            }
        } catch {
            // Workload data is an enrichment; deadline analysis still works without it.
        }
        return overloaded;
    }

    async analyzeDeadlineRisk(horizonDays = 14): Promise<AnalysisEnvelope<DeadlineFacts>> {
        const facts = await this.getDeadlineFacts(horizonDays);
        const observations: string[] = [];
        const concerns: string[] = [];
        const recommendations: string[] = [];

        if (facts.dueDateField === null) {
            observations.push(
                'This project process does not define DueDate, TargetDate or FinishDate, so deadline analysis has no dates to work from. Sprint end dates are the only schedule signal available.'
            );
        }

        const highRisk = [...facts.overdue, ...facts.upcoming].filter(entry => entry.risk === 'High Risk');
        const mediumRisk = facts.upcoming.filter(entry => entry.risk === 'Medium Risk');

        observations.push(
            `${facts.counts.overdue} overdue item(s), ${facts.counts.dueToday} due today, ${facts.counts.withinHorizon} due within ${facts.horizonDays} days.`
        );
        if (facts.currentSprint?.daysRemaining !== null && facts.currentSprint) {
            observations.push(`${facts.currentSprint.name} has ${facts.currentSprint.daysRemaining} day(s) remaining.`);
        }
        if (facts.counts.withoutDueDate > 0) {
            observations.push(`${facts.counts.withoutDueDate} open item(s) carry no due date, so they cannot be schedule-checked.`);
        }

        if (facts.counts.overdue > 0) {
            concerns.push(`${facts.counts.overdue} item(s) are past their due date and not yet complete.`);
            const worst = facts.overdue.slice(0, 5);
            for (const entry of worst) {
                recommendations.push(
                    `Follow up on ${entry.item.type} #${entry.item.id} "${entry.item.title}" - ${entry.relative}${
                        entry.item.assignedTo ? `, assigned to ${entry.item.assignedTo}` : ', unassigned'
                    }.`
                );
            }
        }
        if (highRisk.length > 0) {
            concerns.push(`${highRisk.length} item(s) are rated High Risk against their deadline.`);
        }
        if (mediumRisk.length > 0) {
            concerns.push(`${mediumRisk.length} upcoming item(s) are rated Medium Risk.`);
        }
        const unassignedSoon = facts.upcoming.filter(entry => !entry.item.assignedTo);
        if (unassignedSoon.length > 0) {
            recommendations.push(
                `${unassignedSoon.length} item(s) due within ${facts.horizonDays} days have no assignee; run analysis_assignment_recommendation for suggested owners.`
            );
        }

        return buildEnvelope('deadline_risk', facts, {
            observations,
            concerns,
            recommendations,
            methodology: [
                `Due dates come from ${facts.dueDateField ?? 'no available date field'}; TargetDate is used when DueDate is absent on an item.`,
                'High Risk when: the due date has passed; or the item is not started with <= 2 working days left; or the item is blocked; or booked remaining work exceeds the working hours left (6h per working day assumed); or it is unassigned with <= 2 days left.',
                'Medium Risk when: unassigned with <= 5 days left; or the assignee is above the team average open workload; or the due date falls after the current sprint ends.',
                'Low Risk when no rule above fires. These are categories, not probabilities - no statistical forecast is performed.'
            ]
        });
    }

    /** High and Medium risk items across overdue and upcoming windows. */
    async getAtRiskItems(horizonDays = 14): Promise<AnalysisEnvelope<{ horizonDays: number; highRisk: DeadlineItem[]; mediumRisk: DeadlineItem[] }>> {
        const facts = await this.getDeadlineFacts(horizonDays);
        const all = [...facts.overdue, ...facts.upcoming];
        const highRisk = all.filter(entry => entry.risk === 'High Risk');
        const mediumRisk = all.filter(entry => entry.risk === 'Medium Risk');

        return buildEnvelope(
            'at_risk_items',
            { horizonDays: facts.horizonDays, highRisk, mediumRisk },
            {
                observations: [`${highRisk.length} High Risk and ${mediumRisk.length} Medium Risk item(s) within ${facts.horizonDays} days.`],
                recommendations: highRisk
                    .slice(0, 8)
                    .map(entry => `Review #${entry.item.id} "${entry.item.title}": ${entry.riskReasons[0] ?? 'rated High Risk'}`),
                methodology: ['Same rules as analysis_deadline_risk; only High and Medium rated items are returned.']
            }
        );
    }
}

let sharedDeadlineService: DeadlineService | null = null;

export function getDeadlineService(): DeadlineService {
    sharedDeadlineService ??= new DeadlineService();
    return sharedDeadlineService;
}

export function setDeadlineServiceForTesting(service: DeadlineService | null): void {
    sharedDeadlineService = service;
}
