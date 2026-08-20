import { WiqlBuilderService, type StructuredQuery } from '../azure-devops/wiql-builder.js';
import { getAdoWriteClient, getTeamSavedQueryFolder, type AdoSavedQuery } from '../azure-devops/write-client.js';
import { getWorkItemService } from '../azure-devops/work-item.service.js';
import type { ExecutionContext } from './context-manager.js';
import { getNavigationEngine } from './navigation-engine.js';
import { Telemetry } from './telemetry.js';

export class QueryEngine {
    private wiqlBuilder = new WiqlBuilderService();

    /** Builds a WIQL query string from a structured filter object */
    async buildWIQL(query: StructuredQuery, context: ExecutionContext): Promise<string> {
        const teamScope = await getWorkItemService().getTeamScopeCondition();
        return this.wiqlBuilder.buildQuery(query, teamScope);
    }

    /** Finds an existing saved query by name in the configured team's folder. */
    async findExistingQuery(name: string, context: ExecutionContext): Promise<AdoSavedQuery | null> {
        const writeClient = getAdoWriteClient();
        return await writeClient.getQuery(
            context.projectContext.defaults.project,
            `${getTeamSavedQueryFolder(context.projectContext.defaults.team)}/${name}`
        );
    }

    /** Creates or overwrites a saved query in Azure DevOps */
    async createQuery(name: string, wiql: string, context: ExecutionContext): Promise<AdoSavedQuery> {
        const writeClient = getAdoWriteClient();
        return await writeClient.createSavedQuery(
            context.projectContext.defaults.project,
            name,
            wiql
        );
    }

    /** 
     * Finds an existing query, or creates it if it doesn't exist or has different WIQL.
     * Use this when a tool generates a query and wants to provide a stable link.
     */
    async reuseOrCreateQuery(name: string, wiql: string, context: ExecutionContext): Promise<AdoSavedQuery> {
        const writeClient = getAdoWriteClient();
        const project = context.projectContext.defaults.project;
        await writeClient.ensureFolder(project, getTeamSavedQueryFolder(context.projectContext.defaults.team));

        const existing = await this.findExistingQuery(name, context);
        if (existing && !existing.isFolder) {
            Telemetry.recordQueryReused();
            return existing;
        }

        try {
            Telemetry.recordQueryCreated();
            return await this.createQuery(name, wiql, context);
        } catch (error) {
            const retry = await this.findExistingQuery(name, context);
            if (retry && !retry.isFolder) {
                Telemetry.recordQueryReused();
                return retry;
            }
            throw error;
        }
    }

    /** Helper to get the query URL directly */
    getQueryUrl(queryId: string, context: ExecutionContext): string {
        return getNavigationEngine().getQueryUrl(context.projectContext.defaults.project, queryId);
    }

    /**
     * Executes the query and returns the total number of work items matching.
     * It limits to 1 just to get the total count if possible, or executes a full ID query.
     */
    async getQueryResultCount(wiql: string, context: ExecutionContext): Promise<number> {
        // We can just query IDs and check the length
        const writeClient = getAdoWriteClient(); 
        // wait, getAdoWriteClient doesn't have query methods.
        // getWorkItemService does.
        const ids = await getWorkItemService()['client'].queryWorkItemIds(
            context.projectContext.defaults.project,
            wiql,
            20000 // Ado's max is high for just IDs
        );
        return ids.length;
    }
}
