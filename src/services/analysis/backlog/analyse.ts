import type { WorkItem } from '../../../azure-devops/types.js';
import { RELATION } from '../../../azure-devops/fields.js';
import { relationTargetId } from '../../../azure-devops/work-item.service.js';
import { checkHierarchy } from './hierarchy.js';
import { checkCompletenessAndTypeQuality } from './completeness.js';
import { checkDatesAndSchedule } from './dates.js';
import {
    checkCustomFields,
    checkDuplicates,
    checkEstimatesOutliers,
    checkStatesOwnershipSprintDeps,
    checkStale
} from './governance-checks.js';
import { buildInsights, buildLimitations, groupFindings, suggestedWiql } from './group.js';
import type { BacklogContext, CategoryResult } from './types.js';
import { DEFAULT_COLUMNS } from './types.js';
import { isOpen } from './classify.js';

export function buildRelationMaps(items: WorkItem[]): {
    byId: Map<number, WorkItem>;
    childrenOf: Map<number, WorkItem[]>;
    parentOf: Map<number, WorkItem | undefined>;
    missingIds: number[];
} {
    const byId = new Map(items.map(item => [item.id, item]));
    const childrenOf = new Map<number, WorkItem[]>();
    const parentOf = new Map<number, WorkItem | undefined>();
    const missing = new Set<number>();

    for (const item of items) {
        if (item.parentId && !byId.has(item.parentId)) missing.add(item.parentId);
        for (const rel of item.relations) {
            const target = relationTargetId(rel);
            if (!target) continue;
            if (!byId.has(target)) missing.add(target);
            if (rel.rel === RELATION.child) {
                const kids = childrenOf.get(item.id) ?? [];
                kids.push({ id: target } as WorkItem);
                childrenOf.set(item.id, kids);
            }
            if (rel.rel === RELATION.parent) {
                parentOf.set(item.id, byId.get(target));
                if (!item.parentId) {
                    (item as WorkItem).parentId = target;
                }
            }
        }
        if (item.parentId) {
            const kids = childrenOf.get(item.parentId) ?? [];
            if (!kids.some(k => k.id === item.id)) kids.push(item);
            childrenOf.set(item.parentId, kids);
            parentOf.set(item.id, byId.get(item.parentId));
        }
    }

    for (const [parentId, stubs] of childrenOf) {
        childrenOf.set(
            parentId,
            stubs.map(stub => byId.get(stub.id) ?? stub).filter(child => child.title !== undefined || child.id > 0)
        );
    }

    return { byId, childrenOf, parentOf, missingIds: [...missing] };
}

export function hydrateChildren(ctx: BacklogContext): void {
    for (const [parentId, kids] of ctx.childrenOf) {
        ctx.childrenOf.set(
            parentId,
            kids.map(k => ctx.byId.get(k.id) ?? k)
        );
    }
    for (const item of ctx.items) {
        if (item.parentId) ctx.parentOf.set(item.id, ctx.byId.get(item.parentId));
    }
}

export function analyseBacklog(ctx: BacklogContext): {
    totalAnalyzed: number;
    openCount: number;
    issuesFound: number;
    severityCounts: Record<string, number>;
    categories: CategoryResult[];
    insights: string[];
    limitations: string[];
    defaultColumns: string[];
    queryHints: { queryName: string; queryDescription: string; wiql: string; count: number; columns: string[] }[];
} {
    hydrateChildren(ctx);

    const findings = [
        ...checkHierarchy(ctx),
        ...checkCompletenessAndTypeQuality(ctx),
        ...checkDatesAndSchedule(ctx),
        ...checkStatesOwnershipSprintDeps(ctx),
        ...checkStale(ctx),
        ...checkDuplicates(ctx),
        ...checkCustomFields(ctx),
        ...checkEstimatesOutliers(ctx)
    ];

    const categories = groupFindings(findings, ctx.byId);
    const issueItems = new Set(categories.flatMap(c => c.itemIds));
    const severityCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    for (const cat of categories) {
        severityCounts[cat.severity] += 1;
    }

    const queryHints = categories
        .filter(c => c.createQuery)
        .map(c => ({
            queryName: c.queryName,
            queryDescription: c.queryDescription,
            wiql: suggestedWiql(c.itemIds),
            count: c.count,
            columns: DEFAULT_COLUMNS
        }));

    return {
        totalAnalyzed: ctx.items.length,
        openCount: ctx.items.filter(isOpen).length,
        issuesFound: issueItems.size,
        severityCounts,
        categories,
        insights: buildInsights(categories, ctx.items.length, ctx.items.filter(isOpen).length),
        limitations: buildLimitations(ctx),
        defaultColumns: DEFAULT_COLUMNS,
        queryHints
    };
}
