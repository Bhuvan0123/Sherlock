import { addDays, nowIso, startOfDay, startOfWeek } from '../../utils/dates.js';
import { summarise } from '../../utils/redact.js';
import { createLogger } from '../../utils/logger.js';
import {
    getActivityRepository,
    type ActivityCategory,
    type ActivityOutcome,
    type ActivityRepository,
    type ActivityRow,
    type ConfirmationStatus
} from '../../database/repository/activity.repository.js';
import { buildEnvelope, type AnalysisEnvelope } from '../analysis/types.js';

const log = createLogger('tl-activity');

export interface RecordActivityInput {
    category: ActivityCategory;
    action: string;
    tool: string;
    parameters?: unknown;
    result?: unknown;
    outcome?: ActivityOutcome;
    errorCode?: string | null;
    confirmationStatus?: ConfirmationStatus;
    durationMs?: number | null;
    subjectRef?: string | null;
}

export interface ActivitySummary {
    window: { days: number; from: string; to: string };
    totalActions: number;
    byCategory: { category: string; count: number }[];
    byTool: { tool: string; count: number }[];
    byOutcome: { outcome: string; count: number }[];
    byDay: { day: string; count: number }[];
    confirmations: { confirmed: number; declined: number; awaiting: number };
    emailsSent: number;
    draftsCreated: number;
    repeatedSubjects: { subjectRef: string; occurrences: number; lastSeen: string }[];
    firstRecordedAt: string | null;
    totalRecordedEver: number;
}

/**
 * Records and analyses what the Team Lead does *through this MCP server*.
 *
 * Scope matters: Azure DevOps is read-only here, so this is a log of monitoring,
 * analysis, drafting and sending performed via these tools - not a log of activity
 * performed directly inside Azure DevOps.
 *
 * Only summaries are stored. Credentials, tokens and email bodies never reach the
 * audit trail: every parameter and result passes through the redacting summariser.
 */
export class ActivityService {
    constructor(private readonly repository: ActivityRepository = getActivityRepository()) {}

    /** Writes one audit row. Never throws: auditing must not break a tool call. */
    record(input: RecordActivityInput): void {
        try {
            this.repository.insert({
                occurredAt: nowIso(),
                category: input.category,
                action: input.action,
                tool: input.tool,
                parametersSummary: input.parameters === undefined ? null : summarise(input.parameters, 400),
                resultSummary: input.result === undefined ? null : summarise(input.result, 400),
                outcome: input.outcome ?? 'success',
                errorCode: input.errorCode ?? null,
                confirmationStatus: input.confirmationStatus ?? 'not_applicable',
                durationMs: input.durationMs ?? null,
                subjectRef: input.subjectRef ?? null
            });
        } catch (error) {
            log.warn('Could not write the Team Lead activity record', { error: String(error), tool: input.tool });
        }
    }

    getActivity(filters: {
        days?: number;
        category?: ActivityCategory;
        tool?: string;
        outcome?: ActivityOutcome;
        limit?: number;
    } = {}): { window: { days: number; from: string }; count: number; entries: ActivityRow[] } {
        const days = Math.max(1, Math.min(filters.days ?? 7, 365));
        const from = addDays(startOfDay(), -days + 1);
        const entries = this.repository.list({
            sinceIso: from.toISOString(),
            ...(filters.category ? { category: filters.category } : {}),
            ...(filters.tool ? { tool: filters.tool } : {}),
            ...(filters.outcome ? { outcome: filters.outcome } : {}),
            ...(filters.limit ? { limit: filters.limit } : {})
        });
        return { window: { days, from: from.toISOString() }, count: entries.length, entries };
    }

    getSummary(days = 7): ActivitySummary {
        const window = Math.max(1, Math.min(days, 365));
        const from = addDays(startOfDay(), -window + 1);
        const fromIso = from.toISOString();
        const entries = this.repository.list({ sinceIso: fromIso, limit: 1000 });

        return {
            window: { days: window, from: fromIso, to: nowIso() },
            totalActions: entries.length,
            byCategory: this.repository.countsByCategory(fromIso),
            byTool: this.repository.countsByTool(fromIso, 15),
            byOutcome: this.repository.countsByOutcome(fromIso),
            byDay: this.repository.countsByDay(fromIso),
            confirmations: {
                confirmed: entries.filter(entry => entry.confirmationStatus === 'confirmed').length,
                declined: entries.filter(entry => entry.confirmationStatus === 'declined').length,
                awaiting: entries.filter(entry => entry.confirmationStatus === 'awaiting_confirmation').length
            },
            emailsSent: entries.filter(entry => entry.category === 'email_send' && entry.outcome === 'success').length,
            draftsCreated: entries.filter(entry => entry.category === 'email_draft').length,
            repeatedSubjects: this.repository.repeatedSubjects(fromIso, 2, 15),
            firstRecordedAt: this.repository.firstRecordedAt(),
            totalRecordedEver: this.repository.total()
        };
    }

    /**
     * Interprets the audit trail. Reports observed patterns and possible
     * improvement areas; deliberately produces no productivity percentage.
     */
    analyzeActivity(days = 14): AnalysisEnvelope<ActivitySummary> {
        const summary = this.getSummary(days);
        const observations: string[] = [];
        const concerns: string[] = [];
        const recommendations: string[] = [];

        if (summary.totalActions === 0) {
            return buildEnvelope('tl_activity_analysis', summary, {
                observations: [
                    `No activity has been recorded through this MCP server in the last ${summary.window.days} day(s).`,
                    summary.totalRecordedEver === 0
                        ? 'The audit trail is empty, which is expected on a fresh installation.'
                        : `${summary.totalRecordedEver} action(s) are recorded in total, the earliest at ${summary.firstRecordedAt}.`
                ],
                methodology: METHODOLOGY,
                dataSource: 'Local SQLite audit trail of this MCP server'
            });
        }

        const activeDays = summary.byDay.length;
        observations.push(
            `${summary.totalActions} action(s) across ${activeDays} active day(s) in the last ${summary.window.days} day(s).`
        );
        const topCategory = summary.byCategory[0];
        if (topCategory) {
            observations.push(`Most frequent activity type: ${topCategory.category} (${topCategory.count} action(s)).`);
        }
        const topTool = summary.byTool[0];
        if (topTool) observations.push(`Most used tool: ${topTool.tool} (${topTool.count} call(s)).`);

        const analysisCount = summary.byCategory.find(entry => entry.category === 'analysis')?.count ?? 0;
        const reviewCount =
            (summary.byCategory.find(entry => entry.category === 'project_review')?.count ?? 0) +
            (summary.byCategory.find(entry => entry.category === 'team_review')?.count ?? 0);
        observations.push(`${reviewCount} project/team review action(s) and ${analysisCount} analysis request(s).`);
        if (summary.emailsSent > 0 || summary.draftsCreated > 0) {
            observations.push(`${summary.draftsCreated} email draft(s) created, ${summary.emailsSent} sent after confirmation.`);
        }

        const errors = summary.byOutcome.find(entry => entry.outcome === 'error')?.count ?? 0;
        if (errors > 0) {
            concerns.push(`${errors} tool call(s) ended in an error, so some information may not have been retrieved.`);
        }
        if (summary.draftsCreated > 0 && summary.emailsSent === 0) {
            concerns.push(`${summary.draftsCreated} draft(s) were prepared but none were confirmed and sent.`);
            recommendations.push('Review pending drafts with email_list_drafts and either confirm or cancel them.');
        }
        if (summary.repeatedSubjects.length > 0) {
            const worst = summary.repeatedSubjects[0];
            if (worst) {
                concerns.push(
                    `${summary.repeatedSubjects.length} subject(s) were revisited more than once; ${worst.subjectRef} came up ${worst.occurrences} times.`
                );
                recommendations.push(
                    `Repeated look-ups at ${worst.subjectRef} usually mean an unresolved issue. Consider resolving it directly or emailing the owner rather than re-checking.`
                );
            }
        }
        if (activeDays < Math.min(summary.window.days, 5) && summary.window.days >= 7) {
            concerns.push(
                `Monitoring happened on ${activeDays} of the last ${summary.window.days} day(s), so team state was unobserved on the other days.`
            );
            recommendations.push('A short daily review (analysis_daily_team_review) keeps overdue and blocked work from accumulating unseen.');
        }
        if (analysisCount > 0 && summary.draftsCreated === 0) {
            recommendations.push(
                'Analysis is being run but no follow-up emails have been drafted; email_draft_overdue_work turns findings into a follow-up in one step.'
            );
        }

        return buildEnvelope('tl_activity_analysis', summary, {
            observations,
            concerns,
            recommendations,
            methodology: METHODOLOGY,
            dataSource: 'Local SQLite audit trail of this MCP server'
        });
    }

    /** Activity for the current calendar week, used by the weekly review. */
    getCurrentWeekActivity(): { weekStart: string; entries: ActivityRow[]; summary: ActivitySummary } {
        const weekStart = startOfWeek();
        const days = Math.max(1, Math.ceil((Date.now() - weekStart.getTime()) / 86_400_000));
        return {
            weekStart: weekStart.toISOString(),
            entries: this.repository.list({ sinceIso: weekStart.toISOString(), limit: 1000 }),
            summary: this.getSummary(days)
        };
    }

    /** Retention control for the local audit trail. */
    purgeOlderThan(days: number): { removed: number; cutoff: string } {
        const cutoff = addDays(startOfDay(), -Math.max(1, days));
        const removed = this.repository.purgeBefore(cutoff.toISOString());
        log.info('Purged Team Lead activity records', { removed, cutoff: cutoff.toISOString() });
        return { removed, cutoff: cutoff.toISOString() };
    }
}

const METHODOLOGY = [
    'Source: the local SQLite audit trail written by this MCP server. It covers tool calls made through this server only.',
    'It does not and cannot observe actions the Team Lead performs directly in the Azure DevOps web UI, because this server is read-only and has no webhook into Azure DevOps.',
    'Stored per action: timestamp, category, tool name, a redacted parameter summary, a redacted result summary, outcome, and confirmation status. Credentials, tokens and email bodies are never stored.',
    'No productivity percentage is calculated. Tool-call counts measure interaction with this server, not the value or effectiveness of the Team Lead\'s work.'
];

let sharedActivityService: ActivityService | null = null;

export function getActivityService(): ActivityService {
    sharedActivityService ??= new ActivityService();
    return sharedActivityService;
}

export function setActivityServiceForTesting(service: ActivityService | null): void {
    sharedActivityService = service;
}
