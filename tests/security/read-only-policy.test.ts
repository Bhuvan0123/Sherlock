/**
 * Unit tests for the read-only chokepoint: HTTP method policy, forbidden API
 * surfaces, WIQL validation, and the transport-level guarantee that the client
 * only ever issues GET (plus the allowlisted WIQL POST).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    ALLOWED_HTTP_METHODS,
    READ_ONLY_POST_ENDPOINTS,
    READ_ONLY_REFUSAL_MESSAGE,
    assertReadOnlyRequest,
    auditToolSurface,
    escapeWiqlLiteral,
    isAllowlistedReadOnlyPostEndpoint,
    validateWiqlQuery
} from '../../src/security/read-only-policy.js';
import { ReadOnlyViolationError } from '../../src/utils/errors.js';
import { AzureDevOpsReadClient } from '../../src/azure-devops/client.js';
import { getWorkItemService } from '../../src/azure-devops/work-item.service.js';
import { getProjectService } from '../../src/azure-devops/project.service.js';
import { setupHarness, type Harness } from '../helpers/harness.js';

const BASE = 'https://dev.azure.com/KEBS4KAAR';

describe('HTTP method policy', () => {
    it('allows only GET', () => {
        expect(ALLOWED_HTTP_METHODS).toEqual(['GET']);
        expect(() => assertReadOnlyRequest('GET', `${BASE}/K4K/_apis/wit/workitems/1?api-version=7.1`)).not.toThrow();
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'MERGE', 'OPTIONS', 'HEAD', 'TRACE'])(
        'blocks %s against a work-item endpoint',
        method => {
            expect(() => assertReadOnlyRequest(method, `${BASE}/K4K/_apis/wit/workitems/1`)).toThrow(
                ReadOnlyViolationError
            );
        }
    );

    it('blocks lowercase and mixed-case method spellings', () => {
        for (const method of ['patch', 'Patch', 'dElEtE']) {
            expect(() => assertReadOnlyRequest(method, `${BASE}/K4K/_apis/wit/workitems/1`)).toThrow(
                ReadOnlyViolationError
            );
        }
    });

    it('allows POST only to the WIQL query endpoint', () => {
        expect(READ_ONLY_POST_ENDPOINTS).toEqual(['_apis/wit/wiql']);
        expect(() => assertReadOnlyRequest('POST', `${BASE}/K4K/_apis/wit/wiql?api-version=7.1`)).not.toThrow();
        expect(() => assertReadOnlyRequest('POST', `${BASE}/K4K/Platform/_apis/wit/wiql`)).not.toThrow();
        expect(() => assertReadOnlyRequest('POST', `${BASE}/K4K/_apis/wit/workitemsbatch`)).toThrow(
            ReadOnlyViolationError
        );
    });

    it('is not fooled by WIQL look-alike paths', () => {
        for (const url of [
            `${BASE}/K4K/_apis/wit/wiqlx`,
            `${BASE}/K4K/_apis/wit/wiql/../workitems/1`,
            `${BASE}/K4K/_apis/wit/wiql/1/workitems`,
            `${BASE}/K4K/_apis/wit/workitems?spoof=_apis/wit/wiql`
        ]) {
            expect(isAllowlistedReadOnlyPostEndpoint(url), url).toBe(false);
            expect(() => assertReadOnlyRequest('POST', url), url).toThrow(ReadOnlyViolationError);
        }
    });

    it('blocks percent-encoded attempts to reach a creation endpoint', () => {
        expect(() => assertReadOnlyRequest('GET', `${BASE}/K4K/_apis/wit/workitems/%24Task`)).toThrow(
            ReadOnlyViolationError
        );
    });

    it.each([
        '_apis/wit/workitems/$Task',
        '_apis/wit/workitemsdelete/12',
        '_apis/wit/recyclebin/12',
        '_apis/git/pushes',
        '_apis/git/pullrequests',
        '_apis/build/builds',
        '_apis/pipelines/9/runs',
        '_apis/release/releases',
        '_apis/accesscontrolentries/x',
        '_apis/graph/memberships/x',
        '_apis/hooks/subscriptions',
        '_apis/tokens/pats'
    ])('blocks the out-of-scope surface %s even for GET', fragment => {
        expect(() => assertReadOnlyRequest('GET', `${BASE}/K4K/${fragment}`)).toThrow(ReadOnlyViolationError);
    });

    it('explains the refusal in plain language', () => {
        expect(READ_ONLY_REFUSAL_MESSAGE.toLowerCase()).toContain('read-only');
        expect(READ_ONLY_REFUSAL_MESSAGE.toLowerCase()).toContain('cannot');
    });
});

describe('WIQL validation', () => {
    it('accepts a plain SELECT', () => {
        expect(() =>
            validateWiqlQuery("SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'")
        ).not.toThrow();
    });

    it.each([
        "UPDATE WorkItems SET [System.State] = 'Closed'",
        'DELETE FROM WorkItems WHERE [System.Id] = 5421',
        "INSERT INTO WorkItems ([System.Title]) VALUES ('x')",
        'DROP TABLE WorkItems',
        "SELECT [System.Id] FROM WorkItems; DELETE FROM WorkItems",
        "SELECT [System.Id] INTO Other FROM WorkItems",
        "SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 1 SET [System.State] = 'Closed'",
        'EXEC sp_who'
    ])('rejects %s', query => {
        expect(() => validateWiqlQuery(query)).toThrow(ReadOnlyViolationError);
    });

    it('rejects an empty or oversized query', () => {
        expect(() => validateWiqlQuery('   ')).toThrow(ReadOnlyViolationError);
        expect(() => validateWiqlQuery(`SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '${'x'.repeat(9000)}'`)).toThrow(
            ReadOnlyViolationError
        );
    });

    it('does not trip over mutation words inside search text', () => {
        expect(() =>
            validateWiqlQuery("SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS 'update the delete flow'")
        ).not.toThrow();
    });

    it('escapes quotes so search text cannot close a literal', () => {
        const escaped = escapeWiqlLiteral("O'Brien'; DELETE FROM WorkItems --");
        expect(escaped).toBe("O''Brien''; DELETE FROM WorkItems --");
        expect(() =>
            validateWiqlQuery(`SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '${escaped}'`)
        ).not.toThrow();
    });
});

describe('tool surface audit', () => {
    it('flags mutation-shaped tool names', () => {
        const violations = auditToolSurface([
            { name: 'ado_create_work_item' },
            { name: 'ado_update_work_item_state' },
            { name: 'ado_delete_task' },
            { name: 'ado_assign_work_item' },
            { name: 'ado_add_comment' },
            { name: 'ado_modify_sprint' },
            { name: 'azure_devops_request' },
            { name: 'execute_http' },
            { name: 'trigger_pipeline' }
        ]);
        expect(violations.length).toBeGreaterThanOrEqual(9);
    });

    it('flags tools that accept HTTP-level or credential parameters', () => {
        for (const parameter of ['method', 'url', 'endpoint', 'headers', 'pat', 'token', 'api_version']) {
            const violations = auditToolSurface([{ name: 'ado_get_thing', parameterNames: [parameter] }]);
            expect(violations, parameter).toHaveLength(1);
        }
    });

    it('flags payload parameters on all tools', () => {
        expect(auditToolSurface([{ name: 'ado_get_work_item', parameterNames: ['body'] }])).toHaveLength(1);
        expect(auditToolSurface([{ name: 'analysis_project', parameterNames: ['operations'] }])).toHaveLength(1);
    });

    it('accepts the read-only tool shapes this server actually registers', () => {
        expect(
            auditToolSurface([
                { name: 'ado_get_work_item', parameterNames: ['id', 'include_relations'] },
                { name: 'ado_get_work_items_by_assignee', parameterNames: ['member', 'sprint'] },
                { name: 'analysis_assignment_recommendation', parameterNames: ['work_item_id'] },
                { name: 'tl_get_activity', parameterNames: ['days', 'limit'] },
                { name: 'sherlock_health_check', parameterNames: [] }
            ])
        ).toEqual([]);
    });
});

describe('the client cannot mutate Azure DevOps', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = setupHarness();
    });

    afterEach(() => {
        harness.reset();
    });

    it('exposes no mutating method', () => {
        const client = new AzureDevOpsReadClient();
        const surface = [
            ...Object.getOwnPropertyNames(Object.getPrototypeOf(client)),
            ...Object.keys(client)
        ];

        for (const forbidden of [
            'post',
            'put',
            'patch',
            'delete',
            'request',
            'createWorkItem',
            'updateWorkItem',
            'deleteWorkItem',
            'assignWorkItem',
            'addComment',
            'updateIteration',
            'moveWorkItem'
        ]) {
            expect(surface, `client exposes ${forbidden}`).not.toContain(forbidden);
            expect((client as unknown as Record<string, unknown>)[forbidden]).toBeUndefined();
        }
    });

    it('uses GET for every read, and POST only for WIQL', async () => {
        // Exercise a broad slice of the read surface.
        await getProjectService().getOverview();
        await getWorkItemService().getById(1000, { includeRelations: true });
        await getWorkItemService().search('logging');
        await getWorkItemService().getHierarchy(1000);
        await getWorkItemService().getHistory(1300);
        await getWorkItemService().getComments(1300);
        await getWorkItemService().overdue();
        await getWorkItemService().blocked();

        expect(harness.requests.length).toBeGreaterThan(5);
        for (const request of harness.requests) {
            if (request.method === 'GET') continue;
            expect(request.method, `unexpected ${request.method} ${request.path}`).toBe('POST');
            expect(request.path).toMatch(/_apis\/wit\/wiql$/);
            const body = request.body as { query?: string };
            expect(body.query).toBeDefined();
            expect(body.query!.trim().toLowerCase().startsWith('select')).toBe(true);
        }
    });

    it('authenticates every request without ever revealing the PAT', async () => {
        const item = await getWorkItemService().getById(1000);
        expect(harness.requests.length).toBeGreaterThan(0);
        expect(harness.requests.every(request => request.hadAuthorizationHeader)).toBe(true);
        expect(JSON.stringify(item)).not.toContain('test-pat-value-not-a-real-secret');
        expect(harness.requests.every(request => !request.url.includes('test-pat-value'))).toBe(true);
    });
});
