/**
 * A fake Azure DevOps HTTP layer for tests.
 *
 * This is NOT mock data served to the Team Lead: the server itself never
 * fabricates Azure DevOps data. It is a stand-in for the Azure DevOps REST API
 * inside the test process, so the real client, WIQL builder, services and
 * analysis code can be exercised deterministically without a live organization
 * or a PAT. The payload shapes mirror the documented Azure DevOps 7.1 responses.
 *
 * Live verification against the real KEBS4KAAR / K4K / Platform project is a
 * separate, explicitly-run script (`npm run verify:live`).
 */
import { FIELD, RELATION } from '../../src/azure-devops/fields.js';

export interface FixtureWorkItem {
    id: number;
    type: string;
    title: string;
    state: string;
    assignedTo?: string | null;
    iterationPath?: string;
    areaPath?: string;
    tags?: string;
    priority?: number;
    dueDate?: string;
    storyPoints?: number;
    remainingWork?: number;
    completedWork?: number;
    createdDate?: string;
    changedDate?: string;
    closedDate?: string;
    blocked?: string;
    parentId?: number;
    childIds?: number[];
    predecessorIds?: number[];
    successorIds?: number[];
    relatedIds?: number[];
    updates?: FixtureUpdate[];
    comments?: { text: string; author: string; createdDate: string }[];
}

export interface FixtureUpdate {
    rev: number;
    revisedDate: string;
    changedBy: string;
    fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
}

export interface AdoFixtureOptions {
    organization?: string;
    project?: string;
    team?: string;
    workItems?: FixtureWorkItem[];
    members?: { id: string; displayName: string; uniqueName: string }[];
    teams?: { id: string; name: string }[];
    iterations?: {
        id: string;
        name: string;
        path: string;
        startDate?: string;
        finishDate?: string;
        timeFrame: 'past' | 'current' | 'future';
    }[];
    /** Status codes to return for the next matching request, keyed by URL fragment. */
    failures?: { fragment: string; status: number; body?: string; times?: number }[];
}

export interface RecordedRequest {
    method: string;
    url: string;
    path: string;
    body?: unknown;
    hadAuthorizationHeader: boolean;
}

const DAY_MS = 86_400_000;

function iso(offsetDays: number): string {
    return new Date(Date.now() + offsetDays * DAY_MS).toISOString();
}

function identity(displayName: string, uniqueName?: string) {
    return {
        id: `id-${displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        displayName,
        uniqueName: uniqueName ?? `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@kaartech.com`
    };
}

/** A small but realistic Platform-team dataset: an epic tree, overdue, blocked and unassigned work. */
export function defaultFixtureWorkItems(): FixtureWorkItem[] {
    return [
        {
            id: 1000,
            type: 'Epic',
            title: 'Platform reliability programme',
            state: 'Active',
            assignedTo: 'Priya Menon',
            iterationPath: 'K4K',
            childIds: [1100, 1200]
        },
        {
            id: 1100,
            type: 'Feature',
            title: 'Observability pipeline',
            state: 'Active',
            assignedTo: 'Priya Menon',
            iterationPath: 'K4K\\Sprint 12',
            parentId: 1000,
            childIds: [1110, 1120]
        },
        {
            id: 1110,
            type: 'User Story',
            title: 'Structured logging for the ingestion service',
            state: 'Active',
            assignedTo: 'Arun Kumar',
            iterationPath: 'K4K\\Sprint 12',
            storyPoints: 5,
            priority: 2,
            parentId: 1100,
            childIds: [1111, 1112]
        },
        {
            id: 1111,
            type: 'Task',
            title: 'Emit correlation ids from the gateway',
            state: 'Active',
            assignedTo: 'Arun Kumar',
            iterationPath: 'K4K\\Sprint 12',
            remainingWork: 6,
            completedWork: 4,
            priority: 2,
            dueDate: iso(-3),
            parentId: 1110,
            changedDate: iso(-1)
        },
        {
            id: 1112,
            type: 'Task',
            title: 'Ship log schema documentation',
            state: 'New',
            assignedTo: 'Arun Kumar',
            iterationPath: 'K4K\\Sprint 12',
            remainingWork: 8,
            priority: 3,
            dueDate: iso(2),
            parentId: 1110,
            predecessorIds: [1120]
        },
        {
            id: 1120,
            type: 'User Story',
            title: 'Metrics export to the shared dashboard',
            state: 'Active',
            assignedTo: 'Divya Raman',
            iterationPath: 'K4K\\Sprint 12',
            storyPoints: 8,
            priority: 1,
            tags: 'blocked; integration',
            blocked: 'Yes',
            parentId: 1100,
            successorIds: [1112],
            changedDate: iso(-9)
        },
        {
            id: 1200,
            type: 'Feature',
            title: 'Deployment automation',
            state: 'New',
            assignedTo: null,
            iterationPath: 'K4K\\Sprint 13',
            priority: 1,
            parentId: 1000,
            childIds: [1210]
        },
        {
            id: 1210,
            type: 'Task',
            title: 'Blue/green rollout script',
            state: 'New',
            assignedTo: null,
            iterationPath: 'K4K\\Sprint 13',
            remainingWork: 12,
            priority: 1,
            dueDate: iso(9)
        },
        {
            id: 1300,
            type: 'Bug',
            title: 'Ingestion retries drop the tenant header',
            state: 'Active',
            assignedTo: 'Arun Kumar',
            iterationPath: 'K4K\\Sprint 12',
            priority: 1,
            remainingWork: 4,
            dueDate: iso(0),
            areaPath: 'K4K\\Platform',
            changedDate: iso(0),
            updates: [
                { rev: 1, revisedDate: iso(-14), changedBy: 'Arun Kumar', fields: { [FIELD.state]: { newValue: 'New' } } },
                {
                    rev: 2,
                    revisedDate: iso(-10),
                    changedBy: 'Arun Kumar',
                    fields: { [FIELD.state]: { oldValue: 'New', newValue: 'Active' } }
                },
                {
                    rev: 3,
                    revisedDate: iso(-6),
                    changedBy: 'Priya Menon',
                    fields: {
                        [FIELD.state]: { oldValue: 'Active', newValue: 'Closed' },
                        [FIELD.iterationPath]: { oldValue: 'K4K\\Sprint 11', newValue: 'K4K\\Sprint 12' }
                    }
                },
                {
                    rev: 4,
                    revisedDate: iso(-2),
                    changedBy: 'Priya Menon',
                    fields: { [FIELD.state]: { oldValue: 'Closed', newValue: 'Active' } }
                }
            ],
            comments: [
                { text: '<div>Reproduced on the staging tenant.</div>', author: 'Arun Kumar', createdDate: iso(-5) }
            ]
        },
        {
            id: 1400,
            type: 'Task',
            title: 'Rotate ingestion service certificates',
            state: 'Closed',
            assignedTo: 'Divya Raman',
            iterationPath: 'K4K\\Sprint 11',
            remainingWork: 0,
            completedWork: 5,
            closedDate: iso(-8),
            createdDate: iso(-20),
            changedDate: iso(-8)
        },
        {
            id: 1401,
            type: 'User Story',
            title: 'Alert routing for on-call',
            state: 'Closed',
            assignedTo: 'Arun Kumar',
            iterationPath: 'K4K\\Sprint 11',
            storyPoints: 3,
            closedDate: iso(-12),
            createdDate: iso(-30),
            changedDate: iso(-12)
        },
        {
            id: 1402,
            type: 'Bug',
            title: 'Dashboard shows stale sprint burndown',
            state: 'Closed',
            assignedTo: 'Divya Raman',
            iterationPath: 'K4K\\Sprint 11',
            closedDate: iso(-15),
            createdDate: iso(-25),
            changedDate: iso(-15)
        }
    ];
}

const STATE_CATEGORY: Record<string, string> = {
    New: 'Proposed',
    Approved: 'Proposed',
    Active: 'InProgress',
    Committed: 'InProgress',
    Resolved: 'Resolved',
    Closed: 'Completed',
    Done: 'Completed',
    Removed: 'Removed'
};

/**
 * Builds a `fetch`-compatible function that answers Azure DevOps REST calls from
 * the fixture, plus the list of requests it received (for assertions such as
 * "only GET was used").
 */
export function createAdoFixture(options: AdoFixtureOptions = {}): {
    fetchImpl: typeof fetch;
    requests: RecordedRequest[];
    workItems: FixtureWorkItem[];
} {
    const project = options.project ?? 'K4K';
    const team = options.team ?? 'Platform';
    const workItems = options.workItems ?? defaultFixtureWorkItems();
    const members = options.members ?? [
        identity('Arun Kumar'),
        identity('Divya Raman'),
        identity('Priya Menon'),
        identity('Karthik Nair')
    ];
    const teams = options.teams ?? [
        { id: 'team-platform', name: team },
        { id: 'team-experience', name: 'Experience' }
    ];
    const iterations =
        options.iterations ??
        [
            {
                id: 'iter-11',
                name: 'Sprint 11',
                path: `${project}\\Sprint 11`,
                startDate: iso(-28),
                finishDate: iso(-14),
                timeFrame: 'past' as const
            },
            {
                id: 'iter-12',
                name: 'Sprint 12',
                path: `${project}\\Sprint 12`,
                startDate: iso(-7),
                finishDate: iso(7),
                timeFrame: 'current' as const
            },
            {
                id: 'iter-13',
                name: 'Sprint 13',
                path: `${project}\\Sprint 13`,
                startDate: iso(8),
                finishDate: iso(22),
                timeFrame: 'future' as const
            }
        ];

    const failures = (options.failures ?? []).map(failure => ({ ...failure, remaining: failure.times ?? 1 }));
    const requests: RecordedRequest[] = [];
    const byId = new Map(workItems.map(item => [item.id, item]));

    const json = (payload: unknown, status = 200): Response =>
        new Response(JSON.stringify(payload), {
            status,
            headers: { 'content-type': 'application/json' }
        });

    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        const parsed = new URL(url);
        const path = decodeURIComponent(parsed.pathname);
        const query = parsed.searchParams;
        const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));

        requests.push({
            method,
            url,
            path,
            body,
            hadAuthorizationHeader: headers.has('authorization')
        });

        for (const failure of failures) {
            if (failure.remaining > 0 && path.toLowerCase().includes(failure.fragment.toLowerCase())) {
                failure.remaining -= 1;
                return new Response(failure.body ?? JSON.stringify({ message: 'Injected failure' }), {
                    status: failure.status,
                    headers: { 'content-type': 'application/json', 'retry-after': '0' }
                });
            }
        }

        // --------------------------------------------------------------- projects
        if (/\/_apis\/projects\/[^/]+$/.test(path)) {
            return json({
                id: 'project-k4k',
                name: project,
                description: 'K4K platform delivery',
                state: 'wellFormed',
                visibility: 'private',
                revision: 42,
                lastUpdateTime: iso(-1),
                url: `https://dev.azure.com/org/_apis/projects/project-k4k`,
                capabilities: { processTemplate: { templateName: 'Agile', templateTypeId: 'agile-id' }, versioncontrol: { sourceControlType: 'Git' } }
            });
        }
        if (path.endsWith('/_apis/projects')) {
            return json({ count: 1, value: [{ id: 'project-k4k', name: project, state: 'wellFormed' }] });
        }

        // ------------------------------------------------------------------ teams
        if (/\/teams\/[^/]+\/members$/.test(path)) {
            const teamSegment = (path.split('/teams/')[1]?.split('/')[0] ?? '').toLowerCase();
            const configured = teams.find(candidate => candidate.name.toLowerCase() === team.toLowerCase());
            const isConfiguredTeam =
                teamSegment === team.toLowerCase() || teamSegment === configured?.id.toLowerCase();
            const pool = isConfiguredTeam ? members : members.slice(0, 2);
            return json({
                count: pool.length,
                value: pool.map(member => ({ identity: { ...member, descriptor: `aad.${member.id}` }, isTeamAdmin: member.displayName === 'Priya Menon' }))
            });
        }
        if (/\/teams\/[^/]+$/.test(path)) {
            const requested = path.split('/teams/')[1] ?? '';
            const match = teams.find(
                candidate => candidate.name.toLowerCase() === requested.toLowerCase() || candidate.id === requested
            );
            if (!match) return json({ message: 'Team not found' }, 404);
            return json({ id: match.id, name: match.name, description: `${match.name} team`, projectName: project });
        }
        if (path.endsWith('/teams')) {
            return json({
                count: teams.length,
                value: teams.map(candidate => ({ ...candidate, description: `${candidate.name} team`, projectName: project }))
            });
        }

        // ------------------------------------------------------- team settings
        if (path.endsWith('/_apis/work/teamsettings')) {
            return json({
                backlogIteration: { id: 'iter-root', name: project, path: project },
                defaultIteration: { id: 'iter-12', name: 'Sprint 12', path: `${project}\\Sprint 12` },
                workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
                bugsBehavior: 'asRequirements'
            });
        }
        if (path.endsWith('/teamfieldvalues')) {
            return json({
                field: { referenceName: FIELD.areaPath, name: 'Area Path' },
                defaultValue: `${project}\\Platform`,
                values: [{ value: `${project}\\Platform`, includeChildren: true }]
            });
        }

        // --------------------------------------------------------- iterations
        if (/\/iterations\/[^/]+\/workitems$/.test(path)) {
            const iterationId = path.split('/iterations/')[1]?.split('/')[0] ?? '';
            const iteration = iterations.find(candidate => candidate.id === iterationId);
            const items = workItems.filter(item => (item.iterationPath ?? project) === iteration?.path);
            return json({
                workItemRelations: items.map(item => ({
                    rel: null,
                    source: null,
                    target: { id: item.id, url: `https://dev.azure.com/org/_apis/wit/workItems/${item.id}` }
                }))
            });
        }
        if (/\/iterations\/[^/]+\/capacities$/.test(path)) {
            return json({
                count: members.length,
                value: members.map(member => ({
                    teamMember: { ...member },
                    activities: [{ capacityPerDay: 6, name: 'Development' }],
                    daysOff: []
                }))
            });
        }
        if (/\/teamsettings\/iterations\/[^/]+$/.test(path)) {
            const iterationId = path.split('/iterations/')[1] ?? '';
            const iteration = iterations.find(candidate => candidate.id === iterationId);
            if (!iteration) return json({ message: 'Iteration not found' }, 404);
            return json(toIterationPayload(iteration));
        }
        if (path.endsWith('/teamsettings/iterations')) {
            const timeframe = query.get('$timeframe');
            const selected = timeframe === 'current' ? iterations.filter(item => item.timeFrame === 'current') : iterations;
            return json({ count: selected.length, value: selected.map(toIterationPayload) });
        }

        // ---------------------------------------------------- classification
        if (path.includes('/_apis/wit/classificationnodes/iterations')) {
            return json({
                id: 1,
                identifier: 'root',
                name: project,
                structureType: 'iteration',
                hasChildren: true,
                path: `\\${project}\\Iteration`,
                children: iterations.map((iteration, index) => ({
                    id: index + 2,
                    identifier: iteration.id,
                    name: iteration.name,
                    structureType: 'iteration',
                    hasChildren: false,
                    path: `\\${project}\\Iteration\\${iteration.name}`,
                    attributes: { startDate: iteration.startDate, finishDate: iteration.finishDate }
                }))
            });
        }
        if (path.includes('/_apis/wit/classificationnodes/areas')) {
            return json({
                id: 100,
                identifier: 'area-root',
                name: project,
                structureType: 'area',
                hasChildren: true,
                path: `\\${project}\\Area`,
                children: [
                    { id: 101, identifier: 'area-platform', name: 'Platform', structureType: 'area', hasChildren: false, path: `\\${project}\\Area\\Platform` }
                ]
            });
        }

        // -------------------------------------------------------------- backlogs
        if (path.endsWith('/_apis/work/backlogs')) {
            return json({
                count: 3,
                value: [
                    { id: 'Microsoft.EpicCategory', name: 'Epics', rank: 3, workItemTypes: [{ name: 'Epic' }] },
                    { id: 'Microsoft.FeatureCategory', name: 'Features', rank: 2, workItemTypes: [{ name: 'Feature' }] },
                    { id: 'Microsoft.RequirementCategory', name: 'Stories', rank: 1, workItemTypes: [{ name: 'User Story' }, { name: 'Bug' }] }
                ]
            });
        }

        // -------------------------------------------------------------- metadata
        if (path.endsWith('/_apis/wit/fields')) {
            const referenceNames = new Set<string>(Object.values(FIELD));
            return json({
                count: referenceNames.size,
                value: [...referenceNames].map(referenceName => ({
                    referenceName,
                    name: referenceName.split('.').pop() ?? referenceName,
                    type: 'string',
                    readOnly: false
                }))
            });
        }
        if (/\/_apis\/wit\/workitemtypes\/[^/]+\/states$/.test(path)) {
            return json({
                count: Object.keys(STATE_CATEGORY).length,
                value: Object.entries(STATE_CATEGORY).map(([name, category]) => ({ name, category, color: 'b2b2b2' }))
            });
        }
        if (path.endsWith('/_apis/wit/workitemtypes')) {
            return json({
                count: 5,
                value: ['Epic', 'Feature', 'User Story', 'Task', 'Bug'].map(name => ({
                    name,
                    referenceName: `Microsoft.VSTS.WorkItemTypes.${name.replace(/\s/g, '')}`,
                    description: `${name} work item`,
                    color: '773b93',
                    isDisabled: false,
                    states: Object.entries(STATE_CATEGORY).map(([state, category]) => ({
                        name: state,
                        category,
                        color: 'b2b2b2'
                    }))
                }))
            });
        }

        // ------------------------------------------------------------ work items
        if (/\/_apis\/wit\/workitems\/\d+\/updates$/.test(path)) {
            const id = Number(path.match(/workitems\/(\d+)\/updates/)?.[1]);
            const item = byId.get(id);
            const updates = item?.updates ?? [];
            return json({
                count: updates.length,
                value: updates.map(update => ({
                    id: update.rev,
                    rev: update.rev,
                    revisedDate: update.revisedDate,
                    revisedBy: identity(update.changedBy),
                    fields: update.fields
                }))
            });
        }
        if (/\/_apis\/wit\/workitems\/\d+\/comments$/.test(path)) {
            const id = Number(path.match(/workitems\/(\d+)\/comments/)?.[1]);
            const item = byId.get(id);
            const comments = item?.comments ?? [];
            return json({
                totalCount: comments.length,
                count: comments.length,
                comments: comments.map((comment, index) => ({
                    id: index + 1,
                    workItemId: id,
                    text: comment.text,
                    createdBy: identity(comment.author),
                    createdDate: comment.createdDate,
                    modifiedDate: comment.createdDate
                }))
            });
        }
        if (/\/_apis\/wit\/workitems\/\d+$/.test(path)) {
            const id = Number(path.match(/workitems\/(\d+)$/)?.[1]);
            const item = byId.get(id);
            if (!item) return json({ message: `TF401232: Work item ${id} does not exist` }, 404);
            return json(toWorkItemPayload(item, project, true));
        }
        if (path.endsWith('/_apis/wit/workitems')) {
            const ids = (query.get('ids') ?? '')
                .split(',')
                .map(value => Number(value.trim()))
                .filter(value => Number.isInteger(value) && value > 0);
            const expandRelations = query.get('$expand') === 'relations';
            const selected = ids.map(id => byId.get(id)).filter((item): item is FixtureWorkItem => item !== undefined);
            return json({
                count: selected.length,
                value: selected.map(item => toWorkItemPayload(item, project, expandRelations))
            });
        }

        // -------------------------------------------------------------------- WIQL
        if (path.endsWith('/_apis/wit/wiql')) {
            if (method !== 'POST') return json({ message: 'WIQL requires POST' }, 405);
            const queryText = String((body as { query?: string } | undefined)?.query ?? '');

            if (/from\s+workitemlinks/i.test(queryText)) {
                return json({
                    queryType: 'tree',
                    asOf: new Date().toISOString(),
                    columns: [{ referenceName: FIELD.id, name: 'ID' }],
                    workItemRelations: evaluateLinkQuery(queryText, byId)
                });
            }

            const matched = evaluateWiql(queryText, workItems, project);
            return json({
                queryType: 'flat',
                asOf: new Date().toISOString(),
                columns: [{ referenceName: FIELD.id, name: 'ID' }],
                workItems: matched.map(item => ({
                    id: item.id,
                    url: `https://dev.azure.com/org/_apis/wit/workItems/${item.id}`
                }))
            });
        }

        return json({ message: `Fixture has no handler for ${method} ${path}` }, 404);
    }) as unknown as typeof fetch;

    return { fetchImpl, requests, workItems };
}

function toIterationPayload(iteration: {
    id: string;
    name: string;
    path: string;
    startDate?: string;
    finishDate?: string;
    timeFrame: string;
}) {
    return {
        id: iteration.id,
        name: iteration.name,
        path: iteration.path,
        attributes: {
            startDate: iteration.startDate ?? null,
            finishDate: iteration.finishDate ?? null,
            timeFrame: iteration.timeFrame
        },
        url: `https://dev.azure.com/org/_apis/work/teamsettings/iterations/${iteration.id}`
    };
}

function toWorkItemPayload(item: FixtureWorkItem, project: string, withRelations: boolean) {
    const fields: Record<string, unknown> = {
        [FIELD.id]: item.id,
        [FIELD.workItemType]: item.type,
        [FIELD.title]: item.title,
        [FIELD.state]: item.state,
        [FIELD.teamProject]: project,
        [FIELD.iterationPath]: item.iterationPath ?? project,
        [FIELD.areaPath]: item.areaPath ?? `${project}\\Platform`,
        [FIELD.createdDate]: item.createdDate ?? new Date(Date.now() - 20 * DAY_MS).toISOString(),
        [FIELD.changedDate]: item.changedDate ?? new Date(Date.now() - 2 * DAY_MS).toISOString(),
        [FIELD.createdBy]: identity('Priya Menon'),
        [FIELD.changedBy]: identity(item.assignedTo ?? 'Priya Menon')
    };

    if (item.assignedTo) fields[FIELD.assignedTo] = identity(item.assignedTo);
    if (item.tags) fields[FIELD.tags] = item.tags;
    if (item.priority !== undefined) fields[FIELD.priority] = item.priority;
    if (item.dueDate) fields[FIELD.dueDate] = item.dueDate;
    if (item.storyPoints !== undefined) fields[FIELD.storyPoints] = item.storyPoints;
    if (item.remainingWork !== undefined) fields[FIELD.remainingWork] = item.remainingWork;
    if (item.completedWork !== undefined) fields[FIELD.completedWork] = item.completedWork;
    if (item.closedDate) fields[FIELD.closedDate] = item.closedDate;
    // Azure DevOps always maintains StateChangeDate; derive it the way a real
    // project would so date-windowed queries behave realistically.
    fields[FIELD.stateChangeDate] = item.closedDate ?? item.changedDate ?? fields[FIELD.changedDate];
    if (item.blocked) fields[FIELD.blocked] = item.blocked;
    if (item.parentId !== undefined) fields[FIELD.parent] = item.parentId;

    const relations: { rel: string; url: string; attributes?: Record<string, unknown> }[] = [];
    const link = (rel: string, id: number): void => {
        relations.push({ rel, url: `https://dev.azure.com/org/_apis/wit/workItems/${id}` });
    };
    if (item.parentId !== undefined) link(RELATION.parent, item.parentId);
    for (const childId of item.childIds ?? []) link(RELATION.child, childId);
    for (const predecessorId of item.predecessorIds ?? []) link(RELATION.predecessor, predecessorId);
    for (const successorId of item.successorIds ?? []) link(RELATION.successor, successorId);
    for (const relatedId of item.relatedIds ?? []) link(RELATION.related, relatedId);

    return {
        id: item.id,
        rev: (item.updates?.length ?? 1) + 1,
        fields,
        ...(withRelations ? { relations } : {}),
        url: `https://dev.azure.com/org/_apis/wit/workItems/${item.id}`,
        _links: { html: { href: `https://dev.azure.com/org/${project}/_workitems/edit/${item.id}` } }
    };
}

/**
 * Evaluates a recursive `WorkItemLinks` hierarchy query, returning the same
 * source/target relation shape Azure DevOps returns for a tree query.
 */
function evaluateLinkQuery(
    query: string,
    byId: Map<number, FixtureWorkItem>
): { rel: string | null; source: { id: number } | null; target: { id: number } }[] {
    const rootId = Number(/\[source\]\.\[system\.id\]\s*=\s*(\d+)/i.exec(query)?.[1] ?? 0);
    const reverse = /hierarchy-reverse/i.test(query);
    const relations: { rel: string | null; source: { id: number } | null; target: { id: number } }[] = [];
    if (!byId.has(rootId)) return relations;

    relations.push({ rel: null, source: null, target: { id: rootId } });

    const walk = (id: number, depth: number): void => {
        if (depth > 10) return;
        const item = byId.get(id);
        if (!item) return;
        const nextIds = reverse
            ? item.parentId === undefined
                ? []
                : [item.parentId]
            : (item.childIds ?? []);
        for (const nextId of nextIds) {
            relations.push({
                rel: reverse ? RELATION.parent : RELATION.child,
                source: { id },
                target: { id: nextId }
            });
            walk(nextId, depth + 1);
        }
    };

    walk(rootId, 0);
    return relations;
}

/**
 * A deliberately small WIQL evaluator: enough to honour the clauses this server
 * actually builds (type, state, state category, assignee, iteration, area, tags,
 * due date, changed date, id, and the `@Today`/`@Me` macros) so query
 * construction is genuinely exercised.
 */
function evaluateWiql(query: string, items: FixtureWorkItem[], project: string): FixtureWorkItem[] {
    const whereMatch = /\bwhere\b([\s\S]*?)(\border\s+by\b|$)/i.exec(query);
    const where = whereMatch?.[1]?.trim() ?? '';
    if (where.length === 0) return items;

    return items.filter(item => evaluateExpression(where, item, project));
}

/**
 * Splits an expression on a boolean keyword, ignoring occurrences inside
 * parentheses or string literals.
 */
function splitTopLevel(expression: string, keyword: 'AND' | 'OR'): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let start = 0;

    for (let index = 0; index < expression.length; index += 1) {
        const character = expression[index]!;
        if (character === "'") {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (character === '(') depth += 1;
        else if (character === ')') depth -= 1;
        else if (depth === 0) {
            const ahead = expression.slice(index, index + keyword.length + 2).toUpperCase();
            const boundaryBefore = index === 0 || /\s/.test(expression[index - 1]!);
            if (boundaryBefore && ahead.startsWith(`${keyword} `)) {
                parts.push(expression.slice(start, index));
                index += keyword.length;
                start = index + 1;
            }
        }
    }
    parts.push(expression.slice(start));
    return parts.map(part => part.trim()).filter(part => part.length > 0);
}

function evaluateExpression(expression: string, item: FixtureWorkItem, project: string): boolean {
    const trimmed = expression.trim();

    const orParts = splitTopLevel(trimmed, 'OR');
    if (orParts.length > 1) return orParts.some(part => evaluateExpression(part, item, project));

    const andParts = splitTopLevel(trimmed, 'AND');
    if (andParts.length > 1) return andParts.every(part => evaluateExpression(part, item, project));

    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        return evaluateExpression(trimmed.slice(1, -1), item, project);
    }

    return matchesClause(trimmed, item, project);
}

function fieldValue(field: string, item: FixtureWorkItem, project: string): unknown {
    switch (field) {
        case FIELD.id:
            return item.id;
        case FIELD.workItemType:
            return item.type;
        case FIELD.state:
            return item.state;
        case FIELD.assignedTo:
            return item.assignedTo ?? '';
        case FIELD.iterationPath:
            return item.iterationPath ?? project;
        case FIELD.areaPath:
            return item.areaPath ?? `${project}\\Platform`;
        case FIELD.tags:
            return item.tags ?? '';
        case FIELD.title:
            return item.title;
        case FIELD.priority:
            return item.priority ?? null;
        case FIELD.dueDate:
            return item.dueDate ?? null;
        case FIELD.changedDate:
            return item.changedDate ?? new Date(Date.now() - 2 * DAY_MS).toISOString();
        case FIELD.createdDate:
            return item.createdDate ?? new Date(Date.now() - 20 * DAY_MS).toISOString();
        case FIELD.closedDate:
            return item.closedDate ?? null;
        case FIELD.stateChangeDate:
            return item.closedDate ?? item.changedDate ?? new Date(Date.now() - 2 * DAY_MS).toISOString();
        case FIELD.storyPoints:
            return item.storyPoints ?? null;
        case FIELD.remainingWork:
            return item.remainingWork ?? null;
        case FIELD.blocked:
            return item.blocked ?? '';
        case FIELD.parent:
            return item.parentId ?? null;
        default:
            return null;
    }
}

function stateCategoryOf(item: FixtureWorkItem): string {
    return STATE_CATEGORY[item.state] ?? 'Proposed';
}

/**
 * Azure DevOps matches `[System.AssignedTo]` against either the display name or
 * the unique name (email) of an identity, so the fixture accepts both.
 */
function identityCandidates(item: FixtureWorkItem): string[] {
    if (!item.assignedTo) return [''];
    return [item.assignedTo.toLowerCase(), identity(item.assignedTo).uniqueName.toLowerCase()];
}

function matchesClause(clause: string, item: FixtureWorkItem, project: string): boolean {
    const normalised = clause.replace(/\s+/g, ' ').trim();

    const inMatch = /^\[([^\]]+)\]\s+(not\s+)?in\s+(.+)$/i.exec(normalised);
    if (inMatch) {
        const [, field, negated, list] = inMatch;
        const values = [...list!.matchAll(/'((?:[^']|'')*)'/g)].map(match => match[1]!.replace(/''/g, "'").toLowerCase());
        const actuals =
            field === FIELD.assignedTo ? identityCandidates(item) : [String(fieldValue(field!, item, project)).toLowerCase()];
        const contained = actuals.some(actual => values.includes(actual));
        return negated ? !contained : contained;
    }

    const groupMatch = /^\[([^\]]+)\]\s+(not\s+)?in\s+group\s+'([^']*)'$/i.exec(normalised);
    if (groupMatch) return true;

    const everMatch = /^\[([^\]]+)\]\s+ever\s+'((?:[^']|'')*)'$/i.exec(normalised);
    if (everMatch) {
        const value = everMatch[2]!.replace(/''/g, "'").toLowerCase();
        return (item.updates ?? []).some(update =>
            Object.values(update.fields ?? {}).some(change => String(change.newValue ?? '').toLowerCase() === value)
        );
    }

    const containsMatch = /^\[([^\]]+)\]\s+(not\s+)?contains(\s+words)?\s+'((?:[^']|'')*)'$/i.exec(normalised);
    if (containsMatch) {
        const [, field, negated, , raw] = containsMatch;
        const needle = raw!.replace(/''/g, "'").toLowerCase();
        const haystacks =
            field === FIELD.assignedTo ? identityCandidates(item) : [String(fieldValue(field!, item, project)).toLowerCase()];
        const contained = haystacks.some(haystack => haystack.includes(needle));
        return negated ? !contained : contained;
    }

    const nullMatch = /^\[([^\]]+)\]\s+(is\s+not\s+empty|is\s+empty|<>\s*''|=\s*'')$/i.exec(normalised);
    if (nullMatch) {
        const value = fieldValue(nullMatch[1]!, item, project);
        const empty = value === null || value === undefined || value === '';
        const wantsEmpty = /is\s+empty|=\s*''/i.test(nullMatch[2]!);
        return wantsEmpty ? empty : !empty;
    }

    const underMatch = /^\[([^\]]+)\]\s+(not\s+)?under\s+'((?:[^']|'')*)'$/i.exec(normalised);
    if (underMatch) {
        const [, field, negated, raw] = underMatch;
        const prefix = raw!.replace(/''/g, "'").toLowerCase();
        const actual = String(fieldValue(field!, item, project)).toLowerCase();
        const under = actual === prefix || actual.startsWith(`${prefix}\\`);
        return negated ? !under : under;
    }

    const comparison = /^\[([^\]]+)\]\s*(<=|>=|<>|=|<|>)\s*(.+)$/.exec(normalised);
    if (comparison) {
        const [, field, operator, rawValue] = comparison;
        const actual = fieldValue(field!, item, project);
        const expected = parseWiqlValue(rawValue!.trim());

        if (field === FIELD.assignedTo && typeof expected === 'string' && (operator === '=' || operator === '<>')) {
            const matched = identityCandidates(item).includes(expected.toLowerCase());
            return operator === '=' ? matched : !matched;
        }

        if (field === FIELD.state && typeof expected === 'string') {
            // Support the category pseudo-comparison the builder emits for readability.
            if (['proposed', 'inprogress', 'resolved', 'completed', 'removed'].includes(expected.toLowerCase())) {
                const category = stateCategoryOf(item).toLowerCase();
                return operator === '<>' ? category !== expected.toLowerCase() : category === expected.toLowerCase();
            }
        }

        if (actual === null || actual === undefined || actual === '') {
            return operator === '<>';
        }

        if (typeof expected === 'number') {
            const numeric = Number(actual);
            if (!Number.isFinite(numeric)) return operator === '<>';
            switch (operator) {
                case '=':
                    return numeric === expected;
                case '<>':
                    return numeric !== expected;
                case '<':
                    return numeric < expected;
                case '<=':
                    return numeric <= expected;
                case '>':
                    return numeric > expected;
                case '>=':
                    return numeric >= expected;
            }
        }

        const expectedText = String(expected);
        const actualText = String(actual);
        const isDate = /^\d{4}-\d{2}-\d{2}/.test(expectedText) && /^\d{4}-\d{2}-\d{2}/.test(actualText);
        // The client sends timePrecision=false, so Azure DevOps compares dates at
        // day granularity; do the same here.
        const left = isDate ? Date.parse(actualText.slice(0, 10)) : actualText.toLowerCase();
        const right = isDate ? Date.parse(expectedText.slice(0, 10)) : expectedText.toLowerCase();
        switch (operator) {
            case '=':
                return left === right;
            case '<>':
                return left !== right;
            case '<':
                return left < right;
            case '<=':
                return left <= right;
            case '>':
                return left > right;
            case '>=':
                return left >= right;
        }
    }

    // Unknown clause shapes should not silently filter everything out.
    return true;
}

function parseWiqlValue(raw: string): string | number {
    const trimmed = raw.trim();
    const quoted = /^'((?:[^']|'')*)'$/.exec(trimmed);
    if (quoted) return quoted[1]!.replace(/''/g, "'");

    // `@Today`, `@Today + 7`, `@Today - 3`. Resolved to midnight of the offset day
    // in the same (UTC) frame the fixture dates use, because date comparisons below
    // are day-granular.
    const today = /^@today(?:\s*([+-])\s*(\d+))?$/i.exec(trimmed);
    if (today) {
        const sign = today[1] === '-' ? -1 : 1;
        const days = today[2] ? Number(today[2]) : 0;
        const date = new Date(Date.now() + sign * days * DAY_MS);
        return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
    }

    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : trimmed;
}
