import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getActivityService } from '../../../services/teamlead/activity.service.js';
import { getTeamLeadReviewService } from '../../../services/teamlead/review.service.js';
import { registerTool } from '../../tool-registry.js';

const ACTIVITY_CATEGORIES = [
    'project_review',
    'team_review',
    'work_item_lookup',
    'search',
    'analysis',
    'report',
    'email_draft',
    'email_send',
    'confirmation',
    'recommendation_review',
    'maintenance'
] as const;

/**
 * Team Lead activity and review tools.
 *
 * The activity trail covers what the Team Lead did through this MCP server. It is
 * not a record of activity performed directly in Azure DevOps, which this server
 * has no ability to observe or change.
 */
export function registerTeamLeadTools(server: McpServer): void {
    registerTool(server, {
        name: 'tl_get_activity',
        title: 'Team Lead activity log',
        description:
            'Recent actions taken through this MCP server: timestamp, category, tool, redacted parameter and result summaries, outcome and confirmation status. Filterable by window, category, tool and outcome.',
        group: 'team-lead',
        inputSchema: {
            days: z.number().int().min(1).max(365).optional().describe('Look-back window in days. Default 7.'),
            category: z.enum(ACTIVITY_CATEGORIES).optional().describe('Filter to one activity category.'),
            tool: z.string().min(1).optional().describe('Filter to one tool name.'),
            outcome: z.enum(['success', 'error', 'rejected']).optional().describe('Filter by outcome.'),
            limit: z.number().int().min(1).max(1000).optional().describe('Maximum entries. Default 100.')
        },
        audit: { category: 'maintenance', action: 'Read Team Lead activity log' },
        handler: async args =>
            getActivityService().getActivity({
                ...(args.days ? { days: args.days as number } : {}),
                ...(args.category ? { category: args.category as (typeof ACTIVITY_CATEGORIES)[number] } : {}),
                ...(args.tool ? { tool: args.tool as string } : {}),
                ...(args.outcome ? { outcome: args.outcome as 'success' | 'error' | 'rejected' } : {}),
                ...(args.limit ? { limit: args.limit as number } : {})
            }),
        summarise: result => `${(result as { count: number }).count} activity record(s) returned.`
    });

    registerTool(server, {
        name: 'tl_get_activity_summary',
        title: 'Team Lead activity summary',
        description:
            'Aggregated activity: totals by category, tool, outcome and day, confirmation counts, emails drafted and sent, and subjects that were revisited more than once.',
        group: 'team-lead',
        inputSchema: { days: z.number().int().min(1).max(365).optional().describe('Window in days. Default 7.') },
        audit: { category: 'maintenance', action: 'Read Team Lead activity summary' },
        handler: async args => getActivityService().getSummary((args.days as number | undefined) ?? 7),
        summarise: result => {
            const summary = result as { totalActions: number; byDay: unknown[]; emailsSent: number };
            return `${summary.totalActions} action(s) across ${summary.byDay.length} day(s), ${summary.emailsSent} email(s) sent.`;
        }
    });

    registerTool(server, {
        name: 'tl_analyze_activity',
        title: 'Analyse Team Lead activity',
        description:
            'Interprets the activity trail: what is being monitored, how often, which subjects keep coming back, and where follow-through appears to stall. Reports observed patterns and improvement areas; produces no productivity percentage.',
        group: 'team-lead',
        inputSchema: { days: z.number().int().min(1).max(365).optional().describe('Window in days. Default 14.') },
        audit: { category: 'analysis', action: 'Analyse Team Lead activity' },
        handler: async args => getActivityService().analyzeActivity((args.days as number | undefined) ?? 14)
    });

    registerTool(server, {
        name: 'tl_analyze_productivity',
        title: 'Analyse Team Lead work patterns',
        description:
            'Combines the local activity trail with live Azure DevOps state to surface where attention is landing and where it is not: monitoring frequency, long-blocked items that follow-ups have not moved, repeatedly reviewed items that are still open, unassigned high-priority work, and drafts left unsent. No score is produced.',
        group: 'team-lead',
        inputSchema: { days: z.number().int().min(1).max(365).optional().describe('Window in days. Default 14.') },
        audit: { category: 'analysis', action: 'Analyse Team Lead productivity patterns' },
        handler: async args => await getTeamLeadReviewService().analyzeTlProductivity((args.days as number | undefined) ?? 14)
    });

    registerTool(server, {
        name: 'tl_analyze_work_management',
        title: 'Analyse Team Lead work management',
        description:
            'How this assistant is being used over a longer window: tool mix, category mix, days with activity versus days in the window, busiest day, and email discipline (drafted vs sent vs expired).',
        group: 'team-lead',
        inputSchema: { days: z.number().int().min(1).max(365).optional().describe('Window in days. Default 30.') },
        audit: { category: 'analysis', action: 'Analyse Team Lead work management' },
        handler: async args => await getTeamLeadReviewService().analyzeTlWorkManagement((args.days as number | undefined) ?? 30)
    });

    registerTool(server, {
        name: 'tl_get_weekly_review',
        title: 'Team Lead weekly review',
        description:
            'The weekly wrap-up: assistant activity this week, delivery and sprint completion trend, what needs attention (overdue, blocked, unassigned, cross-team dependencies, health concerns), per-member workload, and email activity - with recommended actions for the week ahead.',
        group: 'team-lead',
        audit: { category: 'report', action: 'Generate Team Lead weekly review' },
        handler: async () => await getTeamLeadReviewService().generateWeeklyReview(),
        summarise: result => {
            const envelope = result as {
                facts: { weekOf: string; attention: { projectHealth: string; overdue: number; blocked: number } };
                recommendations: string[];
            };
            return `[AI-GENERATED ANALYSIS] Week of ${envelope.facts.weekOf}: health ${envelope.facts.attention.projectHealth}, ${envelope.facts.attention.overdue} overdue, ${envelope.facts.attention.blocked} blocked, ${envelope.recommendations.length} recommended action(s).`;
        }
    });

    registerTool(server, {
        name: 'tl_purge_activity',
        title: 'Purge old activity records',
        description:
            'Deletes local audit records older than the given number of days. Retention control for the Team Lead\'s own machine; does not touch Azure DevOps.',
        group: 'team-lead',
        inputSchema: {
            older_than_days: z.number().int().min(1).max(3650).describe('Delete audit records older than this many days.')
        },
        audit: { category: 'maintenance', action: 'Purge Team Lead activity records' },
        handler: async args => getActivityService().purgeOlderThan(args.older_than_days as number)
    });
}
