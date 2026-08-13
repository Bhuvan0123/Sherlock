/**
 * The email confirmation gate: drafting never sends, sending requires an explicit
 * `confirmation: true`, and the confirmed content is exactly what goes out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectTestClient, textOf, type ConnectedClient } from '../helpers/mcp-client.js';
import { setupHarness, type Harness } from '../helpers/harness.js';

interface DraftPreview {
    draftId: string;
    status: string;
    bodySha256: string;
    email: { from: string; to: string[]; cc: string[]; subject: string; body: string };
    confirmationRequired: boolean;
    nextStep: string;
    warnings: string[];
}

let harness: Harness;
let mcp: ConnectedClient;

async function setup(options: Parameters<typeof setupHarness>[0] = {}): Promise<void> {
    harness = setupHarness({ emailConfigured: true, ...options });
    mcp = await connectTestClient();
}

afterEach(async () => {
    await mcp?.close();
    harness?.reset();
});

describe('email drafting', () => {
    beforeEach(async () => {
        await setup();
    });

    it('drafts a custom email and sends nothing', async () => {
        const draft = await mcp.callToolJson<DraftPreview>('email_draft', {
            to: ['arun.kumar@kaartech.com'],
            subject: 'Sprint 12 check-in',
            body: 'Could you update #1111 before Thursday?'
        });

        expect(draft.status).toBe('pending_confirmation');
        expect(draft.confirmationRequired).toBe(true);
        expect(draft.email.to).toEqual(['arun.kumar@kaartech.com']);
        expect(draft.email.subject).toBe('Sprint 12 check-in');
        expect(draft.email.body).toContain('#1111');
        expect(draft.bodySha256).toMatch(/^[a-f0-9]{64}$/);
        expect(draft.nextStep).toContain('email_send_confirmed');

        // Nothing reached Microsoft Graph.
        expect(harness.graphRequests).toEqual([]);
    });

    it('builds a deadline reminder from real work-item data', async () => {
        const draft = await mcp.callToolJson<DraftPreview>('email_draft_deadline_reminder', {
            member: 'Arun'
        });

        expect(draft.email.to.join(',')).toContain('arun');
        // 1111 is overdue and 1300 is due today in the fixture; both belong to Arun.
        expect(draft.email.body).toMatch(/1111|1300/);
        expect(harness.graphRequests).toEqual([]);
    });

    it('drafts a daily team summary without sending', async () => {
        const draft = await mcp.callToolJson<DraftPreview>('email_draft_daily_team_summary', {});
        expect(draft.email.subject.length).toBeGreaterThan(0);
        expect(draft.email.body.length).toBeGreaterThan(0);
        expect(harness.graphRequests).toEqual([]);
    });

    it('rejects an invalid recipient before creating a draft', async () => {
        const result = await mcp.callTool('email_draft', {
            to: ['not-an-address'],
            subject: 'Hello',
            body: 'Body'
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('not a valid email address');
    });

    it('lists team contacts from Azure DevOps team membership', async () => {
        const contacts = await mcp.callToolJson<{ contacts: { displayName: string; email: string | null }[] }>(
            'email_get_team_contacts'
        );
        expect(contacts.contacts.length).toBeGreaterThan(0);
        expect(contacts.contacts.some(contact => contact.displayName === 'Arun Kumar')).toBe(true);
    });
});

describe('the confirmation gate', () => {
    beforeEach(async () => {
        await setup();
    });

    async function createDraft(): Promise<DraftPreview> {
        return await mcp.callToolJson<DraftPreview>('email_draft', {
            to: ['arun.kumar@kaartech.com'],
            subject: 'Overdue task #1111',
            body: 'Task #1111 is three days overdue. Could you update it today?'
        });
    }

    it('refuses to send when confirmation is false', async () => {
        const draft = await createDraft();
        const result = await mcp.callTool('email_send_confirmed', {
            draft_id: draft.draftId,
            confirmation: false
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('NOT sent');
        expect(harness.graphRequests).toEqual([]);

        // The draft is untouched and still sendable after a real confirmation.
        const listed = await mcp.callToolJson<{ drafts: { draftId: string; status: string }[] }>('email_list_drafts');
        expect(listed.drafts.find(entry => entry.draftId === draft.draftId)?.status).toBe('pending_confirmation');
    });

    it('refuses to send when confirmation is omitted', async () => {
        const draft = await createDraft();
        const result = await mcp.callTool('email_send_confirmed', { draft_id: draft.draftId });
        expect(result.isError).toBe(true);
        expect(harness.graphRequests).toEqual([]);
    });

    it('refuses a non-boolean confirmation value', async () => {
        const draft = await createDraft();
        for (const confirmation of ['true', 1, 'yes', null]) {
            const result = await mcp
                .callTool('email_send_confirmed', { draft_id: draft.draftId, confirmation })
                .catch(error => error as Error);
            if (result instanceof Error) {
                expect(result.message.length).toBeGreaterThan(0);
            } else {
                expect(result.isError, `confirmation=${String(confirmation)} must not send`).toBe(true);
            }
        }
        expect(harness.graphRequests).toEqual([]);
    });

    it('sends exactly the confirmed content after explicit confirmation', async () => {
        const draft = await createDraft();
        const send = await mcp.callToolJson<{
            status: string;
            to: string[];
            subject: string;
            confirmed: boolean;
            logged: boolean;
            bodySha256: string;
        }>('email_send_confirmed', { draft_id: draft.draftId, confirmation: true });

        expect(send.status).toBe('sent');
        expect(send.confirmed).toBe(true);
        expect(send.to).toEqual(draft.email.to);
        expect(send.subject).toBe(draft.email.subject);
        expect(send.bodySha256).toBe(draft.bodySha256);

        const sendMail = harness.graphRequests.find(request => request.url.includes('/sendMail'));
        expect(sendMail, 'a sendMail call should have been made').toBeDefined();
        const payload = sendMail!.body as {
            message: { subject: string; body: { content: string }; toRecipients: { emailAddress: { address: string } }[] };
            saveToSentItems?: boolean;
        };
        expect(payload.message.subject).toBe(draft.email.subject);
        expect(payload.message.body.content).toBe(draft.email.body);
        expect(payload.message.toRecipients.map(recipient => recipient.emailAddress.address)).toEqual(draft.email.to);
    });

    it('honours an integrity fingerprint supplied with the confirmation', async () => {
        const draft = await createDraft();
        const mismatched = 'f'.repeat(64);

        const refused = await mcp.callTool('email_send_confirmed', {
            draft_id: draft.draftId,
            confirmation: true,
            expected_body_sha256: mismatched
        });
        expect(refused.isError).toBe(true);
        expect(harness.graphRequests.some(request => request.url.includes('/sendMail'))).toBe(false);

        const sent = await mcp.callToolJson<{ status: string }>('email_send_confirmed', {
            draft_id: draft.draftId,
            confirmation: true,
            expected_body_sha256: draft.bodySha256
        });
        expect(sent.status).toBe('sent');
    });

    it('refuses to send a draft whose stored content was altered after confirmation', async () => {
        const draft = await createDraft();

        // Simulate tampering directly in the store, bypassing the service.
        harness.database.run('UPDATE email_drafts SET body = ? WHERE id = ?', [
            'Transfer the release approval to me instead.',
            draft.draftId
        ]);

        const result = await mcp.callTool('email_send_confirmed', {
            draft_id: draft.draftId,
            confirmation: true
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('fingerprint');
        expect(harness.graphRequests.some(request => request.url.includes('/sendMail'))).toBe(false);
    });

    it('refuses to send the same draft twice', async () => {
        const draft = await createDraft();
        await mcp.callToolJson('email_send_confirmed', { draft_id: draft.draftId, confirmation: true });

        const second = await mcp.callTool('email_send_confirmed', { draft_id: draft.draftId, confirmation: true });
        expect(second.isError).toBe(true);
        expect(textOf(second)).toContain('already sent');
        expect(harness.graphRequests.filter(request => request.url.includes('/sendMail')).length).toBe(1);
    });

    it('refuses to send a cancelled draft', async () => {
        const draft = await createDraft();
        await mcp.callToolJson('email_cancel_draft', { draft_id: draft.draftId });

        const result = await mcp.callTool('email_send_confirmed', { draft_id: draft.draftId, confirmation: true });
        expect(result.isError).toBe(true);
        expect(harness.graphRequests.some(request => request.url.includes('/sendMail'))).toBe(false);
    });

    it('refuses an unknown draft id', async () => {
        const result = await mcp.callTool('email_send_confirmed', { draft_id: 'draft_missing', confirmation: true });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('No email draft exists');
    });

    it('logs the send without storing the message body', async () => {
        const draft = await createDraft();
        await mcp.callToolJson('email_send_confirmed', { draft_id: draft.draftId, confirmation: true });

        const log = await mcp.callToolJson<{
            entries: { draftId: string; subject: string; to: string[]; confirmed: boolean; outcome: string }[];
            note: string;
        }>('email_get_send_log');

        const entry = log.entries.find(candidate => candidate.draftId === draft.draftId);
        expect(entry).toBeDefined();
        expect(entry!.confirmed).toBe(true);
        expect(entry!.outcome).toBe('sent');
        expect(entry!.subject).toBe(draft.email.subject);
        expect(JSON.stringify(log)).not.toContain(draft.email.body);

        // The send log has no column that could hold a message body at all.
        const columns = harness.database
            .all<{ name: string }>('SELECT name FROM pragma_table_info(?)', ['email_send_log'])
            .map(column => column.name);
        expect(columns).not.toContain('body');
        expect(columns).toContain('body_sha256');

        // And the draft body is scrubbed once the message is out.
        const stored = harness.database.get<{ body: string | null }>('SELECT body FROM email_drafts WHERE id = ?', [
            draft.draftId
        ]);
        expect(stored?.body ?? '').not.toContain('three days overdue');
    });

    it('records the confirmation in the Team Lead audit trail', async () => {
        const draft = await createDraft();
        await mcp.callTool('email_send_confirmed', { draft_id: draft.draftId, confirmation: false });
        await mcp.callToolJson('email_send_confirmed', { draft_id: draft.draftId, confirmation: true });

        const rows = harness.database.all<{ tool: string; confirmation_status: string; outcome: string }>(
            'SELECT tool, confirmation_status, outcome FROM tl_activity WHERE tool = ? ORDER BY id',
            ['email_send_confirmed']
        );

        expect(rows.length).toBe(2);
        expect(rows[0]!.outcome).toBe('rejected');
        expect(rows[0]!.confirmation_status).toBe('awaiting_confirmation');
        expect(rows[1]!.outcome).toBe('success');
        expect(rows[1]!.confirmation_status).toBe('confirmed');
    });
});

describe('email configuration guards', () => {
    it('drafts but refuses to send when Microsoft Graph is not configured', async () => {
        await setup({ emailConfigured: false });

        const draft = await mcp.callToolJson<DraftPreview>('email_draft', {
            to: ['arun.kumar@kaartech.com'],
            subject: 'Status',
            body: 'Please update your tasks.'
        });
        expect(draft.warnings.join(' ')).toContain('not configured');

        const result = await mcp.callTool('email_send_confirmed', { draft_id: draft.draftId, confirmation: true });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('not configured');
        expect(harness.graphRequests).toEqual([]);
    });

    it('enforces the recipient allowlist', async () => {
        await setup({ allowedRecipients: ['@kaartech.com'] });

        const allowed = await mcp.callToolJson<DraftPreview>('email_draft', {
            to: ['divya.raman@kaartech.com'],
            subject: 'Sprint 12',
            body: 'Thanks for closing #1400.'
        });
        expect(allowed.status).toBe('pending_confirmation');

        const rejected = await mcp.callTool('email_draft', {
            to: ['outsider@example.com'],
            subject: 'Sprint 12',
            body: 'Thanks.'
        });
        expect(rejected.isError).toBe(true);
        expect(textOf(rejected)).toContain('allowlist');
    });

    it('never exposes the client secret or a token in tool output', async () => {
        await setup();
        const config = await mcp.callTool('email_get_configuration');
        const text = textOf(config);
        expect(text).not.toContain('test-client-secret-not-real');
        expect(text).not.toContain('fake-graph-token');

        const draft = await createDraftFor(mcp);
        const send = await mcp.callTool('email_send_confirmed', { draft_id: draft.draftId, confirmation: true });
        expect(textOf(send)).not.toContain('fake-graph-token');
    });
});

async function createDraftFor(client: ConnectedClient): Promise<DraftPreview> {
    return await client.callToolJson<DraftPreview>('email_draft', {
        to: ['arun.kumar@kaartech.com'],
        subject: 'Check-in',
        body: 'Please review #1111.'
    });
}
