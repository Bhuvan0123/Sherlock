import { getConfig } from '../../config/env.js';
import { getAdoClient, type AzureDevOpsReadClient } from './client.js';
import { getProjectContext, type ProjectContextService } from './context.js';
import { FIELD } from './fields.js';
import { getSprintService, type Sprint, type SprintService } from './sprint.service.js';
import { getTeamService, type TeamService } from './team.service.js';
import { getWorkItemService, type WorkItemService } from './work-item.service.js';
import { buildWorkItemQuery, wiql } from './wiql.js';

export interface ProjectOverview {
    organization: string;
    project: { id: string; name: string; description: string | null; process: string | null; visibility: string | null; lastUpdated: string | null };
    team: { id: string; name: string; description: string | null; memberCount: number };
    currentSprint: Sprint | null;
    workItemCounts: { byType: Record<string, number>; byStateCategory: Record<string, number>; total: number; truncated: boolean };
    openWork: { total: number; unassigned: number; overdue: number; blocked: number; highPriority: number };
    workItemTypes: string[];
    dataSource: string;
}

/** Ceiling on counting queries; the flag tells the caller when a count is a floor. */
const COUNT_LIMIT = 1000;

/** Read-only project-level reads and aggregate counts. */
export class ProjectService {
    constructor(
        private readonly client: AzureDevOpsReadClient = getAdoClient(),
        private readonly context: ProjectContextService = getProjectContext(),
        private readonly teams: TeamService = getTeamService(),
        private readonly sprints: SprintService = getSprintService(),
        private readonly workItems: WorkItemService = getWorkItemService()
    ) {}

    private get project(): string {
        return getConfig().ado.project;
    }

    async getDetails(): Promise<{
        organization: string;
        id: string;
        name: string;
        description: string | null;
        state: string | null;
        visibility: string | null;
        revision: number | null;
        lastUpdateTime: string | null;
        process: string | null;
        sourceControl: string | null;
        defaultTeam: string | null;
        url: string;
    }> {
        const project = await this.context.getProject();
        return {
            organization: this.context.defaults.organization,
            id: project.id,
            name: project.name,
            description: project.description ?? null,
            state: project.state ?? null,
            visibility: project.visibility ?? null,
            revision: project.revision ?? null,
            lastUpdateTime: project.lastUpdateTime ?? null,
            process: project.capabilities?.processTemplate?.templateName ?? null,
            sourceControl: project.capabilities?.versioncontrol?.sourceControlType ?? null,
            defaultTeam: project.defaultTeam?.name ?? null,
            url: `${getConfig().ado.baseUrl}/${encodeURIComponent(project.name)}`
        };
    }

    /**
     * Counts open work items grouped by type and by state category, scoped to the
     * configured team. Counts are floors when `truncated` is true.
     */
    async getWorkItemCounts(): Promise<ProjectOverview['workItemCounts']> {
        const scope = await this.workItems.getTeamScopeCondition();
        const query = buildWorkItemQuery({
            conditions: [wiql.ne(FIELD.state, 'Removed'), scope ? wiql.group(scope) : null],
            orderBy: [{ field: FIELD.changedDate, direction: 'desc' }]
        });

        const ids = await this.client.queryWorkItemIds(this.project, query, COUNT_LIMIT);
        const items = await this.workItems.getByIds(ids);

        const byType: Record<string, number> = {};
        const byStateCategory: Record<string, number> = {};
        for (const item of items) {
            byType[item.type] = (byType[item.type] ?? 0) + 1;
            const category = item.stateCategory ?? 'Unknown';
            byStateCategory[category] = (byStateCategory[category] ?? 0) + 1;
        }

        return { byType, byStateCategory, total: items.length, truncated: ids.length >= COUNT_LIMIT };
    }

    async getOverview(): Promise<ProjectOverview> {
        const [details, team, members, currentSprint, counts, types] = await Promise.all([
            this.getDetails(),
            this.context.getTeam(),
            this.teams.getMembers(),
            this.sprints.getCurrentSprint().catch(() => null),
            this.getWorkItemCounts(),
            this.context.getWorkItemTypeNames()
        ]);

        const [unassigned, overdue, blocked, highPriority] = await Promise.all([
            this.workItems.unassigned({ limit: COUNT_LIMIT }).catch(() => []),
            this.workItems.overdue({ limit: COUNT_LIMIT }).catch(() => []),
            this.workItems.blocked({ limit: 200 }).catch(() => []),
            this.workItems.highPriority(2, { limit: COUNT_LIMIT }).catch(() => [])
        ]);

        const openTotal =
            (counts.byStateCategory.Proposed ?? 0) + (counts.byStateCategory.InProgress ?? 0);

        return {
            organization: details.organization,
            project: {
                id: details.id,
                name: details.name,
                description: details.description,
                process: details.process,
                visibility: details.visibility,
                lastUpdated: details.lastUpdateTime
            },
            team: {
                id: team.id,
                name: team.name,
                description: team.description ?? null,
                memberCount: members.length
            },
            currentSprint,
            workItemCounts: counts,
            openWork: {
                total: openTotal,
                unassigned: unassigned.length,
                overdue: overdue.length,
                blocked: blocked.length,
                highPriority: highPriority.length
            },
            workItemTypes: types,
            dataSource: `Azure DevOps REST API (${details.organization}/${details.name}) - live read`
        };
    }
}

let sharedProjectService: ProjectService | null = null;

export function getProjectService(): ProjectService {
    sharedProjectService ??= new ProjectService();
    return sharedProjectService;
}

export function setProjectServiceForTesting(service: ProjectService | null): void {
    sharedProjectService = service;
}
