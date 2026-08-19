import type { Finding } from './types.js';
import type { BacklogContext } from './types.js';
import { hasChildHierarchy, isComplete, isOpen, typeKind } from './classify.js';

export function checkHierarchy(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];

    for (const item of ctx.items) {
        const kind = typeKind(item.type);
        const children = ctx.childrenOf.get(item.id) ?? [];
        const parent = item.parentId ? ctx.parentOf.get(item.id) ?? ctx.byId.get(item.parentId) : undefined;
        const parentMissing = Boolean(item.parentId) && !parent && !ctx.byId.has(item.parentId!);

        if (parentMissing) {
            findings.push({
                itemId: item.id,
                category: 'Invalid Parent Link',
                dimension: 'hierarchy',
                issue: `Parent #${item.parentId} was not found in the scanned backlog`,
                severity: 'Medium',
                reviewRecommended: true
            });
        }

        if (!item.parentId) {
            if (kind === 'feature' && isOpen(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Feature Without Epic',
                    dimension: 'hierarchy',
                    issue: 'Feature has no parent Epic',
                    severity: 'Medium',
                    reviewRecommended: true
                });
            } else if (kind === 'story' && isOpen(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Story Without Feature',
                    dimension: 'hierarchy',
                    issue: 'User Story / PBI has no parent Feature',
                    severity: 'Medium'
                });
            } else if (kind === 'task' && isOpen(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Orphan Task',
                    dimension: 'hierarchy',
                    issue: 'Task has no parent Story/PBI',
                    severity: 'High'
                });
            } else if (kind === 'bug' && isOpen(item) && isActiveLike(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Bug Without Parent',
                    dimension: 'hierarchy',
                    issue: 'Active bug has no parent (review whether it should sit under a Feature/Story)',
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
        }

        if (isOpen(item) && !hasChildHierarchy(item, children)) {
            if (kind === 'epic') {
                findings.push({
                    itemId: item.id,
                    category: 'Empty Epic',
                    dimension: 'hierarchy',
                    issue: 'Open Epic has no child Features',
                    severity: 'Low',
                    reviewRecommended: true
                });
            } else if (kind === 'feature') {
                findings.push({
                    itemId: item.id,
                    category: 'Empty Feature',
                    dimension: 'hierarchy',
                    issue: 'Open Feature has no child Stories/PBIs',
                    severity: 'Medium',
                    reviewRecommended: true
                });
            }
        }

        if (parent && isComplete(parent) && isOpen(item)) {
            findings.push({
                itemId: item.id,
                category: 'Closed Parent With Active Child',
                dimension: 'hierarchy',
                issue: `Parent #${parent.id} is ${parent.state} while this item remains ${item.state}`,
                severity: 'High'
            });
        }

        if (kind === 'epic' || kind === 'feature' || kind === 'story') {
            if (isOpen(item) && children.length > 0 && children.every(isComplete)) {
                findings.push({
                    itemId: item.id,
                    category: 'Active Parent With All Children Closed',
                    dimension: 'hierarchy',
                    issue: 'All children are done but the parent remains open',
                    severity: kind === 'story' ? 'High' : 'Medium'
                });
            }
        }

        if (children.length > 20) {
            findings.push({
                itemId: item.id,
                category: 'Unusually Large Parent',
                dimension: 'hierarchy',
                issue: `${children.length} children — decomposition may be needed`,
                severity: 'Low',
                reviewRecommended: true
            });
        }
    }

    return findings;
}

function isActiveLike(item: { stateCategory: string | null }): boolean {
    return item.stateCategory === 'InProgress';
}
