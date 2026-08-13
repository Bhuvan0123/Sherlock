import { createHash, randomUUID } from 'node:crypto';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { nowIso } from '../../utils/dates.js';
import { getEmailRepository, type EmailDraft, type EmailRepository } from '../../database/repository/email.repository.js';
import { getGraphEmailService, type GraphEmailService } from './graph.service.js';

const log = createLogger('email');

/** Deliberately conservative address check; the tenant does the real validation. */
const EMAIL_PATTERN = /^[^\s@<>",;]+@[^\s@<>",;.]+(\.[^\s@<>",;.]+)+$/;

export interface DraftInput {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    contentType?: 'Text' | 'HTML';
    kind?: string;
    relatedItems?: number[];
}

export interface DraftPreview {
    draftId: string;
    status: EmailDraft['status'];
    createdAt: string;
    expiresAt: string;
    kind: string;
    /** The exact message that will be sent, shown for confirmation. */
    email: {
        from: string;
        to: string[];
        cc: string[];
        subject: string;
        body: string;
        contentType: 'Text' | 'HTML';
    };
    bodySha256: string;
    relatedWorkItems: number[];
    confirmationRequired: true;
    /** Explicit instruction so the confirmation step is never ambiguous. */
    nextStep: string;
    warnings: string[];
}

export interface SendResult {
    draftId: string;
    status: 'sent';
    sentAt: string;
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    bodySha256: string;
    confirmed: true;
    logged: true;
    note: string;
}

/**
 * ============================================================================
 * Confirmation-gated email
 * ============================================================================
 *
 * The flow is fixed and cannot be short-circuited:
 *
 *   draft -> preview (recipients, subject, full body, fingerprint)
 *         -> the Team Lead confirms explicitly
 *         -> send exactly the stored draft
 *         -> log the send
 *
 * Two properties make the confirmation meaningful:
 *
 *  1. `sendConfirmed` takes only a draft id and a confirmation flag. It accepts no
 *     recipient, subject or body, so the content that was shown is necessarily the
 *     content that goes out - the model cannot edit a draft post-confirmation.
 *
 *  2. Every draft carries a SHA-256 fingerprint of its body. A client may pass the
 *     fingerprint it displayed as `expectedBodySha256`, and the send is refused if
 *     it no longer matches.
 */
export class EmailService {
    constructor(
        private readonly graph: GraphEmailService = getGraphEmailService(),
        private readonly repository: EmailRepository = getEmailRepository()
    ) {}

    private get config() {
        return getConfig().email;
    }

    /** Normalises, de-duplicates and validates a recipient list. */
    private validateRecipients(addresses: string[], label: string): string[] {
        const cleaned = [...new Set(addresses.map(address => address.trim()).filter(address => address.length > 0))];
        if (cleaned.length === 0 && label === 'to') {
            throw new AppError('INVALID_INPUT', 'At least one recipient is required.');
        }
        if (cleaned.length > 25) {
            throw new AppError('INVALID_INPUT', `Too many ${label} recipients (${cleaned.length}); the limit is 25 per email.`);
        }

        for (const address of cleaned) {
            if (!EMAIL_PATTERN.test(address)) {
                throw new AppError('INVALID_INPUT', `"${address}" is not a valid email address.`);
            }
        }

        const allowlist = this.config.allowedRecipients;
        if (allowlist.length > 0) {
            for (const address of cleaned) {
                const lower = address.toLowerCase();
                const domain = `@${lower.split('@')[1] ?? ''}`;
                const permitted = allowlist.some(entry => (entry.startsWith('@') ? domain === entry : lower === entry));
                if (!permitted) {
                    throw new AppError('EMAIL_RECIPIENT_REJECTED', `"${address}" is not in the configured recipient allowlist.`, {
                        hint: 'Update EMAIL_ALLOWED_RECIPIENTS in .env to permit this address or domain.'
                    });
                }
            }
        }
        return cleaned;
    }

    /**
     * Creates a draft and returns the exact content for confirmation.
     * Nothing is sent here, whether or not email credentials are configured.
     */
    createDraft(input: DraftInput): DraftPreview {
        const subject = input.subject.trim();
        const body = input.body.replace(/\r\n/g, '\n').trim();

        if (subject.length === 0) throw new AppError('INVALID_INPUT', 'The email subject must not be empty.');
        if (subject.length > 255) throw new AppError('INVALID_INPUT', 'The email subject must be 255 characters or fewer.');
        if (body.length === 0) throw new AppError('INVALID_INPUT', 'The email body must not be empty.');
        if (body.length > 100_000) throw new AppError('INVALID_INPUT', 'The email body is too large to send (limit 100,000 characters).');

        const to = this.validateRecipients(input.to, 'to');
        const cc = this.validateRecipients(input.cc ?? [], 'cc');
        const contentType = input.contentType ?? 'Text';

        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.config.draftTtlMinutes * 60_000);
        const sender = this.config.sender.length > 0 ? this.config.sender : '(EMAIL_SENDER is not configured)';

        const draft: EmailDraft = {
            id: `draft_${randomUUID()}`,
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            kind: input.kind ?? 'custom',
            sender,
            to,
            cc,
            subject,
            body,
            contentType,
            bodySha256: fingerprint(subject, body, to, cc),
            relatedItems: input.relatedItems ?? [],
            status: 'pending_confirmation',
            confirmedAt: null,
            sentAt: null,
            cancelledAt: null,
            failureCode: null
        };

        this.repository.insertDraft(draft);

        const warnings: string[] = [];
        if (!this.graph.isConfigured()) {
            warnings.push(
                'Email sending is not configured, so this draft cannot be sent yet. Set MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and EMAIL_SENDER in .env.'
            );
        }
        if (cc.length > 0) warnings.push(`${cc.length} address(es) will be copied on this email.`);

        log.info('Email draft created', { draftId: draft.id, kind: draft.kind, recipients: to.length });

        return {
            draftId: draft.id,
            status: draft.status,
            createdAt: draft.createdAt,
            expiresAt: draft.expiresAt,
            kind: draft.kind,
            email: { from: sender, to, cc, subject, body, contentType },
            bodySha256: draft.bodySha256,
            relatedWorkItems: draft.relatedItems,
            confirmationRequired: true,
            nextStep: `Show this exact email to the Team Lead and ask for explicit confirmation. Nothing has been sent. To send it unchanged, call email_send_confirmed with draft_id="${draft.id}" and confirmation=true. To change anything, create a new draft instead - an existing draft cannot be edited.`,
            warnings
        };
    }

    getDraft(draftId: string): EmailDraft {
        this.repository.expireStaleDrafts(nowIso());
        const draft = this.repository.getDraft(draftId);
        if (!draft) {
            throw new AppError('EMAIL_DRAFT_NOT_FOUND', `No email draft exists with id "${draftId}".`, {
                hint: 'Draft ids are returned by the email_draft* tools. Use email_list_drafts to see current drafts.'
            });
        }
        return draft;
    }

    listDrafts(limit = 20): {
        drafts: (Omit<DraftPreview, 'nextStep' | 'confirmationRequired' | 'warnings'> & { bodyPreview: string })[];
    } {
        this.repository.expireStaleDrafts(nowIso());
        return {
            drafts: this.repository.listDrafts({ limit }).map(draft => ({
                draftId: draft.id,
                status: draft.status,
                createdAt: draft.createdAt,
                expiresAt: draft.expiresAt,
                kind: draft.kind,
                email: {
                    from: draft.sender,
                    to: draft.to,
                    cc: draft.cc,
                    subject: draft.subject,
                    body: draft.body,
                    contentType: draft.contentType
                },
                bodySha256: draft.bodySha256,
                relatedWorkItems: draft.relatedItems,
                bodyPreview: draft.body.slice(0, 200)
            }))
        };
    }

    cancelDraft(draftId: string): { draftId: string; status: 'cancelled'; cancelledAt: string } {
        const draft = this.getDraft(draftId);
        if (draft.status !== 'pending_confirmation') {
            throw new AppError('INVALID_INPUT', `Draft "${draftId}" is ${draft.status} and cannot be cancelled.`);
        }
        const cancelledAt = nowIso();
        this.repository.markCancelled(draftId, cancelledAt);
        this.repository.scrubClosedDraftBodies();
        log.info('Email draft cancelled', { draftId });
        return { draftId, status: 'cancelled', cancelledAt };
    }

    /**
     * Sends a draft, and only after explicit confirmation.
     *
     * `confirmation` must be exactly `true`. Anything else is refused before any
     * network call is made, and the refusal is recorded by the caller's audit hook.
     */
    async sendConfirmed(options: {
        draftId: string;
        confirmation: boolean;
        expectedBodySha256?: string;
    }): Promise<SendResult> {
        if (options.confirmation !== true) {
            throw new AppError('EMAIL_CONFIRMATION_REQUIRED', 'The email was NOT sent because explicit confirmation was not given.', {
                hint: 'Show the draft to the Team Lead, obtain an unambiguous "yes, send it", and only then call this tool with confirmation=true.'
            });
        }

        const draft = this.getDraft(options.draftId);

        if (draft.status === 'sent') {
            throw new AppError('EMAIL_DRAFT_ALREADY_SENT', `Draft "${draft.id}" was already sent at ${draft.sentAt}.`, {
                hint: 'Create a new draft if the message needs to go out again.'
            });
        }
        if (draft.status === 'expired' || new Date(draft.expiresAt).getTime() < Date.now()) {
            throw new AppError('EMAIL_DRAFT_EXPIRED', `Draft "${draft.id}" expired at ${draft.expiresAt} and was not sent.`, {
                hint: 'Create a fresh draft and confirm it while it is current. The expiry window exists so a stale confirmation cannot send an out-of-date message.'
            });
        }
        if (draft.status !== 'pending_confirmation') {
            throw new AppError('INVALID_INPUT', `Draft "${draft.id}" is ${draft.status} and cannot be sent.`);
        }

        // The fingerprint covers subject, body and recipients: it proves the stored
        // draft is byte-for-byte what was shown for confirmation.
        const currentFingerprint = fingerprint(draft.subject, draft.body, draft.to, draft.cc);
        if (currentFingerprint !== draft.bodySha256) {
            this.repository.markFailed(draft.id, 'EMAIL_DRAFT_TAMPERED');
            throw new AppError('EMAIL_SEND_FAILED', 'The stored draft no longer matches its fingerprint, so it was not sent.', {
                hint: 'This indicates the draft record changed after it was created. Create a new draft and confirm it again.'
            });
        }
        if (options.expectedBodySha256 && options.expectedBodySha256 !== draft.bodySha256) {
            throw new AppError('EMAIL_SEND_FAILED', 'The confirmed content does not match the stored draft, so nothing was sent.', {
                hint: `The draft fingerprint is ${draft.bodySha256}. Re-read the draft, show it again, and confirm the current content.`
            });
        }

        // Re-validate recipients at send time: the allowlist may have tightened.
        const to = this.validateRecipients(draft.to, 'to');
        const cc = this.validateRecipients(draft.cc, 'cc');

        if (!this.graph.isConfigured()) {
            this.repository.markFailed(draft.id, 'EMAIL_NOT_CONFIGURED');
            const { missing } = this.graph.describeConfiguration();
            throw new AppError('EMAIL_NOT_CONFIGURED', 'The email was not sent because email sending is not configured.', {
                hint: `Missing configuration: ${missing.join(', ')}.`
            });
        }

        try {
            const { sender, sentAt } = await this.graph.sendMail({
                subject: draft.subject,
                body: draft.body,
                contentType: draft.contentType,
                to,
                cc
            });

            this.repository.markConfirmedAndSent(draft.id, sentAt);
            this.repository.logSend({
                draftId: draft.id,
                sentAt,
                sender,
                to,
                cc,
                subject: draft.subject,
                bodySha256: draft.bodySha256,
                confirmed: true,
                outcome: 'sent',
                errorCode: null
            });
            // The body is no longer needed once the message is out.
            this.repository.scrubClosedDraftBodies();

            log.info('Confirmed email sent', { draftId: draft.id, recipients: to.length });

            return {
                draftId: draft.id,
                status: 'sent',
                sentAt,
                from: sender,
                to,
                cc,
                subject: draft.subject,
                bodySha256: draft.bodySha256,
                confirmed: true,
                logged: true,
                note: 'Recipients, subject, timestamp, draft id, confirmation flag and a body fingerprint were written to the local send log. The message body itself is not stored in the log.'
            };
        } catch (error) {
            const appError = error instanceof AppError ? error : new AppError('EMAIL_SEND_FAILED', 'Sending the email failed.', { cause: error });
            this.repository.markFailed(draft.id, appError.code);
            this.repository.logSend({
                draftId: draft.id,
                sentAt: nowIso(),
                sender: draft.sender,
                to,
                cc,
                subject: draft.subject,
                bodySha256: draft.bodySha256,
                confirmed: true,
                outcome: 'failed',
                errorCode: appError.code
            });
            throw appError;
        }
    }

    getSendLog(limit = 50): { entries: ReturnType<EmailRepository['listSendLog']>; note: string } {
        return {
            entries: this.repository.listSendLog(limit),
            note: 'Message bodies are intentionally absent from the log; `bodySha256` fingerprints the content that was sent.'
        };
    }
}

/** Fingerprints the full addressable content of a draft. */
export function fingerprint(subject: string, body: string, to: string[], cc: string[]): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                subject,
                body,
                to: [...to].sort(),
                cc: [...cc].sort()
            })
        )
        .digest('hex');
}

let sharedEmailService: EmailService | null = null;

export function getEmailService(): EmailService {
    sharedEmailService ??= new EmailService();
    return sharedEmailService;
}

export function setEmailServiceForTesting(service: EmailService | null): void {
    sharedEmailService = service;
}
