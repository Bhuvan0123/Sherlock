import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getTeamService } from '../../../services/azure-devops/team.service.js';
import { getEmailService } from '../../../services/email/email.service.js';
import { getGraphEmailService } from '../../../services/email/graph.service.js';
import { getEmailTemplateService } from '../../../services/email/templates.service.js';
import { registerTool } from '../../tool-registry.js';

const recipients = z
    .array(z.string().min(3))
    .min(1)
    .max(25)
    .describe('Recipient email addresses. Validated for format and against EMAIL_ALLOWED_RECIPIENTS when that is configured.');

/**
 * Email tools.
 *
 * Sending is the only outbound mutation this server can perform, and it is gated:
 * `email_send_confirmed` accepts only a draft id plus `confirmation: true`. It takes
 * no recipient, subject or body, so the content shown for confirmation is
 * necessarily the content sent - a draft cannot be edited after confirmation.
 */
export function registerEmailTools(server: McpServer): void {
    registerTool(server, {
        name: 'email_get_team_contacts',
        title: 'Team email contacts',
        description:
            'Email addresses of the configured team\'s members, taken from their Azure DevOps identities. Members without an email address are listed with null so the gap is visible.',
        group: 'email',
        inputSchema: { team: z.string().min(1).optional().describe('Team name. Defaults to the configured team.') },
        audit: { category: 'team_review', action: 'Read team email contacts' },
        handler: async args => {
            const contacts = await getTeamService().getMemberEmails(args.team as string | undefined);
            const missing = contacts.filter(contact => contact.email === null);
            return {
                count: contacts.length,
                contacts,
                withoutEmail: missing.length,
                ...(missing.length > 0
                    ? { note: `${missing.length} member(s) have no email address in Azure DevOps and cannot be emailed by name.` }
                    : {})
            };
        }
    });

    registerTool(server, {
        name: 'email_get_configuration',
        title: 'Email configuration status',
        description:
            'Whether email sending is configured, which sender mailbox is used, and any missing environment variables. Never returns secrets.',
        group: 'email',
        audit: { category: 'maintenance', action: 'Check email configuration' },
        handler: async () => {
            const status = getGraphEmailService().describeConfiguration();
            return {
                ...status,
                note: status.configured
                    ? 'Email sending is configured. Sending still requires an explicit confirmation for each draft.'
                    : 'Drafting works, but sending is disabled until the missing configuration is provided.'
            };
        }
    });

    registerTool(server, {
        name: 'email_draft',
        title: 'Draft a custom email',
        description:
            'Creates an email draft and returns the exact recipients, subject and body that would be sent, plus a content fingerprint and a draft id. NOTHING IS SENT. Show the draft to the Team Lead, obtain explicit confirmation, then call email_send_confirmed with the draft id.',
        group: 'email',
        inputSchema: {
            to: recipients,
            subject: z.string().min(1).max(255).describe('Email subject.'),
            body: z.string().min(1).max(100_000).describe('Email body.'),
            cc: z.array(z.string().min(3)).max(25).optional().describe('Optional CC addresses.'),
            content_type: z.enum(['Text', 'HTML']).optional().describe('Body format. Default Text.')
        },
        audit: {
            category: 'email_draft',
            action: 'Draft custom email',
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args =>
            getEmailService().createDraft({
                to: args.to as string[],
                subject: args.subject as string,
                body: args.body as string,
                ...(args.cc ? { cc: args.cc as string[] } : {}),
                ...(args.content_type ? { contentType: args.content_type as 'Text' | 'HTML' } : {}),
                kind: 'custom'
            }),
        summarise: result => draftSummary(result)
    });

    registerTool(server, {
        name: 'email_draft_deadline_reminder',
        title: 'Draft a deadline reminder',
        description:
            'Builds a reminder to one team member listing their overdue items and items due within the horizon, using live Azure DevOps data and work-item links. NOTHING IS SENT - the draft must be confirmed first.',
        group: 'email',
        inputSchema: {
            member: z.string().min(1).describe('Team member name or email.'),
            horizon_days: z.number().int().min(1).max(60).optional().describe('How far ahead to include upcoming work. Default 7.'),
            note: z.string().max(2000).optional().describe('Optional extra sentence to include in the body.')
        },
        audit: {
            category: 'email_draft',
            action: 'Draft deadline reminder',
            subject: args => `member:${args.member}`,
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args =>
            await getEmailTemplateService().draftDeadlineReminder({
                member: args.member as string,
                ...(args.horizon_days ? { horizonDays: args.horizon_days as number } : {}),
                ...(args.note ? { extraNote: args.note as string } : {})
            }),
        summarise: result => draftSummary(result)
    });

    registerTool(server, {
        name: 'email_draft_overdue_work',
        title: 'Draft an overdue-work follow-up',
        description:
            'Builds a follow-up about overdue work, either for one member or for the whole team, listing each overdue item with its state, owner, how late it is and a link. NOTHING IS SENT until confirmed.',
        group: 'email',
        inputSchema: {
            member: z.string().min(1).optional().describe('Limit to one member\'s overdue work. Omit for the whole team.'),
            to: z.array(z.string().min(3)).max(25).optional().describe('Override the recipients.'),
            note: z.string().max(2000).optional().describe('Optional extra sentence to include in the body.')
        },
        audit: {
            category: 'email_draft',
            action: 'Draft overdue work email',
            subject: args => (args.member ? `member:${args.member}` : 'team:overdue'),
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args =>
            await getEmailTemplateService().draftOverdueWorkEmail({
                ...(args.member ? { member: args.member as string } : {}),
                ...(args.to ? { to: args.to as string[] } : {}),
                ...(args.note ? { extraNote: args.note as string } : {})
            }),
        summarise: result => draftSummary(result)
    });

    registerTool(server, {
        name: 'email_draft_daily_team_summary',
        title: 'Draft the daily team summary',
        description:
            'Builds a daily status email from live Azure DevOps data: sprint progress, deadlines, items due today, overdue work, blocked work with evidence, unassigned work and open items per person. Contains measured facts only - no risk ratings or AI recommendations go out to the team. NOTHING IS SENT until confirmed.',
        group: 'email',
        inputSchema: {
            to: z.array(z.string().min(3)).max(25).optional().describe('Recipients. Defaults to every team member with an email address.'),
            include_unassigned: z.boolean().optional().describe('Include the unassigned section. Default true.'),
            note: z.string().max(2000).optional().describe('Optional extra sentence to include in the body.')
        },
        audit: {
            category: 'email_draft',
            action: 'Draft daily team summary',
            confirmationStatus: () => 'awaiting_confirmation'
        },
        handler: async args =>
            await getEmailTemplateService().draftDailyTeamSummary({
                ...(args.to ? { to: args.to as string[] } : {}),
                ...(args.include_unassigned === undefined ? {} : { includeUnassigned: args.include_unassigned as boolean }),
                ...(args.note ? { extraNote: args.note as string } : {})
            }),
        summarise: result => draftSummary(result)
    });

    registerTool(server, {
        name: 'email_list_drafts',
        title: 'List email drafts',
        description: 'Recent drafts with their status (pending confirmation, sent, cancelled, expired, failed) and full content.',
        group: 'email',
        inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('Maximum drafts to return. Default 20.') },
        audit: { category: 'email_draft', action: 'List email drafts' },
        handler: async args => getEmailService().listDrafts((args.limit as number | undefined) ?? 20)
    });

    registerTool(server, {
        name: 'email_cancel_draft',
        title: 'Cancel an email draft',
        description: 'Cancels a pending draft so it can never be sent. Use when the Team Lead declines to send.',
        group: 'email',
        inputSchema: { draft_id: z.string().min(1).describe('The draft id to cancel.') },
        audit: {
            category: 'confirmation',
            action: 'Cancel email draft',
            subject: args => `draft:${args.draft_id}`,
            confirmationStatus: () => 'declined'
        },
        handler: async args => getEmailService().cancelDraft(args.draft_id as string)
    });

    registerTool(server, {
        name: 'email_send_confirmed',
        title: 'Send a confirmed email',
        description:
            'Sends a previously drafted email, and ONLY after the Team Lead has explicitly confirmed it. `confirmation` must be exactly true; anything else is refused and nothing is sent. This tool accepts no recipient, subject or body: it sends the stored draft byte-for-byte, so the confirmed content is the sent content. Do not call this without an unambiguous "yes, send it" from the Team Lead in the current conversation.',
        group: 'email',
        readOnly: false,
        inputSchema: {
            draft_id: z.string().min(1).describe('The draft id returned by an email_draft* tool.'),
            confirmation: z
                .boolean()
                .describe('Must be exactly true, and only after the Team Lead has explicitly confirmed this specific draft.'),
            expected_body_sha256: z
                .string()
                .length(64)
                .optional()
                .describe('Optional integrity check: the bodySha256 shown to the Team Lead. The send is refused if it no longer matches.')
        },
        audit: {
            category: 'email_send',
            action: 'Send confirmed email',
            subject: args => `draft:${args.draft_id}`,
            confirmationStatus: args => (args.confirmation === true ? 'confirmed' : 'awaiting_confirmation')
        },
        handler: async args =>
            await getEmailService().sendConfirmed({
                draftId: args.draft_id as string,
                confirmation: args.confirmation === true,
                ...(args.expected_body_sha256 ? { expectedBodySha256: args.expected_body_sha256 as string } : {})
            }),
        summarise: result => {
            const send = result as { subject: string; to: string[]; sentAt: string };
            return `Email sent to ${send.to.join(', ')} at ${send.sentAt}: "${send.subject}".`;
        }
    });

    registerTool(server, {
        name: 'email_get_send_log',
        title: 'Email send log',
        description:
            'Local log of emails sent through this server: recipients, subject, timestamp, draft id, confirmation flag and a body fingerprint. Message bodies are intentionally not stored.',
        group: 'email',
        inputSchema: { limit: z.number().int().min(1).max(500).optional().describe('Maximum entries. Default 50.') },
        audit: { category: 'maintenance', action: 'Read email send log' },
        handler: async args => getEmailService().getSendLog((args.limit as number | undefined) ?? 50)
    });
}

function draftSummary(result: unknown): string {
    const draft = result as {
        draftId: string;
        email: { to: string[]; subject: string };
        expiresAt: string;
    };
    return [
        `DRAFT ONLY - NOTHING HAS BEEN SENT.`,
        `To: ${draft.email.to.join(', ')} | Subject: "${draft.email.subject}"`,
        `Draft id: ${draft.draftId} (valid until ${draft.expiresAt}).`,
        `Show the full body below to the Team Lead and ask for explicit confirmation before calling email_send_confirmed.`
    ].join('\n');
}
