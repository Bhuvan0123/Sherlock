import { AppError } from '../../utils/errors.js';
import { describeRelativeDays, parseAdoDate, toDateOnly } from '../../utils/dates.js';
import { getSprintService, type SprintService } from '../azure-devops/sprint.service.js';
import { getTeamService, type TeamService } from '../azure-devops/team.service.js';
import { getWorkItemService, type WorkItemService } from '../azure-devops/work-item.service.js';
import type { WorkItem } from '../azure-devops/types.js';
import { getDeadlineService, type DeadlineService } from '../analysis/deadline.service.js';
import { getWorkloadService, type WorkloadService } from '../analysis/workload.service.js';
import { getEmailService, type DraftPreview, type EmailService } from './email.service.js';

/**
 * Email drafts assembled from real Azure DevOps data.
 *
 * Bodies contain measured facts only - ids, titles, states, owners, dates and
 * links. Risk ratings and recommendations stay out of outbound email, so nothing
 * generated is ever presented to a team member as fact.
 */
export class EmailTemplateService {
    constructor(
        private readonly email: EmailService = getEmailService(),
        private readonly teams: TeamService = getTeamService(),
        private readonly workItems: WorkItemService = getWorkItemService(),
        private readonly sprints: SprintService = getSprintService(),
        private readonly deadlines: DeadlineService = getDeadlineService(),
        private readonly workload: WorkloadService = getWorkloadService()
    ) {}

    /** Reminder to one team member about their upcoming and overdue work. */
    async draftDeadlineReminder(options: { member: string; horizonDays?: number; extraNote?: string }): Promise<DraftPreview> {
        const horizon = Math.max(1, Math.min(options.horizonDays ?? 7, 60));
        const member = await this.teams.resolveMember(options.member);
        if (!member.email) {
            throw new AppError('INVALID_INPUT', `${member.displayName} has no email address in Azure DevOps, so a reminder cannot be addressed.`, {
                hint: 'Use email_draft with an explicit recipient address instead.'
            });
        }

        const work = await this.workload.getMemberWork(options.member);
        const [overdue, upcoming, sprint] = await Promise.all([
            Promise.resolve(work.overdue),
            this.workItems.dueBetween(0, horizon, { limit: 200 }),
            this.sprints.getCurrentSprint().catch(() => null)
        ]);

        const mineUpcoming = upcoming.filter(
            item => item.assignedToEmail?.toLowerCase() === member.email?.toLowerCase() || item.assignedTo === member.displayName
        );

        if (overdue.length === 0 && mineUpcoming.length === 0) {
            throw new AppError(
                'NOT_FOUND',
                `${member.displayName} has no overdue work and nothing due within ${horizon} day(s), so there is nothing to remind them about.`,
                { hint: 'Widen the horizon, or use email_draft to write a custom message.' }
            );
        }

        const lines: string[] = [`Hi ${firstName(member.displayName)},`, ''];
        lines.push(
            `A quick summary of your work items in ${sprint ? sprint.name : 'the current backlog'} that need attention.`,
            ''
        );

        if (overdue.length > 0) {
            lines.push(`Past due (${overdue.length}):`);
            for (const item of overdue) {
                lines.push(`  - ${item.type} #${item.id}: ${item.title} (${item.state})${item.dueDate ? ` - due ${toDateOnly(new Date(item.dueDate))}` : ''}`);
                if (item.webUrl) lines.push(`      ${item.webUrl}`);
            }
            lines.push('');
        }
        if (mineUpcoming.length > 0) {
            lines.push(`Due within the next ${horizon} day(s) (${mineUpcoming.length}):`);
            for (const item of mineUpcoming) {
                const due = parseAdoDate(item.dueDate ?? item.targetDate);
                lines.push(
                    `  - ${item.type} #${item.id}: ${item.title} (${item.state})${due ? ` - ${describeRelativeDays(due)}` : ''}`
                );
                if (item.webUrl) lines.push(`      ${item.webUrl}`);
            }
            lines.push('');
        }
        if (options.extraNote && options.extraNote.trim().length > 0) {
            lines.push(options.extraNote.trim(), '');
        }
        lines.push('Please update the work items in Azure DevOps if any of the dates or states are out of date.', '');
        lines.push(footer());

        return this.email.createDraft({
            to: [member.email],
            subject: buildSubject(
                overdue.length > 0
                    ? `Reminder: ${overdue.length} overdue item(s) and ${mineUpcoming.length} due soon`
                    : `Reminder: ${mineUpcoming.length} item(s) due within ${horizon} day(s)`,
                sprint?.name ?? null
            ),
            body: lines.join('\n'),
            kind: 'deadline_reminder',
            relatedItems: [...overdue.map(item => item.id), ...mineUpcoming.map(item => item.id)]
        });
    }

    /** Follow-up about overdue work, for one member or for the whole team. */
    async draftOverdueWorkEmail(options: { member?: string; to?: string[]; extraNote?: string }): Promise<DraftPreview> {
        const sprint = await this.sprints.getCurrentSprint().catch(() => null);
        let overdue: WorkItem[];
        let recipients: string[];
        let scopeLabel: string;
        let greeting: string;

        if (options.member) {
            const member = await this.teams.resolveMember(options.member);
            const work = await this.workload.getMemberWork(options.member);
            const ids = new Set(work.overdue.map(item => item.id));
            overdue = (await this.workItems.overdue({ limit: 300 })).filter(item => ids.has(item.id));
            if (!member.email && !options.to) {
                throw new AppError('INVALID_INPUT', `${member.displayName} has no email address in Azure DevOps.`, {
                    hint: 'Pass an explicit recipient with the `to` parameter.'
                });
            }
            recipients = options.to ?? [member.email as string];
            scopeLabel = member.displayName;
            greeting = `Hi ${firstName(member.displayName)},`;
        } else {
            overdue = await this.workItems.overdue({ limit: 300 });
            const teamEmails = (await this.teams.getMemberEmails())
                .map(entry => entry.email)
                .filter((address): address is string => address !== null);
            recipients = options.to ?? teamEmails;
            if (recipients.length === 0) {
                throw new AppError('INVALID_INPUT', 'No recipient email addresses are available for the team.', {
                    hint: 'Pass explicit addresses with the `to` parameter.'
                });
            }
            scopeLabel = 'the team';
            greeting = 'Hi all,';
        }

        if (overdue.length === 0) {
            throw new AppError('NOT_FOUND', `There is no overdue work for ${scopeLabel}, so there is nothing to follow up on.`);
        }

        const lines: string[] = [greeting, ''];
        lines.push(`${overdue.length} work item(s) are past their due date${sprint ? ` in ${sprint.name}` : ''}:`, '');
        for (const item of overdue) {
            const due = parseAdoDate(item.dueDate ?? item.targetDate);
            lines.push(
                `  - ${item.type} #${item.id}: ${item.title}`,
                `      State: ${item.state} | Owner: ${item.assignedTo ?? 'unassigned'}${due ? ` | ${describeRelativeDays(due)}` : ''}`
            );
            if (item.webUrl) lines.push(`      ${item.webUrl}`);
        }
        lines.push('');
        if (options.extraNote && options.extraNote.trim().length > 0) lines.push(options.extraNote.trim(), '');
        lines.push('Could you update the state or the due date in Azure DevOps so the plan reflects reality?', '');
        lines.push(footer());

        return this.email.createDraft({
            to: recipients,
            subject: buildSubject(`Overdue work: ${overdue.length} item(s) need an update`, sprint?.name ?? null),
            body: lines.join('\n'),
            kind: 'overdue_work',
            relatedItems: overdue.map(item => item.id)
        });
    }

    /** Daily status summary for the team, assembled from current Azure DevOps state. */
    async draftDailyTeamSummary(options: { to?: string[]; includeUnassigned?: boolean; extraNote?: string } = {}): Promise<DraftPreview> {
        const [sprint, deadlineFacts, blocked, unassigned, workloadFacts] = await Promise.all([
            this.sprints.getCurrentSprint().catch(() => null),
            this.deadlines.getDeadlineFacts(7).catch(() => null),
            this.workItems.blocked({ limit: 100 }).catch(() => []),
            this.workItems.unassigned({ limit: 100 }).catch(() => []),
            this.workload.getTeamWorkloadFacts().catch(() => null)
        ]);

        const progress = sprint ? await this.sprints.getSprintProgress(sprint).catch(() => null) : null;
        const teamEmails = (await this.teams.getMemberEmails())
            .map(entry => entry.email)
            .filter((address): address is string => address !== null);
        const recipients = options.to ?? teamEmails;
        if (recipients.length === 0) {
            throw new AppError('INVALID_INPUT', 'No recipient email addresses are available for the team.', {
                hint: 'Pass explicit addresses with the `to` parameter.'
            });
        }

        const lines: string[] = ['Hi all,', '', `Daily status for ${toDateOnly(new Date())}.`, ''];

        if (sprint && progress) {
            lines.push(
                `Sprint: ${sprint.name}${sprint.finishDate ? ` (ends ${toDateOnly(new Date(sprint.finishDate))}, ${sprint.daysRemaining} day(s) left)` : ''}`,
                `  Items: ${progress.totals.items} | Completed: ${progress.totals.completed} | In progress: ${progress.totals.inProgress} | Not started: ${progress.totals.proposed}`
            );
            if (progress.storyPoints.committed !== null) {
                lines.push(`  Story points: ${progress.storyPoints.completed} of ${progress.storyPoints.committed} completed`);
            }
            lines.push('');
        } else {
            lines.push('No current sprint is configured for the team.', '');
        }

        if (deadlineFacts) {
            lines.push(
                `Deadlines: ${deadlineFacts.counts.overdue} overdue | ${deadlineFacts.counts.dueToday} due today | ${deadlineFacts.counts.dueThisWeek} due this week`,
                ''
            );
            const dueToday = deadlineFacts.upcoming.filter(entry => entry.daysUntilDue === 0);
            if (dueToday.length > 0) {
                lines.push('Due today:');
                for (const entry of dueToday) {
                    lines.push(`  - ${entry.item.type} #${entry.item.id}: ${entry.item.title} (${entry.item.assignedTo ?? 'unassigned'})`);
                }
                lines.push('');
            }
            if (deadlineFacts.overdue.length > 0) {
                lines.push(`Overdue (${deadlineFacts.overdue.length}):`);
                for (const entry of deadlineFacts.overdue.slice(0, 15)) {
                    lines.push(
                        `  - ${entry.item.type} #${entry.item.id}: ${entry.item.title} (${entry.item.assignedTo ?? 'unassigned'}) - ${entry.relative}`
                    );
                }
                lines.push('');
            }
        }

        if (blocked.length > 0) {
            lines.push(`Blocked (${blocked.length}):`);
            for (const item of blocked.slice(0, 15)) {
                lines.push(
                    `  - ${item.type} #${item.id}: ${item.title} (${item.assignedTo ?? 'unassigned'}) - ${item.blockedSignals[0]?.evidence ?? 'blocked'}`
                );
            }
            lines.push('');
        }

        if ((options.includeUnassigned ?? true) && unassigned.length > 0) {
            lines.push(`Unassigned (${unassigned.length}):`);
            for (const item of unassigned.slice(0, 15)) {
                lines.push(`  - ${item.type} #${item.id}: ${item.title} (${item.state})`);
            }
            lines.push('');
        }

        if (workloadFacts) {
            lines.push('Open items per person:');
            for (const member of [...workloadFacts.members].sort((a, b) => b.counts.assignedOpen - a.counts.assignedOpen)) {
                lines.push(
                    `  - ${member.member.displayName}: ${member.counts.assignedOpen} open (${member.counts.active} in progress, ${member.counts.overdue} overdue)`
                );
            }
            lines.push('');
        }

        if (options.extraNote && options.extraNote.trim().length > 0) lines.push(options.extraNote.trim(), '');
        lines.push(footer());

        return this.email.createDraft({
            to: recipients,
            subject: buildSubject(`Daily team status - ${toDateOnly(new Date())}`, sprint?.name ?? null),
            body: lines.join('\n'),
            kind: 'daily_team_summary',
            relatedItems: [...blocked.map(item => item.id), ...unassigned.slice(0, 15).map(item => item.id)]
        });
    }
}

function buildSubject(text: string, sprintName: string | null): string {
    return sprintName ? `[K4K Platform] ${text} (${sprintName})` : `[K4K Platform] ${text}`;
}

function firstName(displayName: string): string {
    return displayName.split(/[\s,]+/)[0] ?? displayName;
}

function footer(): string {
    return [
        '--',
        `Prepared from live Azure DevOps data on ${new Date().toISOString()} using the K4K Team Lead Assistant.`,
        'Work item states and dates reflect Azure DevOps at the time this email was drafted.'
    ].join('\n');
}

let sharedTemplateService: EmailTemplateService | null = null;

export function getEmailTemplateService(): EmailTemplateService {
    sharedTemplateService ??= new EmailTemplateService();
    return sharedTemplateService;
}

export function setEmailTemplateServiceForTesting(service: EmailTemplateService | null): void {
    sharedTemplateService = service;
}
