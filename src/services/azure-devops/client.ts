import { getConfig } from '../../config/env.js';
import {
    assertReadOnlyRequest,
    isAllowlistedReadOnlyPostEndpoint,
    validateWiqlQuery
} from '../../security/read-only-policy.js';
import { AppError, mapAdoHttpError, toAppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import type {
    AdoBacklogLevel,
    AdoClassificationNode,
    AdoCommentList,
    AdoField,
    AdoIteration,
    AdoIterationCapacity,
    AdoIterationWorkItems,
    AdoListResponse,
    AdoProject,
    AdoTeam,
    AdoTeamFieldValues,
    AdoTeamMember,
    AdoTeamSettings,
    AdoWiqlResult,
    AdoWorkItem,
    AdoWorkItemType,
    AdoWorkItemUpdate
} from './types.js';

const log = createLogger('ado-client');

/** Azure DevOps caps `GET /workitems?ids=` at 200 ids per request. */
const MAX_WORK_ITEM_IDS_PER_REQUEST = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_CONCURRENT_REQUESTS = 6;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Minimal concurrency gate so a broad analysis cannot flood Azure DevOps. */
class Semaphore {
    private active = 0;
    private readonly queue: (() => void)[] = [];

    constructor(private readonly limit: number) {}

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.active >= this.limit) {
            await new Promise<void>(resolve => this.queue.push(resolve));
        }
        this.active += 1;
        try {
            return await task();
        } finally {
            this.active -= 1;
            this.queue.shift()?.();
        }
    }
}

export interface AdoRequestStats {
    requests: number;
    retries: number;
    failures: number;
    lastRequestAt: string | null;
}

/**
 * ============================================================================
 * AzureDevOpsReadClient
 * ============================================================================
 *
 * The only component in this server that talks to Azure DevOps. It exposes
 * named read operations and nothing else:
 *
 *   - There is no `post`, `put`, `patch`, `delete` or generic `request` method.
 *   - There is no `createWorkItem`, `updateWorkItem` or `deleteWorkItem`.
 *   - The private transport asserts the read-only policy on every call.
 *
 * The single POST used anywhere is the WIQL query endpoint, which is a read API
 * (see `security/read-only-policy.ts` for why, and for the validation applied).
 */
export class AzureDevOpsReadClient {
    private readonly semaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);
    private readonly stats: AdoRequestStats = { requests: 0, retries: 0, failures: 0, lastRequestAt: null };
    private readonly fetchImpl: typeof fetch;

    constructor(fetchImpl: typeof fetch = fetch) {
        this.fetchImpl = fetchImpl;
    }

    // ---------------------------------------------------------------- transport

    private get config() {
        return getConfig().ado;
    }

    private authorizationHeader(): string {
        const { pat } = this.config;
        if (pat.length === 0) {
            throw new AppError('ADO_NOT_CONFIGURED', 'Azure DevOps is not configured: ADO_PAT is empty.', {
                hint: 'Add a read-only Azure DevOps personal access token to .env as ADO_PAT, then restart the MCP server.'
            });
        }
        // Azure DevOps PAT auth: basic auth with an empty username.
        return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
    }

    /**
     * Builds an absolute Azure DevOps URL and injects `api-version`.
     * `path` is relative to the organization root, for example
     * `K4K/_apis/wit/workitems`.
     */
    private buildUrl(path: string, query: Record<string, string | number | boolean | undefined> = {}, apiVersion?: string): string {
        const url = new URL(`${this.config.baseUrl}/${path.replace(/^\/+/, '')}`);
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined) continue;
            url.searchParams.set(key, String(value));
        }
        url.searchParams.set('api-version', apiVersion ?? this.config.apiVersion);
        return url.toString();
    }

    /**
     * The one and only outbound path to Azure DevOps.
     * Every call is validated by the read-only policy before a socket is opened.
     */
    private async execute<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
        assertReadOnlyRequest(method, url);
        if (method === 'POST' && !isAllowlistedReadOnlyPostEndpoint(url)) {
            // Unreachable via assertReadOnlyRequest, kept as a defence-in-depth assertion.
            throw new AppError('READ_ONLY_VIOLATION', 'Blocked a non-allowlisted Azure DevOps POST request.');
        }

        const safePath = new URL(url).pathname;
        let lastError: AppError | null = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            try {
                const response = await this.semaphore.run(() =>
                    this.fetchImpl(url, {
                        method,
                        headers: {
                            Authorization: this.authorizationHeader(),
                            Accept: 'application/json',
                            'User-Agent': 'k4k-team-lead-assistant/1.0 (read-only)',
                            ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
                        },
                        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                        redirect: 'follow'
                    })
                );
                this.stats.requests += 1;
                this.stats.lastRequestAt = new Date().toISOString();

                if (response.ok) {
                    const text = await response.text();
                    if (text.length === 0) return undefined as T;
                    try {
                        return JSON.parse(text) as T;
                    } catch {
                        // A non-JSON 200 from dev.azure.com means an auth redirect to a sign-in page.
                        throw new AppError(
                            'ADO_AUTH_FAILED',
                            'Azure DevOps authentication failed. Check the configured PAT.',
                            {
                                hint: 'The organization returned a sign-in page instead of JSON, which usually means the PAT is invalid, expired, or belongs to another organization.'
                            }
                        );
                    }
                }

                const snippet = await response.text().catch(() => '');
                const error = mapAdoHttpError(response.status, response.statusText, snippet.slice(0, 2000));
                lastError = error;

                if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
                    const retryAfter = Number(response.headers.get('retry-after'));
                    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250;
                    this.stats.retries += 1;
                    log.warn('Retrying Azure DevOps request', {
                        path: safePath,
                        status: response.status,
                        attempt,
                        delayMs
                    });
                    await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 10_000)));
                    continue;
                }

                this.stats.failures += 1;
                log.warn('Azure DevOps request failed', { path: safePath, status: response.status, code: error.code });
                throw error;
            } catch (error) {
                if (error instanceof AppError) {
                    if (lastError === error && attempt < MAX_ATTEMPTS && error.code === 'ADO_RATE_LIMITED') continue;
                    throw error;
                }
                const appError = toAppError(error, 'Could not reach Azure DevOps.');
                if (attempt < MAX_ATTEMPTS && appError.code === 'ADO_NETWORK_ERROR') {
                    this.stats.retries += 1;
                    await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 250));
                    continue;
                }
                this.stats.failures += 1;
                log.warn('Azure DevOps transport error', { path: safePath, code: appError.code });
                throw appError;
            }
        }

        throw lastError ?? new AppError('ADO_SERVER_ERROR', 'Azure DevOps request failed after retries.');
    }

    private async get<T>(
        path: string,
        query: Record<string, string | number | boolean | undefined> = {},
        apiVersion?: string
    ): Promise<T> {
        return await this.execute<T>('GET', this.buildUrl(path, query, apiVersion));
    }

    private projectPath(segment: string, project: string): string {
        return `${encodeURIComponent(project)}/${segment}`;
    }

    private teamPath(segment: string, project: string, team: string): string {
        return `${encodeURIComponent(project)}/${encodeURIComponent(team)}/${segment}`;
    }

    /** Request counters for diagnostics. Contains no credentials and no work-item data. */
    getRequestStats(): AdoRequestStats {
        return { ...this.stats };
    }

    // ------------------------------------------------------------------ project

    async getProject(project: string): Promise<AdoProject> {
        return await this.get<AdoProject>(`_apis/projects/${encodeURIComponent(project)}`, {
            includeCapabilities: true
        });
    }

    async getProjects(): Promise<AdoProject[]> {
        const response = await this.get<AdoListResponse<AdoProject>>('_apis/projects', { $top: 200 });
        return response.value ?? [];
    }

    async getProjectProcessName(project: string): Promise<string | null> {
        const detail = await this.getProject(project);
        return detail.capabilities?.processTemplate?.templateName ?? null;
    }

    // -------------------------------------------------------------------- teams

    async getTeams(projectId: string): Promise<AdoTeam[]> {
        const response = await this.get<AdoListResponse<AdoTeam>>(
            `_apis/projects/${encodeURIComponent(projectId)}/teams`,
            { $top: 200, $mine: false }
        );
        return response.value ?? [];
    }

    async getTeam(projectId: string, team: string): Promise<AdoTeam> {
        return await this.get<AdoTeam>(
            `_apis/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(team)}`
        );
    }

    async getTeamMembers(projectId: string, team: string): Promise<AdoTeamMember[]> {
        const response = await this.get<AdoListResponse<AdoTeamMember>>(
            `_apis/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(team)}/members`,
            { $top: 500 }
        );
        return response.value ?? [];
    }

    async getTeamSettings(project: string, team: string): Promise<AdoTeamSettings> {
        return await this.get<AdoTeamSettings>(this.teamPath('_apis/work/teamsettings', project, team));
    }

    async getTeamFieldValues(project: string, team: string): Promise<AdoTeamFieldValues> {
        return await this.get<AdoTeamFieldValues>(
            this.teamPath('_apis/work/teamsettings/teamfieldvalues', project, team)
        );
    }

    // --------------------------------------------------------------- iterations

    async getTeamIterations(
        project: string,
        team: string,
        timeframe?: 'current'
    ): Promise<AdoIteration[]> {
        const response = await this.get<AdoListResponse<AdoIteration>>(
            this.teamPath('_apis/work/teamsettings/iterations', project, team),
            timeframe ? { $timeframe: timeframe } : {}
        );
        return response.value ?? [];
    }

    async getTeamIteration(project: string, team: string, iterationId: string): Promise<AdoIteration> {
        return await this.get<AdoIteration>(
            this.teamPath(`_apis/work/teamsettings/iterations/${encodeURIComponent(iterationId)}`, project, team)
        );
    }

    async getIterationWorkItems(project: string, team: string, iterationId: string): Promise<AdoIterationWorkItems> {
        return await this.get<AdoIterationWorkItems>(
            this.teamPath(
                `_apis/work/teamsettings/iterations/${encodeURIComponent(iterationId)}/workitems`,
                project,
                team
            ),
            {},
            '7.1-preview.1'
        );
    }

    async getIterationCapacities(
        project: string,
        team: string,
        iterationId: string
    ): Promise<AdoIterationCapacity[]> {
        const response = await this.get<AdoListResponse<AdoIterationCapacity>>(
            this.teamPath(
                `_apis/work/teamsettings/iterations/${encodeURIComponent(iterationId)}/capacities`,
                project,
                team
            ),
            {},
            '7.1-preview.3'
        );
        return response.value ?? [];
    }

    async getClassificationNodes(
        project: string,
        structure: 'iterations' | 'areas',
        depth = 4
    ): Promise<AdoClassificationNode> {
        return await this.get<AdoClassificationNode>(
            this.projectPath(`_apis/wit/classificationnodes/${structure}`, project),
            { $depth: depth }
        );
    }

    // ----------------------------------------------------------------- backlogs

    async getBacklogs(project: string, team: string): Promise<AdoBacklogLevel[]> {
        const response = await this.get<AdoListResponse<AdoBacklogLevel>>(
            this.teamPath('_apis/work/backlogs', project, team),
            {},
            '7.1-preview.1'
        );
        return response.value ?? [];
    }

    // ---------------------------------------------------------------- metadata

    async getFields(project: string): Promise<AdoField[]> {
        const response = await this.get<AdoListResponse<AdoField>>(
            this.projectPath('_apis/wit/fields', project)
        );
        return response.value ?? [];
    }

    async getWorkItemTypes(project: string): Promise<AdoWorkItemType[]> {
        const response = await this.get<AdoListResponse<AdoWorkItemType>>(
            this.projectPath('_apis/wit/workitemtypes', project)
        );
        return response.value ?? [];
    }

    async getWorkItemTypeStates(
        project: string,
        type: string
    ): Promise<{ name: string; category?: string; color?: string }[]> {
        const response = await this.get<AdoListResponse<{ name: string; category?: string; color?: string }>>(
            this.projectPath(`_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`, project)
        );
        return response.value ?? [];
    }

    // --------------------------------------------------------------- work items

    async getWorkItem(project: string, id: number, expand: 'none' | 'relations' | 'all' = 'relations'): Promise<AdoWorkItem> {
        return await this.get<AdoWorkItem>(this.projectPath(`_apis/wit/workitems/${id}`, project), {
            $expand: expand
        });
    }

    /**
     * Batched work-item read over GET. Requests are chunked to Azure DevOps'
     * 200-id limit; `errorPolicy=omit` means a single inaccessible or deleted id
     * degrades to a missing entry instead of failing the whole batch.
     */
    async getWorkItems(
        project: string,
        ids: number[],
        options: { fields?: string[]; expandRelations?: boolean } = {}
    ): Promise<AdoWorkItem[]> {
        const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
        if (unique.length === 0) return [];

        const chunks: number[][] = [];
        for (let index = 0; index < unique.length; index += MAX_WORK_ITEM_IDS_PER_REQUEST) {
            chunks.push(unique.slice(index, index + MAX_WORK_ITEM_IDS_PER_REQUEST));
        }

        const results = await Promise.all(
            chunks.map(chunk =>
                this.get<AdoListResponse<AdoWorkItem>>(this.projectPath('_apis/wit/workitems', project), {
                    ids: chunk.join(','),
                    errorPolicy: 'omit',
                    // `fields` and `$expand` are mutually exclusive in the Azure DevOps API.
                    ...(options.expandRelations
                        ? { $expand: 'relations' }
                        : options.fields && options.fields.length > 0
                          ? { fields: options.fields.join(',') }
                          : { $expand: 'none' })
                })
            )
        );

        return results.flatMap(result => result.value ?? []).filter(item => item !== null && item !== undefined);
    }

    async getWorkItemUpdates(project: string, id: number, top = 200): Promise<AdoWorkItemUpdate[]> {
        const response = await this.get<AdoListResponse<AdoWorkItemUpdate>>(
            this.projectPath(`_apis/wit/workitems/${id}/updates`, project),
            { $top: top }
        );
        return response.value ?? [];
    }

    async getWorkItemComments(project: string, id: number, top = 100): Promise<AdoCommentList> {
        return await this.get<AdoCommentList>(
            this.projectPath(`_apis/wit/workitems/${id}/comments`, project),
            { $top: top },
            '7.1-preview.4'
        );
    }

    // ---------------------------------------------------------------------- WIQL

    /**
     * Runs a WIQL query. This is the only POST in the entire server: the Azure
     * DevOps query API accepts its read-only query language in a request body.
     * The query text is validated (SELECT-only, no mutation keywords, single
     * statement) before it leaves the process.
     */
    async queryWiql(
        project: string,
        query: string,
        options: { top?: number; timePrecision?: boolean; team?: string } = {}
    ): Promise<AdoWiqlResult> {
        validateWiqlQuery(query);
        const path =
            options.team === undefined
                ? this.projectPath('_apis/wit/wiql', project)
                : this.teamPath('_apis/wit/wiql', project, options.team);
        const url = this.buildUrl(path, {
            $top: options.top ?? 1000,
            timePrecision: options.timePrecision ?? false
        });
        return await this.execute<AdoWiqlResult>('POST', url, { query });
    }

    /** Convenience wrapper returning just the matching ids in query order. */
    async queryWorkItemIds(project: string, query: string, top?: number): Promise<number[]> {
        const result = await this.queryWiql(project, query, top === undefined ? {} : { top });
        if (result.workItems && result.workItems.length > 0) {
            return result.workItems.map(item => item.id);
        }
        if (result.workItemRelations && result.workItemRelations.length > 0) {
            const ids = new Set<number>();
            for (const relation of result.workItemRelations) {
                if (relation.target?.id) ids.add(relation.target.id);
            }
            return [...ids];
        }
        return [];
    }

    /** Browser URL for a work item, used in reports and email bodies. */
    buildWorkItemWebUrl(project: string, id: number): string {
        return `${this.config.baseUrl}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
    }
}

let sharedClient: AzureDevOpsReadClient | null = null;

export function getAdoClient(): AzureDevOpsReadClient {
    sharedClient ??= new AzureDevOpsReadClient();
    return sharedClient;
}

/** Test hook: swap in a stub client (or reset with `null`). */
export function setAdoClientForTesting(client: AzureDevOpsReadClient | null): void {
    sharedClient = client;
}
