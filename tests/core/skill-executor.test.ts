import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InternalSkillRegistry } from '../../src/core/skill-registry.js';
import { SkillExecutor } from '../../src/core/skill-executor.js';
import { AppError } from '../../src/utils/errors.js';
import type { SkillDefinition } from '../../src/core/skill-definition.js';
import type { Skill } from '../../src/skills/registry.js';

describe('InternalSkillRegistry', () => {
    it('registers built-in skills by default', () => {
        expect(InternalSkillRegistry.hasSkill('daily-standup-starter')).toBe(true);
        expect(InternalSkillRegistry.hasSkill('backlog-data-quality')).toBe(true);
        expect(InternalSkillRegistry.hasSkill('workload-analysis')).toBe(true);
    });

    it('can register and retrieve a custom skill', () => {
        const customSkill: SkillDefinition = {
            id: 'custom-test',
            name: 'test-custom-skill',
            type: 'custom',
            description: 'Test description.',
            defaultMode: 'brief',
            supportedModes: ['brief'],
            requiredContext: [],
            requiredData: [],
            analysisModules: [],
            recommendationEnabled: false,
            queryEnabled: false,
            navigationEnabled: false,
            emailEnabled: false,
            status: 'active'
        };

        InternalSkillRegistry.registerSkill(customSkill);
        expect(InternalSkillRegistry.getSkill('test-custom-skill')).toBe(customSkill);
    });

    it('cannot remove or disable built-in skills', () => {
        expect(() => InternalSkillRegistry.removeSkill('daily-standup-starter')).toThrowError(AppError);
        expect(() => InternalSkillRegistry.disableSkill('daily-standup-starter')).toThrowError(AppError);
    });

    it('can disable and remove custom skills', () => {
        InternalSkillRegistry.disableSkill('test-custom-skill');
        expect(InternalSkillRegistry.getSkill('test-custom-skill')?.status).toBe('disabled');

        InternalSkillRegistry.removeSkill('test-custom-skill');
        expect(InternalSkillRegistry.hasSkill('test-custom-skill')).toBe(false);
    });
});

describe('Generic SkillExecutor', () => {
    // We mock the underlying context and services mostly, but the executor logic itself is pure TS
    // Since this is a unit test, we might run into real HTTP calls if we execute real modules.
    // Let's test the generic error branches first.

    it('handles unknown skills', async () => {
        const dummySkill: SkillDefinition = {
            id: 'custom-unknown',
            name: 'unknown-skill',
            type: 'custom',
            description: '',
            defaultMode: 'brief',
            supportedModes: ['brief'],
            requiredContext: [],
            requiredData: [],
            analysisModules: [],
            recommendationEnabled: false,
            queryEnabled: false,
            navigationEnabled: false,
            emailEnabled: false,
            status: 'active'
        };
        const result = await SkillExecutor.executeSkill(dummySkill, 'brief');
        expect(result).toContain('not found in InternalSkillRegistry');
    });

    it('rejects disabled skills', async () => {
        const disabledSkill: SkillDefinition = {
            id: 'custom-disabled',
            name: 'disabled-custom-skill',
            type: 'custom',
            description: 'Test disabled.',
            defaultMode: 'brief',
            supportedModes: ['brief'],
            requiredContext: [],
            requiredData: [],
            analysisModules: [],
            recommendationEnabled: false,
            queryEnabled: false,
            navigationEnabled: false,
            emailEnabled: false,
            status: 'disabled'
        };
        InternalSkillRegistry.registerSkill(disabledSkill);

        const dummySkill: SkillDefinition = {
            id: 'custom-disabled',
            name: 'disabled-custom-skill',
            type: 'custom',
            description: '',
            defaultMode: 'brief',
            supportedModes: ['brief'],
            requiredContext: [],
            requiredData: [],
            analysisModules: [],
            recommendationEnabled: false,
            queryEnabled: false,
            navigationEnabled: false,
            emailEnabled: false,
            status: 'active'
        };
        const result = await SkillExecutor.executeSkill(dummySkill, 'brief');
        expect(result).toContain('is disabled');
    });
});
