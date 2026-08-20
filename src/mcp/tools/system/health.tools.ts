import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfig } from '../../../config/env.js';
import { getDatabase } from '../../../database/connection.js';
import { getAdoClient } from '../../../azure-devops/client.js';
import { getProjectContext } from '../../../azure-devops/context.js';
import { InternalSkillRegistry } from '../../../core/skill-registry.js';
import { getSkills } from '../../../skills/registry.js';
import { registerTool } from '../../tool-registry.js';

type CheckStatus = 'ok' | 'failed';

interface HealthCheck {
    status: CheckStatus;
    message: string;
}

function ok(message: string): HealthCheck {
    return { status: 'ok', message };
}

function failed(error: unknown): HealthCheck {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
}

async function capture(run: () => Promise<void> | void): Promise<HealthCheck> {
    try {
        await run();
        return ok('OK');
    } catch (error) {
        return failed(error);
    }
}

export async function runSherlockHealthCheck(): Promise<Record<string, unknown>> {
    const config = getConfig();
    const client = getAdoClient();

    const configuration = {
        organization: ok('Configured'),
        project: ok('Configured'),
        team: ok('Configured'),
        pat: ok('Configured')
    };

    const azureDevOps = {
        authentication: await capture(async () => {
            await client.getProjects();
        }),
        organization: await capture(async () => {
            await client.getProjects();
        }),
        project: await capture(async () => {
            await client.getProject(config.ado.project);
        }),
        team: await capture(async () => {
            await client.getTeam(config.ado.project, config.ado.team);
        })
    };

    const application = {
        skillRegistry: await capture(() => {
            if (getSkills().length === 0) throw new Error('No built-in skills loaded.');
        }),
        analysisModules: await capture(() => {
            InternalSkillRegistry.loadFromDatabase();
        }),
        database: await capture(() => {
            getDatabase();
        }),
        mcpServer: ok('Registered'),
        projectContext: await capture(async () => {
            await getProjectContext();
        })
    };

    const allChecks = [
        ...Object.values(configuration),
        ...Object.values(azureDevOps),
        ...Object.values(application)
    ] as HealthCheck[];
    const ready = allChecks.every(check => check.status === 'ok');

    return {
        product: 'S.H.E.R.L.O.C.K.',
        status: ready ? 'READY' : 'NOT_READY',
        configuration,
        azureDevOps,
        application
    };
}

export function registerHealthTools(server: McpServer): void {
    registerTool(server, {
        name: 'sherlock_health_check',
        title: 'S.H.E.R.L.O.C.K. Health Check',
        description:
            'Checks configuration, Azure DevOps access, skill registry, database, and MCP server readiness without returning secrets.',
        group: 'system',
        audit: {
            category: 'maintenance',
            action: 'Health check'
        },
        handler: async () => runSherlockHealthCheck(),
        summarise: result => `S.H.E.R.L.O.C.K. health: ${(result as { status?: string }).status ?? 'UNKNOWN'}.`
    });
}
