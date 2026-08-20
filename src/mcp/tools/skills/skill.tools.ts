import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SKILL_CATEGORIES, getSharedRules, getSkill, getSkills, toIndexEntry } from '../../../skills/registry.js';
import { AppError } from '../../../utils/errors.js';
import { registerTool } from '../../tool-registry.js';
import { SkillExecutor } from '../../../core/skill-executor.js';
import { InternalSkillRegistry } from '../../../core/skill-registry.js';

const ROUTING_NOTE =
    'Skills are workflow instructions, not data. Loading one never contacts Azure DevOps: follow its Workflow section and call the Azure DevOps and analysis tools it names.';

/**
 * Skill catalogue tools.
 *
 * These expose the markdown playbooks in `skills/` so the model can pick a
 * repeatable Team Lead workflow and follow it. Both are pure local file reads
 * and change nothing anywhere.
 */
export function registerSkillTools(server: McpServer): void {
    registerTool(server, {
        name: 'skill_list',
        title: 'List available skills',
        description:
            'The catalogue of Team Lead workflows this server ships with: name, what each produces, the phrases that should route to it, and the tools it uses. Call this when the Team Lead asks for a briefing, review, analysis or report and you want the established workflow rather than improvising one. Loading a skill reads a local file only.',
        group: 'analysis',
        inputSchema: {
            category: z
                .enum(SKILL_CATEGORIES)
                .optional()
                .describe('Filter to one category. Omit to list every skill.')
        },
        audit: { category: 'maintenance', action: 'List skills' },
        handler: async args => {
            const category = args.category as string | undefined;
            const skills = getSkills().filter(skill => category === undefined || skill.category === category);
            return {
                count: skills.length,
                ...(category ? { category } : {}),
                skills: skills.map(toIndexEntry),
                usage: 'Call skill_get with a skill name to load its full instructions before following it.',
                note: ROUTING_NOTE
            };
        },
        summarise: result => {
            const catalogue = result as { count: number; skills: { name: string }[] };
            return `${catalogue.count} skill(s): ${catalogue.skills.map(skill => skill.name).join(', ')}.`;
        }
    });

    registerTool(server, {
        name: 'skill_get',
        title: 'Load a skill',
        description:
            'Loads one skill\'s full instructions: purpose, workflow steps naming the exact tools to call, analysis rules, output format, edge cases and safety rules, plus the shared rules that apply to every skill. Follow the returned Workflow rather than inventing your own sequence.',
        group: 'analysis',
        inputSchema: {
            name: z.string().min(1).describe('Skill name, for example "team-morning-brief". Use skill_list to see them all.'),
            include_shared_rules: z
                .boolean()
                .optional()
                .describe('Include the shared data, analysis, output and safety rules. Default true; they are what keep a skill safe.'),
            mode: z
                .enum(['brief', 'verbose', 'visual'])
                .optional()
                .describe('The requested output mode for the skill. Default is verbose. brief: concise summary. verbose: detailed item lists. visual: markdown tables or mermaid diagrams.')
        },
        audit: { category: 'maintenance', action: 'Load skill', subject: args => `skill:${String(args.name)}` },
        handler: async args => {
            const requested = String(args.name).trim();
            const skill = getSkill(requested);
            if (skill === null) {
                throw new AppError('NOT_FOUND', `There is no skill named "${requested}".`, {
                    hint: `Available skills: ${getSkills()
                        .map(candidate => candidate.name)
                        .join(', ')}.`
                });
            }

            const includeShared = args.include_shared_rules !== false;
            return {
                name: skill.name,
                title: skill.title,
                description: skill.description,
                version: skill.version,
                category: skill.category,
                path: skill.path,
                azureDevOpsAccess: 'read-only',
                requiresConfirmation: skill.requiresConfirmation,
                tools: { primary: skill.primaryTools, supporting: skill.supportingTools },
                missingCapabilities: skill.missingCapabilities,
                triggers: skill.triggers,
                instructions: skill.body,
                ...(includeShared
                    ? { sharedRules: getSharedRules().map(document => ({ name: document.name, content: document.content })) }
                    : { sharedRules: null, sharedRulesNote: 'Omitted by request. They still apply.' }),
                outputMode: args.mode ?? 'verbose',
                note: ROUTING_NOTE + `\nIMPORTANT: The user requested output mode '${args.mode ?? 'verbose'}'. You MUST format your final response to follow this mode.`
            };
        },
        summarise: result => {
            const skill = result as { title: string; name: string; tools: { primary: string[] } };
            return `Loaded skill "${skill.title}" (${skill.name}). Follow its Workflow; primary tools: ${skill.tools.primary.join(', ') || 'none'}.`;
        }
    });

    registerTool(server, {
        name: 'skill_execute',
        title: 'Execute a skill programmatically',
        description:
            'Executes a KaarFlow skill using the strict core architecture. This replaces manual tool-chaining and WIQL generation by the LLM. It returns the fully formatted Markdown ready to be relayed to the user.',
        group: 'analysis',
        inputSchema: {
            name: z.string().min(1).describe('Skill name, for example "daily-standup-starter".'),
            mode: z
                .enum(['brief', 'verbose', 'visual'])
                .optional()
                .describe('The requested output mode for the skill. Default is brief.')
        },
        audit: { category: 'analysis', action: 'Execute skill programmatically', subject: args => `skill:${String(args.name)}` },
        handler: async args => {
            const requested = String(args.name).trim();
            const skill = InternalSkillRegistry.getSkill(requested);
            if (skill === null || skill.status === 'disabled') {
                throw new AppError('NOT_FOUND', `There is no active skill named "${requested}".`, {
                    hint: `Available skills: ${InternalSkillRegistry.listSkills(false)
                        .map(candidate => candidate.name)
                        .join(', ')}.`
                });
            }

            const markdown = await SkillExecutor.executeSkill(skill as any, (args.mode as any) ?? skill.defaultMode, args);
            return { markdown };
        },
        summarise: result => {
            return `Successfully executed skill and generated formatted response. Relay the markdown exactly as provided.`;
        }
    });
}
