import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('mcp-prompts');

const READ_ONLY_REMINDER =
    'Azure DevOps is read-only through this server: you may read and analyse, and you may recommend, but you cannot create, update, delete or assign anything. If asked to change a work item, say so plainly and offer to draft an email or produce a recommendation instead.';

const LABELLING_REMINDER =
    'Keep measured Azure DevOps data separate from your own interpretation. Every analysis tool returns `facts` (measured) alongside `observations`, `concerns` and `recommendations` (generated). Present them as such, cite work items as "#<id> <title>", and never invent an item, person, date or metric that is not in the tool output.';

interface PromptDefinition {
    name: string;
    title: string;
    description: string;
    argsSchema?: Record<string, z.ZodType<string | undefined>>;
    build: (args: Record<string, string | undefined>) => string;
}

/**
 * MCP prompts: ready-made workflows that orchestrate the read-only tools.
 *
 * Each prompt names the tools to call and the shape of the answer expected, so a
 * Team Lead can run a full review with one prompt instead of steering the model
 * through a dozen calls.
 */
export function registerPrompts(server: McpServer): void {
    const definitions: PromptDefinition[] = [
        {
            name: 'daily_team_review',
            title: 'Daily team review',
            description: 'Run the morning stand-up review for the K4K Platform team.',
            build: () =>
                [
                    'Run my daily team review for the K4K Platform team.',
                    '',
                    'Call `analysis_daily_team_review` first - it returns every section in one read. If any section is empty or errored, fill the gap with the specific tool for it (`ado_get_current_sprint`, `ado_get_overdue_items`, `ado_get_blocked_items`, `ado_get_unassigned_items`, `analysis_team_workload`).',
                    '',
                    'Then present, in this order:',
                    '1. Current sprint - name, days remaining, completed vs outstanding.',
                    '2. Due today.',
                    '3. Overdue work - with owner and how late each item is.',
                    '4. Blocked work - with the evidence for each.',
                    '5. High-priority work.',
                    '6. Upcoming deadlines rated High or Medium risk, with the reason.',
                    '7. Unassigned work.',
                    '8. Workload per person, calling out anyone clearly overloaded.',
                    '9. Risks - the health dimensions that are not Good, with their reasons.',
                    '10. Recommended follow-ups, and any suggested assignment changes.',
                    '',
                    'Keep it scannable: short lines, work items as "#id title", no tables wider than the terminal. Finish with the three things most worth doing first.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        },
        {
            name: 'sprint_review',
            title: 'Sprint review',
            description: 'Review progress and health of a sprint.',
            argsSchema: {
                sprint: z
                    .string()
                    .optional()
                    .describe('Sprint reference: "current" (default), "next", "previous", or an iteration name.')
            },
            build: args =>
                [
                    `Review the ${args.sprint ?? 'current'} sprint for the K4K Platform team.`,
                    '',
                    `Call \`ado_get_sprint_progress\` with sprint="${args.sprint ?? 'current'}", then \`analysis_project\` for delivery metrics, and \`analysis_deadline_risk\` for schedule pressure inside the sprint.`,
                    '',
                    'Cover:',
                    '- Scope and progress: items and story points, completed vs in progress vs not started.',
                    '- Time: days and working days remaining, and whether the outstanding work is plausible in that time.',
                    '- Carry-over: which items came in from a previous iteration, and from where. Note whether the carry-over scan was complete.',
                    '- Work added after the sprint started.',
                    '- Blocked and unassigned work inside the sprint.',
                    '- Items likely to slip, with the reason for each.',
                    '- What to consider dropping or re-scoping, if anything.',
                    '',
                    'Where a number could not be measured (missing story points, missing dates), say so rather than estimating.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        },
        {
            name: 'project_health_review',
            title: 'Project health review',
            description: 'Assess overall project health and the biggest risks.',
            build: () =>
                [
                    'Assess the health of the K4K project for the Platform team.',
                    '',
                    'Call `analysis_project`. If you need more depth on a weak dimension, follow up with `analysis_deadline_risk`, `analysis_blocked_items`, `analysis_work_distribution` or `analysis_critical_dependencies`.',
                    '',
                    'Present it as:',
                    'PROJECT HEALTH - one line per dimension (Delivery, Schedule, Workload, Blocked Work, Sprint Health, Dependency Risk, Assignment Coverage) with its rating.',
                    'REASONS - the measured counts behind each rating that is not Good.',
                    'RECOMMENDATIONS - concrete, each naming the specific work item or person involved.',
                    '',
                    'Be direct about what is actually at risk and what is fine. Do not soften a High Risk rating, and do not inflate a Good one.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        },
        {
            name: 'deadline_review',
            title: 'Deadline review',
            description: 'Review overdue work and upcoming deadlines with risk ratings.',
            argsSchema: {
                horizon_days: z.string().optional().describe('How many days ahead to look. Default 14.')
            },
            build: args =>
                [
                    `Review deadlines for the K4K Platform team over the next ${args.horizon_days ?? '14'} days.`,
                    '',
                    `Call \`analysis_deadline_risk\` with horizon_days=${args.horizon_days ?? 14}.`,
                    '',
                    'Report:',
                    '- Overdue work: item, owner, how late, current state.',
                    '- Due today and this week.',
                    '- High Risk items with the rule that triggered the rating.',
                    '- Medium Risk items, briefly.',
                    '- Open items with no due date, which cannot be schedule-checked at all.',
                    '',
                    'Then propose the follow-ups worth making today. If a reminder email would help, offer to draft one with `email_draft_deadline_reminder` - draft only, and I will confirm before anything is sent.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        },
        {
            name: 'team_workload_review',
            title: 'Team workload review',
            description: 'Review how work is distributed across the team.',
            build: () =>
                [
                    'Review how work is distributed across the K4K Platform team.',
                    '',
                    'Call `analysis_work_distribution`, then `analysis_available_team_members` for spare capacity.',
                    '',
                    'Cover:',
                    '- Open, active, blocked and overdue items per person.',
                    '- Who is carrying the most, who has room, and how wide the gap is.',
                    '- Anyone with several items in progress at once.',
                    '- Unassigned work waiting for an owner.',
                    '',
                    'Then recommend specific rebalancing moves: which item, from whom, to whom, and why. Remember that item counts ignore item size, so check the story points and remaining hours before calling someone overloaded.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        },
        {
            name: 'work_assignment_analysis',
            title: 'Work assignment analysis',
            description: 'Recommend who should take a work item, or triage all unassigned work.',
            argsSchema: {
                work_item_id: z.string().optional().describe('A specific work-item id. Omit to triage all unassigned work.')
            },
            build: args =>
                args.work_item_id
                    ? [
                          `Who should take work item #${args.work_item_id}?`,
                          '',
                          `Call \`analysis_assignment_recommendation\` with work_item_id=${args.work_item_id}. Read \`ado_get_work_item\` too if you need the description or links to judge the work.`,
                          '',
                          'Give me: the recommended person, the reasoning (workload, similar work completed, area path familiarity, capacity), one alternative, and any cautions. If nobody is a good fit, say that instead of forcing a choice.',
                          '',
                          'You cannot assign the item. End by stating that the change has to be made in Azure DevOps.',
                          '',
                          LABELLING_REMINDER
                      ].join('\n')
                    : [
                          'Triage the unassigned work for the K4K Platform team.',
                          '',
                          'Call `analysis_assignment_recommendations`, and `analysis_available_team_members` to sanity-check capacity.',
                          '',
                          'For each item give the suggested owner and a one-line reason, highest priority first. Flag any high-priority item you would not assign yet and explain what is missing.',
                          '',
                          'You cannot assign anything. Make clear that each change has to be applied in Azure DevOps.',
                          '',
                          LABELLING_REMINDER
                      ].join('\n')
        },
        {
            name: 'overdue_followup_review',
            title: 'Overdue follow-up review',
            description: 'Work through overdue items and prepare follow-ups.',
            build: () =>
                [
                    'Help me follow up on overdue work for the K4K Platform team.',
                    '',
                    'Call `ado_get_overdue_items`, then `analysis_deadline_risk` for the reasoning, and `ado_get_work_item_history` on anything that looks stuck.',
                    '',
                    'For each overdue item tell me: what it is, who owns it, how late it is, its current state, and when it last changed. Group by owner so I can have one conversation per person rather than one per item.',
                    '',
                    'Then, for the owners with the most overdue work, offer to draft a reminder with `email_draft_deadline_reminder`. Show me each draft in full and wait for my explicit confirmation before calling `email_send_confirmed` - never send without it.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        },
        {
            name: 'blocked_work_review',
            title: 'Blocked work review',
            description: 'Review blocked work and dependency chains.',
            build: () =>
                [
                    'Review blocked work and dependencies for the K4K Platform team.',
                    '',
                    'Call `analysis_blocked_items`, `analysis_critical_dependencies`, `analysis_cross_team_dependencies` and `analysis_items_blocking_release`.',
                    '',
                    'Tell me:',
                    '- Each blocked item, the evidence it was flagged on, and how long it has been in that state.',
                    '- Which blockers are holding up the most other work, especially anything in the current or next sprint.',
                    '- Dependencies that sit outside our area paths and need another team.',
                    '- Any circular dependency links, which will never resolve on their own.',
                    '',
                    'Prioritise: what unblocks the most work soonest. Distinguish what I can resolve myself from what needs someone else.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        },
        {
            name: 'tl_weekly_review',
            title: 'Team Lead weekly review',
            description: 'Review the week: delivery, attention areas and my own follow-through.',
            build: () =>
                [
                    'Run my Team Lead weekly review.',
                    '',
                    'Call `tl_get_weekly_review`, then `tl_analyze_productivity` for follow-through patterns and `analysis_team_productivity` for the delivery trend.',
                    '',
                    'Cover:',
                    '1. What the team delivered this week, and how that compares with recent sprints.',
                    '2. What still needs attention: overdue, blocked, unassigned, cross-team dependencies.',
                    '3. Workload concerns per person.',
                    '4. My own follow-through: items I reviewed repeatedly that have not moved, long-blocked work, drafts I never sent.',
                    '5. The handful of actions worth taking on Monday.',
                    '',
                    'Be straight with me about where attention has slipped. The activity data only covers what I did through this assistant, so do not read a low count as inactivity - say what it can and cannot show.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        },
        {
            name: 'member_review',
            title: 'Team member review',
            description: 'Review one team member\'s current work and recent delivery.',
            argsSchema: { member: z.string().describe('Team member name or email.') },
            build: args =>
                [
                    `Review ${args.member ?? 'a team member'}'s work on the K4K Platform team.`,
                    '',
                    `Call \`analysis_member_work\`, \`analysis_member_workload\` and \`analysis_member_sprint_history\` for ${args.member ?? 'them'}.`,
                    '',
                    'Cover their current load (open, active, blocked, overdue), what they finished recently, anything that carried over, and where they may need help or a decision from me.',
                    '',
                    'This is a work review, not a performance rating. Item counts say nothing about item size or difficulty, so frame everything as observations I should check in conversation rather than conclusions about the person.',
                    '',
                    LABELLING_REMINDER,
                    READ_ONLY_REMINDER
                ].join('\n')
        }
    ];

    for (const definition of definitions) {
        server.registerPrompt(
            definition.name,
            {
                title: definition.title,
                description: definition.description,
                ...(definition.argsSchema ? { argsSchema: definition.argsSchema } : {})
            },
            ((rawArgs: unknown) => {
                const args = (rawArgs ?? {}) as Record<string, string | undefined>;
                return {
                    messages: [
                        {
                            role: 'user' as const,
                            content: { type: 'text' as const, text: definition.build(args) }
                        }
                    ]
                };
                // The SDK types the callback against the declared argsSchema; one uniform
                // builder signature is used for every prompt here.
            }) as Parameters<McpServer['registerPrompt']>[2]
        );
    }

    log.debug('Registered MCP prompts', { count: definitions.length });
}

/** Prompt names, for documentation and tests. */
export const PROMPT_NAMES = [
    'daily_team_review',
    'sprint_review',
    'project_health_review',
    'deadline_review',
    'team_workload_review',
    'work_assignment_analysis',
    'overdue_followup_review',
    'blocked_work_review',
    'tl_weekly_review',
    'member_review'
] as const;
