import type { WorkItem } from '../../../azure-devops/types.js';

export type FindingSeverity = 'Critical' | 'High' | 'Medium' | 'Low';

export interface Finding {
    itemId: number;
    category: string;
    issue: string;
    severity: FindingSeverity;
    reviewRecommended?: boolean;
    dimension: string;
}

export interface BacklogContext {
    items: WorkItem[];
    byId: Map<number, WorkItem>;
    childrenOf: Map<number, WorkItem[]>;
    parentOf: Map<number, WorkItem | undefined>;
    teamMemberNames: Set<string>;
    teamAreaHints: string[];
    currentSprintPath: string | null;
    currentSprintStart: Date | null;
    currentSprintEnd: Date | null;
    now: Date;
    truncated: boolean;
    scannedLimit: number;
    fields: {
        plannedStart: boolean;
        plannedEnd: boolean;
        actualStart: boolean;
        actualEnd: boolean;
        description: boolean;
        acceptanceCriteria: boolean;
        estimate: boolean;
        remainingWork: boolean;
        severity: boolean;
        risk: boolean;
    };
    workItemTypes: string[];
}

export interface CategoryResult {
    category: string;
    dimension: string;
    count: number;
    severity: FindingSeverity;
    reviewRecommended: boolean;
    description: string;
    queryName: string;
    queryDescription: string;
    createQuery: boolean;
    itemIds: number[];
    samples: { id: number; title: string; state: string; assignedTo: string | null; webUrl: string | null }[];
}

export const DEFAULT_COLUMNS = [
    'System.Id',
    'System.Title',
    'System.WorkItemType',
    'System.State',
    'System.AssignedTo',
    'Microsoft.VSTS.Common.Priority',
    'System.AreaPath',
    'System.IterationPath',
    'System.Tags',
    'System.CreatedDate',
    'System.ChangedDate',
    'System.Parent'
];
