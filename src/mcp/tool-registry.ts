import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';
import { auditToolSurface, type AuditableTool } from '../security/read-only-policy.js';
import { AppError, toAppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { summarise } from '../utils/redact.js';
import { getActivityService } from '../services/teamlead/activity.service.js';
import type { ActivityCategory, ConfirmationStatus } from '../database/repository/activity.repository.js';

const log = createLogger('mcp-tools');

export type ToolGroup = 'azure-devops' | 'analysis' | 'team-lead' | 'system';

export interface ToolDefinition<TShape extends Record<string, ZodTypeAny>> {
    name: string;
    title: string;
    description: string;
    group: ToolGroup;
    inputSchema?: TShape;
    /**
     * `readOnly` is true for everything except controlled saved-query creation.
     */
    readOnly?: boolean;
    audit: {
        category: ActivityCategory;
        action: string;
        /** Identifies what the call was about, e.g. `work-item:5421`. */
        subject?: (args: Record<string, unknown>) => string | null;
        confirmationStatus?: (args: Record<string, unknown>) => ConfirmationStatus;
    };
    /** Returns any JSON-serialisable payload; a text summary is derived from it. */
    handler: (args: Record<string, unknown>) => Promise<unknown>;
    /** Optional one-line summary rendered above the JSON payload. */
    summarise?: (result: unknown) => string;
}

interface RegisteredToolMeta extends AuditableTool {
    group: ToolGroup;
    title: string;
    readOnly: boolean;
}

const registered: RegisteredToolMeta[] = [];

/** Every tool registered so far, for the startup audit and the security tests. */
export function getRegisteredToolMeta(): RegisteredToolMeta[] {
    return registered.map(tool => ({ ...tool, parameterNames: [...(tool.parameterNames ?? [])] }));
}

export function clearRegisteredToolMeta(): void {
    registered.length = 0;
}

/**
 * Registers one MCP tool.
 *
 * Uniform behaviour for every tool:
 *  - the name and input schema are audited against the read-only policy;
 *  - the call is timed and written to the Team Lead audit trail;
 *  - errors become MCP tool errors carrying a redacted, actionable message rather
 *    than a stack trace or an upstream payload.
 */
export function registerTool<TShape extends Record<string, ZodTypeAny>>(
    server: McpServer,
    definition: ToolDefinition<TShape>
): void {
    const parameterNames = Object.keys(definition.inputSchema ?? {});
    const readOnly = definition.readOnly ?? true;

    const violations = auditToolSurface([{ name: definition.name, parameterNames }]);
    if (violations.length > 0) {
        // Fail fast at startup: a mutation-shaped tool must never reach a client.
        throw new AppError(
            'READ_ONLY_VIOLATION',
            `Refusing to register tool "${definition.name}": ${violations.map(violation => violation.reason).join(' ')}`
        );
    }

    const annotations: ToolAnnotations = {
        title: definition.title,
        readOnlyHint: readOnly,
        destructiveHint: false,
        idempotentHint: readOnly,
        openWorldHint: true
    };

    server.registerTool(
        definition.name,
        {
            title: definition.title,
            description: definition.description,
            ...(definition.inputSchema ? { inputSchema: definition.inputSchema } : {}),
            annotations
        },
        (async (rawArgs: unknown): Promise<CallToolResult> => {
            const args = (rawArgs ?? {}) as Record<string, unknown>;
            const startedAt = Date.now();
            const activity = getActivityService();

            try {
                const result = await definition.handler(args);
                const durationMs = Date.now() - startedAt;

                activity.record({
                    category: definition.audit.category,
                    action: definition.audit.action,
                    tool: definition.name,
                    parameters: args,
                    result: definition.summarise ? definition.summarise(result) : summariseResult(result),
                    outcome: 'success',
                    durationMs,
                    subjectRef: definition.audit.subject?.(args) ?? null,
                    confirmationStatus: definition.audit.confirmationStatus?.(args) ?? 'not_applicable'
                });

                log.debug('Tool completed', { tool: definition.name, durationMs });

                const summary = definition.summarise ? definition.summarise(result) : summariseResult(result);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `${summary}\n\n${stringify(result)}`
                        }
                    ]
                };
            } catch (error) {
                const appError = toAppError(error, `The tool "${definition.name}" failed.`);
                const durationMs = Date.now() - startedAt;

                activity.record({
                    category: definition.audit.category,
                    action: definition.audit.action,
                    tool: definition.name,
                    parameters: args,
                    result: appError.toClientMessage(),
                    outcome: appError.code === 'READ_ONLY_VIOLATION' ? 'rejected' : 'error',
                    errorCode: appError.code,
                    durationMs,
                    subjectRef: definition.audit.subject?.(args) ?? null,
                    confirmationStatus: definition.audit.confirmationStatus?.(args) ?? 'not_applicable'
                });

                log.warn('Tool failed', { tool: definition.name, code: appError.code, durationMs });

                return {
                    isError: true,
                    content: [{ type: 'text', text: appError.toClientMessage() }]
                };
            }
            // The SDK's callback type is generic over the input schema; the cast keeps
            // one uniform handler signature across every tool in this server.
        }) as Parameters<McpServer['registerTool']>[2]
    );

    registered.push({ name: definition.name, parameterNames, group: definition.group, title: definition.title, readOnly });
}

function stringify(value: unknown): string {
    try {
        return JSON.stringify(value, replacer, 2) ?? String(value);
    } catch {
        return String(value);
    }
}

function replacer(_key: string, value: unknown): unknown {
    if (value instanceof Set) return [...value];
    if (value instanceof Map) return Object.fromEntries(value);
    return value;
}

/** Derives a short headline from a result payload for the text response and the audit row. */
function summariseResult(result: unknown): string {
    if (result === null || result === undefined) return 'No data returned.';
    if (Array.isArray(result)) return `${result.length} item(s) returned.`;
    if (typeof result === 'object') {
        const record = result as Record<string, unknown>;
        if (typeof record.summary === 'string') return record.summary;
        const counts: string[] = [];
        for (const [key, value] of Object.entries(record)) {
            if (Array.isArray(value)) counts.push(`${key}: ${value.length}`);
            else if (typeof value === 'number') counts.push(`${key}: ${value}`);
        }
        if (counts.length > 0) return counts.slice(0, 6).join(', ');
        return `Returned ${Object.keys(record).length} field(s).`;
    }
    return summarise(result, 200);
}
