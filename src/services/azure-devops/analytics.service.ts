import { addDays, parseAdoDate, startOfDay } from '../../utils/dates.js';
import { FIELD } from './fields.js';
import { getProjectContext, type ProjectContextService } from './context.js';
import { getWorkItemService, type WorkItemService } from './work-item.service.js';
import type { Sprint } from './sprint.service.js';
import type { WorkItem } from './types.js';
import { wiql } from './wiql.js';

/** Bounded revision-history inspection, so a metric never costs unbounded API calls. */
const HISTORY_SAMPLE_LIMIT = 60;

export interface DeliveryMetrics {
    window: { days: number; from: string; to: string };
    completed: { items: number; byType: Record<string, number>; storyPoints: number | null };
    throughputPerWeek: number | null;
    cycleTimeDays: { measured: number; average: number | null; median: number | null; p85: number | null };
    leadTimeDays: { measured: number; average: number | null; median: number | null; p85: number | null };
    reopened: { count: number; itemsInspected: number; complete: boolean; items: { id: number; title: string; occurrences: number }[] };
    /** Explains exactly how each number was derived, so nothing looks like a black box. */
    methodology: string[];
}

export interface UnplannedWork {
    sprint: { name: string; path: string; startDate: string | null };
    items: { id: number; title: string; type: string; state: string; assignedTo: string | null; createdDate: string | null }[];
    definition: string;
}

/**
 * Delivery analytics derived entirely from Azure DevOps work-item data and
 * revision history. Every metric reports how many items it could actually measure,
 * so a partial signal is never presented as a complete one.
 */
export class AdoAnalyticsService {
    constructor(
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly context: ProjectContextService = getProjectContext()
    ) {}

    /** Items completed within the last `days`, using the process' completed states. */
    async getCompletedWork(days: number, options: { assignedTo?: string; limit?: number } = {}): Promise<WorkItem[]> {
        const completedStates = await this.context.getCompletedStateNames();
        const hasStateChange = await this.context.hasField(FIELD.stateChangeDate);
        const dateField = hasStateChange ? FIELD.stateChangeDate : FIELD.changedDate;

        return await this.workItems.query(
            [
                completedStates.length > 0 ? wiql.inList(FIELD.state, completedStates) : null,
                wiql.todayOffset(dateField, '>=', -Math.abs(days)),
                options.assignedTo ? wiql.contains(FIELD.assignedTo, options.assignedTo) : null
            ],
            { includeCompleted: true, limit: options.limit ?? 500 }
        );
    }

    async getDeliveryMetrics(days = 30): Promise<DeliveryMetrics> {
        const window = Math.max(1, Math.min(days, 365));
        const to = startOfDay();
        const from = addDays(to, -window);
        const completed = await this.getCompletedWork(window);

        const byType: Record<string, number> = {};
        let points = 0;
        let hasPoints = false;
        const cycleTimes: number[] = [];
        const leadTimes: number[] = [];

        for (const item of completed) {
            byType[item.type] = (byType[item.type] ?? 0) + 1;
            const value = item.storyPoints ?? item.effort;
            if (value !== null) {
                hasPoints = true;
                points += value;
            }

            const closed = parseAdoDate(item.closedDate ?? item.resolvedDate ?? item.stateChangeDate);
            const activated = parseAdoDate(item.activatedDate);
            const created = parseAdoDate(item.createdDate);
            if (closed && activated) {
                const cycle = diffDays(activated, closed);
                if (cycle >= 0) cycleTimes.push(cycle);
            }
            if (closed && created) {
                const lead = diffDays(created, closed);
                if (lead >= 0) leadTimes.push(lead);
            }
        }

        // Items that were completed and then reopened are usually open again now, so
        // they would be invisible if only completed work were inspected.
        const reopenedCandidates = await this.getReopenedCandidates(window);
        const inspectionSet = [...completed];
        const seen = new Set(completed.map(item => item.id));
        for (const candidate of reopenedCandidates) {
            if (!seen.has(candidate.id)) {
                inspectionSet.push(candidate);
                seen.add(candidate.id);
            }
        }
        const reopened = await this.detectReopened(inspectionSet);

        return {
            window: { days: window, from: from.toISOString(), to: to.toISOString() },
            completed: { items: completed.length, byType, storyPoints: hasPoints ? round(points) : null },
            throughputPerWeek: completed.length > 0 ? round((completed.length / window) * 7) : 0,
            cycleTimeDays: summariseDistribution(cycleTimes),
            leadTimeDays: summariseDistribution(leadTimes),
            reopened,
            methodology: [
                `Completed work: items whose state is in the project's Completed/Resolved state categories and whose ${
                    (await this.context.hasField(FIELD.stateChangeDate)) ? 'StateChangeDate' : 'ChangedDate'
                } falls in the last ${window} days.`,
                'Cycle time: days from Microsoft.VSTS.Common.ActivatedDate to ClosedDate/ResolvedDate. Only items where both dates exist are measured.',
                'Lead time: days from System.CreatedDate to ClosedDate/ResolvedDate.',
                `Reopened: work items whose revision history contains a transition out of a Completed/Resolved state back to Proposed/InProgress. Both completed work and currently-open items that were once completed are inspected. Inspection is limited to ${HISTORY_SAMPLE_LIMIT} items.`,
                'Story points: sum of StoryPoints, falling back to Effort. Null when the process does not use either field.'
            ]
        };
    }

    /**
     * Currently-open items that were in a completed state at some point, found with
     * the WIQL `EVER` operator so history is filtered server-side rather than by
     * walking every item's revisions.
     */
    private async getReopenedCandidates(days: number): Promise<WorkItem[]> {
        const completedStates = await this.context.getCompletedStateNames();
        if (completedStates.length === 0) return [];

        const everCompleted = wiql.group(wiql.or(...completedStates.map(state => wiql.ever(FIELD.state, state))));

        return await this.workItems
            .query(
                [
                    everCompleted,
                    wiql.notInList(FIELD.state, completedStates),
                    wiql.todayOffset(FIELD.changedDate, '>=', -Math.abs(days))
                ],
                { limit: HISTORY_SAMPLE_LIMIT }
            )
            .catch(() => []);
    }

    /**
     * Counts real reopen events from revision history: a transition where the
     * previous state was Completed/Resolved and the new state is not.
     */
    async detectReopened(items: WorkItem[]): Promise<DeliveryMetrics['reopened']> {
        const categories = await this.context.getStateCategories();
        const categoryOf = (type: string, state: string | null): string | null => {
            if (!state) return null;
            const lower = state.toLowerCase();
            const perType = categories.get(type)?.get(lower);
            if (perType) return perType.category;
            for (const states of categories.values()) {
                const found = states.get(lower);
                if (found) return found.category;
            }
            return null;
        };

        const sample = items.slice(0, HISTORY_SAMPLE_LIMIT);
        const results = await Promise.all(
            sample.map(async item => {
                const history = await this.workItems.getHistory(item.id, 100).catch(() => []);
                let occurrences = 0;
                for (const entry of history) {
                    const change = entry.changes.find(candidate => candidate.field === 'State');
                    if (!change) continue;
                    const fromCategory = categoryOf(item.type, change.from);
                    const toCategory = categoryOf(item.type, change.to);
                    if (
                        (fromCategory === 'Completed' || fromCategory === 'Resolved') &&
                        (toCategory === 'Proposed' || toCategory === 'InProgress')
                    ) {
                        occurrences += 1;
                    }
                }
                return occurrences > 0 ? { id: item.id, title: item.title, occurrences } : null;
            })
        );

        const reopenedItems = results.filter((entry): entry is { id: number; title: string; occurrences: number } => entry !== null);
        return {
            count: reopenedItems.reduce((sum, entry) => sum + entry.occurrences, 0),
            itemsInspected: sample.length,
            complete: sample.length === items.length,
            items: reopenedItems
        };
    }

    /**
     * Work added to a sprint after it began.
     *
     * Definition is deliberately explicit and returned with the data: items in the
     * sprint whose `System.CreatedDate` is later than the sprint start date.
     */
    async getUnplannedWork(sprint: Sprint, items: WorkItem[]): Promise<UnplannedWork> {
        const start = parseAdoDate(sprint.startDate);
        const unplanned = start
            ? items.filter(item => {
                  const created = parseAdoDate(item.createdDate);
                  return created !== null && created.getTime() > start.getTime();
              })
            : [];

        return {
            sprint: { name: sprint.name, path: sprint.path, startDate: sprint.startDate },
            items: unplanned.map(item => ({
                id: item.id,
                title: item.title,
                type: item.type,
                state: item.state,
                assignedTo: item.assignedTo,
                createdDate: item.createdDate
            })),
            definition: start
                ? `Items in ${sprint.name} created after the sprint start date (${sprint.startDate}).`
                : `${sprint.name} has no start date in Azure DevOps, so unplanned work cannot be determined.`
        };
    }
}

function diffDays(from: Date, to: Date): number {
    return round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

function percentile(sorted: number[], fraction: number): number | null {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index] ?? null;
}

function summariseDistribution(values: number[]): { measured: number; average: number | null; median: number | null; p85: number | null } {
    if (values.length === 0) return { measured: 0, average: null, median: null, p85: null };
    const sorted = [...values].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        measured: sorted.length,
        average: round(total / sorted.length),
        median: percentile(sorted, 0.5),
        p85: percentile(sorted, 0.85)
    };
}

let sharedAnalytics: AdoAnalyticsService | null = null;

export function getAdoAnalyticsService(): AdoAnalyticsService {
    sharedAnalytics ??= new AdoAnalyticsService();
    return sharedAnalytics;
}

export function setAdoAnalyticsServiceForTesting(service: AdoAnalyticsService | null): void {
    sharedAnalytics = service;
}
