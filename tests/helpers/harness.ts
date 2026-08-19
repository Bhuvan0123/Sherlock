/**
 * Test harness: wires a deterministic environment, an in-memory audit database
 * and a fixture-backed `AzureDevOpsReadClient` into the real service graph.
 *
 * Every service takes its collaborators by constructor injection with a lazy
 * singleton default, so replacing the shared client and repositories before the
 * first `get*Service()` call is enough to run the production code paths.
 */
import { resetConfigForTesting } from '../../src/config/env.js';
import { Database, setDatabaseForTesting } from '../../src/database/connection.js';
import { setActivityRepositoryForTesting } from '../../src/database/repository/activity.repository.js';
import { setEmailRepositoryForTesting } from '../../src/database/repository/email.repository.js';
import { AzureDevOpsReadClient, setAdoClientForTesting } from '../../src/services/azure-devops/client.js';
import { AzureDevOpsWriteClient, setAdoWriteClientForTesting } from '../../src/services/azure-devops/write-client.js';
import { setProjectContextForTesting } from '../../src/services/azure-devops/context.js';
import { setTeamServiceForTesting } from '../../src/services/azure-devops/team.service.js';
import { setSprintServiceForTesting } from '../../src/services/azure-devops/sprint.service.js';
import { setWorkItemServiceForTesting } from '../../src/services/azure-devops/work-item.service.js';
import { setProjectServiceForTesting } from '../../src/services/azure-devops/project.service.js';
import { setAdoAnalyticsServiceForTesting } from '../../src/services/azure-devops/analytics.service.js';
import { setWorkloadServiceForTesting } from '../../src/services/analysis/workload.service.js';
import { setDeadlineServiceForTesting } from '../../src/services/analysis/deadline.service.js';
import { setDependencyServiceForTesting } from '../../src/services/analysis/dependency.service.js';
import { setProjectAnalysisServiceForTesting } from '../../src/services/analysis/project-analysis.service.js';
import { setProductivityServiceForTesting } from '../../src/services/analysis/productivity.service.js';
import { setAssignmentServiceForTesting } from '../../src/services/analysis/assignment.service.js';
import { setReviewServiceForTesting } from '../../src/services/analysis/review.service.js';
import { setActivityServiceForTesting } from '../../src/services/teamlead/activity.service.js';
import { setTeamLeadReviewServiceForTesting } from '../../src/services/teamlead/review.service.js';
import { setEmailServiceForTesting } from '../../src/services/email/email.service.js';
import { setGraphEmailServiceForTesting, GraphEmailService } from '../../src/services/email/graph.service.js';
import { setEmailTemplateServiceForTesting } from '../../src/services/email/templates.service.js';
import { clearRegisteredToolMeta } from '../../src/mcp/tool-registry.js';
import { createAdoFixture, type AdoFixtureOptions, type RecordedRequest } from './ado-fixture.js';

export interface HarnessOptions extends AdoFixtureOptions {
    /** Configure Microsoft Graph credentials so email sending is reachable. */
    emailConfigured?: boolean;
    allowedRecipients?: string[];
    /** Fake Graph transport. Defaults to accepting every send. */
    graphFetch?: typeof fetch;
}

export interface Harness {
    requests: RecordedRequest[];
    database: Database;
    graphRequests: { url: string; method: string; body: unknown }[];
    reset(): void;
}

const BASE_ENV: Record<string, string> = {
    ADO_ORGANIZATION: 'KEBS4KAAR',
    ADO_PROJECT: 'K4K',
    ADO_TEAM: 'Platform',
    ADO_PAT: 'test-pat-value-not-a-real-secret',
    DATABASE_URL: ':memory:',
    LOG_LEVEL: 'silent',
    CACHE_TTL_SECONDS: '60'
};

const EMAIL_ENV: Record<string, string> = {
    MICROSOFT_TENANT_ID: '11111111-2222-3333-4444-555555555555',
    MICROSOFT_CLIENT_ID: '66666666-7777-8888-9999-000000000000',
    MICROSOFT_CLIENT_SECRET: 'test-client-secret-not-real',
    EMAIL_SENDER: 'lead@kaartech.com'
};

const MANAGED_KEYS = [
    ...Object.keys(BASE_ENV),
    ...Object.keys(EMAIL_ENV),
    'EMAIL_ALLOWED_RECIPIENTS',
    'EMAIL_DRAFT_TTL_MINUTES'
];

/** Installs the environment, database and fixture client. Call from `beforeEach`. */
export function setupHarness(options: HarnessOptions = {}): Harness {
    const saved = new Map<string, string | undefined>();
    for (const key of MANAGED_KEYS) saved.set(key, process.env[key]);

    for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value;

    if (options.emailConfigured) {
        for (const [key, value] of Object.entries(EMAIL_ENV)) process.env[key] = value;
        if (options.allowedRecipients) {
            process.env.EMAIL_ALLOWED_RECIPIENTS = options.allowedRecipients.join(',');
        } else {
            delete process.env.EMAIL_ALLOWED_RECIPIENTS;
        }
    } else {
        for (const key of Object.keys(EMAIL_ENV)) delete process.env[key];
        delete process.env.EMAIL_ALLOWED_RECIPIENTS;
    }

    resetConfigForTesting();
    resetSingletons();

    const database = new Database(':memory:');
    setDatabaseForTesting(database);

    const fixture = createAdoFixture(options);
    setAdoClientForTesting(new AzureDevOpsReadClient(fixture.fetchImpl));
    setAdoWriteClientForTesting(new AzureDevOpsWriteClient(fixture.fetchImpl));

    const graphRequests: { url: string; method: string; body: unknown }[] = [];
    const graphFetch =
        options.graphFetch ??
        ((async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const method = (init?.method ?? 'GET').toUpperCase();
            const raw = init?.body;
            let body: unknown = undefined;
            if (typeof raw === 'string') {
                body = raw.startsWith('{') ? JSON.parse(raw) : raw;
            }
            graphRequests.push({ url, method, body });

            if (url.includes('/oauth2/v2.0/token')) {
                return new Response(
                    JSON.stringify({ access_token: 'fake-graph-token', expires_in: 3600, token_type: 'Bearer' }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
            }
            if (url.includes('/sendMail')) {
                return new Response(null, { status: 202 });
            }
            return new Response(JSON.stringify({ error: { code: 'unknown', message: 'No fake handler' } }), {
                status: 404,
                headers: { 'content-type': 'application/json' }
            });
        }) as unknown as typeof fetch);

    setGraphEmailServiceForTesting(new GraphEmailService(graphFetch));

    return {
        requests: fixture.requests,
        database,
        graphRequests,
        reset(): void {
            resetSingletons();
            setDatabaseForTesting(null);
            for (const [key, value] of saved) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            resetConfigForTesting();
        }
    };
}

/** Drops every cached singleton so the next `get*` call rebuilds against the harness. */
function resetSingletons(): void {
    setAdoClientForTesting(null);
    setAdoWriteClientForTesting(null);
    setProjectContextForTesting(null);
    setTeamServiceForTesting(null);
    setSprintServiceForTesting(null);
    setWorkItemServiceForTesting(null);
    setProjectServiceForTesting(null);
    setAdoAnalyticsServiceForTesting(null);
    setWorkloadServiceForTesting(null);
    setDeadlineServiceForTesting(null);
    setDependencyServiceForTesting(null);
    setProjectAnalysisServiceForTesting(null);
    setProductivityServiceForTesting(null);
    setAssignmentServiceForTesting(null);
    setReviewServiceForTesting(null);
    setActivityServiceForTesting(null);
    setTeamLeadReviewServiceForTesting(null);
    setEmailServiceForTesting(null);
    setEmailTemplateServiceForTesting(null);
    setGraphEmailServiceForTesting(null);
    setActivityRepositoryForTesting(null);
    setEmailRepositoryForTesting(null);
    clearRegisteredToolMeta();
}
