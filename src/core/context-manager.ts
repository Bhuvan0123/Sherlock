import { getProjectContext, type ProjectContextService } from '../azure-devops/context.js';
import { getTeamService } from '../azure-devops/team.service.js';
import { getSprintService, type Sprint } from '../azure-devops/sprint.service.js';
import { AppError } from '../utils/errors.js';
import type { AdoTeam } from '../azure-devops/types.js';

export interface ExecutionContext {
    /** The common project context service for field resolution and states */
    projectContext: ProjectContextService;
    /** Information about the current team */
    team: AdoTeam;
    /** Current sprint (iteration) if the team works in sprints */
    currentSprint: Sprint | null;
    /** The reference date/time for "today" in this context */
    today: Date;
    /** Any request-scoped cache for the duration of this execution */
    cache: Map<string, any>;
}

export class ContextManager {
    /**
     * Builds the shared execution context to be passed to skills and tools.
     * deduplicates identical calls made within the same execution.
     */
    static async buildContext(): Promise<ExecutionContext> {
        const projectContext = getProjectContext();
        const team = await projectContext.getTeam();
        
        let currentSprint: Sprint | null = null;
        try {
            const sprintService = getSprintService();
            currentSprint = await sprintService.getCurrentSprint(team.name);
        } catch (error) {
            // Team might not use sprints
            currentSprint = null;
        }

        return {
            projectContext,
            team,
            currentSprint,
            today: new Date(),
            cache: new Map() // Request-scoped cache
        };
    }
}
