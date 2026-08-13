/**
 * Azure DevOps read coverage, exercised through the MCP tools exactly as a client
 * would call them: project, teams, members, sprints, work items, hierarchy,
 * history, comments, and the overdue / blocked / unassigned queries.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectTestClient, textOf, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';

interface WorkItemShape {
    id: number;
    type: string;
    title: string;
    state: string;
    stateCategory?: string | null;
    assignedTo: string | null;
    iterationPath: string;
    dueDate?: string | null;
    priority?: number | null;
    url?: string;
}

let harness: Harness;
let mcp: ConnectedClient;

beforeEach(async () => {
    harness = setupHarness();
    mcp = await connectTestClient();
});

afterEach(async () => {
    await mcp?.close();
    harness?.reset();
});

describe('project reads', () => {
    it('reads the project overview for the configured organization and project', async () => {
        const overview = await mcp.callToolJson<{
            project: { name: string; process: string | null };
            team: { name: string; memberCount: number };
            currentSprint: { name: string } | null;
            workItemCounts: Record<string, unknown>;
        }>('ado_get_project_overview');

        expect(overview.project.name).toBe('K4K');
        expect(overview.project.process).toBe('Agile');
        expect(overview.team.name).toBe('Platform');
        expect(overview.team.memberCount).toBeGreaterThan(0);
        expect(overview.currentSprint?.name).toBe('Sprint 12');
    });

    it('reads project details including the process template', async () => {
        const details = await mcp.callToolJson<{
            organization: string;
            name: string;
            state: string;
            process: string | null;
        }>('ado_get_project_details');
        expect(details.organization).toBe('KEBS4KAAR');
        expect(details.name).toBe('K4K');
        expect(details.state).toBe('wellFormed');
        expect(details.process).toBe('Agile');
    });

    it('lists project teams and resolves the Platform team', async () => {
        const teams = await mcp.callToolJson<{ count: number; teams: { name: string }[] }>('ado_get_project_teams');
        expect(teams.teams.map(team => team.name)).toContain('Platform');

        const platform = await mcp.callToolJson<{
            team: { name: string; id: string };
            areaPaths: { path: string }[];
            defaultIteration: string | null;
        }>('ado_get_platform_team');
        expect(platform.team.name).toBe('Platform');
        expect(platform.team.id).toBeTruthy();
        expect(platform.areaPaths.map(area => area.path)).toContain('K4K\\Platform');
    });

    it('reads team members with their identities', async () => {
        const members = await mcp.callToolJson<{
            team: string;
            count: number;
            members: { displayName: string; email: string | null; isTeamAdmin?: boolean }[];
        }>('ado_get_team_members');

        expect(members.team).toBe('Platform');
        expect(members.count).toBe(4);
        const arun = members.members.find(member => member.displayName === 'Arun Kumar');
        expect(arun).toBeDefined();
        expect(arun!.email).toContain('@');
    });

    it('reads iterations and the current sprint', async () => {
        const iterations = await mcp.callToolJson<{ count: number; iterations: { name: string; timeFrame: string }[] }>(
            'ado_get_team_iterations'
        );
        expect(iterations.iterations.map(iteration => iteration.name)).toEqual(['Sprint 11', 'Sprint 12', 'Sprint 13']);

        const current = await mcp.callToolJson<{
            currentSprint: { name: string; startDate: string | null; finishDate: string | null; daysRemaining: number | null };
        }>('ado_get_current_sprint');
        expect(current.currentSprint.name).toBe('Sprint 12');
        expect(current.currentSprint.daysRemaining).not.toBeNull();
    });

    it('reads upcoming sprints and project milestones', async () => {
        const upcoming = await mcp.callToolJson<{ upcoming: { name: string }[] }>('ado_get_upcoming_sprints');
        expect(upcoming.upcoming.map(sprint => sprint.name)).toContain('Sprint 13');

        const milestones = await mcp.callToolJson<{ milestones: { name: string }[] }>('ado_get_project_milestones');
        expect(milestones.milestones.length).toBeGreaterThan(0);
    });

    it('reads sprint progress with counts derived from real items', async () => {
        const progress = await mcp.callToolJson<{
            sprint: { name: string };
            totals: { items: number; completed: number; inProgress: number; proposed: number; removed: number };
            carryOver: { id: number; movedFrom: string }[];
        }>('ado_get_sprint_progress', { sprint: 'current' });

        expect(progress.sprint.name).toBe('Sprint 12');
        expect(progress.totals.items).toBeGreaterThan(0);
        expect(
            progress.totals.completed + progress.totals.inProgress + progress.totals.proposed + progress.totals.removed
        ).toBe(progress.totals.items);
        expect(progress.totals.inProgress).toBeGreaterThan(0);

        // #1300 was moved into Sprint 12 from Sprint 11, which its history shows.
        expect(progress.carryOver.map(item => item.id)).toContain(1300);
    });

    it('reads backlog levels and work-item types with their state categories', async () => {
        const backlogs = await mcp.callToolJson<{ backlogs: { name: string }[] }>('ado_get_backlogs');
        expect(backlogs.backlogs.map(backlog => backlog.name)).toContain('Epics');

        const types = await mcp.callToolJson<{ types: { type: string; states: { state: string; category: string }[] }[] }>(
            'ado_get_work_item_types'
        );
        expect(types.types.map(type => type.type)).toContain('User Story');
        const story = types.types.find(type => type.type === 'User Story')!;
        expect(story.states.find(state => state.state === 'Active')?.category).toBe('InProgress');
        expect(story.states.find(state => state.state === 'Closed')?.category).toBe('Completed');
    });

    it('reports connection status without leaking the PAT', async () => {
        const status = await mcp.callTool('ado_get_connection_status');
        const text = textOf(status);
        expect(text).toContain('KEBS4KAAR');
        expect(text).not.toContain('test-pat-value-not-a-real-secret');
        expect(text.toLowerCase()).toContain('read');
    });

    it('refreshes cached project context on request', async () => {
        await mcp.callToolJson('ado_get_project_overview');
        const before = harness.requests.length;

        // A second overview should reuse cached metadata.
        await mcp.callToolJson('ado_get_project_overview');
        const cached = harness.requests.length - before;

        await mcp.callToolJson('ado_refresh_project_context');
        await mcp.callToolJson('ado_get_project_overview');
        const afterRefresh = harness.requests.length - before - cached - 1;

        expect(afterRefresh).toBeGreaterThanOrEqual(cached);
    });
});

describe('work-item reads', () => {
    it('reads a single work item with its real field values', async () => {
        const item = await mcp.callToolJson<WorkItemShape>('ado_get_work_item', { id: 1111 });
        expect(item.id).toBe(1111);
        expect(item.type).toBe('Task');
        expect(item.title).toContain('correlation ids');
        expect(item.state).toBe('Active');
        expect(item.assignedTo).toBe('Arun Kumar');
        expect(item.iterationPath).toBe('K4K\\Sprint 12');
        expect(item.stateCategory).toBe('InProgress');
        expect((item as unknown as { webUrl: string }).webUrl).toContain('_workitems/edit/1111');
    });

    it('returns a clear error for a work item that does not exist', async () => {
        const result = await mcp.callTool('ado_get_work_item', { id: 999999 });
        expect(result.isError).toBe(true);
        expect(textOf(result).toLowerCase()).toContain('not found');
    });

    it('reads several work items in one batch', async () => {
        const batch = await mcp.callToolJson<{ requested: number; returned: number; items: WorkItemShape[] }>(
            'ado_get_work_items',
            { ids: [1000, 1100, 1110, 999999] }
        );
        expect(batch.requested).toBe(4);
        expect(batch.returned).toBe(3);
        expect(batch.items.map(item => item.id).sort()).toEqual([1000, 1100, 1110]);
    });

    it('searches work items by title text', async () => {
        const found = await mcp.callToolJson<{ count: number; items: WorkItemShape[] }>('ado_search_work_items', {
            query: 'logging'
        });
        expect(found.count).toBeGreaterThan(0);
        expect(found.items.some(item => item.id === 1110)).toBe(true);
    });

    it('treats a bare number in a search as a work-item id', async () => {
        const found = await mcp.callToolJson<{ items: WorkItemShape[] }>('ado_search_work_items', { query: '1300' });
        expect(found.items.some(item => item.id === 1300)).toBe(true);
    });

    it('filters by type, state, assignee and sprint', async () => {
        const tasks = await mcp.callToolJson<{ items: WorkItemShape[] }>('ado_get_work_items_by_type', {
            type: 'Task'
        });
        expect(tasks.items.every(item => item.type === 'Task')).toBe(true);

        const active = await mcp.callToolJson<{ items: WorkItemShape[] }>('ado_get_work_items_by_state', {
            state: 'Active'
        });
        expect(active.items.every(item => item.state === 'Active')).toBe(true);

        const arun = await mcp.callToolJson<{ member: unknown; items: WorkItemShape[] }>(
            'ado_get_work_items_by_assignee',
            { member: 'Arun' }
        );
        expect(arun.items.length).toBeGreaterThan(0);
        expect(arun.items.every(item => item.assignedTo === 'Arun Kumar')).toBe(true);

        const sprint = await mcp.callToolJson<{ sprint: { name: string }; items: WorkItemShape[] }>(
            'ado_get_work_items_by_sprint',
            { sprint: 'current' }
        );
        expect(sprint.sprint.name).toBe('Sprint 12');
        expect(sprint.items.every(item => item.iterationPath === 'K4K\\Sprint 12')).toBe(true);
    });

    it('identifies overdue items', async () => {
        const overdue = await mcp.callToolJson<{ count: number; items: WorkItemShape[] }>('ado_get_overdue_items');
        expect(overdue.count).toBeGreaterThan(0);
        // #1111 is three days past its due date and still open.
        expect(overdue.items.map(item => item.id)).toContain(1111);
        // Closed items are never reported as overdue.
        expect(overdue.items.some(candidate => candidate.id === 1400)).toBe(false);
    });

    it('identifies blocked items with the evidence for the call', async () => {
        const blocked = await mcp.callToolJson<{
            count: number;
            items: { id: number; blockedSignals: { kind: string; evidence: string }[] }[];
        }>('ado_get_blocked_items');

        const tagged = blocked.items.find(candidate => candidate.id === 1120);
        expect(tagged, 'item 1120 is tagged blocked and has the Blocked field set').toBeDefined();
        expect(tagged!.blockedSignals.map(signal => signal.kind).sort()).toEqual(['field', 'tag']);
        expect(tagged!.blockedSignals.map(signal => signal.evidence).join(' ')).toMatch(/Blocked/);

        // #1112 has no tag or field signal; it is blocked by an unfinished predecessor.
        const dependent = blocked.items.find(candidate => candidate.id === 1112);
        expect(dependent).toBeDefined();
        expect(dependent!.blockedSignals.map(signal => signal.kind)).toContain('dependency');
        expect(dependent!.blockedSignals.map(signal => signal.evidence).join(' ')).toContain('1120');
    });

    it('identifies unassigned and high-priority items', async () => {
        const unassigned = await mcp.callToolJson<{ items: WorkItemShape[] }>('ado_get_unassigned_items');
        expect(unassigned.items.map(item => item.id)).toContain(1210);
        expect(unassigned.items.every(item => item.assignedTo === null)).toBe(true);

        const high = await mcp.callToolJson<{ items: WorkItemShape[] }>('ado_get_high_priority_items');
        expect(high.items.length).toBeGreaterThan(0);
        expect(high.items.every(item => (item.priority ?? 99) <= 2)).toBe(true);
    });

    it('reads items due today and this week', async () => {
        const today = await mcp.callToolJson<{ items: WorkItemShape[] }>('ado_get_work_items_due_today');
        expect(today.items.map(item => item.id)).toContain(1300);

        const week = await mcp.callToolJson<{ items: WorkItemShape[] }>('ado_get_work_items_due_this_week');
        expect(week.items.length).toBeGreaterThanOrEqual(today.items.length);
    });

    it('reads recently changed items', async () => {
        const recent = await mcp.callToolJson<{ items: WorkItemShape[] }>('ado_get_recently_changed_items', {
            days: 3
        });
        expect(recent.items.map(item => item.id)).toContain(1300);
    });
});

describe('history, comments and relations', () => {
    it('reads work-item revision history', async () => {
        const history = await mcp.callToolJson<{
            workItemId: number;
            revisions: number;
            history: { rev: number; revisedBy: string; changes: { field: string; from: unknown; to: unknown }[] }[];
        }>('ado_get_work_item_history', { id: 1300 });

        expect(history.workItemId).toBe(1300);
        expect(history.revisions).toBe(4);
        const stateChanges = history.history.flatMap(entry =>
            entry.changes.filter(change => change.field.toLowerCase().includes('state'))
        );
        expect(stateChanges.length).toBeGreaterThan(0);
        // The item was closed and reopened; both transitions are visible.
        expect(stateChanges.some(change => change.from === 'Active' && change.to === 'Closed')).toBe(true);
        expect(stateChanges.some(change => change.from === 'Closed' && change.to === 'Active')).toBe(true);
    });

    it('reads work-item comments as plain text', async () => {
        const comments = await mcp.callToolJson<{ total: number; comments: { text: string; author: string }[] }>(
            'ado_get_work_item_comments',
            { id: 1300 }
        );
        expect(comments.total).toBe(1);
        expect(comments.comments[0]!.text).toBe('Reproduced on the staging tenant.');
        expect(comments.comments[0]!.text).not.toContain('<div>');
        expect(comments.comments[0]!.author).toBe('Arun Kumar');
    });

    it('reads related items, parent and children using real relation links', async () => {
        const related = await mcp.callToolJson<{
            related: { linkType: string; linkLabel: string; item: { id: number } }[];
        }>('ado_get_related_work_items', { id: 1110 });
        expect(related.related.map(relation => relation.item.id).sort()).toEqual([1100, 1111, 1112]);
        expect(related.related.find(relation => relation.item.id === 1100)?.linkLabel).toBe('Parent');

        const parent = await mcp.callToolJson<{ parent: WorkItemShape | null }>('ado_get_parent_work_item', {
            id: 1110
        });
        expect(parent.parent?.id).toBe(1100);

        const children = await mcp.callToolJson<{ children: WorkItemShape[] }>('ado_get_child_work_items', {
            id: 1110
        });
        expect(children.children.map(child => child.id).sort()).toEqual([1111, 1112]);
    });

    it('retrieves the full Epic -> Feature -> Story -> Task hierarchy with real ids', async () => {
        const hierarchy = await mcp.callToolJson<{
            root: { id: number; type: string; children: { id: number; type: string; children: unknown[] }[] };
            totalItems: number;
            tree: string;
        }>('ado_get_work_item_hierarchy', { id: 1000 });

        expect(hierarchy.root.id).toBe(1000);
        expect(hierarchy.root.type).toBe('Epic');
        expect(hierarchy.root.children.map(child => child.id).sort()).toEqual([1100, 1200]);

        const feature = hierarchy.root.children.find(child => child.id === 1100)!;
        expect(feature.type).toBe('Feature');
        const story = (feature.children as { id: number; children: unknown[] }[]).find(child => child.id === 1110)!;
        expect((story.children as { id: number }[]).map(task => task.id).sort()).toEqual([1111, 1112]);

        expect(hierarchy.totalItems).toBe(8);
        expect(hierarchy.tree).toContain('#1000');
        expect(hierarchy.tree).toContain('#1111');
    });
});

describe('Azure DevOps error handling', () => {
    it('maps 401 to an authentication message without leaking the PAT', async () => {
        harness.reset();
        harness = setupHarness({ failures: [{ fragment: '_apis/projects', status: 401, times: 5 }] });
        mcp = await connectTestClient();

        const result = await mcp.callTool('ado_get_project_details');
        const text = textOf(result);
        expect(result.isError).toBe(true);
        expect(text).toContain('Azure DevOps authentication failed');
        expect(text).toContain('PAT');
        expect(text).not.toContain('test-pat-value-not-a-real-secret');
    });

    it('maps 403 to a permission message', async () => {
        harness.reset();
        harness = setupHarness({ failures: [{ fragment: '_apis/projects', status: 403, times: 5 }] });
        mcp = await connectTestClient();

        const result = await mcp.callTool('ado_get_project_details');
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('permission');
    });

    it('maps 404 to a not-found message', async () => {
        const result = await mcp.callTool('ado_get_work_item', { id: 424242 });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('not found');
    });

    it('retries a rate-limited request and then succeeds', async () => {
        harness.reset();
        harness = setupHarness({ failures: [{ fragment: '_apis/projects', status: 429, times: 1 }] });
        mcp = await connectTestClient();

        const details = await mcp.callToolJson<{ name: string }>('ado_get_project_details');
        expect(details.name).toBe('K4K');
    });

    it('surfaces a server error as a retryable Azure DevOps failure', async () => {
        harness.reset();
        harness = setupHarness({ failures: [{ fragment: '_apis/projects', status: 503, times: 5 }] });
        mcp = await connectTestClient();

        const result = await mcp.callTool('ado_get_project_details');
        expect(result.isError).toBe(true);
        expect(textOf(result).toLowerCase()).toMatch(/azure devops/);
    });
});
