import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectTestClient, textOf, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';
import { InternalSkillRegistry } from '../../src/core/skill-registry.js';

const SKILLS = InternalSkillRegistry.listSkills()
    .filter(s => s.type === 'builtin')
    .map(s => s.name);

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

describe('built-in analysis skills in three modes', () => {
    it('every built-in skill is registered with brief, verbose and visual', () => {
        expect(SKILLS.length).toBeGreaterThanOrEqual(17);
        for (const name of SKILLS) {
            const def = InternalSkillRegistry.getSkill(name)!;
            expect(def.supportedModes).toEqual(expect.arrayContaining(['brief', 'verbose', 'visual']));
        }
    });

    it('executes each built-in skill in brief, verbose and visual without leaking internals', async () => {
        for (const name of SKILLS) {
            for (const mode of ['brief', 'verbose', 'visual'] as const) {
                const result = await mcp.callTool('skill_execute', { name, mode });
                expect(result.isError).toBeFalsy();
                const md = textOf(result);
                expect(md.toLowerCase()).not.toContain('[object object]');
                expect(md).not.toMatch(/test-pat-value-not-a-real-secret/);
                expect(md).toMatch(/ADO Work Items Modified: No/i);
                if (mode === 'brief') {
                    expect(md).toMatch(/\|/);
                }
                if (mode === 'visual') {
                    expect(md).toMatch(/\|/);
                }
            }
        }
    }, 120_000);

    it('assignment skill never claims an ADO write', async () => {
        const md = textOf(await mcp.callTool('skill_execute', { name: 'work-assignment-recommendation', mode: 'brief' }));
        expect(md).toMatch(/Recommendation only/i);
    });
});
