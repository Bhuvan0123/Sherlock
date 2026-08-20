import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAdoClient } from '../../../azure-devops/client.js';
import { getWorkItemService } from '../../../azure-devops/work-item.service.js';
import { QueryEngine } from '../../../core/query-engine.js';
import { ContextManager } from '../../../core/context-manager.js';
import { getConfig } from '../../../config/env.js';
import { registerTool } from '../../tool-registry.js';
import { AppError } from '../../../utils/errors.js';

const QuerySchema = {
    project: z.string().optional().describe('Project name. Defaults to configured project.'),
    team: z.string().optional().describe('Team name. Defaults to configured team.'),
    preset: z.enum([
        'overdue', 'dueSoon', 'active', 'completed', 'unassigned', 'stale', 'highPriority', 
        'currentSprint', 'currentIteration', 'recentlyChanged', 'missingDates', 
        'missingEstimate', 'teamMemberWork', 'backlog', 'bugs', 'epics', 'features', 
        'userStories', 'tasks'
    ]).optional().describe('Pre-defined query preset.'),
    workItemTypes: z.array(z.string()).optional().describe('Filter by Work Item Types (e.g. Bug, User Story)'),
    states: z.array(z.string()).optional().describe('Filter by state (e.g. Active, Closed)'),
    assignedTo: z.array(z.string()).optional().describe('Filter by assignee name or email'),
    iteration: z.string().optional().describe('Filter by iteration path'),
    areaPath: z.string().optional().describe('Filter by area path'),
    priority: z.array(z.number()).optional().describe('Filter by priority (1, 2, 3...)'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    
    createdAfter: z.string().optional().describe('Created after ISO date'),
    createdBefore: z.string().optional().describe('Created before ISO date'),
    changedAfter: z.string().optional().describe('Changed after ISO date'),
    changedBefore: z.string().optional().describe('Changed before ISO date'),
    plannedStartAfter: z.string().optional().describe('Planned start after ISO date'),
    plannedStartBefore: z.string().optional().describe('Planned start before ISO date'),
    plannedEndAfter: z.string().optional().describe('Planned end after ISO date'),
    plannedEndBefore: z.string().optional().describe('Planned end before ISO date'),
    actualStartAfter: z.string().optional().describe('Actual start after ISO date'),
    actualStartBefore: z.string().optional().describe('Actual start before ISO date'),
    actualEndAfter: z.string().optional().describe('Actual end after ISO date'),
    actualEndBefore: z.string().optional().describe('Actual end before ISO date'),
    
    plannedStartMissing: z.boolean().optional().describe('Items missing a planned start date'),
    plannedEndMissing: z.boolean().optional().describe('Items missing a planned end/target date'),
    actualStartMissing: z.boolean().optional().describe('Items missing an actual start date'),
    actualEndMissing: z.boolean().optional().describe('Items missing an actual end/completion date'),
    assignedToMissing: z.boolean().optional().describe('Unassigned items'),
    estimateMissing: z.boolean().optional().describe('Items missing story points / estimates'),
    
    orderBy: z.string().optional().describe('Field to order by (e.g. ChangedDate)'),
    orderDirection: z.enum(['asc', 'desc']).optional().describe('Order direction'),
    limit: z.number().int().min(1).max(500).optional().describe('Maximum number of items to return. Default 100.')
};

export function registerQueryTools(server: McpServer): void {
    const queryEngine = new QueryEngine();

    registerTool(server, {
        name: 'ado_query_work_items',
        title: 'Query Work Items',
        description:
            'A central query engine to safely query Azure DevOps work items using structured filters and presets. Returns normalized work items with navigation URLs and pagination metadata.',
        group: 'azure-devops',
        inputSchema: QuerySchema,
        audit: {
            category: 'search',
            action: 'Query work items',
            subject: args => args.preset ? `preset:${args.preset}` : 'custom query'
        },
        handler: async (args: any) => {
            const project = args.project ?? getConfig().ado.project;
            const limit = args.limit ?? 100;
            
            const wiService = getWorkItemService();
            const client = getAdoClient();
            
            // Build Context
            const context = await ContextManager.buildContext();

            // Build WIQL
            const wiqlStr = await queryEngine.buildWIQL(args, context);
            
            // Execute WIQL to get IDs
            const startedAt = Date.now();
            const ids = await client.queryWorkItemIds(project, wiqlStr, limit + 1); // +1 to check for hasMore

            const hasMore = ids.length > limit;
            const idsToFetch = hasMore ? ids.slice(0, limit) : ids;

            // Fetch Normalized Items
            const workItems = await wiService.getByIds(idsToFetch, { includeRelations: true });
            
            return {
                query: args,
                source: 'Azure DevOps',
                organization: getConfig().ado.organization,
                project,
                totalCount: ids.length, // May be capped by WIQL limit, but accurate up to `limit + 1`
                returnedCount: workItems.length,
                hasMore,
                executedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                workItems
            };
        },
        summarise: result => {
            const typed = result as { returnedCount: number; hasMore: boolean };
            return `Returned ${typed.returnedCount} work items${typed.hasMore ? ' (more available)' : ''}.`;
        }
    });
}
