/**
 * Local SQLite schema for the S.H.E.R.L.O.C.K. audit trail.
 *
 * What is stored: what the Team Lead did *through this MCP server* - which tools
 * ran, with what summarised parameters, what came back, and whether an action was
 * confirmed. This is not a mirror of Azure DevOps activity, because this server
 * cannot change Azure DevOps.
 *
 * What is never stored: the Azure DevOps PAT or authorization headers.
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

    `CREATE TABLE IF NOT EXISTS custom_skills (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT UNIQUE NOT NULL,
        description     TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        version         INTEGER NOT NULL DEFAULT 1,
        created_by      TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'active'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_custom_skills_name ON custom_skills (name)`
];
