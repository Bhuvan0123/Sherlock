import { parseAdoDate, startOfDay } from '../../utils/dates.js';
import { describeRelation, RELATION } from '../azure-devops/fields.js';
import { getSprintService, type SprintService } from '../azure-devops/sprint.service.js';
import { getTeamService, type TeamService } from '../azure-devops/team.service.js';
import {
    getWorkItemService,
    relationTargetId,
    type BlockedWorkItem,
    type WorkItemService
} from '../azure-devops/work-item.service.js';
import type { WorkItem } from '../azure-devops/types.js';
import { buildEnvelope, toItemRef, type AnalysisEnvelope, type ItemRef } from './types.js';

export interface DependencyEdge {
    from: ItemRef;
    to: ItemRef;
    relation: string;
    relationLabel: string;
    /** True when `to` is not yet complete, meaning the dependency is still live. */
    unresolved: boolean;
}

export interface DependencyChain {
    length: number;
    items: ItemRef[];
    unresolvedCount: number;
}

/**
 * Dependency analysis built exclusively from real Azure DevOps relation links
 * (`System.LinkTypes.Dependency-*`, `Related`, hierarchy). No dependency is ever
 * inferred from titles, tags or text.
 */
export class DependencyService {
    constructor(
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly teams: TeamService = getTeamService(),
        private readonly sprints: SprintService = getSprintService()
    ) {}

    async findBlockedItems(limit = 300): Promise<
        AnalysisEnvelope<{
            count: number;
            items: { item: ItemRef; signals: { kind: string; evidence: string }[]; daysInState: number | null }[];
        }>
    > {
        const blocked = await this.workItems.blocked({ limit });
        const now = startOfDay();

        const items = blocked.map((item: BlockedWorkItem) => {
            const since = parseAdoDate(item.stateChangeDate ?? item.changedDate);
            return {
                item: toItemRef(item),
                signals: item.blockedSignals.map(signal => ({ kind: signal.kind, evidence: signal.evidence })),
                daysInState: since ? Math.max(0, Math.round((now.getTime() - startOfDay(since).getTime()) / 86_400_000)) : null
            };
        });

        const stale = items.filter(entry => (entry.daysInState ?? 0) >= 5);
        const concerns: string[] = [];
        if (items.length > 0) concerns.push(`${items.length} item(s) are currently blocked.`);
        if (stale.length > 0) {
            concerns.push(`${stale.length} blocked item(s) have not changed state for 5 or more days.`);
        }

        return buildEnvelope(
            'blocked_items',
            { count: items.length, items },
            {
                observations: [
                    items.length === 0
                        ? 'No blocked work items were detected from state, tags, the Blocked field or unfinished predecessor links.'
                        : `${items.length} blocked item(s) detected, each with the evidence that flagged it.`
                ],
                concerns,
                recommendations: items
                    .slice(0, 8)
                    .map(entry => `Review blocked ${entry.item.type} #${entry.item.id} "${entry.item.title}": ${entry.signals[0]?.evidence ?? 'blocked'}.`),
                methodology: [
                    'Blocked detection uses four evidence sources: state name (Blocked/On Hold/Waiting/Impeded/Paused), tags matching blocked/blocker/impediment/on-hold/waiting/dependency, the Microsoft.VSTS.CMMI.Blocked field = Yes, and a Predecessor link whose target is not yet complete.',
                    'Days in state is measured from Microsoft.VSTS.Common.StateChangeDate, falling back to System.ChangedDate.'
                ]
            }
        );
    }

    /** All dependency edges among the team's open work. */
    async findDependencies(limit = 400): Promise<
        AnalysisEnvelope<{ edgeCount: number; unresolvedCount: number; edges: DependencyEdge[] }>
    > {
        const { edges } = await this.collectEdges(limit);
        const unresolved = edges.filter(edge => edge.unresolved);

        return buildEnvelope(
            'dependencies',
            { edgeCount: edges.length, unresolvedCount: unresolved.length, edges },
            {
                observations: [
                    `${edges.length} dependency link(s) found across the team's open work; ${unresolved.length} are still unresolved.`
                ],
                concerns:
                    unresolved.length > 0
                        ? [`${unresolved.length} dependency link(s) point at work that is not yet complete.`]
                        : [],
                methodology: [
                    'Edges are read from real Azure DevOps link types: Dependency-Reverse (predecessor) and Dependency-Forward (successor).',
                    'A dependency is "unresolved" when the target item\'s state category is not Completed or Resolved.'
                ]
            }
        );
    }

    private async collectEdges(limit: number): Promise<{ edges: DependencyEdge[]; items: WorkItem[] }> {
        const items = await this.workItems.query([], { limit, includeRelations: true });
        const linkedIds = new Set<number>();
        for (const item of items) {
            for (const relation of item.relations) {
                if (relation.rel !== RELATION.predecessor && relation.rel !== RELATION.successor) continue;
                const targetId = relationTargetId(relation);
                if (targetId) linkedIds.add(targetId);
            }
        }

        const known = new Map(items.map(item => [item.id, item]));
        const missing = [...linkedIds].filter(id => !known.has(id));
        for (const item of await this.workItems.getByIds(missing)) known.set(item.id, item);

        const edges: DependencyEdge[] = [];
        for (const item of items) {
            for (const relation of item.relations) {
                if (relation.rel !== RELATION.predecessor && relation.rel !== RELATION.successor) continue;
                const targetId = relationTargetId(relation);
                if (!targetId) continue;
                const target = known.get(targetId);
                if (!target) continue;
                const isDone = target.stateCategory === 'Completed' || target.stateCategory === 'Resolved';
                edges.push({
                    from: toItemRef(item),
                    to: toItemRef(target),
                    relation: relation.rel,
                    relationLabel: describeRelation(relation.rel),
                    unresolved: !isDone
                });
            }
        }
        return { edges, items };
    }

    /**
     * Dependencies that cross out of the configured team's area paths - the ones
     * a Team Lead cannot resolve alone.
     */
    async findCrossTeamDependencies(limit = 400): Promise<
        AnalysisEnvelope<{ count: number; edges: (DependencyEdge & { targetAreaPath: string | null })[]; teamAreaPaths: string[] }>
    > {
        const [{ edges }, configuration] = await Promise.all([
            this.collectEdges(limit),
            this.teams.getTeamConfiguration()
        ]);
        const teamPaths = configuration.areaPaths.map(entry => entry.path.toLowerCase());

        const crossTeam: (DependencyEdge & { targetAreaPath: string | null })[] = [];
        for (const edge of edges) {
            const target = await this.workItems.getById(edge.to.id).catch(() => null);
            const areaPath = target?.areaPath ?? null;
            if (!areaPath) continue;
            const insideTeam = teamPaths.some(path => areaPath.toLowerCase() === path || areaPath.toLowerCase().startsWith(`${path}\\`));
            if (!insideTeam) crossTeam.push({ ...edge, targetAreaPath: areaPath });
        }

        return buildEnvelope(
            'cross_team_dependencies',
            {
                count: crossTeam.length,
                edges: crossTeam,
                teamAreaPaths: configuration.areaPaths.map(entry => entry.path)
            },
            {
                observations: [
                    teamPaths.length === 0
                        ? 'The team has no area paths configured in Azure DevOps, so cross-team dependencies cannot be distinguished.'
                        : `${crossTeam.length} dependency link(s) point at work outside the team's area paths.`
                ],
                concerns: crossTeam.filter(edge => edge.unresolved).length > 0
                    ? [`${crossTeam.filter(edge => edge.unresolved).length} unresolved dependency link(s) sit outside the team's area paths and need another team's action.`]
                    : [],
                recommendations: crossTeam
                    .filter(edge => edge.unresolved)
                    .slice(0, 6)
                    .map(edge => `Raise #${edge.to.id} "${edge.to.title}" (area ${edge.targetAreaPath}) with its owning team; #${edge.from.id} depends on it.`),
                methodology: [
                    "Team ownership is taken from the team's real team-field (area path) values in Azure DevOps.",
                    'An edge is cross-team when the linked item\'s area path is neither a configured team area path nor a descendant of one.'
                ]
            }
        );
    }

    /**
     * Unresolved work that other items are waiting on, ranked by how many
     * dependents it holds up and whether those dependents are in the current or
     * next sprint.
     */
    async findItemsBlockingRelease(): Promise<
        AnalysisEnvelope<{
            currentSprint: string | null;
            nextSprint: string | null;
            blockers: { item: ItemRef; dependentCount: number; dependentsInSprint: number; dependents: ItemRef[] }[];
        }>
    > {
        const { edges } = await this.collectEdges(500);
        const [currentSprint, upcoming] = await Promise.all([
            this.sprints.getCurrentSprint().catch(() => null),
            this.sprints.getUpcomingSprints(1).catch(() => [])
        ]);
        const nextSprint = upcoming[0] ?? null;
        const sprintPaths = new Set(
            [currentSprint?.path, nextSprint?.path].filter((path): path is string => typeof path === 'string')
        );

        const byBlocker = new Map<number, { item: ItemRef; dependents: ItemRef[]; inSprint: number }>();
        for (const edge of edges) {
            if (!edge.unresolved) continue;
            // A predecessor edge means `from` waits for `to`; `to` is the blocker.
            if (edge.relation !== RELATION.predecessor) continue;
            const entry = byBlocker.get(edge.to.id) ?? { item: edge.to, dependents: [], inSprint: 0 };
            entry.dependents.push(edge.from);
            const dependent = await this.workItems.getById(edge.from.id).catch(() => null);
            if (dependent?.iterationPath && sprintPaths.has(dependent.iterationPath)) entry.inSprint += 1;
            byBlocker.set(edge.to.id, entry);
        }

        const blockers = [...byBlocker.values()]
            .map(entry => ({
                item: entry.item,
                dependentCount: entry.dependents.length,
                dependentsInSprint: entry.inSprint,
                dependents: entry.dependents
            }))
            .sort((a, b) => b.dependentsInSprint - a.dependentsInSprint || b.dependentCount - a.dependentCount);

        return buildEnvelope(
            'items_blocking_release',
            {
                currentSprint: currentSprint?.name ?? null,
                nextSprint: nextSprint?.name ?? null,
                blockers
            },
            {
                observations: [
                    blockers.length === 0
                        ? 'No unresolved predecessor links are holding up other work items.'
                        : `${blockers.length} unresolved item(s) are blocking other work; ${blockers.filter(blocker => blocker.dependentsInSprint > 0).length} block work in the current or next sprint.`
                ],
                concerns: blockers
                    .filter(blocker => blocker.dependentsInSprint > 0)
                    .slice(0, 5)
                    .map(blocker => `#${blocker.item.id} "${blocker.item.title}" is blocking ${blocker.dependentsInSprint} item(s) in the current or next sprint.`),
                recommendations: blockers
                    .slice(0, 5)
                    .map(blocker => `Prioritise #${blocker.item.id} "${blocker.item.title}" (state ${blocker.item.state}); ${blocker.dependentCount} item(s) depend on it.`),
                methodology: [
                    '"Blocking release" means an item that is the target of a Predecessor link from other items and is itself not Completed/Resolved.',
                    'Ranking favours blockers whose dependents sit in the current or next team iteration.',
                    'This project does not necessarily define an explicit release artefact; sprint scope is used as the delivery boundary.'
                ]
            }
        );
    }

    /** Longest unresolved predecessor chains: the critical paths through the graph. */
    async analyzeCriticalDependencies(): Promise<
        AnalysisEnvelope<{ chains: DependencyChain[]; longestChainLength: number; cyclesDetected: number[][] }>
    > {
        const { edges } = await this.collectEdges(500);

        // `waitsFor`: item id -> ids it is waiting on (unresolved predecessors only).
        const waitsFor = new Map<number, number[]>();
        const refById = new Map<number, ItemRef>();
        for (const edge of edges) {
            refById.set(edge.from.id, edge.from);
            refById.set(edge.to.id, edge.to);
            if (edge.relation !== RELATION.predecessor || !edge.unresolved) continue;
            const bucket = waitsFor.get(edge.from.id) ?? [];
            if (!bucket.includes(edge.to.id)) bucket.push(edge.to.id);
            waitsFor.set(edge.from.id, bucket);
        }

        const cycles: number[][] = [];
        const chains: DependencyChain[] = [];
        const visiting = new Set<number>();

        const walk = (id: number, path: number[]): number[] => {
            if (visiting.has(id)) {
                cycles.push([...path, id]);
                return path;
            }
            visiting.add(id);
            let longest = [...path, id];
            for (const next of waitsFor.get(id) ?? []) {
                const candidate = walk(next, [...path, id]);
                if (candidate.length > longest.length) longest = candidate;
            }
            visiting.delete(id);
            return longest;
        };

        for (const id of waitsFor.keys()) {
            const path = walk(id, []);
            if (path.length >= 2) {
                const items = path.map(nodeId => refById.get(nodeId)).filter((ref): ref is ItemRef => ref !== undefined);
                chains.push({ length: items.length, items, unresolvedCount: items.length - 1 });
            }
        }

        const deduped = dedupeChains(chains).sort((a, b) => b.length - a.length).slice(0, 10);
        const longest = deduped[0]?.length ?? 0;

        return buildEnvelope(
            'critical_dependencies',
            { chains: deduped, longestChainLength: longest, cyclesDetected: cycles },
            {
                observations: [
                    deduped.length === 0
                        ? 'No unresolved dependency chains were found.'
                        : `Longest unresolved dependency chain spans ${longest} work items.`
                ],
                concerns: [
                    ...(longest >= 3 ? [`A ${longest}-item dependency chain means the last item cannot start until several predecessors finish.`] : []),
                    ...(cycles.length > 0 ? [`${cycles.length} circular dependency link(s) detected in Azure DevOps - these can never resolve on their own.`] : [])
                ],
                recommendations: deduped
                    .slice(0, 3)
                    .map(chain => `Start at the far end of the chain: #${chain.items[chain.items.length - 1]?.id} "${chain.items[chain.items.length - 1]?.title}" gates ${chain.length - 1} downstream item(s).`),
                methodology: [
                    'Chains are traversed over unresolved Predecessor links only, so completed work does not extend a chain.',
                    'Chain traversal detects cycles and reports them rather than looping.'
                ]
            }
        );
    }
}

function dedupeChains(chains: DependencyChain[]): DependencyChain[] {
    const seen = new Set<string>();
    const result: DependencyChain[] = [];
    for (const chain of chains) {
        const key = chain.items.map(item => item.id).join('>');
        const isSubPath = [...seen].some(existing => existing.includes(key));
        if (isSubPath) continue;
        seen.add(key);
        result.push(chain);
    }
    return result;
}

let sharedDependencyService: DependencyService | null = null;

export function getDependencyService(): DependencyService {
    sharedDependencyService ??= new DependencyService();
    return sharedDependencyService;
}

export function setDependencyServiceForTesting(service: DependencyService | null): void {
    sharedDependencyService = service;
}
