import type { ExecutionContext } from './context-manager.js';
import { CacheManager } from './cache-manager.js';
import { getTeamService } from '../azure-devops/team.service.js';
import { getWorkItemService } from '../azure-devops/work-item.service.js';
import type { TeamMember } from '../azure-devops/team.service.js';
import type { CompactTeamMember } from '../azure-devops/dto.js';

export interface TeamSnapshot {
    team: ExecutionContext['team'];
    sprint: ExecutionContext['currentSprint'];
    members: CompactTeamMember[];
    workloadSummary: number;
    deadlineSummary: number;
    blockedCount: number;
    unassignedCount: number;
}

/**
 * Shared snapshot for analysis modules.
 * Counts use WIQL id lists only (no work-item GET) unless a module later loads samples.
 */
export class DataAggregator {
    static async getTeamSnapshot(context: ExecutionContext, requiredData: string[] = []): Promise<TeamSnapshot> {
        const teamService = getTeamService();
        const workItemService = getWorkItemService();
        const teamId = context.team.id;

        const wants = (key: string) => requiredData.includes(key);
        const needsMembers = wants('members') || wants('workload') || wants('team-capacity');
        const needsUnassigned = wants('unassigned');
        const needsBlocked = wants('blocked');
        const needsWorkload = wants('workload');
        const needsDeadlines = wants('deadlines');

        const [rawMembers, unassignedIds, blockedIds, workloadIds, deadlineIds] = await Promise.all([
            needsMembers
                ? CacheManager.getOrLoad(context, `snapshot:members:${teamId}`, () => teamService.getMembers(teamId))
                : Promise.resolve([]),
            needsUnassigned
                ? CacheManager.getOrLoad(context, `snapshot:unassigned-ids:${teamId}`, () =>
                      workItemService.unassignedIds({ limit: 200 })
                  )
                : Promise.resolve([] as number[]),
            needsBlocked
                ? CacheManager.getOrLoad(context, `snapshot:blocked-ids:${teamId}`, () =>
                      workItemService.blockedSignalIds({ limit: 200 })
                  )
                : Promise.resolve([] as number[]),
            needsWorkload
                ? CacheManager.getOrLoad(context, `snapshot:workload-ids:${teamId}`, () =>
                      workItemService.queryIds([], { limit: 1000 })
                  )
                : Promise.resolve([] as number[]),
            needsDeadlines
                ? CacheManager.getOrLoad(context, `snapshot:deadline-ids:${teamId}`, () =>
                      workItemService.dueBetweenIds(0, 7, { limit: 200 })
                  )
                : Promise.resolve([] as number[])
        ]);

        const members: CompactTeamMember[] = (rawMembers as TeamMember[]).map(m => ({
            id: m.id ?? '',
            displayName: m.displayName ?? 'Unknown',
            email: m.email ?? ''
        }));

        return {
            team: context.team,
            sprint: context.currentSprint,
            members,
            workloadSummary: workloadIds.length,
            deadlineSummary: deadlineIds.length,
            blockedCount: blockedIds.length,
            unassignedCount: unassignedIds.length
        };
    }
}
