/**
 * Azure DevOps field reference names.
 *
 * Field availability depends on the project's process template, so the client
 * intersects this wish-list with the project's real field catalogue before using
 * it in a `fields=` projection or a WIQL clause. That avoids HTTP 400 responses
 * on projects that do not define, say, `Microsoft.VSTS.Scheduling.DueDate`.
 */
export const FIELD = {
    id: 'System.Id',
    workItemType: 'System.WorkItemType',
    title: 'System.Title',
    state: 'System.State',
    reason: 'System.Reason',
    assignedTo: 'System.AssignedTo',
    createdBy: 'System.CreatedBy',
    createdDate: 'System.CreatedDate',
    changedBy: 'System.ChangedBy',
    changedDate: 'System.ChangedDate',
    iterationPath: 'System.IterationPath',
    areaPath: 'System.AreaPath',
    teamProject: 'System.TeamProject',
    tags: 'System.Tags',
    parent: 'System.Parent',
    boardColumn: 'System.BoardColumn',
    boardColumnDone: 'System.BoardColumnDone',
    priority: 'Microsoft.VSTS.Common.Priority',
    severity: 'Microsoft.VSTS.Common.Severity',
    stateChangeDate: 'Microsoft.VSTS.Common.StateChangeDate',
    activatedDate: 'Microsoft.VSTS.Common.ActivatedDate',
    resolvedDate: 'Microsoft.VSTS.Common.ResolvedDate',
    closedDate: 'Microsoft.VSTS.Common.ClosedDate',
    valueArea: 'Microsoft.VSTS.Common.ValueArea',
    dueDate: 'Microsoft.VSTS.Scheduling.DueDate',
    startDate: 'Microsoft.VSTS.Scheduling.StartDate',
    targetDate: 'Microsoft.VSTS.Scheduling.TargetDate',
    finishDate: 'Microsoft.VSTS.Scheduling.FinishDate',
    storyPoints: 'Microsoft.VSTS.Scheduling.StoryPoints',
    effort: 'Microsoft.VSTS.Scheduling.Effort',
    originalEstimate: 'Microsoft.VSTS.Scheduling.OriginalEstimate',
    remainingWork: 'Microsoft.VSTS.Scheduling.RemainingWork',
    completedWork: 'Microsoft.VSTS.Scheduling.CompletedWork',
    blocked: 'Microsoft.VSTS.CMMI.Blocked'
} as const;

/** Fields requested for every work item read. Filtered against the real catalogue. */
export const DEFAULT_WORK_ITEM_FIELDS: string[] = Object.values(FIELD);

/**
 * Azure DevOps groups every state into one of these categories via the process
 * template. Category is what analysis should branch on, never the raw state name,
 * because K4K may rename states.
 */
export type StateCategory = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';

/** Work-item type names in the standard Agile/Scrum hierarchy, ordered top-down. */
export const HIERARCHY_ORDER = ['Epic', 'Feature', 'User Story', 'Product Backlog Item', 'Task', 'Bug'] as const;

/** Azure DevOps link type reference names used for hierarchy and dependency analysis. */
export const RELATION = {
    parent: 'System.LinkTypes.Hierarchy-Reverse',
    child: 'System.LinkTypes.Hierarchy-Forward',
    predecessor: 'System.LinkTypes.Dependency-Reverse',
    successor: 'System.LinkTypes.Dependency-Forward',
    related: 'System.LinkTypes.Related',
    duplicateOf: 'System.LinkTypes.Duplicate-Reverse',
    duplicate: 'System.LinkTypes.Duplicate-Forward',
    attachedFile: 'AttachedFile',
    hyperlink: 'Hyperlink',
    artifactLink: 'ArtifactLink'
} as const;

/** Human-readable label for a relation reference name. */
export function describeRelation(rel: string): string {
    switch (rel) {
        case RELATION.parent:
            return 'Parent';
        case RELATION.child:
            return 'Child';
        case RELATION.predecessor:
            return 'Predecessor (this item waits for it)';
        case RELATION.successor:
            return 'Successor (waits for this item)';
        case RELATION.related:
            return 'Related';
        case RELATION.duplicateOf:
            return 'Duplicate of';
        case RELATION.duplicate:
            return 'Has duplicate';
        case RELATION.attachedFile:
            return 'Attachment';
        case RELATION.hyperlink:
            return 'Hyperlink';
        case RELATION.artifactLink:
            return 'Artifact link';
        default:
            return rel;
    }
}
