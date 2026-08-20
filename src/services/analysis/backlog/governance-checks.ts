import { daysBetween, parseAdoDate } from '../../../utils/dates.js';
import { RELATION } from '../../../azure-devops/fields.js';
import { relationTargetId } from '../../../azure-devops/work-item.service.js';
import type { BacklogContext, Finding } from './types.js';
import { estimateOf, isComplete, isIntentionallyWaiting, isOpen, typeKind } from './classify.js';

export function checkStatesOwnershipSprintDeps(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];
    const openItems = ctx.items.filter(isOpen);
    const byOwner = new Map<string, number>();
    for (const item of openItems) {
        if (!item.assignedTo) continue;
        byOwner.set(item.assignedTo, (byOwner.get(item.assignedTo) ?? 0) + 1);
    }
    const ownerCounts = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
    const concentrationThreshold = Math.max(8, Math.ceil(openItems.length * 0.4));

    for (const item of ctx.items) {
        const kind = typeKind(item.type);

        if (item.state.toLowerCase().includes('removed') && item.stateCategory !== 'Removed') {
            findings.push({
                itemId: item.id,
                category: 'Unexpected Removed State',
                dimension: 'state',
                issue: `State "${item.state}" looks removed but is not categorised as Removed`,
                severity: 'Low',
                reviewRecommended: true
            });
        }

        if (isOpen(item) && item.reason?.toLowerCase().includes('reopen')) {
            findings.push({
                itemId: item.id,
                category: 'Reopened Work',
                dimension: 'state',
                issue: `Reason indicates reopen: ${item.reason}`,
                severity: 'Medium',
                reviewRecommended: true
            });
        }

        const created = parseAdoDate(item.createdDate);
        if (isOpen(item) && created && daysBetween(created, ctx.now) >= 90 && !isIntentionallyWaiting(item)) {
            findings.push({
                itemId: item.id,
                category: 'Very Old Active Work',
                dimension: 'stale',
                issue: `Created ${daysBetween(created, ctx.now)} days ago and still open`,
                severity: 'High'
            });
        }

        if (isOpen(item) && item.assignedTo && ctx.teamMemberNames.size > 0) {
            const name = item.assignedTo.toLowerCase();
            const onTeam = [...ctx.teamMemberNames].some(m => name.includes(m.toLowerCase()) || m.toLowerCase().includes(name));
            if (!onTeam) {
                findings.push({
                    itemId: item.id,
                    category: 'Assigned Outside Platform Team',
                    dimension: 'ownership',
                    issue: `Assigned to ${item.assignedTo}, not in the configured team membership list`,
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
        }

        if (isOpen(item) && ctx.teamAreaHints.length > 0 && item.areaPath) {
            const area = item.areaPath.toLowerCase();
            const matches = ctx.teamAreaHints.some(hint => area.includes(hint.toLowerCase()) || hint.toLowerCase().includes(area));
            if (!matches && !area.includes('platform') && !area.endsWith('k4k')) {
                findings.push({
                    itemId: item.id,
                    category: 'Area Outside Expected Platform Scope',
                    dimension: 'area',
                    issue: `Area Path ${item.areaPath} may be outside Platform`,
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
        }

        if (isOpen(item) && ctx.currentSprintPath && item.iterationPath) {
            const iter = item.iterationPath;
            if (iter === ctx.currentSprintPath || iter.startsWith(`${ctx.currentSprintPath}\\`)) {
                if (estimateOf(item) == null && (kind === 'story' || kind === 'task')) {
                    findings.push({
                        itemId: item.id,
                        category: 'Sprint Item Missing Estimate',
                        dimension: 'sprint',
                        issue: 'In current sprint without an estimate',
                        severity: 'Medium'
                    });
                }
            }
            if (isComplete(item) && ctx.currentSprintEnd) {
                const finish = parseAdoDate(item.actualEnd) ?? parseAdoDate(item.closedDate);
                if (finish && ctx.currentSprintStart && finish < ctx.currentSprintStart && iter === ctx.currentSprintPath) {
                    findings.push({
                        itemId: item.id,
                        category: 'Completed Work In Unexpected Iteration',
                        dimension: 'sprint',
                        issue: 'Completed before the current sprint but still in this iteration',
                        severity: 'Low',
                        reviewRecommended: true
                    });
                }
            }
        }

        if (isOpen(item) && item.iterationPath && ctx.currentSprintPath) {
            const looksPast =
                /sprint\s*\d+/i.test(item.iterationPath) &&
                item.iterationPath !== ctx.currentSprintPath &&
                !item.iterationPath.startsWith(ctx.currentSprintPath);
            if (looksPast && !item.iterationPath.toLowerCase().includes('future')) {
                findings.push({
                    itemId: item.id,
                    category: 'Possible Carry-Over / Stale Iteration',
                    dimension: 'sprint',
                    issue: `Still open in iteration ${item.iterationPath} (current is ${ctx.currentSprintPath})`,
                    severity: 'Medium',
                    reviewRecommended: true
                });
            }
        }

        const preds = item.relations.filter(r => r.rel === RELATION.predecessor);
        for (const rel of preds) {
            const id = relationTargetId(rel);
            if (!id) continue;
            const other = ctx.byId.get(id);
            if (!other) continue;
            if (isComplete(other) && isOpen(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Dependency On Closed Item',
                    dimension: 'dependency',
                    issue: `Still depends on closed #${other.id}`,
                    severity: 'Medium',
                    reviewRecommended: true
                });
            }
            const otherEnd = parseAdoDate(other.plannedEnd);
            if (otherEnd && otherEnd < ctx.now && isOpen(other)) {
                findings.push({
                    itemId: item.id,
                    category: 'Dependency On Overdue Item',
                    dimension: 'dependency',
                    issue: `Depends on overdue #${other.id}`,
                    severity: 'High'
                });
            }
        }

        if (item.blockedField?.toLowerCase() === 'yes' || item.tags.some(t => /^blocked$/i.test(t))) {
            findings.push({
                itemId: item.id,
                category: 'Blocked Work',
                dimension: 'dependency',
                issue: 'Item is marked blocked',
                severity: 'High'
            });
        }
    }

    for (const [owner, count] of ownerCounts) {
        if (count >= concentrationThreshold) {
            for (const item of openItems.filter(i => i.assignedTo === owner)) {
                findings.push({
                    itemId: item.id,
                    category: 'Ownership Concentration',
                    dimension: 'ownership',
                    issue: `${owner} owns ${count} of ${openItems.length} open items`,
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
        }
    }

    findings.push(...detectCircular(ctx));
    return findings;
}

function detectCircular(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];
    const visiting = new Set<number>();
    const visited = new Set<number>();

    const walk = (id: number, stack: number[]): void => {
        if (visiting.has(id)) {
            findings.push({
                itemId: id,
                category: 'Circular Dependency',
                dimension: 'dependency',
                issue: `Cycle involving ${[...stack, id].map(n => `#${n}`).join(' → ')}`,
                severity: 'High'
            });
            return;
        }
        if (visited.has(id)) return;
        visiting.add(id);
        const item = ctx.byId.get(id);
        if (item) {
            for (const rel of item.relations.filter(r => r.rel === RELATION.predecessor)) {
                const next = relationTargetId(rel);
                if (next) walk(next, [...stack, id]);
            }
        }
        visiting.delete(id);
        visited.add(id);
    };

    for (const item of ctx.items) walk(item.id, []);
    return findings;
}

export function checkStale(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];
    for (const item of ctx.items) {
        if (!isOpen(item) || isIntentionallyWaiting(item)) continue;
        const changed = parseAdoDate(item.changedDate);
        if (!changed) continue;
        const days = daysBetween(changed, ctx.now);
        if (days >= 30) {
            findings.push({
                itemId: item.id,
                category: 'Stale Active Work 30+ Days',
                dimension: 'stale',
                issue: `No change for ${days} days`,
                severity: 'Critical'
            });
        } else if (days >= 14) {
            findings.push({
                itemId: item.id,
                category: 'Stale Active Work 14+ Days',
                dimension: 'stale',
                issue: `No change for ${days} days`,
                severity: 'High'
            });
        } else if (days >= 7) {
            findings.push({
                itemId: item.id,
                category: 'Stale Active Work 7+ Days',
                dimension: 'stale',
                issue: `No change for ${days} days`,
                severity: 'Medium'
            });
        }
    }
    return findings;
}

export function checkDuplicates(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];
    const groups = new Map<string, number[]>();
    for (const item of ctx.items) {
        if (!isOpen(item)) continue;
        const key = item.title.trim().toLowerCase().replace(/\s+/g, ' ');
        if (key.length < 12) continue;
        const list = groups.get(key) ?? [];
        list.push(item.id);
        groups.set(key, list);
    }
    for (const [, ids] of groups) {
        if (ids.length < 2) continue;
        for (const id of ids) {
            findings.push({
                itemId: id,
                category: 'Potential Duplicate',
                dimension: 'duplicates',
                issue: `Same title as ${ids.filter(x => x !== id).map(x => `#${x}`).join(', ')}`,
                severity: 'Medium',
                reviewRecommended: true
            });
        }
    }
    return findings;
}

export function checkCustomFields(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];
    const keys = new Set<string>();
    for (const item of ctx.items) {
        for (const key of Object.keys(item.extraFields ?? {})) keys.add(key);
    }
    if (keys.size === 0) return findings;

    const missingCounts = new Map<string, number[]>();
    for (const key of keys) {
        const missing: number[] = [];
        for (const item of ctx.items.filter(isOpen)) {
            const value = item.extraFields?.[key];
            if (value == null || value === '') missing.push(item.id);
        }
        if (missing.length >= Math.max(4, Math.ceil(ctx.items.filter(isOpen).length * 0.5))) {
            missingCounts.set(key, missing);
        }
    }

    for (const [key, ids] of missingCounts) {
        for (const id of ids.slice(0, 200)) {
            findings.push({
                itemId: id,
                category: `Custom Field Frequently Missing (${key})`,
                dimension: 'custom',
                issue: `${key} is empty on many open items`,
                severity: 'Low',
                reviewRecommended: true
            });
        }
    }

    for (const item of ctx.items) {
        for (const [key, value] of Object.entries(item.extraFields ?? {})) {
            if (typeof value === 'string' && /^(tbd|todo|n\/a|test|xxx)$/i.test(value.trim())) {
                findings.push({
                    itemId: item.id,
                    category: 'Custom Field Placeholder Value',
                    dimension: 'custom',
                    issue: `${key} = "${value}"`,
                    severity: 'Low',
                    reviewRecommended: true
                });
            }
        }
    }

    return findings;
}

export function checkEstimatesOutliers(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];
    const stories = ctx.items.filter(i => typeKind(i.type) === 'story' && estimateOf(i) != null);
    const values = stories.map(i => estimateOf(i)!).sort((a, b) => a - b);
    if (values.length < 8) return findings;
    const q1 = values[Math.floor(values.length * 0.25)]!;
    const q3 = values[Math.floor(values.length * 0.75)]!;
    const iqr = q3 - q1;
    const high = q3 + 1.5 * iqr;
    if (iqr <= 0) return findings;
    for (const item of stories) {
        const est = estimateOf(item)!;
        if (est > high && est >= 13) {
            findings.push({
                itemId: item.id,
                category: 'Estimate Outlier',
                dimension: 'estimate',
                issue: `Estimate ${est} is an outlier vs peer stories (IQR high ${high.toFixed(1)})`,
                severity: 'Low',
                reviewRecommended: true
            });
        }
        if (est === 0 && isOpen(item)) {
            findings.push({
                itemId: item.id,
                category: 'Zero Estimate',
                dimension: 'estimate',
                issue: 'Estimate is 0',
                severity: 'Low',
                reviewRecommended: true
            });
        }
    }
    return findings;
}
