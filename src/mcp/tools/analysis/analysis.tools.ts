import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAssignmentService } from '../../../services/analysis/assignment.service.js';
import { getDeadlineService } from '../../../services/analysis/deadline.service.js';
import { getDependencyService } from '../../../services/analysis/dependency.service.js';
import { getProductivityService } from '../../../services/analysis/productivity.service.js';
import { getProjectAnalysisService } from '../../../services/analysis/project-analysis.service.js';
import { getReviewService } from '../../../services/analysis/review.service.js';
import { getWorkloadService } from '../../../services/analysis/workload.service.js';
import { registerTool } from '../../tool-registry.js';
import type { AnalysisEnvelope } from '../../../services/analysis/types.js';

const memberArg = z.string().min(1).describe('Team member name or email; resolved against real team membership.');

/** Summary line for an analysis envelope, used for the response headline. */
function envelopeSummary(result: unknown): string {
    const envelope = result as AnalysisEnvelope<unknown>;
    const first = envelope.observations?.[0] ?? envelope.kind;
    return `[AI-GENERATED ANALYSIS] ${first}${
        envelope.concerns?.length ? ` (${envelope.concerns.length} concern(s), ${envelope.recommendations.length} recommendation(s))` : ''
    }`;
}

/**
 * Analysis tools. Every result separates measured Azure DevOps `facts` from
 * generated `observations`, `concerns` and `recommendations`, and carries an
 * explicit disclaimer plus the thresholds used.
 */
export function registerAnalysisTools(server: McpServer): void {
    registerTool(server, {
        name: 'analysis_project_health',
        title: 'Project health',
        description:
            'Rates project health across delivery, schedule, workload, blocked work, sprint health, dependency risk and assignment coverage, using published thresholds. Returns the measured counts, the reason behind every rating, and recommended follow-ups. Read-only: recommendations are advisory.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Analyse project health' },
        handler: async () => await getProjectAnalysisService().getProjectHealth(),
        summarise: result => {
            const envelope = result as AnalysisEnvelope<{ health: { overall: string } }>;
            return `[AI-GENERATED ANALYSIS] Overall project health: ${envelope.facts.health.overall}. ${envelope.concerns.length} concern(s), ${envelope.recommendations.length} recommendation(s).`;
        }
    });

    registerTool(server, {
        name: 'analysis_project',
        title: 'Full project analysis',
        description:
            'The deepest project view: health ratings plus current sprint detail (including carry-over evidence) and 30-day delivery metrics (throughput, cycle time, lead time, reopened items). Use for "analyse the project" or a sprint review.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Analyse project' },
        handler: async () => await getProjectAnalysisService().analyzeProject(),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_team_productivity',
        title: 'Team delivery indicators',
        description:
            'Delivery indicators for the team: completed work, throughput, cycle and lead time, reopened items, sprint completion trend, carry-over and mid-sprint additions, and current workload distribution. Deliberately produces no single productivity score for the team or any individual.',
        group: 'analysis',
        inputSchema: {
            sprint_count: z.number().int().min(1).max(10).optional().describe('Iterations to include in the trend. Default 3.'),
            window_days: z.number().int().min(1).max(180).optional().describe('Delivery window in days. Default 30.')
        },
        audit: { category: 'analysis', action: 'Analyse team productivity' },
        handler: async args =>
            await getProductivityService().analyzeTeamProductivity(
                (args.sprint_count as number | undefined) ?? 3,
                (args.window_days as number | undefined) ?? 30
            ),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_team_delivery_metrics',
        title: 'Team delivery metrics',
        description: 'Delivery metrics without interpretation: completed counts by type, throughput, cycle time and lead time distributions, reopened events.',
        group: 'analysis',
        inputSchema: { days: z.number().int().min(1).max(365).optional().describe('Window in days. Default 30.') },
        audit: { category: 'analysis', action: 'Read team delivery metrics' },
        handler: async args => await getProductivityService().getTeamDeliveryMetrics((args.days as number | undefined) ?? 30),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_deadline_risk',
        title: 'Deadline risk',
        description:
            'Rates every overdue and upcoming work item as Low, Medium or High Risk with the rules that fired: due date passed, not started with little runway, blocked, remaining work exceeding available hours, unassigned, overloaded assignee, or a due date past the sprint end. Categories only - no invented probabilities.',
        group: 'analysis',
        inputSchema: { horizon_days: z.number().int().min(1).max(180).optional().describe('How far ahead to look. Default 14.') },
        audit: { category: 'analysis', action: 'Analyse deadline risk' },
        handler: async args => await getDeadlineService().analyzeDeadlineRisk((args.horizon_days as number | undefined) ?? 14),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_at_risk_items',
        title: 'At-risk items',
        description: 'Only the High and Medium risk items from deadline analysis, with their reasons.',
        group: 'analysis',
        inputSchema: { horizon_days: z.number().int().min(1).max(180).optional().describe('How far ahead to look. Default 14.') },
        audit: { category: 'analysis', action: 'List at-risk items' },
        handler: async args => await getDeadlineService().getAtRiskItems((args.horizon_days as number | undefined) ?? 14),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_deadlines',
        title: 'Deadline overview',
        description:
            'The measured deadline picture: overdue, due today, due this week, due within the horizon, and open items with no due date at all, each rated for risk.',
        group: 'analysis',
        inputSchema: { horizon_days: z.number().int().min(1).max(180).optional().describe('How far ahead to look. Default 14.') },
        audit: { category: 'analysis', action: 'Read deadline overview' },
        handler: async args => await getDeadlineService().getDeadlineFacts((args.horizon_days as number | undefined) ?? 14),
        summarise: result => {
            const facts = result as { counts: { overdue: number; dueToday: number; dueThisWeek: number; withoutDueDate: number } };
            return `${facts.counts.overdue} overdue, ${facts.counts.dueToday} due today, ${facts.counts.dueThisWeek} due this week, ${facts.counts.withoutDueDate} open item(s) with no due date.`;
        }
    });

    registerTool(server, {
        name: 'analysis_team_workload',
        title: 'Team workload',
        description:
            'Per-member workload: open, active, proposed, blocked, overdue, due-this-week and high-priority counts, remaining hours, story points, configured sprint capacity, plus the unassigned bucket and distribution statistics.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Read team workload' },
        handler: async () => await getWorkloadService().getTeamWorkloadFacts(),
        summarise: result => {
            const facts = result as { team: string; members: unknown[]; totals: { openItems: number; blockedItems: number; overdueItems: number } };
            return `${facts.team}: ${facts.members.length} member(s), ${facts.totals.openItems} open item(s), ${facts.totals.overdueItems} overdue, ${facts.totals.blockedItems} blocked.`;
        }
    });

    registerTool(server, {
        name: 'analysis_work_distribution',
        title: 'Work distribution analysis',
        description:
            'Team workload plus an interpretation of how evenly work is spread. Flags imbalance when the busiest member holds at least twice the team median and at least 4 more items than the lightest, and recommends rebalancing. Advisory only.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Analyse work distribution' },
        handler: async () => await getWorkloadService().analyzeWorkDistribution(),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_available_team_members',
        title: 'Available team members',
        description:
            'Team members ranked by spare capacity, with the load factors behind each rating (in-progress, proposed, overdue, blocked and high-priority counts, plus configured sprint capacity). A triage aid, not a performance measure.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Find available team members' },
        handler: async () => await getWorkloadService().findAvailableMembers(),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_member_workload',
        title: 'Member workload',
        description: 'One member\'s workload in detail, including the actual item lists for active, blocked, overdue and high-priority work.',
        group: 'analysis',
        inputSchema: { member: memberArg },
        audit: { category: 'analysis', action: 'Read member workload', subject: args => `member:${args.member}` },
        handler: async args => await getWorkloadService().getMemberWorkload(args.member as string),
        summarise: result => {
            const workload = result as { member: { displayName: string }; counts: { assignedOpen: number; active: number; overdue: number; blocked: number } };
            return `${workload.member.displayName}: ${workload.counts.assignedOpen} open (${workload.counts.active} active, ${workload.counts.overdue} overdue, ${workload.counts.blocked} blocked).`;
        }
    });

    registerTool(server, {
        name: 'analysis_member_work',
        title: 'Member work breakdown',
        description:
            'One member\'s work split into assigned, active, completed in the last 30 days, overdue, blocked (with evidence), carry-over in the current sprint, and current sprint items.',
        group: 'analysis',
        inputSchema: { member: memberArg },
        audit: { category: 'analysis', action: 'Read member work breakdown', subject: args => `member:${args.member}` },
        handler: async args => await getWorkloadService().getMemberWork(args.member as string)
    });

    registerTool(server, {
        name: 'analysis_member_completed_work',
        title: 'Member completed work',
        description: 'Work items a member completed within a window, with explicit caveats about how completion is attributed.',
        group: 'analysis',
        inputSchema: { member: memberArg, days: z.number().int().min(1).max(365).optional().describe('Window in days. Default 30.') },
        audit: { category: 'analysis', action: 'Read member completed work', subject: args => `member:${args.member}` },
        handler: async args =>
            await getProductivityService().getMemberCompletedWork(args.member as string, (args.days as number | undefined) ?? 30),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_member_sprint_history',
        title: 'Member sprint history',
        description: 'Per-sprint assigned, completed and carried-in counts for one member across recent iterations.',
        group: 'analysis',
        inputSchema: {
            member: memberArg,
            sprint_count: z.number().int().min(1).max(10).optional().describe('Iterations to include. Default 3.')
        },
        audit: { category: 'analysis', action: 'Read member sprint history', subject: args => `member:${args.member}` },
        handler: async args =>
            await getProductivityService().getMemberSprintHistory(
                args.member as string,
                (args.sprint_count as number | undefined) ?? 3
            ),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_assignment_recommendation',
        title: 'Recommend an owner for one work item',
        description:
            'Suggests who could take a specific work item, ranking every team member by capacity and by demonstrated familiarity (completed work of the same type, area path and tags in the last 90 days), with reasons and cautions for each. This server CANNOT assign the item - the recommendation must be applied manually in Azure DevOps.',
        group: 'analysis',
        inputSchema: { work_item_id: z.number().int().positive().describe('The work item to find an owner for.') },
        audit: {
            category: 'recommendation_review',
            action: 'Recommend assignment for work item',
            subject: args => `work-item:${args.work_item_id}`
        },
        handler: async args => await getAssignmentService().recommendAssignment(args.work_item_id as number),
        summarise: result => {
            const envelope = result as AnalysisEnvelope<{ workItem: { id: number; title: string }; topCandidate: { member: string; suitability: number } | null }>;
            return envelope.facts.topCandidate
                ? `[AI-GENERATED RECOMMENDATION] #${envelope.facts.workItem.id} "${envelope.facts.workItem.title}": suggested owner ${envelope.facts.topCandidate.member}. Not applied - Azure DevOps is read-only here.`
                : `[AI-GENERATED RECOMMENDATION] No candidate could be recommended for #${envelope.facts.workItem.id}.`;
        }
    });

    registerTool(server, {
        name: 'analysis_assignment_recommendations',
        title: 'Recommend owners for unassigned work',
        description:
            'Suggests owners for the unassigned open items, prioritising the current sprint then priority then due date, and spreading suggestions across the team rather than piling them on one person. Recommendations only; nothing is assigned.',
        group: 'analysis',
        inputSchema: { limit: z.number().int().min(1).max(50).optional().describe('How many items to produce suggestions for. Default 10.') },
        audit: { category: 'recommendation_review', action: 'Recommend assignments for unassigned work' },
        handler: async args => await getAssignmentService().recommendAssignments((args.limit as number | undefined) ?? 10),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_blocked_items',
        title: 'Blocked work analysis',
        description:
            'Blocked work with per-item evidence and how long each has sat in its current state, flagging items unchanged for 5 or more days.',
        group: 'analysis',
        inputSchema: { limit: z.number().int().min(1).max(500).optional().describe('Maximum items to inspect. Default 300.') },
        audit: { category: 'analysis', action: 'Analyse blocked items' },
        handler: async args => await getDependencyService().findBlockedItems((args.limit as number | undefined) ?? 300),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_dependencies',
        title: 'Dependency links',
        description:
            'All Predecessor/Successor dependency links across the team\'s open work, marking which are still unresolved. Built from real Azure DevOps relation data only.',
        group: 'analysis',
        inputSchema: { limit: z.number().int().min(1).max(1000).optional().describe('Maximum work items to scan. Default 400.') },
        audit: { category: 'analysis', action: 'Analyse dependencies' },
        handler: async args => await getDependencyService().findDependencies((args.limit as number | undefined) ?? 400),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_cross_team_dependencies',
        title: 'Cross-team dependencies',
        description:
            'Dependency links that point at work outside the team\'s own area paths - the ones the Team Lead cannot resolve alone.',
        group: 'analysis',
        inputSchema: { limit: z.number().int().min(1).max(1000).optional().describe('Maximum work items to scan. Default 400.') },
        audit: { category: 'analysis', action: 'Analyse cross-team dependencies' },
        handler: async args => await getDependencyService().findCrossTeamDependencies((args.limit as number | undefined) ?? 400),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_items_blocking_release',
        title: 'Items blocking delivery',
        description:
            'Unresolved work that other items are waiting on, ranked by how many dependents it holds up and whether those dependents sit in the current or next sprint.',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Find items blocking release' },
        handler: async () => await getDependencyService().findItemsBlockingRelease(),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_critical_dependencies',
        title: 'Critical dependency chains',
        description:
            'Longest unresolved predecessor chains through the work graph, plus any circular dependency links found in Azure DevOps (which can never resolve on their own).',
        group: 'analysis',
        audit: { category: 'analysis', action: 'Analyse critical dependencies' },
        handler: async () => await getDependencyService().analyzeCriticalDependencies(),
        summarise: envelopeSummary
    });

    registerTool(server, {
        name: 'analysis_daily_team_review',
        title: 'Daily team review',
        description:
            'The whole morning review in one call: current sprint, work due today, in-progress work, items changed in the last day, overdue work, blocked work with evidence, high-priority work, upcoming deadlines with risk, unassigned work, per-member workload, project health ratings, and recommended follow-ups and assignment changes. Recommendations only - nothing is changed in Azure DevOps.',
        group: 'analysis',
        audit: { category: 'report', action: 'Generate daily team review' },
        handler: async () => await getReviewService().generateDailyTeamReview(),
        summarise: result => {
            const envelope = result as AnalysisEnvelope<{
                date: string;
                team: string;
                health: { overall: string };
                overdueWork: unknown[];
                blockedWork: unknown[];
                unassignedWork: unknown[];
            }>;
            return `[AI-GENERATED ANALYSIS] ${envelope.facts.team} daily review for ${envelope.facts.date}: health ${envelope.facts.health.overall}, ${envelope.facts.overdueWork.length} overdue, ${envelope.facts.blockedWork.length} blocked, ${envelope.facts.unassignedWork.length} unassigned.`;
        }
    });
}
