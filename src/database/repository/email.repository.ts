import { getDatabase, type Database } from '../connection.js';

export type DraftStatus = 'pending_confirmation' | 'sent' | 'cancelled' | 'expired' | 'failed';

export interface EmailDraft {
    id: string;
    createdAt: string;
    expiresAt: string;
    kind: string;
    sender: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    contentType: 'Text' | 'HTML';
    /** Fingerprint of the exact body presented for confirmation. */
    bodySha256: string;
    relatedItems: number[];
    status: DraftStatus;
    confirmedAt: string | null;
    sentAt: string | null;
    cancelledAt: string | null;
    failureCode: string | null;
}

interface RawDraftRow {
    id: string;
    created_at: string;
    expires_at: string;
    kind: string;
    sender: string;
    to_recipients: string;
    cc_recipients: string | null;
    subject: string;
    body: string;
    content_type: string;
    body_sha256: string;
    related_items: string | null;
    status: string;
    confirmed_at: string | null;
    sent_at: string | null;
    cancelled_at: string | null;
    failure_code: string | null;
}

function parseList(value: string | null): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed.map(entry => String(entry)) : [];
    } catch {
        return [];
    }
}

function toDraft(raw: RawDraftRow): EmailDraft {
    return {
        id: raw.id,
        createdAt: raw.created_at,
        expiresAt: raw.expires_at,
        kind: raw.kind,
        sender: raw.sender,
        to: parseList(raw.to_recipients),
        cc: parseList(raw.cc_recipients),
        subject: raw.subject,
        body: raw.body,
        contentType: raw.content_type === 'HTML' ? 'HTML' : 'Text',
        bodySha256: raw.body_sha256,
        relatedItems: parseList(raw.related_items)
            .map(entry => Number(entry))
            .filter(entry => Number.isInteger(entry)),
        status: raw.status as DraftStatus,
        confirmedAt: raw.confirmed_at,
        sentAt: raw.sent_at,
        cancelledAt: raw.cancelled_at,
        failureCode: raw.failure_code
    };
}

export interface SendLogEntry {
    id: number;
    draftId: string;
    sentAt: string;
    sender: string;
    to: string[];
    cc: string[];
    subject: string;
    bodySha256: string;
    confirmed: boolean;
    outcome: string;
    errorCode: string | null;
}

interface RawSendLogRow {
    id: number;
    draft_id: string;
    sent_at: string;
    sender: string;
    to_recipients: string;
    cc_recipients: string | null;
    subject: string;
    body_sha256: string;
    confirmed: number;
    outcome: string;
    error_code: string | null;
}

/**
 * Storage for email drafts and the send log.
 *
 * The send log records who was mailed, about what, when, under which draft id, and
 * that confirmation happened - plus a hash of the body so the sent content can be
 * verified later. The body text itself is never copied into the log.
 */
export class EmailRepository {
    constructor(private readonly db: Database = getDatabase()) {}

    insertDraft(draft: EmailDraft): void {
        this.db.run(
            `INSERT INTO email_drafts
                (id, created_at, expires_at, kind, sender, to_recipients, cc_recipients, subject, body,
                 content_type, body_sha256, related_items, status, confirmed_at, sent_at, cancelled_at, failure_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                draft.id,
                draft.createdAt,
                draft.expiresAt,
                draft.kind,
                draft.sender,
                JSON.stringify(draft.to),
                JSON.stringify(draft.cc),
                draft.subject,
                draft.body,
                draft.contentType,
                draft.bodySha256,
                JSON.stringify(draft.relatedItems),
                draft.status,
                draft.confirmedAt,
                draft.sentAt,
                draft.cancelledAt,
                draft.failureCode
            ]
        );
    }

    getDraft(id: string): EmailDraft | null {
        const raw = this.db.get<RawDraftRow>('SELECT * FROM email_drafts WHERE id = ?', [id]);
        return raw ? toDraft(raw) : null;
    }

    listDrafts(filters: { status?: DraftStatus; limit?: number } = {}): EmailDraft[] {
        const limit = Math.min(Math.max(filters.limit ?? 20, 1), 200);
        const rows = filters.status
            ? this.db.all<RawDraftRow>('SELECT * FROM email_drafts WHERE status = ? ORDER BY created_at DESC LIMIT ?', [
                  filters.status,
                  limit
              ])
            : this.db.all<RawDraftRow>('SELECT * FROM email_drafts ORDER BY created_at DESC LIMIT ?', [limit]);
        return rows.map(toDraft);
    }

    markConfirmedAndSent(id: string, sentAtIso: string): void {
        this.db.run(
            `UPDATE email_drafts SET status = 'sent', confirmed_at = ?, sent_at = ? WHERE id = ? AND status = 'pending_confirmation'`,
            [sentAtIso, sentAtIso, id]
        );
    }

    markFailed(id: string, errorCode: string): void {
        this.db.run(`UPDATE email_drafts SET status = 'failed', failure_code = ? WHERE id = ?`, [errorCode, id]);
    }

    markCancelled(id: string, cancelledAtIso: string): void {
        this.db.run(
            `UPDATE email_drafts SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'pending_confirmation'`,
            [cancelledAtIso, id]
        );
    }

    /** Expires stale drafts so an old confirmation can never send later. */
    expireStaleDrafts(nowIso: string): number {
        return this.db.run(
            `UPDATE email_drafts SET status = 'expired' WHERE status = 'pending_confirmation' AND expires_at < ?`,
            [nowIso]
        ).changes;
    }

    /** Removes the stored body of drafts that are no longer actionable. */
    scrubClosedDraftBodies(): number {
        return this.db.run(
            `UPDATE email_drafts SET body = '' WHERE status IN ('sent', 'cancelled', 'expired', 'failed') AND body <> ''`
        ).changes;
    }

    logSend(entry: Omit<SendLogEntry, 'id'>): number {
        const result = this.db.run(
            `INSERT INTO email_send_log
                (draft_id, sent_at, sender, to_recipients, cc_recipients, subject, body_sha256, confirmed, outcome, error_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.draftId,
                entry.sentAt,
                entry.sender,
                JSON.stringify(entry.to),
                JSON.stringify(entry.cc),
                entry.subject,
                entry.bodySha256,
                entry.confirmed ? 1 : 0,
                entry.outcome,
                entry.errorCode
            ]
        );
        return result.lastInsertRowid;
    }

    listSendLog(limit = 50): SendLogEntry[] {
        const rows = this.db.all<RawSendLogRow>('SELECT * FROM email_send_log ORDER BY sent_at DESC LIMIT ?', [
            Math.min(Math.max(limit, 1), 500)
        ]);
        return rows.map(raw => ({
            id: raw.id,
            draftId: raw.draft_id,
            sentAt: raw.sent_at,
            sender: raw.sender,
            to: parseList(raw.to_recipients),
            cc: parseList(raw.cc_recipients),
            subject: raw.subject,
            bodySha256: raw.body_sha256,
            confirmed: raw.confirmed === 1,
            outcome: raw.outcome,
            errorCode: raw.error_code
        }));
    }

    countSentSince(sinceIso: string): number {
        return (
            this.db.get<{ count: number }>(
                `SELECT COUNT(*) AS count FROM email_send_log WHERE sent_at >= ? AND outcome = 'sent'`,
                [sinceIso]
            )?.count ?? 0
        );
    }
}

let sharedRepository: EmailRepository | null = null;

export function getEmailRepository(): EmailRepository {
    sharedRepository ??= new EmailRepository();
    return sharedRepository;
}

export function setEmailRepositoryForTesting(repository: EmailRepository | null): void {
    sharedRepository = repository;
}
