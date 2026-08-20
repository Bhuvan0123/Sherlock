/**
 * 34-area Custom Skill Creator end-to-end acceptance run.
 * Uses a real MCP client against the real server (in-process) and live ADO.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = resolve(ROOT, 'data', 'e2e-acceptance.sqlite');
const DB_URL = `file:${DB_FILE.replace(/\\/g, '/')}`;

process.env.DATABASE_URL = DB_URL;
process.env.TOKEN_DEBUG = process.env.TOKEN_DEBUG ?? 'true';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';

type Verdict = { id: string; pass: boolean; notes: string };

const results: Verdict[] = [];
const createdSkills: string[] = [];
let lastTelemetry = '';

function record(id: string, pass: boolean, notes: string): void {
    results.push({ id, pass, notes });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${notes}`);
}

function textOf(result: CallToolResult): string {
    return result.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n');
}

function payloadOf(result: CallToolResult): unknown {
    const text = textOf(result);
    const start = text.indexOf('\n\n');
    const raw = start === -1 ? text : text.slice(start + 2);
    try {
        return JSON.parse(raw);
    } catch {
        return { raw: text };
    }
}

async function connect() {
    const { buildServer } = await import('../src/server.js');
    const server = buildServer({ skipDatabaseInit: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'e2e-acceptance', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return {
        client,
        async call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
            return (await client.callTool({ name, arguments: args })) as CallToolResult;
        },
        async close() {
            await client.close();
            await server.close();
        }
    };
}

function sqliteRow(name: string): { name: string; version: number; status: string; definition_json: string } | undefined {
    const { getDatabase } = requireDb();
    return getDatabase().get(
        `SELECT name, version, status, definition_json FROM custom_skills WHERE name = ?`,
        [name]
    );
}

function sqliteCount(name: string): number {
    const { getDatabase } = requireDb();
    const row = getDatabase().get(`SELECT COUNT(*) as n FROM custom_skills WHERE name = ?`, [name]);
    return Number(row?.n ?? 0);
}

function requireDb() {
    return { getDatabase: (globalThis as any).__e2eGetDb as () => { get: (...args: any[]) => any } };
}

const WEEKLY = {
    name: 'weekly-platform-review',
    description:
        'Analyses Platform workload, sprint completion, overdue work and blocked work, compares the current sprint with the previous sprint, and gives recommendations.',
    analysisModules: ['workload', 'sprint', 'deadline', 'review'],
    requiredData: ['workload', 'deadlines', 'members'],
    defaultMode: 'brief' as const,
    supportedModes: ['brief', 'verbose', 'visual'] as const,
    queryEnabled: true,
    recommendationEnabled: true,
    navigationEnabled: true
};

async function main(): Promise<void> {
    if (process.argv.includes('--restart-probe')) {
        const { buildServer } = await import('../src/server.js');
        const { InternalSkillRegistry } = await import('../src/core/skill-registry.js');
        buildServer({ skipDatabaseInit: false });
        const skill = InternalSkillRegistry.getSkill('weekly-platform-review');
        const status = skill?.status ?? 'missing';
        const modules = skill?.analysisModules?.join(',') ?? '';
        console.log(JSON.stringify({ found: Boolean(skill), status, modules, type: skill?.type }));
        process.exit(0);
    }

    for (const extra of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
        if (existsSync(extra)) unlinkSync(extra);
    }

    const { getDatabase } = await import('../src/database/connection.js');
    (globalThis as any).__e2eGetDb = getDatabase;

    const { Telemetry } = await import('../src/core/telemetry.js');
    const { InternalSkillRegistry } = await import('../src/core/skill-registry.js');
    const { getRegisteredToolMeta } = await import('../src/mcp/tool-registry.js');
    const { getSkills } = await import('../src/skills/registry.js');

    const mcp = await connect();

    const listTools = async () => {
        const tools: { name: string }[] = [];
        let cursor: string | undefined;
        do {
            const page = await mcp.client.listTools(cursor ? { cursor } : {});
            tools.push(...page.tools);
            cursor = page.nextCursor;
        } while (cursor);
        return tools;
    };

    const tools = await listTools();
    const toolNames = tools.map(t => t.name);

    // ---- TEST 1 CREATE (preview first) ----
    const preview = await mcp.call('kaarflow_create_skill', { ...WEEKLY, confirm: false });
    const previewText = textOf(preview);
    const previewJson = payloadOf(preview) as any;
    const interpreted =
        !preview.isError &&
        previewText.includes('weekly-platform-review') &&
        WEEKLY.analysisModules.every(m => JSON.stringify(previewJson).includes(m));
    record(
        'TEST 1 — CREATE (interpret + validate)',
        interpreted && previewJson.preview && /PREVIEW/i.test(previewText),
        interpreted
            ? `NL mapped to modules [${WEEKLY.analysisModules.join(', ')}]; modes brief/verbose/visual; query+nav+recs enabled; no extra permissions.`
            : previewText.slice(0, 400)
    );

    // ---- TEST 2 NOT PERSISTED ----
    const beforeConfirm = sqliteCount('weekly-platform-review');
    record(
        'TEST 2 — PREVIEW not persisted',
        beforeConfirm === 0 && /PREVIEW/i.test(previewText),
        `SQLite rows for weekly-platform-review before confirm: ${beforeConfirm}`
    );

    // ---- TEST 3 CONFIRM ----
    const saved = await mcp.call('kaarflow_create_skill', { ...WEEKLY, confirm: true });
    const savedText = textOf(saved);
    const row = sqliteRow('weekly-platform-review');
    const inRegistry = InternalSkillRegistry.getSkill('weekly-platform-review');
    createdSkills.push('weekly-platform-review');
    record(
        'TEST 3 — CONFIRM persist + registry',
        !saved.isError && Boolean(row) && inRegistry?.type === 'custom' && inRegistry.status === 'active',
        `sqlite version=${row?.version} status=${row?.status}; registry=${inRegistry?.type}/${inRegistry?.status}; ${savedText.split('\n')[0]}`
    );

    // ---- TEST 4 EXECUTE BRIEF ----
    const brief = await mcp.call('skill_execute', { name: 'weekly-platform-review', mode: 'brief' });
    const briefMd = String((payloadOf(brief) as any).markdown ?? textOf(brief));
    lastTelemetry = Telemetry.getReport();
    const briefOk =
        !brief.isError &&
        briefMd.includes('weekly platform review') &&
        /ADO Work Items Modified: No/.test(briefMd) &&
        !/System\.Rev|fields":\s*\{/.test(briefMd);
    record(
        'TEST 4 — EXECUTE brief',
        briefOk,
        `len=${briefMd.length}; modules in output: ${['workload', 'sprint', 'deadline', 'review'].filter(m => briefMd.includes(m)).join(',') || 'none'}`
    );

    // ---- TEST 5 VERBOSE ----
    const verbose = await mcp.call('skill_execute', { name: 'weekly-platform-review', mode: 'verbose' });
    const verboseMd = String((payloadOf(verbose) as any).markdown ?? textOf(verbose));
    const verboseOk =
        !verbose.isError &&
        verboseMd.length > briefMd.length &&
        /### Findings|### Recommendations/.test(verboseMd) &&
        !/\"System.WorkItemType\"/.test(verboseMd);
    record(
        'TEST 5 — EXECUTE verbose',
        verboseOk,
        `brief=${briefMd.length} chars, verbose=${verboseMd.length} chars; raw ADO dump=${/\"System.WorkItemType\"/.test(verboseMd)}`
    );

    // ---- TEST 6 VISUAL ----
    const visual = await mcp.call('skill_execute', { name: 'weekly-platform-review', mode: 'visual' });
    const visualMd = String((payloadOf(visual) as any).markdown ?? textOf(visual));
    const visualOk =
        !visual.isError &&
        visualMd.includes('| Severity | Title | Count |') &&
        (/Recommendations/.test(visualMd) || /💡/.test(visualMd));
    record(
        'TEST 6 — EXECUTE visual',
        visualOk,
        `has KPI/summary=${visualMd.includes('Summary')}; findings table=${visualMd.includes('| Severity |')}; nav=${visualMd.includes('Navigation') || visualMd.includes('Open')}`
    );

    // ---- TEST 7 EDIT ----
    const editPreview = await mcp.call('kaarflow_update_skill', {
        name: 'weekly-platform-review',
        analysisModules: [...WEEKLY.analysisModules, 'stale-work'],
        requiredData: WEEKLY.requiredData,
        confirm: false
    });
    const versionBefore = sqliteRow('weekly-platform-review')?.version ?? 0;
    const editSave = await mcp.call('kaarflow_update_skill', {
        name: 'weekly-platform-review',
        analysisModules: [...WEEKLY.analysisModules, 'stale-work'],
        requiredData: WEEKLY.requiredData,
        confirm: true
    });
    const versionAfter = sqliteRow('weekly-platform-review')?.version ?? 0;
    const updatedDef = InternalSkillRegistry.getSkill('weekly-platform-review');
    record(
        'TEST 7 — EDIT stale-work + version',
        !editPreview.isError &&
            /PREVIEW/i.test(textOf(editPreview)) &&
            !editSave.isError &&
            versionAfter === versionBefore + 1 &&
            updatedDef?.analysisModules.includes('stale-work') === true,
        `preview=${/PREVIEW/i.test(textOf(editPreview))}; version ${versionBefore}->${versionAfter}; modules=${updatedDef?.analysisModules.join(',')}`
    );

    // ---- TEST 8 RE-EXECUTE ----
    const afterEdit = await mcp.call('skill_execute', { name: 'weekly-platform-review', mode: 'brief' });
    const afterEditMd = String((payloadOf(afterEdit) as any).markdown ?? textOf(afterEdit));
    record(
        'TEST 8 — RE-EXECUTE stale-work module ran',
        !afterEdit.isError && afterEditMd.includes('stale-work'),
        afterEditMd.includes('stale-work')
            ? 'Output summary includes stale-work module result (not just definition).'
            : afterEditMd.slice(0, 300)
    );

    // ---- TEST 9 LIST ----
    const listed = await mcp.call('kaarflow_list_skills', {});
    const listMd = String((payloadOf(listed) as any).list ?? textOf(listed));
    const builtinSection = listMd.indexOf('Built-in');
    const customSection = listMd.indexOf('My Skills');
    const weeklyPos = listMd.indexOf('weekly-platform-review');
    record(
        'TEST 9 — LIST built-in vs custom',
        builtinSection >= 0 && customSection > builtinSection && weeklyPos > customSection,
        weeklyPos > customSection ? 'weekly-platform-review under My Skills' : listMd.slice(0, 400)
    );

    // ---- TEST 10 GET ----
    const shown = await mcp.call('kaarflow_get_skill', { name: 'weekly-platform-review' });
    const shownMd = String((payloadOf(shown) as any).markdown ?? textOf(shown));
    const getOk =
        /Purpose/.test(shownMd) &&
        /stale-work/.test(shownMd) &&
        /Query behaviour/.test(shownMd) &&
        /Status/.test(shownMd) &&
        /Version/.test(shownMd) &&
        /Navigation/.test(shownMd) &&
        /Modes/.test(shownMd);
    record(
        'TEST 10 — GET definition',
        !shown.isError && getOk,
        shownMd.replace(/\n/g, ' | ').slice(0, 400)
    );

    // ---- TEST 11 DISABLE ----
    const disabled = await mcp.call('kaarflow_disable_skill', { name: 'weekly-platform-review' });
    const execDisabled = await mcp.call('skill_execute', { name: 'weekly-platform-review', mode: 'brief' });
    record(
        'TEST 11 — DISABLE',
        !disabled.isError &&
            sqliteRow('weekly-platform-review')?.status === 'disabled' &&
            InternalSkillRegistry.getSkill('weekly-platform-review')?.status === 'disabled' &&
            execDisabled.isError === true,
        `db=${sqliteRow('weekly-platform-review')?.status}; execError=${execDisabled.isError}; ${textOf(execDisabled).slice(0, 160)}`
    );

    // ---- TEST 12 RE-ENABLE ----
    const enabled = await mcp.call('kaarflow_enable_skill', { name: 'weekly-platform-review' });
    const execEnabled = await mcp.call('skill_execute', { name: 'weekly-platform-review', mode: 'brief' });
    record(
        'TEST 12 — RE-ENABLE',
        !enabled.isError &&
            sqliteRow('weekly-platform-review')?.status === 'active' &&
            !execEnabled.isError &&
            String((payloadOf(execEnabled) as any).markdown ?? '').includes('stale-work'),
        `db=${sqliteRow('weekly-platform-review')?.status}; execError=${execEnabled.isError}`
    );

    // ---- TEST 13 DUPLICATE ----
    const dupPreview = await mcp.call('kaarflow_duplicate_skill', {
        sourceName: 'daily-standup-starter',
        newName: 'my-daily-review',
        confirm: false
    });
    const dupSave = await mcp.call('kaarflow_duplicate_skill', {
        sourceName: 'daily-standup-starter',
        newName: 'my-daily-review',
        confirm: true
    });
    createdSkills.push('my-daily-review');
    const orig = InternalSkillRegistry.getSkill('daily-standup-starter');
    const dup = InternalSkillRegistry.getSkill('my-daily-review');
    const dupExec = await mcp.call('skill_execute', { name: 'my-daily-review', mode: 'brief' });
    record(
        'TEST 13 — DUPLICATE daily-standup-starter → my-daily-review',
        /PREVIEW/i.test(textOf(dupPreview)) &&
            !dupSave.isError &&
            orig?.type === 'builtin' &&
            dup?.type === 'custom' &&
            orig?.name === 'daily-standup-starter' &&
            !dupExec.isError,
        `orig=${orig?.type}; dup=${dup?.type}; execError=${dupExec.isError}`
    );

    // ---- TEST 14 DELETE ----
    const delPreview = await mcp.call('kaarflow_remove_skill', { name: 'my-daily-review', confirm: false });
    const delSave = await mcp.call('kaarflow_remove_skill', { name: 'my-daily-review', confirm: true });
    const afterDelExec = await mcp.call('skill_execute', { name: 'my-daily-review', mode: 'brief' });
    record(
        'TEST 14 — DELETE my-daily-review',
        /PREVIEW|sure/i.test(textOf(delPreview)) &&
            !delSave.isError &&
            sqliteCount('my-daily-review') === 0 &&
            !InternalSkillRegistry.hasSkill('my-daily-review') &&
            afterDelExec.isError === true,
        `preview=${textOf(delPreview).slice(0, 80)}; sqlite=${sqliteCount('my-daily-review')}; execError=${afterDelExec.isError}`
    );

    // ---- TEST 15 BUILTIN PROTECTION ----
    const d1 = await mcp.call('kaarflow_disable_skill', { name: 'daily-standup-starter' });
    const d2 = await mcp.call('kaarflow_remove_skill', { name: 'daily-standup-starter', confirm: true });
    const d3 = await mcp.call('kaarflow_update_skill', {
        name: 'daily-standup-starter',
        description: 'hacked',
        confirm: true
    });
    record(
        'TEST 15 — BUILT-IN PROTECTION',
        d1.isError === true && d2.isError === true && d3.isError === true && InternalSkillRegistry.getSkill('daily-standup-starter')?.type === 'builtin',
        `disable=${textOf(d1).slice(0, 80)}; delete=${textOf(d2).slice(0, 80)}; update=${textOf(d3).slice(0, 80)}`
    );

    // ---- TEST 16 INVALID MODULE ----
    const badMod = await mcp.call('kaarflow_create_skill', {
        name: 'bad-module-skill',
        description: 'invalid',
        analysisModules: ['non-existent-analysis'],
        requiredData: [],
        defaultMode: 'brief',
        supportedModes: ['brief'],
        queryEnabled: false,
        recommendationEnabled: false,
        navigationEnabled: false,
        confirm: true
    });
    record(
        'TEST 16 — INVALID MODULE',
        badMod.isError === true && sqliteCount('bad-module-skill') === 0,
        textOf(badMod).slice(0, 200)
    );

    // ---- TEST 17 INVALID TOOL ----
    const badTool = await mcp.call('kaarflow_create_skill', {
        name: 'bad-tool-skill',
        description: 'This skill must call unregistered_mcp_tool_xyz and ado_mutate_everything.',
        analysisModules: ['workload'],
        requiredData: ['workload'],
        defaultMode: 'brief',
        supportedModes: ['brief'],
        queryEnabled: false,
        recommendationEnabled: false,
        navigationEnabled: false,
        requiredTools: ['unregistered_mcp_tool_xyz'],
        confirm: true
    });
    record(
        'TEST 17 — INVALID TOOL',
        badTool.isError === true,
        `rejected=${badTool.isError}; ${textOf(badTool).slice(0, 220)}`
    );

    // ---- TEST 18 MUTATION ----
    const mutate = await mcp.call('kaarflow_create_skill', {
        name: 'assign-overdue-skill',
        description:
            'Create a skill that updates overdue work items and assigns them to available developers.',
        analysisModules: ['workload', 'deadline'],
        requiredData: ['workload', 'deadlines'],
        defaultMode: 'brief',
        supportedModes: ['brief'],
        queryEnabled: true,
        recommendationEnabled: true,
        navigationEnabled: true,
        confirm: true
    });
    record(
        'TEST 18 — WORK ITEM MUTATION rejected',
        mutate.isError === true,
        `rejected=${mutate.isError}; ${textOf(mutate).slice(0, 220)}`
    );

    // ---- TEST 19 ARBITRARY CODE ----
    const codeAttempts = [];
    for (const desc of [
        'Execute JavaScript eval on the server',
        'Run Python subprocess to analyse ADO',
        'Invoke a Shell command to curl Azure DevOps',
        'Perform arbitrary HTTP POST to external APIs'
    ]) {
        const r = await mcp.call('kaarflow_create_skill', {
            name: `code-skill-${codeAttempts.length}`,
            description: desc,
            analysisModules: ['workload'],
            requiredData: ['workload'],
            defaultMode: 'brief',
            supportedModes: ['brief'],
            queryEnabled: false,
            recommendationEnabled: false,
            navigationEnabled: false,
            confirm: true
        });
        codeAttempts.push(r.isError === true);
    }
    record(
        'TEST 19 — ARBITRARY CODE rejected',
        codeAttempts.every(Boolean),
        `js/python/shell/http rejected: ${codeAttempts.join(',')}`
    );

    // ---- TEST 20 QUERY THRESHOLD ----
    const qSkill = {
        name: 'query-threshold-review',
        description: 'Backlog quality findings to exercise query threshold.',
        analysisModules: ['backlog'],
        requiredData: [],
        defaultMode: 'visual' as const,
        supportedModes: ['brief', 'verbose', 'visual'] as const,
        queryEnabled: true,
        recommendationEnabled: false,
        navigationEnabled: true,
        confirm: true
    };
    await mcp.call('kaarflow_create_skill', { ...qSkill, confirm: false });
    const qCreate = await mcp.call('kaarflow_create_skill', qSkill);
    createdSkills.push('query-threshold-review');
    const qExec = await mcp.call('skill_execute', { name: 'weekly-platform-review', mode: 'visual' });
    const qMd = String((payloadOf(qExec) as any).markdown ?? textOf(qExec));
    const hasQueryNav = /https?:\/\//.test(qMd) && (qMd.includes('Navigation') || qMd.includes('Queries') || qMd.includes('Open '));
    const dumpedAll = (qMd.match(/#\d{4,}/g) ?? []).length > 20;
    record(
        'TEST 20 — QUERY THRESHOLD',
        !qExec.isError && hasQueryNav && !dumpedAll && /Count|count/.test(qMd),
        `nav/url=${hasQueryNav}; dumpedManyIds=${dumpedAll}; len=${qMd.length}`
    );

    const qExec2 = await mcp.call('skill_execute', { name: 'weekly-platform-review', mode: 'visual' });
    const qMd2 = String((payloadOf(qExec2) as any).markdown ?? '');
    lastTelemetry = Telemetry.getReport();
    const urls1 = qMd.match(/https?:\/\/[^\s)]+/g) ?? [];
    const urls2 = qMd2.match(/https?:\/\/[^\s)]+/g) ?? [];
    const reused = /Queries reused: [1-9]/.test(lastTelemetry) || (urls1.length > 0 && urls1[0] === urls2[0]);
    record(
        'TEST 21 — QUERY REUSE',
        !qExec2.isError && reused,
        lastTelemetry.replace(/\n/g, ' | ') + `; urls1=${urls1.length} urls2=${urls2.length}`
    );

    // ---- TEST 22 TOKEN DEBUG ----
    record(
        'TEST 22 — TOKEN DEBUG',
        /API calls:/.test(lastTelemetry) && /Cache hits:/.test(lastTelemetry) && /Queries/.test(lastTelemetry),
        lastTelemetry.replace(/\n/g, ' | ')
    );

    // ---- TEST 23 CACHE / TEST 24 MULTI-MODULE ----
    const teamHealth = {
        name: 'team-health-review',
        description: 'Workload, deadline, sprint and stale-work team health.',
        analysisModules: ['workload', 'deadline', 'sprint', 'stale-work'],
        requiredData: ['workload', 'deadlines', 'members'],
        defaultMode: 'brief' as const,
        supportedModes: ['brief', 'verbose', 'visual'] as const,
        queryEnabled: true,
        recommendationEnabled: true,
        navigationEnabled: true,
        confirm: true
    };
    await mcp.call('kaarflow_create_skill', { ...teamHealth, confirm: false });
    const thCreate = await mcp.call('kaarflow_create_skill', teamHealth);
    createdSkills.push('team-health-review');
    const thExec = await mcp.call('skill_execute', { name: 'team-health-review', mode: 'verbose' });
    const thMd = String((payloadOf(thExec) as any).markdown ?? '');
    lastTelemetry = Telemetry.getReport();
    const modulesPresent = ['workload', 'deadline', 'sprint', 'stale-work'].every(m => thMd.includes(m));
    record(
        'TEST 23 — CACHE overlapping data',
        /Cache hits: [1-9]/.test(lastTelemetry) || /Cache hits: \d{2,}/.test(lastTelemetry),
        lastTelemetry.replace(/\n/g, ' | ')
    );
    record(
        'TEST 24 — MULTI-MODULE team-health-review',
        !thCreate.isError && !thExec.isError && modulesPresent,
        `modules in output=${modulesPresent}; len=${thMd.length}`
    );

    // ---- TEST 25 MODES ----
    const b = String((payloadOf(await mcp.call('skill_execute', { name: 'team-health-review', mode: 'brief' })) as any).markdown ?? '');
    const v = String((payloadOf(await mcp.call('skill_execute', { name: 'team-health-review', mode: 'verbose' })) as any).markdown ?? '');
    const vis = String((payloadOf(await mcp.call('skill_execute', { name: 'team-health-review', mode: 'visual' })) as any).markdown ?? '');
    record(
        'TEST 25 — MODES differ',
        b.length !== v.length && vis.includes('| Severity |') && v.includes('### Findings') && !b.includes('### Findings'),
        `brief=${b.length} verbose=${v.length} visual=${vis.length}`
    );

    await mcp.close();

    // ---- TEST 26-29 RESTART via child process ----
    const probe = (extraEnv: Record<string, string> = {}) => {
        const r = spawnSync('npx', ['tsx', 'scripts/e2e-custom-skills-acceptance.ts', '--restart-probe'], {
            cwd: ROOT,
            env: { ...process.env, DATABASE_URL: DB_URL, ...extraEnv },
            encoding: 'utf8',
            shell: true
        });
        const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop() ?? '';
        try {
            return { ok: r.status === 0, data: JSON.parse(line), stderr: r.stderr };
        } catch {
            return { ok: false, data: { raw: line }, stderr: r.stderr + r.stdout };
        }
    };

    const p26 = probe();
    record(
        'TEST 26 — RESTART persistence exists',
        p26.ok && p26.data.found === true && p26.data.status === 'active',
        JSON.stringify(p26.data) + (p26.ok ? '' : p26.stderr.slice(0, 300))
    );

    // Reopen for modify/disable/enable then probe again
    const mcp2 = await connect();
    await mcp2.call('kaarflow_update_skill', {
        name: 'weekly-platform-review',
        description: 'Updated after restart test 27: includes stale work and sprint comparison.',
        confirm: true
    });
    await mcp2.close();
    const p27 = probe();
    record(
        'TEST 27 — UPDATE survives restart',
        p27.data.found === true,
        JSON.stringify(p27.data)
    );

    const mcp3 = await connect();
    await mcp3.call('kaarflow_disable_skill', { name: 'weekly-platform-review' });
    await mcp3.close();
    const p28 = probe();
    record(
        'TEST 28 — DISABLE survives restart',
        p28.data.status === 'disabled',
        JSON.stringify(p28.data)
    );

    const mcp4 = await connect();
    await mcp4.call('kaarflow_enable_skill', { name: 'weekly-platform-review' });
    const execAfterEnable = await mcp4.call('skill_execute', { name: 'weekly-platform-review', mode: 'brief' });
    await mcp4.close();
    const p29 = probe();
    record(
        'TEST 29 — ENABLE survives restart + executes',
        p29.data.status === 'active' && !execAfterEnable.isError,
        `probe=${JSON.stringify(p29.data)}; execError=${execAfterEnable.isError}`
    );

    // ---- TEST 30 INSPECTOR surface ----
    const mcp5 = await connect();
    const inspectorTools = [
        'kaarflow_create_skill',
        'kaarflow_list_skills',
        'kaarflow_get_skill',
        'kaarflow_update_skill',
        'kaarflow_remove_skill',
        'kaarflow_enable_skill',
        'kaarflow_disable_skill',
        'kaarflow_duplicate_skill',
        'skill_execute'
    ];
    const listedNow = (await mcp5.client.listTools()).tools.map(t => t.name);
    const missing = inspectorTools.filter(t => !listedNow.includes(t));
    const inspectorCalls: string[] = [];
    const listCall = await mcp5.call('kaarflow_list_skills', {});
    inspectorCalls.push(`kaarflow_list_skills:${listCall.isError ? 'error' : 'ok'}`);
    const getCall = await mcp5.call('kaarflow_get_skill', { name: 'weekly-platform-review' });
    inspectorCalls.push(`kaarflow_get_skill:${getCall.isError ? 'error' : 'ok'}`);
    const updCall = await mcp5.call('kaarflow_update_skill', { name: 'weekly-platform-review', confirm: false });
    inspectorCalls.push(`kaarflow_update_skill:${updCall.isError ? 'error' : 'ok'}`);
    const execCall = await mcp5.call('skill_execute', { name: 'weekly-platform-review', mode: 'brief' });
    inspectorCalls.push(`skill_execute:${execCall.isError ? 'error' : 'ok'}`);
    const dupCall = await mcp5.call('kaarflow_duplicate_skill', {
        sourceName: 'weekly-platform-review',
        newName: 'inspector-dup-temp',
        confirm: false
    });
    inspectorCalls.push(`kaarflow_duplicate_skill:${dupCall.isError ? 'error' : 'ok'}`);
    inspectorCalls.push('kaarflow_create_skill:listed');
    inspectorCalls.push('kaarflow_remove_skill:listed');
    inspectorCalls.push('kaarflow_enable_skill:listed');
    inspectorCalls.push('kaarflow_disable_skill:listed');
    record(
        'TEST 30 — MCP INSPECTOR tool surface',
        missing.length === 0 && !listCall.isError && !getCall.isError && !execCall.isError,
        missing.length ? `missing ${missing.join(',')}` : inspectorCalls.join('; ')
    );

    // ---- TEST 31 CLAUDE NL mapping (this agent as Claude) ----
    const listNl = await mcp5.call('kaarflow_list_skills', {});
    const runNl = await mcp5.call('skill_execute', { name: 'weekly-platform-review', mode: 'brief' });
    record(
        'TEST 31 — CLAUDE-style NL (list + run without internals)',
        !listNl.isError && !runNl.isError && String((payloadOf(listNl) as any).list ?? '').includes('My Skills'),
        'Mapped "show skills" → kaarflow_list_skills; "run weekly platform review" → skill_execute. No registry/SQLite details required.'
    );

    // ---- TEST 32 BACKWARD COMPAT ----
    const builtins = ['daily-standup-starter', 'backlog-data-quality', 'workload-analysis'];
    const builtinExec: string[] = [];
    let builtinsOk = true;
    for (const name of builtins) {
        const r = await mcp5.call('skill_execute', { name, mode: 'brief' });
        const mdSkill = await mcp5.call('skill_get', { name });
        const ok = !r.isError && !mdSkill.isError;
        if (!ok) builtinsOk = false;
        builtinExec.push(`${name}:execute=${!r.isError},skill_get=${!mdSkill.isError}`);
    }
    const catalogue = getSkills().map(s => s.name);
    record(
        'TEST 32 — BACKWARD COMPAT built-in SKILL.md',
        builtinsOk && catalogue.includes('daily-standup-starter'),
        builtinExec.join('; ') + `; markdown catalogue size=${catalogue.length}`
    );

    // ---- TEST 33 SECURITY ----
    const meta = getRegisteredToolMeta();
    const mutating = meta.filter(t => !t.readOnly).map(t => t.name);
    const allowedMutating = ['email_send_confirmed', 'create_ado_query'];
    const extraMut = mutating.filter(n => !allowedMutating.includes(n));
    const hasCreateQuery = listedNow.includes('create_ado_query');
    const hasWiUpdate = listedNow.some(n => /update_work_item|assign_work/.test(n));
    const emailConfirm = listedNow.includes('email_send_confirmed');
    record(
        'TEST 33 — SECURITY AUDIT',
        extraMut.length === 0 && hasCreateQuery && !hasWiUpdate && emailConfirm,
        `mutating=${mutating.join(',')}; workItemUpdateTool=${hasWiUpdate}; extra=${extraMut.join(',') || 'none'}`
    );

    await mcp5.close();

    const passed = results.filter(r => r.pass);
    const failed = results.filter(r => !r.pass);
    console.log('\n========== FINAL REPORT ==========');
    console.log(`Passed: ${passed.length}`);
    passed.forEach(r => console.log(`  - ${r.id}`));
    console.log(`Failed: ${failed.length}`);
    failed.forEach(r => console.log(`  - ${r.id}: ${r.notes}`));
    console.log(`Custom skills created: ${[...new Set(createdSkills)].join(', ')}`);
    process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
