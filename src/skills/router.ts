import { getSkills, type Skill } from './registry.js';
import { AppError } from '../utils/errors.js';

export class SkillRouter {
    /**
     * Finds the most appropriate skill for a given user request based on triggers.
     * Built-in skills take precedence over custom skills with the same name.
     */
    static routeRequest(request: string): Skill | null {
        const skills = getSkills();
        const lowerRequest = request.toLowerCase();

        // 1. Exact trigger match
        let match = skills.find(s => s.triggers.some(t => lowerRequest.includes(t.toLowerCase())));
        if (match) return match;

        // 2. Name match (fallback)
        match = skills.find(s => lowerRequest.includes(s.name.toLowerCase()));
        if (match) return match;

        return null;
    }

    /** Ensure custom skill names do not collide with built-in skills */
    static assertNoCollision(customSkillName: string): void {
        const skills = getSkills();
        const builtIn = skills.find(s => s.name === customSkillName && !s.path.includes('custom/'));
        if (builtIn) {
            throw new AppError('INVALID_INPUT', `Cannot overwrite built-in skill: ${customSkillName}`);
        }
    }
}
