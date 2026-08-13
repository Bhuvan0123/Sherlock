import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema/schema.js';

const log = createLogger('database');

/**
 * Values `node:sqlite` accepts as bound parameters. Booleans are deliberately
 * absent - callers must map them to 0/1, which the repositories do.
 */
export type SqlValue = string | number | bigint | null | Uint8Array;

/**
 * Thin synchronous SQLite wrapper.
 *
 * `node:sqlite` ships with Node (>= 22.5), which keeps this server free of native
 * build steps on Windows. The surface below is intentionally small so swapping in
 * `better-sqlite3` (or a server-side store) later means changing this file only.
 */
export class Database {
    private readonly db: DatabaseSync;

    constructor(filePath: string) {
        if (filePath !== ':memory:') {
            mkdirSync(dirname(filePath), { recursive: true });
        }
        try {
            this.db = new DatabaseSync(filePath);
        } catch (error) {
            throw new AppError('INTERNAL_ERROR', 'Could not open the local activity database.', {
                hint: `Check that DATABASE_URL points at a writable location. Resolved path: ${filePath}`,
                cause: error
            });
        }

        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA foreign_keys = ON');
        this.db.exec('PRAGMA busy_timeout = 5000');
        this.migrate();
    }

    private migrate(): void {
        for (const statement of SCHEMA_STATEMENTS) {
            this.db.exec(statement);
        }
        this.db
            .prepare(`INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
                      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
            .run(String(SCHEMA_VERSION));
        log.debug('Database schema ready', { version: SCHEMA_VERSION });
    }

    run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number } {
        const result = this.db.prepare(sql).run(...params);
        return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid)
        };
    }

    all<T>(sql: string, params: SqlValue[] = []): T[] {
        return this.db.prepare(sql).all(...params) as T[];
    }

    get<T>(sql: string, params: SqlValue[] = []): T | undefined {
        return this.db.prepare(sql).get(...params) as T | undefined;
    }

    exec(sql: string): void {
        this.db.exec(sql);
    }

    close(): void {
        try {
            this.db.close();
        } catch (error) {
            log.warn('Failed to close the activity database cleanly', { error: String(error) });
        }
    }
}

let sharedDatabase: Database | null = null;

export function getDatabase(): Database {
    sharedDatabase ??= new Database(getConfig().database.path);
    return sharedDatabase;
}

/** Test hook: point the shared handle at an in-memory database. */
export function setDatabaseForTesting(database: Database | null): void {
    sharedDatabase?.close();
    sharedDatabase = database;
}

export function closeDatabase(): void {
    sharedDatabase?.close();
    sharedDatabase = null;
}
