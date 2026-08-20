import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectTestClient, textOf, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';
import { InternalSkillRegistry } from '../../src/core/skill-registry.js';
import { getCustomSkillRepository } from '../../src/database/repository/custom-skill.repository.js';
import { Telemetry } from '../../src/core/telemetry.js';

let harness: Harness;
let mcp: ConnectedClient;

beforeEach(async () => {
    harness = setupHarness();
    mcp = await connectTestClient();
});

afterEach(async () => {
    for (const name of [
        'weekly-management-review',
        'compose-versioned',
        'mutate-board',
        'skill-a-source',
        'skill-c-snapshot',
        'management-report',
        'sprint-slip'
    ]) {
        try {
            InternalSkillRegistry.removeSkill(name);
        } catch {
            /* builtin or missing */
        }
    }
    await mcp?.close();
    harness?.reset();
});

describe('kaarflow_compose_skill', () => {
    it('is exposed on the MCP surface', async () => {
        const tools = await mcp.listTools();
        expect(tools.map(t => t.name)).toContain('kaarflow_compose_skill');
    });

    it('previews without saving', async () => {
        const preview = await mcp.callTool('kaarflow_compose_skill', {
            name: 'weekly-management-review',
            description: 'Weekly management overview for the Platform team.',
            sourceSkills: [
                'sprint-health-analysis',
                'workload-analysis',
                'backlog-data-quality',
                'deadline-risk-analysis'
            ],
            confirm: false
        });
        expect(preview.isError).toBeFalsy();
        const text = textOf(preview);
        expect(text).toContain('PREVIEW ONLY');
        expect(text).toContain('weekly-management-review');
        expect(text).toMatch(/workload/);
        expect(InternalSkillRegistry.getSkill('weekly-management-review')).toBeNull();
    });

    it('persists after confirmation and executes once per module', async () => {
        const saved = await mcp.callTool('kaarflow_compose_skill', {
            name: 'weekly-management-review',
            description: 'Weekly management overview for the Platform team.',
            sourceSkills: [
                'sprint-health-analysis',
                'workload-analysis',
                'backlog-data-quality',
                'deadline-risk-analysis'
            ],
            confirm: true
        });
        expect(saved.isError).toBeFalsy();
        const def = InternalSkillRegistry.getSkill('weekly-management-review');
        expect(def?.type).toBe('custom');
        expect(def?.analysisModules.filter(m => m === 'workload')).toHaveLength(1);
        expect(getCustomSkillRepository().getVersion('weekly-management-review')).toBe(1);

        Telemetry.reset();
        const executed = await mcp.callTool('skill_execute', {
            name: 'weekly-management-review',
            mode: 'brief'
        });
        expect(executed.isError).toBeFalsy();
        const md = textOf(executed);
        expect(md.toLowerCase()).not.toContain('[object object]');
        const mods = Telemetry.getStats().modulesExecuted;
        expect(mods.filter(id => id === 'workload')).toHaveLength(1);
        expect(new Set(mods).size).toBe(mods.length);

        const verbose = await mcp.callTool('skill_execute', { name: 'weekly-management-review', mode: 'verbose' });
        const visual = await mcp.callTool('skill_execute', { name: 'weekly-management-review', mode: 'visual' });
        expect(verbose.isError).toBeFalsy();
        expect(visual.isError).toBeFalsy();
        expect(textOf(visual)).toMatch(/Findings|KPI|Navigate/i);
    });

    it('rejects mutation intents', async () => {
        const result = await mcp.callTool('kaarflow_compose_skill', {
            name: 'mutate-board',
            description: 'Assign overdue work items to people automatically',
            modules: ['workload'],
            confirm: true
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toMatch(/read-only|cannot/i);
    });

    it('increments version on update', async () => {
        const saved = await mcp.callTool('kaarflow_compose_skill', {
            name: 'compose-versioned',
            modules: ['sprint', 'workload'],
            confirm: true
        });
        expect(saved.isError).toBeFalsy();
        expect(InternalSkillRegistry.getSkill('compose-versioned')?.name).toBe('compose-versioned');
        const preview = await mcp.callTool('kaarflow_update_skill', {
            name: 'compose-versioned',
            analysisModules: ['sprint', 'workload', 'stale-work'],
            confirm: false
        });
        expect(textOf(preview)).toMatch(/PREVIEW/i);
        expect(getCustomSkillRepository().getVersion('compose-versioned')).toBe(1);
        const updated = await mcp.callTool('kaarflow_update_skill', {
            name: 'compose-versioned',
            analysisModules: ['sprint', 'workload', 'stale-work'],
            confirm: true
        });
        expect(updated.isError).toBeFalsy();
        expect(getCustomSkillRepository().getVersion('compose-versioned')).toBe(2);
        expect(InternalSkillRegistry.getSkill('compose-versioned')?.analysisModules).toContain('stale-work');
    });

    it('rejects builtin edit, disable and delete', async () => {
        const update = await mcp.callTool('kaarflow_update_skill', {
            name: 'daily-standup-starter',
            analysisModules: ['sprint'],
            confirm: true
        });
        const disable = await mcp.callTool('kaarflow_disable_skill', { name: 'daily-standup-starter' });
        const remove = await mcp.callTool('kaarflow_remove_skill', { name: 'daily-standup-starter', confirm: true });
        expect(update.isError).toBe(true);
        expect(disable.isError).toBe(true);
        expect(remove.isError).toBe(true);
        expect(textOf(update) + textOf(disable) + textOf(remove)).toMatch(/Cannot (update|disable|delete) builtin/i);
    });

    it('disables a custom skill so execution is rejected, then re-enables it', async () => {
        await mcp.callTool('kaarflow_compose_skill', {
            name: 'weekly-management-review',
            modules: ['sprint'],
            confirm: true
        });
        const disabled = await mcp.callTool('kaarflow_disable_skill', { name: 'weekly-management-review' });
        expect(disabled.isError).toBeFalsy();
        InternalSkillRegistry.loadFromDatabase();
        expect(InternalSkillRegistry.getSkill('weekly-management-review')?.status).toBe('disabled');
        const blocked = await mcp.callTool('skill_execute', { name: 'weekly-management-review' });
        expect(blocked.isError).toBe(true);
        const enabled = await mcp.callTool('kaarflow_enable_skill', { name: 'weekly-management-review' });
        expect(enabled.isError).toBeFalsy();
        InternalSkillRegistry.loadFromDatabase();
        const run = await mcp.callTool('skill_execute', { name: 'weekly-management-review', mode: 'brief' });
        expect(run.isError).toBeFalsy();
    });

    it('does not persist an ambiguous management report', async () => {
        const result = await mcp.callTool('kaarflow_compose_skill', {
            name: 'management-report',
            request: 'Give me a management report.',
            confirm: true
        });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toMatch(/too broad|Choose an area/i);
        expect(InternalSkillRegistry.getSkill('management-report')).toBeNull();
    });

    it('offers recommended analysis without saving for a slipping sprint', async () => {
        const result = await mcp.callTool('kaarflow_compose_skill', {
            name: 'sprint-slip',
            request: 'I want to understand why the sprint is slipping.',
            confirm: true
        });
        expect(textOf(result)).toMatch(/Recommended analysis/i);
        expect(InternalSkillRegistry.getSkill('sprint-slip')).toBeNull();
    });

    it('keeps composed skill C unchanged after source skill A is edited', async () => {
        await mcp.callTool('kaarflow_compose_skill', {
            name: 'skill-a-source',
            modules: ['workload', 'deadline'],
            confirm: true
        });
        await mcp.callTool('kaarflow_compose_skill', {
            name: 'skill-c-snapshot',
            sourceSkills: ['skill-a-source', 'sprint-health-analysis'],
            confirm: true
        });
        const before = InternalSkillRegistry.getSkill('skill-c-snapshot')!.analysisModules;
        await mcp.callTool('kaarflow_update_skill', {
            name: 'skill-a-source',
            analysisModules: ['stale-work'],
            confirm: true
        });
        expect(InternalSkillRegistry.getSkill('skill-c-snapshot')!.analysisModules).toEqual(before);
        expect(InternalSkillRegistry.getSkill('skill-c-snapshot')!.analysisModules).not.toContain('stale-work');
    });

    it('writes audit rows with skill subject for compose and execute', async () => {
        await mcp.callTool('kaarflow_compose_skill', {
            name: 'weekly-management-review',
            modules: ['sprint'],
            confirm: true
        });
        await mcp.callTool('skill_execute', { name: 'weekly-management-review', mode: 'brief' });
        const rows = harness.database.all<{ tool: string; subject_ref: string | null; action: string }>(
            'SELECT tool, subject_ref, action FROM tl_activity WHERE subject_ref LIKE ?',
            ['skill:weekly-management-review']
        );
        expect(rows.some(r => r.tool === 'kaarflow_compose_skill')).toBe(true);
        expect(rows.some(r => r.tool === 'skill_execute')).toBe(true);
        expect(JSON.stringify(rows)).not.toMatch(/PAT|password|secret/i);
    });

    it('lists a grouped capability catalogue', async () => {
        const listed = await mcp.callTool('kaarflow_list_skills', {});
        const text = textOf(listed);
        expect(text).toContain('## Sprint');
        expect(text).toContain('## My Skills');
        expect(text).not.toContain('src/core');
    });
});
