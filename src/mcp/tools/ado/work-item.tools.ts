import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from '../../../config/env.js';
import { getAdoClient } from '../../../services/azure-devops/client.js';
import { describeRelation } from '../../../services/azure-devops/fields.js';
import { getSprintService } from '../../../services/azure-devops/sprint.service.js';
import { getWorkItemService } from '../../../services/azure-devops/work-item.service.js';
import { getTeamService } from '../../../services/azure-devops/team.service.js';
import { registerTool } from '../../tool-registry.js';

const workItemId = z.number().int().positive().describe('Azure DevOps work-item id.');
const limit = z.number().int().min(1).max(1000).optional().describe('Maximum items to return. Default 200.');
const teamScoped = z
    .boolean()
    .optional()
    .describe('Restrict to the configured team\'s area paths. Default true; set false to search the whole project.');

/** Work-item reads: lookup, search, filtered queries, history, comments, hierarchy. */
export function registerAdoWorkItemTools(server: McpServer): void {
    registerTool(server, {
        name: 'ado_get_work_item',
        title: 'Get work item',
        description:
            'One work item in full: type, title, state and state category, assignee, dates (created/changed/due/target/closed), iteration and area path, priority, tags, estimates, parent id and relation links.',
        group: 'azure-devops',
        inputSchema: {
            id: workItemId,
            include_relations: z.boolean().optional().describe('Include relation links. Default true.')
        },
        audit: { category: 'work_item_lookup', action: 'Read work item', subject: args => `work-item:${args.id}` },
        handler: async args =>
            await getWorkItemService().getById(args.id as number, {
                includeRelations: args.include_relations !== false
            }),
        summarise: result => {
            const item = result as { id: number; type: string; title: string; state: string; assignedTo: string | null };
            return `${item.type} #${item.id} "${item.title}" - ${item.state}, ${item.assignedTo ?? 'unassigned'}.`;
        }
    });

    registerTool(server, {
        name: 'ado_get_work_item_fields',
        title: 'Get work item raw fields',
        description: 'Fetches the raw, unmapped fields of a single Azure DevOps work item. Useful for discovering what exact data exists in a custom process.',
        group: 'azure-devops',
        inputSchema: {
            id: workItemId
        },
        audit: { category: 'work_item_lookup', action: 'Read work item fields', subject: args => `work-item:${args.id}` },
        handler: async args => {
            const raw = await getAdoClient().getWorkItem(getConfig().ado.project, args.id as number, 'none');
            return raw.fields;
        }
    });

    registerTool(server, {
        name: 'ado_get_work_items',
        title: 'Get several work items',
        description: 'Batch lookup by id. Ids that do not exist or are not visible are omitted rather than failing the whole call.',
        group: 'azure-devops',
        inputSchema: {
            ids: z.array(workItemId).min(1).max(200).describe('Work-item ids (up to 200).'),
            include_relations: z.boolean().optional().describe('Include relation links. Default false.')
        },
        audit: { category: 'work_item_lookup', action: 'Read work items batch' },
        handler: async args => {
            const items = await getWorkItemService().getByIds(args.ids as number[], {
                includeRelations: args.include_relations === true
            });
            return { requested: (args.ids as number[]).length, returned: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_search_work_items',
        title: 'Search work items',
        description:
            'Searches work-item titles for the given text within the team scope. A bare number is treated as a work-item id. Includes completed items by default.',
        group: 'azure-devops',
        inputSchema: {
            query: z.string().min(1).describe('Text to search for in work-item titles, or a work-item id.'),
            limit,
            team_scoped: teamScoped
        },
        audit: { category: 'search', action: 'Search work items', subject: args => `search:${String(args.query).slice(0, 40)}` },
        handler: async args => {
            const items = await getWorkItemService().search(args.query as string, {
                ...(args.limit ? { limit: args.limit as number } : {}),
                ...(args.team_scoped === undefined ? {} : { teamScoped: args.team_scoped as boolean })
            });
            return { query: args.query, count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_items_by_type',
        title: 'Work items by type',
        description: 'Open work items of one type (Epic, Feature, User Story, Task, Bug or any type the process defines).',
        group: 'azure-devops',
        inputSchema: {
            type: z.string().min(1).describe('Work-item type name, exactly as defined by the process.'),
            include_completed: z.boolean().optional().describe('Include completed/closed items. Default false.'),
            limit,
            team_scoped: teamScoped
        },
        audit: { category: 'search', action: 'List work items by type', subject: args => `type:${args.type}` },
        handler: async args => {
            const items = await getWorkItemService().byType(args.type as string, {
                ...(args.limit ? { limit: args.limit as number } : {}),
                ...(args.include_completed === undefined ? {} : { includeCompleted: args.include_completed as boolean }),
                ...(args.team_scoped === undefined ? {} : { teamScoped: args.team_scoped as boolean })
            });
            return { type: args.type, count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_items_by_state',
        title: 'Work items by state',
        description:
            'Work items in one state. Use ado_get_work_item_types first to see the exact state names this project defines.',
        group: 'azure-devops',
        inputSchema: {
            state: z.string().min(1).describe('State name, for example "Active", "New", "Closed".'),
            limit,
            team_scoped: teamScoped
        },
        audit: { category: 'search', action: 'List work items by state', subject: args => `state:${args.state}` },
        handler: async args => {
            const items = await getWorkItemService().byState(args.state as string, {
                ...(args.limit ? { limit: args.limit as number } : {}),
                ...(args.team_scoped === undefined ? {} : { teamScoped: args.team_scoped as boolean })
            });
            return { state: args.state, count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_items_by_assignee',
        title: 'Work items by assignee',
        description:
            'Open work items assigned to a team member. The member reference is resolved against real team membership, so "Arun" or an email both work.',
        group: 'azure-devops',
        inputSchema: {
            member: z.string().min(1).describe('Team member name or email.'),
            include_completed: z.boolean().optional().describe('Include completed items. Default false.'),
            limit
        },
        audit: { category: 'search', action: 'List work items by assignee', subject: args => `member:${args.member}` },
        handler: async args => {
            const member = await getTeamService().resolveMember(args.member as string);
            const items = await getWorkItemService().byAssignee(member.email ?? member.displayName, {
                ...(args.limit ? { limit: args.limit as number } : {}),
                ...(args.include_completed === undefined ? {} : { includeCompleted: args.include_completed as boolean })
            });
            return { member: { displayName: member.displayName, email: member.email }, count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_items_by_sprint',
        title: 'Work items by sprint',
        description: 'All work items in one iteration, including completed ones.',
        group: 'azure-devops',
        inputSchema: {
            sprint: z
                .string()
                .optional()
                .describe('Sprint reference: "current" (default), "next", "previous", or an iteration name/path/id.'),
            limit
        },
        audit: {
            category: 'search',
            action: 'List work items by sprint',
            subject: args => `sprint:${(args.sprint as string | undefined) ?? 'current'}`
        },
        handler: async args => {
            const sprints = getSprintService();
            const sprint = await sprints.resolveSprint((args.sprint as string | undefined) ?? 'current');
            const items = await sprints.getSprintWorkItems(sprint, {
                ...(args.limit ? { limit: args.limit as number } : {})
            });
            return { sprint: { name: sprint.name, path: sprint.path, timeFrame: sprint.timeFrame }, count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_items_due_today',
        title: 'Work items due today',
        description: 'Open work items whose due date is today.',
        group: 'azure-devops',
        inputSchema: { limit },
        audit: { category: 'search', action: 'List work items due today' },
        handler: async args => {
            const service = getWorkItemService();
            const field = await service.dueDateField();
            const items = await service.dueToday({ ...(args.limit ? { limit: args.limit as number } : {}) });
            return {
                dueDateField: field,
                count: items.length,
                items,
                ...(field === null
                    ? { note: 'This project process defines no due-date field, so nothing can be due today.' }
                    : {})
            };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_items_due_this_week',
        title: 'Work items due this week',
        description: 'Open work items due between today and the end of the current calendar week.',
        group: 'azure-devops',
        inputSchema: { limit },
        audit: { category: 'search', action: 'List work items due this week' },
        handler: async args => {
            const items = await getWorkItemService().dueThisWeek({ ...(args.limit ? { limit: args.limit as number } : {}) });
            return { count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_overdue_items',
        title: 'Overdue work items',
        description: 'Open work items whose due date has passed and which are not in a completed state.',
        group: 'azure-devops',
        inputSchema: { limit },
        audit: { category: 'search', action: 'List overdue work items' },
        handler: async args => {
            const items = await getWorkItemService().overdue({ ...(args.limit ? { limit: args.limit as number } : {}) });
            return { count: items.length, items };
        },
        summarise: result => `${(result as { count: number }).count} overdue item(s).`
    });

    registerTool(server, {
        name: 'ado_get_blocked_items',
        title: 'Blocked work items',
        description:
            'Work items detected as blocked, each with the evidence that flagged it: a blocked state, a blocked/impediment/waiting tag, the Blocked field set to Yes, or a Predecessor link whose target is not complete.',
        group: 'azure-devops',
        inputSchema: { limit },
        audit: { category: 'search', action: 'List blocked work items' },
        handler: async args => {
            const items = await getWorkItemService().blocked({ ...(args.limit ? { limit: args.limit as number } : {}) });
            return {
                count: items.length,
                items: items.map(item => ({ ...item, blockedSignals: item.blockedSignals })),
                detectionNote:
                    'Azure DevOps has no universal blocked field. Detection uses state, tags, Microsoft.VSTS.CMMI.Blocked, and unfinished predecessor links; each item lists its evidence.'
            };
        },
        summarise: result => `${(result as { count: number }).count} blocked item(s).`
    });

    registerTool(server, {
        name: 'ado_get_unassigned_items',
        title: 'Unassigned work items',
        description: 'Open work items with no assignee.',
        group: 'azure-devops',
        inputSchema: { limit },
        audit: { category: 'search', action: 'List unassigned work items' },
        handler: async args => {
            const items = await getWorkItemService().unassigned({ ...(args.limit ? { limit: args.limit as number } : {}) });
            return { count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_high_priority_items',
        title: 'High-priority work items',
        description: 'Open work items at priority 1 or 2 (Azure DevOps priority 1 is highest), ordered by priority.',
        group: 'azure-devops',
        inputSchema: {
            max_priority: z.number().int().min(1).max(4).optional().describe('Highest priority number to include. Default 2.'),
            limit
        },
        audit: { category: 'search', action: 'List high priority work items' },
        handler: async args => {
            const items = await getWorkItemService().highPriority((args.max_priority as number | undefined) ?? 2, {
                ...(args.limit ? { limit: args.limit as number } : {})
            });
            return { maxPriority: (args.max_priority as number | undefined) ?? 2, count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_recently_changed_items',
        title: 'Recently changed work items',
        description: 'Work items changed within the last N days, most recent first. Useful for "what moved since yesterday".',
        group: 'azure-devops',
        inputSchema: {
            days: z.number().int().min(1).max(90).optional().describe('Look-back window in days. Default 3.'),
            limit
        },
        audit: { category: 'search', action: 'List recently changed work items' },
        handler: async args => {
            const days = (args.days as number | undefined) ?? 3;
            const items = await getWorkItemService().recentlyChanged(days, {
                ...(args.limit ? { limit: args.limit as number } : {})
            });
            return { windowDays: days, count: items.length, items };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_item_history',
        title: 'Work item history',
        description:
            'Revision history for a work item: who changed which field, from what to what, and when, plus relation links added or removed. Field noise is filtered to the fields a Team Lead cares about.',
        group: 'azure-devops',
        inputSchema: {
            id: workItemId,
            limit: z.number().int().min(1).max(200).optional().describe('Maximum revisions to inspect. Default 50.')
        },
        audit: { category: 'work_item_lookup', action: 'Read work item history', subject: args => `work-item:${args.id}` },
        handler: async args => {
            const history = await getWorkItemService().getHistory(args.id as number, (args.limit as number | undefined) ?? 50);
            return { workItemId: args.id, revisions: history.length, history };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_item_comments',
        title: 'Work item comments',
        description: 'Discussion comments on a work item, converted from HTML to plain text.',
        group: 'azure-devops',
        inputSchema: {
            id: workItemId,
            limit: z.number().int().min(1).max(200).optional().describe('Maximum comments to return. Default 50.')
        },
        audit: { category: 'work_item_lookup', action: 'Read work item comments', subject: args => `work-item:${args.id}` },
        handler: async args =>
            await getWorkItemService().getComments(args.id as number, (args.limit as number | undefined) ?? 50)
    });

    registerTool(server, {
        name: 'ado_get_related_work_items',
        title: 'Related work items',
        description:
            'Every work item linked to the given one, grouped by real Azure DevOps link type (parent, child, predecessor, successor, related, duplicate), plus non-work-item links such as hyperlinks and artefacts.',
        group: 'azure-devops',
        inputSchema: { id: workItemId },
        audit: { category: 'work_item_lookup', action: 'Read related work items', subject: args => `work-item:${args.id}` },
        handler: async args => {
            const result = await getWorkItemService().getRelatedItems(args.id as number);
            return {
                workItem: { id: result.item.id, type: result.item.type, title: result.item.title, state: result.item.state },
                related: result.related.map(entry => ({
                    linkType: entry.rel,
                    linkLabel: describeRelation(entry.rel),
                    comment: entry.comment,
                    item: {
                        id: entry.item.id,
                        type: entry.item.type,
                        title: entry.item.title,
                        state: entry.item.state,
                        assignedTo: entry.item.assignedTo,
                        webUrl: entry.item.webUrl
                    }
                })),
                otherLinks: result.nonWorkItemLinks
            };
        }
    });

    registerTool(server, {
        name: 'ado_get_parent_work_item',
        title: 'Parent work item',
        description: 'The parent of a work item, following the real Hierarchy-Reverse link.',
        group: 'azure-devops',
        inputSchema: { id: workItemId },
        audit: { category: 'work_item_lookup', action: 'Read parent work item', subject: args => `work-item:${args.id}` },
        handler: async args => {
            const parent = await getWorkItemService().getParent(args.id as number);
            return parent === null ? { parent: null, note: `Work item #${args.id} has no parent link.` } : { parent };
        }
    });

    registerTool(server, {
        name: 'ado_get_child_work_items',
        title: 'Child work items',
        description: 'Direct children of a work item, following real Hierarchy-Forward links.',
        group: 'azure-devops',
        inputSchema: { id: workItemId },
        audit: { category: 'work_item_lookup', action: 'Read child work items', subject: args => `work-item:${args.id}` },
        handler: async args => {
            const children = await getWorkItemService().getChildren(args.id as number);
            return { parentId: args.id, count: children.length, children };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_item_hierarchy',
        title: 'Work item hierarchy',
        description:
            'Full descendant tree for a work item (Epic to Feature to User Story to Task/Bug), built from a recursive Azure DevOps link query. Real ids and relations only - nothing is inferred. Also returned as an indented text tree.',
        group: 'azure-devops',
        inputSchema: {
            id: workItemId,
            max_depth: z.number().int().min(1).max(10).optional().describe('Maximum depth to expand. Default 5.')
        },
        audit: { category: 'work_item_lookup', action: 'Read work item hierarchy', subject: args => `work-item:${args.id}` },
        handler: async args => {
            const result = await getWorkItemService().getHierarchy(
                args.id as number,
                (args.max_depth as number | undefined) ?? 5
            );
            return { ...result, tree: renderTree(result.root) };
        },
        summarise: result => {
            const hierarchy = result as { root: { type: string; id: number; title: string }; totalItems: number; maxDepthReached: number };
            return `${hierarchy.root.type} #${hierarchy.root.id} "${hierarchy.root.title}": ${hierarchy.totalItems} item(s) across ${hierarchy.maxDepthReached + 1} level(s).`;
        }
    });
}

interface TreeNode {
    id: number;
    type: string;
    title: string;
    state: string;
    assignedTo: string | null;
    children: TreeNode[];
}

/** Renders the hierarchy as an indented text tree for readable output. */
function renderTree(node: TreeNode, prefix = '', isLast = true, isRoot = true): string {
    const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
    const label = `${node.type} #${node.id}: ${node.title} [${node.state}${node.assignedTo ? `, ${node.assignedTo}` : ''}]`;
    const lines = [`${prefix}${connector}${label}`];
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

    node.children.forEach((child, index) => {
        lines.push(renderTree(child, childPrefix, index === node.children.length - 1, false));
    });
    return lines.join('\n');
}
