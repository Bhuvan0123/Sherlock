import { daysBetween, parseAdoDate } from '../../../utils/dates.js';
import { calculateScheduleVariance } from '../schedule.service.js';
import type { BacklogContext, Finding } from './types.js';
import { isActive, isComplete, isHighPriority, isOpen, typeKind } from './classify.js';

export function checkDatesAndSchedule(ctx: BacklogContext): Finding[] {
    const findings: Finding[] = [];
    const now = ctx.now;

    for (const item of ctx.items) {
        const kind = typeKind(item.type);
        const open = isOpen(item);
        const pStart = parseAdoDate(item.plannedStart);
        const pEnd = parseAdoDate(item.plannedEnd);
        const aStart = parseAdoDate(item.actualStart);
        const aEnd = parseAdoDate(item.actualEnd);

        if (ctx.fields.plannedStart && open && !item.plannedStart && (isActive(item) || kind === 'story' || kind === 'feature')) {
            findings.push({
                itemId: item.id,
                category: 'Missing Planned Start',
                dimension: 'dates',
                issue: 'Planned Start is empty',
                severity: isActive(item) ? 'Medium' : 'Low',
                reviewRecommended: !isActive(item)
            });
        }
        if (ctx.fields.plannedEnd && open && !item.plannedEnd && (isActive(item) || isHighPriority(item) || kind === 'feature' || kind === 'epic')) {
            findings.push({
                itemId: item.id,
                category: 'Missing Planned End',
                dimension: 'dates',
                issue: 'Planned End / target date is empty',
                severity: isHighPriority(item) || isActive(item) ? 'High' : 'Medium'
            });
        }
        if (ctx.fields.actualStart && isActive(item) && !item.actualStart) {
            findings.push({
                itemId: item.id,
                category: 'Active Missing Actual Start',
                dimension: 'dates',
                issue: 'Item is in progress but Actual Start is empty',
                severity: 'Medium'
            });
        }
        if (ctx.fields.actualEnd && isComplete(item) && !item.actualEnd && !item.closedDate) {
            findings.push({
                itemId: item.id,
                category: 'Closed Missing Actual End',
                dimension: 'dates',
                issue: 'Completed item has no Actual End / Closed Date',
                severity: 'High'
            });
        }
        if (ctx.fields.actualStart && isComplete(item) && !item.actualStart && !item.activatedDate) {
            findings.push({
                itemId: item.id,
                category: 'Closed Missing Actual Start',
                dimension: 'dates',
                issue: 'Completed item has no Actual Start',
                severity: 'Low',
                reviewRecommended: true
            });
        }
        if (ctx.fields.actualEnd && open && item.actualEnd) {
            findings.push({
                itemId: item.id,
                category: 'Active With Actual End',
                dimension: 'dates',
                issue: 'Open item has an Actual End date',
                severity: 'High'
            });
        }

        if (pStart && pEnd && pStart > pEnd) {
            findings.push({
                itemId: item.id,
                category: 'Invalid Planned Dates',
                dimension: 'dates',
                issue: 'Planned Start is after Planned End',
                severity: 'High'
            });
        }
        if (aStart && aEnd && aStart > aEnd) {
            findings.push({
                itemId: item.id,
                category: 'Invalid Actual Dates',
                dimension: 'dates',
                issue: 'Actual Start is after Actual End',
                severity: 'High'
            });
        }
        if (aStart && aStart.getTime() > now.getTime() + 24 * 3600 * 1000) {
            findings.push({
                itemId: item.id,
                category: 'Future Actual Start',
                dimension: 'dates',
                issue: 'Actual Start is in the future',
                severity: 'Medium'
            });
        }

        if (open && pEnd && pEnd.getTime() < now.getTime()) {
            findings.push({
                itemId: item.id,
                category: isHighPriority(item) ? 'Overdue High Priority Work' : 'Overdue Work',
                dimension: 'dates',
                issue: `Past planned end (${Math.abs(daysBetween(pEnd, now))} day(s))`,
                severity: isHighPriority(item) ? 'Critical' : 'High'
            });
        } else if (open && pEnd) {
            const daysLeft = daysBetween(now, pEnd);
            if (daysLeft >= 0 && daysLeft <= 3 && isActive(item)) {
                findings.push({
                    itemId: item.id,
                    category: 'Approaching Deadline',
                    dimension: 'dates',
                    issue: `Planned end in ${daysLeft} day(s)`,
                    severity: 'Medium'
                });
            }
        }

        const variance = calculateScheduleVariance(item);
        if (variance.completionVarianceDays != null && variance.completionVarianceDays >= 14) {
            findings.push({
                itemId: item.id,
                category: 'Excessive Schedule Variance',
                dimension: 'dates',
                issue: `Completion variance ${variance.completionVarianceDays} day(s)`,
                severity: 'High'
            });
        }

        const parent = item.parentId ? ctx.parentOf.get(item.id) ?? ctx.byId.get(item.parentId) : undefined;
        if (parent) {
            const parentEnd = parseAdoDate(parent.plannedEnd) ?? parseAdoDate(parent.actualEnd);
            if (pEnd && parentEnd && pEnd > parentEnd) {
                findings.push({
                    itemId: item.id,
                    category: 'Child Scheduled After Parent End',
                    dimension: 'dates',
                    issue: `Child planned end is after parent #${parent.id} planned/actual end`,
                    severity: 'Medium',
                    reviewRecommended: true
                });
            }
        }
    }

    return findings;
}
