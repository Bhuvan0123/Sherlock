import { getConfig } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { parseAdoDate } from '../utils/dates.js';
import { getAdoClient, type AzureDevOpsReadClient } from './client.js';
import { Telemetry } from '../core/telemetry.js';
import { getProjectContext, type ProjectContextService } from './context.js';
import { FIELD, RELATION, type StateCategory } from './fields.js';
import { FieldMappingService, type CanonicalFieldMap } from './field-mapping.js';
import { DEPENDENCY_WORK_ITEM_FIELDS, MINIMAL_WORK_ITEM_FIELDS } from './field-profiles.js';
import type {
    AdoComment,
    AdoIdentityRef,
    AdoWorkItem,
    AdoWorkItemRelation,
    AdoWorkItemUpdate,
    WorkItem
} from './types.js';
import { buildHierarchyQuery, buildWorkItemQuery, wiql, type WiqlCondition } from './wiql.js';

/** Short TTL for work-item queries: fresh enough for a stand-up, cheap enough to repeat. */
const WORK_ITEM_CACHE_TTL_SECONDS = 60;
const DEFAULT_QUERY_LIMIT = 200;
const MAX_QUERY_LIMIT = 1000;

export interface QueryOptions {
    limit?: number;
    includeRelations?: boolean;
    orderBy?: { field: string; direction?: 'asc' | 'desc' }[];
    /** Restrict to the configured team's area paths. Defaults to true. */
    teamScoped?: boolean;
    /** Include Removed/Closed items. Defaults to false (open work only). */
    includeCompleted?: boolean;
    /** The field profile to project (e.g. MINIMAL_WORK_ITEM_FIELDS). */
    profile?: string[];
    /** When false, skip predecessor-link scans (count-only blocked detection). Default true. */
    includeDependencyBlockers?: boolean;
}

export interface BlockedSignal {
    kind: 'state' | 'tag' | 'field' | 'board-column' | 'dependency';
    evidence: string;
}

export interface BlockedWorkItem extends WorkItem {
    blockedSignals: BlockedSignal[];
}

export interface WorkItemHistoryEntry {
    rev: number;
    revisedDate: string | null;
    revisedBy: string | null;
    changes: { field: string; from: string | null; to: string | null }[];
    relationChanges: { action: 'added' | 'removed' | 'updated'; rel: string; url: string }[];
}

export interface HierarchyNode {
    id: number;
    type: string;
    title: string;
    state: string;
    assignedTo: string | null;
    dueDate: string | null;
    webUrl: string | null;
    children: HierarchyNode[];
}

/** State names that indicate blocked work in common Azure DevOps processes. */
const BLOCKED_STATE_NAMES = ['blocked', 'on hold', 'waiting', 'impeded', 'paused'];
const BLOCKED_TAG_PATTERN = /^(blocked|blocker|impediment|impeded|on[-\s]?hold|waiting([-\s]on)?|dependency)$/i;

function identityName(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value;
    const identity = value as AdoIdentityRef;
    return identity.displayName ?? identity.uniqueName ?? identity.mailAddress ?? null;
}

function identityEmail(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value.includes('@') ? value : null;
    const identity = value as AdoIdentityRef;
    const candidate = identity.mailAddress ?? identity.uniqueName ?? null;
    return candidate && candidate.includes('@') ? candidate : null;
}

function numberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function stringOrNull(value: unknown): string | null {
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number') return String(value);
    return null;
}

function isoOrNull(value: unknown): string | null {
    const parsed = parseAdoDate(value);
    return parsed ? parsed.toISOString() : null;
}

function parseTags(value: unknown): string[] {
    if (typeof value !== 'string' || value.trim() === '') return [];
    return value
        .split(';')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
}

/** Strips HTML tags and collapses whitespace for quality checks. */
export function plainText(value: unknown): string | null {
    if (value == null) return null;
    const raw = typeof value === 'string' ? value : String(value);
    const stripped = raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
    return stripped.length > 0 ? stripped : null;
}

function collectExtraFields(fields: Record<string, unknown>): Record<string, string | number | null> {
    const extra: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(fields)) {
        const lower = key.toLowerCase();
        if (
            lower.startsWith('custom.') ||
            lower.startsWith('k4k.') ||
            lower.includes('.k4k') ||
            lower.includes('integration') ||
            (lower.includes('spirit') && !lower.startsWith('system.'))
        ) {
            if (typeof value === 'number' && Number.isFinite(value)) extra[key] = value;
            else extra[key] = stringOrNull(value);
        }
    }
    return extra;
}

/** Extracts the numeric work-item id from an Azure DevOps relation URL. */
export function relationTargetId(relation: AdoWorkItemRelation): number | null {
    const match = /\/workItems\/(\d+)(?:$|\?)/i.exec(relation.url ?? '');
    return match?.[1] ? Number(match[1]) : null;
}

export class WorkItemService {
    constructor(
        private readonly client: AzureDevOpsReadClient = getAdoClient(),
        private readonly context: ProjectContextService = getProjectContext()
    ) {}

    private get project(): string {
        return getConfig().ado.project;
    }

    // ------------------------------------------------------------- normalisation

    /** Converts a raw Azure DevOps work item into the normalised analysis shape. */
    normalise(raw: AdoWorkItem, map: CanonicalFieldMap): WorkItem {
        const fields = raw.fields ?? {};
        const get = (reference: string): unknown => fields[reference];
        
        const getMappedDate = (refs: string[]) => {
            for (const r of refs) {
                const val = isoOrNull(get(r));
                if (val) return val;
            }
            return null;
        };

        return {
            id: raw.id,
            rev: raw.rev ?? 0,
            type: stringOrNull(get(FIELD.workItemType)) ?? 'Unknown',
            title: stringOrNull(get(FIELD.title)) ?? '(untitled)',
            state: stringOrNull(get(FIELD.state)) ?? 'Unknown',
            stateCategory: null, // populated by `withStateCategories`
            reason: stringOrNull(get(FIELD.reason)),
            assignedTo: identityName(get(FIELD.assignedTo)),
            assignedToEmail: identityEmail(get(FIELD.assignedTo)),
            createdBy: identityName(get(FIELD.createdBy)),
            createdDate: isoOrNull(get(FIELD.createdDate)),
            changedBy: identityName(get(FIELD.changedBy)),
            changedDate: isoOrNull(get(FIELD.changedDate)),
            closedDate: isoOrNull(get(FIELD.closedDate)),
            activatedDate: isoOrNull(get(FIELD.activatedDate)),
            resolvedDate: isoOrNull(get(FIELD.resolvedDate)),
            stateChangeDate: isoOrNull(get(FIELD.stateChangeDate)),
            startDate: isoOrNull(get(FIELD.startDate)),
            dueDate: isoOrNull(get(FIELD.dueDate)),
            targetDate: isoOrNull(get(FIELD.targetDate)) ?? isoOrNull(get(FIELD.finishDate)),
            plannedStart: getMappedDate(map.plannedStart),
            plannedEnd: getMappedDate(map.plannedEnd),
            actualStart: getMappedDate(map.actualStart),
            actualEnd: getMappedDate(map.actualEnd),
            iterationPath: stringOrNull(get(FIELD.iterationPath)),
            areaPath: stringOrNull(get(FIELD.areaPath)),
            priority: numberOrNull(get(FIELD.priority)),
            severity: stringOrNull(get(FIELD.severity)),
            tags: parseTags(get(FIELD.tags)),
            storyPoints: numberOrNull(get(FIELD.storyPoints)),
            effort: numberOrNull(get(FIELD.effort)),
            originalEstimate: numberOrNull(get(FIELD.originalEstimate)),
            remainingWork: numberOrNull(get(FIELD.remainingWork)),
            completedWork: numberOrNull(get(FIELD.completedWork)),
            parentId: numberOrNull(get(FIELD.parent)),
            blockedField: stringOrNull(get(FIELD.blocked)),
            url: raw.url ?? null,
            webUrl: this.client.buildWorkItemWebUrl(this.project, raw.id),
            relations: raw.relations ?? [],
            description: plainText(get(FIELD.description)),
            acceptanceCriteria: plainText(get(FIELD.acceptanceCriteria)),
            reproSteps: plainText(get(FIELD.reproSteps)),
            valueArea: stringOrNull(get(FIELD.valueArea)),
            risk: stringOrNull(get(FIELD.risk)),
            businessValue: numberOrNull(get(FIELD.businessValue)),
            activity: stringOrNull(get(FIELD.activity)),
            extraFields: collectExtraFields(fields)
        };
    }

    /** Fills in `stateCategory` from the project's process definition. */
    async withStateCategories(items: WorkItem[]): Promise<WorkItem[]> {
        const categories = await this.context.getStateCategories();
        return items.map(item => {
            const perType = categories.get(item.type);
            const lower = item.state.toLowerCase();
            let category: StateCategory | null = perType?.get(lower)?.category ?? null;
            if (!category) {
                for (const states of categories.values()) {
                    const found = states.get(lower);
                    if (found) {
                        category = found.category;
                        break;
                    }
                }
            }
            return { ...item, stateCategory: category };
        });
    }

    // ------------------------------------------------------------------- reads

    async getById(id: number, options: { includeRelations?: boolean; profile?: string[] } = {}): Promise<WorkItem> {
        if (!Number.isInteger(id) || id <= 0) {
            throw new AppError('INVALID_INPUT', `"${id}" is not a valid Azure DevOps work-item id.`);
        }
        const fields = await this.context.getWorkItemFieldProjection(options.profile);
        const raw = await this.client.getWorkItem(this.project, id, options.includeRelations === false ? 'none' : 'relations', fields);
        const map = await new FieldMappingService(this.project).getCanonicalMap();
        const [item] = await this.withStateCategories([this.normalise(raw, map)]);
        if (!item) throw new AppError('NOT_FOUND', `Work item #${id} was not found.`);
        return item;
    }

    async getByIds(ids: number[], options: { includeRelations?: boolean; profile?: string[] } = {}): Promise<WorkItem[]> {
        if (ids.length === 0) return [];
        const fields = await this.context.getWorkItemFieldProjection(options.profile);
        const raw = await this.client.getWorkItems(
            this.project,
            ids,
            options.includeRelations ? { expandRelations: true, fields } : { fields }
        );
        const map = await new FieldMappingService(this.project).getCanonicalMap();
        Telemetry.recordItemsRetrieved(raw.length, fields.length);
        Telemetry.recordBodyRetrieval(raw.length);
        const normalised = await this.withStateCategories(raw.map(item => this.normalise(item, map)));
        // Preserve the requested order (WIQL relevance / sort order).
        const byId = new Map(normalised.map(item => [item.id, item]));
        return ids.map(id => byId.get(id)).filter((item): item is WorkItem => item !== undefined);
    }

    /**
     * Area-path conditions that scope a query to the configured team, using the
     * team's real team-field values from Azure DevOps rather than a guess.
     */
    async getTeamScopeCondition(): Promise<WiqlCondition | null> {
        return await this.context.cache.getOrLoad('wi:team-scope', async () => {
            const team = await this.context.getTeam();
            try {
                const values = await this.client.getTeamFieldValues(this.project, team.name);
                const field = values.field?.referenceName ?? FIELD.areaPath;
                const entries = values.values ?? [];
                if (entries.length === 0) return null;
                const clauses = entries.map(entry =>
                    entry.includeChildren ? wiql.under(field, entry.value) : wiql.eq(field, entry.value)
                );
                return wiql.or(...clauses);
            } catch {
                // Team field values require team-settings read access; degrade to
                // project-wide queries rather than failing the tool outright.
                return null;
            }
        });
    }

    /** Runs a WIQL query and returns fully populated work items. */
    async query(conditions: (WiqlCondition | null | undefined)[], options: QueryOptions = {}): Promise<WorkItem[]> {
        const limit = Math.min(Math.max(options.limit ?? DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);
        const allConditions = [...conditions];

        if (options.teamScoped !== false) {
            const scope = await this.getTeamScopeCondition();
            if (scope) allConditions.push(wiql.group(scope));
        }
        if (!options.includeCompleted) {
            allConditions.push(wiql.ne(FIELD.state, 'Removed'));
        }

        const query = buildWorkItemQuery({
            conditions: allConditions,
            ...(options.orderBy ? { orderBy: options.orderBy } : {})
        });

        const cacheKey = `wi:q:${limit}:${options.includeRelations ? 'rel' : 'flat'}:${query}`;
        return await this.context.cache.getOrLoad(
            cacheKey,
            async () => {
                const ids = await this.queryIds(conditions, options);
                return await this.getByIds(
                    ids.slice(0, limit),
                    { includeRelations: options.includeRelations, profile: options.profile }
                );
            },
            WORK_ITEM_CACHE_TTL_SECONDS
        );
    }

    /**
     * WIQL id list only — no work-item GET. Use this for counts and query links.
     */
    async queryIds(conditions: (WiqlCondition | null | undefined)[], options: QueryOptions = {}): Promise<number[]> {
        const limit = Math.min(Math.max(options.limit ?? DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);
        const allConditions = [...conditions];

        if (options.teamScoped !== false) {
            const scope = await this.getTeamScopeCondition();
            if (scope) allConditions.push(wiql.group(scope));
        }
        if (!options.includeCompleted) {
            allConditions.push(wiql.ne(FIELD.state, 'Removed'));
        }

        const query = buildWorkItemQuery({
            conditions: allConditions,
            ...(options.orderBy ? { orderBy: options.orderBy } : {})
        });

        const cacheKey = `wi:ids:${limit}:${query}`;
        const ids = await this.context.cache.getOrLoad(
            cacheKey,
            () => this.client.queryWorkItemIds(this.project, query, limit),
            WORK_ITEM_CACHE_TTL_SECONDS
        );
        Telemetry.recordIdQuery(ids.length);
        return ids;
    }

    /** WIQL match count without fetching work-item bodies. */
    async queryCount(conditions: (WiqlCondition | null | undefined)[], options: QueryOptions = {}): Promise<number> {
        const ids = await this.queryIds(conditions, options);
        Telemetry.recordAggregateQuery();
        return ids.length;
    }

    // ------------------------------------------------------------ query recipes

    async search(text: string, options: QueryOptions = {}): Promise<WorkItem[]> {
        const trimmed = text.trim();
        if (trimmed.length === 0) {
            throw new AppError('INVALID_INPUT', 'Search text must not be empty.');
        }
        // A bare number is almost always a work-item id.
        if (/^#?\d+$/.test(trimmed)) {
            const id = Number(trimmed.replace('#', ''));
            const item = await this.getById(id).catch(() => null);
            if (item) return [item];
        }
        return await this.query([wiql.contains(FIELD.title, trimmed)], {
            ...options,
            includeCompleted: options.includeCompleted ?? true
        });
    }

    async byType(type: string, options: QueryOptions = {}): Promise<WorkItem[]> {
        return await this.query([wiql.eq(FIELD.workItemType, type)], options);
    }

    async byState(state: string, options: QueryOptions = {}): Promise<WorkItem[]> {
        return await this.query([wiql.eq(FIELD.state, state)], { ...options, includeCompleted: true });
    }

    async byAssignee(member: string, options: QueryOptions = {}): Promise<WorkItem[]> {
        return await this.query([wiql.contains(FIELD.assignedTo, member)], options);
    }

    async byIterationPath(iterationPath: string, options: QueryOptions = {}): Promise<WorkItem[]> {
        return await this.query([wiql.under(FIELD.iterationPath, iterationPath)], {
            ...options,
            includeCompleted: options.includeCompleted ?? true
        });
    }

    private async notCompletedCondition(): Promise<WiqlCondition | null> {
        const completed = await this.context.getCompletedStateNames();
        return completed.length > 0 ? wiql.notInList(FIELD.state, dedupeStates(completed)) : null;
    }

    async unassignedIds(options: QueryOptions = {}): Promise<number[]> {
        return await this.queryIds([wiql.isEmpty(FIELD.assignedTo), await this.notCompletedCondition()], options);
    }

    async unassigned(options: QueryOptions = {}): Promise<WorkItem[]> {
        return await this.query(
            [wiql.isEmpty(FIELD.assignedTo), await this.notCompletedCondition()],
            options
        );
    }

    /** Priority 1-2 (Azure DevOps priority is 1 = highest). */
    async highPriorityIds(maxPriority = 2, options: QueryOptions = {}): Promise<number[]> {
        if (!(await this.context.hasField(FIELD.priority))) return [];
        return await this.queryIds(
            [wiql.lte(FIELD.priority, maxPriority), await this.notCompletedCondition()],
            { orderBy: [{ field: FIELD.priority, direction: 'asc' }], ...options }
        );
    }

    async highPriority(maxPriority = 2, options: QueryOptions = {}): Promise<WorkItem[]> {
        if (!(await this.context.hasField(FIELD.priority))) return [];
        return await this.query(
            [wiql.lte(FIELD.priority, maxPriority), await this.notCompletedCondition()],
            { orderBy: [{ field: FIELD.priority, direction: 'asc' }], ...options }
        );
    }

    async recentlyChangedIds(days = 3, options: QueryOptions = {}): Promise<number[]> {
        return await this.queryIds([wiql.todayOffset(FIELD.changedDate, '>=', -Math.abs(days))], {
            orderBy: [{ field: FIELD.changedDate, direction: 'desc' }],
            includeCompleted: true,
            ...options
        });
    }

    async recentlyChanged(days = 3, options: QueryOptions = {}): Promise<WorkItem[]> {
        return await this.query([wiql.todayOffset(FIELD.changedDate, '>=', -Math.abs(days))], {
            orderBy: [{ field: FIELD.changedDate, direction: 'desc' }],
            includeCompleted: true,
            ...options
        });
    }

    /**
     * Items with a due date in the given window. Uses `DueDate` when the process
     * defines it, otherwise falls back to `TargetDate`, and reports which field
     * was used so downstream analysis never implies a date that does not exist.
     */
    async dueDateField(): Promise<string | null> {
        if (await this.context.hasField(FIELD.dueDate)) return FIELD.dueDate;
        if (await this.context.hasField(FIELD.targetDate)) return FIELD.targetDate;
        if (await this.context.hasField(FIELD.finishDate)) return FIELD.finishDate;
        return null;
    }

    async dueBetweenIds(fromDays: number, toDays: number, options: QueryOptions = {}): Promise<number[]> {
        const field = await this.dueDateField();
        if (!field) return [];
        return await this.queryIds(
            [
                wiql.todayOffset(field, '>=', fromDays),
                wiql.todayOffset(field, '<=', toDays),
                await this.notCompletedCondition()
            ],
            { orderBy: [{ field, direction: 'asc' }], ...options }
        );
    }

    async dueBetween(fromDays: number, toDays: number, options: QueryOptions = {}): Promise<WorkItem[]> {
        const field = await this.dueDateField();
        if (!field) return [];
        return await this.query(
            [
                wiql.todayOffset(field, '>=', fromDays),
                wiql.todayOffset(field, '<=', toDays),
                await this.notCompletedCondition()
            ],
            { orderBy: [{ field, direction: 'asc' }], ...options }
        );
    }

    async dueToday(options: QueryOptions = {}): Promise<WorkItem[]> {
        return await this.dueBetween(0, 0, options);
    }

    async dueThisWeek(options: QueryOptions = {}): Promise<WorkItem[]> {
        const today = new Date();
        // Remaining days until Sunday, so "this week" means the current calendar week.
        const daysToWeekEnd = (7 - (today.getDay() === 0 ? 7 : today.getDay())) % 7;
        return await this.dueBetween(0, daysToWeekEnd, options);
    }

    /** Open items with the process due-date field earlier than today. Rule A. */
    async overdueDueDateIds(options: QueryOptions = {}): Promise<number[]> {
        const field = await this.dueDateField();
        if (!field) return [];
        return await this.queryIds(
            [wiql.todayOffset(field, '<', 0), wiql.isNotEmpty(field), await this.notCompletedCondition()],
            { orderBy: [{ field, direction: 'asc' }], ...options }
        );
    }

    async overdue(options: QueryOptions = {}): Promise<WorkItem[]> {
        const field = await this.dueDateField();
        if (!field) return [];
        return await this.query(
            [wiql.todayOffset(field, '<', 0), wiql.isNotEmpty(field), await this.notCompletedCondition()],
            { orderBy: [{ field, direction: 'asc' }], ...options }
        );
    }

    async missingDueDateIds(options: QueryOptions = {}): Promise<number[]> {
        const field = await this.dueDateField();
        if (!field) return [];
        return await this.queryIds([wiql.isEmpty(field), await this.notCompletedCondition()], options);
    }

    async plannedEndOverdueIds(options: QueryOptions = {}): Promise<number[]> {
        const map = await new FieldMappingService(this.project).getCanonicalMap();
        const fields = [...new Set(map.plannedEnd.filter(ref => ref !== FIELD.dueDate))];
        if (fields.length === 0) return [];
        const clauses = fields.map(field =>
            wiql.group(wiql.and(wiql.isNotEmpty(field), wiql.todayOffset(field, '<', 0)))
        );
        return await this.queryIds([wiql.or(...clauses), await this.notCompletedCondition()], options);
    }

    async historicalOverdueIds(options: QueryOptions = {}): Promise<number[]> {
        const map = await new FieldMappingService(this.project).getCanonicalMap();
        const planned = map.plannedEnd.find(ref => ref !== FIELD.dueDate) ?? map.plannedEnd[0];
        if (!planned || !(await this.context.hasField(FIELD.closedDate))) return [];
        const completed = await this.context.getCompletedStateNames();
        if (completed.length === 0) return [];
        return await this.queryIds(
            [
                wiql.inList(FIELD.state, dedupeStates(completed)),
                wiql.isNotEmpty(planned),
                wiql.isNotEmpty(FIELD.closedDate)
            ],
            { ...options, includeCompleted: true, limit: options.limit ?? 200 }
        );
    }

    // --------------------------------------------------------- blocked analysis

    /**
     * Detects blocked work from evidence that actually exists on the item.
     *
     * Azure DevOps has no universal "blocked" field, so this checks the four
     * signals that real processes use, and returns the evidence for each match so
     * the Team Lead can see exactly why an item was flagged. Nothing is inferred
     * beyond these signals.
     */
    detectBlockedSignals(item: WorkItem): BlockedSignal[] {
        const signals: BlockedSignal[] = [];

        if (BLOCKED_STATE_NAMES.includes(item.state.toLowerCase())) {
            signals.push({ kind: 'state', evidence: `State is "${item.state}"` });
        }
        if (item.blockedField && /^(yes|true|1)$/i.test(item.blockedField.trim())) {
            signals.push({ kind: 'field', evidence: `Field ${FIELD.blocked} = "${item.blockedField}"` });
        }
        for (const tag of item.tags) {
            if (BLOCKED_TAG_PATTERN.test(tag)) {
                signals.push({ kind: 'tag', evidence: `Tagged "${tag}"` });
            }
        }
        return signals;
    }

    async blockedSignalCondition(): Promise<WiqlCondition> {
        const hasBlockedField = await this.context.hasField(FIELD.blocked);
        return wiql.or(
            wiql.inList(FIELD.state, ['Blocked', 'On Hold']),
            wiql.contains(FIELD.tags, 'Blocked'),
            wiql.contains(FIELD.tags, 'Impediment'),
            wiql.contains(FIELD.tags, 'Waiting'),
            hasBlockedField ? wiql.eq(FIELD.blocked, 'Yes') : null
        );
    }

    /** WIQL candidate ids for tag/state/field blocked signals. Does not scan predecessor links. */
    async blockedSignalIds(options: QueryOptions = {}): Promise<number[]> {
        return await this.queryIds(
            [wiql.group(await this.blockedSignalCondition()), await this.notCompletedCondition()],
            options
        );
    }

    /**
     * Finds blocked work items. Candidates are gathered with a WIQL query over the
     * signals that are queryable in this project, then confirmed by
     * `detectBlockedSignals`, and optionally enriched with unfinished-predecessor
     * evidence from real Azure DevOps dependency links.
     */
    async blocked(options: QueryOptions = {}): Promise<BlockedWorkItem[]> {
        const includeDeps = options.includeDependencyBlockers !== false;
        const ids = await this.blockedSignalIds(options);
        const candidates = await this.getByIds(ids, {
            includeRelations: includeDeps,
            profile: options.profile ?? DEPENDENCY_WORK_ITEM_FIELDS
        });

        const flagged: BlockedWorkItem[] = [];
        for (const item of candidates) {
            const signals = this.detectBlockedSignals(item);
            if (signals.length > 0) flagged.push({ ...item, blockedSignals: signals });
        }

        if (!includeDeps) return flagged;

        const dependencyBlocked = await this.findDependencyBlocked({
            ...options,
            limit: Math.min(options.limit ?? 50, 80)
        });
        const seen = new Set(flagged.map(item => item.id));
        for (const item of dependencyBlocked) {
            if (seen.has(item.id)) {
                const existing = flagged.find(entry => entry.id === item.id);
                existing?.blockedSignals.push(...item.blockedSignals);
                continue;
            }
            flagged.push(item);
            seen.add(item.id);
        }

        return flagged;
    }

    /**
     * Items with a `Predecessor` link whose predecessor is not yet complete.
     * Uses real Azure DevOps relation data; no dependency is invented.
     */
    async findDependencyBlocked(options: QueryOptions = {}): Promise<BlockedWorkItem[]> {
        const completed = new Set((await this.context.getCompletedStateNames()).map(state => state.toLowerCase()));
        const active = await this.query([wiql.isNotEmpty(FIELD.title)], {
            ...options,
            includeRelations: true,
            profile: options.profile ?? DEPENDENCY_WORK_ITEM_FIELDS,
            limit: Math.min(options.limit ?? 50, 80)
        });

        const withPredecessors = active.filter(item =>
            item.relations.some(relation => relation.rel === RELATION.predecessor)
        );
        if (withPredecessors.length === 0) return [];

        const predecessorIds = new Set<number>();
        for (const item of withPredecessors) {
            for (const relation of item.relations) {
                if (relation.rel !== RELATION.predecessor) continue;
                const id = relationTargetId(relation);
                if (id) predecessorIds.add(id);
            }
        }

        const predecessors = await this.getByIds([...predecessorIds], { profile: MINIMAL_WORK_ITEM_FIELDS });
        const predecessorById = new Map(predecessors.map(item => [item.id, item]));

        const result: BlockedWorkItem[] = [];
        for (const item of withPredecessors) {
            const signals: BlockedSignal[] = [];
            for (const relation of item.relations) {
                if (relation.rel !== RELATION.predecessor) continue;
                const id = relationTargetId(relation);
                if (!id) continue;
                const predecessor = predecessorById.get(id);
                if (!predecessor) continue;
                const isDone =
                    predecessor.stateCategory === 'Completed' ||
                    predecessor.stateCategory === 'Resolved' ||
                    completed.has(predecessor.state.toLowerCase());
                if (!isDone) {
                    signals.push({
                        kind: 'dependency',
                        evidence: `Waiting on predecessor #${predecessor.id} "${predecessor.title}" (state: ${predecessor.state})`
                    });
                }
            }
            if (signals.length > 0) result.push({ ...item, blockedSignals: signals });
        }
        return result;
    }

    // -------------------------------------------------------- history, comments

    async getHistory(id: number, limit = 50): Promise<WorkItemHistoryEntry[]> {
        const updates = await this.client.getWorkItemUpdates(this.project, id, Math.min(Math.max(limit, 1), 200));
        return updates
            .map(update => this.normaliseUpdate(update))
            .filter(entry => entry.changes.length > 0 || entry.relationChanges.length > 0)
            .reverse();
    }

    private normaliseUpdate(update: AdoWorkItemUpdate): WorkItemHistoryEntry {
        const interesting = new Set<string>([
            FIELD.state,
            FIELD.assignedTo,
            FIELD.priority,
            FIELD.severity,
            FIELD.iterationPath,
            FIELD.areaPath,
            FIELD.title,
            FIELD.tags,
            FIELD.dueDate,
            FIELD.targetDate,
            FIELD.remainingWork,
            FIELD.completedWork,
            FIELD.storyPoints,
            FIELD.effort,
            FIELD.reason,
            FIELD.blocked,
            FIELD.parent,
            FIELD.boardColumn
        ]);

        const changes: WorkItemHistoryEntry['changes'] = [];
        for (const [field, change] of Object.entries(update.fields ?? {})) {
            if (!interesting.has(field)) continue;
            const from = identityName(change.oldValue) ?? stringOrNull(change.oldValue);
            const to = identityName(change.newValue) ?? stringOrNull(change.newValue);
            if (from === to) continue;
            changes.push({ field: shortFieldName(field), from, to });
        }

        const relationChanges: WorkItemHistoryEntry['relationChanges'] = [];
        for (const action of ['added', 'removed', 'updated'] as const) {
            for (const relation of update.relations?.[action] ?? []) {
                relationChanges.push({ action, rel: relation.rel, url: relation.url });
            }
        }

        return {
            rev: update.rev,
            revisedDate: isoOrNull(update.revisedDate),
            revisedBy: identityName(update.revisedBy),
            changes,
            relationChanges
        };
    }

    async getComments(
        id: number,
        limit = 50
    ): Promise<{ total: number; comments: { id: number; author: string | null; createdDate: string | null; text: string }[] }> {
        const list = await this.client.getWorkItemComments(this.project, id, Math.min(Math.max(limit, 1), 200));
        return {
            total: list.totalCount ?? list.comments?.length ?? 0,
            comments: (list.comments ?? []).map((comment: AdoComment) => ({
                id: comment.id,
                author: identityName(comment.createdBy),
                createdDate: isoOrNull(comment.createdDate),
                text: stripHtml(comment.text ?? '')
            }))
        };
    }

    // -------------------------------------------------------------- relations

    /** Resolves every relation of an item into real linked work items. */
    async getRelatedItems(id: number): Promise<{
        item: WorkItem;
        related: { relation: string; rel: string; comment: string | null; item: WorkItem }[];
        nonWorkItemLinks: { rel: string; url: string; comment: string | null }[];
    }> {
        const item = await this.getById(id, { includeRelations: true });
        const linkedIds: { id: number; rel: string; comment: string | null }[] = [];
        const nonWorkItemLinks: { rel: string; url: string; comment: string | null }[] = [];

        for (const relation of item.relations) {
            const targetId = relationTargetId(relation);
            if (targetId) {
                linkedIds.push({ id: targetId, rel: relation.rel, comment: relation.attributes?.comment ?? null });
            } else {
                nonWorkItemLinks.push({
                    rel: relation.rel,
                    url: relation.url,
                    comment: relation.attributes?.comment ?? null
                });
            }
        }

        const linked = await this.getByIds(linkedIds.map(entry => entry.id));
        const byId = new Map(linked.map(entry => [entry.id, entry]));

        const related = linkedIds
            .map(entry => {
                const target = byId.get(entry.id);
                return target ? { relation: entry.rel, rel: entry.rel, comment: entry.comment, item: target } : null;
            })
            .filter((entry): entry is { relation: string; rel: string; comment: string | null; item: WorkItem } => entry !== null);

        return { item, related, nonWorkItemLinks };
    }

    async getParent(id: number): Promise<WorkItem | null> {
        const item = await this.getById(id, { includeRelations: true });
        const parentRelation = item.relations.find(relation => relation.rel === RELATION.parent);
        const parentId = item.parentId ?? (parentRelation ? relationTargetId(parentRelation) : null);
        if (!parentId) return null;
        return await this.getById(parentId);
    }

    async getChildren(id: number): Promise<WorkItem[]> {
        const item = await this.getById(id, { includeRelations: true });
        const childIds = item.relations
            .filter(relation => relation.rel === RELATION.child)
            .map(relation => relationTargetId(relation))
            .filter((childId): childId is number => childId !== null);
        return await this.getByIds(childIds);
    }

    /**
     * Full descendant tree for a work item, built from real Azure DevOps
     * hierarchy links via a recursive WorkItemLinks query.
     */
    async getHierarchy(id: number, maxDepth = 5): Promise<{ root: HierarchyNode; totalItems: number; maxDepthReached: number }> {
        const query = buildHierarchyQuery(id, 'forward');
        const result = await this.client.queryWiql(this.project, query, { top: 1000 });

        const edges: { parent: number | null; child: number }[] = [];
        const ids = new Set<number>([id]);
        for (const relation of result.workItemRelations ?? []) {
            const child = relation.target?.id;
            if (!child) continue;
            ids.add(child);
            const parent = relation.source?.id ?? null;
            if (parent !== null) ids.add(parent);
            if (parent !== child) edges.push({ parent, child });
        }

        const items = await this.getByIds([...ids]);
        const byId = new Map(items.map(item => [item.id, item]));
        if (!byId.has(id)) {
            throw new AppError('NOT_FOUND', `Work item #${id} was not found, so its hierarchy cannot be built.`);
        }

        const childrenByParent = new Map<number, number[]>();
        for (const edge of edges) {
            if (edge.parent === null) continue;
            const bucket = childrenByParent.get(edge.parent) ?? [];
            if (!bucket.includes(edge.child)) bucket.push(edge.child);
            childrenByParent.set(edge.parent, bucket);
        }

        let totalItems = 0;
        let maxDepthReached = 0;
        const visited = new Set<number>();

        const build = (nodeId: number, depth: number): HierarchyNode | null => {
            const item = byId.get(nodeId);
            if (!item || visited.has(nodeId)) return null;
            visited.add(nodeId);
            totalItems += 1;
            maxDepthReached = Math.max(maxDepthReached, depth);

            const children =
                depth >= maxDepth
                    ? []
                    : (childrenByParent.get(nodeId) ?? [])
                          .map(childId => build(childId, depth + 1))
                          .filter((node): node is HierarchyNode => node !== null);

            return {
                id: item.id,
                type: item.type,
                title: item.title,
                state: item.state,
                assignedTo: item.assignedTo,
                dueDate: item.dueDate,
                webUrl: item.webUrl,
                children
            };
        };

        const root = build(id, 0);
        if (!root) throw new AppError('NOT_FOUND', `Work item #${id} could not be read.`);
        return { root, totalItems, maxDepthReached };
    }
}

function dedupeStates(states: string[]): string[] {
    const seen = new Map<string, string>();
    for (const state of states) {
        const key = state.toLowerCase();
        if (!seen.has(key)) seen.set(key, state);
    }
    return [...seen.values()];
}

function shortFieldName(reference: string): string {
    const parts = reference.split('.');
    return parts[parts.length - 1] ?? reference;
}

/** Work-item comments are HTML; reduce to readable text for reports and emails. */
export function stripHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
        .replace(/<li>/gi, '- ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

let sharedWorkItemService: WorkItemService | null = null;

export function getWorkItemService(): WorkItemService {
    sharedWorkItemService ??= new WorkItemService();
    return sharedWorkItemService;
}

export function setWorkItemServiceForTesting(service: WorkItemService | null): void {
    sharedWorkItemService = service;
}
