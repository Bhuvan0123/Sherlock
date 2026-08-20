import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECT_ROOT } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skills');

/** Directory holding one sub-directory per skill, each with a SKILL.md. */
export const SKILLS_DIRECTORY = resolve(PROJECT_ROOT, 'skills');
/** Directory holding custom JSON skills */
export const CUSTOM_SKILLS_DIRECTORY = resolve(SKILLS_DIRECTORY, 'custom');

export const SKILL_CATEGORIES = ['briefing', 'analysis', 'recommendation', 'communication', 'report', 'router'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/**
 * The H2 sections every SKILL.md must define, in this order. Enforced by
 * `validateSkills` so a skill can never ship half-specified.
 */
export const REQUIRED_SECTIONS = [
    'Purpose',
    'When to Use',
    'Required Inputs',
    'Data Sources',
    'Workflow',
    'Analysis Rules',
    'Output Format',
    'Edge Cases',
    'Safety Rules',
    'Example Requests'
] as const;

export interface Skill {
    name: string;
    title: string;
    description: string;
    version: string;
    category: SkillCategory;
    /** Always false: no skill may change Azure DevOps. Verified by validation. */
    mutatesAzureDevOps: boolean;
    /** True for skills that can lead to an email send, which is confirmation-gated. */
    requiresConfirmation: boolean;
    /** MCP tools the skill's main path calls. Every name must exist. */
    primaryTools: string[];
    /** MCP tools used for drill-down or fallback. Every name must exist. */
    supportingTools: string[];
    /** Capabilities the skill would want but neither this server nor Azure DevOps provides. */
    missingCapabilities: string[];
    /** Natural-language phrases that should route to this skill. */
    triggers: string[];
    /** Repository-relative path, for documentation and error messages. */
    path: string;
    /** The markdown body below the frontmatter. */
    body: string;
    /** H2 headings in document order. */
    headings: string[];
    /** H2 heading to its content. */
    sections: Record<string, string>;
}

export interface SkillValidationIssue {
    skill: string;
    reason: string;
}

const FRONTMATTER_DELIMITER = '---';

/**
 * Minimal YAML reader for skill frontmatter.
 *
 * Deliberately not a YAML library: frontmatter is restricted to flat
 * `key: value` pairs and `- item` lists, which keeps skill files trivial to
 * hand-edit and adds no dependency. Anything more nested is a validation error
 * rather than something to interpret.
 */
function parseFrontmatter(text: string, skillPath: string): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    let currentListKey: string | null = null;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (line.trim().length === 0 || line.trim().startsWith('#')) continue;

        const listItem = /^\s+-\s+(.*)$/.exec(line);
        if (listItem) {
            if (currentListKey === null) {
                throw new AppError('INVALID_INPUT', `${skillPath}: list item "${listItem[1]}" does not belong to any key.`);
            }
            (result[currentListKey] as string[]).push(unquote(listItem[1] ?? ''));
            continue;
        }

        const pair = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
        if (!pair) {
            throw new AppError('INVALID_INPUT', `${skillPath}: cannot parse frontmatter line "${line.trim()}".`);
        }

        const [, key, rawValue] = pair;
        const value = (rawValue ?? '').trim();
        if (value.length === 0) {
            result[key!] = [];
            currentListKey = key!;
        } else {
            result[key!] = unquote(value);
            currentListKey = null;
        }
    }

    return result;
}

function unquote(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1);
        }
    }
    return trimmed;
}

function requireString(
    frontmatter: Record<string, string | string[]>,
    key: string,
    skillPath: string
): string {
    const value = frontmatter[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new AppError('INVALID_INPUT', `${skillPath}: frontmatter key "${key}" is required and must be a non-empty value.`);
    }
    return value;
}

function readList(frontmatter: Record<string, string | string[]>, key: string): string[] {
    const value = frontmatter[key];
    if (value === undefined) return [];
    return Array.isArray(value) ? value.filter(entry => entry.length > 0) : [value];
}

function readBoolean(frontmatter: Record<string, string | string[]>, key: string, skillPath: string): boolean {
    const value = frontmatter[key];
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new AppError('INVALID_INPUT', `${skillPath}: frontmatter key "${key}" must be exactly true or false.`);
}

/** Splits the markdown body into its H2 sections, preserving document order. */
function parseSections(body: string): { headings: string[]; sections: Record<string, string> } {
    const headings: string[] = [];
    const sections: Record<string, string> = {};

    let current: string | null = null;
    let buffer: string[] = [];
    const flush = (): void => {
        if (current !== null) sections[current] = buffer.join('\n').trim();
        buffer = [];
    };

    for (const line of body.split(/\r?\n/)) {
        const heading = /^##\s+(.*?)\s*$/.exec(line);
        if (heading && !line.startsWith('###')) {
            flush();
            current = heading[1] ?? '';
            headings.push(current);
            continue;
        }
        if (current !== null) buffer.push(line);
    }
    flush();

    return { headings, sections };
}

/** Parses one SKILL.md. Throws an AppError describing the file when malformed. */
export function parseSkillDocument(source: string, skillPath: string): Skill {
    const normalised = source.replace(/^\uFEFF/, '');
    if (!normalised.startsWith(FRONTMATTER_DELIMITER)) {
        throw new AppError('INVALID_INPUT', `${skillPath}: must begin with a "---" frontmatter block.`);
    }

    const end = normalised.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length);
    if (end === -1) {
        throw new AppError('INVALID_INPUT', `${skillPath}: the frontmatter block is not closed with "---".`);
    }

    const frontmatterText = normalised.slice(FRONTMATTER_DELIMITER.length, end);
    const bodyStart = normalised.indexOf('\n', end + FRONTMATTER_DELIMITER.length + 1);
    const body = (bodyStart === -1 ? '' : normalised.slice(bodyStart + 1)).trim();

    const frontmatter = parseFrontmatter(frontmatterText, skillPath);
    const { headings, sections } = parseSections(body);

    const category = requireString(frontmatter, 'category', skillPath);
    if (!(SKILL_CATEGORIES as readonly string[]).includes(category)) {
        throw new AppError(
            'INVALID_INPUT',
            `${skillPath}: category "${category}" is not one of ${SKILL_CATEGORIES.join(', ')}.`
        );
    }

    return {
        name: requireString(frontmatter, 'name', skillPath),
        title: requireString(frontmatter, 'title', skillPath),
        description: requireString(frontmatter, 'description', skillPath),
        version: requireString(frontmatter, 'version', skillPath),
        category: category as SkillCategory,
        mutatesAzureDevOps: readBoolean(frontmatter, 'mutates_azure_devops', skillPath),
        requiresConfirmation: readBoolean(frontmatter, 'requires_confirmation', skillPath),
        primaryTools: readList(frontmatter, 'primary_tools'),
        supportingTools: readList(frontmatter, 'supporting_tools'),
        missingCapabilities: readList(frontmatter, 'missing_capabilities'),
        triggers: readList(frontmatter, 'triggers'),
        path: skillPath,
        body,
        headings,
        sections
    };
}

/**
 * Reads every `skills/<name>/SKILL.md` and `skills/custom/*.json`.
 *
 * Directories beginning with `_` or `.` are shared material rather than skills
 * and are skipped, which is what keeps `skills/_shared/` out of the catalogue.
 */
export function discoverSkills(directory: string = SKILLS_DIRECTORY): Skill[] {
    if (!existsSync(directory)) {
        log.warn('No skills directory found; the skill catalogue will be empty', { directory });
        return [];
    }

    const skills: Skill[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.') || entry.name === 'custom') continue;

        const file = join(directory, entry.name, 'SKILL.md');
        if (!existsSync(file)) {
            log.warn('Skill directory has no SKILL.md and was skipped', { directory: entry.name });
            continue;
        }

        const skill = parseSkillDocument(readFileSync(file, 'utf8'), `skills/${entry.name}/SKILL.md`);
        skills.push({ ...skill, path: `skills/${entry.name}/SKILL.md` });
    }

    const customDir = join(directory, 'custom');
    if (existsSync(customDir)) {
        for (const entry of readdirSync(customDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.json')) {
                try {
                    const content = readFileSync(join(customDir, entry.name), 'utf8');
                    const skill = JSON.parse(content) as Skill;
                    // Tag it as custom so the router can differentiate if needed
                    skills.push({ ...skill, path: `skills/custom/${entry.name}` });
                } catch (error) {
                    log.error('Failed to load custom skill', { file: entry.name, error: String(error) });
                }
            }
        }
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function saveCustomSkill(skill: Skill): void {
    const customDir = join(SKILLS_DIRECTORY, 'custom');
    if (!existsSync(customDir)) {
        throw new AppError('NOT_FOUND', `Custom skills directory does not exist: ${customDir}`);
    }
    const targetFile = join(customDir, `${skill.name}.json`);
    
    // Invalidate cache
    cached = null;
    
    // Save to disk
    writeFileSync(targetFile, JSON.stringify(skill, null, 2), 'utf8');
}

export function deleteCustomSkill(name: string): void {
    const customDir = join(SKILLS_DIRECTORY, 'custom');
    const targetFile = join(customDir, `${name}.json`);
    
    if (existsSync(targetFile)) {
        unlinkSync(targetFile);
        cached = null;
    } else {
        throw new AppError('NOT_FOUND', `Custom skill not found: ${name}`);
    }
}

/**
 * Checks the catalogue against the read-only contract and the live tool surface.
 *
 * The tool-existence check is the guarantee that skills cannot document a tool
 * that does not exist: a renamed or removed tool fails the build instead of
 * producing a skill that instructs the model to call something imaginary.
 */
export function validateSkills(skills: Skill[], knownToolNames: readonly string[]): SkillValidationIssue[] {
    const issues: SkillValidationIssue[] = [];
    const known = new Set(knownToolNames);
    const seen = new Set<string>();

    for (const skill of skills) {
        const expectedPath = `skills/${skill.name}/SKILL.md`;
        if (skill.path !== expectedPath) {
            issues.push({
                skill: skill.name,
                reason: `frontmatter name "${skill.name}" does not match its directory (${skill.path}).`
            });
        }

        if (seen.has(skill.name)) {
            issues.push({ skill: skill.name, reason: 'duplicate skill name.' });
        }
        seen.add(skill.name);

        if (skill.mutatesAzureDevOps) {
            issues.push({
                skill: skill.name,
                reason: 'declares mutates_azure_devops: true, but Azure DevOps access is read-only.'
            });
        }

        if (skill.triggers.length === 0) {
            issues.push({ skill: skill.name, reason: 'defines no triggers, so it can never be routed to.' });
        }

        if (skill.primaryTools.length === 0 && skill.category !== 'router') {
            issues.push({ skill: skill.name, reason: 'defines no primary_tools.' });
        }

        for (const [index, section] of REQUIRED_SECTIONS.entries()) {
            if (!skill.headings.includes(section)) {
                issues.push({ skill: skill.name, reason: `missing required section "## ${section}".` });
                continue;
            }
            if (skill.headings[index] !== section) {
                issues.push({
                    skill: skill.name,
                    reason: `section "## ${section}" is out of order (found "${skill.headings[index] ?? 'nothing'}" at position ${index + 1}).`
                });
            }
            if ((skill.sections[section] ?? '').length === 0) {
                issues.push({ skill: skill.name, reason: `section "## ${section}" is empty.` });
            }
        }

        for (const tool of [...skill.primaryTools, ...skill.supportingTools]) {
            if (!known.has(tool)) {
                issues.push({
                    skill: skill.name,
                    reason: `references tool "${tool}", which this server does not expose.`
                });
            }
        }

        const sendsEmail = [...skill.primaryTools, ...skill.supportingTools].includes('email_send_confirmed');
        if (sendsEmail && !skill.requiresConfirmation) {
            issues.push({
                skill: skill.name,
                reason: 'references email_send_confirmed but does not declare requires_confirmation: true.'
            });
        }
    }

    return issues;
}

let cached: Skill[] | null = null;

/** The skill catalogue, read from disk once per process. */
export function getSkills(): Skill[] {
    if (cached === null) {
        cached = discoverSkills();
        log.debug('Loaded skills', { count: cached.length });
    }
    return cached;
}

export function getSkill(name: string): Skill | null {
    return getSkills().find(skill => skill.name === name) ?? null;
}

/** Test hook: inject a catalogue, or pass null to re-read from disk. */
export function setSkillsForTesting(skills: Skill[] | null): void {
    cached = skills;
}

export interface SharedRuleDocument {
    name: string;
    path: string;
    content: string;
}

let cachedSharedRules: SharedRuleDocument[] | null = null;

/**
 * The rule documents in `skills/_shared/`, which apply to every skill.
 *
 * They are returned alongside a skill by default: a skill body deliberately
 * references these rules rather than restating them, so handing over the skill
 * without them would drop its safety and data-handling constraints.
 */
export function getSharedRules(directory: string = join(SKILLS_DIRECTORY, '_shared')): SharedRuleDocument[] {
    if (cachedSharedRules !== null) return cachedSharedRules;
    if (!existsSync(directory)) {
        cachedSharedRules = [];
        return cachedSharedRules;
    }

    cachedSharedRules = readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(entry => ({
            name: entry.name.replace(/\.md$/, ''),
            path: `skills/_shared/${entry.name}`,
            content: readFileSync(join(directory, entry.name), 'utf8').trim()
        }));

    return cachedSharedRules;
}

/** Test hook: injects shared rule documents, or pass null to re-read from disk. */
export function setSharedRulesForTesting(documents: SharedRuleDocument[] | null): void {
    cachedSharedRules = documents;
}

/** Compact catalogue entry used for routing, without the full markdown body. */
export interface SkillIndexEntry {
    name: string;
    title: string;
    description: string;
    category: SkillCategory;
    requiresConfirmation: boolean;
    triggers: string[];
    tools: string[];
}

export function toIndexEntry(skill: Skill): SkillIndexEntry {
    return {
        name: skill.name,
        title: skill.title,
        description: skill.description,
        category: skill.category,
        requiresConfirmation: skill.requiresConfirmation,
        triggers: skill.triggers,
        tools: [...skill.primaryTools, ...skill.supportingTools]
    };
}
