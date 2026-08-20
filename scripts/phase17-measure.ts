/**
 * Phase 17 live efficiency measurement against dist/server.js
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

process.env.TOKEN_DEBUG = 'true';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';

const ROOT = process.cwd();

function textOf(result: CallToolResult): string {
    return result.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n');
}

function payload(result: CallToolResult): any {
    const text = textOf(result);
    const start = text.indexOf('\n\n');
    const raw = start === -1 ? text : text.slice(start + 2);
    try {
        return JSON.parse(raw);
    } catch {
        return { raw: text };
    }
}

async function main() {
    const distServer = pathToFileURL(resolve(ROOT, 'dist/server.js')).href;
    const distTel = pathToFileURL(resolve(ROOT, 'dist/core/telemetry.js')).href;
    const { buildServer } = await import(distServer);
    const { Telemetry } = await import(distTel);

    const server = buildServer({ skipDatabaseInit: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'phase17', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const tools: string[] = [];
    let cursor: string | undefined;
    do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools.map(t => t.name));
        cursor = page.nextCursor;
    } while (cursor);
    const required = [
        'skill_execute',
        'kaarflow_create_skill',
        'kaarflow_update_skill',
        'kaarflow_remove_skill',
        'kaarflow_list_skills',
        'kaarflow_get_skill',
        'kaarflow_enable_skill',
        'kaarflow_disable_skill',
        'kaarflow_duplicate_skill'
    ];
    console.log('DIST_TOOLS', required.filter(t => !tools.includes(t)));

    Telemetry.reset();
    const r = (await client.callTool({
        name: 'skill_execute',
        arguments: { name: 'daily-standup-starter', mode: 'brief' }
    })) as CallToolResult;
    const report = Telemetry.getReport();
    const stats = Telemetry.getStats();
    const md = String(payload(r).markdown ?? textOf(r));
    console.log(report);
    console.log('STATS', JSON.stringify(stats));
    console.log('MD_LEN', md.length);
    console.log('MD_HEAD\n', md.slice(0, 1800));
    await client.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
