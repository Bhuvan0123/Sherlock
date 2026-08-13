import { ReadOnlyViolationError } from '../utils/errors.js';

/**
 * ============================================================================
 * Azure DevOps read-only policy
 * ============================================================================
 *
 * This module is the single enforcement point for the hard guarantee that this
 * MCP server can never modify Azure DevOps. It is deliberately dependency-free
 * and side-effect-free so it can be unit tested in isolation.
 *
 * Three independent layers keep the guarantee:
 *
 *  1. Type surface - `AzureDevOpsReadClient` exposes no mutating method at all.
 *     There is no `post`, `patch`, `put`, `delete` or generic `request` method
 *     that a caller (or a future contributor) could reach for.
 *
 *  2. Request chokepoint - every outbound Azure DevOps request passes through
 *     `assertReadOnlyRequest` below. Only GET is permitted, with exactly one
 *     narrowly-scoped exception described in `READ_ONLY_POST_ENDPOINTS`.
 *
 *  3. Tool-surface audit - `auditToolSurface` inspects the registered MCP tool
 *     names and input schemas at startup and in tests, rejecting any tool that
 *     looks like a mutation or that would let a caller choose an HTTP method,
 *     URL or request body.
 */

/** The only HTTP method allowed for Azure DevOps data requests. */
export const ALLOWED_HTTP_METHODS = ['GET'] as const;
export type AllowedHttpMethod = (typeof ALLOWED_HTTP_METHODS)[number];

/**
 * Azure DevOps exposes exactly one read API that is only reachable over POST:
 * the WIQL query endpoint (`POST /_apis/wit/wiql`), which evaluates a read-only
 * query language and returns matching work-item ids. It has no mutation
 * semantics - WIQL cannot express an insert, update or delete.
 *
 * That single endpoint is allowlisted here. Every other read - including batched
 * work-item retrieval - uses GET, so `workitemsbatch` is intentionally absent.
 *
 * Requests to this endpoint additionally have their query text validated by
 * `validateWiqlQuery`.
 */
export const READ_ONLY_POST_ENDPOINTS = ['_apis/wit/wiql'] as const;

/**
 * Path fragments that indicate a mutating or otherwise out-of-scope Azure DevOps
 * API. Blocked regardless of HTTP method, so a typo can never turn into a write.
 */
const FORBIDDEN_PATH_FRAGMENTS = [
    '_apis/wit/workitems/$', // work item creation (POST .../workitems/$Task)
    '_apis/wit/workitemsdelete',
    '_apis/wit/recyclebin',
    '_apis/wit/attachments',
    '_apis/git/pushes',
    '_apis/git/refs',
    '_apis/git/pullrequests',
    '_apis/build/builds',
    '_apis/pipelines/',
    '_apis/release/releases',
    '_apis/securityroles',
    '_apis/accesscontrolentries',
    '_apis/accesscontrollists',
    '_apis/graph/memberships',
    '_apis/serviceendpoint',
    '_apis/hooks',
    '_apis/tokens'
] as const;

/**
 * Tool-name fragments that would signal a mutation capability. The startup audit
 * fails hard if any registered tool name matches, which makes "someone adds a
 * write tool later" a build-breaking mistake rather than a silent regression.
 */
export const FORBIDDEN_TOOL_NAME_PATTERNS: RegExp[] = [
    // Tool names are snake_case, so `\b` is useless as a boundary (`_` is a word
    // character): these use explicit start/separator boundaries instead.
    /(^|[_-])(create|add|new)[_-]?(work[_-]?item|task|bug|story|epic|feature|comment|branch|commit|pull[_-]?request|pr)([_-]|$)/i,
    /(^|[_-])(update|edit|modify|patch|set|change)[_-]?(work[_-]?item|task|bug|story|epic|feature|state|status|priority|assignee|assignment|area|iteration|sprint|backlog|field)([_-]|$)/i,
    /(^|[_-])(delete|remove|destroy|archive)[_-]?(work[_-]?item|task|bug|story|epic|feature|comment|member|team|iteration|sprint)([_-]|$)/i,
    /(^|[_-])(assign|reassign|unassign)[_-]?(work[_-]?item|task|bug|story|to|member|owner)([_-]|$)/i,
    /(^|[_-])(move|reorder|reprioritise|reprioritize)[_-]?(backlog|work[_-]?item|sprint|iteration)([_-]|$)/i,
    /(^|[_-])(trigger|queue|run|cancel|approve)[_-]?(pipeline|build|release|deployment)([_-]|$)/i,
    /(^|[_-])(ado|azure[_-]?devops)[_-]?(request|call|http|fetch|proxy|raw|query[_-]?url)([_-]|$)/i,
    /(^|[_-])execute[_-]?(request|http|rest|api|wiql|query)([_-]|$)/i,
    /(^|[_-])(post|put|patch|delete)[_-]/i
];

/**
 * Input-parameter names that must never appear on any tool schema, without
 * exception. Accepting any of these would hand HTTP-level control or credential
 * control to the model and defeat layer 2.
 */
export const FORBIDDEN_TOOL_PARAMETER_NAMES = [
    'method',
    'http_method',
    'httpmethod',
    'verb',
    'url',
    'uri',
    'endpoint',
    'path',
    'route',
    'headers',
    'authorization',
    'pat',
    'token',
    'secret',
    'credential',
    'api_version',
    'apiversion'
] as const;

/**
 * Parameter names that could carry a request payload. These are forbidden on
 * every tool that can reach Azure DevOps, because a caller-supplied payload is
 * the shape a work-item write takes (`PATCH` with a JSON Patch document).
 *
 * Email composition is the one place a free-text body is legitimate, so tools
 * matching `EMAIL_COMPOSITION_TOOL_PATTERN` may declare the names in
 * `EMAIL_COMPOSITION_PAYLOAD_PARAMETERS` - and only those. Email tools never
 * touch Azure DevOps, and their content still cannot become an ADO request:
 * layers 1 and 2 leave no code path from a tool argument to a non-GET ADO call.
 */
export const FORBIDDEN_PAYLOAD_PARAMETER_NAMES = [
    'body',
    'payload',
    'request_body',
    'requestbody',
    'json',
    'data',
    'patch',
    'patch_document',
    'document',
    'operations',
    'fields_to_update'
] as const;

/** Tools permitted to accept an email body, i.e. the email drafting surface. */
export const EMAIL_COMPOSITION_TOOL_PATTERN = /^email_/;

/** The payload-shaped parameters an email drafting tool may declare. */
export const EMAIL_COMPOSITION_PAYLOAD_PARAMETERS = ['body'] as const;

/** WIQL keywords that have no place in a read-only query. */
const FORBIDDEN_WIQL_KEYWORDS = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'MERGE',
    'TRUNCATE',
    'EXEC',
    'EXECUTE',
    'GRANT',
    'REVOKE',
    'INTO',
    'SET'
] as const;

function normalisePath(rawUrl: string): string {
    // Strip scheme/host so fragment matching is not fooled by a hostile host part.
    const withoutScheme = rawUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
    return decodeURIComponent(withoutScheme).toLowerCase();
}

/**
 * Returns true when the given path targets the allowlisted WIQL query endpoint.
 * Matching is anchored on the `_apis/wit/wiql` segment so that look-alike paths
 * such as `_apis/wit/wiqlx` or `.../wiql/../workitems` cannot slip through.
 */
export function isAllowlistedReadOnlyPostEndpoint(rawUrl: string): boolean {
    const path = normalisePath(rawUrl).split('?')[0] ?? '';
    if (path.includes('..')) return false;
    return READ_ONLY_POST_ENDPOINTS.some(endpoint => {
        const index = path.indexOf(endpoint);
        if (index === -1) return false;
        const remainder = path.slice(index + endpoint.length);
        // Allow only the bare endpoint or a saved-query id segment.
        return remainder === '' || remainder === '/' || /^\/[a-z0-9-]+\/?$/.test(remainder);
    });
}

/**
 * The request chokepoint. Throws `ReadOnlyViolationError` unless the request is
 * a GET, or a POST to the single allowlisted WIQL read endpoint.
 */
export function assertReadOnlyRequest(method: string, url: string): void {
    const upperMethod = method.toUpperCase();
    const path = normalisePath(url);

    for (const fragment of FORBIDDEN_PATH_FRAGMENTS) {
        if (path.includes(fragment)) {
            throw new ReadOnlyViolationError(
                `Blocked Azure DevOps request to a non-read API surface.`,
                `Path fragment "${fragment}" is not reachable from this server.`
            );
        }
    }

    if ((ALLOWED_HTTP_METHODS as readonly string[]).includes(upperMethod)) return;

    if (upperMethod === 'POST' && isAllowlistedReadOnlyPostEndpoint(url)) return;

    throw new ReadOnlyViolationError(
        `Blocked a ${upperMethod} request to Azure DevOps.`,
        `Only GET is permitted, plus POST to the read-only WIQL query endpoint (${READ_ONLY_POST_ENDPOINTS.join(', ')}).`
    );
}

/**
 * Removes single-quoted WIQL string literals so that keyword scanning cannot be
 * tripped by legitimate search text (for example searching for the word
 * "update" in a work-item title).
 */
function stripWiqlStringLiterals(query: string): string {
    return query.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Validates WIQL before it is sent to the allowlisted POST endpoint.
 * A valid query is a single `SELECT` statement with no mutation keywords.
 */
export function validateWiqlQuery(query: string): void {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
        throw new ReadOnlyViolationError('Refused to send an empty WIQL query.');
    }
    if (trimmed.length > 8000) {
        throw new ReadOnlyViolationError('Refused to send an oversized WIQL query.');
    }

    const skeleton = stripWiqlStringLiterals(trimmed);

    if (!/^select\b/i.test(skeleton)) {
        throw new ReadOnlyViolationError(
            'Refused a WIQL query that is not a SELECT statement.',
            'Only read-only SELECT queries are permitted.'
        );
    }
    if (skeleton.includes(';')) {
        throw new ReadOnlyViolationError(
            'Refused a WIQL query containing a statement separator.',
            'Multiple statements are not permitted.'
        );
    }
    for (const keyword of FORBIDDEN_WIQL_KEYWORDS) {
        if (new RegExp(`\\b${keyword}\\b`, 'i').test(skeleton)) {
            throw new ReadOnlyViolationError(
                `Refused a WIQL query containing the forbidden keyword "${keyword}".`,
                'The query language is restricted to read-only SELECT clauses.'
            );
        }
    }
}

/** Escapes a value for safe inclusion in a WIQL string literal. */
export function escapeWiqlLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

export interface AuditableTool {
    name: string;
    /** Top-level input parameter names, if the tool takes any. */
    parameterNames?: string[];
}

export interface ToolSurfaceViolation {
    tool: string;
    reason: string;
}

/**
 * Audits the registered MCP tool surface. Returns every violation found so the
 * caller can fail startup (or a test) with a complete report.
 */
export function auditToolSurface(tools: AuditableTool[]): ToolSurfaceViolation[] {
    const violations: ToolSurfaceViolation[] = [];

    for (const tool of tools) {
        for (const pattern of FORBIDDEN_TOOL_NAME_PATTERNS) {
            if (pattern.test(tool.name)) {
                violations.push({
                    tool: tool.name,
                    reason: `Tool name matches a forbidden mutation pattern (${pattern}).`
                });
            }
        }

        const isEmailComposition = EMAIL_COMPOSITION_TOOL_PATTERN.test(tool.name);

        for (const parameter of tool.parameterNames ?? []) {
            const name = parameter.toLowerCase();

            if ((FORBIDDEN_TOOL_PARAMETER_NAMES as readonly string[]).includes(name)) {
                violations.push({
                    tool: tool.name,
                    reason: `Tool accepts forbidden low-level parameter "${parameter}", which could bypass the read-only chokepoint.`
                });
                continue;
            }

            if (!(FORBIDDEN_PAYLOAD_PARAMETER_NAMES as readonly string[]).includes(name)) continue;

            const allowedForEmail =
                isEmailComposition && (EMAIL_COMPOSITION_PAYLOAD_PARAMETERS as readonly string[]).includes(name);
            if (!allowedForEmail) {
                violations.push({
                    tool: tool.name,
                    reason: `Tool accepts forbidden payload parameter "${parameter}", which could carry a mutation payload.`
                });
            }
        }
    }

    return violations;
}

/**
 * The user-facing explanation returned whenever the Team Lead (via Claude) asks
 * this server to change something in Azure DevOps.
 */
export const READ_ONLY_REFUSAL_MESSAGE =
    'This MCP server is read-only for Azure DevOps. It can read and analyse work items, sprints, teams and history, and it can recommend changes, but it cannot create, update, delete or assign work items, change state, priority, area or iteration, add comments, or modify backlogs, sprints, repositories, pipelines or permissions. Apply any change directly in Azure DevOps.';
