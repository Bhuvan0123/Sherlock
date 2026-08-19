import type { WorkItem } from '../../azure-devops/types.js';
import type { BacklogContext, CategoryResult, Finding, FindingSeverity } from './types.js';
import { kaarFlowQueryName } from './classify.js';

const RANK: Record<FindingSeverity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

const CATEGORY_BLURB: Record<string, string> = {
    'Closed Stories Without Tasks': 'Completed User Stories / PBIs with no child Tasks',
    'Active Stories Without Tasks': 'Active User Stories / PBIs with no child Tasks',
    'Missing Planned End': 'Open work without a planned or target end date',
    'Missing Planned Start': 'Open work without a planned start date',
    'Orphan Task': 'Tasks with no parent Story/PBI',
    'Unassigned Active Work': 'Active items with no assignee',
    'Unassigned High Priority': 'High-priority items with no owner',
    'Stale Active Work 30+ Days': 'Open items unchanged for 30 or more days',
    'Stale Active Work 14+ Days': 'Open items unchanged for 14 or more days',
    'Stale Active Work 7+ Days': 'Open items unchanged for 7 or more days',
    'Overdue Work': 'Open items past planned end',
    'Overdue High Priority Work': 'High-priority open items past planned end',
    'Potential Duplicate': 'Open items sharing the same title',
    'Blocked Work': 'Items marked blocked'
};

export function groupFindings(findings: Finding[], byId: Map<number, WorkItem>): CategoryResult[] {
    const buckets = new Map<string, Finding[]>();
    for (const finding of findings) {
        const list = buckets.get(finding.category) ?? [];
        list.push(finding);
        buckets.set(finding.category, list);
    }

    const results: CategoryResult[] = [];
    for (const [category, list] of buckets) {
        const ids = [...new Set(list.map(f => f.itemId))];
        const worst = list.reduce<FindingSeverity>(
            (acc, f) => (RANK[f.severity] > RANK[acc] ? f.severity : acc),
            'Low'
        );
        const review = list.every(f => f.reviewRecommended);
        const samples = ids.slice(0, 3).map(id => {
            const item = byId.get(id);
            return {
                id,
                title: item?.title ?? '(unknown)',
                state: item?.state ?? '',
                assignedTo: item?.assignedTo ?? null,
                webUrl: item?.webUrl ?? null
            };
        });
        const blurb = CATEGORY_BLURB[category] ?? list[0]?.issue ?? category;
        results.push({
            category,
            dimension: list[0]?.dimension ?? 'governance',
            count: ids.length,
            severity: worst,
            reviewRecommended: review,
            description: blurb,
            queryName: kaarFlowQueryName(category),
            queryDescription: `${blurb}. Identified during KaarFlow backlog governance analysis.`,
            createQuery: ids.length > 3,
            itemIds: ids,
            samples
        });
    }

    results.sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.count - a.count);
    return results;
}

export function suggestedWiql(ids: number[]): string {
    const unique = [...new Set(ids)].slice(0, 200);
    if (unique.length === 0) return 'SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 0';
    return `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${unique.join(', ')})`;
}

export function buildInsights(categories: CategoryResult[], totalAnalyzed: number, openCount: number): string[] {
    const insights: string[] = [];
    const issueItems = new Set<number>();
    for (const cat of categories) for (const id of cat.itemIds) issueItems.add(id);

    if (totalAnalyzed > 0) {
        insights.push(
            `${issueItems.size} of ${totalAnalyzed} analysed items appear in at least one governance category.`
        );
    }

    const byDim = new Map<string, number>();
    for (const cat of categories) {
        byDim.set(cat.dimension, (byDim.get(cat.dimension) ?? 0) + cat.count);
    }
    const dimSorted = [...byDim.entries()].sort((a, b) => b[1] - a[1]);
    if (dimSorted[0] && issueItems.size > 0) {
        const [dim, count] = dimSorted[0];
        insights.push(`The largest cluster of findings is ${dim} (${count} item flags in that dimension).`);
    }

    const overdue = categories.find(c => c.category === 'Overdue Work' || c.category === 'Overdue High Priority Work');
    const missingEnd = categories.find(c => c.category === 'Missing Planned End');
    if (overdue && missingEnd) {
        insights.push('Overdue work and missing planned-end dates both appear — schedule forecasting is incomplete.');
    }

    const stale = categories.filter(c => c.dimension === 'stale');
    if (stale.length > 0 && openCount > 0) {
        const staleIds = new Set(stale.flatMap(c => c.itemIds));
        insights.push(`${staleIds.size} open items look stale against the 7/14/30-day activity thresholds.`);
    }

    const hierarchy = categories.filter(c => c.dimension === 'hierarchy');
    if (hierarchy.length > 0) {
        insights.push(`Hierarchy issues span ${hierarchy.length} categor${hierarchy.length === 1 ? 'y' : 'ies'} (orphans, empty parents, or parent/child state mismatch).`);
    }

    return insights.slice(0, 8);
}

export function buildLimitations(ctx: BacklogContext): string[] {
    const notes: string[] = [];
    if (ctx.truncated) {
        notes.push(`Scan was capped at ${ctx.scannedLimit} work items; remaining backlog items were not analysed.`);
    }
    if (!ctx.fields.plannedStart || !ctx.fields.plannedEnd) {
        notes.push('Planned date analysis is limited because one or more planned date fields are not mapped in this process.');
    }
    if (!ctx.fields.actualStart || !ctx.fields.actualEnd) {
        notes.push('Actual date analysis is limited because one or more actual date fields are not mapped.');
    }
    if (!ctx.fields.description) {
        notes.push('Description quality was not measured — System.Description is not in the field catalogue.');
    }
    if (!ctx.fields.acceptanceCriteria) {
        notes.push('Acceptance Criteria was not available on this process, so story AC checks were skipped.');
    }
    notes.push('Dependency analysis is limited to relations Azure DevOps returned on the scanned items.');
    notes.push('WIQL cannot express every structural check; saved queries for those categories use an ID IN list of the measured items.');
    return notes;
}
