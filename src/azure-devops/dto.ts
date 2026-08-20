/**
 * Compact DTOs designed to be safely passed to the LLM.
 * These structures strip out nulls, undefined values, and heavy metadata
 * to minimize token consumption while retaining all necessary context.
 */

export interface CompactProject {
    id: string;
    name: string;
}

export interface CompactTeam {
    id: string;
    name: string;
}

export interface CompactTeamMember {
    id: string;
    displayName: string;
    email: string;
}

export interface CompactSprint {
    id: string;
    name: string;
    path: string;
    startDate?: string;
    finishDate?: string;
    timeFrame?: string;
}

export interface CompactWorkItemRelation {
    rel: string;
    targetId: number;
}

export interface CompactQuery {
    id: string;
    name: string;
    path: string;
    wiql?: string;
}

/**
 * A highly condensed work item containing only the requested fields.
 * Extraneous nulls and unused dates/paths are stripped.
 */
export type CompactWorkItem = {
    id: number;
    title: string;
    type: string;
    state: string;
    url?: string;
} & Record<string, any>; // Additional fields from profiles (e.g. storyPoints, assignedTo) are merged here.
