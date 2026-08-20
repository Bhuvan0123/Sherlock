import { getConfig } from '../config/env.js';

export interface TelemetryStats {
    apiCalls: number;
    duplicateCalls: number;
    cacheHits: number;
    cacheMisses: number;
    itemsRetrieved: number;
    fieldsRetrieved: number;
    queriesReused: number;
    queriesCreated: number;
    payloadSizeKb: number;
    aggregateQueries: number;
    idQueries: number;
    bodyRetrievals: number;
    idsRequested: number;
    bodiesReturned: number;
    budgetWarnings: string[];
    modulesExecuted: string[];
}

class TelemetryTracker {
    private empty(): TelemetryStats {
        return {
            apiCalls: 0,
            duplicateCalls: 0,
            cacheHits: 0,
            cacheMisses: 0,
            itemsRetrieved: 0,
            fieldsRetrieved: 0,
            queriesReused: 0,
            queriesCreated: 0,
            payloadSizeKb: 0,
            aggregateQueries: 0,
            idQueries: 0,
            bodyRetrievals: 0,
            idsRequested: 0,
            bodiesReturned: 0,
            budgetWarnings: [],
            modulesExecuted: []
        };
    }

    private stats: TelemetryStats = this.empty();

    recordApiCall() { this.stats.apiCalls++; }
    recordDuplicateCall() { this.stats.duplicateCalls++; }
    recordCacheHit() { this.stats.cacheHits++; }
    recordCacheMiss() { this.stats.cacheMisses++; }
    recordItemsRetrieved(count: number, fields: number) {
        this.stats.itemsRetrieved += count;
        this.stats.fieldsRetrieved += fields;
    }
    recordQueryReused() { this.stats.queriesReused++; }
    recordQueryCreated() { this.stats.queriesCreated++; }
    recordPayloadBytes(bytes: number) {
        this.stats.payloadSizeKb += (bytes / 1024);
    }
    recordAggregateQuery() { this.stats.aggregateQueries++; }
    recordIdQuery(idsReturned: number) {
        this.stats.idQueries++;
        this.stats.idsRequested += idsReturned;
    }
    recordBodyRetrieval(count: number) {
        this.stats.bodyRetrievals++;
        this.stats.bodiesReturned += count;
    }
    recordBudgetWarning(message: string) {
        this.stats.budgetWarnings.push(message);
    }
    recordModules(ids: string[]) {
        this.stats.modulesExecuted = [...ids];
    }

    getStats(): TelemetryStats {
        return { ...this.stats, budgetWarnings: [...this.stats.budgetWarnings], modulesExecuted: [...this.stats.modulesExecuted] };
    }

    getReport(): string {
        const warnings = this.stats.budgetWarnings.length
            ? `\nBudget warnings:\n${this.stats.budgetWarnings.map(w => `- ${w}`).join('\n')}`
            : '';
        return `
[TOKEN_DEBUG] Telemetry Report:
API calls: ${this.stats.apiCalls}
Aggregate queries: ${this.stats.aggregateQueries}
ID queries: ${this.stats.idQueries}
Body retrievals: ${this.stats.bodyRetrievals}
IDs requested: ${this.stats.idsRequested}
Bodies returned: ${this.stats.bodiesReturned}
Cache hits: ${this.stats.cacheHits}
Cache misses: ${this.stats.cacheMisses}
Work items retrieved: ${this.stats.itemsRetrieved}
Fields requested: ${this.stats.fieldsRetrieved}
Duplicate calls: ${this.stats.duplicateCalls}
Modules executed: ${this.stats.modulesExecuted.join(', ') || '(none)'}
Queries reused: ${this.stats.queriesReused}
Queries created: ${this.stats.queriesCreated}
Response payload: ${Math.round(this.stats.payloadSizeKb)} KB${warnings}
        `.trim();
    }

    dumpIfDebug() {
        if (getConfig().ado.tokenDebug) {
            console.log(this.getReport());
        }
    }

    reset(): void {
        this.stats = this.empty();
    }
}

export const Telemetry = new TelemetryTracker();
