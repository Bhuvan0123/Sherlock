import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from '../../../config/env.js';
import { READ_ONLY_POST_ENDPOINTS, READ_ONLY_REFUSAL_MESSAGE } from '../../../security/read-only-policy.js';
import { getAdoClient } from '../../../azure-devops/client.js';
import { getProjectContext } from '../../../azure-devops/context.js';
import { FieldMappingService } from '../../../azure-devops/field-mapping.js';
import { getProjectService } from '../../../azure-devops/project.service.js';
import { getSprintService } from '../../../azure-devops/sprint.service.js';
import { getTeamService } from '../../../azure-devops/team.service.js';
import { registerTool } from '../../tool-registry.js';

/** Project, team, member and iteration reads. All GET-only against Azure DevOps. */
export function registerAdoProjectTools(server: McpServer): void {
    registerTool(server, {
        name: 'ado_get_project_overview',
        title: 'Project overview',
        description:
            'High-level snapshot of the configured Azure DevOps project and team: project metadata, member count, current sprint, work-item counts by type and state category, and counts of unassigned, overdue, blocked and high-priority open work. Start here when asked "how is the project doing".',
        group: 'azure-devops',
        audit: { category: 'project_review', action: 'Read project overview' },
        handler: async () => await getProjectService().getOverview(),
        summarise: result => {
            const overview = result as Awaited<ReturnType<ReturnType<typeof getProjectService>['getOverview']>>;
            return `${overview.project.name} / ${overview.team.name}: ${overview.openWork.total} open item(s), ${overview.openWork.overdue} overdue, ${overview.openWork.blocked} blocked, ${overview.openWork.unassigned} unassigned.`;
        }
    });

    registerTool(server, {
        name: 'ado_get_project_details',
        title: 'Project details',
        description:
            'Azure DevOps project record: id, name, description, state, visibility, process template, source-control type, default team and last update time.',
        group: 'azure-devops',
        audit: { category: 'project_review', action: 'Read project details' },
        handler: async () => await getProjectService().getDetails()
    });

    registerTool(server, {
        name: 'ado_get_project_teams',
        title: 'Project teams',
        description: 'All teams in the project, optionally with member counts. Team ids are resolved dynamically, never hard-coded.',
        group: 'azure-devops',
        inputSchema: {
            include_member_counts: z
                .boolean()
                .optional()
                .describe('Also count members per team. Costs one extra read per team.')
        },
        audit: { category: 'team_review', action: 'List project teams' },
        handler: async args => {
            const teams = getTeamService();
            const includeCounts = args.include_member_counts === true;
            return {
                configuredTeam: getConfig().ado.team,
                teams: includeCounts ? await teams.getAllTeamsWithMemberCounts() : await teams.getAllTeams()
            };
        }
    });

    registerTool(server, {
        name: 'ado_get_platform_team',
        title: 'Configured team (Platform)',
        description:
            'The team this server operates on (ADO_TEAM, default "Platform"): identity, description, owned area paths, default and backlog iteration, working days and bugs behaviour.',
        group: 'azure-devops',
        audit: { category: 'team_review', action: 'Read configured team' },
        handler: async () => await getTeamService().getTeamConfiguration()
    });

    registerTool(server, {
        name: 'ado_get_team_members',
        title: 'Team members',
        description:
            'Members of the configured team (or another named team), with display name, unique name, email and team-admin flag. Email addresses come from Azure DevOps identities and are what the email tools use.',
        group: 'azure-devops',
        inputSchema: {
            team: z.string().min(1).optional().describe('Team name. Defaults to the configured team.')
        },
        audit: { category: 'team_review', action: 'List team members' },
        handler: async args => {
            const members = await getTeamService().getMembers(args.team as string | undefined);
            return { team: (args.team as string | undefined) ?? getConfig().ado.team, count: members.length, members };
        }
    });

    registerTool(server, {
        name: 'ado_get_project_members',
        title: 'All project members',
        description: 'Every distinct member across all teams in the project, with the teams each belongs to.',
        group: 'azure-devops',
        audit: { category: 'team_review', action: 'List project members' },
        handler: async () => {
            const members = await getTeamService().getProjectMembers();
            return { count: members.length, members };
        }
    });

    registerTool(server, {
        name: 'ado_get_team_iterations',
        title: 'Team iterations',
        description:
            'All iterations (sprints) configured for the team, with start and finish dates, timeframe (past/current/future) and days elapsed/remaining.',
        group: 'azure-devops',
        inputSchema: {
            team: z.string().min(1).optional().describe('Team name. Defaults to the configured team.')
        },
        audit: { category: 'project_review', action: 'List team iterations' },
        handler: async args => {
            const sprints = await getSprintService().getIterations(args.team as string | undefined);
            return { count: sprints.length, iterations: sprints };
        }
    });

    registerTool(server, {
        name: 'ado_get_current_sprint',
        title: 'Current sprint',
        description:
            'The team\'s current iteration as Azure DevOps reports it, including start/finish dates and remaining calendar and working days.',
        group: 'azure-devops',
        audit: { category: 'project_review', action: 'Read current sprint' },
        handler: async () => {
            const sprint = await getSprintService().getCurrentSprint();
            return sprint === null
                ? { currentSprint: null, note: 'No iteration is marked current for this team. Iteration dates may not be set in Azure DevOps.' }
                : { currentSprint: sprint };
        }
    });

    registerTool(server, {
        name: 'ado_get_upcoming_sprints',
        title: 'Upcoming sprints',
        description: 'Future iterations for the team, in date order.',
        group: 'azure-devops',
        inputSchema: { limit: z.number().int().min(1).max(20).optional().describe('How many future sprints to return. Default 3.') },
        audit: { category: 'project_review', action: 'List upcoming sprints' },
        handler: async args => {
            const sprints = await getSprintService().getUpcomingSprints((args.limit as number | undefined) ?? 3);
            return { count: sprints.length, upcoming: sprints };
        }
    });

    registerTool(server, {
        name: 'ado_get_sprint_progress',
        title: 'Sprint progress',
        description:
            'Progress for one sprint: item counts by state category, blocked and unassigned counts, overdue count, story points committed vs completed, remaining hours, per-member capacity, and evidence-based carry-over (items whose iteration was changed into this sprint).',
        group: 'azure-devops',
        inputSchema: {
            sprint: z
                .string()
                .optional()
                .describe('Sprint reference: "current" (default), "next", "previous", an iteration name, path or id.'),
            include_carry_over: z
                .boolean()
                .optional()
                .describe('Inspect revision history for carry-over evidence. Default true; costs extra reads.')
        },
        audit: {
            category: 'project_review',
            action: 'Read sprint progress',
            subject: args => `sprint:${(args.sprint as string | undefined) ?? 'current'}`
        },
        handler: async args => {
            const sprints = getSprintService();
            const sprint = await sprints.resolveSprint((args.sprint as string | undefined) ?? 'current');
            return await sprints.getSprintProgress(sprint, {
                includeCarryOver: args.include_carry_over !== false
            });
        },
        summarise: result => {
            const progress = result as { sprint: { name: string }; totals: { items: number; completed: number }; completionRate: number | null };
            return `${progress.sprint.name}: ${progress.totals.completed}/${progress.totals.items} complete${
                progress.completionRate === null ? '' : ` (${progress.completionRate}%)`
            }.`;
        }
    });

    registerTool(server, {
        name: 'ado_get_project_milestones',
        title: 'Project milestones',
        description:
            'Iteration end dates from the project iteration tree, treated as delivery milestones, with days remaining. These are real Azure DevOps iteration dates - the project does not necessarily define separate milestone artefacts.',
        group: 'azure-devops',
        audit: { category: 'project_review', action: 'List project milestones' },
        handler: async () => {
            const milestones = await getSprintService().getProjectMilestones();
            return {
                count: milestones.length,
                milestones,
                note: 'Derived from Azure DevOps iteration start/finish dates.'
            };
        }
    });

    registerTool(server, {
        name: 'ado_get_backlogs',
        title: 'Team backlog levels',
        description: 'Backlog levels configured for the team (for example Epics, Features, Stories) and the work-item types at each level.',
        group: 'azure-devops',
        audit: { category: 'project_review', action: 'List team backlogs' },
        handler: async () => {
            const context = getProjectContext();
            const team = await context.getTeam();
            const backlogs = await getAdoClient().getBacklogs(getConfig().ado.project, team.name);
            return { team: team.name, count: backlogs.length, backlogs };
        }
    });

    registerTool(server, {
        name: 'ado_get_work_item_types',
        title: 'Work-item types and states',
        description:
            'Work-item types defined by the project process, each with its states and state categories. Useful before filtering by state, because K4K may use custom state names.',
        group: 'azure-devops',
        audit: { category: 'project_review', action: 'List work item types' },
        handler: async () => {
            const categories = await getProjectContext().getStateCategories();
            return {
                types: [...categories.entries()].map(([type, states]) => ({
                    type,
                    states: [...states.values()].map(state => ({ state: state.name, category: state.category }))
                }))
            };
        }
    });

    registerTool(server, {
        name: 'ado_refresh_project_context',
        title: 'Refresh cached context',
        description:
            'Clears cached Azure DevOps data so the next read hits the live API. Use after someone changes teams, iterations, area paths or work items and the data looks stale.',
        group: 'azure-devops',
        inputSchema: {
            scope: z
                .enum(['all', 'metadata', 'work-items'])
                .optional()
                .describe('"all" (default) clears everything, "metadata" only project/team/iteration data, "work-items" only query results.')
        },
        audit: { category: 'maintenance', action: 'Refresh project context cache' },
        handler: async args => {
            const result = getProjectContext().refresh((args.scope as 'all' | 'metadata' | 'work-items' | undefined) ?? 'all');
            return { ...result, note: 'Cache cleared. The next read fetches live data from Azure DevOps.' };
        }
    });

    registerTool(server, {
        name: 'ado_get_field_mapping',
        title: 'Field Mapping',
        description:
            'Shows how Azure DevOps fields are mapped to canonical concepts like Planned Start, Planned End, Actual Start, and Actual End. Use this to understand which dates are actually available in the project.',
        group: 'azure-devops',
        audit: { category: 'project_review', action: 'Read field mappings' },
        handler: async () => {
            const svc = new FieldMappingService(getConfig().ado.project);
            return await svc.getDiagnosticMapping();
        }
    });

    registerTool(server, {
        name: 'ado_get_connection_status',
        title: 'Connection and access mode',
        description:
            'Diagnostics for the Azure DevOps connection: configured organization/project/team, whether a PAT is present, resolved ids, request counters, and confirmation of the read-only enforcement in force. Never returns credentials.',
        group: 'azure-devops',
        audit: { category: 'maintenance', action: 'Check Azure DevOps connection status' },
        handler: async () => {
            const config = getConfig().ado;
            const base = {
                organization: config.organization,
                project: config.project,
                team: config.team,
                apiVersion: config.apiVersion,
                patConfigured: config.configured,
                accessMode: 'READ-ONLY',
                allowedHttpMethods: ['GET'],
                readOnlyPostAllowlist: [...READ_ONLY_POST_ENDPOINTS],
                enforcement: READ_ONLY_REFUSAL_MESSAGE,
                requestStats: getAdoClient().getRequestStats()
            };

            if (!config.configured) {
                return { ...base, connected: false, note: 'ADO_PAT is not set, so no Azure DevOps reads are possible yet.' };
            }

            try {
                const context = await getProjectContext().resolve();
                return {
                    ...base,
                    connected: true,
                    resolved: {
                        projectId: context.project.id,
                        projectName: context.project.name,
                        process: context.project.process,
                        teamId: context.team.id,
                        teamName: context.team.name,
                        workItemTypes: context.workItemTypes,
                        fieldsAvailable: context.availableFields.size
                    }
                };
            } catch (error) {
                return {
                    ...base,
                    connected: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        }
    });
}
