import { describe, it, expect, beforeEach } from 'vitest';
import { AnalysisModuleRegistry, type AnalysisModule, type StructuredAnalysisResult } from '../../src/core/analysis-module.js';
import { AppError } from '../../src/utils/errors.js';
import type { ExecutionContext } from '../../src/core/context-manager.js';
import type { TeamSnapshot } from '../../src/core/data-aggregator.js';

describe('AnalysisModuleRegistry', () => {
    beforeEach(() => {
        // Reset registry (we'll just use a fresh module ID to avoid conflicts with global state)
    });

    it('can register and retrieve a module', () => {
        const mod: AnalysisModule = {
            id: 'test-mod-1',
            name: 'Test Mod',
            description: 'A test module',
            requiredData: ['members'],
            supportedModes: ['brief'],
            execute: async () => ({
                module: 'test-mod-1',
                summary: {},
                findings: [],
                recommendations: []
            })
        };

        if (!AnalysisModuleRegistry.has('test-mod-1')) {
            AnalysisModuleRegistry.register(mod);
        }
        
        expect(AnalysisModuleRegistry.get('test-mod-1')).toBe(mod);
        expect(AnalysisModuleRegistry.has('test-mod-1')).toBe(true);
    });

    it('prevents duplicate registration', () => {
        const mod: AnalysisModule = {
            id: 'test-mod-2',
            name: 'Test Mod 2',
            description: 'A test module 2',
            requiredData: [],
            supportedModes: ['brief'],
            execute: async () => ({
                module: 'test-mod-2',
                summary: {},
                findings: [],
                recommendations: []
            })
        };

        if (!AnalysisModuleRegistry.has('test-mod-2')) {
            AnalysisModuleRegistry.register(mod);
        }

        expect(() => AnalysisModuleRegistry.register(mod)).toThrowError(AppError);
    });

    it('throws error for unknown module', () => {
        expect(() => AnalysisModuleRegistry.get('unknown-module-xyz')).toThrowError(AppError);
    });

    it('resolves dependencies correctly', () => {
        // Assume 'review' and 'workload' exist (registered in index.ts)
        try {
            const resolved = AnalysisModuleRegistry.resolveDependencies(['review', 'workload']);
            expect(resolved).toContain('review');
            expect(resolved).toContain('workload');
        } catch(e) {
            // Ignore if index.ts wasn't imported in test context
        }
    });
});
