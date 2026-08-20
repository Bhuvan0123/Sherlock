import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import dotenv from 'dotenv';
// Type-only import: no runtime dependency, so the logger can keep reading config.
import type { LogLevel } from '../utils/logger.js';

/** Repository root, resolved from this module's location (works from src/ and dist/). */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let dotenvLoaded = false;

/**
 * Loads `.env` from the project root exactly once.
 *
 * `override: false` means a value already present in the real process environment
 * wins, which is what lets Claude Desktop / Claude Code inject secrets via its own
 * config without editing `.env`.
 */
export function loadDotEnv(): void {
    if (dotenvLoaded) return;
    dotenvLoaded = true;
    const envPath = resolve(PROJECT_ROOT, '.env');
    if (existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false, quiet: true });
    }
}

const nonEmpty = (label: string) =>
    z
        .string()
        .trim()
        .min(1, `${label} must not be empty`);

const envSchema = z.object({
    ADO_ORGANIZATION: nonEmpty('ADO_ORGANIZATION'),
    ADO_PROJECT: nonEmpty('ADO_PROJECT'),
    ADO_TEAM: nonEmpty('ADO_TEAM'),
    ADO_PAT: nonEmpty('ADO_PAT'),
    ADO_API_VERSION: nonEmpty('ADO_API_VERSION').default('7.1'),
    SHERLOCK_ENV: z.enum(['development', 'test', 'production']).default('development'),
    TOKEN_DEBUG: z.enum(['true', 'false']).default('false').transform(val => val === 'true'),

    DATABASE_URL: nonEmpty('DATABASE_URL').default('file:./data/sherlock.sqlite'),

    LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300)
});

export interface AppConfig {
    ado: {
        organization: string;
        project: string;
        team: string;
        pat: string;
        apiVersion: string;
        baseUrl: string;
        /** True when a PAT is present; ADO tools report a clear setup error when false. */
        configured: boolean;
        /** Enables detailed telemetry for API token usage. */
        tokenDebug: boolean;
    };
    sherlockEnv: 'development' | 'test' | 'production';
    database: {
        /** Absolute file path, or ':memory:'. */
        path: string;
    };
    logLevel: LogLevel;
    cacheTtlSeconds: number;
}

/**
 * Resolves DATABASE_URL into something `node:sqlite` accepts.
 * Supports `:memory:`, `file:./x.sqlite` and bare relative/absolute paths.
 */
function resolveDatabasePath(raw: string): string {
    const value = raw.trim();
    if (value === ':memory:' || value === 'file::memory:') return ':memory:';

    let filePath = value;
    if (filePath.startsWith('file:')) {
        filePath = filePath.slice('file:'.length);
        // Tolerate file:// and file:/// forms.
        filePath = filePath.replace(/^\/{2,}/, '/');
    }
    if (filePath.length === 0) filePath = './data/k4k-tl.sqlite';
    return isAbsolute(filePath) ? filePath : resolve(PROJECT_ROOT, filePath);
}

let cachedConfig: AppConfig | null = null;

/** Builds the validated application config. Values are read once and memoised. */
export function getConfig(): AppConfig {
    if (cachedConfig) return cachedConfig;
    loadDotEnv();

    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
        const details = parsed.error.issues
            .map(issue => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
        throw new Error(`S.H.E.R.L.O.C.K. configuration error:\n\n${details}\n\nCreate a .env file from .env.example and provide your Azure DevOps settings. Never print or share ADO_PAT.`);
    }
    const env = parsed.data;

    const organization = env.ADO_ORGANIZATION;
    cachedConfig = {
        ado: {
            organization,
            project: env.ADO_PROJECT,
            team: env.ADO_TEAM,
            pat: env.ADO_PAT,
            apiVersion: env.ADO_API_VERSION,
            baseUrl: `https://dev.azure.com/${encodeURIComponent(organization)}`,
            configured: true,
            tokenDebug: env.TOKEN_DEBUG
        },
        sherlockEnv: env.SHERLOCK_ENV,
        database: { path: resolveDatabasePath(env.DATABASE_URL) },
        logLevel: env.LOG_LEVEL,
        cacheTtlSeconds: env.CACHE_TTL_SECONDS
    };
    return cachedConfig;
}

/** Test hook: forces the next `getConfig()` call to re-read `process.env`. */
export function resetConfigForTesting(): void {
    cachedConfig = null;
    dotenvLoaded = false;
}

/**
 * Every secret the process knows about. Used by the logger and the error
 * serialiser to guarantee credentials can never reach a log line, a tool
 * response or an MCP error payload.
 */
export function collectSecrets(): string[] {
    const config = getConfig();
    return [config.ado.pat].filter(secret => secret.length >= 8);
}
