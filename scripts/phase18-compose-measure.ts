import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

process.env.TOKEN_DEBUG = 'true';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';

function textOf(result: CallToolResult): string {
    return result.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n');
}

async function main() {
    const ROOT = process.cwd();
    const { buildServer } = await import(pathToFileURL(resolve(ROOT, 'dist/server.js')).href);
    const { Telemetry } = await import(pathToFileURL(resolve(ROOT, 'dist/core/telemetry.js')).href);

    const server = buildServer({ skipDatabaseInit: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'phase18', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const tools: string[] = [];
    let cursor: string | undefined;
    do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools.map(t => t.name));
        cursor = page.nextCursor;
    } while (cursor);
    console.log('HAS_COMPOSE', tools.includes('kaarflow_compose_skill'));

    const call = async (name: string, args: Record<string, unknown>) =>
        (await client.callTool({ name, arguments: args })) as CallToolResult;

    const preview = await call('kaarflow_compose_skill', {
        name: 'weekly-management-review-p18',
        description: 'Weekly management overview for the Platform team.',
        request: 'combining sprint health, workload, backlog quality and delivery risk',
        confirm: false
    });
    console.log('PREVIEW_ERR', Boolean(preview.isError));
    console.log(textOf(preview).slice(0, 900));

    const save = await call('kaarflow_compose_skill', {
        name: 'weekly-management-review-p18',
        description: 'Weekly management overview for the Platform team.',
        sourceSkills: [
            'sprint-health-analysis',
            'workload-analysis',
            'backlog-data-quality',
            'deadline-risk-analysis'
        ],
        confirm: true
    });
    console.log('SAVE', textOf(save).slice(0, 200), 'err', Boolean(save.isError));

    Telemetry.reset();
    const run = await call('skill_execute', { name: 'weekly-management-review-p18', mode: 'brief' });
    console.log(Telemetry.getReport());
    console.log('MODULES', Telemetry.getStats().modulesExecuted.join(','));
    console.log('MD_LEN', textOf(run).length);
    await client.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
