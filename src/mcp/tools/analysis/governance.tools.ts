import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getWorkItemService } from '../../../services/azure-devops/work-item.service.js';
import { getTeamService } from '../../../services/azure-devops/team.service.js';
import { getSprintService } from '../../../services/azure-devops/sprint.service.js';
import { getProjectContext } from '../../../services/azure-devops/context.js';
import { FieldMappingService } from '../../../services/azure-devops/field-mapping.js';
import { getConfig } from '../../../config/env.js';
import { registerTool } from '../../tool-registry.js';
import { buildEnvelope } from '../../../services/analysis/types.js';
import { analyseBacklog, buildRelationMaps } from '../../../services/analysis/governance.service.js';
import { evaluateHierarchy, evaluateStaleWork } from '../../../services/analysis/governance.service.js';
import { calculateScheduleVariance } from '../../../services/analysis/schedule.service.js';
import type { BacklogContext } from '../../../services/analysis/backlog/types.js';
import type { WorkItem } from '../../../services/azure-devops/types.js';

const SCAN_LIMIT = 500;

export function registerGovernanceTools(server: McpServer): void {
    registerTool(server, {
        name: 'analysis_backlog_quality',
        title: 'Backlog governance and data quality analysis',
        description:
            'Broad Platform backlog governance scan: hierarchy, required fields, titles/descriptions, dates, state, ownership, estimates, sprint/area, bugs, stale work, duplicates, dependencies and discovered custom fields. Returns counted categories (create a saved query when count > 3). Does not modify work items.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Analyse backlog quality' },
        handler: async () => {
            const config = getConfig();
            const wiService = getWorkItemService();
            const fieldMap = new FieldMappingService(config.ado.project);

            const [itemsPage, mapping, types, members, sprint, available] = await Promise.all([
                wiService.query([], { limit: SCAN_LIMIT, includeCompleted: true, includeRelations: true }),
                fieldMap.getCanonicalMap(),
                getProjectContext().getWorkItemTypeNames(),
                getTeamService().getMembers().catch(() => []),
                getSprintService().getCurrentSprint().catch(() => null),
                getProjectContext().getAvailableFields()
            ]);

            const truncated = itemsPage.length >= SCAN_LIMIT;
            const maps = buildRelationMaps(itemsPage);
            let extra: WorkItem[] = [];
            if (maps.missingIds.length > 0) {
                extra = await wiService.getByIds(maps.missingIds.slice(0, 200), { includeRelations: true });
            }
            const all = [...itemsPage];
            const seen = new Set(all.map(i => i.id));
            for (const item of extra) {
                if (!seen.has(item.id)) {
                    all.push(item);
                    seen.add(item.id);
                }
            }
            const rebuilt = buildRelationMaps(all);

            const ctx: BacklogContext = {
                items: all,
                byId: rebuilt.byId,
                childrenOf: rebuilt.childrenOf,
                parentOf: rebuilt.parentOf,
                teamMemberNames: new Set(members.map(m => m.displayName).filter(Boolean)),
                teamAreaHints: ['Platform', config.ado.team, config.ado.project],
                currentSprintPath: sprint?.path ?? null,
                currentSprintStart: sprint?.startDate ? new Date(sprint.startDate) : null,
                currentSprintEnd: sprint?.finishDate ? new Date(sprint.finishDate) : null,
                now: new Date(),
                truncated,
                scannedLimit: SCAN_LIMIT,
                fields: {
                    plannedStart: mapping.plannedStart.length > 0,
                    plannedEnd: mapping.plannedEnd.length > 0,
                    actualStart: mapping.actualStart.length > 0,
                    actualEnd: mapping.actualEnd.length > 0,
                    description: available.has('System.Description'),
                    acceptanceCriteria: [...available].some(f => /acceptancecriteria/i.test(f)),
                    estimate: true,
                    remainingWork: true,
                    severity: true,
                    risk: true
                },
                workItemTypes: types
            };

            const result = analyseBacklog(ctx);

            const facts = {
                organization: config.ado.organization,
                project: config.ado.project,
                team: config.ado.team,
                workItemTypesDiscovered: types,
                dateFieldMapping: {
                    plannedStart: mapping.plannedStart,
                    plannedEnd: mapping.plannedEnd,
                    actualStart: mapping.actualStart,
                    actualEnd: mapping.actualEnd
                },
                truncated,
                scannedLimit: SCAN_LIMIT,
                totalAnalyzed: result.totalAnalyzed,
                openCount: result.openCount,
                uniqueItemsWithIssues: result.issuesFound,
                categoryCount: result.categories.length,
                severityCounts: result.severityCounts,
                categories: result.categories.map(c => ({
                    category: c.category,
                    dimension: c.dimension,
                    count: c.count,
                    severity: c.severity,
                    reviewRecommended: c.reviewRecommended,
                    description: c.description,
                    queryName: c.queryName,
                    queryDescription: c.queryDescription,
                    createQuery: c.createQuery,
                    itemIds: c.createQuery ? undefined : c.itemIds,
                    samples: c.samples,
                    suggestedWiql: c.createQuery
                        ? `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${c.itemIds.slice(0, 200).join(', ')})`
                        : null
                })),
                queryHints: result.queryHints,
                defaultColumns: result.defaultColumns,
                queryFolder: 'My Queries/KaarFlow'
            };

            return buildEnvelope('backlog_quality', facts, {
                observations: result.insights,
                concerns: result.categories
                    .filter(c => c.severity === 'Critical' || c.severity === 'High')
                    .slice(0, 8)
                    .map(c => `${c.category}: ${c.count} item(s) (${c.severity})`),
                recommendations: [
                    'For every category with count > 3, call create_ado_query with queryHints[].queryName, queryDescription, suggested WIQL and defaultColumns. Store under My Queries/KaarFlow (tool default). Reuse QUERY_ALREADY_EXISTS URLs.',
                    'Do not dump item lists for categories with more than three matches; use the saved query URL.',
                    'Do not modify work items. Present evidence-based cleanup recommendations only.'
                ],
                methodology: [
                    'Single-pass scan of team-scoped work items (open plus completed) with relations, plus one batch fetch of missing parent/child ids.',
                    'Checks cover hierarchy, completeness, titles/descriptions, type-specific quality, dates, state, ownership, sprint/area, estimates, bugs, stale work, duplicates, dependencies and discovered custom fields.',
                    'Severity considers state, priority and delivery impact. Uncertain cases are marked reviewRecommended.',
                    'Saved queries (count > 3) use an ID IN WIQL of the measured set so structural checks stay accurate.',
                    ...result.limitations
                ]
            });
        },
        summarise: result => {
            const envelope = result as { facts?: { uniqueItemsWithIssues?: number; categoryCount?: number } };
            return `Backlog governance: ${envelope.facts?.uniqueItemsWithIssues ?? 0} items across ${envelope.facts?.categoryCount ?? 0} categories.`;
        }
    });

    registerTool(server, {
        name: 'analysis_schedule_variance',
        title: 'Schedule variance analysis',
        description: 'Calculates the schedule variance, planned duration vs actual duration, and start/completion delays for active and completed items.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Analyse schedule variance' },
        handler: async () => {
            const items = await getWorkItemService().query([], { limit: 100, includeCompleted: true });
            const variances = items
                .map(item => ({
                    workItem: item,
                    variance: calculateScheduleVariance(item)
                }))
                .filter(v => v.variance.startVarianceDays !== null || v.variance.completionVarianceDays !== null);

            return { totalAnalyzed: items.length, itemsWithVarianceData: variances };
        }
    });

    registerTool(server, {
        name: 'analysis_hierarchy_health',
        title: 'Hierarchy health analysis',
        description: 'Analyzes the backlog for orphaned work items (Tasks without Stories, Stories without Features) and empty parents.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Analyse hierarchy health' },
        handler: async () => {
            const wiService = getWorkItemService();
            const items = await wiService.query([], { limit: 200, includeRelations: true });

            const issues = [];
            for (const item of items) {
                const childrenRels = item.relations.filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward');
                const itemIssues = evaluateHierarchy(item, new Array(childrenRels.length).fill({ type: 'unknown' }) as WorkItem[]);
                if (itemIssues.length > 0) {
                    issues.push({ workItem: item, issues: itemIssues });
                }
            }
            return { totalAnalyzed: items.length, issuesFound: issues.length, itemsWithIssues: issues };
        }
    });

    registerTool(server, {
        name: 'analysis_stale_work',
        title: 'Stale work analysis',
        description: 'Identifies active work items that have had no updates in 7, 14, or 30 days.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Analyse stale work' },
        handler: async () => {
            const items = await getWorkItemService().query([], { limit: 200 });
            const issues = [];
            for (const item of items) {
                const stale = evaluateStaleWork(item);
                if (stale) {
                    issues.push({ workItem: item, issue: stale });
                }
            }
            return { totalAnalyzed: items.length, staleItemsFound: issues.length, staleItems: issues };
        }
    });
}
