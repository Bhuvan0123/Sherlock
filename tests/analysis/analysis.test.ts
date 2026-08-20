/**
 * Analysis coverage: workload, deadline risk, dependencies, project health,
 * productivity indicators, assignment recommendations and the daily review.
 *
 * Two properties are asserted throughout:
 *  - measured Azure DevOps data lives under `facts`, and generated judgement lives
 *    under `observations` / `concerns` / `recommendations`;
 *  - nothing is recommended without naming the real work items behind it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectTestClient, textOf, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';

interface Envelope<TFacts> {
    kind: string;
    generatedAt: string;
    dataSource: string;
    facts: TFacts;
    observations: string[];
    concerns: string[];
    recommendations: string[];
    methodology?: string[];
    disclaimer?: string;
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

describe('analysis envelopes', () => {
    it('separates measured facts from generated judgement, and says so', async () => {
        const envelope = await mcp.callToolJson<Envelope<Record<string, unknown>>>('analysis_project_health');

        expect(envelope.kind).toBe('project_health');
        expect(envelope.dataSource.toLowerCase()).toContain('azure devops');
        expect(envelope.facts).toBeTypeOf('object');
        expect(Array.isArray(envelope.observations)).toBe(true);
        expect((envelope.methodology ?? []).length + (envelope.disclaimer ? 1 : 0)).toBeGreaterThan(0);

        const text = textOf(await mcp.callTool('analysis_project_health'));
        expect(text).toContain('AI-GENERATED');
    });
});

describe('workload analysis', () => {
    it('reports team workload per member from assigned work', async () => {
        const workload = await mcp.callToolJson<{
            team: string;
            members: {
                member: { displayName: string };
                counts: { assignedOpen: number; active: number; overdue: number; blocked: number };
            }[];
            totals: Record<string, number>;
        }>('analysis_team_workload');

        expect(workload.team).toBe('Platform');
        expect(workload.members.length).toBe(4);

        const arun = workload.members.find(entry => entry.member.displayName === 'Arun Kumar')!;
        expect(arun.counts.assignedOpen).toBeGreaterThan(0);
        expect(arun.counts.overdue).toBe(1);
        expect(arun.items.active.length).toBeLessThanOrEqual(3);

        expect(workload.overdueRules.some(r => r.label.includes('Due Date'))).toBe(true);
        expect(workload.unassigned.items.length).toBeLessThanOrEqual(3);

        const idle = workload.members.find(entry => entry.member.displayName === 'Karthik Nair')!;
        expect(idle.counts.assignedOpen).toBe(0);
    });

    it('flags the imbalance between the busiest and idlest member', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{ team: string; members: { member: string; openItems: number }[] }>
        >('analysis_work_distribution');

        expect(envelope.kind).toBe('team_work_distribution');
        expect(envelope.observations.join(' ')).toMatch(/Arun|open/i);
        expect(envelope.concerns.length).toBeGreaterThan(0);
        expect(envelope.recommendations.length).toBeGreaterThan(0);
        // Karthik holds nothing, so he must surface as spare capacity somewhere.
        expect(JSON.stringify(envelope)).toContain('Karthik Nair');
    });

    it('describes one member\'s workload in detail', async () => {
        const workload = await mcp.callToolJson<{
            member: { displayName: string };
            counts: { assignedOpen: number; overdue: number; blocked: number; inCurrentSprint: number };
            effort: { remainingHours: number | null };
        }>('analysis_member_workload', { member: 'Arun' });

        expect(workload.member.displayName).toBe('Arun Kumar');
        expect(workload.counts.assignedOpen).toBeGreaterThan(0);
        expect(workload.counts.overdue).toBe(1);
        expect(workload.effort.remainingHours).toBeGreaterThan(0);
    });

    it('ranks members by available capacity', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{ candidates: { member: string; openItems: number; availability: string }[] }>
        >('analysis_available_team_members');

        const top = envelope.facts.candidates[0]!;
        expect(top.member).toBe('Karthik Nair');
        expect(top.openItems).toBe(0);
    });

    it('resolves a member by partial name and reports an unknown name clearly', async () => {
        const byEmail = await mcp.callToolJson<{ member: { displayName: string } }>('analysis_member_workload', {
            member: 'divya.raman@kaartech.com'
        });
        expect(byEmail.member.displayName).toBe('Divya Raman');

        const unknown = await mcp.callTool('analysis_member_workload', { member: 'Nobody Here' });
        expect(unknown.isError).toBe(true);
        expect(textOf(unknown)).toMatch(/not|no team member/i);
    });
});

describe('deadline analysis', () => {
    it('rates deadline risk with reasons drawn from the item state', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                horizonDays: number;
                dueDateField: string | null;
                counts: { overdue: number; dueToday: number; withinHorizon: number; withoutDueDate: number };
                overdue: { item: { id: number }; risk: string; riskReasons: string[] }[];
                overdueRules?: { rule: string; count: number }[];
                upcoming: { item: { id: number }; risk: string; riskReasons: string[] }[];
            }>
        >('analysis_deadline_risk');

        expect(envelope.facts.dueDateField).toBe('Microsoft.VSTS.Scheduling.DueDate');
        expect(envelope.facts.overdue.map(entry => entry.item.id)).toContain(1111);
        expect(envelope.facts.upcoming.map(entry => entry.item.id)).toContain(1300);
        expect(envelope.facts.counts.overdue).toBe(1);
        expect(envelope.facts.overdueRules?.some(r => r.rule === 'due-date' && r.count === 1)).toBe(true);
        expect(envelope.facts.counts.dueToday).toBe(1);
        expect(envelope.concerns.length).toBeGreaterThan(0);
        // Every rated item explains itself.
        for (const entry of [...envelope.facts.overdue, ...envelope.facts.upcoming]) {
            expect(entry.riskReasons.length, `#${entry.item.id} has no risk reasons`).toBeGreaterThan(0);
        }
    });

    it('lists at-risk items in risk order with an explanation for each', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                highRisk: { item: { id: number }; risk: string; riskReasons: string[] }[];
                mediumRisk: { item: { id: number } }[];
            }>
        >('analysis_at_risk_items');

        expect(envelope.facts.highRisk.length).toBeGreaterThan(0);
        for (const entry of envelope.facts.highRisk) {
            expect(entry.risk).toBe('High Risk');
            expect(entry.riskReasons.length).toBeGreaterThan(0);
        }
        // The overdue task is the obvious risk.
        const flagged = [...envelope.facts.highRisk, ...envelope.facts.mediumRisk].map(entry => entry.item.id);
        expect(flagged).toContain(1111);
    });

    it('summarises deadlines across today, this week and overdue', async () => {
        const facts = await mcp.callToolJson<{
            counts: { overdue: number; dueToday: number; dueThisWeek: number; withoutDueDate: number };
            upcoming: { item: { id: number } }[];
        }>('analysis_deadlines');

        expect(facts.counts.overdue).toBe(1);
        expect(facts.counts.dueToday).toBe(1);
        expect(facts.counts.withoutDueDate).toBeGreaterThan(0);
        expect(facts.upcoming.map(entry => entry.item.id)).toContain(1300);
    });
});

describe('dependency analysis', () => {
    it('reports blocked items with the evidence that flagged each one', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{ count: number; items: { item: { id: number }; signals: { evidence: string }[] }[] }>
        >('analysis_blocked_items');

        expect(envelope.facts.count).toBe(2);
        const ids = envelope.facts.items.map(entry => entry.item.id).sort();
        expect(ids).toEqual([1112, 1120]);
        for (const entry of envelope.facts.items) {
            expect(entry.signals.length).toBeGreaterThan(0);
        }
    });

    it('maps real predecessor links, and flags the unresolved ones', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                edgeCount: number;
                unresolvedCount: number;
                edges: { from: { id: number }; to: { id: number }; resolved?: boolean }[];
            }>
        >('analysis_dependencies');

        expect(envelope.facts.edgeCount).toBeGreaterThan(0);
        // #1112 waits for #1120, which is still open.
        const edge = envelope.facts.edges.find(
            candidate =>
                (candidate.from.id === 1112 && candidate.to.id === 1120) ||
                (candidate.from.id === 1120 && candidate.to.id === 1112)
        );
        expect(edge, 'the 1112 <- 1120 dependency should be reported').toBeDefined();
        expect(envelope.facts.unresolvedCount).toBeGreaterThan(0);
    });

    it('finds the longest unresolved dependency chain', async () => {
        const envelope = await mcp.callToolJson<Envelope<{ chains: { length: number; items: { id: number }[] }[] }>>(
            'analysis_critical_dependencies'
        );
        expect(envelope.facts.chains.length).toBeGreaterThan(0);
        expect(envelope.facts.chains[0]!.length).toBeGreaterThanOrEqual(2);
    });

    it('reports items blocking the current release', async () => {
        const envelope = await mcp.callToolJson<Envelope<Record<string, unknown>>>('analysis_items_blocking_release');
        expect(envelope.kind).toBeTruthy();
        expect(JSON.stringify(envelope.facts)).toContain('1120');
    });

    it('invents no cross-team dependency when none exists', async () => {
        const envelope = await mcp.callToolJson<Envelope<{ dependencies?: unknown[]; count?: number }>>(
            'analysis_cross_team_dependencies'
        );
        // Every fixture item is inside the Platform area path.
        expect(envelope.facts.count ?? (envelope.facts.dependencies ?? []).length).toBe(0);
    });
});

describe('project health', () => {
    it('rates each dimension and explains why', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                project: string;
                team: string;
                health: {
                    overall: string;
                    dimensions: Record<string, { rating: string; reasons: string[] }>;
                };
            }>
        >('analysis_project_health');

        expect(envelope.facts.project).toBe('K4K');
        expect(envelope.facts.team).toBe('Platform');

        const health = envelope.facts.health;
        const dimensions = Object.entries(health.dimensions);
        expect(dimensions.length).toBeGreaterThan(3);
        for (const [name, dimension] of dimensions) {
            expect(['Good', 'Moderate Risk', 'At Risk', 'High Risk', 'Unknown']).toContain(dimension.rating);
            expect(dimension.reasons.length, `${name} has no reasons`).toBeGreaterThan(0);
        }
        expect(['Good', 'Moderate Risk', 'At Risk', 'High Risk', 'Unknown']).toContain(health.overall);

        // The overdue task, blocked story and unassigned high-priority work must be cited.
        const reasons = dimensions.flatMap(([, dimension]) => dimension.reasons).join(' ');
        expect(reasons).toMatch(/overdue|blocked|unassigned|carry/i);
        expect(envelope.recommendations.length).toBeGreaterThan(0);
    });

    it('produces a full project analysis including sprint and delivery data', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<Record<string, unknown>> & { sprintProgress?: unknown; deliveryMetrics?: unknown }
        >('analysis_project');
        expect(envelope.kind).toBeTruthy();
        expect(JSON.stringify(envelope)).toContain('Sprint 12');
    });
});

describe('productivity indicators', () => {
    it('reports delivery indicators without inventing a single score', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                team: string;
                delivery: { completedCount?: number; throughputPerWeek?: number | null };
            }>
        >('analysis_team_productivity');

        expect(envelope.facts.team).toBe('Platform');
        const serialised = JSON.stringify(envelope);
        // No fabricated percentage-style productivity score.
        expect(serialised).not.toMatch(/productivityScore|productivity_score/i);
        expect(envelope.methodology ?? '').not.toBe('');
    });

    it('counts completed work and reopened items from real history', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                metrics: {
                    completed: { items: number };
                    reopened: { count: number; items?: { id: number }[] };
                };
            }>
        >('analysis_team_delivery_metrics');

        expect(envelope.facts.metrics.completed.items).toBe(3);
        // #1300 went Active -> Closed -> Active, which is a real reopen.
        expect(envelope.facts.metrics.reopened.count).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(envelope.facts.metrics.reopened)).toContain('1300');
    });

    it('reports one member\'s sprint history', async () => {
        const envelope = await mcp.callToolJson<Envelope<{ member?: unknown; sprints?: unknown[] }>>(
            'analysis_member_sprint_history',
            { member: 'Arun' }
        );
        expect(JSON.stringify(envelope)).toContain('Sprint 1');
    });

    it('reports a member\'s completed work', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{ member: string; windowDays: number; completed: { id: number; closedDate: string | null }[] }>
        >('analysis_member_completed_work', { member: 'Divya' });

        expect(envelope.facts.member).toBe('Divya Raman');
        expect(envelope.facts.completed.map(item => item.id).sort()).toEqual([1400, 1402]);
        // The attribution caveat is stated rather than implied.
        expect((envelope.methodology ?? []).join(' ')).toContain('AssignedTo');
    });
});

describe('assignment recommendations', () => {
    it('recommends an owner for an unassigned item and states it cannot apply it', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                workItem: { id: number; title: string };
                currentAssignee: string | null;
                topCandidate: { member: string; suitability: number; reasons: string[]; cautions: string[] } | null;
                candidates: { member: string; suitability: number }[];
                actionRequired: string;
            }>
        >('analysis_assignment_recommendation', { work_item_id: 1210 });

        expect(envelope.facts.workItem.id).toBe(1210);
        expect(envelope.facts.currentAssignee).toBeNull();
        expect(envelope.facts.topCandidate?.member).toBeTruthy();
        expect(envelope.facts.topCandidate!.reasons.length).toBeGreaterThan(0);
        expect(envelope.facts.actionRequired.toLowerCase()).toContain('read-only');

        // Candidates are ranked, and the person holding nothing outranks the busiest.
        const ranking = envelope.facts.candidates.map(candidate => candidate.member);
        expect(ranking.indexOf('Karthik Nair')).toBeLessThan(ranking.indexOf('Arun Kumar'));

        // The scoring rules are published rather than left implicit.
        expect((envelope.methodology ?? []).join(' ')).toContain('Suitability');
    });

    it('recommends owners for every unassigned item', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                unassignedCount: number;
                recommendations: { workItem: { id: number }; suggested: string | null }[];
                actionRequired: string;
            }>
        >('analysis_assignment_recommendations');

        expect(envelope.facts.unassignedCount).toBe(2);
        expect(envelope.facts.recommendations.map(entry => entry.workItem.id).sort()).toEqual([1200, 1210]);
        expect(envelope.facts.actionRequired.toLowerCase()).toContain('read-only');
    });

    it('reports the current owner when the item is already assigned', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{ workItem: { id: number }; currentAssignee: string | null }>
        >('analysis_assignment_recommendation', { work_item_id: 1111 });
        expect(envelope.facts.currentAssignee).toBe('Arun Kumar');
        expect(envelope.observations.join(' ')).toContain('Arun Kumar');
    });
});

describe('daily team review', () => {
    it('covers every section the Team Lead expects', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<Record<string, unknown> & { date: string; team: string; currentSprint: { name: string } | null }>
        >('analysis_daily_team_review');

        expect(envelope.facts.team).toBe('Platform');
        expect(envelope.facts.currentSprint?.name).toBe('Sprint 12');

        const keys = Object.keys(envelope.facts);
        for (const section of [
            /dueToday|todaysWork/i,
            /overdue/i,
            /blocked/i,
            /highPriority/i,
            /unassigned/i,
            /deadline/i,
            /workload/i,
            /health/i
        ]) {
            expect(keys.some(key => section.test(key)), `no daily-review section matches ${section}`).toBe(true);
        }
        expect(envelope.observations.length).toBeGreaterThan(0);
        expect(envelope.recommendations.length).toBeGreaterThan(0);

        // Recommendations point at real ids rather than vague advice.
        expect(JSON.stringify(envelope.recommendations)).toMatch(/#\d{4}/);
    });
});

describe('backlog governance analysis', () => {
    it('returns counted categories across multiple dimensions without mutating work items', async () => {
        const envelope = await mcp.callToolJson<
            Envelope<{
                totalAnalyzed: number;
                uniqueItemsWithIssues: number;
                categoryCount: number;
                queryFolder: string;
                categories: { category: string; count: number; createQuery: boolean; queryName: string }[];
            }>
        >('analysis_backlog_quality');

        expect(envelope.kind).toBe('backlog_quality');
        expect(envelope.facts.totalAnalyzed).toBeGreaterThan(5);
        expect(envelope.facts.categoryCount).toBeGreaterThan(3);
        expect(envelope.facts.queryFolder).toBe('My Queries/KaarFlow');
        expect(envelope.facts.categories.length).toBeGreaterThan(3);
        expect(envelope.disclaimer).toContain('AI-GENERATED');
    });
});
