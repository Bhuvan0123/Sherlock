import { describe, expect, it } from 'vitest';
import { OVERDUE_RULE, overdueRuleCount } from '../../src/services/analysis/overdue.js';
import { ResponseFormatter } from '../../src/core/response-formatter.js';
import { Telemetry } from '../../src/core/telemetry.js';

describe('canonical overdue rules', () => {
    it('labels due-date and planned-end separately', () => {
        const due = overdueRuleCount('due-date', 0);
        const planned = overdueRuleCount('planned-end', 6);
        expect(due.label).toBe(OVERDUE_RULE.dueDate.label);
        expect(planned.label).toBe(OVERDUE_RULE.plannedEnd.label);
        expect(due.count).not.toBe(planned.count);
    });
});

describe('brief standup formatting', () => {
    it('does not dump nested sprint comparison objects', () => {
        const md = ResponseFormatter.formatStructured({
            skillName: 'daily-standup-starter',
            mode: 'brief',
            summaries: {
                review: {
                    sprint: 'Sprint 12',
                    daysRemaining: 4,
                    active: 5,
                    proposed: 3,
                    blocked: 1,
                    overdueDueDate: 0,
                    overduePlannedEnd: 6,
                    unassigned: 2,
                    completion: 40,
                    comparison: { current: { completionRate: 40 }, previous: { completionRate: 50 } }
                }
            },
            findings: [{ severity: 'high', title: 'Blocked Work', count: 1, evidence: [], workItemIds: [1] }],
            recommendations: [{ priority: 'medium', action: 'Unblock #1', reason: 'blocked' }],
            queries: []
        });
        expect(md).toContain('# 🌅 Daily Standup');
        expect(md).toContain('| Active | 5 |');
        expect(md).toContain('Due-date overdue');
        expect(md).toContain('Planned-end overdue');
        expect(md).not.toContain('"completionRate"');
        expect(md.split('### Attention')[1]?.split('### Recommended Actions')[0]?.split('\n').filter(l => l.startsWith('- ')).length).toBeLessThanOrEqual(3);
    });
});

describe('telemetry counters', () => {
    it('tracks id queries vs body retrievals', () => {
        Telemetry.reset();
        Telemetry.recordIdQuery(10);
        Telemetry.recordBodyRetrieval(3);
        Telemetry.recordBudgetWarning('over budget');
        const stats = Telemetry.getStats();
        expect(stats.idQueries).toBe(1);
        expect(stats.idsRequested).toBe(10);
        expect(stats.bodiesReturned).toBe(3);
        expect(stats.budgetWarnings.length).toBe(1);
        expect(Telemetry.getReport()).toContain('ID queries: 1');
    });
});
