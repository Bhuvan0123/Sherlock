import { getConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { businessDaysBetween, daysBetween, parseAdoDate, startOfDay } from '../../utils/dates.js';
import { getAdoClient, type AzureDevOpsReadClient } from './client.js';
import { getProjectContext, type ProjectContextService } from './context.js';
import { FIELD } from './fields.js';
import { getWorkItemService, type WorkItemService } from './work-item.service.js';
import type { WorkItem } from './types.js';

export interface Sprint {
    id: string;
    name: string;
    path: string;
    startDate: string | null;
    finishDate: string | null;
    timeFrame: 'past' | 'current' | 'future' | 'unknown';
    /** Calendar days from start to finish, when both dates are set. */
    totalDays: number | null;
    daysElapsed: number | null;
    daysRemaining: number | null;
    workingDaysRemaining: number | null;
}

export interface SprintProgress {
    sprint: Sprint;
    totals: {
        items: number;
        completed: number;
        inProgress: number;
        proposed: number;
        removed: number;
        blocked: number;
        unassigned: number;
        overdue: number;
    };
    byType: Record<string, { total: number; completed: number }>;
    storyPoints: { committed: number | null; completed: number | null; remaining: number | null };
    remainingWorkHours: number | null;
    completionRate: number | null;
    /** Items whose iteration was changed into this sprint from another one. */
    carryOver: { id: number; title: string; movedFrom: string; state: string; assignedTo: string | null }[];
    carryOverAnalysis: { itemsInspected: number; itemsAvailable: number; complete: boolean };
    capacity: { member: string; capacityPerDay: number; daysOff: number }[] | null;
}

/** Number of items whose revision history is inspected for carry-over evidence. */
const CARRY_OVER_INSPECTION_LIMIT = 60;

/** Read-only access to team iterations (sprints) and sprint progress. */
export class SprintService {
    constructor(
        private readonly client: AzureDevOpsReadClient = getAdoClient(),
        private readonly context: ProjectContextService = getProjectContext(),
        private readonly workItems: WorkItemService = getWorkItemService()
    ) {}

    private get project(): string {
        return getConfig().ado.project;
    }

    private toSprint(iteration: { id: string; name: string; path: string; attributes?: { startDate?: string | null; finishDate?: string | null; timeFrame?: string } }): Sprint {
        const start = parseAdoDate(iteration.attributes?.startDate);
        const finish = parseAdoDate(iteration.attributes?.finishDate);
        const now = startOfDay();

        const timeFrameRaw = iteration.attributes?.timeFrame;
        let timeFrame: Sprint['timeFrame'] = 'unknown';
        if (timeFrameRaw === 'past' || timeFrameRaw === 'current' || timeFrameRaw === 'future') {
            timeFrame = timeFrameRaw;
        } else if (start && finish) {
            timeFrame = now < startOfDay(start) ? 'future' : now > startOfDay(finish) ? 'past' : 'current';
        }

        return {
            id: iteration.id,
            name: iteration.name,
            path: iteration.path,
            startDate: start ? start.toISOString() : null,
            finishDate: finish ? finish.toISOString() : null,
            timeFrame,
            totalDays: start && finish ? daysBetween(start, finish) + 1 : null,
            daysElapsed: start ? Math.max(daysBetween(start, now), 0) : null,
            daysRemaining: finish ? daysBetween(now, finish) : null,
            workingDaysRemaining: finish ? businessDaysBetween(now, finish) : null
        };
    }

    async getIterations(teamName?: string): Promise<Sprint[]> {
        const team = await this.context.getTeam(teamName);
        const cacheKey = `ctx:iterations:${team.id}`;
        const iterations = await this.context.cache.getOrLoad(cacheKey, () =>
            this.client.getTeamIterations(this.project, team.name)
        );
        return iterations
            .map(iteration => this.toSprint(iteration))
            .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
    }

    /** The team's current sprint, per Azure DevOps' own `current` timeframe. */
    async getCurrentSprint(teamName?: string): Promise<Sprint | null> {
        const team = await this.context.getTeam(teamName);
        const cacheKey = `ctx:iterations:current:${team.id}`;
        const current = await this.context.cache.getOrLoad(cacheKey, () =>
            this.client.getTeamIterations(this.project, team.name, 'current')
        );
        const first = current[0];
        if (first) return this.toSprint(first);

        // No iteration is marked current (dates may be unset): fall back to dates.
        const all = await this.getIterations(teamName);
        return all.find(sprint => sprint.timeFrame === 'current') ?? null;
    }

    async getUpcomingSprints(limit = 3, teamName?: string): Promise<Sprint[]> {
        const all = await this.getIterations(teamName);
        return all.filter(sprint => sprint.timeFrame === 'future').slice(0, Math.max(limit, 1));
    }

    async getPastSprints(limit = 3, teamName?: string): Promise<Sprint[]> {
        const all = await this.getIterations(teamName);
        return all.filter(sprint => sprint.timeFrame === 'past').slice(-Math.max(limit, 1)).reverse();
    }

    /**
     * Resolves a sprint reference. Accepts `current`, `next`, `previous`, an
     * iteration name, a full iteration path, or an iteration id.
     */
    async resolveSprint(reference: string, teamName?: string): Promise<Sprint> {
        const wanted = reference.trim();
        const all = await this.getIterations(teamName);

        if (/^current$/i.test(wanted) || wanted === '@currentIteration') {
            const current = await this.getCurrentSprint(teamName);
            if (current) return current;
            throw new AppError('NOT_FOUND', 'The team has no current sprint.', {
                hint: 'Iteration dates may not be set in Azure DevOps. Use ado_get_team_iterations to list iterations and pass an explicit sprint name.'
            });
        }
        if (/^next$/i.test(wanted)) {
            const [next] = await this.getUpcomingSprints(1, teamName);
            if (next) return next;
            throw new AppError('NOT_FOUND', 'There is no future sprint configured for the team.');
        }
        if (/^(previous|last)$/i.test(wanted)) {
            const [previous] = await this.getPastSprints(1, teamName);
            if (previous) return previous;
            throw new AppError('NOT_FOUND', 'There is no past sprint recorded for the team.');
        }

        const lower = wanted.toLowerCase();
        const match =
            all.find(sprint => sprint.id.toLowerCase() === lower) ??
            all.find(sprint => sprint.name.toLowerCase() === lower) ??
            all.find(sprint => sprint.path.toLowerCase() === lower) ??
            all.find(sprint => sprint.name.toLowerCase().includes(lower)) ??
            all.find(sprint => sprint.path.toLowerCase().endsWith(lower));

        if (match) return match;
        throw new AppError('NOT_FOUND', `Sprint "${wanted}" was not found for the configured team.`, {
            hint: `Known iterations: ${all.map(sprint => sprint.name).join(', ') || '(none)'}.`
        });
    }

    /** Work items assigned to a sprint, via the team's iteration work-item list. */
    async getSprintWorkItems(sprint: Sprint, options: { limit?: number } = {}): Promise<WorkItem[]> {
        return await this.workItems.byIterationPath(sprint.path, {
            includeCompleted: true,
            limit: options.limit ?? 500,
            orderBy: [{ field: FIELD.workItemType, direction: 'asc' }, { field: FIELD.state, direction: 'asc' }]
        });
    }

    /**
     * Sprint progress computed from real work-item data.
     *
     * Carry-over is evidence-based: the revision history of sprint items is
     * inspected for an actual `IterationPath` change into this sprint. Inspection
     * is bounded, and the returned `carryOverAnalysis` states whether the scan was
     * complete, so the number is never presented as more certain than it is.
     */
    async getSprintProgress(sprint: Sprint, options: { includeCarryOver?: boolean } = {}): Promise<SprintProgress> {
        const items = await this.getSprintWorkItems(sprint);
        const blocked = await this.workItems.blocked({ limit: 200 }).catch(() => []);
        const blockedIds = new Set(blocked.map(item => item.id));

        const totals = {
            items: items.length,
            completed: 0,
            inProgress: 0,
            proposed: 0,
            removed: 0,
            blocked: 0,
            unassigned: 0,
            overdue: 0
        };
        const byType: Record<string, { total: number; completed: number }> = {};
        let committedPoints = 0;
        let completedPoints = 0;
        let hasPoints = false;
        let remainingHours = 0;
        let hasRemaining = false;
        const today = startOfDay();

        for (const item of items) {
            const isDone = item.stateCategory === 'Completed' || item.stateCategory === 'Resolved';
            if (isDone) totals.completed += 1;
            else if (item.stateCategory === 'InProgress') totals.inProgress += 1;
            else if (item.stateCategory === 'Removed') totals.removed += 1;
            else totals.proposed += 1;

            if (blockedIds.has(item.id)) totals.blocked += 1;
            if (!item.assignedTo) totals.unassigned += 1;

            const due = parseAdoDate(item.dueDate ?? item.targetDate);
            if (due && !isDone && startOfDay(due) < today) totals.overdue += 1;

            const bucket = (byType[item.type] ??= { total: 0, completed: 0 });
            bucket.total += 1;
            if (isDone) bucket.completed += 1;

            const points = item.storyPoints ?? item.effort;
            if (points !== null) {
                hasPoints = true;
                committedPoints += points;
                if (isDone) completedPoints += points;
            }
            if (item.remainingWork !== null) {
                hasRemaining = true;
                if (!isDone) remainingHours += item.remainingWork;
            }
        }

        const carryOver = options.includeCarryOver === false ? [] : await this.detectCarryOver(sprint, items);
        const capacity = await this.getCapacity(sprint).catch(() => null);

        return {
            sprint,
            totals,
            byType,
            storyPoints: hasPoints
                ? {
                      committed: round(committedPoints),
                      completed: round(completedPoints),
                      remaining: round(committedPoints - completedPoints)
                  }
                : { committed: null, completed: null, remaining: null },
            remainingWorkHours: hasRemaining ? round(remainingHours) : null,
            completionRate: totals.items > 0 ? round((totals.completed / totals.items) * 100) : null,
            carryOver,
            carryOverAnalysis: {
                itemsInspected: options.includeCarryOver === false ? 0 : Math.min(items.length, CARRY_OVER_INSPECTION_LIMIT),
                itemsAvailable: items.length,
                complete: options.includeCarryOver === false ? false : items.length <= CARRY_OVER_INSPECTION_LIMIT
            },
            capacity
        };
    }

    /**
     * Finds items moved into this sprint from a different iteration, using the
     * work item's real revision history.
     */
    private async detectCarryOver(sprint: Sprint, items: WorkItem[]): Promise<SprintProgress['carryOver']> {
        const candidates = items
            .filter(item => item.stateCategory !== 'Completed' && item.stateCategory !== 'Removed')
            .slice(0, CARRY_OVER_INSPECTION_LIMIT);

        const results = await Promise.all(
            candidates.map(async item => {
                const history = await this.workItems.getHistory(item.id, 100).catch(() => []);
                for (const entry of [...history].reverse()) {
                    const change = entry.changes.find(candidate => candidate.field === 'IterationPath');
                    if (change && change.to === sprint.path && change.from && change.from !== sprint.path) {
                        return {
                            id: item.id,
                            title: item.title,
                            movedFrom: change.from,
                            state: item.state,
                            assignedTo: item.assignedTo
                        };
                    }
                }
                return null;
            })
        );

        return results.filter((entry): entry is SprintProgress['carryOver'][number] => entry !== null);
    }

    /** Configured per-member capacity for a sprint, when the team maintains it. */
    async getCapacity(sprint: Sprint, teamName?: string): Promise<SprintProgress['capacity']> {
        const team = await this.context.getTeam(teamName);
        const capacities = await this.client.getIterationCapacities(this.project, team.name, sprint.id);
        if (capacities.length === 0) return null;
        return capacities.map(entry => ({
            member: entry.teamMember?.displayName ?? entry.teamMember?.uniqueName ?? '(unknown)',
            capacityPerDay: (entry.activities ?? []).reduce((sum, activity) => sum + (activity.capacityPerDay ?? 0), 0),
            daysOff: (entry.daysOff ?? []).reduce((sum, range) => {
                const start = parseAdoDate(range.start);
                const end = parseAdoDate(range.end);
                return start && end ? sum + daysBetween(start, end) + 1 : sum;
            }, 0)
        }));
    }

    /**
     * Iteration end dates from the project's iteration tree. These are real Azure
     * DevOps iteration dates, presented as delivery milestones - the project does
     * not necessarily define separate milestone artefacts.
     */
    async getProjectMilestones(): Promise<{ name: string; path: string; startDate: string | null; finishDate: string | null; daysUntilFinish: number | null }[]> {
        const root = await this.client.getClassificationNodes(this.project, 'iterations', 5);
        const milestones: { name: string; path: string; startDate: string | null; finishDate: string | null; daysUntilFinish: number | null }[] = [];
        const now = startOfDay();

        const walk = (node: { name: string; path?: string; attributes?: { startDate?: string; finishDate?: string }; children?: unknown[] }) => {
            const start = parseAdoDate(node.attributes?.startDate);
            const finish = parseAdoDate(node.attributes?.finishDate);
            if (finish) {
                milestones.push({
                    name: node.name,
                    path: node.path ?? node.name,
                    startDate: start ? start.toISOString() : null,
                    finishDate: finish.toISOString(),
                    daysUntilFinish: daysBetween(now, finish)
                });
            }
            for (const child of (node.children ?? []) as typeof node[]) walk(child);
        };
        walk(root);

        return milestones.sort((a, b) => (a.finishDate ?? '').localeCompare(b.finishDate ?? ''));
    }
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

let sharedSprintService: SprintService | null = null;

export function getSprintService(): SprintService {
    sharedSprintService ??= new SprintService();
    return sharedSprintService;
}

export function setSprintServiceForTesting(service: SprintService | null): void {
    sharedSprintService = service;
}
