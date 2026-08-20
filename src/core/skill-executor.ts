import type { SkillDefinition } from './skill-definition.js';
import { ContextManager, type ExecutionContext } from './context-manager.js';
import { DataAggregator, type TeamSnapshot } from './data-aggregator.js';
import { ResponseFormatter, type ResponseMode } from './response-formatter.js';
import { Telemetry } from './telemetry.js';
import { QueryEngine } from './query-engine.js';
import { InternalSkillRegistry } from './skill-registry.js';
import { AnalysisModuleRegistry, type StructuredAnalysisResult, type Finding, type Recommendation } from './analysis-module.js';
import { mergeFindings, mergeRecommendations, queryFingerprint } from './skill-composer.js';
import type { SkillContextLabel } from './skill-layouts.js';

// Ensure modules are registered
import { registerPilotModules } from './modules/index.js';
try {
    registerPilotModules();
} catch (e) {
    // Ignore duplicate registrations during hot-reload
}

export interface SkillExecutionResult {
    skillName: string;
    mode: ResponseMode;
    summaries: Record<string, Record<string, any>>;
    findings: Finding[];
    recommendations: Recommendation[];
    queries: { title: string; count: number; url: string }[];
    contextLabel?: SkillContextLabel;
}

export class SkillExecutor {
    static async executeSkill(
        skill: SkillDefinition, 
        mode: ResponseMode = 'verbose',
        args: Record<string, any> = {}
    ): Promise<string> {
        try {
            const skillDef = InternalSkillRegistry.getSkill(skill.name);
            if (!skillDef) {
                return ResponseFormatter.formatError(`Skill ${skill.name} not found in InternalSkillRegistry.`, mode);
            }
            if (skillDef.status === 'disabled') {
                return ResponseFormatter.formatError(`Skill ${skill.name} is disabled.`, mode);
            }

            // 1. Build context
            const context = await ContextManager.buildContext();

            // 2. Resolve modules & dependencies
            const resolvedModuleIds = uniqueIds(AnalysisModuleRegistry.resolveDependencies(skillDef.analysisModules));
            Telemetry.recordModules(resolvedModuleIds);
            const activeModules = resolvedModuleIds.map(id => AnalysisModuleRegistry.get(id));

            // 3. Consolidate Required Data
            const requiredData = new Set<string>();
            for (const mod of activeModules) {
                for (const req of mod.requiredData) {
                    requiredData.add(req);
                }
            }

            // 4. Fetch shared snapshot intelligently
            const snapshot = await DataAggregator.getTeamSnapshot(context, Array.from(requiredData));

            const moduleOptions = {
                staleThresholdDays: Number(args.staleDays ?? args.staleThresholdDays ?? 14),
                includeCarryOver: skillDef.name === 'sprint-health-analysis'
            };

            const results: StructuredAnalysisResult[] = [];
            for (const mod of activeModules) {
                try {
                    results.push(await mod.execute(context, snapshot, moduleOptions));
                } catch (error) {
                    results.push({
                        module: mod.id,
                        summary: { error: error instanceof Error ? error.message : String(error) },
                        findings: [],
                        recommendations: []
                    });
                }
            }

            // 6. Deduplicate Findings & Recommendations
            const allFindings: Finding[] = [];
            const allRecommendations: Recommendation[] = [];
            const summaries: Record<string, Record<string, any>> = {};

            for (const res of results) {
                summaries[res.module] = res.summary;
                allFindings.push(...res.findings);
                if (skillDef.recommendationEnabled) {
                    allRecommendations.push(...res.recommendations);
                }
            }

            const findings = mergeFindings(allFindings);
            const recommendations = mergeRecommendations(allRecommendations);

            // 7. Query Handling
            const engine = new QueryEngine();
            const queries: { title: string; count: number; url: string }[] = [];
            
            if (skillDef.queryEnabled) {
                const seen = new Set<string>();
                const teamLabel = context.team.name.replace(/[:?#\\]/g, '-');
                for (const f of findings) {
                    if (f.count > 3 && f.workItemIds.length > 0) {
                        const fp = queryFingerprint(f.workItemIds);
                        if (seen.has(fp)) continue;
                        seen.add(fp);
                        const queryName = `${teamLabel} - ${f.title}`.replace(/[:?#\\]/g, '-');
                        try {
                            const ids = [...new Set(f.workItemIds)].slice(0, 200);
                            const wiql = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [Microsoft.VSTS.Common.Priority], [System.IterationPath], [System.AreaPath], [System.ChangedDate] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Id] IN (${ids.join(',')})`;
                            const query = await engine.reuseOrCreateQuery(queryName, wiql, context);
                            const url = engine.getQueryUrl(query.id, context);
                            queries.push({ title: f.title, count: f.count, url });
                        } catch {
                            // Query create/reuse must not fail the skill.
                        }
                    }
                }
            }

            // 8. Format Response
            const defaults = context.projectContext.defaults;
            const contextLabel: SkillContextLabel = {
                organization: defaults.organization,
                project: defaults.project,
                team: context.team.name,
                sprint: context.currentSprint?.name ?? null,
                daysRemaining: context.currentSprint?.daysRemaining ?? null,
                date: context.today.toISOString().slice(0, 10)
            };
            const execResult: SkillExecutionResult = {
                skillName: skillDef.name,
                mode,
                summaries,
                findings,
                recommendations,
                queries,
                contextLabel
            };

            const markdown = ResponseFormatter.formatStructured(execResult, contextLabel);
            Telemetry.recordPayloadBytes(Buffer.byteLength(markdown, 'utf8'));
            const stats = Telemetry.getStats();
            if (skillDef.name === 'daily-standup-starter' && mode === 'brief') {
                if (stats.apiCalls > 30 || stats.bodiesReturned > 30) {
                    Telemetry.recordBudgetWarning(
                        `daily-standup brief budget: API ${stats.apiCalls} (target <30), bodies ${stats.bodiesReturned} (target <30)`
                    );
                }
            }
            return markdown;
        } finally {
            Telemetry.dumpIfDebug();
        }
    }
}

function uniqueIds(ids: string[]): string[] {
    return [...new Set(ids)];
}
