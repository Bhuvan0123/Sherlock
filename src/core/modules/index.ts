import { AnalysisModuleRegistry, type AnalysisModule, type StructuredAnalysisResult, type Finding, type Recommendation } from '../analysis-module.js';
import { compareSprintRates, ratesFromTotals } from '../sprint-compare.js';
import { OVERDUE_RULE } from '../../services/analysis/overdue.js';
import { getReviewService } from '../../services/analysis/review.service.js';
import { getWorkloadService } from '../../services/analysis/workload.service.js';
import { getDeadlineService } from '../../services/analysis/deadline.service.js';
import { getDependencyService } from '../../services/analysis/dependency.service.js';
import { getProductivityService } from '../../services/analysis/productivity.service.js';
import { getAssignmentService } from '../../services/analysis/assignment.service.js';
import { analyseBacklog, buildRelationMaps } from '../../services/analysis/backlog/analyse.js';
import { getWorkItemService } from '../../azure-devops/work-item.service.js';
import { getSprintService } from '../../azure-devops/sprint.service.js';
import { getAdoAnalyticsService } from '../../azure-devops/analytics.service.js';
import { getProjectContext } from '../../azure-devops/context.js';
import { FIELD } from '../../azure-devops/fields.js';
import { MINIMAL_WORK_ITEM_FIELDS } from '../../azure-devops/field-profiles.js';
import { wiql } from '../../azure-devops/wiql.js';

const STALE_DAYS = [7, 14, 21, 30] as const;

function registerOnce(module: AnalysisModule): void {
    if (!AnalysisModuleRegistry.has(module.id)) {
        AnalysisModuleRegistry.register(module);
    }
}

export function registerPilotModules() {
    registerOnce({
        id: 'review',
        name: 'Daily Team Review',
        description: 'Sprint assignment, blocked and overdue signals for standup.',
        requiredData: ['members', 'blocked'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(_context, data): Promise<StructuredAnalysisResult> {
            const review = await getReviewService().generateDailyTeamReview();
            const f = review.facts;
            const findings: Finding[] = [];
            if (f.kpis.blocked > 3) {
                findings.push({
                    severity: 'high',
                    title: 'Blocked Work',
                    count: f.kpis.blocked,
                    evidence: f.blockedWork.slice(0, 3).map(b => b.signals[0]),
                    workItemIds: f.blockedWork.map(b => b.item.id)
                });
            } else if (f.blockedWork.length > 0) {
                findings.push({
                    severity: 'high',
                    title: 'Blocked Work',
                    count: f.kpis.blocked,
                    evidence: f.blockedWork.map(b => `#${b.item.id}`),
                    workItemIds: f.blockedWork.map(b => b.item.id)
                });
            }
            if (f.kpis.overdueDueDate > 0) {
                findings.push({
                    severity: 'high',
                    title: OVERDUE_RULE.dueDate.label,
                    count: f.kpis.overdueDueDate,
                    evidence: f.overdueWork.slice(0, 3).map(o => `#${o.item.id}`),
                    workItemIds: f.overdueDueDateIds
                });
            }
            if (f.kpis.overduePlannedEnd > 0) {
                findings.push({
                    severity: 'medium',
                    title: OVERDUE_RULE.plannedEnd.label,
                    count: f.kpis.overduePlannedEnd,
                    evidence: [],
                    workItemIds: f.overduePlannedEndIds
                });
            }
            if (f.kpis.unassigned > 0) {
                findings.push({
                    severity: f.kpis.unassigned > 3 ? 'high' : 'medium',
                    title: 'Unassigned work',
                    count: f.kpis.unassigned,
                    evidence: f.unassignedWork.slice(0, 3).map(i => `#${i.id}`),
                    workItemIds: f.unassignedIds
                });
            }
            return {
                module: 'review',
                summary: {
                    team: f.team,
                    sprint: f.currentSprint?.name ?? null,
                    daysRemaining: f.currentSprint?.daysRemaining ?? null,
                    active: f.kpis.active,
                    proposed: f.kpis.proposed,
                    blocked: f.kpis.blocked,
                    overdueDueDate: f.kpis.overdueDueDate,
                    overduePlannedEnd: f.kpis.overduePlannedEnd,
                    unassigned: f.kpis.unassigned,
                    completion: f.kpis.completion,
                    members: f.teamWorkload
                },
                findings,
                recommendations: review.recommendations.slice(0, 5).map(r => ({ priority: 'medium' as const, action: r, reason: 'Daily review rule' }))
            };
        }
    });

    registerOnce({
        id: 'workload',
        name: 'Workload Distribution',
        description: 'Open and active item distribution across team members.',
        requiredData: ['workload', 'members'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(): Promise<StructuredAnalysisResult> {
            const workload = await getWorkloadService().getTeamWorkloadFacts();
            const findings: Finding[] = [];
            const recommendations: Recommendation[] = [];
            const distribution = workload.members.map(m => ({
                name: m.member.displayName,
                open: m.counts.assignedOpen,
                active: m.counts.active,
                proposed: m.counts.proposed
            }));
            const actives = distribution.map(d => d.active);
            const maxActive = actives.length ? Math.max(...actives) : 0;
            const minActive = actives.length ? Math.min(...actives) : 0;
            const capacityNotes: Recommendation[] = [];
            for (const m of workload.members) {
                if (m.counts.active > 5) {
                    findings.push({
                        severity: 'medium',
                        title: `High active workload: ${m.member.displayName}`,
                        count: m.counts.active,
                        evidence: [`${m.counts.assignedOpen} open / ${m.counts.active} active`],
                        workItemIds: []
                    });
                    recommendations.push({
                        priority: 'medium',
                        action: `Review ${m.member.displayName}'s ${m.counts.active} active items and consider moving one lower-priority item to an owner with more capacity.`,
                        reason: `${m.counts.active} items in progress`,
                        timeframe: 'Next Standup',
                        finding: 'Capacity imbalance'
                    });
                }
                if (m.counts.active <= 1 && m.counts.assignedOpen <= 2 && capacityNotes.length < 2) {
                    capacityNotes.push({
                        priority: 'low',
                        action: `${m.member.displayName} may have potential capacity for unassigned or overloaded work.`,
                        reason: `${m.counts.active} active / ${m.counts.assignedOpen} open — not a performance ranking`,
                        timeframe: 'Next Standup'
                    });
                }
            }
            recommendations.push(...capacityNotes);
            if (workload.unassigned.count > 0) {
                findings.push({
                    severity: workload.unassigned.count > 3 ? 'high' : 'medium',
                    title: 'Unassigned work',
                    count: workload.unassigned.count,
                    evidence: [],
                    workItemIds: workload.unassigned.items.map(i => i.id)
                });
            }
            return {
                module: 'workload',
                summary: {
                    team: workload.team,
                    members: workload.members.length,
                    unassigned: workload.unassigned.count,
                    active: workload.totals.activeItems,
                    blocked: workload.totals.blockedItems,
                    overdueDueDate: workload.totals.overdueDueDate,
                    overduePlannedEnd: workload.totals.overduePlannedEnd,
                    concentration: maxActive - minActive,
                    distribution
                },
                findings,
                recommendations
            };
        }
    });

    registerOnce({
        id: 'deadline',
        name: 'Deadline Risk Analysis',
        description: 'Overdue and approaching due dates from live Azure DevOps date fields.',
        requiredData: ['deadlines'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(): Promise<StructuredAnalysisResult> {
            const envelope = await getDeadlineService().getDeadlineFacts(14, { sampleLimit: 5 });
            const counts = envelope.counts;
            const overdue = envelope.overdue;
            const recs: Recommendation[] = [];
            const findings: Finding[] = [];
            const due = counts?.overdueDueDate ?? counts?.overdue ?? 0;
            if (due > 0) {
                findings.push({
                    severity: 'high',
                    title: OVERDUE_RULE.dueDate.label,
                    count: due,
                    evidence: overdue.slice(0, 3).map(o => `#${o.item.id} ${o.relative}`),
                    workItemIds: envelope.overdueDueDateIds.length > 0 ? envelope.overdueDueDateIds : overdue.map(o => o.item.id)
                });
            }
            if ((counts?.overduePlannedEnd ?? 0) > 0) {
                findings.push({
                    severity: 'high',
                    title: OVERDUE_RULE.plannedEnd.label,
                    count: counts!.overduePlannedEnd,
                    evidence: [`${OVERDUE_RULE.plannedEnd.description}`],
                    workItemIds: envelope.overduePlannedEndIds
                });
            }
            if ((counts?.overdueSprint ?? 0) > 0) {
                findings.push({
                    severity: 'medium',
                    title: OVERDUE_RULE.sprint.label,
                    count: counts!.overdueSprint,
                    evidence: [OVERDUE_RULE.sprint.description],
                    workItemIds: []
                });
            }
            if ((counts?.overdueHistorical ?? 0) > 0) {
                findings.push({
                    severity: 'low',
                    title: OVERDUE_RULE.historical.label,
                    count: counts!.overdueHistorical,
                    evidence: [OVERDUE_RULE.historical.description],
                    workItemIds: []
                });
            }
            if ((counts?.dueThisWeek ?? 0) > 0) {
                findings.push({
                    severity: 'medium',
                    title: 'Due This Week',
                    count: counts!.dueThisWeek,
                    evidence: [],
                    workItemIds: []
                });
            }
            if (due === 0 && (counts?.overduePlannedEnd ?? 0) > 0) {
                recs.push({
                    priority: 'high',
                    action: `Triage ${counts!.overduePlannedEnd} items past Planned End even though Due Date overdue is 0.`,
                    reason: 'Due Date and Planned End are different fields',
                    timeframe: 'Immediate'
                });
            }
            return {
                module: 'deadline',
                summary: counts ?? {},
                findings,
                recommendations: recs.slice(0, 5)
            };
        }
    });

    registerOnce({
        id: 'sprint',
        name: 'Sprint Progress',
        description: 'Current vs previous sprint rates: completion, carry-over, blocked, overdue, throughput.',
        requiredData: [],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(_context, _data, options): Promise<StructuredAnalysisResult> {
            const sprints = getSprintService();
            const current = await sprints.getCurrentSprint();
            if (!current) {
                return {
                    module: 'sprint',
                    summary: { sprintName: null, note: 'No current sprint' },
                    findings: [],
                    recommendations: []
                };
            }
            const wantCarry = options?.includeCarryOver === true;
            const past = await sprints.getPastSprints(1);
            const currentProgress = await sprints.getSprintProgress(current, { includeCarryOver: wantCarry });
            const previous = past[0] ?? null;
            const previousProgress = previous
                ? await sprints.getSprintProgress(previous, { includeCarryOver: wantCarry })
                : null;

            const currentRates = ratesFromTotals({
                ...currentProgress.totals,
                carryOver: currentProgress.carryOver.length
            });
            const previousRates = previousProgress
                ? ratesFromTotals({ ...previousProgress.totals, carryOver: previousProgress.carryOver.length })
                : null;
            const comparison = previousRates ? compareSprintRates(currentRates, previousRates) : null;

            const findings: Finding[] = [];
            if ((currentRates.completionRate ?? 100) < 60) {
                findings.push({
                    severity: 'high',
                    title: 'Low sprint completion rate',
                    count: currentProgress.totals.items,
                    evidence: [`${currentRates.completionRate}% complete`],
                    workItemIds: []
                });
            }
            if (currentProgress.totals.blocked > 0) {
                findings.push({
                    severity: currentProgress.totals.blocked >= 5 ? 'high' : 'medium',
                    title: 'Blocked work in sprint',
                    count: currentProgress.totals.blocked,
                    evidence: [`${currentRates.blockedRate}% blocked`],
                    workItemIds: []
                });
            }
            if (currentProgress.carryOver.length > 0) {
                findings.push({
                    severity: 'medium',
                    title: 'Carry-over into current sprint',
                    count: currentProgress.carryOver.length,
                    evidence: currentProgress.carryOver.slice(0, 3).map(c => `#${c.id} from ${c.movedFrom}`),
                    workItemIds: currentProgress.carryOver.map(c => c.id)
                });
            }

            const recommendations: Recommendation[] = [];
            if (comparison && comparison.completionRateChangePp !== null && comparison.completionRateChangePp < 0) {
                recommendations.push({
                    priority: 'high',
                    action: 'Completion rate declined vs previous sprint — inspect blocked and carry-over work',
                    reason: `${comparison.previous.completionRate}% → ${comparison.current.completionRate}% (${comparison.completionRateChangePp} pp)`
                });
            }

            return {
                module: 'sprint',
                summary: {
                    currentSprint: current.name,
                    previousSprint: previous?.name ?? null,
                    current: currentRates,
                    previous: previousRates,
                    comparison
                },
                findings,
                recommendations
            };
        }
    });

    registerOnce({
        id: 'stale-work',
        name: 'Stale Work',
        description: 'Open items with no ChangedDate update for a configurable threshold (7/14/21/30 days).',
        requiredData: [],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(_context, _data, options): Promise<StructuredAnalysisResult> {
            const requested = Number(options?.staleThresholdDays ?? 14);
            const days = (STALE_DAYS as readonly number[]).includes(requested) ? requested : 14;
            const workItems = getWorkItemService();
            const completed = await getProjectContext().getCompletedStateNames();
            const ids = await workItems.queryIds(
                [
                    wiql.todayOffset(FIELD.changedDate, '<=', -days),
                    completed.length > 0 ? wiql.notInList(FIELD.state, [...new Set(completed)]) : null
                ],
                { limit: 500, orderBy: [{ field: FIELD.changedDate, direction: 'asc' }] }
            );

            const sample = await workItems.getByIds(ids.slice(0, 8), { profile: MINIMAL_WORK_ITEM_FIELDS });
            const owners = [...new Set(sample.map(i => i.assignedTo ?? 'Unassigned'))];
            const states = [...new Set(sample.map(i => i.state))];
            const byType: Record<string, number> = {};
            for (const item of sample) {
                byType[item.type] = (byType[item.type] ?? 0) + 1;
            }

            const buckets = { d7: 0, d14: 0, d21: 0, d30: 0 };
            if (days <= 7) buckets.d7 = ids.length;
            else if (days <= 14) buckets.d14 = ids.length;
            else if (days <= 21) buckets.d21 = ids.length;
            else buckets.d30 = ids.length;

            const findings: Finding[] = [];
            if (ids.length > 0) {
                findings.push({
                    severity: days >= 21 ? 'high' : 'medium',
                    title: `Stale work (${days}+ days)`,
                    count: ids.length,
                    evidence: sample.slice(0, 3).map(i => `#${i.id} ${i.state} ${i.assignedTo ?? 'unassigned'}`),
                    workItemIds: ids
                });
            }

            return {
                module: 'stale-work',
                summary: {
                    thresholdDays: days,
                    count: ids.length,
                    ageDistribution: buckets,
                    oldestIds: ids.slice(0, 5),
                    owners,
                    states,
                    byType
                },
                findings,
                recommendations:
                    ids.length > 0
                        ? [{ priority: 'medium' as const, action: 'Triage stale items or close abandoned work', reason: `${ids.length} items unchanged for ${days}+ days` }]
                        : []
            };
        }
    });

    registerOnce({
        id: 'backlog',
        name: 'Backlog Health',
        description: 'Hierarchy and field-quality analysis on a bounded live sample.',
        requiredData: ['members'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(_context, data): Promise<StructuredAnalysisResult> {
            const workItems = getWorkItemService();
            const ids = await workItems.queryIds([], { limit: 80 });
            const items = await workItems.getByIds(ids, { includeRelations: true, profile: MINIMAL_WORK_ITEM_FIELDS });
            const maps = buildRelationMaps(items);
            const analysis = analyseBacklog({
                items,
                byId: maps.byId,
                childrenOf: maps.childrenOf,
                parentOf: maps.parentOf,
                teamMemberNames: new Set(data.members.map(m => m.displayName.toLowerCase())),
                teamAreaHints: [],
                currentSprintPath: data.sprint?.path ?? null,
                currentSprintStart: data.sprint?.startDate ? new Date(data.sprint.startDate) : null,
                currentSprintEnd: data.sprint?.finishDate ? new Date(data.sprint.finishDate) : null,
                now: new Date(),
                truncated: ids.length >= 80,
                scannedLimit: 80,
                fields: {
                    plannedStart: true,
                    plannedEnd: true,
                    actualStart: true,
                    actualEnd: true,
                    description: false,
                    acceptanceCriteria: false,
                    estimate: true,
                    remainingWork: true,
                    severity: true,
                    risk: false
                },
                workItemTypes: []
            });
            const findings: Finding[] = analysis.categories
                .filter(c => c.count > 0)
                .slice(0, 12)
                .map(c => ({
                    severity: (['Critical', 'High'].includes(c.severity) ? 'high' : c.severity === 'Medium' ? 'medium' : 'low') as Finding['severity'],
                    title: c.category,
                    count: c.count,
                    evidence: c.description ? [c.description] : [],
                    workItemIds: c.itemIds
                }));
            const recommendations: Recommendation[] = findings.slice(0, 3).map(f => ({
                priority: f.severity === 'high' || f.severity === 'critical' ? 'high' as const : 'medium' as const,
                action: `Resolve ${f.title} (${f.count}). ${f.count > 3 ? 'Use the saved query to work the list.' : 'Handle the listed items directly.'}`,
                reason: `${f.count} items in this quality category`,
                timeframe: 'Backlog Refinement',
                finding: f.title
            }));
            return {
                module: 'backlog',
                summary: { totalAnalyzed: analysis.totalAnalyzed, issuesFound: analysis.issuesFound, truncated: ids.length >= 80 },
                findings,
                recommendations
            };
        }
    });

    registerOnce({
        id: 'risk',
        name: 'Delivery Risk',
        description: 'Combines overdue, blocked and deadline pressure.',
        requiredData: ['blocked', 'deadlines'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: ['deadline'],
        async execute(): Promise<StructuredAnalysisResult> {
            const blocked = await getDependencyService().findBlockedItems(8);
            const findings: Finding[] = [];
            if (blocked.facts.count > 0) {
                findings.push({
                    severity: 'high',
                    title: 'Blocked Work',
                    count: blocked.facts.count,
                    evidence: blocked.facts.items.slice(0, 3).map(i => i.signals[0]?.evidence),
                    workItemIds: blocked.facts.items.map(i => i.item.id)
                });
            }
            return {
                module: 'risk',
                summary: { blocked: blocked.facts.count },
                findings,
                recommendations: blocked.recommendations.slice(0, 3).map(r => ({ priority: 'high' as const, action: r, reason: 'Blocked-work rule' }))
            };
        }
    });

    registerOnce({
        id: 'dependency',
        name: 'Dependencies',
        description: 'Live Azure DevOps relation links that still block work.',
        requiredData: ['blocked'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(): Promise<StructuredAnalysisResult> {
            const result = await getDependencyService().findBlockedItems(8);
            return {
                module: 'dependency',
                summary: { blocked: result.facts.count },
                findings:
                    result.facts.count > 0
                        ? [
                              {
                                  severity: 'high',
                                  title: 'Items with blocking dependencies',
                                  count: result.facts.count,
                                  evidence: result.facts.items.slice(0, 3).map(i => `#${i.item.id}`),
                                  workItemIds: result.facts.items.map(i => i.item.id)
                              }
                          ]
                        : [],
                recommendations: result.recommendations.slice(0, 3).map(r => ({ priority: 'medium' as const, action: r, reason: 'Dependency rule' }))
            };
        }
    });

    registerOnce({
        id: 'productivity',
        name: 'Team Productivity',
        description: 'Analytics throughput and current workload signals.',
        requiredData: ['members', 'workload'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(): Promise<StructuredAnalysisResult> {
            const facts = await getProductivityService().analyzeTeamProductivity();
            return {
                module: 'productivity',
                summary: {
                    team: facts.facts.team,
                    blocked: facts.facts.signals.blockedItems,
                    overdue: facts.facts.signals.overdueItems,
                    carryOver: facts.facts.signals.carryOverCurrentSprint
                },
                findings: [],
                recommendations: facts.recommendations.slice(0, 5).map(r => ({ priority: 'medium' as const, action: r, reason: 'Productivity signal' }))
            };
        }
    });

    registerOnce({
        id: 'team-capacity',
        name: 'Team Capacity',
        description: 'Sprint capacity vs active assignment counts.',
        requiredData: ['members'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: ['sprint'],
        async execute(_context, data): Promise<StructuredAnalysisResult> {
            const sprints = getSprintService();
            const current = data.sprint ?? (await sprints.getCurrentSprint());
            const progress = current ? await sprints.getSprintProgress(current, { includeCarryOver: false }) : null;
            const capacityRows = progress?.capacity ?? [];
            return {
                module: 'team-capacity',
                summary: {
                    sprint: current?.name ?? null,
                    membersWithCapacity: capacityRows.length,
                    capacityKnown: capacityRows.length > 0
                },
                findings: [],
                recommendations:
                    capacityRows.length === 0
                        ? [{ priority: 'low', action: 'Capacity is not set on the current iteration', reason: 'Azure DevOps returned no capacity rows' }]
                        : []
            };
        }
    });

    registerOnce({
        id: 'delivery-forecast',
        name: 'Delivery Forecast',
        description: 'Analytics completed-work metrics used as a forecast input, not a promise.',
        requiredData: [],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: [],
        async execute(): Promise<StructuredAnalysisResult> {
            const metrics = await getAdoAnalyticsService().getDeliveryMetrics(30);
            const completed = metrics.completed.items;
            return {
                module: 'delivery-forecast',
                summary: {
                    windowDays: metrics.window.days,
                    completedCount: completed,
                    throughputPerWeek: metrics.throughputPerWeek,
                    cycleTimeAverage: metrics.cycleTimeDays.average,
                    confidence: completed > 10 ? 'Medium' : 'Low'
                },
                findings: [],
                recommendations: [
                    {
                        priority: 'low',
                        action: 'Use historical throughput as a range, not a calendar date, unless remaining work and completed history are both complete.',
                        reason: 'Forecast uses completed work in the last 30 days',
                        timeframe: 'Next Sprint',
                        finding: 'Forecast confidence'
                    }
                ]
            };
        }
    });

    registerOnce({
        id: 'assignment',
        name: 'Assignment Recommendation',
        description: 'Recommend owners for unassigned work. Does not assign.',
        requiredData: ['unassigned', 'members'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: ['workload'],
        async execute(): Promise<StructuredAnalysisResult> {
            const recs = await getAssignmentService().recommendAssignments(5);
            const rows = recs.facts.recommendations;
            return {
                module: 'assignment',
                summary: {
                    unassigned: recs.facts.unassignedCount,
                    suggestions: rows.length,
                    rows: rows.map(r => ({
                        id: r.workItem.id,
                        owner: r.suggested,
                        reason: r.reasons[0] ?? 'Unassigned item',
                        confidence: r.suitability == null ? '—' : `${Math.round(r.suitability)}`
                    }))
                },
                findings:
                    recs.facts.unassignedCount > 0
                        ? [
                              {
                                  severity: recs.facts.unassignedCount > 3 ? 'high' as const : 'medium' as const,
                                  title: 'Unassigned work needing an owner',
                                  count: recs.facts.unassignedCount,
                                  evidence: rows.slice(0, 3).map(r => `#${r.workItem.id}`),
                                  workItemIds: rows.map(r => r.workItem.id)
                              }
                          ]
                        : [],
                recommendations: rows.slice(0, 5).map(r => ({
                    priority: 'medium' as const,
                    action: r.suggested ? `Consider ${r.suggested} for #${r.workItem.id}` : `No candidate for #${r.workItem.id}`,
                    reason: r.reasons[0] ?? 'Unassigned item',
                    timeframe: 'Next Standup' as const,
                    finding: 'Unassigned work'
                }))
            };
        }
    });

    registerOnce({
        id: 'hierarchy',
        name: 'Hierarchy Health',
        description: 'Parent/child gaps on a bounded backlog sample.',
        requiredData: ['members'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: ['backlog'],
        async execute(): Promise<StructuredAnalysisResult> {
            return { module: 'hierarchy', summary: { delegatedTo: 'backlog' }, findings: [], recommendations: [] };
        }
    });

    registerOnce({
        id: 'date',
        name: 'Schedule Dates',
        description: 'Date completeness is included in backlog analysis.',
        requiredData: ['members'],
        supportedModes: ['brief', 'verbose', 'visual'],
        dependencies: ['backlog'],
        async execute(): Promise<StructuredAnalysisResult> {
            return { module: 'date', summary: { delegatedTo: 'backlog' }, findings: [], recommendations: [] };
        }
    });
}
