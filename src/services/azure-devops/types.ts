/** Raw shapes returned by the Azure DevOps REST API (only the parts we consume). */

export interface AdoListResponse<T> {
    count: number;
    value: T[];
}

export interface AdoIdentityRef {
    id?: string;
    displayName?: string;
    uniqueName?: string;
    mailAddress?: string;
    descriptor?: string;
    imageUrl?: string;
}

export interface AdoProject {
    id: string;
    name: string;
    description?: string;
    url?: string;
    state?: string;
    revision?: number;
    visibility?: string;
    lastUpdateTime?: string;
    defaultTeam?: { id: string; name: string };
    capabilities?: {
        processTemplate?: { templateName?: string; templateTypeId?: string };
        versioncontrol?: { sourceControlType?: string };
    };
}

export interface AdoTeam {
    id: string;
    name: string;
    description?: string;
    url?: string;
    identityUrl?: string;
    projectId?: string;
    projectName?: string;
}

export interface AdoTeamMember {
    isTeamAdmin?: boolean;
    identity: AdoIdentityRef;
}

export interface AdoIterationAttributes {
    startDate?: string | null;
    finishDate?: string | null;
    timeFrame?: 'past' | 'current' | 'future' | string;
}

export interface AdoIteration {
    id: string;
    name: string;
    path: string;
    attributes?: AdoIterationAttributes;
    url?: string;
}

export interface AdoTeamSettings {
    backlogIteration?: { id?: string; name?: string; path?: string };
    defaultIteration?: { id?: string; name?: string; path?: string };
    bugsBehavior?: string;
    workingDays?: string[];
    backlogVisibilities?: Record<string, boolean>;
}

export interface AdoTeamFieldValues {
    field?: { referenceName?: string };
    defaultValue?: string;
    values?: { value: string; includeChildren: boolean }[];
}

export interface AdoIterationCapacity {
    teamMember: AdoIdentityRef;
    activities?: { capacityPerDay?: number; name?: string }[];
    daysOff?: { start: string; end: string }[];
}

export interface AdoIterationWorkItems {
    workItemRelations?: {
        rel: string | null;
        source: { id: number; url?: string } | null;
        target: { id: number; url?: string };
    }[];
    url?: string;
}

export interface AdoWorkItemRelation {
    rel: string;
    url: string;
    attributes?: { name?: string; comment?: string; isLocked?: boolean };
}

export interface AdoWorkItem {
    id: number;
    rev?: number;
    fields: Record<string, unknown>;
    relations?: AdoWorkItemRelation[];
    url?: string;
    _links?: Record<string, { href?: string }>;
}

export interface AdoWiqlResult {
    queryType?: string;
    queryResultType?: 'workItem' | 'workItemLink' | string;
    asOf?: string;
    columns?: { referenceName: string; name: string; url?: string }[];
    workItems?: { id: number; url?: string }[];
    workItemRelations?: {
        rel: string | null;
        source: { id: number } | null;
        target: { id: number } | null;
    }[];
}

export interface AdoWorkItemFieldUpdate {
    oldValue?: unknown;
    newValue?: unknown;
}

export interface AdoWorkItemUpdate {
    id: number;
    workItemId: number;
    rev: number;
    revisedDate?: string;
    revisedBy?: AdoIdentityRef;
    fields?: Record<string, AdoWorkItemFieldUpdate>;
    relations?: {
        added?: AdoWorkItemRelation[];
        removed?: AdoWorkItemRelation[];
        updated?: AdoWorkItemRelation[];
    };
}

export interface AdoComment {
    id: number;
    workItemId?: number;
    text?: string;
    createdBy?: AdoIdentityRef;
    createdDate?: string;
    modifiedDate?: string;
    version?: number;
}

export interface AdoCommentList {
    totalCount?: number;
    count?: number;
    comments: AdoComment[];
}

export interface AdoClassificationNode {
    id: number;
    identifier?: string;
    name: string;
    path?: string;
    structureType?: string;
    hasChildren?: boolean;
    children?: AdoClassificationNode[];
    attributes?: { startDate?: string; finishDate?: string };
}

export interface AdoBacklogLevel {
    id: string;
    name: string;
    rank?: number;
    workItemTypes?: { name: string }[];
    type?: string;
}

export interface AdoWorkItemType {
    name: string;
    referenceName?: string;
    description?: string;
    color?: string;
    icon?: { id?: string; url?: string };
    isDisabled?: boolean;
    states?: { name: string; color?: string; category?: string }[];
}

export interface AdoField {
    referenceName: string;
    name: string;
    type?: string;
    readOnly?: boolean;
    usage?: string;
    isIdentity?: boolean;
    isQueryable?: boolean;
}

/** Normalised, analysis-friendly view of a work item. */
export interface WorkItem {
    id: number;
    rev: number;
    type: string;
    title: string;
    state: string;
    stateCategory: string | null;
    reason: string | null;
    assignedTo: string | null;
    assignedToEmail: string | null;
    createdBy: string | null;
    createdDate: string | null;
    changedBy: string | null;
    changedDate: string | null;
    closedDate: string | null;
    activatedDate: string | null;
    resolvedDate: string | null;
    stateChangeDate: string | null;
    startDate: string | null;
    dueDate: string | null;
    targetDate: string | null;
    iterationPath: string | null;
    areaPath: string | null;
    priority: number | null;
    severity: string | null;
    tags: string[];
    storyPoints: number | null;
    effort: number | null;
    originalEstimate: number | null;
    remainingWork: number | null;
    completedWork: number | null;
    parentId: number | null;
    blockedField: string | null;
    url: string | null;
    /** Browser URL for the work item, useful in reports and emails. */
    webUrl: string | null;
    relations: AdoWorkItemRelation[];
}
