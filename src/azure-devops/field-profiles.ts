import { FIELD } from './fields.js';

/**
 * Minimal set of fields for identifying a work item and its current state.
 * Used for high-level lists and counts where detailed planning data is not needed.
 */
export const MINIMAL_WORK_ITEM_FIELDS: string[] = [
    FIELD.id,
    FIELD.title,
    FIELD.workItemType,
    FIELD.state,
    FIELD.assignedTo,
    FIELD.tags,
    FIELD.teamProject
];

/**
 * Extended set of fields for planning, workload, and deadline analysis.
 * Includes estimates, priorities, and dates.
 */
export const PLANNING_WORK_ITEM_FIELDS: string[] = [
    FIELD.id,
    FIELD.title,
    FIELD.workItemType,
    FIELD.state,
    FIELD.assignedTo,
    FIELD.priority,
    FIELD.severity,
    FIELD.effort,
    FIELD.storyPoints,
    FIELD.remainingWork,
    FIELD.completedWork,
    FIELD.dueDate,
    FIELD.startDate,
    FIELD.targetDate,
    FIELD.finishDate,
    FIELD.areaPath,
    FIELD.iterationPath,
    FIELD.tags,
    FIELD.blocked,
    FIELD.teamProject
];

/**
 * Fields specifically needed for traversing and checking hierarchy health.
 */
export const HIERARCHY_WORK_ITEM_FIELDS: string[] = [
    FIELD.id,
    FIELD.title,
    FIELD.workItemType,
    FIELD.state,
    FIELD.parent,
    FIELD.assignedTo,
    FIELD.teamProject
];

/**
 * Fields specifically needed for workload and capacity analysis.
 */
export const WORKLOAD_WORK_ITEM_FIELDS: string[] = [
    FIELD.id,
    FIELD.title,
    FIELD.workItemType,
    FIELD.state,
    FIELD.assignedTo,
    FIELD.iterationPath,
    FIELD.effort,
    FIELD.storyPoints,
    FIELD.remainingWork,
    FIELD.completedWork,
    FIELD.teamProject
];

/**
 * Fields specifically needed for deadline and date-variance analysis.
 */
export const DEADLINE_WORK_ITEM_FIELDS: string[] = [
    FIELD.id,
    FIELD.title,
    FIELD.workItemType,
    FIELD.state,
    FIELD.dueDate,
    FIELD.startDate,
    FIELD.targetDate,
    FIELD.finishDate,
    FIELD.assignedTo,
    FIELD.teamProject
];

/**
 * Fields specifically needed for dependency and blocker analysis.
 */
export const DEPENDENCY_WORK_ITEM_FIELDS: string[] = [
    FIELD.id,
    FIELD.title,
    FIELD.workItemType,
    FIELD.state,
    FIELD.parent,
    FIELD.blocked,
    FIELD.assignedTo,
    FIELD.teamProject
];
