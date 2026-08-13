import { getConfig } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { getAdoClient, type AzureDevOpsReadClient } from './client.js';
import { getProjectContext, type ProjectContextService } from './context.js';
import type { AdoTeam } from './types.js';

export interface TeamMember {
    id: string | null;
    displayName: string;
    uniqueName: string | null;
    email: string | null;
    isTeamAdmin: boolean;
}

export interface TeamSummary {
    id: string;
    name: string;
    description: string | null;
    /** Present only when membership was requested; enumerating it costs one call per team. */
    memberCount?: number;
}

/** Read-only access to project teams and their membership. */
export class TeamService {
    constructor(
        private readonly client: AzureDevOpsReadClient = getAdoClient(),
        private readonly context: ProjectContextService = getProjectContext()
    ) {}

    private get project(): string {
        return getConfig().ado.project;
    }

    async getAllTeams(): Promise<TeamSummary[]> {
        const teams = await this.context.getTeams();
        return teams.map(team => ({
            id: team.id,
            name: team.name,
            description: team.description ?? null
        }));
    }

    async getAllTeamsWithMemberCounts(): Promise<TeamSummary[]> {
        const teams = await this.context.getTeams();
        return await Promise.all(
            teams.map(async team => ({
                id: team.id,
                name: team.name,
                description: team.description ?? null,
                memberCount: (await this.getMembers(team.name).catch(() => [])).length
            }))
        );
    }

    /** The configured team (default `Platform`), resolved dynamically by name. */
    async getConfiguredTeam(): Promise<AdoTeam> {
        return await this.context.getTeam();
    }

    async getMembers(teamName?: string): Promise<TeamMember[]> {
        const project = await this.context.getProject();
        const team = await this.context.getTeam(teamName);
        const cacheKey = `ctx:members:${team.id}`;
        return await this.context.cache.getOrLoad(cacheKey, async () => {
            const raw = await this.client.getTeamMembers(project.id, team.id);
            return raw
                .map(entry => {
                    const identity = entry.identity ?? {};
                    const email = identity.mailAddress ?? (identity.uniqueName?.includes('@') ? identity.uniqueName : null);
                    return {
                        id: identity.id ?? null,
                        displayName: identity.displayName ?? identity.uniqueName ?? '(unknown)',
                        uniqueName: identity.uniqueName ?? null,
                        email: email ?? null,
                        isTeamAdmin: entry.isTeamAdmin ?? false
                    } satisfies TeamMember;
                })
                .sort((a, b) => a.displayName.localeCompare(b.displayName));
        });
    }

    /** Every distinct member across every team in the project. */
    async getProjectMembers(): Promise<(TeamMember & { teams: string[] })[]> {
        const teams = await this.context.getTeams();
        const byKey = new Map<string, TeamMember & { teams: string[] }>();

        for (const team of teams) {
            const members = await this.getMembers(team.name).catch(() => []);
            for (const member of members) {
                const key = (member.id ?? member.email ?? member.displayName).toLowerCase();
                const existing = byKey.get(key);
                if (existing) {
                    if (!existing.teams.includes(team.name)) existing.teams.push(team.name);
                } else {
                    byKey.set(key, { ...member, teams: [team.name] });
                }
            }
        }
        return [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    /**
     * Resolves a loose member reference ("Arun", "arun.k@…", a display name) to a
     * real team member. Ambiguity is reported rather than guessed, so analysis is
     * never attributed to the wrong person.
     */
    async resolveMember(query: string, teamName?: string): Promise<TeamMember> {
        const trimmed = query.trim();
        if (trimmed.length === 0) {
            throw new AppError('INVALID_INPUT', 'A team member name or email is required.');
        }
        const members = await this.getMembers(teamName);
        if (members.length === 0) {
            throw new AppError('NOT_FOUND', 'No team members are visible for the configured team.', {
                hint: 'The PAT needs Identity (Read) and Project and Team (Read) scopes to enumerate team membership.'
            });
        }

        const lower = trimmed.toLowerCase();
        const exact = members.filter(
            member =>
                member.displayName.toLowerCase() === lower ||
                member.email?.toLowerCase() === lower ||
                member.uniqueName?.toLowerCase() === lower
        );
        if (exact.length === 1 && exact[0]) return exact[0];

        const partial = members.filter(
            member =>
                member.displayName.toLowerCase().includes(lower) ||
                (member.email?.toLowerCase().includes(lower) ?? false) ||
                (member.uniqueName?.toLowerCase().includes(lower) ?? false)
        );
        if (partial.length === 1 && partial[0]) return partial[0];

        if (partial.length > 1) {
            throw new AppError('INVALID_INPUT', `"${trimmed}" matches ${partial.length} team members.`, {
                hint: `Be more specific. Matches: ${partial.map(member => member.displayName).join(', ')}.`
            });
        }

        throw new AppError('NOT_FOUND', `"${trimmed}" does not match any member of the configured team.`, {
            hint: `Known members: ${members.map(member => member.displayName).join(', ')}.`
        });
    }

    /** Team email addresses, for the email drafting tools. */
    async getMemberEmails(teamName?: string): Promise<{ displayName: string; email: string | null }[]> {
        const members = await this.getMembers(teamName);
        return members.map(member => ({ displayName: member.displayName, email: member.email }));
    }

    /** Area paths the team owns, plus its default and backlog iteration. */
    async getTeamConfiguration(teamName?: string): Promise<{
        team: { id: string; name: string; description: string | null };
        areaPaths: { path: string; includeChildren: boolean }[];
        defaultAreaPath: string | null;
        defaultIteration: string | null;
        backlogIteration: string | null;
        workingDays: string[];
        bugsBehavior: string | null;
    }> {
        const team = await this.context.getTeam(teamName);
        const [settings, fieldValues] = await Promise.all([
            this.client.getTeamSettings(this.project, team.name).catch(() => null),
            this.client.getTeamFieldValues(this.project, team.name).catch(() => null)
        ]);

        return {
            team: { id: team.id, name: team.name, description: team.description ?? null },
            areaPaths: (fieldValues?.values ?? []).map(value => ({
                path: value.value,
                includeChildren: value.includeChildren
            })),
            defaultAreaPath: fieldValues?.defaultValue ?? null,
            defaultIteration: settings?.defaultIteration?.path ?? null,
            backlogIteration: settings?.backlogIteration?.path ?? null,
            workingDays: settings?.workingDays ?? [],
            bugsBehavior: settings?.bugsBehavior ?? null
        };
    }
}

let sharedTeamService: TeamService | null = null;

export function getTeamService(): TeamService {
    sharedTeamService ??= new TeamService();
    return sharedTeamService;
}

export function setTeamServiceForTesting(service: TeamService | null): void {
    sharedTeamService = service;
}
