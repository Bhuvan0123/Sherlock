import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAdoClient } from '../../../services/azure-devops/client.js';
import { getAdoWriteClient, ADO_SAVED_QUERY_FOLDER } from '../../../services/azure-devops/write-client.js';
import { getAdoUrlService } from '../../../services/azure-devops/url.service.js';
import { getConfig } from '../../../config/env.js';
import { registerTool } from '../../tool-registry.js';
import { validateWiqlQuery } from '../../../security/read-only-policy.js';

const CreateQuerySchema = {
    project: z.string().optional().describe('Azure DevOps project name or ID. Defaults to the configured project.'),
    queryName: z.string().describe('Short, searchable saved-query title (e.g. "Platform - Overdue Work").'),
    queryDescription: z
        .string()
        .optional()
        .describe('What the query contains, why it was created, and the identifying condition.'),
    wiql: z.string().describe('Valid Azure DevOps SELECT-only WIQL. Must not modify work items.'),
    columns: z
        .array(z.string())
        .optional()
        .describe(
            'Optional field reference names to project in the WIQL SELECT clause (e.g. System.Id, System.Title). Only names matching [A-Za-z0-9_.]+ are applied.'
        ),
    parentPath: z
        .string()
        .default(ADO_SAVED_QUERY_FOLDER)
        .describe(
            `Folder to store the saved query. Defaults to "${ADO_SAVED_QUERY_FOLDER}".`
        )
};

const SAFE_FIELD_NAME = /^[A-Za-z0-9_.]+$/;

/** Injects validated column reference names into a SELECT-only WIQL string. */
export function applySelectColumns(wiql: string, columns?: string[]): string {
    if (!columns || columns.length === 0) return wiql;
    const safe = [...new Set(columns.map(column => column.trim()).filter(column => SAFE_FIELD_NAME.test(column)))];
    if (safe.length === 0) return wiql;
    const select = `SELECT ${safe.map(column => `[${column}]`).join(', ')}`;
    return wiql.replace(/SELECT\s+[\s\S]+?\s+FROM/i, `${select} FROM`);
}

export function registerAdoWriteTools(server: McpServer): void {
    registerTool(server, {
        name: 'create_ado_query',
        title: 'Create Azure DevOps Query',
        description:
            `Creates a saved Azure DevOps Boards query. Stored under parentPath, which defaults to "${ADO_SAVED_QUERY_FOLDER}". Returns query metadata and a navigation URL. Does not modify work items. If a query with the same name already exists in that folder, returns the existing URL and result count so callers can reuse it.`,
        group: 'azure-devops',
        inputSchema: CreateQuerySchema,
        readOnly: false,
        audit: {
            category: 'query_management',
            action: 'Create saved query',
            subject: args => (args.queryName ? String(args.queryName) : null)
        },
        handler: async (args: any) => {
            const config = getConfig();
            const project = (args.project as string | undefined) ?? config.ado.project;
            const queryName = args.queryName as string;
            const queryDescription = args.queryDescription as string | undefined;
            const queryFolder =
                typeof args.parentPath === 'string' && args.parentPath.trim().length > 0
                    ? args.parentPath.trim()
                    : ADO_SAVED_QUERY_FOLDER;
            const wiql = applySelectColumns(args.wiql as string, args.columns as string[] | undefined);
            const columnsMatch = [...wiql.matchAll(/\[([A-Za-z0-9_.]+)\]/g)].map(match => match[1]!);
            const selectClause = /^SELECT\s+([\s\S]+?)\s+FROM/i.exec(wiql)?.[1] ?? '';
            const fieldsIncluded = [...selectClause.matchAll(/\[([A-Za-z0-9_.]+)\]/g)].map(match => match[1]!);

            try {
                validateWiqlQuery(wiql);
            } catch (err: any) {
                return {
                    success: false,
                    errorCode: 'INVALID_WIQL',
                    error: 'The supplied WIQL is invalid or unsafe.',
                    details: err.message,
                    queryCreated: false
                };
            }

            const readClient = getAdoClient();
            const writeClient = getAdoWriteClient();
            const urlService = getAdoUrlService();

            let resultCount = 0;
            try {
                const wiqlResult = await readClient.queryWiql(project, wiql);
                resultCount = wiqlResult.workItems?.length ?? wiqlResult.workItemRelations?.length ?? 0;
            } catch (err: any) {
                return {
                    success: false,
                    errorCode: 'INVALID_WIQL',
                    error: 'The supplied WIQL could not be executed.',
                    details: err.message,
                    queryCreated: false
                };
            }

            try {
                const folder = await writeClient.ensureFolder(project, queryFolder);
                if (!folder || !folder.isFolder) {
                    return {
                        success: false,
                        errorCode: 'QUERY_FOLDER_NOT_FOUND',
                        error: `The Azure DevOps query folder "${queryFolder}" could not be found or created.`,
                        queryCreated: false
                    };
                }
            } catch (err: any) {
                if (err.code === 'ADO_NOT_FOUND') {
                    return {
                        success: false,
                        errorCode: 'QUERY_FOLDER_NOT_FOUND',
                        error: `The Azure DevOps query folder "${queryFolder}" could not be found.`,
                        queryCreated: false
                    };
                }
                throw err;
            }

            try {
                const existing = await writeClient.getQuery(project, `${queryFolder}/${queryName}`);
                if (existing) {
                    const savedQueryUrl = `${config.ado.baseUrl}/${encodeURIComponent(project)}/_queries/query/${existing.id}`;
                    return {
                        success: false,
                        reused: true,
                        errorCode: 'QUERY_ALREADY_EXISTS',
                        error: `A query with this name already exists in "${queryFolder}". Reuse existingQueryUrl / savedQueryUrl instead of creating a duplicate.`,
                        existingQueryId: existing.id,
                        existingQueryUrl: savedQueryUrl,
                        savedQueryUrl,
                        queryName: existing.name ?? queryName,
                        queryDescription: queryDescription ?? null,
                        queryPath: existing.path ?? `${queryFolder}/${queryName}`,
                        queryFolder,
                        resultCount,
                        wiql,
                        fieldsIncluded: fieldsIncluded.length > 0 ? fieldsIncluded : columnsMatch.slice(0, 20),
                        project,
                        team: config.ado.team,
                        queryCreated: false
                    };
                }
            } catch (err: any) {
                if (err.code !== 'ADO_NOT_FOUND') {
                    throw err;
                }
            }

            let savedQuery;
            try {
                savedQuery = await writeClient.createSavedQuery(
                    project,
                    queryName,
                    wiql,
                    queryDescription,
                    queryFolder
                );
            } catch (err: any) {
                if (err.code === 'AUTHENTICATION_FAILED' || err.code === 'PERMISSION_DENIED' || err.code === 'ADO_AUTH_FAILED' || err.code === 'ADO_FORBIDDEN') {
                    return {
                        success: false,
                        errorCode: err.code,
                        error: err.message,
                        queryCreated: false
                    };
                }
                throw err;
            }

            const { url: navigationUrl, isLong } = urlService.getDynamicWiqlUrl(project, wiql);
            const savedQueryUrl = `${config.ado.baseUrl}/${encodeURIComponent(project)}/_queries/query/${savedQuery.id}`;

            return {
                success: true,
                reused: false,
                queryName: savedQuery.name,
                queryDescription: queryDescription ?? null,
                queryId: savedQuery.id,
                queryPath: savedQuery.path,
                queryFolder,
                resultCount,
                wiql,
                fieldsIncluded: fieldsIncluded.length > 0 ? fieldsIncluded : columnsMatch.slice(0, 20),
                project,
                team: config.ado.team,
                navigationUrl,
                savedQueryUrl,
                queryCreated: true,
                navigationUrlWarning: isLong
                    ? 'The dynamic WIQL URL is long and may exceed browser URL limits. Please use savedQueryUrl.'
                    : null
            };
        },
        summarise: result => {
            const typed = result as any;
            if (typed.success) {
                return `Created query "${typed.queryName}" with ${typed.resultCount} matching items.`;
            }
            if (typed.reused && typed.savedQueryUrl) {
                return `Reused existing query "${typed.queryName}" with ${typed.resultCount} matching items.`;
            }
            return `Failed to create query: ${typed.error}`;
        }
    });
}
