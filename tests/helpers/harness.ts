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
import { setCustomSkillRepositoryForTesting } from '../../src/database/repository/custom-skill.repository.js';
import { AzureDevOpsReadClient, setAdoClientForTesting } from '../../src/azure-devops/client.js';
import { AzureDevOpsWriteClient, setAdoWriteClientForTesting } from '../../src/azure-devops/write-client.js';
import { setProjectContextForTesting } from '../../src/azure-devops/context.js';
import { setTeamServiceForTesting } from '../../src/azure-devops/team.service.js';
import { setSprintServiceForTesting } from '../../src/azure-devops/sprint.service.js';
import { setWorkItemServiceForTesting } from '../../src/azure-devops/work-item.service.js';
import { setProjectServiceForTesting } from '../../src/azure-devops/project.service.js';
import { setAdoAnalyticsServiceForTesting } from '../../src/azure-devops/analytics.service.js';
import { setWorkloadServiceForTesting } from '../../src/services/analysis/workload.service.js';
import { setDeadlineServiceForTesting } from '../../src/services/analysis/deadline.service.js';
import { setDependencyServiceForTesting } from '../../src/services/analysis/dependency.service.js';
import { setProjectAnalysisServiceForTesting } from '../../src/services/analysis/project-analysis.service.js';
import { setProductivityServiceForTesting } from '../../src/services/analysis/productivity.service.js';
import { setAssignmentServiceForTesting } from '../../src/services/analysis/assignment.service.js';
import { setReviewServiceForTesting } from '../../src/services/analysis/review.service.js';
import { setActivityServiceForTesting } from '../../src/services/teamlead/activity.service.js';
import { setTeamLeadReviewServiceForTesting } from '../../src/services/teamlead/review.service.js';
import { clearRegisteredToolMeta } from '../../src/mcp/tool-registry.js';
import { createAdoFixture, type AdoFixtureOptions, type RecordedRequest } from './ado-fixture.js';

export interface HarnessOptions extends AdoFixtureOptions {
}

export interface Harness {
    requests: RecordedRequest[];
    database: Database;
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

const MANAGED_KEYS = [
    ...Object.keys(BASE_ENV)
];

/** Installs the environment, database and fixture client. Call from `beforeEach`. */
export function setupHarness(options: HarnessOptions = {}): Harness {
    const saved = new Map<string, string | undefined>();
    for (const key of MANAGED_KEYS) saved.set(key, process.env[key]);

    for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value;

    resetConfigForTesting();
    resetSingletons();

    const database = new Database(':memory:');
    setDatabaseForTesting(database);

    const fixture = createAdoFixture(options);
    setAdoClientForTesting(new AzureDevOpsReadClient(fixture.fetchImpl));
    setAdoWriteClientForTesting(new AzureDevOpsWriteClient(fixture.fetchImpl));

    return {
        requests: fixture.requests,
        database,
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
    setActivityRepositoryForTesting(null);
    setCustomSkillRepositoryForTesting(null);
    clearRegisteredToolMeta();
}
