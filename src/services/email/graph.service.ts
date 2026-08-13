import { getConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { redactString } from '../../utils/redact.js';

const log = createLogger('graph');

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const TOKEN_SKEW_SECONDS = 90;
const REQUEST_TIMEOUT_MS = 20_000;

export interface GraphMailMessage {
    subject: string;
    body: string;
    contentType: 'Text' | 'HTML';
    to: string[];
    cc: string[];
}

interface TokenResponse {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

/**
 * ============================================================================
 * Microsoft Graph email
 * ============================================================================
 *
 * Sending mail is the only outbound mutation this server can perform, and it is
 * reachable only after an explicit confirmation (see `email.service.ts`).
 *
 * Authentication is entirely separate from Azure DevOps: this uses the OAuth 2.0
 * client-credentials flow against Microsoft Entra ID with an app registration
 * holding the single application permission `Mail.Send`. The Azure DevOps PAT is
 * never used here, and the Graph client secret is never used for Azure DevOps.
 *
 * Note on the read-only policy: it governs Azure DevOps requests only. Graph
 * requests never pass through the Azure DevOps client, so the two paths cannot be
 * confused with each other.
 */
export class GraphEmailService {
    private cachedToken: { value: string; expiresAt: number } | null = null;
    private readonly fetchImpl: typeof fetch;

    constructor(fetchImpl: typeof fetch = fetch) {
        this.fetchImpl = fetchImpl;
    }

    private get config() {
        return getConfig().email;
    }

    /** True when tenant, client id, secret and sender are all configured. */
    isConfigured(): boolean {
        return this.config.configured;
    }

    /** Configuration status with no secret values, safe to return from a tool. */
    describeConfiguration(): {
        configured: boolean;
        sender: string | null;
        tenantConfigured: boolean;
        clientConfigured: boolean;
        secretConfigured: boolean;
        recipientAllowlist: string[];
        missing: string[];
    } {
        const config = this.config;
        const missing: string[] = [];
        if (config.tenantId.length === 0) missing.push('MICROSOFT_TENANT_ID');
        if (config.clientId.length === 0) missing.push('MICROSOFT_CLIENT_ID');
        if (config.clientSecret.length === 0) missing.push('MICROSOFT_CLIENT_SECRET');
        if (config.sender.length === 0) missing.push('EMAIL_SENDER');

        return {
            configured: config.configured,
            sender: config.sender.length > 0 ? config.sender : null,
            tenantConfigured: config.tenantId.length > 0,
            clientConfigured: config.clientId.length > 0,
            secretConfigured: config.clientSecret.length > 0,
            recipientAllowlist: config.allowedRecipients,
            missing
        };
    }

    private assertConfigured(): void {
        if (this.isConfigured()) return;
        const { missing } = this.describeConfiguration();
        throw new AppError('EMAIL_NOT_CONFIGURED', 'Email sending is not configured.', {
            hint: `Set ${missing.join(', ')} in .env and restart the MCP server. The app registration needs the application permission Mail.Send with admin consent. Drafting tools work without this; only sending requires it.`
        });
    }

    /** Acquires and caches an app-only access token. */
    private async getAccessToken(): Promise<string> {
        this.assertConfigured();
        if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
            return this.cachedToken.value;
        }

        const config = this.config;
        const url = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
        const body = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials'
        });

        let response: Response;
        try {
            response = await this.fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
        } catch (error) {
            throw new AppError('GRAPH_AUTH_FAILED', 'Could not reach Microsoft Entra ID to obtain an access token.', {
                detail: error instanceof Error ? error.message : String(error)
            });
        }

        const payload = (await response.json().catch(() => ({}))) as TokenResponse;
        if (!response.ok || !payload.access_token) {
            // `error_description` can be long but never contains the secret itself;
            // it is redacted and truncated regardless.
            throw new AppError('GRAPH_AUTH_FAILED', 'Microsoft Graph authentication failed.', {
                httpStatus: response.status,
                hint: 'Verify MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET, that the secret has not expired, and that the app registration has admin-consented Mail.Send application permission.',
                detail: redactString(payload.error_description ?? payload.error ?? `HTTP ${response.status}`)
            });
        }

        const ttlSeconds = Math.max((payload.expires_in ?? 3600) - TOKEN_SKEW_SECONDS, 60);
        this.cachedToken = { value: payload.access_token, expiresAt: Date.now() + ttlSeconds * 1000 };
        log.debug('Acquired Microsoft Graph access token', { ttlSeconds });
        return this.cachedToken.value;
    }

    /**
     * Sends one message as the configured sender mailbox.
     * Callers must have already validated recipients and obtained confirmation.
     */
    async sendMail(message: GraphMailMessage): Promise<{ sender: string; sentAt: string }> {
        this.assertConfigured();
        const token = await this.getAccessToken();
        const sender = this.config.sender;

        const payload = {
            message: {
                subject: message.subject,
                body: { contentType: message.contentType, content: message.body },
                toRecipients: message.to.map(address => ({ emailAddress: { address } })),
                ccRecipients: message.cc.map(address => ({ emailAddress: { address } }))
            },
            saveToSentItems: true
        };

        const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(sender)}/sendMail`;
        let response: Response;
        try {
            response = await this.fetchImpl(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
        } catch (error) {
            throw new AppError('EMAIL_SEND_FAILED', 'Could not reach Microsoft Graph to send the email.', {
                detail: error instanceof Error ? error.message : String(error)
            });
        }

        // sendMail returns 202 Accepted with an empty body on success.
        if (response.status === 202 || response.status === 200) {
            log.info('Email sent via Microsoft Graph', { recipients: message.to.length, ccRecipients: message.cc.length });
            return { sender, sentAt: new Date().toISOString() };
        }

        const detail = await extractGraphError(response);
        if (response.status === 401) {
            this.cachedToken = null;
            throw new AppError('GRAPH_AUTH_FAILED', 'Microsoft Graph rejected the access token.', {
                httpStatus: 401,
                hint: 'The client secret may have expired or been rotated. Update MICROSOFT_CLIENT_SECRET and restart the server.',
                detail
            });
        }
        if (response.status === 403) {
            throw new AppError('EMAIL_SEND_FAILED', 'Microsoft Graph denied permission to send this email.', {
                httpStatus: 403,
                hint: 'The app registration needs the Mail.Send application permission with admin consent. If an application access policy is in place, it must include the EMAIL_SENDER mailbox.',
                detail
            });
        }
        if (response.status === 404) {
            throw new AppError('EMAIL_SEND_FAILED', `The sender mailbox "${sender}" was not found in the tenant.`, {
                httpStatus: 404,
                hint: 'EMAIL_SENDER must be a real, licensed mailbox (or a shared mailbox the app may send as).',
                detail
            });
        }
        if (response.status === 429) {
            throw new AppError('EMAIL_SEND_FAILED', 'Microsoft Graph rate limited the send request.', {
                httpStatus: 429,
                hint: 'Wait a moment and confirm the send again.',
                detail
            });
        }

        throw new AppError('EMAIL_SEND_FAILED', `Microsoft Graph returned status ${response.status} when sending the email.`, {
            httpStatus: response.status,
            detail
        });
    }
}

async function extractGraphError(response: Response): Promise<string | undefined> {
    try {
        const body = (await response.json()) as { error?: { code?: string; message?: string } };
        const code = body.error?.code;
        const message = body.error?.message;
        const combined = [code, message].filter(Boolean).join(': ');
        return combined.length > 0 ? redactString(combined).slice(0, 300) : undefined;
    } catch {
        return undefined;
    }
}

let sharedGraphService: GraphEmailService | null = null;

export function getGraphEmailService(): GraphEmailService {
    sharedGraphService ??= new GraphEmailService();
    return sharedGraphService;
}

export function setGraphEmailServiceForTesting(service: GraphEmailService | null): void {
    sharedGraphService = service;
}
