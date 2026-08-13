/**
 * Local SQLite schema for the Team Lead audit trail.
 *
 * What is stored: what the Team Lead did *through this MCP server* - which tools
 * ran, with what summarised parameters, what came back, and whether an action was
 * confirmed. This is not a mirror of Azure DevOps activity, because this server
 * cannot change Azure DevOps.
 *
 * What is never stored: the Azure DevOps PAT, Microsoft Graph credentials, OAuth
 * tokens, or the body of a sent email. Draft bodies live in `email_drafts` only
 * until they are sent or expire, because the confirm-then-send guarantee requires
 * the exact confirmed text to survive between the two tool calls.
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS schema_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS tl_activity (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at         TEXT    NOT NULL,
        category            TEXT    NOT NULL,
        action              TEXT    NOT NULL,
        tool                TEXT    NOT NULL,
        parameters_summary  TEXT,
        result_summary      TEXT,
        outcome             TEXT    NOT NULL,
        error_code          TEXT,
        confirmation_status TEXT    NOT NULL DEFAULT 'not_applicable',
        duration_ms         INTEGER,
        subject_ref         TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activity_occurred_at ON tl_activity (occurred_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_category ON tl_activity (category, occurred_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_tool ON tl_activity (tool, occurred_at DESC)`,

    `CREATE TABLE IF NOT EXISTS email_drafts (
        id                TEXT PRIMARY KEY,
        created_at        TEXT NOT NULL,
        expires_at        TEXT NOT NULL,
        kind              TEXT NOT NULL,
        sender            TEXT NOT NULL,
        to_recipients     TEXT NOT NULL,
        cc_recipients     TEXT,
        subject           TEXT NOT NULL,
        body              TEXT NOT NULL,
        content_type      TEXT NOT NULL DEFAULT 'Text',
        body_sha256       TEXT NOT NULL,
        related_items     TEXT,
        status            TEXT NOT NULL DEFAULT 'pending_confirmation',
        confirmed_at      TEXT,
        sent_at           TEXT,
        cancelled_at      TEXT,
        failure_code      TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_drafts_status ON email_drafts (status, created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS email_send_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id       TEXT NOT NULL,
        sent_at        TEXT NOT NULL,
        sender         TEXT NOT NULL,
        to_recipients  TEXT NOT NULL,
        cc_recipients  TEXT,
        subject        TEXT NOT NULL,
        body_sha256    TEXT NOT NULL,
        confirmed      INTEGER NOT NULL,
        outcome        TEXT NOT NULL,
        error_code     TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_send_log_sent_at ON email_send_log (sent_at DESC)`
];
