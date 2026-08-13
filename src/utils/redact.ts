import { collectSecrets } from '../config/env.js';

export const REDACTED = '[REDACTED]';

/** Header names whose values must never appear in a log line or error message. */
const SENSITIVE_KEY_PATTERN =
    /(authorization|auth|pat|password|passwd|secret|token|credential|client[-_]?secret|api[-_]?key|cookie|set-cookie)/i;

/**
 * Patterns for credential shapes that must be scrubbed even when the exact
 * secret value is not known to this process (for example a PAT pasted into a
 * tool argument by mistake, or a bearer token echoed back by an upstream API).
 */
const CREDENTIAL_SHAPES: RegExp[] = [
    /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
    /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
    // Azure DevOps PATs are long opaque base32/base64-ish strings.
    /\b[a-z2-7]{52}\b/gi,
    /\beyJ[A-Za-z0-9._-]{20,}/g
];

/**
 * Removes known secrets and credential-shaped substrings from a string.
 * Applied to every log line, every error message and every tool response.
 */
export function redactString(input: string): string {
    let output = input;
    for (const secret of collectSecretsSafely()) {
        if (secret.length === 0) continue;
        output = output.split(secret).join(REDACTED);
    }
    for (const shape of CREDENTIAL_SHAPES) {
        output = output.replace(shape, match => {
            const [scheme] = match.split(/\s+/, 1);
            return scheme === 'Basic' || scheme === 'Bearer' ? `${scheme} ${REDACTED}` : REDACTED;
        });
    }
    return output;
}

function collectSecretsSafely(): string[] {
    try {
        return collectSecrets();
    } catch {
        // Config may be invalid while an error about that very fact is logged.
        return [process.env.ADO_PAT ?? '', process.env.MICROSOFT_CLIENT_SECRET ?? ''].filter(
            value => value.length >= 8
        );
    }
}

/** Recursively redacts secrets from any value, by key name and by value shape. */
export function redactValue(value: unknown, depth = 0): unknown {
    if (depth > 8) return '[depth-limit]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(item => redactValue(item, depth + 1));
    if (value instanceof Error) return redactString(`${value.name}: ${value.message}`);
    if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1);
        }
        return result;
    }
    return '[unserialisable]';
}

/** Truncates long text for audit summaries, keeping log rows small. */
export function summarise(value: unknown, maxLength = 500): string {
    let text: string;
    if (typeof value === 'string') {
        text = value;
    } else {
        try {
            text = JSON.stringify(redactValue(value)) ?? String(value);
        } catch {
            text = String(value);
        }
    }
    text = redactString(text);
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
