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
    ADO_ORGANIZATION: nonEmpty('ADO_ORGANIZATION').default('KEBS4KAAR'),
    ADO_PROJECT: nonEmpty('ADO_PROJECT').default('K4K'),
    ADO_TEAM: nonEmpty('ADO_TEAM').default('Platform'),
    ADO_PAT: z.string().trim().default(''),
    ADO_API_VERSION: nonEmpty('ADO_API_VERSION').default('7.1'),

    MICROSOFT_TENANT_ID: z.string().trim().default(''),
    MICROSOFT_CLIENT_ID: z.string().trim().default(''),
    MICROSOFT_CLIENT_SECRET: z.string().trim().default(''),
    EMAIL_SENDER: z.string().trim().default(''),
    EMAIL_ALLOWED_RECIPIENTS: z.string().trim().default(''),

    DATABASE_URL: nonEmpty('DATABASE_URL').default('file:./data/k4k-tl.sqlite'),

    LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300),
    EMAIL_DRAFT_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60)
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
    };
    email: {
        tenantId: string;
        clientId: string;
        clientSecret: string;
        sender: string;
        allowedRecipients: string[];
        draftTtlMinutes: number;
        /** True when Graph credentials + sender are all present. */
        configured: boolean;
    };
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

function parseRecipientAllowlist(raw: string): string[] {
    return raw
        .split(',')
        .map(entry => entry.trim().toLowerCase())
        .filter(entry => entry.length > 0);
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
        throw new Error(`Invalid environment configuration:\n${details}`);
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
            configured: env.ADO_PAT.length > 0
        },
        email: {
            tenantId: env.MICROSOFT_TENANT_ID,
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
            sender: env.EMAIL_SENDER,
            allowedRecipients: parseRecipientAllowlist(env.EMAIL_ALLOWED_RECIPIENTS),
            draftTtlMinutes: env.EMAIL_DRAFT_TTL_MINUTES,
            configured:
                env.MICROSOFT_TENANT_ID.length > 0 &&
                env.MICROSOFT_CLIENT_ID.length > 0 &&
                env.MICROSOFT_CLIENT_SECRET.length > 0 &&
                env.EMAIL_SENDER.length > 0
        },
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
    return [config.ado.pat, config.email.clientSecret].filter(secret => secret.length >= 8);
}
