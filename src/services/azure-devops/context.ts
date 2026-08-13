import { getConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { TtlCache } from '../../utils/cache.js';
import { createLogger } from '../../utils/logger.js';
import { getAdoClient, type AzureDevOpsReadClient } from './client.js';
import { DEFAULT_WORK_ITEM_FIELDS, type StateCategory } from './fields.js';
import type { AdoProject, AdoTeam } from './types.js';

const log = createLogger('ado-context');

/** Cache key prefixes, so `refresh_project_context` can invalidate selectively. */
const KEY = {
    project: 'ctx:project',
    teams: 'ctx:teams',
    team: 'ctx:team',
    fields: 'ctx:fields',
    types: 'ctx:types',
    members: 'ctx:members',
    iterations: 'ctx:iterations',
    workItems: 'wi:'
} as const;

/** One process state: the name exactly as Azure DevOps spells it, plus its category. */
export interface ProcessState {
    name: string;
    category: StateCategory;
}

/**
 * Work-item type name -> lowercased state name -> state.
 * Keys are lowercased so lookups are case-insensitive; `name` preserves the
 * original spelling, which is what tools display and what queries send back.
 */
export type StateCategoryMap = Map<string, Map<string, ProcessState>>;

export interface ResolvedProjectContext {
    organization: string;
    project: { id: string; name: string; description: string | null; process: string | null; visibility: string | null };
    team: { id: string; name: string; description: string | null };
    /** Field reference names that actually exist in this project's process. */
    availableFields: Set<string>;
    /** Work-item type name -> lowercased state name -> state as Azure DevOps spells it, plus its category. */
    stateCategories: StateCategoryMap;
    workItemTypes: string[];
    resolvedAt: string;
}

/**
 * Resolves and caches the Azure DevOps context the whole server operates in.
 *
 * Nothing here is hard-coded: the project id, team id, iteration ids, field
 * catalogue and state categories are all discovered from the organization named
 * in `ADO_ORGANIZATION` / `ADO_PROJECT` / `ADO_TEAM`.
 */
export class ProjectContextService {
    readonly cache: TtlCache;

    constructor(
        private readonly client: AzureDevOpsReadClient = getAdoClient(),
        cache?: TtlCache
    ) {
        this.cache = cache ?? new TtlCache(getConfig().cacheTtlSeconds);
    }

    /** Configured defaults; Claude never needs to pass org/project/team. */
    get defaults(): { organization: string; project: string; team: string } {
        const { organization, project, team } = getConfig().ado;
        return { organization, project, team };
    }

    private assertConfigured(): void {
        if (!getConfig().ado.configured) {
            throw new AppError('ADO_NOT_CONFIGURED', 'Azure DevOps is not configured.', {
                hint: 'Set ADO_PAT in .env (a read-only personal access token for the configured organization) and restart the MCP server.'
            });
        }
    }

    async getProject(): Promise<AdoProject> {
        this.assertConfigured();
        return await this.cache.getOrLoad(KEY.project, () => this.client.getProject(this.defaults.project));
    }

    async getTeams(): Promise<AdoTeam[]> {
        const project = await this.getProject();
        return await this.cache.getOrLoad(KEY.teams, () => this.client.getTeams(project.id));
    }

    /**
     * Resolves the configured team (default `Platform`) by name, case-insensitively,
     * falling back to a direct lookup so a renamed-but-addressable team still works.
     */
    async getTeam(teamName?: string): Promise<AdoTeam> {
        const wanted = (teamName ?? this.defaults.team).trim();
        const cacheKey = `${KEY.team}:${wanted.toLowerCase()}`;
        return await this.cache.getOrLoad(cacheKey, async () => {
            const project = await this.getProject();
            const teams = await this.getTeams();
            const match =
                teams.find(team => team.name.toLowerCase() === wanted.toLowerCase()) ??
                teams.find(team => team.name.toLowerCase().includes(wanted.toLowerCase()));
            if (match) return match;

            try {
                return await this.client.getTeam(project.id, wanted);
            } catch (error) {
                const available = teams.map(team => team.name).join(', ') || '(none visible)';
                throw new AppError('NOT_FOUND', `Team "${wanted}" was not found in project ${project.name}.`, {
                    hint: `Teams visible to this PAT: ${available}. Update ADO_TEAM if the team was renamed.`,
                    cause: error
                });
            }
        });
    }

    /** Field reference names that exist in this project, used to keep queries valid. */
    async getAvailableFields(): Promise<Set<string>> {
        return await this.cache.getOrLoad(KEY.fields, async () => {
            const fields = await this.client.getFields(this.defaults.project);
            return new Set(fields.map(field => field.referenceName));
        });
    }

    /** The subset of our preferred fields that this project actually defines. */
    async getWorkItemFieldProjection(): Promise<string[]> {
        const available = await this.getAvailableFields();
        const projection = DEFAULT_WORK_ITEM_FIELDS.filter(field => available.has(field));
        return projection.length > 0 ? projection : ['System.Id', 'System.Title', 'System.State'];
    }

    async hasField(referenceName: string): Promise<boolean> {
        return (await this.getAvailableFields()).has(referenceName);
    }

    /**
     * Maps every state of every work-item type to its process state category.
     * Analysis branches on category rather than state names, so renamed states in
     * the K4K process continue to classify correctly.
     */
    async getStateCategories(): Promise<StateCategoryMap> {
        return await this.cache.getOrLoad(KEY.types, async () => {
            const types = await this.client.getWorkItemTypes(this.defaults.project);
            const result: StateCategoryMap = new Map();
            const needsStateLookup: string[] = [];

            for (const type of types) {
                const states = new Map<string, ProcessState>();
                for (const state of type.states ?? []) {
                    if (!state.name) continue;
                    states.set(state.name.toLowerCase(), { name: state.name, category: normaliseCategory(state.category) });
                }
                if (states.size === 0) needsStateLookup.push(type.name);
                result.set(type.name, states);
            }

            // Some organizations return work-item types without their inline state
            // list. Category is what all analysis branches on, so fetch it per type
            // rather than silently treating every state as Proposed.
            if (needsStateLookup.length > 0) {
                const lookups = await Promise.all(
                    needsStateLookup.map(async type => {
                        try {
                            return { type, states: await this.client.getWorkItemTypeStates(this.defaults.project, type) };
                        } catch (error) {
                            log.warn('Could not read states for a work-item type', { type, error: String(error) });
                            return { type, states: [] };
                        }
                    })
                );
                for (const lookup of lookups) {
                    const states = result.get(lookup.type) ?? new Map<string, ProcessState>();
                    for (const state of lookup.states) {
                        if (!state.name) continue;
                        states.set(state.name.toLowerCase(), {
                            name: state.name,
                            category: normaliseCategory(state.category)
                        });
                    }
                    result.set(lookup.type, states);
                }
            }

            return result;
        });
    }

    async getWorkItemTypeNames(): Promise<string[]> {
        const categories = await this.getStateCategories();
        return [...categories.keys()];
    }

    /** Resolves a state name to its category, using per-type mapping when known. */
    async categoriseState(type: string | null, state: string | null): Promise<StateCategory | null> {
        if (!state) return null;
        const categories = await this.getStateCategories();
        const lower = state.toLowerCase();
        if (type) {
            const found = categories.get(type)?.get(lower);
            if (found) return found.category;
        }
        for (const states of categories.values()) {
            const found = states.get(lower);
            if (found) return found.category;
        }
        return null;
    }

    /** Every state whose category counts as "done", spelled as Azure DevOps spells it. */
    async getCompletedStateNames(): Promise<string[]> {
        const categories = await this.getStateCategories();
        const names = new Set<string>();
        for (const states of categories.values()) {
            for (const state of states.values()) {
                if (state.category === 'Completed' || state.category === 'Resolved') names.add(state.name);
            }
        }
        return [...names];
    }

    /** Full resolved context, suitable for an overview tool or MCP resource. */
    async resolve(): Promise<ResolvedProjectContext> {
        const [project, team, availableFields, stateCategories] = await Promise.all([
            this.getProject(),
            this.getTeam(),
            this.getAvailableFields(),
            this.getStateCategories()
        ]);

        return {
            organization: this.defaults.organization,
            project: {
                id: project.id,
                name: project.name,
                description: project.description ?? null,
                process: project.capabilities?.processTemplate?.templateName ?? null,
                visibility: project.visibility ?? null
            },
            team: { id: team.id, name: team.name, description: team.description ?? null },
            availableFields,
            stateCategories,
            workItemTypes: [...stateCategories.keys()],
            resolvedAt: new Date().toISOString()
        };
    }

    /** Drops cached Azure DevOps data so the next read hits the live API. */
    refresh(scope: 'all' | 'metadata' | 'work-items' = 'all'): { cleared: number; scope: string } {
        let cleared = 0;
        if (scope === 'all') {
            cleared = this.cache.clear();
        } else if (scope === 'metadata') {
            for (const prefix of [KEY.project, KEY.teams, KEY.team, KEY.fields, KEY.types, KEY.members, KEY.iterations]) {
                cleared += this.cache.deletePrefix(prefix);
            }
        } else {
            cleared = this.cache.deletePrefix(KEY.workItems);
        }
        log.info('Project context cache refreshed', { scope, cleared });
        return { cleared, scope };
    }
}

function normaliseCategory(raw: string | undefined): StateCategory {
    switch ((raw ?? '').toLowerCase()) {
        case 'proposed':
            return 'Proposed';
        case 'inprogress':
        case 'in progress':
            return 'InProgress';
        case 'resolved':
            return 'Resolved';
        case 'completed':
            return 'Completed';
        case 'removed':
            return 'Removed';
        default:
            return 'Proposed';
    }
}

let sharedContext: ProjectContextService | null = null;

export function getProjectContext(): ProjectContextService {
    sharedContext ??= new ProjectContextService();
    return sharedContext;
}

export function setProjectContextForTesting(context: ProjectContextService | null): void {
    sharedContext = context;
}

export const CONTEXT_CACHE_KEYS = KEY;
