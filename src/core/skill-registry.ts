import { AppError } from '../utils/errors.js';
import type { SkillDefinition } from './skill-definition.js';
import { getCustomSkillRepository } from '../database/repository/custom-skill.repository.js';

function builtin(
    name: string,
    description: string,
    analysisModules: string[],
    extras: Partial<SkillDefinition> = {}
): SkillDefinition {
    return {
        id: `builtin-${name}`,
        name,
        type: 'builtin',
        description,
        defaultMode: extras.defaultMode ?? 'brief',
        supportedModes: extras.supportedModes ?? ['brief', 'verbose', 'visual'],
        requiredContext: extras.requiredContext ?? ['team', 'currentSprint'],
        requiredData: extras.requiredData ?? [],
        analysisModules,
        recommendationEnabled: extras.recommendationEnabled ?? true,
        queryEnabled: extras.queryEnabled ?? true,
        navigationEnabled: extras.navigationEnabled ?? true,
        status: 'active'
    };
}

export class InternalSkillRegistry {
    private static skills: Map<string, SkillDefinition> = new Map();

    static {
        const defs: SkillDefinition[] = [
            builtin('daily-standup-starter', "Standup view of each member's open and active work.", [
                'review'
            ]),
            builtin('backlog-data-quality', 'Backlog quality across hierarchy, fields, dates and stale work.', [
                'backlog',
                'date',
                'hierarchy',
                'stale-work'
            ]),
            builtin('workload-analysis', "Team workload distribution and capacity signals.", [
                'workload',
                'team-capacity',
                'deadline'
            ]),
            builtin('sprint-health-analysis', 'Current sprint vs previous sprint rates and carry-over.', ['sprint']),
            builtin('stale-work-analysis', 'Open work with no recent ChangedDate (default 14 days).', ['stale-work']),
            builtin('deadline-risk-analysis', 'Overdue and approaching deadlines.', ['deadline', 'risk']),
            builtin('dependency-analysis', 'Blocking dependencies from Azure DevOps links.', ['dependency']),
            builtin('delivery-forecast', 'Historical throughput used as a forecast input.', ['delivery-forecast'], {
                queryEnabled: false,
                navigationEnabled: false
            }),
            builtin('hierarchy-health-analysis', 'Epic/feature/story linking gaps.', ['backlog', 'hierarchy']),
            builtin('schedule-variance-analysis', 'Planned vs actual date completeness and variance.', ['backlog', 'date']),
            builtin('project-health-analysis', 'Executive health from sprint, workload, deadline, risk, backlog and dependencies.', [
                'sprint',
                'workload',
                'deadline',
                'risk',
                'backlog',
                'dependency'
            ]),
            builtin('team-productivity-review', 'Team throughput and workload signals.', ['productivity', 'workload']),
            builtin('tl-productivity-review', 'Team Lead management signals: load, overdue follow-up, unassigned work and blockers.', [
                'productivity',
                'workload',
                'deadline',
                'review'
            ]),
            builtin('weekly-team-review', 'Weekly review of sprint, workload and blocked work.', [
                'review',
                'sprint',
                'workload'
            ]),
            builtin('team-morning-brief', 'Morning triage: workload, deadlines and blockers.', [
                'review',
                'workload',
                'deadline'
            ]),
            builtin('daily-team-report', 'Daily team report from review and sprint facts.', ['review', 'sprint', 'workload']),
            builtin('work-assignment-recommendation', 'Recommend owners for unassigned work (does not assign).', [
                'assignment'
            ]),
        ];
        for (const def of defs) this.registerSkill(def);
    }

    static loadFromDatabase(): void {
        const repo = getCustomSkillRepository();
        try {
            const customSkills = repo.list();
            for (const skill of customSkills) {
                this.registerSkill(skill);
            }
        } catch {
            // Ignore during tests or if schema not initialized
        }
    }

    static registerSkill(skill: SkillDefinition): void {
        this.skills.set(skill.name, skill);
    }

    static getSkill(name: string): SkillDefinition | null {
        return this.skills.get(name) ?? null;
    }

    static listSkills(includeDisabled = false): SkillDefinition[] {
        const all = Array.from(this.skills.values());
        if (includeDisabled) return all;
        return all.filter(s => s.status === 'active');
    }

    static hasSkill(name: string): boolean {
        return this.skills.has(name);
    }

    static removeSkill(name: string): void {
        const skill = this.getSkill(name);
        if (skill?.type === 'builtin') {
            throw new AppError('INVALID_INPUT', `Cannot remove built-in skill: ${name}`);
        }
        this.skills.delete(name);
    }

    static enableSkill(name: string): void {
        const skill = this.getSkill(name);
        if (skill) skill.status = 'active';
    }

    static disableSkill(name: string): void {
        const skill = this.getSkill(name);
        if (skill?.type === 'builtin') {
            throw new AppError('INVALID_INPUT', `Cannot disable built-in skill: ${name}`);
        }
        if (skill) skill.status = 'disabled';
    }
}
