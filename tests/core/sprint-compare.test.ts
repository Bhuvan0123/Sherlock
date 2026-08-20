import { describe, it, expect } from 'vitest';
import { compareSprintRates, ratesFromTotals } from '../../src/core/sprint-compare.js';
import { InternalSkillRegistry } from '../../src/core/skill-registry.js';
import { AnalysisModuleRegistry } from '../../src/core/analysis-module.js';
import { registerPilotModules } from '../../src/core/modules/index.js';

describe('sprint rate comparison', () => {
    it('compares completion as percentage points, not raw counts', () => {
        const current = ratesFromTotals({
            items: 50,
            completed: 36,
            inProgress: 10,
            proposed: 4,
            blocked: 2,
            overdue: 1,
            carryOver: 5
        });
        const previous = ratesFromTotals({
            items: 80,
            completed: 48,
            inProgress: 20,
            proposed: 12,
            blocked: 8,
            overdue: 6,
            carryOver: 16
        });
        expect(current.completionRate).toBe(72);
        expect(previous.completionRate).toBe(60);
        const cmp = compareSprintRates(current, previous);
        expect(cmp.completionRateChangePp).toBe(12);
        expect(current.planned).not.toBe(previous.planned);
        expect(cmp.throughputChange).toBe(36 - 48);
    });

    it('returns null rates when the sprint has no items', () => {
        const empty = ratesFromTotals({
            items: 0,
            completed: 0,
            inProgress: 0,
            proposed: 0,
            blocked: 0,
            overdue: 0,
            carryOver: 0
        });
        expect(empty.completionRate).toBeNull();
        expect(compareSprintRates(empty, empty).completionRateChangePp).toBeNull();
    });
});

describe('migrated builtin skills and modules', () => {
    it('registers analysis skills for the markdown catalogue (except email/router)', () => {
        for (const name of [
            'sprint-health-analysis',
            'stale-work-analysis',
            'deadline-risk-analysis',
            'dependency-analysis',
            'delivery-forecast',
            'work-assignment-recommendation'
        ]) {
            expect(InternalSkillRegistry.hasSkill(name)).toBe(true);
        }
        expect(InternalSkillRegistry.hasSkill('skill-index')).toBe(false);
        expect(InternalSkillRegistry.hasSkill('team-email-assistant')).toBe(false);
    });

    it('registers sprint and stale-work modules', () => {
        registerPilotModules();
        expect(AnalysisModuleRegistry.has('sprint')).toBe(true);
        expect(AnalysisModuleRegistry.has('stale-work')).toBe(true);
        expect(AnalysisModuleRegistry.has('risk')).toBe(true);
        expect(AnalysisModuleRegistry.get('stale-work').description).toMatch(/14/);
    });
});
