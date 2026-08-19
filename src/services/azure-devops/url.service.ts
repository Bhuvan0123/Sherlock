import { getConfig } from '../../config/env.js';

/**
 * Reusable navigation URL service for Azure DevOps entities.
 * Generates direct browser links for the KaarPulse assistant.
 */
export class AdoUrlService {
    private get config() {
        return getConfig().ado;
    }

    private get baseUrl(): string {
        // e.g. https://dev.azure.com/KEBS4KAAR
        return this.config.baseUrl.replace(/\/+$/, '');
    }

    /**
     * Builds the browser URL for a Work Item.
     * Works for Epics, Features, User Stories, Tasks, Bugs, etc.
     */
    getWorkItemUrl(project: string, id: number): string {
        return `${this.baseUrl}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
    }

    /**
     * Builds the browser URL for a Team's backlog.
     */
    getBacklogUrl(project: string, team: string): string {
        // Note: The actual backlog level name (e.g., 'Backlog items', 'Stories') depends on the process.
        // The most generic team board URL routes to their default backlog.
        return `${this.baseUrl}/${encodeURIComponent(project)}/_boards/board/t/${encodeURIComponent(team)}`;
    }

    /**
     * Builds the browser URL for a specific Sprint / Iteration.
     */
    getIterationUrl(project: string, team: string, iterationPath: string): string {
        // The URL typically uses the iteration path or name.
        // It's usually `_sprints/taskboard/{team}/{iterationPath}`
        // Example: https://dev.azure.com/Org/Project/_sprints/taskboard/TeamName/Project/Sprint%201
        return `${this.baseUrl}/${encodeURIComponent(project)}/_sprints/taskboard/${encodeURIComponent(team)}/${encodeURIComponent(iterationPath)}`;
    }

    /**
     * Builds the browser URL for a Team's dashboard or settings.
     */
    getTeamUrl(project: string, team: string): string {
        return `${this.baseUrl}/${encodeURIComponent(project)}/_dashboards?team=${encodeURIComponent(team)}`;
    }

    /**
     * Builds the browser URL for a Repository.
     */
    getRepositoryUrl(project: string, repositoryIdOrName: string): string {
        return `${this.baseUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repositoryIdOrName)}`;
    }

    /**
     * Builds the browser URL for a Pull Request.
     */
    getPullRequestUrl(project: string, repositoryIdOrName: string, pullRequestId: number): string {
        return `${this.baseUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repositoryIdOrName)}/pullrequest/${pullRequestId}`;
    }

    /**
     * Builds the dynamic WIQL navigation URL.
     */
    getDynamicWiqlUrl(project: string, wiql: string): { url: string; isLong: boolean } {
        const encodedWiql = encodeURIComponent(wiql);
        const url = `${this.baseUrl}/${encodeURIComponent(project)}/_workitems?_a=query&wiql=${encodedWiql}`;
        // Azure DevOps/browsers typically limit URLs to around ~2000 chars.
        return {
            url,
            isLong: url.length > 2000
        };
    }
}

let sharedService: AdoUrlService | null = null;

export function getAdoUrlService(): AdoUrlService {
    sharedService ??= new AdoUrlService();
    return sharedService;
}
