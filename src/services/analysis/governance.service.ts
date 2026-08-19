import { daysBetween, parseAdoDate } from '../../utils/dates.js';
import type { WorkItem } from '../azure-devops/types.js';
import { analyseBacklog } from './backlog/analyse.js';
import { hasChildHierarchy, isComplete, isOpen, typeKind } from './backlog/classify.js';
import type { FindingSeverity } from './backlog/types.js';

export type Severity = FindingSeverity | 'Normal';

export interface DataQualityIssue {
    kind: 'missing_date' | 'invalid_date' | 'structural' | 'stale';
    issue: string;
    severity: FindingSeverity;
    recommendation: string;
}

export interface HierarchyIssue {
    kind: 'orphan' | 'broken_link' | 'empty_parent';
    issue: string;
    severity: FindingSeverity;
}

export { analyseBacklog } from './backlog/analyse.js';
export { buildRelationMaps } from './backlog/analyse.js';

/** Single-item date/structure checks retained for existing callers. */
export function evaluateBacklogQuality(item: WorkItem, children: WorkItem[] = []): DataQualityIssue[] {
    const issues: DataQualityIssue[] = [];
    const complete = isComplete(item);
    const active = item.stateCategory === 'InProgress';

    if (!item.plannedStart) {
        issues.push({
            kind: 'missing_date',
            issue: 'Missing Planned Start Date',
            severity: 'Medium',
            recommendation: 'Define when this work should start.'
        });
    }
    if (!item.plannedEnd) {
        issues.push({
            kind: 'missing_date',
            issue: 'Missing Planned End Date',
            severity: 'Medium',
            recommendation: 'Define when this work is expected to finish.'
        });
    }

    if (active && !item.actualStart) {
        issues.push({
            kind: 'missing_date',
            issue: 'Active but missing Actual Start Date',
            severity: 'High',
            recommendation: 'Record when work actually started.'
        });
    }

    if (complete) {
        if (!item.actualStart) {
            issues.push({
                kind: 'missing_date',
                issue: 'Completed but missing Actual Start Date',
                severity: 'Medium',
                recommendation: 'Record when work actually started for accurate metrics.'
            });
        }
        if (!item.actualEnd) {
            issues.push({
                kind: 'missing_date',
                issue: 'Completed but missing Actual End Date',
                severity: 'High',
                recommendation: 'Record when work actually finished.'
            });
        }
    } else if (item.actualEnd) {
        issues.push({
            kind: 'invalid_date',
            issue: 'Not completed but has Actual End Date',
            severity: 'High',
            recommendation: 'Remove actual end date or close the item.'
        });
    }

    const pStart = parseAdoDate(item.plannedStart);
    const pEnd = parseAdoDate(item.plannedEnd);
    const aStart = parseAdoDate(item.actualStart);
    const aEnd = parseAdoDate(item.actualEnd);

    if (pStart && pEnd && pStart > pEnd) {
        issues.push({ kind: 'invalid_date', issue: 'Planned Start is after Planned End', severity: 'High', recommendation: 'Fix planned dates.' });
    }
    if (aStart && aEnd && aStart > aEnd) {
        issues.push({ kind: 'invalid_date', issue: 'Actual Start is after Actual End', severity: 'High', recommendation: 'Fix actual dates.' });
    }

    if (typeKind(item.type) === 'story') {
        const hasTasks =
            hasChildHierarchy(item, children) || children.some(c => c.type && typeKind(c.type) === 'task');
        if (complete && !hasTasks) {
            issues.push({
                kind: 'structural',
                issue: 'Completed User Story has no child Tasks',
                severity: 'High',
                recommendation: 'Review whether implementation work was properly captured.'
            });
        } else if (active && !hasTasks) {
            issues.push({
                kind: 'structural',
                issue: 'Active User Story has no Tasks',
                severity: 'Medium',
                recommendation: 'Ensure implementation tasks are created.'
            });
        }
    }

    return issues;
}

export function evaluateStaleWork(item: WorkItem, now: Date = new Date()): DataQualityIssue | null {
    if (!isOpen(item)) return null;
    if (item.state.toLowerCase().includes('waiting') || item.state.toLowerCase().includes('hold') || item.blockedField === 'Yes') {
        return null;
    }
    const changed = parseAdoDate(item.changedDate);
    if (!changed) return null;
    const days = daysBetween(changed, now);
    if (days >= 30) {
        return { kind: 'stale', issue: `No activity for ${days} days`, severity: 'Critical', recommendation: 'Review critically stale work item.' };
    }
    if (days >= 14) {
        return { kind: 'stale', issue: `No activity for ${days} days`, severity: 'High', recommendation: 'Review stale work item.' };
    }
    if (days >= 7) {
        return { kind: 'stale', issue: `No activity for ${days} days`, severity: 'Medium', recommendation: 'Check if work is stuck silently.' };
    }
    return null;
}

export function evaluateHierarchy(item: WorkItem, children: WorkItem[] = []): HierarchyIssue[] {
    const issues: HierarchyIssue[] = [];
    const kind = typeKind(item.type);

    if (!item.parentId) {
        if (kind === 'feature') issues.push({ kind: 'orphan', issue: 'Feature has no parent Epic', severity: 'Medium' });
        else if (kind === 'story') issues.push({ kind: 'orphan', issue: 'Story has no parent Feature', severity: 'Medium' });
        else if (kind === 'task') issues.push({ kind: 'orphan', issue: 'Task has no parent Story', severity: 'High' });
    }

    if (isOpen(item) && !hasChildHierarchy(item, children)) {
        if (kind === 'epic') issues.push({ kind: 'empty_parent', issue: 'Epic has no children', severity: 'Low' });
        else if (kind === 'feature') issues.push({ kind: 'empty_parent', issue: 'Feature has no children', severity: 'Medium' });
    }

    return issues;
}
