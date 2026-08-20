/**
 * Phase 16: exercise the compiled dist MCP binary (same path as .cursor/mcp.json).
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
    const client = new Client({ name: 'phase16', version: '1.0.0' });
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
    const missing = required.filter(t => !tools.includes(t));
    console.log('DIST_TOOLS', missing.length === 0 ? 'ALL_PRESENT' : `MISSING ${missing.join(',')}`);
    console.log('TOOL_COUNT', tools.length);

    const call = async (name: string, args: Record<string, unknown> = {}) =>
        (await client.callTool({ name, arguments: args })) as CallToolResult;

    const stats: { skill: string; mode: string; ado: number; items: number; cacheHits: number; payloadKb: number; created: number; reused: number; mdLen: number; err: boolean }[] = [];

    async function exec(skill: string, mode: string) {
        Telemetry.reset();
        const r = await call('skill_execute', { name: skill, mode });
        const report = Telemetry.getReport();
        const md = String(payload(r).markdown ?? textOf(r));
        const num = (label: string) => {
            const m = report.match(new RegExp(`${label}: ([\\d.]+)`));
            return m ? Number(m[1]) : 0;
        };
        const row = {
            skill,
            mode,
            ado: num('API calls'),
            items: num('Work items retrieved'),
            cacheHits: num('Cache hits'),
            payloadKb: num('Response payload'),
            created: num('Queries created'),
            reused: num('Queries reused'),
            mdLen: md.length,
            err: Boolean(r.isError)
        };
        stats.push(row);
        console.log('EXEC', JSON.stringify(row));
        console.log('---MD_START', skill, mode, '---');
        console.log(md.slice(0, 2500));
        console.log('---MD_END---');
        return { r, md, report };
    }

    await exec('daily-standup-starter', 'brief');
    await exec('daily-standup-starter', 'verbose');
    await exec('daily-standup-starter', 'visual');
    await exec('backlog-data-quality', 'visual');
    await exec('sprint-health-analysis', 'brief');
    await exec('stale-work-analysis', 'visual');
    await exec('workload-analysis', 'brief');
    await exec('deadline-risk-analysis', 'visual');

    const preview = await call('kaarflow_create_skill', {
        name: 'weekly-platform-review-p16',
        description: 'Workload, sprint, overdue, blocked, recommendations.',
        analysisModules: ['workload', 'sprint', 'deadline', 'review'],
        requiredData: ['workload', 'deadlines', 'members'],
        defaultMode: 'brief',
        supportedModes: ['brief', 'verbose', 'visual'],
        queryEnabled: true,
        recommendationEnabled: true,
        navigationEnabled: true,
        confirm: false
    });
    console.log('CREATE_PREVIEW_ERROR', Boolean(preview.isError));
    console.log('CREATE_PREVIEW', textOf(preview).slice(0, 400));

    const save = await call('kaarflow_create_skill', {
        name: 'weekly-platform-review-p16',
        description: 'Workload, sprint, overdue, blocked, recommendations.',
        analysisModules: ['workload', 'sprint', 'deadline', 'review'],
        requiredData: ['workload', 'deadlines', 'members'],
        defaultMode: 'brief',
        supportedModes: ['brief', 'verbose', 'visual'],
        queryEnabled: true,
        recommendationEnabled: true,
        navigationEnabled: true,
        confirm: true
    });
    console.log('CREATE_SAVE', textOf(save).slice(0, 250), 'err', Boolean(save.isError));

    const listed = await call('kaarflow_list_skills', {});
    const listMd = String(payload(listed).list ?? '');
    console.log('LIST_HAS_CUSTOM', listMd.includes('weekly-platform-review-p16'));

    await exec('weekly-platform-review-p16', 'brief');

    const updPrev = await call('kaarflow_update_skill', {
        name: 'weekly-platform-review-p16',
        analysisModules: ['workload', 'sprint', 'deadline', 'review', 'stale-work'],
        confirm: false
    });
    console.log('UPDATE_PREVIEW', /PREVIEW/i.test(textOf(updPrev)));
    const upd = await call('kaarflow_update_skill', {
        name: 'weekly-platform-review-p16',
        analysisModules: ['workload', 'sprint', 'deadline', 'review', 'stale-work'],
        confirm: true
    });
    console.log('UPDATE_SAVE', textOf(upd).slice(0, 200));
    const shown = await call('kaarflow_get_skill', { name: 'weekly-platform-review-p16' });
    console.log('GET_AFTER_UPDATE', String(payload(shown).markdown ?? '').slice(0, 500));
    await exec('weekly-platform-review-p16', 'visual');

    console.log('STATS_TABLE');
    for (const s of stats) {
        console.log(`| ${s.skill} ${s.mode} | ${s.ado} | ${s.items} | ${s.cacheHits} | ${s.payloadKb}KB | qC=${s.created} qR=${s.reused} | ${s.mdLen} chars | err=${s.err} |`);
    }

    await client.close();
    await server.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
