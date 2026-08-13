import { getConfig } from '../config/env.js';
import { redactValue, redactString } from './redact.js';

/** `silent` suppresses all output; it exists so tests produce clean output. */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_WEIGHT: Record<LogLevel, number> = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };

function configuredLevel(): LogLevel {
    try {
        return getConfig().logLevel;
    } catch {
        return 'info';
    }
}

/**
 * Structured logger that writes exclusively to stderr.
 *
 * This is mandatory for an MCP stdio server: stdout carries the JSON-RPC stream,
 * so anything written there would corrupt the protocol.
 */
function emit(level: LogLevel, scope: string, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[configuredLevel()]) return;

    const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        scope,
        msg: redactString(message)
    };
    if (context && Object.keys(context).length > 0) {
        entry.context = redactValue(context);
    }

    let line: string;
    try {
        line = JSON.stringify(entry);
    } catch {
        line = JSON.stringify({ ts: entry.ts, level, scope, msg: entry.msg });
    }
    process.stderr.write(`${line}\n`);
}

export interface Logger {
    error(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    debug(message: string, context?: Record<string, unknown>): void;
    child(childScope: string): Logger;
}

export function createLogger(scope: string): Logger {
    return {
        error: (message, context) => emit('error', scope, message, context),
        warn: (message, context) => emit('warn', scope, message, context),
        info: (message, context) => emit('info', scope, message, context),
        debug: (message, context) => emit('debug', scope, message, context),
        child: childScope => createLogger(`${scope}:${childScope}`)
    };
}

export const logger = createLogger('k4k-tl');
