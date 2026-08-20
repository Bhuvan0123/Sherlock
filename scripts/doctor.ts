#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getConfig, loadDotEnv, PROJECT_ROOT } from '../src/config/env.js';
import { getDatabase } from '../src/database/connection.js';
import { getAdoClient } from '../src/azure-devops/client.js';
import { getSkills } from '../src/skills/registry.js';

async function check(label: string, run: () => Promise<void> | void): Promise<boolean> {
    try {
        await run();
        console.log(`✓ ${label}`);
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`✗ ${label}: ${message}`);
        return false;
    }
}

async function main(): Promise<void> {
    console.log('S.H.E.R.L.O.C.K. Doctor\n');
    loadDotEnv();

    const results: boolean[] = [];
    console.log('Environment');
    results.push(await check('Node.js', () => {
        const major = Number(process.versions.node.split('.')[0]);
        if (major < 22) throw new Error(`Node ${process.versions.node} detected; Node 22.5+ is required.`);
    }));
    results.push(await check('Dependencies', () => {
        if (!existsSync(resolve(PROJECT_ROOT, 'node_modules'))) throw new Error('Run npm install.');
    }));
    results.push(await check('.env', () => {
        if (!existsSync(resolve(PROJECT_ROOT, '.env'))) throw new Error('Create .env from .env.example.');
    }));

    let config: ReturnType<typeof getConfig> | null = null;
    console.log('\nConfiguration');
    results.push(await check('Configuration file', () => {
        config = getConfig();
    }));
    if (config) {
        results.push(await check('Organization', () => void config!.ado.organization));
        results.push(await check('Project', () => void config!.ado.project));
        results.push(await check('Team', () => void config!.ado.team));
        results.push(await check('PAT', () => void config!.ado.configured));
    }

    console.log('\nAzure DevOps');
    if (config) {
        const client = getAdoClient();
        results.push(await check('Authentication', async () => {
            await client.getProjects();
        }));
        results.push(await check('Project', async () => {
            await client.getProject(config!.ado.project);
        }));
        results.push(await check('Team', async () => {
            await client.getTeam(config!.ado.project, config!.ado.team);
        }));
    }

    console.log('\nRuntime');
    results.push(await check('Database', () => {
        getDatabase();
    }));
    results.push(await check('Skills', () => {
        if (getSkills().length === 0) throw new Error('No skills loaded.');
    }));
    results.push(await check('Build', () => {
        if (!existsSync(resolve(PROJECT_ROOT, 'dist/index.js'))) throw new Error('Run npm run build.');
    }));

    const ready = results.every(Boolean);
    console.log(`\nStatus: ${ready ? 'READY' : 'NOT_READY'}`);
    process.exitCode = ready ? 0 : 1;
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
