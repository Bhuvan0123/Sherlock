/**
 * Connects a real MCP client to the real server over the SDK's in-memory
 * transport pair. Tests that assert on the exposed tool surface go through this
 * rather than inspecting internal registries, so what they check is exactly what
 * Claude Desktop would see.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult, ListToolsResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildServer } from '../../src/server.js';

export interface ConnectedClient {
    client: Client;
    listTools(): Promise<Tool[]>;
    callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
    /** Parses the JSON payload that follows the summary line in a tool response. */
    callToolJson<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
    close(): Promise<void>;
}

export async function connectTestClient(): Promise<ConnectedClient> {
    const server = buildServer({ skipDatabaseInit: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'k4k-test-client', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const listTools = async (): Promise<Tool[]> => {
        const tools: Tool[] = [];
        let cursor: string | undefined;
        do {
            const page: ListToolsResult = await client.listTools(cursor ? { cursor } : {});
            tools.push(...page.tools);
            cursor = page.nextCursor;
        } while (cursor);
        return tools;
    };

    const callTool = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> =>
        (await client.callTool({ name, arguments: args })) as CallToolResult;

    return {
        client,
        listTools,
        callTool,
        async callToolJson<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
            const result = await callTool(name, args);
            const text = textOf(result);
            if (result.isError) {
                throw new Error(`Tool ${name} returned an error: ${text}`);
            }
            const start = text.indexOf('\n\n');
            const payload = start === -1 ? text : text.slice(start + 2);
            return JSON.parse(payload) as T;
        },
        async close(): Promise<void> {
            await client.close();
            await server.close();
        }
    };
}

export function textOf(result: CallToolResult): string {
    return result.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n');
}
