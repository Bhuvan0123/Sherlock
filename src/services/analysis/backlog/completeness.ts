import type { BacklogContext, Finding } from './types.js';
import {
    estimateOf,
    isActive,
    isComplete,
    isHighPriority,
    isOpen,
    isPlaceholderTitle,
    isWeakDescription,
    isWeakTitle,
    hasChildHierarchy,
    typeKind
} from './classify.js';


export function checkCompletenessAndTypeQuality(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];

    for (const item of ctx.items) {
        const kind = typeKind(item.type);
        const open = isOpen(item);

        if (!item.title || item.title === '(untitled)' || item.title.trim() === '') {
            findings.push({
                itemId: item.id,
                category: 'Empty Title',
                dimension: 'title',
                issue: 'Title is empty',
                severity: 'High'
            });
        } else if (isPlaceholderTitle(item.title)) {
            findings.push({
                itemId: item.id,
                category: 'Placeholder Title',
                dimension: 'title',
                issue: `Suspicious title "${item.title}"`,
                severity: 'Medium'
            });
        } else if (open && isWeakTitle(item.title, item.type)) {
            findings.push({
                itemId: item.id,
                category: 'Weak Title',
                dimension: 'title',
                issue: 'Title is too short or generic for this work-item type',
                severity: 'Low',
                reviewRecommended: true
            });
        }

        if (ctx.fields.description) {
            if (open && isWeakDescription(item.description, kind)) {
                findings.push({
                    itemId: item.id,
                    category: kind === 'bug' ? 'Bug Missing Description' : 'Missing Or Weak Description',
                    dimension: 'description',
                    issue: item.description ? 'Description is too short or placeholder' : 'Description is missing',
                    severity: kind === 'story' || kind === 'bug' ? 'Medium' : 'Low',
                    reviewRecommended: !item.description ? false : true
                });
            }
        }

        if (open && !item.assignedTo && (isActive(item) || isHighPriority(item))) {
            findings.push({
                itemId: item.id,
                category: isHighPriority(item) ? 'Unassigned High Priority' : 'Unassigned Active Work',
                dimension: 'ownership',
                issue: item.assignedTo ? 'Unassigned' : 'No owner on active/high-priority work',
                severity: isHighPriority(item) ? 'High' : 'Medium'
            });
        } else if (open && !item.assignedTo && kind !== 'epic') {
            findings.push({
                itemId: item.id,
                category: 'Unassigned Open Work',
                dimension: 'ownership',
                issue: 'Open work has no assignee',
                severity: 'Low',
                reviewRecommended: true
            });
        }

        if (open && item.priority == null && (kind === 'story' || kind === 'bug' || kind === 'task')) {
            findings.push({
                itemId: item.id,
                category: 'Missing Priority',
                dimension: 'priority',
                issue: 'Priority is not set',
                severity: 'Low',
                reviewRecommended: true
            });
        }

        if (open && !item.areaPath) {
            findings.push({
                itemId: item.id,
                category: 'Missing Area Path',
                dimension: 'area',
                issue: 'Area Path is empty',
                severity: 'Medium'
            });
        }

        if (open && !item.iterationPath) {
            findings.push({
                itemId: item.id,
                category: 'Missing Iteration',
                dimension: 'sprint',
                issue: 'Iteration Path is empty',
                severity: 'Medium'
            });
        }

        if (kind === 'story') {
            if (open && ctx.fields.acceptanceCriteria && !item.acceptanceCriteria && isActive(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Story Missing Acceptance Criteria',
                    dimension: 'story',
                    issue: 'Active User Story / PBI has no acceptance criteria',
                    severity: 'Medium',
                    reviewRecommended: true
                });
            }
            if (open && ctx.fields.estimate && estimateOf(item) == null && !isProposed(item.stateCategory)) {
                findings.push({
                    itemId: item.id,
                    category: 'Missing Estimate',
                    dimension: 'estimate',
                    issue: 'Story/PBI has no story points or effort',
                    severity: 'Medium'
                });
            }
            const children = ctx.childrenOf.get(item.id) ?? [];
            const tasks = children.filter(c => c.type && typeKind(c.type) === 'task');
            const hasChildren = hasChildHierarchy(item, children);
            if (isComplete(item) && !hasChildren && tasks.length === 0) {
                findings.push({
                    itemId: item.id,
                    category: 'Closed Stories Without Tasks',
                    dimension: 'story',
                    issue: 'Completed User Story has no child Tasks',
                    severity: 'High'
                });
            } else if (isActive(item) && !hasChildren && tasks.length === 0) {
                findings.push({
                    itemId: item.id,
                    category: 'Active Stories Without Tasks',
                    dimension: 'story',
                    issue: 'Active User Story has no child Tasks (review whether implementation tracking is expected)',
                    severity: 'Medium',
                    reviewRecommended: true
                });
            }
            if (tasks.length > 15) {
                findings.push({
                    itemId: item.id,
                    category: 'Story With Excessive Tasks',
                    dimension: 'story',
                    issue: `${tasks.length} child Tasks — consider splitting the story`,
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
            const est = estimateOf(item);
            if (est != null && est >= 13) {
                findings.push({
                    itemId: item.id,
                    category: 'Suspiciously Large Story',
                    dimension: 'story',
                    issue: `Estimate ${est} may need decomposition`,
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
        }

        if ((kind === 'epic' || kind === 'feature') && open) {
            if (!item.assignedTo) {
                findings.push({
                    itemId: item.id,
                    category: kind === 'epic' ? 'Epic Without Owner' : 'Feature Without Owner',
                    dimension: 'ownership',
                    issue: `${item.type} has no owner`,
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
            if (ctx.fields.plannedEnd && !item.plannedEnd) {
                findings.push({
                    itemId: item.id,
                    category: 'Epic/Feature Missing Target Date',
                    dimension: 'dates',
                    issue: `${item.type} has no planned/target end`,
                    severity: 'Medium'
                });
            }
        }

        if (kind === 'task' && open) {
            if (ctx.fields.estimate && item.originalEstimate == null && item.remainingWork == null && isActive(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Task Missing Estimate',
                    dimension: 'estimate',
                    issue: 'Active task has no original estimate or remaining work',
                    severity: 'Medium'
                });
            }
            if (isActive(item) && ctx.fields.remainingWork && item.remainingWork === 0 && !isComplete(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Active Task With Zero Remaining Work',
                    dimension: 'estimate',
                    issue: 'Remaining work is 0 while the task is still active',
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
        }

        if (kind === 'bug' && open) {
            if (ctx.fields.severity && !item.severity && isActive(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Bug Missing Severity',
                    dimension: 'bug',
                    issue: 'Active bug has no severity',
                    severity: 'Medium'
                });
            }
            if (isHighSeverity(item) && !item.assignedTo) {
                findings.push({
                    itemId: item.id,
                    category: 'High Severity Bug Unassigned',
                    dimension: 'bug',
                    issue: 'High-severity bug has no owner',
                    severity: 'Critical'
                });
            }
            if (ctx.fields.description && !item.description && !item.reproSteps) {
                findings.push({
                    itemId: item.id,
                    category: 'Bug Missing Reproduction Context',
                    dimension: 'bug',
                    issue: 'Bug has neither description nor repro steps',
                    severity: 'Medium'
                });
            }
        }

        if (item.tags.length > 12) {
            findings.push({
                itemId: item.id,
                category: 'Excessive Tags',
                dimension: 'tags',
                issue: `${item.tags.length} tags`,
                severity: 'Low',
                reviewRecommended: true
            });
        }
        const lowerTags = item.tags.map(t => t.toLowerCase());
        if (new Set(lowerTags).size !== item.tags.length) {
            findings.push({
                itemId: item.id,
                category: 'Duplicate Tags',
                dimension: 'tags',
                issue: 'Item has duplicate tags',
                severity: 'Low'
            });
        }
        if (item.tags.some(t => /^(test|tmp|todo|tbd|xxx)$/i.test(t))) {
            findings.push({
                itemId: item.id,
                category: 'Placeholder Tags',
                dimension: 'tags',
                issue: 'Placeholder-looking tag',
                severity: 'Low',
                reviewRecommended: true
            });
        }
    }

    return findings;
}

function isProposed(category: string | null): boolean {
    return category === 'Proposed' || category == null;
}

function isHighSeverity(item: { severity: string | null }): boolean {
    const s = (item.severity ?? '').toLowerCase();
    return s.includes('1') || s.includes('critical') || s.includes('high');
}
