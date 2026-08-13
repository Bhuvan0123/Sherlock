import { redactString } from './redact.js';

export type ErrorCode =
    | 'ADO_AUTH_FAILED'
    | 'ADO_FORBIDDEN'
    | 'ADO_NOT_FOUND'
    | 'ADO_RATE_LIMITED'
    | 'ADO_SERVER_ERROR'
    | 'ADO_BAD_REQUEST'
    | 'ADO_NETWORK_ERROR'
    | 'ADO_NOT_CONFIGURED'
    | 'READ_ONLY_VIOLATION'
    | 'EMAIL_NOT_CONFIGURED'
    | 'EMAIL_CONFIRMATION_REQUIRED'
    | 'EMAIL_DRAFT_NOT_FOUND'
    | 'EMAIL_DRAFT_EXPIRED'
    | 'EMAIL_DRAFT_ALREADY_SENT'
    | 'EMAIL_RECIPIENT_REJECTED'
    | 'EMAIL_SEND_FAILED'
    | 'GRAPH_AUTH_FAILED'
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'INTERNAL_ERROR';

/**
 * Application error carrying a stable machine code plus a message that is always
 * safe to hand to the MCP client. Upstream response bodies are never attached
 * verbatim — only a redacted, truncated detail string.
 */
export class AppError extends Error {
    readonly code: ErrorCode;
    readonly httpStatus?: number;
    readonly hint?: string;
    readonly detail?: string;
    readonly retryAfterSeconds?: number;

    constructor(
        code: ErrorCode,
        message: string,
        options: {
            httpStatus?: number;
            hint?: string;
            detail?: string;
            retryAfterSeconds?: number;
            cause?: unknown;
        } = {}
    ) {
        super(redactString(message), options.cause === undefined ? undefined : { cause: options.cause });
        this.name = 'AppError';
        this.code = code;
        if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
        if (options.hint !== undefined) this.hint = redactString(options.hint);
        if (options.detail !== undefined) this.detail = redactString(options.detail).slice(0, 400);
        if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
    }

    /** Single-line, secret-free rendering used for MCP tool errors. */
    toClientMessage(): string {
        const parts = [`[${this.code}] ${this.message}`];
        if (this.hint) parts.push(`Hint: ${this.hint}`);
        if (this.detail) parts.push(`Detail: ${this.detail}`);
        return parts.join(' ');
    }
}

/** Raised whenever anything attempts a non-read Azure DevOps operation. */
export class ReadOnlyViolationError extends AppError {
    constructor(message: string, detail?: string) {
        super('READ_ONLY_VIOLATION', message, {
            hint: 'This MCP server is read-only for Azure DevOps. It cannot create, update, delete or assign work items, change state, add comments, or modify sprints, backlogs, repositories or pipelines.',
            ...(detail === undefined ? {} : { detail })
        });
        this.name = 'ReadOnlyViolationError';
    }
}

/**
 * Maps an Azure DevOps HTTP status onto a user-actionable error.
 * The upstream body is deliberately not forwarded; only a short redacted hint.
 */
export function mapAdoHttpError(status: number, statusText: string, bodySnippet?: string): AppError {
    const detail = bodySnippet ? extractAdoMessage(bodySnippet) : undefined;
    const options = (hint: string) => ({
        httpStatus: status,
        hint,
        ...(detail === undefined ? {} : { detail })
    });

    if (status === 401) {
        return new AppError(
            'ADO_AUTH_FAILED',
            'Azure DevOps authentication failed. Check the configured PAT.',
            options(
                'The PAT may be expired, revoked, or issued for a different organization. Regenerate a read-only PAT for the configured organization and update ADO_PAT.'
            )
        );
    }
    if (status === 403) {
        return new AppError(
            'ADO_FORBIDDEN',
            'The configured PAT does not have permission to read this resource.',
            options(
                'Grant the PAT read scopes for Work Items, Project and Team, Identity and Analytics, and confirm the account can view the project.'
            )
        );
    }
    if (status === 404) {
        return new AppError(
            'ADO_NOT_FOUND',
            'The requested Azure DevOps resource was not found.',
            options(
                'Verify ADO_ORGANIZATION, ADO_PROJECT and ADO_TEAM, and that the work item or iteration id exists. A 404 is also returned when the identity cannot see the resource at all.'
            )
        );
    }
    if (status === 429) {
        return new AppError(
            'ADO_RATE_LIMITED',
            'Azure DevOps rate limited this request.',
            options('Retry after a short delay. Reduce query breadth or rely on cached context to lower request volume.')
        );
    }
    if (status >= 500) {
        return new AppError(
            'ADO_SERVER_ERROR',
            `Azure DevOps returned a server error (${status}).`,
            options('This is an upstream Azure DevOps problem. Retry shortly; check the Azure DevOps status page if it persists.')
        );
    }
    if (status === 400) {
        return new AppError(
            'ADO_BAD_REQUEST',
            'Azure DevOps rejected the query as invalid.',
            options('A referenced field or value may not exist in this project process. Try a narrower query or refresh the project context.')
        );
    }
    return new AppError(
        'ADO_SERVER_ERROR',
        `Azure DevOps request failed with status ${status} ${statusText}.`.trim(),
        options('Unexpected status from Azure DevOps.')
    );
}

/**
 * Pulls the human-readable `message` out of an Azure DevOps error envelope
 * without leaking headers, stack traces or the raw payload.
 */
function extractAdoMessage(body: string): string | undefined {
    try {
        const parsed = JSON.parse(body) as { message?: unknown; value?: { Message?: unknown } };
        const message =
            typeof parsed.message === 'string'
                ? parsed.message
                : typeof parsed.value?.Message === 'string'
                  ? parsed.value.Message
                  : undefined;
        if (message) return redactString(message).slice(0, 300);
    } catch {
        // Non-JSON body (an HTML sign-in page, for example): do not forward it.
    }
    return undefined;
}

/** Normalises any thrown value into an AppError. */
export function toAppError(error: unknown, fallbackMessage = 'An unexpected error occurred.'): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof Error) {
        const isAbort = error.name === 'AbortError' || /aborted|timeout/i.test(error.message);
        return new AppError(
            isAbort ? 'ADO_NETWORK_ERROR' : 'INTERNAL_ERROR',
            isAbort ? 'The upstream request timed out.' : fallbackMessage,
            { detail: error.message, cause: error }
        );
    }
    return new AppError('INTERNAL_ERROR', fallbackMessage, { detail: String(error) });
}
