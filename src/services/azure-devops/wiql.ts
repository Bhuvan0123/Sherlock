import { escapeWiqlLiteral } from '../../security/read-only-policy.js';
import { FIELD } from './fields.js';

/**
 * Typed WIQL builder.
 *
 * Every literal goes through `escapeWiqlLiteral`, and callers can only assemble
 * SELECT queries - there is no code path here that can emit a mutation. The
 * finished query is validated again by the read-only policy inside the client.
 */

export type WiqlCondition = string;

function bracket(field: string): string {
    // Field reference names are internal constants or validated against the
    // project field catalogue, never free-form model input.
    if (!/^[A-Za-z0-9_.]+$/.test(field)) {
        throw new Error(`Refusing to build WIQL with an unsafe field name: ${field}`);
    }
    return `[${field}]`;
}

function literal(value: string | number | boolean): string {
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return `'${escapeWiqlLiteral(value)}'`;
}

export const wiql = {
    eq: (field: string, value: string | number | boolean): WiqlCondition => `${bracket(field)} = ${literal(value)}`,
    ne: (field: string, value: string | number | boolean): WiqlCondition => `${bracket(field)} <> ${literal(value)}`,
    gt: (field: string, value: string | number): WiqlCondition => `${bracket(field)} > ${literal(value)}`,
    gte: (field: string, value: string | number): WiqlCondition => `${bracket(field)} >= ${literal(value)}`,
    lt: (field: string, value: string | number): WiqlCondition => `${bracket(field)} < ${literal(value)}`,
    lte: (field: string, value: string | number): WiqlCondition => `${bracket(field)} <= ${literal(value)}`,
    contains: (field: string, value: string): WiqlCondition => `${bracket(field)} CONTAINS ${literal(value)}`,
    containsWords: (field: string, value: string): WiqlCondition =>
        `${bracket(field)} CONTAINS WORDS ${literal(value)}`,
    under: (field: string, value: string): WiqlCondition => `${bracket(field)} UNDER ${literal(value)}`,
    /** `EVER` asks whether a field ever held a value; it reads revision history, not the current value. */
    ever: (field: string, value: string): WiqlCondition => `${bracket(field)} EVER ${literal(value)}`,
    inList: (field: string, values: (string | number)[]): WiqlCondition =>
        `${bracket(field)} IN (${values.map(literal).join(', ')})`,
    notInList: (field: string, values: (string | number)[]): WiqlCondition =>
        `${bracket(field)} NOT IN (${values.map(literal).join(', ')})`,
    isEmpty: (field: string): WiqlCondition => `${bracket(field)} = ''`,
    isNotEmpty: (field: string): WiqlCondition => `${bracket(field)} <> ''`,
    /** `@Me`, `@Today`, `@CurrentIteration` and friends are WIQL macros, not literals. */
    macro: (field: string, operator: string, macro: string): WiqlCondition =>
        `${bracket(field)} ${operator} ${macro}`,
    /** Relative day macro, for example `[DueDate] <= @Today + 7`. */
    todayOffset: (field: string, operator: '<' | '<=' | '=' | '>' | '>=', days: number): WiqlCondition => {
        const offset = days === 0 ? '' : days > 0 ? ` + ${Math.trunc(days)}` : ` - ${Math.abs(Math.trunc(days))}`;
        return `${bracket(field)} ${operator} @Today${offset}`;
    },
    and: (...conditions: (WiqlCondition | null | undefined)[]): WiqlCondition =>
        conditions.filter((condition): condition is string => Boolean(condition)).join(' AND '),
    or: (...conditions: (WiqlCondition | null | undefined)[]): WiqlCondition =>
        conditions.filter((condition): condition is string => Boolean(condition)).join(' OR '),
    group: (condition: WiqlCondition): WiqlCondition => `(${condition})`
};

export interface WorkItemQueryOptions {
    /** Conditions ANDed into the WHERE clause. */
    conditions: (WiqlCondition | null | undefined)[];
    orderBy?: { field: string; direction?: 'asc' | 'desc' }[];
}

/** Builds `SELECT [System.Id] FROM WorkItems WHERE ... ORDER BY ...`. */
export function buildWorkItemQuery(options: WorkItemQueryOptions): string {
    const conditions = options.conditions.filter((condition): condition is string => Boolean(condition?.trim()));
    const where = conditions.length > 0 ? ` WHERE ${conditions.map(condition => `(${condition})`).join(' AND ')}` : '';
    const orderBy =
        options.orderBy && options.orderBy.length > 0
            ? ` ORDER BY ${options.orderBy
                  .map(entry => `${bracket(entry.field)} ${(entry.direction ?? 'asc').toUpperCase()}`)
                  .join(', ')}`
            : ` ORDER BY ${bracket(FIELD.changedDate)} DESC`;

    // Only [System.Id] is selected: full field values come from the batched GET,
    // which keeps the WIQL payload small and the projection consistent.
    return `SELECT [System.Id] FROM WorkItems${where}${orderBy}`;
}

/**
 * Builds a hierarchical link query. Used to walk Epic -> Feature -> Story -> Task
 * trees through real Azure DevOps hierarchy links.
 */
export function buildHierarchyQuery(rootId: number, direction: 'forward' | 'reverse' = 'forward'): string {
    const linkType = direction === 'forward' ? 'System.LinkTypes.Hierarchy-Forward' : 'System.LinkTypes.Hierarchy-Reverse';
    return [
        'SELECT [System.Id] FROM WorkItemLinks',
        `WHERE ([Source].[System.Id] = ${Math.trunc(rootId)})`,
        `AND ([System.Links.LinkType] = '${escapeWiqlLiteral(linkType)}')`,
        'MODE (Recursive)'
    ].join(' ');
}
