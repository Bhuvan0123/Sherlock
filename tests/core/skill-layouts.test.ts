import { describe, expect, it } from 'vitest';
import { ResponseFormatter } from '../../src/core/response-formatter.js';
import type { SkillExecutionResult } from '../../src/core/skill-executor.js';
import type { Finding, Recommendation } from '../../src/core/analysis-module.js';

const finding = (count: number, title = 'Blocked Work'): Finding => ({
    severity: 'high',
    title,
    count,
    evidence: count <= 3 ? [`#1`] : ['sample'],
    workItemIds: count <= 3 ? [1, 2].slice(0, count) : [1, 2, 3, 4]
});

const rec: Recommendation = {
    priority: 'high',
    action: 'Unblock the oldest dependency',
    reason: 'blocked chain',
    timeframe: 'Immediate'
};

function base(skillName: string, extra?: Partial<SkillExecutionResult>): SkillExecutionResult {
    return {
        skillName,
        mode: 'brief',
        summaries: {
            review: {
                team: 'Platform',
                sprint: 'S10',
                daysRemaining: 5,
                active: 4,
                proposed: 2,
                blocked: 1,
                overdueDueDate: 0,
                overduePlannedEnd: 3,
                unassigned: 2,
                completion: 40,
                members: [{ member: 'A', open: 3, active: 2, proposed: 1 }]
            },
            deadline: {
                overdueDueDate: 0,
                overduePlannedEnd: 33,
                overdueSprint: 0,
                overdueHistorical: 8
            },
            assignment: {
                unassigned: 2,
                suggestions: 2,
                rows: [
                    { id: 10, owner: 'A', reason: 'capacity', confidence: '70' },
                    { id: 11, owner: 'B', reason: 'same type', confidence: '55' }
                ]
            }
        },
        findings: [finding(1), finding(8, 'Stale work'), finding(4, 'Unassigned work')],
        recommendations: [rec, { ...rec, action: 'Triage planned-end items' }, { ...rec, action: 'Rebalance load' }],
        queries: [
            { title: 'Stale work', count: 8, url: 'https://example/q1' },
            { title: 'Unassigned work', count: 4, url: 'https://example/q2' }
        ],
        ...extra
    };
}

const ANALYSIS_SKILLS = [
    'daily-standup-starter',
    'backlog-data-quality',
    'workload-analysis',
    'sprint-health-analysis',
    'stale-work-analysis',
    'deadline-risk-analysis',
    'dependency-analysis',
    'delivery-forecast',
    'hierarchy-health-analysis',
    'schedule-variance-analysis',
    'project-health-analysis',
    'team-productivity-review',
    'tl-productivity-review',
    'weekly-team-review',
    'team-morning-brief',
    'daily-team-report',
    'work-assignment-recommendation'
];

describe('golden skill layouts', () => {
    for (const skill of ANALYSIS_SKILLS) {
        it(`${skill} brief/verbose/visual have distinct structure and no JSON dumps`, () => {
            const ctx = {
                organization: 'KEBS4KAAR',
                project: 'K4K',
                team: 'Platform',
                sprint: 'S10',
                daysRemaining: 5,
                date: '2026-08-19'
            };
            const brief = ResponseFormatter.formatStructured(base(skill, { mode: 'brief' }), ctx);
            const verbose = ResponseFormatter.formatStructured(base(skill, { mode: 'verbose' }), ctx);
            const visual = ResponseFormatter.formatStructured(base(skill, { mode: 'visual' }), ctx);

            for (const md of [brief, verbose, visual]) {
                expect(md).not.toContain('[object Object]');
                expect(md).toContain('ADO Work Items Modified: No');
                expect(md).not.toMatch(/"completionRate"/);
            }

            expect(brief).toMatch(/\| KPI \| Value \|/);
            expect(brief.split('### Attention')[1]?.split('###')[0]?.split('\n').filter(l => l.startsWith('- ')).length ?? 0).toBeLessThanOrEqual(3);

            expect(verbose).toContain('### Findings');
            expect(verbose).toContain('### Assumptions');

            expect(visual).toMatch(/\|/);
            expect(visual).toContain('### Findings');
            expect(visual).toContain('### Navigate');
        });
    }

    it('brief empty findings still renders KPI', () => {
        const md = ResponseFormatter.formatStructured({
            ...base('daily-standup-starter'),
            findings: [],
            recommendations: [],
            queries: []
        });
        expect(md).toContain('None.');
        expect(md).toContain('| Active | 4 |');
    });

    it('assignment visual includes recommendation disclaimer and table', () => {
        const md = ResponseFormatter.formatStructured(base('work-assignment-recommendation', { mode: 'visual' }));
        expect(md).toContain('Recommended Owner');
        expect(md).toContain('Recommendation only');
    });

    it('deadline brief keeps four types separate', () => {
        const md = ResponseFormatter.formatStructured(base('deadline-risk-analysis', { mode: 'brief' }));
        expect(md).toContain('Due Date');
        expect(md).toContain('Planned End');
        expect(md).toContain('does not mean there are no schedule risks');
    });
});
