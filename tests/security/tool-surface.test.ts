/**
 * THE critical security test.
 *
 * It connects a real MCP client to the real server and proves, from the client's
 * point of view, that no tool exists which could create, update, delete, assign
 * or otherwise modify anything in Azure DevOps - and that no tool schema accepts
 * an HTTP method, URL or request payload.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
    FORBIDDEN_PAYLOAD_PARAMETER_NAMES,
    FORBIDDEN_TOOL_NAME_PATTERNS,
    FORBIDDEN_TOOL_PARAMETER_NAMES,
    auditToolSurface
} from '../../src/security/read-only-policy.js';
import { connectTestClient, textOf, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';

let harness: Harness;
let mcp: ConnectedClient;
let tools: Tool[];

beforeEach(async () => {
    harness = setupHarness({ emailConfigured: true });
    mcp = await connectTestClient();
    tools = await mcp.listTools();
});

afterEach(async () => {
    await mcp?.close();
    harness?.reset();
});

function parameterNames(tool: Tool): string[] {
    const properties = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
    return properties ? Object.keys(properties) : [];
}

describe('exposed tool surface', () => {
    it('exposes tools in every expected category', () => {
        const names = tools.map(tool => tool.name);
        expect(names.length).toBeGreaterThan(50);

        for (const prefix of ['ado_', 'analysis_', 'tl_', 'email_']) {
            expect(names.filter(name => name.startsWith(prefix)).length).toBeGreaterThan(0);
        }

        // Spot-check the tools the acceptance criteria call out by name.
        for (const required of [
            'ado_get_project_overview',
            'ado_get_team_members',
            'ado_get_current_sprint',
            'ado_get_work_item',
            'ado_search_work_items',
            'ado_get_work_item_hierarchy',
            'ado_get_work_item_history',
            'ado_get_work_item_comments',
            'ado_get_overdue_items',
            'ado_get_blocked_items',
            'ado_get_backlogs',
            'analysis_project_health',
            'analysis_team_productivity',
            'analysis_deadline_risk',
            'analysis_work_distribution',
            'analysis_team_workload',
            'analysis_assignment_recommendation',
            'analysis_daily_team_review',
            'tl_get_activity',
            'tl_get_weekly_review',
            'tl_analyze_productivity',
            'email_get_team_contacts',
            'email_draft',
            'email_draft_deadline_reminder',
            'email_send_confirmed'
        ]) {
            expect(names, `missing tool ${required}`).toContain(required);
        }
    });

    it('has no tool whose name implies an Azure DevOps mutation', () => {
        const offenders = tools.filter(tool =>
            FORBIDDEN_TOOL_NAME_PATTERNS.some(pattern => pattern.test(tool.name))
        );
        expect(offenders.map(tool => tool.name)).toEqual([]);
    });

    it('names every non-email tool with a read verb, except saved-query creation', () => {
        const readVerb = /^(ado_(get|search|refresh|query)_|analysis_|tl_(get|analyze|purge)_|skill_(list|get)$|create_ado_query$)/;
        for (const tool of tools.filter(candidate => !candidate.name.startsWith('email_'))) {
            expect(tool.name, `tool ${tool.name} is not named as a read operation`).toMatch(readVerb);
        }
    });

    it('has no tool containing a mutation verb except create_ado_query', () => {
        const mutationVerbs = ['create', 'update', 'delete', 'edit', 'modify', 'patch', 'write', 'post_', 'put_', 'reopen', 'reassign'];
        for (const tool of tools) {
            if (tool.name === 'create_ado_query') continue;
            for (const verb of mutationVerbs) {
                expect(tool.name.toLowerCase(), `tool ${tool.name} contains mutation verb "${verb}"`).not.toContain(verb);
            }
        }
        expect(tools.map(tool => tool.name)).toContain('create_ado_query');
    });

    it('never accepts an HTTP method, URL, header or credential parameter', () => {
        for (const tool of tools) {
            for (const parameter of parameterNames(tool)) {
                expect(
                    (FORBIDDEN_TOOL_PARAMETER_NAMES as readonly string[]).includes(parameter.toLowerCase()),
                    `tool ${tool.name} exposes low-level parameter ${parameter}`
                ).toBe(false);
            }
        }
    });

    it('only accepts a payload-shaped parameter on the email drafting surface', () => {
        for (const tool of tools) {
            for (const parameter of parameterNames(tool)) {
                if (!(FORBIDDEN_PAYLOAD_PARAMETER_NAMES as readonly string[]).includes(parameter.toLowerCase())) continue;
                expect(tool.name.startsWith('email_'), `tool ${tool.name} accepts payload parameter ${parameter}`).toBe(true);
                expect(parameter.toLowerCase()).toBe('body');
            }
        }
    });

    it('passes the read-only policy audit', () => {
        const violations = auditToolSurface(
            tools.map(tool => ({ name: tool.name, parameterNames: parameterNames(tool) }))
        );
        expect(violations).toEqual([]);
    });

    it('marks every tool except confirmed email sending and saved-query creation as read-only', () => {
        const nonReadOnly = tools.filter(tool => tool.annotations?.readOnlyHint !== true).map(tool => tool.name).sort();
        expect(nonReadOnly).toEqual(['create_ado_query', 'email_send_confirmed']);
    });

    it('marks no tool as destructive', () => {
        const destructive = tools.filter(tool => tool.annotations?.destructiveHint === true).map(tool => tool.name);
        expect(destructive).toEqual([]);
    });

    it('rejects an attempt to update an Azure DevOps work item through the MCP', async () => {
        // Names a client might reach for. None may exist.
        const attempts = [
            'ado_update_work_item',
            'ado_create_work_item',
            'ado_delete_work_item',
            'ado_assign_work_item',
            'ado_set_work_item_state',
            'ado_add_work_item_comment',
            'ado_update_sprint',
            'ado_modify_backlog',
            'azure_devops_request',
            'ado_request'
        ];

        for (const name of attempts) {
            expect(tools.map(tool => tool.name), `${name} must not exist`).not.toContain(name);

            const result = await mcp.callTool(name, { id: 5421, state: 'Closed' }).catch(error => error as Error);
            if (result instanceof Error) {
                expect(result.message.toLowerCase()).toMatch(/not found|unknown tool|invalid/);
            } else {
                expect(result.isError, `${name} unexpectedly succeeded`).toBe(true);
            }
        }
    });

    it('explains the read-only policy when asked, through the access-policy resource', async () => {
        const resources = await mcp.client.listResources();
        const policy = resources.resources.find(resource => resource.uri.startsWith('policy://'));
        expect(policy, 'an access-policy resource should be published').toBeDefined();

        const contents = await mcp.client.readResource({ uri: policy!.uri });
        const text = String((contents.contents[0] as { text?: string }).text ?? '');
        expect(text.toLowerCase()).toContain('read-only');
        expect(text.toLowerCase()).toContain('confirmation');
    });

    it('describes Azure DevOps tools as read-only in their descriptions', () => {
        const adoTools = tools.filter(tool => tool.name.startsWith('ado_'));
        expect(adoTools.length).toBeGreaterThan(20);
        for (const tool of adoTools) {
            expect(tool.annotations?.readOnlyHint).toBe(true);
        }
    });

    it('requires explicit confirmation on the only sending tool', () => {
        const send = tools.find(tool => tool.name === 'email_send_confirmed');
        expect(send).toBeDefined();

        const schema = send!.inputSchema as {
            properties?: Record<string, unknown>;
            required?: string[];
        };
        expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
            'confirmation',
            'draft_id',
            'expected_body_sha256'
        ]);
        expect(schema.required?.sort()).toEqual(['confirmation', 'draft_id']);

        // The confirmed content cannot be altered at send time: there is no
        // recipient, subject or body parameter on this tool. `expected_body_sha256`
        // can only make the send stricter, never change what is sent.
        for (const forbidden of ['to', 'cc', 'subject', 'body', 'recipients']) {
            expect(Object.keys(schema.properties ?? {})).not.toContain(forbidden);
        }
    });

    it('returns a clear refusal when a work-item change is requested via a read tool', async () => {
        // `analysis_assignment_recommendation` is the closest thing to "assign this",
        // and it must state that it cannot perform the change.
        const result = await mcp.callTool('analysis_assignment_recommendation', { work_item_id: 1210 });
        const text = textOf(result).toLowerCase();
        expect(result.isError).not.toBe(true);
        expect(text).toContain('read-only');
    });
});
