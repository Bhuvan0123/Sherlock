import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppError } from '../../../utils/errors.js';
import { registerTool, getRegisteredToolMeta } from '../../tool-registry.js';
import { getCustomSkillRepository } from '../../../database/repository/custom-skill.repository.js';
import { InternalSkillRegistry } from '../../../core/skill-registry.js';
import type { SkillDefinition } from '../../../core/skill-definition.js';
import {
    composeSkillDefinition,
    formatCapabilityCatalogue,
    formatCompositionPreview,
    parseCompositionRequest,
    resolveNaturalLanguageIntent
} from '../../../core/skill-composer.js';

const MUTATION_INTENT =
    /\b(update|assign|delete|create|patch|mutate)\b.*\b(work ?items?|tasks?|bugs?|stories|assignee)\b|\bassign(s|ed|ing)?\s+(them|work items|overdue)/i;
const CODE_EXECUTION_INTENT =
    /\b(javascript|python|shell|powershell|bash|cmd\.exe|eval\(|subprocess|arbitrary http|http post|curl )\b/i;

function assertCustomSkillPolicy(args: Record<string, unknown>): void {
    const description = String(args.description ?? '');
    const blob = `${args.name ?? ''} ${description}`;

    if (MUTATION_INTENT.test(blob)) {
        throw new AppError(
            'READ_ONLY_VIOLATION',
            'Custom skills cannot update, assign, or otherwise mutate Azure DevOps work items.',
            { hint: 'KaarFlow is read-only for work items. You can analyse overdue work and recommend owners, but assignments must be made in Azure DevOps.' }
        );
    }
    if (CODE_EXECUTION_INTENT.test(blob)) {
        throw new AppError(
            'INVALID_INPUT',
            'Custom skills cannot execute JavaScript, Python, Shell, or arbitrary HTTP.',
            { hint: 'Compose skills from registered analysis modules only (workload, sprint, deadline, stale-work, …).' }
        );
    }

    const requiredTools = (args.requiredTools as string[] | undefined) ?? [];
    const known = new Set(getRegisteredToolMeta().map(tool => tool.name));
    for (const tool of requiredTools) {
        if (!known.has(tool)) {
            throw new AppError('INVALID_INPUT', `References unknown or disallowed tool: ${tool}`);
        }
    }

    const toolMentions = description.match(/\b[a-z][a-z0-9_]{4,}\b/g) ?? [];
    for (const token of toolMentions) {
        if ((token.startsWith('ado_') || token.startsWith('unregistered_') || token.endsWith('_tool') || token.includes('mcp_tool')) && !known.has(token)) {
            if (token.startsWith('ado_get') || token.startsWith('analysis_') || token.startsWith('skill_') || token.startsWith('email_') || token.startsWith('kaarflow_')) {
                if (!known.has(token)) {
                    throw new AppError('INVALID_INPUT', `References unknown or disallowed tool: ${token}`);
                }
            } else if (token.includes('tool') || token.startsWith('ado_mutate') || token.startsWith('unregistered')) {
                throw new AppError('INVALID_INPUT', `References unknown or disallowed tool: ${token}`);
            }
        }
    }
}

function skillAuditSubject(args: Record<string, unknown>): string | null {
    const name = String(args.name ?? args.newName ?? args.sourceName ?? '').trim();
    return name ? `skill:${name}` : null;
}

export function registerCustomSkillTools(server: McpServer): void {
    registerTool(server, {
        name: 'kaarflow_compose_skill',
        title: 'Compose a custom skill from existing skills or modules',
        description:
            'Combine existing KaarFlow skills and analysis modules into one custom skill. Resolves modules, deduplicates them, and does not run nested Markdown. Call with confirm=false first (preview), then confirm=true to save. Example request: "Create a weekly management review combining sprint health, workload, backlog quality and delivery risk."',
        group: 'analysis',
        inputSchema: {
            name: z.string().describe('New custom skill name (kebab-case), e.g. weekly-management-review'),
            description: z.string().optional().describe('Purpose of the composed skill.'),
            sourceSkills: z.array(z.string()).optional().describe('Existing built-in or custom skill names to union.'),
            modules: z.array(z.string()).optional().describe('Extra analysis module ids (workload, sprint, backlog, …).'),
            request: z
                .string()
                .optional()
                .describe('Natural language, e.g. combining sprint health, workload, backlog quality and delivery risk.'),
            recommendationEnabled: z.boolean().optional().default(true),
            queryEnabled: z.boolean().optional().default(true),
            navigationEnabled: z.boolean().optional().default(true),
            confirm: z.boolean().default(false)
        },
        audit: { category: 'maintenance', action: 'Compose custom skill', subject: skillAuditSubject },
        handler: async args => {
            assertCustomSkillPolicy({
                name: args.name,
                description: args.description ?? args.request ?? ''
            });
            const name = args.name as string;
            const explicit =
                ((args.sourceSkills as string[] | undefined)?.length ?? 0) +
                    ((args.modules as string[] | undefined)?.length ?? 0) >
                0;
            if (typeof args.request === 'string' && !explicit) {
                const intent = resolveNaturalLanguageIntent(args.request);
                if (!intent.persist) {
                    return {
                        message: intent.message,
                        persist: false,
                        recommendedSkills: intent.sourceSkills,
                        recommendedModules: intent.modules
                    };
                }
            }
            if (InternalSkillRegistry.hasSkill(name)) {
                throw new AppError('INVALID_INPUT', `A skill named '${name}' already exists.`);
            }
            const composed = composeSkillDefinition({
                name,
                description: args.description as string | undefined,
                sourceSkills: args.sourceSkills as string[] | undefined,
                modules: args.modules as string[] | undefined,
                request: args.request as string | undefined,
                recommendationEnabled: args.recommendationEnabled as boolean | undefined,
                queryEnabled: args.queryEnabled as boolean | undefined,
                navigationEnabled: args.navigationEnabled as boolean | undefined
            });
            if (!args.confirm) {
                return {
                    message: 'PREVIEW ONLY. Ask the user to confirm creation.',
                    preview: formatCompositionPreview(composed),
                    modules: composed.resolvedModules
                };
            }
            persistNewCustomSkill(composed.definition);
            return {
                status: 'Success',
                message: `Custom skill '/${composed.definition.name}' saved and registered successfully.`,
                modules: composed.resolvedModules
            };
        },
        summarise: result => (result as { message: string }).message
    });

    registerTool(server, {
        name: 'kaarflow_create_skill',
        title: 'Create Custom Skill',
        description: 'Create a custom SkillDefinition from modules and/or existing skills. Supports composition: pass sourceSkills or a natural-language request. Call confirm=false first for a preview, then confirm=true to save.',
        group: 'analysis',
        inputSchema: {
            name: z.string().describe('Unique identifier for the skill (lowercase kebab-case). Example: weekly-platform-review'),
            description: z.string().describe('Short description of what the skill does.'),
            analysisModules: z.array(z.string()).optional().describe('Analysis module IDs. Optional when sourceSkills or a composition request is provided.'),
            sourceSkills: z.array(z.string()).optional().describe('Existing skill names whose modules should be unioned.'),
            request: z.string().optional().describe('Natural language composition, e.g. combining sprint health and workload.'),
            requiredData: z.array(z.string()).optional().describe('Optional. Derived from modules when omitted.'),
            defaultMode: z.enum(['brief', 'verbose', 'visual']).describe('Default output mode.'),
            supportedModes: z.array(z.enum(['brief', 'verbose', 'visual'])).describe('Supported output modes.'),
            queryEnabled: z.boolean().describe('Whether this skill should generate queries for its findings.'),
            recommendationEnabled: z.boolean().describe('Whether this skill should generate recommendations.'),
            navigationEnabled: z.boolean().describe('Whether navigation URLs should be generated.'),
            requiredTools: z.array(z.string()).optional().describe('Optional MCP tool names this skill is allowed to reference.'),
            confirm: z.boolean().default(false).describe('Set to false to preview. Set to true to actually save.')
        },
        audit: { category: 'maintenance', action: 'Create custom skill', subject: skillAuditSubject },
        handler: async args => {
            const name = args.name as string;
            assertCustomSkillPolicy(args);
            const explicitCreate =
                ((args.sourceSkills as string[] | undefined)?.length ?? 0) +
                    ((args.analysisModules as string[] | undefined)?.length ?? 0) >
                0;
            if (typeof args.request === 'string' && !explicitCreate) {
                const intent = resolveNaturalLanguageIntent(args.request);
                if (!intent.persist) {
                    return {
                        message: intent.message,
                        persist: false,
                        recommendedSkills: intent.sourceSkills,
                        recommendedModules: intent.modules
                    };
                }
            }

            if (!/^[a-z0-9-]+$/.test(name)) {
                throw new AppError('INVALID_INPUT', `Skill name must be lowercase kebab-case: ${name}`);
            }
            if (InternalSkillRegistry.hasSkill(name)) {
                throw new AppError('INVALID_INPUT', `A skill named '${name}' already exists.`);
            }

            const composed = composeSkillDefinition({
                name,
                description: args.description as string | undefined,
                sourceSkills: args.sourceSkills as string[] | undefined,
                modules: (args.analysisModules as string[] | undefined) ?? [],
                request: args.request as string | undefined,
                recommendationEnabled: args.recommendationEnabled as boolean | undefined,
                queryEnabled: args.queryEnabled as boolean | undefined,
                navigationEnabled: args.navigationEnabled as boolean | undefined
            });
            const definition = composed.definition;
            if (Array.isArray(args.requiredData) && args.requiredData.length > 0) {
                definition.requiredData = args.requiredData as string[];
            }
            definition.defaultMode = (args.defaultMode as SkillDefinition['defaultMode']) ?? definition.defaultMode;
            definition.supportedModes = (args.supportedModes as string[]) ?? definition.supportedModes;
            definition.queryEnabled = args.queryEnabled as boolean;
            definition.recommendationEnabled = args.recommendationEnabled as boolean;
            definition.navigationEnabled = args.navigationEnabled as boolean;

            if (!args.confirm) {
                return {
                    message: 'PREVIEW ONLY. Ask the user to confirm creation.',
                    preview: formatCompositionPreview(composed)
                };
            }

            persistNewCustomSkill(definition);
            return {
                status: 'Success',
                message: `Custom skill '/${name}' saved and registered successfully.`
            };
        },
        summarise: result => (result as any).message
    });

    registerTool(server, {
        name: 'kaarflow_list_skills',
        title: 'List KaarFlow Skills',
        description:
            'Lists built-in capabilities grouped for Team Leads (Team, Sprint, Backlog, Workload, Risk, Quality, Dependencies, Productivity, Delivery) and custom skills separately.',
        group: 'analysis',
        inputSchema: {},
        audit: { category: 'maintenance', action: 'List skills' },
        handler: async () => {
            const allSkills = InternalSkillRegistry.listSkills(true);
            const custom = allSkills.filter(s => s.type === 'custom');
            const list = formatCapabilityCatalogue(
                custom.map(s => ({ name: s.name, description: s.description, status: s.status }))
            );
            return { list, count: allSkills.length };
        },
        summarise: result => `Found ${(result as any).count} total skills.`
    });

    registerTool(server, {
        name: 'kaarflow_get_skill',
        title: 'Show Skill Definition',
        description: 'Gets the structured definition of a skill.',
        group: 'analysis',
        inputSchema: {
            name: z.string()
        },
        audit: { category: 'maintenance', action: 'Get skill', subject: skillAuditSubject },
        handler: async args => {
            const name = args.name as string;
            const skill = InternalSkillRegistry.getSkill(name);
            if (!skill) {
                throw new AppError('NOT_FOUND', `Skill '${name}' not found.`);
            }

            let md = `# /${skill.name}\n`;
            md += `\n**Purpose**: ${skill.description}`;
            md += `\n**Type**: ${skill.type}`;
            md += `\n**Status**: ${skill.status}`;
            const version = skill.type === 'custom' ? (getCustomSkillRepository().getVersion(name) ?? 1) : 1;
            md += `\n**Version**: ${version}`;
            md += `\n**Analysis modules**: ${skill.analysisModules.join(', ')}`;
            md += `\n**Required data**: ${skill.requiredData.join(', ')}`;
            md += `\n**Modes**: Default (${skill.defaultMode}), Supported (${skill.supportedModes.join(', ')})`;
            md += `\n**Query behaviour**: ${skill.queryEnabled}`;
            md += `\n**Recommendation behaviour**: ${skill.recommendationEnabled}`;
            md += `\n**Navigation**: ${skill.navigationEnabled}`;

            return { markdown: md };
        },
        summarise: () => `Fetched skill definition.`
    });

    registerTool(server, {
        name: 'kaarflow_remove_skill',
        title: 'Delete Custom Skill',
        description: 'Deletes a custom skill. Requires confirm=true.',
        group: 'analysis',
        inputSchema: {
            name: z.string(),
            confirm: z.boolean().default(false)
        },
        audit: { category: 'maintenance', action: 'Delete skill', subject: skillAuditSubject },
        handler: async args => {
            const name = args.name as string;
            const skill = InternalSkillRegistry.getSkill(name);
            if (!skill) throw new AppError('NOT_FOUND', `Skill '${name}' not found.`);
            if (skill.type === 'builtin') throw new AppError('INVALID_INPUT', `Cannot delete builtin skill: ${name}`);

            if (!args.confirm) {
                return { message: `PREVIEW: Are you sure you want to delete /${name}?`, preview: `Are you sure you want to delete /${name}?` };
            }

            getCustomSkillRepository().delete(name);
            InternalSkillRegistry.removeSkill(name);
            return { message: `Skill /${name} deleted successfully.` };
        },
        summarise: result => (result as any).message
    });

    registerTool(server, {
        name: 'kaarflow_enable_skill',
        title: 'Enable Skill',
        description: 'Enables a disabled skill.',
        group: 'analysis',
        inputSchema: { name: z.string() },
        audit: { category: 'maintenance', action: 'Enable skill', subject: skillAuditSubject },
        handler: async args => {
            const name = args.name as string;
            const skill = InternalSkillRegistry.getSkill(name);
            if (!skill) throw new AppError('NOT_FOUND', `Skill '${name}' not found.`);
            
            if (skill.type === 'custom') {
                getCustomSkillRepository().setStatus(name, 'active');
            }
            InternalSkillRegistry.enableSkill(name);
            return { message: `Skill /${name} enabled.` };
        },
        summarise: result => (result as any).message
    });

    registerTool(server, {
        name: 'kaarflow_disable_skill',
        title: 'Disable Skill',
        description: 'Disables an active skill. Builtin skills cannot be disabled.',
        group: 'analysis',
        inputSchema: { name: z.string() },
        audit: { category: 'maintenance', action: 'Disable skill', subject: skillAuditSubject },
        handler: async args => {
            const name = args.name as string;
            const skill = InternalSkillRegistry.getSkill(name);
            if (!skill) throw new AppError('NOT_FOUND', `Skill '${name}' not found.`);
            if (skill.type === 'builtin') throw new AppError('INVALID_INPUT', `Cannot disable builtin skill: ${name}`);

            getCustomSkillRepository().setStatus(name, 'disabled');
            InternalSkillRegistry.disableSkill(name);
            return { message: `Skill /${name} disabled.` };
        },
        summarise: result => (result as any).message
    });

    registerTool(server, {
        name: 'kaarflow_update_skill',
        title: 'Update Custom Skill',
        description: 'Updates an existing custom skill. Like create, requires confirm=true to save.',
        group: 'analysis',
        inputSchema: {
            name: z.string(),
            description: z.string().optional(),
            request: z.string().optional().describe('Natural language additions, e.g. also include unassigned high-priority work.'),
            analysisModules: z.array(z.string()).optional(),
            requiredData: z.array(z.string()).optional(),
            defaultMode: z.enum(['brief', 'verbose', 'visual']).optional(),
            supportedModes: z.array(z.enum(['brief', 'verbose', 'visual'])).optional(),
            queryEnabled: z.boolean().optional(),
            recommendationEnabled: z.boolean().optional(),
            navigationEnabled: z.boolean().optional(),
            confirm: z.boolean().default(false)
        },
        audit: { category: 'maintenance', action: 'Update custom skill', subject: skillAuditSubject },
        handler: async args => {
            const name = args.name as string;
            const existing = InternalSkillRegistry.getSkill(name);
            
            if (!existing) throw new AppError('NOT_FOUND', `Skill '${name}' not found.`);
            if (existing.type === 'builtin') throw new AppError('INVALID_INPUT', `Cannot update builtin skill: ${name}`);

            assertCustomSkillPolicy({
                ...args,
                description: (args.description as string) ?? existing.description
            });

            const extraFromRequest = typeof args.request === 'string' ? parseCompositionRequest(args.request).modules : [];
            const nextModules = [
                ...new Set(
                    (args.analysisModules as string[] | undefined) ?? [
                        ...existing.analysisModules,
                        ...extraFromRequest
                    ]
                )
            ];
            if (args.analysisModules || extraFromRequest.length > 0) {
                composeSkillDefinition({
                    name: `tmp-validate-${name}`,
                    modules: nextModules
                });
            }

            const updated: SkillDefinition = {
                ...existing,
                description: (args.description as string) ?? existing.description,
                analysisModules: nextModules,
                requiredData: (args.requiredData as string[]) ?? existing.requiredData,
                defaultMode: (args.defaultMode as any) ?? existing.defaultMode,
                supportedModes: (args.supportedModes as any) ?? existing.supportedModes,
                queryEnabled: args.queryEnabled !== undefined ? args.queryEnabled as boolean : existing.queryEnabled,
                recommendationEnabled: args.recommendationEnabled !== undefined ? args.recommendationEnabled as boolean : existing.recommendationEnabled,
                navigationEnabled: args.navigationEnabled !== undefined ? args.navigationEnabled as boolean : existing.navigationEnabled,
            };

            if (!args.confirm) {
                return {
                    message: "PREVIEW ONLY",
                    preview: `# Updated Skill Preview\n\nName:\n\`${name}\`\n\nPurpose:\n${updated.description}\n\nAnalysis:\n- ${updated.analysisModules.join('\n- ')}\n\nSave this update?`
                };
            }

            const repo = getCustomSkillRepository();
            repo.update(updated);
            InternalSkillRegistry.loadFromDatabase();

            return { message: `Custom skill '/${name}' updated successfully.` };
        },
        summarise: result => (result as any).message
    });

    registerTool(server, {
        name: 'kaarflow_duplicate_skill',
        title: 'Duplicate Skill',
        description: 'Creates a custom skill based on an existing builtin or custom skill.',
        group: 'analysis',
        inputSchema: {
            sourceName: z.string(),
            newName: z.string(),
            confirm: z.boolean().default(false)
        },
        audit: { category: 'maintenance', action: 'Duplicate skill', subject: skillAuditSubject },
        handler: async args => {
            const sourceName = args.sourceName as string;
            const newName = args.newName as string;

            if (!/^[a-z0-9-]+$/.test(newName)) throw new AppError('INVALID_INPUT', `New name must be kebab-case: ${newName}`);
            if (InternalSkillRegistry.hasSkill(newName)) throw new AppError('INVALID_INPUT', `Skill '${newName}' already exists.`);

            const existing = InternalSkillRegistry.getSkill(sourceName);
            if (!existing) throw new AppError('NOT_FOUND', `Source skill '${sourceName}' not found.`);

            const duplicate: SkillDefinition = {
                ...existing,
                id: `custom-${newName}`,
                name: newName,
                type: 'custom',
                status: 'active'
            };

            if (!args.confirm) {
                return {
                    message: "PREVIEW ONLY",
                    preview: `Are you sure you want to duplicate /${sourceName} to /${newName}?`
                };
            }

            const repo = getCustomSkillRepository();
            repo.insert(duplicate);
            InternalSkillRegistry.loadFromDatabase();

            return { message: `Skill /${sourceName} duplicated to /${newName} successfully.` };
        },
        summarise: result => (result as any).message
    });
}

function persistNewCustomSkill(definition: SkillDefinition): void {
    getCustomSkillRepository().insert(definition);
    InternalSkillRegistry.loadFromDatabase();
}
