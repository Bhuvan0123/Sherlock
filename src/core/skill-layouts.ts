import type { Finding, Recommendation } from './analysis-module.js';
import type { SkillExecutionResult } from './skill-executor.js';

export interface SkillContextLabel {
    organization: string;
    project: string;
    team: string;
    sprint: string | null;
    daysRemaining: number | null;
    date: string;
}

const SEVERITY_MARK: Record<Finding['severity'], string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
    informational: '🔵'
};

function isPrimitive(value: unknown): value is string | number | boolean {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
}

function flattenSummary(summaries: SkillExecutionResult['summaries']): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const sum of Object.values(summaries)) {
        Object.assign(out, sum);
    }
    return out;
}

function reviewish(summaries: SkillExecutionResult['summaries']): Record<string, unknown> {
    return (summaries.review as Record<string, unknown> | undefined) ?? flattenSummary(summaries);
}

function pick(source: Record<string, unknown>, keys: [string, string][]): [string, string][] {
    const rows: [string, string][] = [];
    for (const [label, key] of keys) {
        const value = source[key];
        if (value === undefined || value === null || typeof value === 'object') continue;
        rows.push([label, String(value)]);
    }
    return rows;
}

function kpiTable(rows: [string, string][]): string[] {
    if (rows.length === 0) return [];
    const lines = ['| KPI | Value |', '|---|---:|'];
    for (const [k, v] of rows) lines.push(`| ${k} | ${v} |`);
    return lines;
}

function header(title: string, ctx: SkillContextLabel | undefined, extra: string[] = []): string[] {
    const lines = [`# ${title}`, ''];
    if (ctx) {
        const bits = [`${ctx.project} / ${ctx.team}`];
        if (ctx.sprint) bits.push(`Sprint ${ctx.sprint}`);
        if (ctx.daysRemaining != null) bits.push(`${ctx.daysRemaining} days remaining`);
        bits.push(ctx.date);
        lines.push(bits.join(' · '));
        lines.push('');
    }
    lines.push(...extra);
    return lines;
}

function topFindings(findings: Finding[], n: number): string[] {
    const lines = ['### Attention'];
    const top = findings.slice(0, n);
    if (top.length === 0) {
        lines.push('None.');
        return lines;
    }
    for (const f of top) {
        lines.push(`- ${SEVERITY_MARK[f.severity]} ${f.title} (${f.count})`);
    }
    return lines;
}

function recLines(recs: Recommendation[], n?: number): string[] {
    const list = n === undefined ? recs : recs.slice(0, n);
    const lines = ['### Recommended Actions'];
    if (list.length === 0) {
        lines.push('None.');
        return lines;
    }
    for (const r of list) {
        const when = r.timeframe ? ` (${r.timeframe})` : '';
        lines.push(`- ${r.action}${when}`);
        if (r.reason) lines.push(`  - ${r.reason}`);
    }
    return lines;
}

function queryLines(
    queries: SkillExecutionResult['queries'],
    limit?: number,
    heading = '### Navigate'
): string[] {
    const list = limit === undefined ? queries : queries.slice(0, limit);
    if (list.length === 0) return [];
    const lines = [heading];
    for (const q of list) {
        lines.push(`- [🔗 ${q.title} (${q.count})](${q.url})`);
    }
    return lines;
}

function findingsVerbose(findings: Finding[]): string[] {
    const lines = ['### Findings'];
    if (findings.length === 0) {
        lines.push('None.');
        return lines;
    }
    for (const f of findings) {
        lines.push(`- **${f.title}** — ${SEVERITY_MARK[f.severity]} ${f.severity}, count ${f.count}`);
        if (f.evidence?.length) {
            const ev = f.evidence.slice(0, 4).map(e => String(e)).filter(s => s && s !== '[object Object]');
            if (ev.length) lines.push(`  - Evidence: ${ev.join('; ')}`);
        }
        if (f.workItemIds.length > 0 && f.workItemIds.length <= 3) {
            lines.push(`  - Items: ${f.workItemIds.map(id => `#${id}`).join(', ')}`);
        } else if (f.workItemIds.length > 3) {
            lines.push(`  - ${f.workItemIds.length} items (query when available)`);
        }
    }
    return lines;
}

function findingsTable(findings: Finding[], max?: number): string[] {
    const list = max === undefined ? findings : findings.slice(0, max);
    if (list.length === 0) return ['### Findings', 'None.'];
    const lines = ['### Findings', '| Severity | Title | Count |', '|---|---|---:|'];
    for (const f of list) {
        lines.push(`| ${SEVERITY_MARK[f.severity]} ${f.severity} | ${f.title} | ${f.count} |`);
    }
    return lines;
}

function navTable(queries: SkillExecutionResult['queries']): string[] {
    if (queries.length === 0) return [];
    const lines = [
        '### Navigate',
        '| Finding | Count | Link |',
        '|---|---:|---|'
    ];
    for (const q of queries) {
        lines.push(`| ${q.title} | ${q.count} | [Open](${q.url}) |`);
    }
    return lines;
}

function memberTable(members: unknown): string[] {
    if (!Array.isArray(members) || members.length === 0) return [];
    const lines = ['### Workload', '| Member | Open | Active | Proposed |', '|---|---:|---:|---:|'];
    for (const row of members) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const name =
            str(r.member) ??
            (r.member && typeof r.member === 'object'
                ? str((r.member as { displayName?: string }).displayName)
                : null) ??
            str(r.name) ??
            'Unknown';
        const open = num(r.open) ?? num(r.assignedOpen) ?? num((r.counts as { assignedOpen?: number } | undefined)?.assignedOpen) ?? '—';
        const active = num(r.active) ?? num((r.counts as { active?: number } | undefined)?.active) ?? '—';
        const proposed = num(r.proposed) ?? num((r.counts as { proposed?: number } | undefined)?.proposed) ?? '—';
        lines.push(`| ${name} | ${open} | ${active} | ${proposed} |`);
    }
    return lines;
}

function deadlineTypeTable(source: Record<string, unknown>): string[] {
    const rows: [string, unknown][] = [
        ['Due Date', source.overdueDueDate ?? source.overdue],
        ['Planned End', source.overduePlannedEnd],
        ['Sprint overdue', source.overdueSprint],
        ['Historical missed deadline', source.overdueHistorical]
    ];
    if (rows.every(([, v]) => v === undefined || v === null)) return [];
    const lines = [
        '### Deadline types',
        '| Deadline Type | Count |',
        '|---|---:|'
    ];
    for (const [label, value] of rows) {
        lines.push(`| ${label} | ${value ?? 0} |`);
    }
    const due = num(source.overdueDueDate ?? source.overdue) ?? 0;
    const planned = num(source.overduePlannedEnd) ?? 0;
    if (due === 0 && planned > 0) {
        lines.push('');
        lines.push(
            `0 Due Date overdue does not mean there are no schedule risks; ${planned} items have passed Planned End.`
        );
    }
    return lines;
}

function sprintHealthLabel(source: Record<string, unknown>): string {
    const current = source.current as { completionRate?: number; blockedRate?: number } | undefined;
    const completion = num(current?.completionRate) ?? num(source.completion);
    const blocked = num(source.blocked);
    if (completion != null && completion < 50) return '🔴 At Risk — completion is below 50%.';
    if (blocked != null && blocked > 5) return '🔴 At Risk — blocked work is high.';
    if (completion != null && completion < 70) return `🟠 Needs Attention — completion is ${completion}%.`;
    if (completion != null) return `🟢 Healthy — completion is ${completion}%.`;
    return '🔵 Information — completion rate is not available.';
}

function assumptions(): string[] {
    return [
        '### Assumptions',
        '- Counts are live Azure DevOps reads for the configured organization, project and team.',
        '- Overdue Due Date, Planned End, Sprint overdue and Historical overdue are separate rules.',
        '- Recommendations do not change work items.'
    ];
}

function footer(): string[] {
    return ['', '**ADO Work Items Modified: No**'];
}

function standupKpis(source: Record<string, unknown>): [string, string][] {
    const members = Array.isArray(source.members) ? source.members.length : num(source.members);
    const rows: [string, string][] = [];
    if (members != null) rows.push(['Members', String(members)]);
    rows.push(
        ...pick(source, [
            ['Active', 'active'],
            ['Proposed', 'proposed'],
            ['Blocked', 'blocked'],
            ['Due-date overdue', 'overdueDueDate'],
            ['Planned-end overdue', 'overduePlannedEnd'],
            ['Unassigned', 'unassigned']
        ])
    );
    const completion = num(source.completion);
    if (completion != null) rows.push(['Sprint completion', `${completion}%`]);
    return rows;
}

function noJsonDump(summaries: SkillExecutionResult['summaries']): string[] {
    const lines = ['### Summary'];
    for (const [mod, sum] of Object.entries(summaries)) {
        const parts: string[] = [];
        for (const [k, v] of Object.entries(sum)) {
            if (isPrimitive(v)) parts.push(`${k} ${v}`);
            else if (Array.isArray(v)) parts.push(`${k} ${v.length} rows`);
        }
        if (parts.length) lines.push(`- ${mod}: ${parts.join(', ')}`);
    }
    if (lines.length === 1) lines.push('No scalar KPIs.');
    return lines;
}

export function formatSkillMarkdown(result: SkillExecutionResult, ctx?: SkillContextLabel): string {
    const { skillName, mode, summaries, findings, recommendations, queries } = result;
    const source = reviewish(summaries);
    const titleMap: Record<string, string> = {
        'daily-standup-starter': 'Daily Standup',
        'team-morning-brief': 'Morning Brief',
        'weekly-team-review': 'Weekly Team Review',
        'daily-team-report': 'Daily Team Report',
        'workload-analysis': 'Workload Analysis',
        'backlog-data-quality': 'Backlog Data Quality',
        'sprint-health-analysis': 'Sprint Health',
        'deadline-risk-analysis': 'Deadline Risk',
        'stale-work-analysis': 'Stale Work',
        'dependency-analysis': 'Dependency Analysis',
        'delivery-forecast': 'Delivery Forecast',
        'hierarchy-health-analysis': 'Hierarchy Health',
        'schedule-variance-analysis': 'Schedule Variance',
        'project-health-analysis': 'Project Health',
        'team-productivity-review': 'Team Productivity',
        'tl-productivity-review': 'Team Lead Review',
        'work-assignment-recommendation': 'Assignment Recommendations'
    };
    const title = titleMap[skillName] ?? skillName.replace(/-/g, ' ');
    const findingCap = skillName === 'project-health-analysis' ? 5 : mode === 'brief' ? 3 : undefined;
    const recCap = mode === 'brief' ? 3 : undefined;
    const queryCap = mode === 'brief' ? 3 : undefined;

    const lines: string[] = [];

    if (mode === 'brief') {
        if (skillName === 'daily-standup-starter') {
            lines.push(...header('🌅 Daily Standup', ctx));
            const sprint = str(source.sprint) ?? ctx?.sprint;
            const team = str(source.team) ?? ctx?.team;
            if (sprint) lines.push(`Sprint: ${sprint}`);
            if (team) lines.push(`Team: ${team}`);
            if (ctx?.daysRemaining != null || source.daysRemaining != null) {
                lines.push(`Days remaining: ${source.daysRemaining ?? ctx?.daysRemaining}`);
            }
            lines.push('');
            lines.push(...kpiTable(standupKpis(source)));
            lines.push('', ...topFindings(findings, 3));
            lines.push('', ...recLines(recommendations, 3));
            lines.push('', ...queryLines(queries, 3, '### Important Queries'));
        } else if (skillName === 'deadline-risk-analysis') {
            lines.push(...header(title, ctx));
            lines.push(...kpiTable(standupKpis(source)));
            lines.push('', ...deadlineTypeTable((summaries.deadline as Record<string, unknown>) ?? source));
            lines.push('', ...topFindings(findings, 3));
            lines.push('', ...recLines(recommendations, 3));
            lines.push('', ...queryLines(queries, 3));
        } else if (skillName === 'sprint-health-analysis') {
            lines.push(...header(title, ctx));
            lines.push(`**Sprint Health:** ${sprintHealthLabel((summaries.sprint as Record<string, unknown>) ?? source)}`);
            lines.push('');
            const sprint = (summaries.sprint as Record<string, unknown>) ?? {};
            const current = sprint.current as Record<string, unknown> | undefined;
            const comparison = sprint.comparison as { completionRateChangePp?: number } | undefined;
            const kpi: [string, string][] = [];
            if (str(sprint.currentSprint) ?? ctx?.sprint) kpi.push(['Current sprint', String(sprint.currentSprint ?? ctx?.sprint)]);
            const completion = num(current?.completionRate) ?? num(source.completion);
            if (completion != null) kpi.push(['Completion', `${completion}%`]);
            if (comparison?.completionRateChangePp != null) {
                kpi.push(['vs previous sprint', `${comparison.completionRateChangePp} percentage points`]);
            }
            if (kpi.length === 0) kpi.push(...standupKpis(source));
            lines.push(...kpiTable(kpi));
            lines.push('', ...topFindings(findings, 3));
            lines.push('', ...recLines(recommendations, 3));
            lines.push('', ...queryLines(queries, 3));
        } else if (skillName === 'work-assignment-recommendation') {
            lines.push(...header(title, ctx));
            lines.push(...kpiTable(pick(source, [['Unassigned', 'unassigned'], ['Suggestions', 'suggestions']])));
            lines.push('', ...assignmentTable(summaries));
            lines.push('', ...recLines(recommendations, 3));
            lines.push('', 'Recommendation only — no ADO assignment was changed.');
            lines.push('', ...queryLines(queries, 3));
        } else if (skillName === 'delivery-forecast') {
            lines.push(...header(title, ctx));
            const fc = (summaries['delivery-forecast'] as Record<string, unknown>) ?? source;
            lines.push('**Forecast:** historical throughput only — not a promised delivery date.');
            lines.push(`**Confidence:** ${str(fc.confidence) ?? 'Low unless completion history is dense.'}`);
            const fcKpi = pick(fc, [
                ['Completed (window)', 'completedCount'],
                ['Throughput', 'throughputPerWeek'],
                ['Remaining', 'remaining']
            ]);
            lines.push('', ...kpiTable(fcKpi.length ? fcKpi : standupKpis(source)));
            lines.push('', ...topFindings(findings, 3));
            lines.push('', ...recLines(recommendations, 3));
        } else if (skillName === 'project-health-analysis') {
            lines.push(...header(title, ctx));
            lines.push(`**Overall Health:** ${sprintHealthLabel(flattenSummary(summaries))}`);
            lines.push('', ...kpiTable(standupKpis(flattenSummary(summaries))));
            lines.push('', ...topFindings(findings, 5));
            lines.push('', ...recLines(recommendations, 3));
            lines.push('', ...queryLines(queries, 3));
        } else if (skillName === 'weekly-team-review') {
            lines.push(...header(title, ctx));
            lines.push(...kpiTable(standupKpis(source)));
            lines.push('', '### Wins / Risks');
            lines.push(...topFindings(findings, 3).slice(1));
            lines.push('', ...recLines(recommendations, 3));
            lines.push('', '### Next-week focus');
            lines.push(recommendations[0]?.action ?? 'Protect sprint completion and unblock the top dependency.');
            lines.push('', ...queryLines(queries, 3));
        } else if (skillName === 'team-morning-brief') {
            lines.push(...header(title, ctx));
            lines.push('Focus: today, immediate deadlines, blocked work, high-priority exceptions.');
            lines.push('', ...kpiTable(standupKpis(source)));
            lines.push('', ...topFindings(findings, 3));
            lines.push('', ...recLines(recommendations, 3));
            lines.push('', ...queryLines(queries, 3));
        } else if (skillName === 'tl-productivity-review') {
            lines.push(...header(title, ctx));
            lines.push(...kpiTable(standupKpis(source)));
            lines.push('', '### What is going well');
            lines.push(findings.length === 0 ? '- No high-severity findings in this snapshot.' : '- Delivery signals are listed below; treat counts as management load, not personal judgement.');
            lines.push('', ...topFindings(findings, 3));
            lines.push('', '### TL actions');
            lines.push(...recLines(recommendations, 3).slice(1));
            lines.push('', ...queryLines(queries, 3));
        } else {
            lines.push(...header(title, ctx));
            const kpiSource = flattenSummary(summaries);
            const generic = pick(kpiSource, [
                ['Team', 'team'],
                ['Members', 'members'],
                ['Active', 'active'],
                ['Unassigned', 'unassigned'],
                ['Blocked', 'blocked'],
                ['Stale count', 'count'],
                ['Issues found', 'issuesFound'],
                ['Total analysed', 'totalAnalyzed']
            ]);
            lines.push(...kpiTable(generic.length ? generic : standupKpis(kpiSource)));
            lines.push('', ...topFindings(findings, 3));
            lines.push('', ...recLines(recommendations, 3));
            lines.push('', ...queryLines(queries, 3));
        }
    } else if (mode === 'verbose') {
        lines.push(...header(title, ctx));
        lines.push(...noJsonDump(summaries));
        if (skillName === 'deadline-risk-analysis' || summaries.deadline) {
            lines.push('', ...deadlineTypeTable((summaries.deadline as Record<string, unknown>) ?? source));
        }
        if (skillName === 'sprint-health-analysis') {
            lines.push('', `**Sprint Health:** ${sprintHealthLabel((summaries.sprint as Record<string, unknown>) ?? {})}`);
            const cmp = (summaries.sprint as { comparison?: { completionRateChangePp?: number; previous?: { completionRate?: number }; current?: { completionRate?: number } } })
                ?.comparison;
            if (cmp?.completionRateChangePp != null) {
                lines.push(
                    `Completion ${cmp.previous?.completionRate}% → ${cmp.current?.completionRate}% = ${cmp.completionRateChangePp} percentage points (not a relative percent).`
                );
            }
        }
        lines.push('', ...findingsVerbose(findings));
        if (skillName === 'daily-standup-starter' || skillName === 'workload-analysis') {
            lines.push('', ...memberTable(source.members ?? (summaries.workload as { distribution?: unknown })?.distribution));
        }
        if (skillName === 'tl-productivity-review') {
            lines.push('', '### Delegation opportunities');
            lines.push('- Move lower-priority active work from the most loaded owners if capacity exists elsewhere.');
            lines.push('', '### Follow-up opportunities');
            lines.push('- Overdue, blocked and unassigned items are the first follow-ups.');
        }
        lines.push('', ...recLines(recommendations, recCap));
        lines.push('', ...assumptions());
        lines.push('', ...queryLines(queries, queryCap));
        if (skillName === 'work-assignment-recommendation') {
            lines.push('', 'Recommendation only — no ADO assignment was changed.');
        }
    } else {
        lines.push(...header(title, ctx));
        if (skillName === 'sprint-health-analysis' || skillName === 'project-health-analysis') {
            lines.push(`**Health:** ${sprintHealthLabel(flattenSummary(summaries))}`, '');
        }
        if (skillName === 'deadline-risk-analysis' || summaries.deadline) {
            lines.push(...deadlineTypeTable((summaries.deadline as Record<string, unknown>) ?? source), '');
        }
        const kpiSource = skillName === 'daily-standup-starter' ? source : flattenSummary(summaries);
        lines.push('### KPI');
        let visualKpis = standupKpis(kpiSource);
        if (visualKpis.length === 0) {
            visualKpis = pick(kpiSource, [
                ['Count', 'count'],
                ['Unassigned', 'unassigned'],
                ['Blocked', 'blocked'],
                ['Completed (window)', 'completedCount'],
                ['Throughput / week', 'throughputPerWeek'],
                ['Confidence', 'confidence']
            ]);
        }
        if (visualKpis.length === 0) visualKpis = [['Status', 'No additional KPI scalars']];
        lines.push(...kpiTable(visualKpis));
        if (skillName === 'work-assignment-recommendation') {
            lines.push('', ...assignmentTable(summaries));
        }
        const members = source.members ?? (summaries.workload as { distribution?: unknown } | undefined)?.distribution;
        if (skillName === 'daily-standup-starter' || skillName === 'workload-analysis') {
            lines.push('', ...memberTable(members));
        }
        lines.push('', ...findingsTable(findings, findingCap));
        lines.push('', ...recLines(recommendations, recCap));
        lines.push('', ...navTable(queries));
        if (skillName === 'work-assignment-recommendation') {
            lines.push('', 'Recommendation only — no ADO assignment was changed.');
        }
    }

    lines.push(...footer());
    return lines.filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');
}

function assignmentTable(summaries: SkillExecutionResult['summaries']): string[] {
    const rows = (summaries.assignment as { rows?: unknown } | undefined)?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const lines = [
        '| Work Item | Recommended Owner | Reason | Confidence |',
        '|---|---|---|---|'
    ];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        lines.push(
            `| #${r.id ?? ''} | ${r.owner ?? '—'} | ${r.reason ?? ''} | ${r.confidence ?? '—'} |`
        );
    }
    return lines;
}
