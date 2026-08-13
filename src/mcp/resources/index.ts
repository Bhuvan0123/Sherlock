import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfig } from '../../config/env.js';
import { READ_ONLY_POST_ENDPOINTS, READ_ONLY_REFUSAL_MESSAGE } from '../../security/read-only-policy.js';
import { getDeadlineService } from '../../services/analysis/deadline.service.js';
import { getProjectAnalysisService } from '../../services/analysis/project-analysis.service.js';
import { getWorkloadService } from '../../services/analysis/workload.service.js';
import { getProjectService } from '../../services/azure-devops/project.service.js';
import { getSprintService } from '../../services/azure-devops/sprint.service.js';
import { getTeamService } from '../../services/azure-devops/team.service.js';
import { getWorkItemService } from '../../services/azure-devops/work-item.service.js';
import { toAppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('mcp-resources');

interface ResourceDefinition {
    name: string;
    uri: string;
    title: string;
    description: string;
    load: () => Promise<unknown>;
}

/**
 * Read-only MCP resources.
 *
 * These give the client a stable, addressable view of project context that it can
 * pull in without deciding which tool to call. Every one is a read; none accepts
 * parameters, so there is no way to shape a resource read into a mutation.
 */
export function registerResources(server: McpServer): void {
    const definitions: ResourceDefinition[] = [
        {
            name: 'k4k-project-overview',
            uri: 'project://k4k/overview',
            title: 'K4K project overview',
            description: 'Project metadata, configured team, current sprint and work-item counts, read live from Azure DevOps.',
            load: async () => await getProjectService().getOverview()
        },
        {
            name: 'k4k-platform-team',
            uri: 'project://k4k/platform/team',
            title: 'Platform team',
            description: 'The configured team: identity, area paths, default and backlog iteration, and current membership with email addresses.',
            load: async () => {
                const teams = getTeamService();
                const [configuration, members] = await Promise.all([teams.getTeamConfiguration(), teams.getMembers()]);
                return { ...configuration, memberCount: members.length, members };
            }
        },
        {
            name: 'k4k-current-sprint',
            uri: 'project://k4k/current-sprint',
            title: 'Current sprint',
            description: 'The team\'s current iteration with progress, story points, capacity and carry-over evidence.',
            load: async () => {
                const sprints = getSprintService();
                const sprint = await sprints.getCurrentSprint();
                if (!sprint) {
                    return { currentSprint: null, note: 'No iteration is marked current for this team.' };
                }
                return await sprints.getSprintProgress(sprint);
            }
        },
        {
            name: 'k4k-deadlines',
            uri: 'project://k4k/deadlines',
            title: 'Deadlines',
            description: 'Overdue, due today, due this week and upcoming work items with risk ratings and reasons.',
            load: async () => await getDeadlineService().getDeadlineFacts(14)
        },
        {
            name: 'k4k-risks',
            uri: 'project://k4k/risks',
            title: 'Project risks',
            description: 'Project health ratings across delivery, schedule, workload, blocked work, sprint, dependencies and assignment coverage.',
            load: async () => await getProjectAnalysisService().getProjectHealth()
        },
        {
            name: 'k4k-workload',
            uri: 'project://k4k/workload',
            title: 'Team workload',
            description: 'Per-member open, active, blocked and overdue counts, the unassigned bucket, and distribution statistics.',
            load: async () => await getWorkloadService().getTeamWorkloadFacts()
        },
        {
            name: 'k4k-recent-changes',
            uri: 'project://k4k/recent-changes',
            title: 'Recent changes',
            description: 'Work items changed in the last three days, most recent first.',
            load: async () => {
                const items = await getWorkItemService().recentlyChanged(3, { limit: 100 });
                return { windowDays: 3, count: items.length, items };
            }
        },
        {
            name: 'k4k-blocked',
            uri: 'project://k4k/blocked',
            title: 'Blocked work',
            description: 'Blocked work items with the evidence that flagged each one.',
            load: async () => {
                const items = await getWorkItemService().blocked({ limit: 200 });
                return { count: items.length, items };
            }
        },
        {
            name: 'k4k-access-policy',
            uri: 'policy://k4k/access-mode',
            title: 'Access mode and read-only policy',
            description:
                'What this server may and may not do: read-only Azure DevOps access, the single allowlisted read-only POST endpoint, and the confirmation requirement for email.',
            load: async () => {
                const config = getConfig();
                return {
                    azureDevOps: {
                        organization: config.ado.organization,
                        project: config.ado.project,
                        team: config.ado.team,
                        accessMode: 'READ-ONLY',
                        allowedHttpMethods: ['GET'],
                        readOnlyPostAllowlist: [...READ_ONLY_POST_ENDPOINTS],
                        readOnlyPostRationale:
                            'The Azure DevOps WIQL query API only accepts POST. WIQL is a read-only query language with no mutation syntax, the endpoint is allowlisted by exact path, and every query is validated as a single SELECT statement.',
                        forbidden: [
                            'create work item',
                            'update work item',
                            'delete work item',
                            'assign work item',
                            'change state',
                            'change priority',
                            'change area or iteration path',
                            'add or remove comments',
                            'modify backlog or sprint',
                            'modify team membership',
                            'modify repositories, branches, commits or pull requests',
                            'modify or trigger pipelines and releases',
                            'modify permissions'
                        ],
                        statement: READ_ONLY_REFUSAL_MESSAGE
                    },
                    email: {
                        capability: 'Send only, via Microsoft Graph, as the configured sender mailbox.',
                        confirmationRequired: true,
                        rule: 'email_send_confirmed accepts only a draft id and confirmation=true. It cannot alter a draft, and no email is sent without explicit confirmation.',
                        configured: config.email.configured,
                        recipientAllowlist: config.email.allowedRecipients
                    },
                    credentials: {
                        azureDevOpsPat: 'Server-side only. Never logged, returned, or exposed through any tool, resource or error.',
                        microsoftGraph: 'Separate client-credentials app registration. Secret never logged or returned.'
                    }
                };
            }
        }
    ];

    for (const definition of definitions) {
        server.registerResource(
            definition.name,
            definition.uri,
            {
                title: definition.title,
                description: definition.description,
                mimeType: 'application/json'
            },
            async uri => {
                try {
                    const data = await definition.load();
                    return {
                        contents: [
                            {
                                uri: uri.href,
                                mimeType: 'application/json',
                                text: JSON.stringify(data, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    const appError = toAppError(error, `Could not read resource ${definition.uri}.`);
                    log.warn('Resource read failed', { uri: definition.uri, code: appError.code });
                    return {
                        contents: [
                            {
                                uri: uri.href,
                                mimeType: 'application/json',
                                text: JSON.stringify({ error: appError.toClientMessage(), code: appError.code }, null, 2)
                            }
                        ]
                    };
                }
            }
        );
    }

    log.debug('Registered MCP resources', { count: definitions.length });
}

/** Resource URIs, for documentation and tests. */
export const RESOURCE_URIS = [
    'project://k4k/overview',
    'project://k4k/platform/team',
    'project://k4k/current-sprint',
    'project://k4k/deadlines',
    'project://k4k/risks',
    'project://k4k/workload',
    'project://k4k/recent-changes',
    'project://k4k/blocked',
    'policy://k4k/access-mode'
] as const;
