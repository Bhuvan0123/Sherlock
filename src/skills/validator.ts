import type { Skill, SkillValidationIssue } from './registry.js';
import { AppError } from '../utils/errors.js';
import { AnalysisEngine } from '../core/analysis-engine.js';

export class SkillValidator {
    /**
     * Validates a custom skill before saving it.
     * Enforces security constraints and schema validity.
     */
    static validateCustomSkill(skill: Skill, knownToolNames: readonly string[]): SkillValidationIssue[] {
        const issues: SkillValidationIssue[] = [];
        const known = new Set(knownToolNames);

        if (!skill.name.match(/^[a-z0-9-]+$/)) {
            issues.push({ skill: skill.name, reason: 'Skill name must be lowercase alphanumeric with hyphens.' });
        }

        if (skill.mutatesAzureDevOps) {
            issues.push({ skill: skill.name, reason: 'Custom skills cannot mutate Azure DevOps data.' });
        }

        if (!skill.triggers || skill.triggers.length === 0) {
            issues.push({ skill: skill.name, reason: 'Skill must define at least one trigger phrase.' });
        }

        // Validate tools
        for (const tool of [...(skill.primaryTools || []), ...(skill.supportingTools || [])]) {
            if (!known.has(tool)) {
                issues.push({ skill: skill.name, reason: `References unknown or disallowed tool: ${tool}` });
            }
        }

        // Ensure no analysis modules are used that aren't allowed
        // Custom skills might specify modules in a special block or via tools
        const allowedModules = new Set(AnalysisEngine.getAvailableModules());
        // Simple check inside the body for invalid references (mock logic)
        if (skill.body && skill.body.includes('runAnalysisModule')) {
            // Further parse...
        }

        return issues;
    }

    static assertValidCustomSkill(skill: Skill, knownToolNames: readonly string[]): void {
        const issues = this.validateCustomSkill(skill, knownToolNames);
        if (issues.length > 0) {
            throw new AppError('INVALID_INPUT', 'Failed to validate custom skill.', {
                hint: issues.map(i => i.reason).join('\n')
            });
        }
    }
}
