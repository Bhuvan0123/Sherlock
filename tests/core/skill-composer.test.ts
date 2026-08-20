import { describe, expect, it } from 'vitest';
import {
    composeSkillDefinition,
    formatCompositionPreview,
    mergeFindings,
    mergeRecommendations,
    parseCompositionRequest,
    queryFingerprint
} from '../../src/core/skill-composer.js';
import { InternalSkillRegistry } from '../../src/core/skill-registry.js';
import type { SkillDefinition } from '../../src/core/skill-definition.js';
import type { Finding, Recommendation } from '../../src/core/analysis-module.js';
import { AppError } from '../../src/utils/errors.js';

describe('parseCompositionRequest', () => {
    it('maps management phrases to built-in skills', () => {
        const parsed = parseCompositionRequest(
            'Create a weekly management review combining sprint health, workload, backlog quality and delivery risk.'
        );
        expect(parsed.sourceSkills).toEqual(
            expect.arrayContaining([
                'sprint-health-analysis',
                'backlog-data-quality',
                'deadline-risk-analysis'
            ])
        );
        expect([...parsed.sourceSkills, ...parsed.modules]).toContain('workload');
    });
});

describe('snapshot composition', () => {
    it('keeps composed skills as a module snapshot when the source custom skill later changes', () => {
        InternalSkillRegistry.registerSkill({
            id: 'custom-skill-a',
            name: 'skill-a-source',
            type: 'custom',
            description: 'A',
            defaultMode: 'brief',
            supportedModes: ['brief'],
            requiredContext: [],
            requiredData: [],
            analysisModules: ['workload', 'deadline'],
            recommendationEnabled: true,
            queryEnabled: true,
            navigationEnabled: true,
            emailEnabled: false,
            status: 'active'
        });
        const composed = composeSkillDefinition({
            name: 'skill-c-snapshot',
            sourceSkills: ['skill-a-source', 'sprint-health-analysis']
        });
        const snapshot = [...composed.resolvedModules];
        InternalSkillRegistry.registerSkill({
            ...InternalSkillRegistry.getSkill('skill-a-source')!,
            analysisModules: ['stale-work']
        });
        expect(snapshot).toEqual(expect.arrayContaining(['workload', 'deadline', 'sprint']));
        expect(snapshot).not.toContain('stale-work');
        InternalSkillRegistry.removeSkill('skill-a-source');
    });
});

describe('module composition', () => {
    it('unions modules and resolves dependencies once', () => {
        const result = composeSkillDefinition({
            name: 'weekly-management-review',
            description: 'Weekly management overview for the Platform team.',
            modules: ['sprint', 'workload', 'backlog', 'risk', 'deadline']
        });
        expect(result.definition.type).toBe('custom');
        expect(result.resolvedModules.filter(id => id === 'workload')).toHaveLength(1);
        expect(result.resolvedModules).toEqual(
            expect.arrayContaining(['sprint', 'workload', 'backlog', 'risk', 'deadline'])
        );
        expect(formatCompositionPreview(result)).toContain('# Skill Composition Preview');
        expect(formatCompositionPreview(result)).toContain('Shared data reused across modules.');
    });
});

describe('skill composition', () => {
    it('flattens built-in skill modules without nesting execution', () => {
        const result = composeSkillDefinition({
            name: 'mgmt-from-skills',
            sourceSkills: [
                'sprint-health-analysis',
                'workload-analysis',
                'backlog-data-quality',
                'deadline-risk-analysis'
            ]
        });
        const workloadHits = result.resolvedModules.filter(id => id === 'workload');
        expect(workloadHits).toHaveLength(1);
        expect(result.resolvedModules).toEqual(
            expect.arrayContaining(['sprint', 'workload', 'backlog', 'deadline', 'risk'])
        );
    });

    it('composes built-in plus custom by unioning modules', () => {
        const custom: SkillDefinition = {
            id: 'custom-weekly-platform-review',
            name: 'weekly-platform-review',
            type: 'custom',
            description: 'custom',
            defaultMode: 'brief',
            supportedModes: ['brief'],
            requiredContext: [],
            requiredData: [],
            analysisModules: ['workload', 'deadline'],
            recommendationEnabled: true,
            queryEnabled: true,
            navigationEnabled: true,
            emailEnabled: false,
            status: 'active'
        };
        InternalSkillRegistry.registerSkill(custom);
        const result = composeSkillDefinition({
            name: 'nested-compose',
            sourceSkills: ['weekly-platform-review', 'sprint-health-analysis']
        });
        expect(result.resolvedModules.filter(id => id === 'workload')).toHaveLength(1);
        expect(result.resolvedModules).toEqual(expect.arrayContaining(['workload', 'deadline', 'sprint']));
        InternalSkillRegistry.removeSkill('weekly-platform-review');
    });
});

describe('natural language robustness', () => {
    it('maps equivalent sprint phrases to sprint-health-analysis', () => {
        for (const phrase of [
            'Analyse sprint health.',
            'Give me sprint performance.',
            'Compare this sprint with the last one.',
            'Show me sprint delivery.'
        ]) {
            expect(parseCompositionRequest(phrase).sourceSkills).toContain('sprint-health-analysis');
        }
    });

    it('does not persist an ambiguous management report', async () => {
        const { resolveNaturalLanguageIntent } = await import('../../src/core/skill-composer.js');
        const intent = resolveNaturalLanguageIntent('Give me a management report.');
        expect(intent.ambiguous).toBe(true);
        expect(intent.persist).toBe(false);
    });

    it('recommends analysis for a slipping sprint without creating a skill', async () => {
        const { resolveNaturalLanguageIntent } = await import('../../src/core/skill-composer.js');
        const intent = resolveNaturalLanguageIntent('I want to understand why the sprint is slipping.');
        expect(intent.persist).toBe(false);
        expect(intent.modules).toEqual(expect.arrayContaining(['sprint', 'deadline', 'workload', 'risk']));
    });

    it('maps a morning risk request onto existing modules', () => {
        const parsed = parseCompositionRequest(
            'Create a skill that checks Platform workload, overdue work, blocked work, stale work and sprint risk.'
        );
        expect([...parsed.sourceSkills, ...parsed.modules]).toEqual(
            expect.arrayContaining([
                'workload',
                'stale-work-analysis',
                'deadline-risk-analysis',
                'dependency-analysis',
                'sprint',
                'risk'
            ])
        );
    });

    it('maps unassigned high-priority work to assignment', () => {
        const parsed = parseCompositionRequest('Also include unassigned high-priority work.');
        expect(parsed.modules).toContain('assignment');
    });
});

describe('capability catalogue', () => {
    it('groups capabilities without exposing TypeScript paths', async () => {
        const { formatCapabilityCatalogue } = await import('../../src/core/skill-composer.js');
        const md = formatCapabilityCatalogue([{ name: 'my-review', description: 'custom', status: 'active' }]);
        expect(md).toContain('## Sprint');
        expect(md).toContain('## My Skills');
        expect(md).toContain('/my-review');
        expect(md).not.toContain('src/core');
    });
});

describe('composition errors', () => {
    it('rejects a missing skill', () => {
        expect(() =>
            composeSkillDefinition({ name: 'x', sourceSkills: ['definitely-missing-skill'] })
        ).toThrowError(/was not found/);
    });

    it('rejects an unknown module', () => {
        expect(() => composeSkillDefinition({ name: 'x', modules: ['telepathy'] })).toThrowError(
            /not currently available/
        );
    });

    it('rejects a disabled skill', () => {
        InternalSkillRegistry.registerSkill({
            id: 'custom-off',
            name: 'off-skill',
            type: 'custom',
            description: 'off',
            defaultMode: 'brief',
            supportedModes: ['brief'],
            requiredContext: [],
            requiredData: [],
            analysisModules: ['workload'],
            recommendationEnabled: false,
            queryEnabled: false,
            navigationEnabled: false,
            emailEnabled: false,
            status: 'disabled'
        });
        expect(() => composeSkillDefinition({ name: 'x', sourceSkills: ['off-skill'] })).toThrowError(/disabled/);
        InternalSkillRegistry.removeSkill('off-skill');
    });

    it('rejects unknown tools via AppError on compose of empty unknown', () => {
        expect(() => composeSkillDefinition({ name: 'empty' })).toThrow(AppError);
    });
});

describe('finding and recommendation deduplication', () => {
    it('merges equivalent findings by work-item set', () => {
        const a: Finding = {
            severity: 'medium',
            title: 'Overdue work',
            count: 18,
            evidence: ['due'],
            workItemIds: [1, 2, 3, 4]
        };
        const b: Finding = {
            severity: 'high',
            title: 'Overdue risky work',
            count: 18,
            evidence: ['risk'],
            workItemIds: [4, 3, 2, 1]
        };
        const merged = mergeFindings([a, b]);
        expect(merged).toHaveLength(1);
        expect(merged[0]?.severity).toBe('high');
        expect(merged[0]?.evidence).toEqual(['due', 'risk']);
        expect(queryFingerprint(a.workItemIds)).toBe(queryFingerprint(b.workItemIds));
    });

    it('deduplicates similar recommendations and ranks by priority', () => {
        const recs: Recommendation[] = [
            { priority: 'low', action: 'Review overdue work.', reason: 'a', confidence: 0.2 },
            { priority: 'high', action: 'Review overdue work', reason: 'b', confidence: 0.9 },
            { priority: 'medium', action: 'Unblock sprint items', reason: 'c' }
        ];
        const merged = mergeRecommendations(recs);
        expect(merged).toHaveLength(2);
        expect(merged[0]?.action).toMatch(/overdue/i);
        expect(merged[0]?.priority).toBe('high');
        expect(merged[0]?.confidence).toBe(0.9);
    });
});
