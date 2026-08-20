/**
 * Canonical overdue rules. Never mix these into a single unlabeled "overdue" number.
 *
 * A. Due-date overdue — open item, DueDate < today
 * B. Planned-end overdue — open item, planned/custom end (not DueDate) < today
 * C. Sprint overdue — current sprint has already finished; item still unfinished
 * D. Historical overdue — completed item whose planned end was before ClosedDate
 */

export const OVERDUE_RULE = {
    dueDate: {
        id: 'due-date' as const,
        label: 'Overdue — Due Date',
        description: 'Open work item where Microsoft.VSTS.Scheduling.DueDate is earlier than today.'
    },
    plannedEnd: {
        id: 'planned-end' as const,
        label: 'Overdue — Planned End',
        description: 'Open work item where a planned/custom end date (not DueDate) is earlier than today.'
    },
    sprint: {
        id: 'sprint' as const,
        label: 'Overdue — Sprint',
        description: 'Work item in the current sprint that is still unfinished after the sprint finish date.'
    },
    historical: {
        id: 'historical' as const,
        label: 'Overdue — Historical',
        description: 'Closed/completed work item whose planned end date was earlier than ClosedDate.'
    }
} as const;

export type OverdueRuleId = (typeof OVERDUE_RULE)[keyof typeof OVERDUE_RULE]['id'];

export interface OverdueRuleCount {
    rule: OverdueRuleId;
    label: string;
    count: number;
    description: string;
}

export function overdueRuleCount(rule: OverdueRuleId, count: number): OverdueRuleCount {
    const def = Object.values(OVERDUE_RULE).find(entry => entry.id === rule)!;
    return { rule: def.id, label: def.label, count, description: def.description };
}
