/**
 * Date helpers used across deadline, sprint and productivity analysis.
 *
 * All comparisons are done in the host machine's local time zone, which is the
 * Team Lead's own time zone. "Today" therefore means the Team Lead's today.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfDay(date: Date = new Date()): Date {
    const copy = new Date(date.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
}

export function endOfDay(date: Date = new Date()): Date {
    const copy = new Date(date.getTime());
    copy.setHours(23, 59, 59, 999);
    return copy;
}

export function addDays(date: Date, days: number): Date {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
}

/** Monday-based start of the week containing `date`. */
export function startOfWeek(date: Date = new Date()): Date {
    const copy = startOfDay(date);
    const weekday = copy.getDay(); // 0 = Sunday
    const offset = weekday === 0 ? -6 : 1 - weekday;
    return addDays(copy, offset);
}

/** Sunday end-of-day of the week containing `date`. */
export function endOfWeek(date: Date = new Date()): Date {
    return endOfDay(addDays(startOfWeek(date), 6));
}

/** Parses an Azure DevOps date field, returning null for missing/invalid values. */
export function parseAdoDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `YYYY-MM-DD` in local time. */
export function toDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
    return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** Working days (Mon-Fri) remaining from `from` up to and including `to`. */
export function businessDaysBetween(from: Date, to: Date): number {
    if (to.getTime() < from.getTime()) return 0;
    let count = 0;
    let cursor = startOfDay(from);
    const limit = startOfDay(to);
    while (cursor.getTime() <= limit.getTime()) {
        const weekday = cursor.getDay();
        if (weekday !== 0 && weekday !== 6) count += 1;
        cursor = addDays(cursor, 1);
    }
    return count;
}

export function isSameDay(a: Date, b: Date): boolean {
    return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function isToday(date: Date, now: Date = new Date()): boolean {
    return isSameDay(date, now);
}

export function isOverdue(dueDate: Date, now: Date = new Date()): boolean {
    return startOfDay(dueDate).getTime() < startOfDay(now).getTime();
}

/** Human-friendly relative description, for example "3 days overdue" / "due in 2 days". */
export function describeRelativeDays(target: Date, now: Date = new Date()): string {
    const delta = daysBetween(now, target);
    if (delta === 0) return 'due today';
    if (delta === 1) return 'due tomorrow';
    if (delta === -1) return '1 day overdue';
    if (delta < 0) return `${Math.abs(delta)} days overdue`;
    return `due in ${delta} days`;
}

/** ISO-8601 timestamp, the storage format for the activity audit trail. */
export function nowIso(): string {
    return new Date().toISOString();
}
