#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfig, loadDotEnv } from './config/env.js';
import { closeDatabase } from './database/connection.js';
import { createLogger } from './utils/logger.js';
import { buildServer, SERVER_NAME, SERVER_VERSION } from './server.js';

const log = createLogger('main');

/**
 * Entry point for the stdio MCP server used by Claude Desktop and Claude Code.
 *
 * Everything diagnostic goes to stderr: stdout is reserved for the JSON-RPC stream,
 * so a stray `console.log` anywhere in this process would corrupt the protocol.
 */
async function main(): Promise<void> {
    loadDotEnv();
    const config = getConfig();

    log.info(`Starting ${SERVER_NAME} v${SERVER_VERSION}`, {
        organization: config.ado.organization,
        project: config.ado.project,
        team: config.ado.team,
        adoConfigured: config.ado.configured,
        emailConfigured: config.email.configured,
        database: config.database.path,
        accessMode: 'READ-ONLY (Azure DevOps)'
    });

    if (!config.ado.configured) {
        log.warn(
            'ADO_PAT is not set. The server will start and expose its tools, but Azure DevOps reads will fail until a read-only PAT is configured in .env.'
        );
    }
    if (!config.email.configured) {
        log.warn(
            'Microsoft Graph email is not fully configured. Drafting works; sending will report a configuration error until MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and EMAIL_SENDER are set.'
        );
    }

    const server = buildServer();
    const transport = new StdioServerTransport();

    const shutdown = (signal: string): void => {
        log.info('Shutting down', { signal });
        void server
            .close()
            .catch((error: unknown) => log.warn('Error while closing the MCP server', { error: String(error) }))
            .finally(() => {
                closeDatabase();
                process.exit(0);
            });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', error => {
        log.error('Uncaught exception', { error: error instanceof Error ? error.message : String(error) });
    });
    process.on('unhandledRejection', reason => {
        log.error('Unhandled promise rejection', { reason: String(reason) });
    });

    await server.connect(transport);
    log.info('Connected to stdio transport and ready for requests');
}

main().catch((error: unknown) => {
    // Startup failures must be visible in the client's server log.
    log.error('Fatal error during startup', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
});
