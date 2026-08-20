/** Rate-based sprint comparison. Prefer rates over raw counts when sprint size differs. */

export interface SprintTotalsInput {
    items: number;
    completed: number;
    inProgress: number;
    proposed: number;
    blocked: number;
    overdue: number;
    carryOver: number;
}

export interface SprintRates {
    planned: number;
    completed: number;
    active: number;
    proposed: number;
    blocked: number;
    overdue: number;
    carryOver: number;
    completionRate: number | null;
    overdueRate: number | null;
    blockedRate: number | null;
    carryOverRate: number | null;
    throughput: number;
}

export interface SprintComparison {
    current: SprintRates;
    previous: SprintRates;
    completionRateChangePp: number | null;
    overdueRateChangePp: number | null;
    blockedRateChangePp: number | null;
    carryOverRateChangePp: number | null;
    throughputChange: number | null;
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

function rate(numerator: number, denominator: number): number | null {
    if (denominator <= 0) return null;
    return round1((numerator / denominator) * 100);
}

function pp(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null) return null;
    return round1(current - previous);
}

export function ratesFromTotals(totals: SprintTotalsInput): SprintRates {
    const open = Math.max(totals.items - totals.completed, 0);
    return {
        planned: totals.items,
        completed: totals.completed,
        active: totals.inProgress,
        proposed: totals.proposed,
        blocked: totals.blocked,
        overdue: totals.overdue,
        carryOver: totals.carryOver,
        completionRate: rate(totals.completed, totals.items),
        overdueRate: rate(totals.overdue, open),
        blockedRate: rate(totals.blocked, open),
        carryOverRate: rate(totals.carryOver, totals.items),
        throughput: totals.completed
    };
}

export function compareSprintRates(current: SprintRates, previous: SprintRates): SprintComparison {
    return {
        current,
        previous,
        completionRateChangePp: pp(current.completionRate, previous.completionRate),
        overdueRateChangePp: pp(current.overdueRate, previous.overdueRate),
        blockedRateChangePp: pp(current.blockedRate, previous.blockedRate),
        carryOverRateChangePp: pp(current.carryOverRate, previous.carryOverRate),
        throughputChange: current.throughput - previous.throughput
    };
}
