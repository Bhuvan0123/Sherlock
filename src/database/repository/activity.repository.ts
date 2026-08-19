import { getDatabase, type Database } from '../connection.js';

export type ActivityCategory =
    | 'project_review'
    | 'team_review'
    | 'work_item_lookup'
    | 'search'
    | 'analysis'
    | 'report'
    | 'email_draft'
    | 'email_send'
    | 'confirmation'
    | 'recommendation_review'
    | 'query_management'
    | 'maintenance';

export type ActivityOutcome = 'success' | 'error' | 'rejected';
export type ConfirmationStatus = 'not_applicable' | 'awaiting_confirmation' | 'confirmed' | 'declined';

export interface ActivityRecord {
    occurredAt: string;
    category: ActivityCategory;
    action: string;
    tool: string;
    parametersSummary: string | null;
    resultSummary: string | null;
    outcome: ActivityOutcome;
    errorCode: string | null;
    confirmationStatus: ConfirmationStatus;
    durationMs: number | null;
    /** What the activity was about, for example `work-item:5421` or `member:Arun`. */
    subjectRef: string | null;
}

export interface ActivityRow extends ActivityRecord {
    id: number;
}

interface RawActivityRow {
    id: number;
    occurred_at: string;
    category: string;
    action: string;
    tool: string;
    parameters_summary: string | null;
    result_summary: string | null;
    outcome: string;
    error_code: string | null;
    confirmation_status: string;
    duration_ms: number | null;
    subject_ref: string | null;
}

function toRow(raw: RawActivityRow): ActivityRow {
    return {
        id: raw.id,
        occurredAt: raw.occurred_at,
        category: raw.category as ActivityCategory,
        action: raw.action,
        tool: raw.tool,
        parametersSummary: raw.parameters_summary,
        resultSummary: raw.result_summary,
        outcome: raw.outcome as ActivityOutcome,
        errorCode: raw.error_code,
        confirmationStatus: raw.confirmation_status as ConfirmationStatus,
        durationMs: raw.duration_ms,
        subjectRef: raw.subject_ref
    };
}

/** Persistence for the Team Lead audit trail. Stores summaries, never secrets. */
export class ActivityRepository {
    constructor(private readonly db: Database = getDatabase()) {}

    insert(record: ActivityRecord): number {
        const result = this.db.run(
            `INSERT INTO tl_activity
                (occurred_at, category, action, tool, parameters_summary, result_summary,
                 outcome, error_code, confirmation_status, duration_ms, subject_ref)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                record.occurredAt,
                record.category,
                record.action,
                record.tool,
                record.parametersSummary,
                record.resultSummary,
                record.outcome,
                record.errorCode,
                record.confirmationStatus,
                record.durationMs,
                record.subjectRef
            ]
        );
        return result.lastInsertRowid;
    }

    list(filters: {
        sinceIso?: string;
        untilIso?: string;
        category?: ActivityCategory;
        tool?: string;
        outcome?: ActivityOutcome;
        limit?: number;
    } = {}): ActivityRow[] {
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (filters.sinceIso) {
            conditions.push('occurred_at >= ?');
            params.push(filters.sinceIso);
        }
        if (filters.untilIso) {
            conditions.push('occurred_at <= ?');
            params.push(filters.untilIso);
        }
        if (filters.category) {
            conditions.push('category = ?');
            params.push(filters.category);
        }
        if (filters.tool) {
            conditions.push('tool = ?');
            params.push(filters.tool);
        }
        if (filters.outcome) {
            conditions.push('outcome = ?');
            params.push(filters.outcome);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
        const rows = this.db.all<RawActivityRow>(
            `SELECT * FROM tl_activity ${where} ORDER BY occurred_at DESC, id DESC LIMIT ?`,
            [...params, limit]
        );
        return rows.map(toRow);
    }

    countsByCategory(sinceIso: string): { category: string; count: number }[] {
        return this.db.all<{ category: string; count: number }>(
            `SELECT category, COUNT(*) AS count FROM tl_activity WHERE occurred_at >= ? GROUP BY category ORDER BY count DESC`,
            [sinceIso]
        );
    }

    countsByTool(sinceIso: string, limit = 20): { tool: string; count: number }[] {
        return this.db.all<{ tool: string; count: number }>(
            `SELECT tool, COUNT(*) AS count FROM tl_activity WHERE occurred_at >= ? GROUP BY tool ORDER BY count DESC LIMIT ?`,
            [sinceIso, Math.min(Math.max(limit, 1), 100)]
        );
    }

    countsByOutcome(sinceIso: string): { outcome: string; count: number }[] {
        return this.db.all<{ outcome: string; count: number }>(
            `SELECT outcome, COUNT(*) AS count FROM tl_activity WHERE occurred_at >= ? GROUP BY outcome`,
            [sinceIso]
        );
    }

    /** Activity volume per local day, for weekly-review trends. */
    countsByDay(sinceIso: string): { day: string; count: number }[] {
        return this.db.all<{ day: string; count: number }>(
            `SELECT substr(occurred_at, 1, 10) AS day, COUNT(*) AS count
             FROM tl_activity WHERE occurred_at >= ?
             GROUP BY day ORDER BY day ASC`,
            [sinceIso]
        );
    }

    /** Subjects the Team Lead returned to repeatedly - the follow-up signal. */
    repeatedSubjects(sinceIso: string, minimumOccurrences = 2, limit = 20): { subjectRef: string; occurrences: number; lastSeen: string }[] {
        return this.db.all<{ subjectRef: string; occurrences: number; lastSeen: string }>(
            `SELECT subject_ref AS subjectRef, COUNT(*) AS occurrences, MAX(occurred_at) AS lastSeen
             FROM tl_activity
             WHERE occurred_at >= ? AND subject_ref IS NOT NULL AND subject_ref <> ''
             GROUP BY subject_ref
             HAVING occurrences >= ?
             ORDER BY occurrences DESC, lastSeen DESC
             LIMIT ?`,
            [sinceIso, Math.max(minimumOccurrences, 2), Math.min(Math.max(limit, 1), 100)]
        );
    }

    total(): number {
        return this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM tl_activity')?.count ?? 0;
    }

    firstRecordedAt(): string | null {
        return this.db.get<{ occurred_at: string }>('SELECT occurred_at FROM tl_activity ORDER BY occurred_at ASC LIMIT 1')?.occurred_at ?? null;
    }

    /** Retention: drops audit rows older than the given cutoff. */
    purgeBefore(cutoffIso: string): number {
        return this.db.run('DELETE FROM tl_activity WHERE occurred_at < ?', [cutoffIso]).changes;
    }
}

let sharedRepository: ActivityRepository | null = null;

export function getActivityRepository(): ActivityRepository {
    sharedRepository ??= new ActivityRepository();
    return sharedRepository;
}

export function setActivityRepositoryForTesting(repository: ActivityRepository | null): void {
    sharedRepository = repository;
}
