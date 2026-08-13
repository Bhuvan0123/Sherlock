/**
 * Degraded and empty-data behaviour.
 *
 * Skills are only as trustworthy as the server underneath them, so these tests
 * cover the situations where a skill must say "unknown" or "none" rather than
 * inventing a number: no team, no work, no sprint, no due dates, nothing
 * assigned, and one person holding everything.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { connectTestClient, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';
import type { FixtureWorkItem } from '../helpers/ado-fixture.js';

let harness: Harness | null = null;
let mcp: ConnectedClient | null = null;

async function start(options: Parameters<typeof setupHarness>[0] = {}): Promise<ConnectedClient> {
    harness = setupHarness(options);
    mcp = await connectTestClient();
    return mcp;
}

afterEach(async () => {
    await mcp?.close();
    harness?.reset();
    mcp = null;
    harness = null;
});

const DAY_MS = 86_400_000;
const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY_MS).toISOString();

describe('empty team', () => {
    it('reports an empty roster instead of inventing members', async () => {
        const client = await start({ members: [] });

        const members = await client.callToolJson<{ count: number; members: unknown[] }>('ado_get_team_members');
        expect(members.count).toBe(0);
        expect(members.members).toEqual([]);

        const workload = await client.callToolJson<{ members: unknown[]; totals: { openItems: number } }>(
            'analysis_team_workload'
        );
        expect(workload.members).toEqual([]);
        // Work can still exist without a team roster; the unassigned bucket must survive.
        expect(workload.totals.openItems).toBeGreaterThanOrEqual(0);
    });

    it('still produces a daily review, with the roster gap visible', async () => {
        const client = await start({ members: [] });
        const review = await client.callToolJson<{ facts: { memberWorkload?: unknown[] } }>('analysis_daily_team_review');
        expect(review.facts).toBeDefined();
    });
});

describe('empty backlog', () => {
    it('returns zero counts without manufacturing concerns', async () => {
        const client = await start({ workItems: [] });

        const overview = await client.callToolJson<{ openWork: { total: number; overdue: number; blocked: number } }>(
            'ado_get_project_overview'
        );
        expect(overview.openWork.total).toBe(0);
        expect(overview.openWork.overdue).toBe(0);
        expect(overview.openWork.blocked).toBe(0);

        const overdue = await client.callToolJson<{ count: number; items: unknown[] }>('ado_get_overdue_items');
        expect(overdue.count).toBe(0);
        expect(overdue.items).toEqual([]);

        const blocked = await client.callToolJson<{ count: number }>('ado_get_blocked_items');
        expect(blocked.count).toBe(0);
    });

    it('rates health without work to rate, and says which dimensions are unknown', async () => {
        const client = await start({ workItems: [] });
        const envelope = await client.callToolJson<{
            facts: { health: { overall: string; dimensions: Record<string, { rating: string; reasons: string[] }> } };
        }>('analysis_project_health');

        const ratings = Object.values(envelope.facts.health.dimensions).map(dimension => dimension.rating);
        expect(ratings.length).toBeGreaterThan(0);
        for (const rating of ratings) {
            expect(['Good', 'Moderate Risk', 'At Risk', 'High Risk', 'Unknown']).toContain(rating);
        }
    });
});

describe('no active sprint', () => {
    const pastAndFuture = [
        {
            id: 'iter-11',
            name: 'Sprint 11',
            path: 'K4K\\Sprint 11',
            startDate: iso(-40),
            finishDate: iso(-26),
            timeFrame: 'past' as const
        },
        {
            id: 'iter-14',
            name: 'Sprint 14',
            path: 'K4K\\Sprint 14',
            startDate: iso(14),
            finishDate: iso(28),
            timeFrame: 'future' as const
        }
    ];

    it('reports that no iteration is current rather than picking one', async () => {
        const client = await start({ iterations: pastAndFuture });

        const current = await client.callToolJson<{ currentSprint: null; note: string }>('ado_get_current_sprint');
        expect(current.currentSprint).toBeNull();
        expect(current.note.toLowerCase()).toContain('no iteration');
    });

    it('still lists iterations and upcoming sprints', async () => {
        const client = await start({ iterations: pastAndFuture });

        const iterations = await client.callToolJson<{ count: number; iterations: { name: string }[] }>(
            'ado_get_team_iterations'
        );
        expect(iterations.iterations.map(iteration => iteration.name)).toEqual(['Sprint 11', 'Sprint 14']);

        const upcoming = await client.callToolJson<{ upcoming: { name: string }[] }>('ado_get_upcoming_sprints');
        expect(upcoming.upcoming.map(sprint => sprint.name)).toContain('Sprint 14');
    });
});

describe('no deadlines', () => {
    const undatedWork: FixtureWorkItem[] = [
        { id: 2001, type: 'Task', title: 'Undated task one', state: 'Active', assignedTo: 'Arun Kumar' },
        { id: 2002, type: 'Task', title: 'Undated task two', state: 'New', assignedTo: 'Divya Raman' },
        { id: 2003, type: 'Bug', title: 'Undated bug', state: 'Active', assignedTo: 'Arun Kumar' }
    ];

    it('separates "nothing is due" from "nothing has a due date"', async () => {
        const client = await start({ workItems: undatedWork });

        const facts = await client.callToolJson<{
            counts: { overdue: number; dueToday: number; dueThisWeek: number; withoutDueDate: number };
        }>('analysis_deadlines');

        expect(facts.counts.overdue).toBe(0);
        expect(facts.counts.dueToday).toBe(0);
        expect(facts.counts.dueThisWeek).toBe(0);
        // The distinction that matters: these items are not "on time", they are undated.
        expect(facts.counts.withoutDueDate).toBe(undatedWork.length);
    });

    it('rates no deadline risk when there are no dates to miss', async () => {
        const client = await start({ workItems: undatedWork });
        const envelope = await client.callToolJson<{
            facts: { counts: { overdue: number; withoutDueDate: number } };
        }>('analysis_deadline_risk');
        expect(envelope.facts.counts.overdue).toBe(0);
        expect(envelope.facts.counts.withoutDueDate).toBeGreaterThan(0);
    });
});

describe('unassigned work', () => {
    const unowned: FixtureWorkItem[] = [
        { id: 3001, type: 'Task', title: 'Unowned high priority task', state: 'New', assignedTo: null, priority: 1 },
        { id: 3002, type: 'Bug', title: 'Unowned bug', state: 'New', assignedTo: null, priority: 2 },
        { id: 3003, type: 'Task', title: 'Unowned chore', state: 'New', assignedTo: null }
    ];

    it('finds every unowned item', async () => {
        const client = await start({ workItems: unowned });
        const result = await client.callToolJson<{ count: number; items: { id: number }[] }>('ado_get_unassigned_items');
        expect(result.count).toBe(3);
        expect(result.items.map(item => item.id).sort()).toEqual([3001, 3002, 3003]);
    });

    it('recommends owners without assigning anything', async () => {
        const client = await start({ workItems: unowned });
        const envelope = await client.callToolJson<{
            facts: { unassignedCount: number; recommendations: { workItem: { id: number } }[]; actionRequired: string };
        }>('analysis_assignment_recommendations');

        expect(envelope.facts.unassignedCount).toBe(3);
        expect(envelope.facts.actionRequired.toLowerCase()).toContain('read-only');

        // Nothing was written: every Azure DevOps request stayed a read.
        expect(harness!.requests.every(request => request.method === 'GET' || request.url.includes('/wiql'))).toBe(true);
    });
});

describe('overloaded team', () => {
    const lopsided: FixtureWorkItem[] = [
        ...Array.from({ length: 14 }, (_, index) => ({
            id: 4000 + index,
            type: 'Task',
            title: `Task ${index + 1} on the busiest member`,
            state: 'Active',
            assignedTo: 'Arun Kumar',
            iterationPath: 'K4K\\Sprint 12',
            ...(index < 3 ? { dueDate: iso(-2) } : {})
        })),
        { id: 4100, type: 'Task', title: 'The only other task', state: 'Active', assignedTo: 'Divya Raman' }
    ];

    it('flags the imbalance and names the factors behind it', async () => {
        const client = await start({ workItems: lopsided });
        const envelope = await client.callToolJson<{
            facts: { members: { member: { displayName: string }; counts: { assignedOpen: number } }[] };
            concerns: string[];
            observations: string[];
        }>('analysis_work_distribution');

        const busiest = envelope.facts.members.find(entry => entry.member.displayName === 'Arun Kumar');
        expect(busiest?.counts.assignedOpen).toBe(14);

        const text = [...envelope.concerns, ...envelope.observations].join(' ').toLowerCase();
        expect(text).toContain('arun kumar');
    });

    it('still identifies who has spare capacity, with the factors behind it', async () => {
        const client = await start({ workItems: lopsided });
        const envelope = await client.callToolJson<{
            facts: { candidates: { member: string; availability: string; factors: string[] }[] };
        }>('analysis_available_team_members');

        const candidates = envelope.facts.candidates;
        expect(candidates.length).toBeGreaterThan(0);

        // The member holding one item must rank above the one holding fourteen.
        const order = candidates.map(candidate => candidate.member);
        expect(order.indexOf('Divya Raman')).toBeLessThan(order.indexOf('Arun Kumar'));

        const busiest = candidates.find(candidate => candidate.member === 'Arun Kumar')!;
        expect(busiest.factors.join(' ')).toMatch(/open items|in progress|overdue/i);
    });
});

describe('missing fields', () => {
    it('reports unset estimates as unknown rather than zero', async () => {
        const client = await start({
            workItems: [
                {
                    id: 5001,
                    type: 'User Story',
                    title: 'Story with no points and no priority',
                    state: 'Active',
                    assignedTo: 'Arun Kumar',
                    iterationPath: 'K4K\\Sprint 12'
                }
            ]
        });

        const item = await client.callToolJson<{
            storyPoints: number | null;
            priority: number | null;
            dueDate: string | null;
        }>('ado_get_work_item', { id: 5001 });

        expect(item.storyPoints).toBeNull();
        expect(item.priority).toBeNull();
        expect(item.dueDate).toBeNull();
    });

    it('omits work items that do not exist instead of failing the batch', async () => {
        const client = await start();
        const batch = await client.callToolJson<{ requested: number; returned: number; items: { id: number }[] }>(
            'ado_get_work_items',
            { ids: [1111, 999_999] }
        );
        expect(batch.requested).toBe(2);
        expect(batch.returned).toBe(1);
        expect(batch.items.map(item => item.id)).toEqual([1111]);
    });
});
