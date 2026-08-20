import { getConfig } from '../config/env.js';
import { AppError, toAppError, mapAdoHttpError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { AdoWiqlResult } from './types.js';

export function getTeamSavedQueryFolder(team: string = getConfig().ado.team): string {
    return `My Queries/${team.trim()}`;
}


export interface AdoSavedQuery {
    id: string;
    name: string;
    path: string;
    wiql: string;
    isFolder: boolean;
    hasChildren: boolean;
    children?: AdoSavedQuery[];
}

/**
 * Isolated client for strictly controlled Azure DevOps write operations.
 * Uses the same authentication as AzureDevOpsReadClient but permits specific POST
 * operations outside the global read-only policy restrictions.
 */
export class AzureDevOpsWriteClient {
    private fetchImpl: typeof fetch;

    constructor(fetchImpl?: typeof fetch) {
        this.fetchImpl = fetchImpl ?? fetch;
    }

    private get config() {
        return getConfig().ado;
    }

    private get baseUrl() {
        return this.config.baseUrl;
    }

    private buildUrl(path: string, query: Record<string, string | number | boolean | undefined> = {}, apiVersion?: string): string {
        const url = new URL(`${this.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
        if (apiVersion) url.searchParams.set('api-version', apiVersion);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return url.toString();
    }

    private async execute<T>(method: string, url: string, body?: unknown): Promise<T> {
        let response: Response;
        try {
            response = await this.fetchImpl(url, {
                method,
                headers: {
                    'Authorization': `Basic ${Buffer.from(`:${this.config.pat}`).toString('base64')}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
        } catch (error) {
            throw toAppError(error, 'Could not reach Azure DevOps for write operation.');
        }

        if (!response.ok) {
            const snippet = await response.text().catch(() => '');
            
            // Map common auth failure
            if (response.status === 401 || response.status === 403) {
                 if (snippet.includes('<html') || snippet.includes('signin')) {
                     throw new AppError('ADO_AUTH_FAILED', 'Azure DevOps authentication failed. Check the configured PAT.');
                 }
                 throw new AppError('ADO_FORBIDDEN', 'The configured Azure DevOps identity does not have permission for this operation.');
            }

            throw mapAdoHttpError(response.status, response.statusText, snippet.slice(0, 2000));
        }

        const text = await response.text();
        if (text.length === 0) return undefined as T;
        try {
            return JSON.parse(text) as T;
        } catch {
            throw new AppError('ADO_SERVER_ERROR', 'Received invalid JSON from Azure DevOps.');
        }
    }

    private projectPath(segment: string, project: string): string {
        return `${encodeURIComponent(project)}/${segment}`;
    }

    private queryApiPath(project: string, queryPath: string): string {
        const encoded = queryPath
            .split('/')
            .filter(part => part.length > 0)
            .map(part => encodeURIComponent(part))
            .join('/');
        return this.projectPath(`_apis/wit/queries/${encoded}`, project);
    }

    // ------------------------------------------------------------- operations

    /**
     * Checks if a query or folder exists at the given path.
     */
    async getQuery(project: string, queryPath: string): Promise<AdoSavedQuery | null> {
        try {
            const pathUrl = this.queryApiPath(project, queryPath);
            return await this.execute<AdoSavedQuery>('GET', this.buildUrl(pathUrl, { $depth: 0 }, '7.1'));
        } catch (error) {
            if (error instanceof AppError && (error.code === 'ADO_NOT_FOUND' || error.code === 'ADO_BAD_REQUEST')) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Creates a saved query folder under an existing parent path.
     */
    async createQueryFolder(project: string, parentPath: string, name: string): Promise<AdoSavedQuery> {
        const urlPath = this.queryApiPath(project, parentPath);
        return await this.execute<AdoSavedQuery>('POST', this.buildUrl(urlPath, {}, '7.1'), {
            name,
            isFolder: true
        });
    }

    /**
     * Returns the folder at folderPath, creating the leaf folder when the parent exists.
     */
    async ensureFolder(project: string, folderPath: string): Promise<AdoSavedQuery | null> {
        const existing = await this.getQuery(project, folderPath);
        if (existing?.isFolder) return existing;

        const separator = folderPath.lastIndexOf('/');
        if (separator <= 0) return null;

        const parentPath = folderPath.slice(0, separator);
        const name = folderPath.slice(separator + 1);
        const parent = await this.getQuery(project, parentPath);
        if (!parent?.isFolder) return null;

        try {
            return await this.createQueryFolder(project, parentPath, name);
        } catch {
            const retry = await this.getQuery(project, folderPath);
            return retry?.isFolder ? retry : null;
        }
    }

    /**
     * Creates a saved query under the configured team's folder.
     */
    async createSavedQuery(
        project: string,
        name: string,
        wiql: string,
        description?: string,
        folder: string = getTeamSavedQueryFolder()
    ): Promise<AdoSavedQuery> {
        const urlPath = this.queryApiPath(project, folder);
        return await this.execute<AdoSavedQuery>('POST', this.buildUrl(urlPath, {}, '7.1'), {
            name,
            wiql,
            queryType: 'flat',
            ...(description ? { description } : {})
        });
    }
}

let sharedWriteClient: AzureDevOpsWriteClient | null = null;

export function getAdoWriteClient(): AzureDevOpsWriteClient {
    sharedWriteClient ??= new AzureDevOpsWriteClient();
    return sharedWriteClient;
}

export function setAdoWriteClientForTesting(client: AzureDevOpsWriteClient | null): void {
    sharedWriteClient = client;
}
