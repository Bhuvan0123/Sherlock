import { AppError } from '../utils/errors.js';
import type { SkillDefinition } from './skill-definition.js';
import { InternalSkillRegistry } from './skill-registry.js';
import { AnalysisModuleRegistry, type Finding, type Recommendation } from './analysis-module.js';
import { registerPilotModules } from './modules/index.js';

try {
    registerPilotModules();
} catch {
    // already registered
}

const PRIORITY_RANK: Record<Recommendation['priority'], number> = { high: 0, medium: 1, low: 2 };
const SEVERITY_RANK: Record<Finding['severity'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    informational: 4
};

/** Longest phrases first so "sprint health" wins over "sprint". */
const SKILL_PHRASES: [string, string][] = [
    ['deadline-risk-analysis', 'deadline-risk-analysis'],
    ['sprint-health-analysis', 'sprint-health-analysis'],
    ['backlog-data-quality', 'backlog-data-quality'],
    ['workload-analysis', 'workload-analysis'],
    ['daily-standup-starter', 'daily-standup-starter'],
    ['stale-work-analysis', 'stale-work-analysis'],
    ['project-health-analysis', 'project-health-analysis'],
    ['dependency-analysis', 'dependency-analysis'],
    ['daily standup', 'daily-standup-starter'],
    ['sprint health', 'sprint-health-analysis'],
    ['sprint performance', 'sprint-health-analysis'],
    ['sprint delivery', 'sprint-health-analysis'],
    ['compare this sprint', 'sprint-health-analysis'],
    ['previous sprint', 'sprint-health-analysis'],
    ['last sprint', 'sprint-health-analysis'],
    ['backlog quality', 'backlog-data-quality'],
    ['delivery risk', 'deadline-risk-analysis'],
    ['workload analysis', 'workload-analysis'],
    ['stale work', 'stale-work-analysis'],
    ['deadline risk', 'deadline-risk-analysis'],
    ['overdue work', 'deadline-risk-analysis'],
    ['blocked work', 'dependency-analysis']
];

const MODULE_PHRASES: [string, string][] = [
    ['stale-work', 'stale-work'],
    ['stale work', 'stale-work'],
    ['team-capacity', 'team-capacity'],
    ['delivery-forecast', 'delivery-forecast'],
    ['hierarchy', 'hierarchy'],
    ['high priority', 'assignment'],
    ['unassigned', 'assignment'],
    ['assignment', 'assignment'],
    ['productivity', 'productivity'],
    ['dependency', 'dependency'],
    ['backlog', 'backlog'],
    ['workload', 'workload'],
    ['deadline', 'deadline'],
    ['sprint', 'sprint'],
    ['risk', 'risk']
];

export interface CompositionInput {
    name: string;
    description?: string;
    sourceSkills?: string[];
    modules?: string[];
    request?: string;
    recommendationEnabled?: boolean;
    queryEnabled?: boolean;
    navigationEnabled?: boolean;
}

export interface CompositionResult {
    definition: SkillDefinition;
    sourceSkills: string[];
    resolvedModules: string[];
    requiredData: string[];
}

export function slugifySkillName(raw: string): string {
    const slug = raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug;
}

export function parseCompositionRequest(request: string): { sourceSkills: string[]; modules: string[] } {
    let remaining = ` ${request.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    const sourceSkills: string[] = [];
    const modules: string[] = [];

    for (const [phrase, skill] of SKILL_PHRASES) {
        const needle = phrase.replace(/-/g, ' ');
        if (remaining.includes(` ${needle} `)) {
            sourceSkills.push(skill);
            remaining = remaining.split(needle).join(' ');
        }
    }
    for (const [phrase, mod] of MODULE_PHRASES) {
        const needle = phrase.replace(/-/g, ' ');
        if (remaining.includes(` ${needle} `)) {
            modules.push(mod);
            remaining = remaining.split(needle).join(' ');
        }
    }
    return { sourceSkills: unique(sourceSkills), modules: unique(modules) };
}

export function resolveSkillModules(skillName: string): string[] {
    const skill = InternalSkillRegistry.getSkill(skillName);
    if (!skill) {
        throw new AppError('NOT_FOUND', `Skill ${skillName} was not found.`);
    }
    if (skill.status === 'disabled') {
        throw new AppError('INVALID_INPUT', `Skill ${skillName} is disabled.`);
    }
    return [...skill.analysisModules];
}

export function composeSkillDefinition(input: CompositionInput): CompositionResult {
    const name = slugifySkillName(input.name);
    if (!/^[a-z0-9-]+$/.test(name)) {
        throw new AppError('INVALID_INPUT', `Skill name must be lowercase kebab-case: ${input.name}`);
    }

    const parsed = input.request ? parseCompositionRequest(input.request) : { sourceSkills: [], modules: [] };
    const sourceSkills = unique([...(input.sourceSkills ?? []), ...parsed.sourceSkills]);
    const extraModules = unique([...(input.modules ?? []), ...parsed.modules]);

    const collected: string[] = [];
    for (const source of sourceSkills) {
        if (AnalysisModuleRegistry.has(source) && !InternalSkillRegistry.hasSkill(source)) {
            collected.push(source);
            continue;
        }
        collected.push(...resolveSkillModules(source));
    }
    for (const mod of extraModules) {
        if (!AnalysisModuleRegistry.has(mod)) {
            throw new AppError('INVALID_INPUT', `This capability is not currently available: ${mod}`);
        }
        collected.push(mod);
    }

    if (collected.length === 0) {
        throw new AppError('INVALID_INPUT', 'Composition requires at least one existing skill or analysis module.');
    }

    let resolvedModules: string[];
    try {
        resolvedModules = unique(AnalysisModuleRegistry.resolveDependencies(unique(collected)));
    } catch (error) {
        if (error instanceof AppError && error.code === 'NOT_FOUND') {
            throw new AppError('INVALID_INPUT', `This capability is not currently available.`);
        }
        throw error;
    }

    const requiredData = unique(
        resolvedModules.flatMap(id => AnalysisModuleRegistry.get(id).requiredData)
    );

    const description =
        input.description?.trim() ||
        `Composed team review from ${sourceSkills.length > 0 ? sourceSkills.join(', ') : resolvedModules.join(', ')}.`;

    const definition: SkillDefinition = {
        id: `custom-${name}`,
        name,
        type: 'custom',
        description,
        defaultMode: 'brief',
        supportedModes: ['brief', 'verbose', 'visual'],
        requiredContext: ['team', 'currentSprint'],
        requiredData,
        analysisModules: resolvedModules,
        recommendationEnabled: input.recommendationEnabled ?? true,
        queryEnabled: input.queryEnabled ?? true,
        navigationEnabled: input.navigationEnabled ?? true,
        status: 'active'
    };

    return { definition, sourceSkills, resolvedModules, requiredData };
}

export function formatCompositionPreview(result: CompositionResult): string {
    const d = result.definition;
    return [
        '# Skill Composition Preview',
        '',
        'Name:',
        d.name,
        '',
        'Purpose:',
        d.description,
        '',
        'Modules:',
        ...d.analysisModules.map(m => `- ${m}`),
        '',
        'Recommendations:',
        d.recommendationEnabled ? 'Enabled' : 'Disabled',
        '',
        'Queries:',
        d.queryEnabled ? 'Enabled' : 'Disabled',
        '',
        'Navigation:',
        d.navigationEnabled ? 'Enabled' : 'Disabled',
        '',
        'Modes:',
        'brief',
        'verbose',
        'visual',
        '',
        'Estimated execution:',
        'Shared data reused across modules.',
        '',
        'Save this skill?'
    ].join('\n');
}

export function mergeFindings(findings: Finding[]): Finding[] {
    const byKey = new Map<string, Finding>();
    const order: Finding[] = [];
    for (const finding of findings) {
        const key = findingKey(finding);
        const existing = byKey.get(key);
        if (!existing) {
            const copy = { ...finding, evidence: [...finding.evidence], workItemIds: [...finding.workItemIds] };
            byKey.set(key, copy);
            order.push(copy);
            continue;
        }
        existing.count = Math.max(existing.count, finding.count);
        existing.evidence.push(...finding.evidence);
        existing.workItemIds = uniqueNumbers([...existing.workItemIds, ...finding.workItemIds]);
        if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) {
            existing.severity = finding.severity;
        }
    }
    return order.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
}

export function mergeRecommendations(recommendations: Recommendation[]): Recommendation[] {
    const byKey = new Map<string, Recommendation>();
    for (const rec of recommendations) {
        const key = normalizeAction(rec.action);
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, { ...rec });
            continue;
        }
        if (PRIORITY_RANK[rec.priority] < PRIORITY_RANK[existing.priority]) {
            existing.priority = rec.priority;
        }
        if ((rec.confidence ?? 0) > (existing.confidence ?? 0)) {
            existing.confidence = rec.confidence;
            existing.reason = rec.reason;
        }
    }
    return [...byKey.values()].sort((a, b) => {
        const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (p !== 0) return p;
        return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
}

export function queryFingerprint(workItemIds: number[]): string {
    return uniqueNumbers(workItemIds).join(',');
}

function findingKey(finding: Finding): string {
    const ids = uniqueNumbers(finding.workItemIds);
    if (ids.length > 0) return `ids:${ids.join(',')}`;
    return `title:${normalizeAction(finding.title)}`;
}

function normalizeAction(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function uniqueNumbers(values: number[]): number[] {
    return [...new Set(values)].sort((a, b) => a - b);
}

const AMBIGUOUS = /\b(management report|status report|give me a report|how are we doing|overview of everything)\b/i;

export interface IntentResolution {
    ambiguous: boolean;
    message: string;
    sourceSkills: string[];
    modules: string[];
    persist: boolean;
}

export function resolveNaturalLanguageIntent(request: string): IntentResolution {
    const parsed = parseCompositionRequest(request);
    const slipping = /\b(slipping|why.*sprint|behind schedule|carry[- ]over)\b/i.test(request);
    if (slipping) {
        return {
            ambiguous: false,
            persist: false,
            sourceSkills: ['sprint-health-analysis', 'deadline-risk-analysis', 'dependency-analysis', 'workload-analysis'],
            modules: ['sprint', 'deadline', 'dependency', 'workload', 'risk'],
            message:
                'Recommended analysis (not saved): sprint health, deadlines, dependencies, workload and delivery risk. Say if you want this saved as a custom skill.'
        };
    }
    if (AMBIGUOUS.test(request) && parsed.sourceSkills.length === 0 && parsed.modules.length <= 1) {
        return {
            ambiguous: true,
            persist: false,
            sourceSkills: [],
            modules: [],
            message:
                'That request is too broad to save as a skill. Choose an area: sprint, workload, backlog quality, deadlines, or a morning brief — or name the skills to combine.'
        };
    }
    return {
        ambiguous: false,
        persist: parsed.sourceSkills.length + parsed.modules.length > 0,
        sourceSkills: parsed.sourceSkills,
        modules: parsed.modules,
        message:
            parsed.sourceSkills.length + parsed.modules.length === 0
                ? 'No matching KaarFlow capability. Try sprint health, workload, backlog quality, or stale work.'
                : `Matched: ${[...parsed.sourceSkills, ...parsed.modules].join(', ')}.`
    };
}

export function formatCapabilityCatalogue(custom: { name: string; description: string; status: string }[]): string {
    const groups: { title: string; items: string[] }[] = [
        { title: 'Team', items: ['daily-standup-starter', 'team-morning-brief', 'daily-team-report', 'weekly-team-review'] },
        { title: 'Sprint', items: ['sprint-health-analysis'] },
        { title: 'Backlog', items: ['backlog-data-quality', 'hierarchy-health-analysis'] },
        { title: 'Workload', items: ['workload-analysis', 'work-assignment-recommendation'] },
        { title: 'Risk', items: ['deadline-risk-analysis', 'stale-work-analysis'] },
        { title: 'Quality', items: ['backlog-data-quality', 'schedule-variance-analysis'] },
        { title: 'Dependencies', items: ['dependency-analysis'] },
        { title: 'Productivity', items: ['team-productivity-review', 'tl-productivity-review'] },
        { title: 'Delivery', items: ['delivery-forecast', 'project-health-analysis'] }
    ];
    const lines = ['# What KaarFlow can analyse', ''];
    for (const group of groups) {
        lines.push(`## ${group.title}`);
        for (const name of group.items) {
            const skill = InternalSkillRegistry.getSkill(name);
            lines.push(`- /${name}${skill ? ` — ${skill.description}` : ''}`);
        }
        lines.push('');
    }
    lines.push('## My Skills');
    if (custom.length === 0) lines.push('No custom skills.');
    for (const s of custom) {
        lines.push(`- /${s.name} (${s.status}) — ${s.description}`);
    }
    lines.push('');
    lines.push('Ask to run a named skill. Work items stay read-only.');
    return lines.join('\n');
}
