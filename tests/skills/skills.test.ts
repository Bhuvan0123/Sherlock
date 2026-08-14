/**
 * Skill catalogue tests.
 *
 * These prove that every skill is fully specified, that it only ever tells the
 * model to call tools this server actually exposes, and that no skill can
 * instruct a change to Azure DevOps or an unconfirmed email send.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
    REQUIRED_SECTIONS,
    SKILL_CATEGORIES,
    discoverSkills,
    getSharedRules,
    parseSkillDocument,
    validateSkills,
    type Skill
} from '../../src/skills/loader.js';
import { FORBIDDEN_TOOL_NAME_PATTERNS } from '../../src/security/read-only-policy.js';
import { connectTestClient, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';

const EXPECTED_SKILLS = [
    'daily-standup-starter',
    'daily-team-report',
    'deadline-risk-analysis',
    'project-health-analysis',
    'skill-index',
    'sprint-health-analysis',
    'team-email-assistant',
    'team-morning-brief',
    'team-productivity-review',
    'tl-productivity-review',
    'weekly-team-review',
    'work-assignment-recommendation',
    'workload-analysis'
];

/**
 * The routing table the product owner specified. Every one of these questions
 * must be documented in the router, pointing at this skill.
 */
const ROUTING_EXAMPLES: [question: string, skill: string][] = [
    ['give me today\'s team status', 'team-morning-brief'],
    ['who is overloaded', 'workload-analysis'],
    ['what work is at risk', 'deadline-risk-analysis'],
    ['how is the project doing', 'project-health-analysis'],
    ['how is this sprint', 'sprint-health-analysis'],
    ['who should take this task', 'work-assignment-recommendation'],
    ['how productive is the team', 'team-productivity-review'],
    ['how am i doing as tl', 'tl-productivity-review'],
    ['send reminders to people with overdue work', 'team-email-assistant'],
    ['prepare my daily report', 'daily-team-report'],
    ['give me last week\'s review', 'weekly-team-review']
];

let skills: Skill[];

beforeEach(() => {
    skills = discoverSkills();
});

describe('skill discovery', () => {
    it('finds every expected skill and nothing else', () => {
        expect(skills.map(skill => skill.name).sort()).toEqual(EXPECTED_SKILLS);
    });

    it('excludes the shared rules directory from the catalogue', () => {
        expect(skills.map(skill => skill.name)).not.toContain('_shared');
    });

    it('loads each skill from its own directory', () => {
        for (const skill of skills) {
            expect(skill.path).toBe(`skills/${skill.name}/SKILL.md`);
        }
    });

    it('publishes the shared rule documents', () => {
        const shared = getSharedRules();
        expect(shared.map(document => document.name).sort()).toEqual([
            'analysis-rules',
            'data-rules',
            'output-format',
            'safety-rules'
        ]);
        for (const document of shared) {
            expect(document.content.length, `${document.name} is empty`).toBeGreaterThan(500);
        }
    });

    it('states the read-only rule and the confirmation rule in the shared safety rules', () => {
        const safety = getSharedRules().find(document => document.name === 'safety-rules')!.content.toLowerCase();
        expect(safety).toContain('read-only');
        expect(safety).toContain('confirmation');
        expect(safety).toContain('never fabricate');
    });
});

describe('skill structure', () => {
    it('gives every skill complete frontmatter', () => {
        for (const skill of skills) {
            expect(skill.title.length, `${skill.name} has no title`).toBeGreaterThan(0);
            expect(skill.description.length, `${skill.name} has no description`).toBeGreaterThan(30);
            expect(skill.description.length, `${skill.name} description is too long to route on`).toBeLessThanOrEqual(400);
            expect(skill.version, `${skill.name} has no version`).toMatch(/^\d+\.\d+\.\d+$/);
            expect(SKILL_CATEGORIES).toContain(skill.category);
            expect(skill.triggers.length, `${skill.name} has no triggers`).toBeGreaterThanOrEqual(3);
        }
    });

    it('gives every skill all required sections, in order and non-empty', () => {
        for (const skill of skills) {
            expect(skill.headings.slice(0, REQUIRED_SECTIONS.length), `${skill.name} section order`).toEqual([
                ...REQUIRED_SECTIONS
            ]);
            for (const section of REQUIRED_SECTIONS) {
                expect((skill.sections[section] ?? '').length, `${skill.name} / ${section} is empty`).toBeGreaterThan(40);
            }
        }
    });

    it('gives every skill an executable workflow and a concrete output template', () => {
        for (const skill of skills) {
            expect(skill.sections.Workflow, `${skill.name} workflow is not a numbered procedure`).toMatch(/^\s*1\./m);
            expect(skill.sections['Edge Cases']!.length, `${skill.name} edge cases are thin`).toBeGreaterThan(300);
        }
    });

    it('names every skill consistently with its directory and title', () => {
        for (const skill of skills) {
            expect(skill.name).toMatch(/^[a-z][a-z0-9-]*$/);
            expect(skill.body.startsWith('# '), `${skill.name} does not open with an H1`).toBe(true);
        }
    });

    it('uses a trigger phrase only once across the catalogue, so routing is unambiguous', () => {
        const seen = new Map<string, string>();
        for (const skill of skills) {
            for (const trigger of skill.triggers) {
                const key = trigger.trim().toLowerCase();
                const owner = seen.get(key);
                expect(owner, `trigger "${trigger}" is claimed by both ${owner} and ${skill.name}`).toBeUndefined();
                seen.set(key, skill.name);
            }
        }
    });
});

describe('skill safety contract', () => {
    it('declares no skill as mutating Azure DevOps', () => {
        for (const skill of skills) {
            expect(skill.mutatesAzureDevOps, `${skill.name} claims to mutate Azure DevOps`).toBe(false);
        }
    });

    it('never references a tool whose name implies a mutation', () => {
        for (const skill of skills) {
            for (const tool of [...skill.primaryTools, ...skill.supportingTools]) {
                for (const pattern of FORBIDDEN_TOOL_NAME_PATTERNS) {
                    expect(pattern.test(tool), `${skill.name} references mutation-shaped tool ${tool}`).toBe(false);
                }
            }
        }
    });

    it('requires confirmation exactly where a skill can send email', () => {
        for (const skill of skills) {
            const canSend = [...skill.primaryTools, ...skill.supportingTools].includes('email_send_confirmed');
            expect(canSend, `${skill.name}: requires_confirmation must match the ability to send`).toBe(
                skill.requiresConfirmation
            );
        }

        // Exactly one skill is allowed to reach the send tool.
        const senders = skills.filter(skill => skill.requiresConfirmation).map(skill => skill.name);
        expect(senders).toEqual(['team-email-assistant']);
    });

    it('spells out the confirmation protocol in the email skill', () => {
        const email = skills.find(skill => skill.name === 'team-email-assistant')!;
        const text = email.body.toLowerCase();

        expect(text).toContain('email_send_confirmed');
        expect(text).toContain('confirmation: true');
        expect(text).toContain('email_cancel_draft');
        expect(text).toMatch(/nothing is sent|nothing has been sent/);
        // The draft must be shown in full before any confirmation is sought.
        expect(text).toMatch(/recipient/);
        expect(text).toMatch(/subject/);
        expect(text).toMatch(/body/);
    });

    it('tells every skill that produces recommendations that it cannot apply them', () => {
        for (const skill of skills.filter(candidate => candidate.category !== 'router')) {
            const text = `${skill.sections['Safety Rules'] ?? ''} ${skill.sections['Output Format'] ?? ''}`.toLowerCase();
            expect(text, `${skill.name} does not state the read-only boundary`).toMatch(
                /read-only|no azure devops changes|cannot change|recommendation only/
            );
        }
    });

    it('names no tool in its prose that the server does not expose', async () => {
        // Frontmatter is validated at startup, but a skill body can name a tool
        // too. A body reference to something imaginary would send the model
        // after a tool that does not exist, so it is held to the same standard.
        const harness = setupHarness();
        const mcp = await connectTestClient();
        try {
            const known = new Set((await mcp.listTools()).map(tool => tool.name));
            const offenders: string[] = [];

            for (const skill of skills) {
                // Only backticked identifiers: prose prefixes such as "the ado_ tools"
                // and wildcards such as `email_draft*` are conventions, not references.
                for (const match of skill.body.matchAll(/`((?:ado|analysis|tl|email|skill)_[a-z0-9_]+)`/g)) {
                    const tool = match[1]!;
                    if (!known.has(tool)) offenders.push(`${skill.name}: ${tool}`);
                }
            }

            expect(offenders).toEqual([]);
        } finally {
            await mcp.close();
            harness.reset();
        }
    });

    it('records the capabilities that are genuinely unavailable rather than inventing them', () => {
        const withGaps = skills.filter(skill => skill.missingCapabilities.length > 0);
        expect(withGaps.length, 'no skill documents a missing capability, which is implausible').toBeGreaterThan(3);
    });
});

describe('skill routing', () => {
    it('publishes a router skill', () => {
        const router = skills.find(skill => skill.name === 'skill-index');
        expect(router).toBeDefined();
        expect(router!.category).toBe('router');
    });

    it('lists every other skill in the router', () => {
        const router = skills.find(skill => skill.name === 'skill-index')!;
        for (const skill of skills.filter(candidate => candidate.name !== 'skill-index')) {
            expect(router.body, `router does not mention ${skill.name}`).toContain(skill.name);
        }
    });

    it('routes each documented question to the right skill', () => {
        const router = skills.find(skill => skill.name === 'skill-index')!;
        const lines = router.body.split('\n');

        for (const [question, skill] of ROUTING_EXAMPLES) {
            const row = lines.find(line => line.toLowerCase().includes(question));
            expect(row, `the router documents no route for "${question}"`).toBeDefined();
            expect(row!.toLowerCase(), `"${question}" should route to ${skill}`).toContain(skill);
        }
    });

    it('explains how to combine skills, and keeps the confirmation gate when it does', () => {
        const router = skills.find(skill => skill.name === 'skill-index')!;
        const text = router.body.toLowerCase();
        expect(text).toMatch(/combin|compound|chain/);
        expect(text).toContain('confirmation');
    });
});

describe('skill catalogue validation', () => {
    it('reports no issues against the live tool surface', async () => {
        const harness = setupHarness();
        const mcp = await connectTestClient();
        try {
            const tools = await mcp.listTools();
            expect(validateSkills(skills, tools.map(tool => tool.name))).toEqual([]);
        } finally {
            await mcp.close();
            harness.reset();
        }
    });

    it('rejects a skill that references a tool which does not exist', () => {
        const broken: Skill = { ...skills[0]!, name: 'broken', path: 'skills/broken/SKILL.md', primaryTools: ['ado_invent_data'] };
        const issues = validateSkills([broken], ['ado_get_work_item']);
        expect(issues.map(issue => issue.reason).join(' ')).toContain('ado_invent_data');
    });

    it('rejects a skill that claims it can change Azure DevOps', () => {
        const broken: Skill = { ...skills[0]!, name: 'broken', path: 'skills/broken/SKILL.md', mutatesAzureDevOps: true };
        const issues = validateSkills([broken], broken.primaryTools);
        expect(issues.map(issue => issue.reason).join(' ')).toContain('read-only');
    });

    it('rejects a skill that is missing a required section', () => {
        const source = [
            '---',
            'name: partial',
            'title: Partial',
            'description: A skill that forgot most of its sections but is long enough to describe.',
            'version: 1.0.0',
            'category: analysis',
            'mutates_azure_devops: false',
            'requires_confirmation: false',
            'primary_tools:',
            '  - ado_get_work_item',
            'triggers:',
            '  - partial',
            '---',
            '',
            '# Partial',
            '',
            '## Purpose',
            'Only this one.'
        ].join('\n');

        const skill = parseSkillDocument(source, 'skills/partial/SKILL.md');
        const issues = validateSkills([skill], ['ado_get_work_item']);
        expect(issues.length).toBeGreaterThan(5);
        expect(issues.map(issue => issue.reason).join(' ')).toContain('When to Use');
    });

    it('rejects malformed frontmatter with a message naming the file', () => {
        expect(() => parseSkillDocument('# No frontmatter here', 'skills/bad/SKILL.md')).toThrow(/skills\/bad\/SKILL\.md/);
        expect(() => parseSkillDocument('---\nname: x\n', 'skills/bad/SKILL.md')).toThrow(/not closed/);
        expect(() =>
            parseSkillDocument('---\nname: x\ncategory: nonsense\ntitle: X\ndescription: d\nversion: 1.0.0\n---\n', 'skills/bad/SKILL.md')
        ).toThrow(/category/);
    });

    it('parses list and scalar frontmatter, including values containing colons', () => {
        const source = [
            '---',
            'name: sample',
            'title: Sample',
            'description: "Handles a value: with a colon in it."',
            'version: 2.1.0',
            'category: report',
            'mutates_azure_devops: false',
            'requires_confirmation: false',
            'primary_tools:',
            '  - ado_get_work_item',
            '  - analysis_deadlines',
            'missing_capabilities:',
            'triggers:',
            '  - sample trigger',
            '---',
            '',
            '# Sample',
            '',
            '## Purpose',
            'Text.'
        ].join('\n');

        const skill = parseSkillDocument(source, 'skills/sample/SKILL.md');
        expect(skill.description).toBe('Handles a value: with a colon in it.');
        expect(skill.primaryTools).toEqual(['ado_get_work_item', 'analysis_deadlines']);
        expect(skill.missingCapabilities).toEqual([]);
        expect(skill.version).toBe('2.1.0');
    });
});

describe('skills over MCP', () => {
    let harness: Harness;
    let mcp: ConnectedClient;
    let tools: Tool[];

    beforeEach(async () => {
        harness = setupHarness();
        mcp = await connectTestClient();
        tools = await mcp.listTools();
    });

    afterEach(async () => {
        await mcp?.close();
        harness?.reset();
    });

    it('exposes exactly two read-only skill tools', () => {
        const skillTools = tools.filter(tool => tool.name.startsWith('skill_'));
        expect(skillTools.map(tool => tool.name).sort()).toEqual(['skill_get', 'skill_list']);
        for (const tool of skillTools) {
            expect(tool.annotations?.readOnlyHint).toBe(true);
        }
    });

    it('lists the catalogue with routing information', async () => {
        const catalogue = await mcp.callToolJson<{
            count: number;
            skills: { name: string; description: string; triggers: string[]; tools: string[] }[];
        }>('skill_list');

        expect(catalogue.count).toBe(EXPECTED_SKILLS.length);
        expect(catalogue.skills.map(skill => skill.name).sort()).toEqual(EXPECTED_SKILLS);
        for (const skill of catalogue.skills) {
            expect(skill.description.length).toBeGreaterThan(0);
        }
    });

    it('filters the catalogue by category', async () => {
        const reports = await mcp.callToolJson<{ count: number; skills: { name: string }[] }>('skill_list', {
            category: 'report'
        });
        expect(reports.count).toBeGreaterThan(0);
        expect(reports.skills.map(skill => skill.name)).toContain('daily-team-report');
        expect(reports.skills.map(skill => skill.name)).not.toContain('team-morning-brief');
    });

    it('loads a skill with its instructions and the shared rules', async () => {
        const skill = await mcp.callToolJson<{
            name: string;
            instructions: string;
            tools: { primary: string[]; supporting: string[] };
            sharedRules: { name: string; content: string }[];
            azureDevOpsAccess: string;
        }>('skill_get', { name: 'team-morning-brief' });

        expect(skill.name).toBe('team-morning-brief');
        expect(skill.azureDevOpsAccess).toBe('read-only');
        expect(skill.instructions).toContain('## Workflow');
        expect(skill.tools.primary).toContain('analysis_daily_team_review');
        expect(skill.sharedRules.map(document => document.name)).toContain('safety-rules');
    });

    it('can omit the shared rules on request but still says they apply', async () => {
        const skill = await mcp.callToolJson<{ sharedRules: null; sharedRulesNote: string }>('skill_get', {
            name: 'team-morning-brief',
            include_shared_rules: false
        });
        expect(skill.sharedRules).toBeNull();
        expect(skill.sharedRulesNote.toLowerCase()).toContain('still apply');
    });

    it('fails clearly for an unknown skill and suggests the real ones', async () => {
        const result = await mcp.callTool('skill_get', { name: 'does-not-exist' });
        expect(result.isError).toBe(true);
        const text = result.content.map(block => (block as { text?: string }).text ?? '').join(' ');
        expect(text).toContain('does-not-exist');
        expect(text).toContain('team-morning-brief');
    });

    it('publishes the catalogue and every skill as resources', async () => {
        const resources = await mcp.client.listResources();
        const uris = resources.resources.map(resource => resource.uri);

        expect(uris).toContain('skill://kaarpulse/index');
        expect(uris).toContain('skill://kaarpulse/_shared/rules');
        for (const name of EXPECTED_SKILLS) {
            expect(uris, `no resource for skill ${name}`).toContain(`skill://kaarpulse/${name}`);
        }

        const index = await mcp.client.readResource({ uri: 'skill://kaarpulse/index' });
        const payload = JSON.parse(String((index.contents[0] as { text?: string }).text ?? '')) as {
            count: number;
            azureDevOpsAccess: string;
        };
        expect(payload.count).toBe(EXPECTED_SKILLS.length);
        expect(payload.azureDevOpsAccess).toBe('read-only');
    });

    it('reads Azure DevOps only when a skill is followed, never when it is loaded', async () => {
        const before = harness.requests.length;
        await mcp.callToolJson('skill_list');
        await mcp.callToolJson('skill_get', { name: 'workload-analysis' });
        expect(harness.requests.length, 'loading a skill must not call Azure DevOps').toBe(before);
    });

    it('records skill loading in the Team Lead audit trail', async () => {
        await mcp.callToolJson('skill_get', { name: 'deadline-risk-analysis' });
        const activity = await mcp.callToolJson<{ entries: { tool: string; subjectRef: string | null }[] }>('tl_get_activity', {
            tool: 'skill_get'
        });
        expect(activity.entries.length).toBeGreaterThan(0);
        expect(activity.entries[0]!.subjectRef).toBe('skill:deadline-risk-analysis');
    });
});
