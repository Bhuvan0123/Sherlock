import { AppError } from '../../utils/errors.js';
import { FIELD } from './fields.js';
import { buildWorkItemQuery, wiql, type WiqlCondition } from './wiql.js';

export type QueryPreset =
    | 'overdue'
    | 'dueSoon'
    | 'active'
    | 'completed'
    | 'unassigned'
    | 'stale'
    | 'highPriority'
    | 'currentSprint'
    | 'currentIteration'
    | 'recentlyChanged'
    | 'missingDates'
    | 'missingEstimate'
    | 'teamMemberWork'
    | 'backlog'
    | 'bugs'
    | 'epics'
    | 'features'
    | 'userStories'
    | 'tasks';

export interface StructuredQuery {
    project?: string;
    team?: string;
    preset?: QueryPreset;
    
    workItemTypes?: string[];
    states?: string[];
    assignedTo?: string[];
    iteration?: string;
    areaPath?: string;
    priority?: number[];
    tags?: string[];
    
    createdAfter?: string;
    createdBefore?: string;
    changedAfter?: string;
    changedBefore?: string;
    plannedStartAfter?: string;
    plannedStartBefore?: string;
    plannedEndAfter?: string;
    plannedEndBefore?: string;
    actualStartAfter?: string;
    actualStartBefore?: string;
    actualEndAfter?: string;
    actualEndBefore?: string;
    
    plannedStartMissing?: boolean;
    plannedEndMissing?: boolean;
    actualStartMissing?: boolean;
    actualEndMissing?: boolean;
    assignedToMissing?: boolean;
    estimateMissing?: boolean;
    
    orderBy?: string;
    orderDirection?: 'asc' | 'desc';
    limit?: number;
}

export class WiqlBuilderService {
    /**
     * Builds a safe WIQL query string from a structured filter object.
     * `teamScopeCondition` should be resolved from `WorkItemService.getTeamScopeCondition()`
     * if team scoping is required and applicable.
     */
    buildQuery(query: StructuredQuery, teamScopeCondition?: WiqlCondition | null): string {
        const conditions: (WiqlCondition | null | undefined)[] = [];

        // 1. Apply Preset
        if (query.preset) {
            conditions.push(...this.getPresetConditions(query.preset));
        }

        // 2. Base Filters
        if (query.workItemTypes && query.workItemTypes.length > 0) {
            conditions.push(wiql.inList(FIELD.workItemType, query.workItemTypes));
        }
        if (query.states && query.states.length > 0) {
            conditions.push(wiql.inList(FIELD.state, query.states));
        }
        if (query.assignedTo && query.assignedTo.length > 0) {
            // Some assignedTo queries might be generic "Unassigned" vs actual users.
            conditions.push(wiql.inList(FIELD.assignedTo, query.assignedTo));
        }
        if (query.iteration) {
            conditions.push(wiql.under(FIELD.iterationPath, query.iteration));
        }
        if (query.areaPath) {
            conditions.push(wiql.under(FIELD.areaPath, query.areaPath));
        }
        if (query.priority && query.priority.length > 0) {
            conditions.push(wiql.inList(FIELD.priority, query.priority));
        }
        if (query.tags && query.tags.length > 0) {
            const tagConditions = query.tags.map(tag => wiql.contains(FIELD.tags, tag));
            conditions.push(wiql.and(...tagConditions)); // Assuming AND logic for multiple tags
        }

        // 3. Date Filters
        if (query.createdAfter) conditions.push(wiql.gte(FIELD.createdDate, query.createdAfter));
        if (query.createdBefore) conditions.push(wiql.lte(FIELD.createdDate, query.createdBefore));
        if (query.changedAfter) conditions.push(wiql.gte(FIELD.changedDate, query.changedAfter));
        if (query.changedBefore) conditions.push(wiql.lte(FIELD.changedDate, query.changedBefore));
        if (query.plannedStartAfter) conditions.push(wiql.gte(FIELD.startDate, query.plannedStartAfter));
        if (query.plannedStartBefore) conditions.push(wiql.lte(FIELD.startDate, query.plannedStartBefore));
        if (query.plannedEndAfter) conditions.push(wiql.gte(FIELD.targetDate, query.plannedEndAfter));
        if (query.plannedEndBefore) conditions.push(wiql.lte(FIELD.targetDate, query.plannedEndBefore));
        
        // Actual dates might map to start/finish date fields
        if (query.actualStartAfter) conditions.push(wiql.gte(FIELD.startDate, query.actualStartAfter));
        if (query.actualStartBefore) conditions.push(wiql.lte(FIELD.startDate, query.actualStartBefore));
        if (query.actualEndAfter) conditions.push(wiql.gte(FIELD.finishDate, query.actualEndAfter));
        if (query.actualEndBefore) conditions.push(wiql.lte(FIELD.finishDate, query.actualEndBefore));

        // 4. Missing Field Filters
        if (query.plannedStartMissing) conditions.push(wiql.isEmpty(FIELD.startDate));
        if (query.plannedEndMissing) conditions.push(wiql.isEmpty(FIELD.targetDate));
        // Fallbacks for finishDate
        if (query.actualStartMissing) conditions.push(wiql.isEmpty(FIELD.startDate));
        if (query.actualEndMissing) conditions.push(wiql.isEmpty(FIELD.finishDate));
        if (query.assignedToMissing) conditions.push(wiql.isEmpty(FIELD.assignedTo));
        if (query.estimateMissing) conditions.push(wiql.isEmpty(FIELD.originalEstimate));

        // 5. Team Scope
        if (teamScopeCondition) {
            conditions.push(wiql.group(teamScopeCondition));
        }

        // Validate we have at least one condition to prevent querying the entire ADO instance
        if (conditions.filter(c => !!c).length === 0) {
            throw new AppError('INVALID_INPUT', 'Query must contain at least one filter or preset.');
        }

        // 6. Ordering
        const orderBy = query.orderBy 
            ? [{ field: this.mapOrderByField(query.orderBy), direction: query.orderDirection ?? 'desc' }]
            : [{ field: FIELD.changedDate, direction: 'desc' as const }];

        return buildWorkItemQuery({
            conditions,
            orderBy
        });
    }

    private getPresetConditions(preset: QueryPreset): WiqlCondition[] {
        switch (preset) {
            case 'overdue':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed', 'Resolved']),
                    wiql.isNotEmpty(FIELD.targetDate),
                    wiql.lt(FIELD.targetDate, '@Today')
                ];
            case 'dueSoon':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed', 'Resolved']),
                    wiql.isNotEmpty(FIELD.targetDate),
                    wiql.todayOffset(FIELD.targetDate, '<=', 7)
                ];
            case 'active':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed', 'New', 'Proposed'])
                ];
            case 'completed':
                return [
                    wiql.inList(FIELD.state, ['Closed', 'Done', 'Resolved'])
                ];
            case 'unassigned':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed']),
                    wiql.isEmpty(FIELD.assignedTo)
                ];
            case 'stale':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed']),
                    wiql.todayOffset(FIELD.changedDate, '<=', -14)
                ];
            case 'highPriority':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed']),
                    wiql.inList(FIELD.priority, [1, 2])
                ];
            case 'currentSprint':
            case 'currentIteration':
                return [
                    wiql.macro(FIELD.iterationPath, '=', '@CurrentIteration')
                ];
            case 'recentlyChanged':
                return [
                    wiql.todayOffset(FIELD.changedDate, '>=', -7)
                ];
            case 'missingDates':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed']),
                    wiql.or(wiql.isEmpty(FIELD.startDate), wiql.isEmpty(FIELD.targetDate))
                ];
            case 'missingEstimate':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed']),
                    wiql.inList(FIELD.workItemType, ['User Story', 'Task', 'Feature']),
                    wiql.isEmpty(FIELD.originalEstimate)
                ];
            case 'teamMemberWork':
                return [
                    wiql.notInList(FIELD.state, ['Closed', 'Done', 'Removed'])
                ];
            case 'backlog':
                return [
                    wiql.inList(FIELD.state, ['New', 'Proposed', 'Active']),
                    wiql.notInList(FIELD.workItemType, ['Task'])
                ];
            case 'bugs':
                return [wiql.eq(FIELD.workItemType, 'Bug')];
            case 'epics':
                return [wiql.eq(FIELD.workItemType, 'Epic')];
            case 'features':
                return [wiql.eq(FIELD.workItemType, 'Feature')];
            case 'userStories':
                return [wiql.eq(FIELD.workItemType, 'User Story')];
            case 'tasks':
                return [wiql.eq(FIELD.workItemType, 'Task')];
            default:
                throw new AppError('INVALID_INPUT', `Unknown query preset: ${preset}`);
        }
    }

    private mapOrderByField(field: string): string {
        const mapping: Record<string, string> = {
            'ChangedDate': FIELD.changedDate,
            'CreatedDate': FIELD.createdDate,
            'Priority': FIELD.priority,
            'Id': 'System.Id',
            'State': FIELD.state
        };
        return mapping[field] ?? field;
    }
}
