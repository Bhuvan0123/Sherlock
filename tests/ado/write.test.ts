import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectTestClient, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';
import { getAdoWriteClient } from '../../src/azure-devops/write-client.js';

let harness: Harness;
let mcp: ConnectedClient;

beforeEach(async () => {
    harness = setupHarness();
    mcp = await connectTestClient();
});

afterEach(async () => {
    await mcp?.close();
    harness?.reset();
});

describe('create_ado_query', () => {
    it('creates a saved query when WIQL is valid and the folder exists', async () => {
        // Our ado-fixture needs to simulate a successful query creation and validation.
        // The read client's queryWiql is already mocked by harness (returns an empty set by default if unhandled, or we can use a known WIQL).
        // Wait, the harness might throw a 404 for POST /_apis/wit/queries.
        // Let's add a fake interceptor directly to the write client for this test.
        let postCalled = false;
        let getCalledCount = 0;

        const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = input.toString();
            if (init?.method === 'GET' && (url.includes('My%20Queries') || url.includes('My Queries'))) {
                getCalledCount++;
                // 1. Folder check (first GET) returns it's a folder
                // 2. Duplicate check (second GET to /Platform/MyQuery) returns 404
                if (url.includes('MyQuery')) {
                    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
                }
                return new Response(JSON.stringify({ id: 'folder-id', isFolder: true }), { status: 200 });
            }
            if (init?.method === 'POST' && (url.includes('My%20Queries') || url.includes('My Queries'))) {
                postCalled = true;
                return new Response(JSON.stringify({
                    id: 'new-query-id',
                    name: 'MyQuery',
                    path: 'My Queries/Platform/MyQuery',
                    isFolder: false,
                    hasChildren: false,
                    wiql: 'SELECT [System.Id] FROM WorkItems'
                }), { status: 200 });
            }
            // Fallback for read operations (e.g. query validation)
            if (init?.method === 'POST' && url.includes('/_apis/wit/wiql')) {
                return new Response(JSON.stringify({
                    workItems: [{ id: 1 }, { id: 2 }]
                }), { status: 200 });
            }
            return new Response(JSON.stringify({}), { status: 404 });
        };

        // Override the write client and read client's fetch for this test
        // Or better yet, we just test the tool logic using our fake fetch
        const { AzureDevOpsWriteClient, setAdoWriteClientForTesting } = await import('../../src/azure-devops/write-client.js');
        const { AzureDevOpsReadClient, setAdoClientForTesting } = await import('../../src/azure-devops/client.js');
        
        setAdoWriteClientForTesting(new AzureDevOpsWriteClient(fakeFetch));
        setAdoClientForTesting(new AzureDevOpsReadClient(fakeFetch));

        const result = await mcp.callToolJson<any>('create_ado_query', {
            project: 'K4K',
            queryName: 'MyQuery',
            wiql: 'SELECT [System.Id] FROM WorkItems',
        });

        expect(result.success).toBe(true);
        expect(result.queryId).toBe('new-query-id');
        expect(result.resultCount).toBe(2);
        expect(result.navigationUrl).toContain('_workitems?_a=query');
        expect(result.savedQueryUrl).toContain('_queries/query/new-query-id');
        expect(result.queryFolder).toBe('My Queries/Platform');
        expect(postCalled).toBe(true);
        expect(getCalledCount).toBe(2);
    });

    it('uses parentPath when provided instead of the default folder', async () => {
        let postedUrl = '';
        const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = input.toString();
            if (init?.method === 'GET' && url.includes('/_apis/wit/queries')) {
                if (url.includes('CustomQuery')) {
                    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
                }
                return new Response(JSON.stringify({ id: 'folder-id', isFolder: true }), { status: 200 });
            }
            if (init?.method === 'POST' && url.includes('/_apis/wit/queries')) {
                postedUrl = url;
                return new Response(JSON.stringify({
                    id: 'custom-query-id',
                    name: 'CustomQuery',
                    path: 'My Queries/CustomTeam/CustomQuery',
                    isFolder: false,
                    hasChildren: false,
                    wiql: 'SELECT [System.Id] FROM WorkItems'
                }), { status: 200 });
            }
            if (init?.method === 'POST' && url.includes('/_apis/wit/wiql')) {
                return new Response(JSON.stringify({ workItems: [] }), { status: 200 });
            }
            return new Response(JSON.stringify({}), { status: 404 });
        };

        const { AzureDevOpsWriteClient, setAdoWriteClientForTesting } = await import('../../src/azure-devops/write-client.js');
        const { AzureDevOpsReadClient, setAdoClientForTesting } = await import('../../src/azure-devops/client.js');

        setAdoWriteClientForTesting(new AzureDevOpsWriteClient(fakeFetch));
        setAdoClientForTesting(new AzureDevOpsReadClient(fakeFetch));

        const result = await mcp.callToolJson<any>('create_ado_query', {
            project: 'K4K',
            queryName: 'CustomQuery',
            wiql: 'SELECT [System.Id] FROM WorkItems',
            parentPath: 'My Queries/CustomTeam'
        });

        expect(result.success).toBe(true);
        expect(result.queryFolder).toBe('My Queries/CustomTeam');
        expect(postedUrl).toMatch(/My%20Queries\/CustomTeam|My Queries\/CustomTeam/);
    });

    it('fails when WIQL contains forbidden mutation keywords', async () => {
        const result = await mcp.callToolJson<any>('create_ado_query', {
            project: 'K4K',
            queryName: 'MyQuery',
            wiql: 'UPDATE WorkItems SET [System.Title] = "Hacked"',
        });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('INVALID_WIQL');
    });

    it('fails when folder does not exist', async () => {
        const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = input.toString();
            if (init?.method === 'GET' && url.includes('/_apis/wit/queries')) {
                return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
            }
            if (init?.method === 'POST' && url.includes('/_apis/wit/wiql')) {
                return new Response(JSON.stringify({ workItems: [] }), { status: 200 });
            }
            return new Response(JSON.stringify({}), { status: 404 });
        };

        const { AzureDevOpsWriteClient, setAdoWriteClientForTesting } = await import('../../src/azure-devops/write-client.js');
        const { AzureDevOpsReadClient, setAdoClientForTesting } = await import('../../src/azure-devops/client.js');
        
        setAdoWriteClientForTesting(new AzureDevOpsWriteClient(fakeFetch));
        setAdoClientForTesting(new AzureDevOpsReadClient(fakeFetch));

        const result = await mcp.callToolJson<any>('create_ado_query', {
            project: 'K4K',
            queryName: 'MyQuery',
            wiql: 'SELECT [System.Id] FROM WorkItems',
        });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('QUERY_FOLDER_NOT_FOUND');
    });

    it('returns error when query already exists', async () => {
        const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = input.toString();
            if (init?.method === 'GET' && (url.includes('My%20Queries') || url.includes('My Queries'))) {
                // If it asks for the specific query, pretend it exists
                if (url.includes('MyQuery')) {
                    return new Response(JSON.stringify({ id: 'existing-id', isFolder: false }), { status: 200 });
                }
                // Folder check
                return new Response(JSON.stringify({ id: 'folder-id', isFolder: true }), { status: 200 });
            }
            if (init?.method === 'POST' && url.includes('/_apis/wit/wiql')) {
                return new Response(JSON.stringify({ workItems: [] }), { status: 200 });
            }
            return new Response(JSON.stringify({}), { status: 404 });
        };

        const { AzureDevOpsWriteClient, setAdoWriteClientForTesting } = await import('../../src/azure-devops/write-client.js');
        const { AzureDevOpsReadClient, setAdoClientForTesting } = await import('../../src/azure-devops/client.js');
        
        setAdoWriteClientForTesting(new AzureDevOpsWriteClient(fakeFetch));
        setAdoClientForTesting(new AzureDevOpsReadClient(fakeFetch));

        const result = await mcp.callToolJson<any>('create_ado_query', {
            project: 'K4K',
            queryName: 'MyQuery',
            wiql: 'SELECT [System.Id] FROM WorkItems',
        });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('QUERY_ALREADY_EXISTS');
        expect(result.existingQueryId).toBe('existing-id');
        expect(result.reused).toBe(true);
        expect(result.savedQueryUrl).toContain('_queries/query/existing-id');
        expect(result.resultCount).toBe(0);
    });

    it('projects requested columns into the saved WIQL SELECT list', async () => {
        const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = input.toString();
            if (init?.method === 'GET' && (url.includes('My%20Queries') || url.includes('My Queries'))) {
                if (url.includes('ColQuery')) {
                    return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
                }
                return new Response(JSON.stringify({ id: 'folder-id', isFolder: true }), { status: 200 });
            }
            if (init?.method === 'POST' && (url.includes('My%20Queries') || url.includes('My Queries'))) {
                const body = JSON.parse(String(init.body ?? '{}')) as { wiql?: string; description?: string };
                expect(body.wiql).toContain('[System.Title]');
                expect(body.wiql).toContain('[System.State]');
                expect(body.description).toBe('Overdue Platform work for TL review.');
                return new Response(
                    JSON.stringify({
                        id: 'col-query-id',
                        name: 'ColQuery',
                        path: 'My Queries/Platform/ColQuery',
                        isFolder: false,
                        hasChildren: false,
                        wiql: body.wiql
                    }),
                    { status: 200 }
                );
            }
            if (init?.method === 'POST' && url.includes('/_apis/wit/wiql')) {
                return new Response(JSON.stringify({ workItems: [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }] }), {
                    status: 200
                });
            }
            return new Response(JSON.stringify({}), { status: 404 });
        };

        const { AzureDevOpsWriteClient, setAdoWriteClientForTesting } = await import('../../src/azure-devops/write-client.js');
        const { AzureDevOpsReadClient, setAdoClientForTesting } = await import('../../src/azure-devops/client.js');

        setAdoWriteClientForTesting(new AzureDevOpsWriteClient(fakeFetch));
        setAdoClientForTesting(new AzureDevOpsReadClient(fakeFetch));

        const result = await mcp.callToolJson<any>('create_ado_query', {
            project: 'K4K',
            queryName: 'ColQuery',
            queryDescription: 'Overdue Platform work for TL review.',
            wiql: 'SELECT [System.Id] FROM WorkItems WHERE [System.State] <> \'Closed\'',
            columns: ['System.Id', 'System.Title', 'System.State'],
        });

        expect(result.success).toBe(true);
        expect(result.queryCreated).toBe(true);
        expect(result.resultCount).toBe(4);
        expect(result.fieldsIncluded).toEqual(['System.Id', 'System.Title', 'System.State']);
        expect(result.savedQueryUrl).toContain('_queries/query/col-query-id');
    });
});
