import type { ExecutionContext } from './context-manager.js';
import type { TeamSnapshot } from './data-aggregator.js';
import { AppError } from '../utils/errors.js';

export interface Finding {
    severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
    title: string;
    count: number;
    evidence: any[];
    workItemIds: number[];
}

export interface Recommendation {
    priority: 'high' | 'medium' | 'low';
    action: string;
    reason: string;
    confidence?: number;
    timeframe?: 'Immediate' | 'Next Standup' | 'Next Sprint' | 'Backlog Refinement';
    finding?: string;
}

export interface StructuredAnalysisResult {
    module: string;
    summary: Record<string, any>;
    findings: Finding[];
    recommendations: Recommendation[];
}

export interface AnalysisModule {
    id: string;
    name: string;
    description: string;
    requiredData: string[];
    supportedModes: string[];
    dependencies?: string[];
    execute(context: ExecutionContext, data: TeamSnapshot, options?: Record<string, unknown>): Promise<StructuredAnalysisResult>;
}

export class AnalysisModuleRegistry {
    private static modules: Map<string, AnalysisModule> = new Map();

    static register(module: AnalysisModule): void {
        if (this.modules.has(module.id)) {
            throw new AppError('INVALID_INPUT', `Analysis module ${module.id} is already registered.`);
        }
        this.modules.set(module.id, module);
    }

    static get(id: string): AnalysisModule {
        const mod = this.modules.get(id);
        if (!mod) {
            throw new AppError('NOT_FOUND', `Analysis module not found: ${id}`);
        }
        return mod;
    }

    static list(): AnalysisModule[] {
        return Array.from(this.modules.values());
    }

    static has(id: string): boolean {
        return this.modules.has(id);
    }

    static resolveDependencies(requestedIds: string[]): string[] {
        const resolved = new Set<string>();
        const queue = [...requestedIds];
        while (queue.length > 0) {
            const id = queue.shift()!;
            if (!this.has(id)) {
                throw new AppError('NOT_FOUND', `Unknown analysis module requested: ${id}`);
            }
            if (!resolved.has(id)) {
                resolved.add(id);
                const mod = this.get(id);
                if (mod.dependencies) {
                    for (const dep of mod.dependencies) {
                        if (!resolved.has(dep)) queue.push(dep);
                    }
                }
            }
        }
        return Array.from(resolved);
    }
}
