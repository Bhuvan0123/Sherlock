import { parseAdoDate, businessDaysBetween, daysBetween } from '../../utils/dates.js';
import type { WorkItem } from '../azure-devops/types.js';

export interface ScheduleVariance {
    plannedDurationDays: number | null;
    actualDurationDays: number | null;
    startVarianceDays: number | null;
    completionVarianceDays: number | null;
    scheduleVarianceDays: number | null;
    isLateStart: boolean;
    isLateCompletion: boolean;
    isComplete: boolean;
}

/**
 * Calculates schedule variance using canonical ADO dates (plannedStart/End, actualStart/End).
 * Returns business days for durations and standard days for variance (so a delay over the weekend counts).
 * If a date is missing, the corresponding metric is null.
 */
export function calculateScheduleVariance(item: WorkItem): ScheduleVariance {
    const pStart = parseAdoDate(item.plannedStart);
    const pEnd = parseAdoDate(item.plannedEnd);
    const aStart = parseAdoDate(item.actualStart);
    const aEnd = parseAdoDate(item.actualEnd);
    const isComplete = item.stateCategory === 'Completed' || item.stateCategory === 'Resolved';

    // Durations: business days (M-F)
    const plannedDurationDays = pStart && pEnd ? businessDaysBetween(pStart, pEnd) : null;
    
    let actualDurationDays: number | null = null;
    if (aStart) {
        if (aEnd) {
            actualDurationDays = businessDaysBetween(aStart, aEnd);
        } else if (!isComplete) {
            actualDurationDays = businessDaysBetween(aStart, new Date());
        }
    }

    // Variances: calendar days (positive = late)
    const startVarianceDays = pStart && aStart ? daysBetween(pStart, aStart) : null;
    
    let completionVarianceDays: number | null = null;
    if (pEnd) {
        if (aEnd) {
            completionVarianceDays = daysBetween(pEnd, aEnd);
        } else if (!isComplete && daysBetween(pEnd, new Date()) > 0) {
            // Overdue but not complete yet
            completionVarianceDays = daysBetween(pEnd, new Date());
        }
    }

    const scheduleVarianceDays = plannedDurationDays !== null && actualDurationDays !== null 
        ? actualDurationDays - plannedDurationDays 
        : null;

    return {
        plannedDurationDays,
        actualDurationDays,
        startVarianceDays,
        completionVarianceDays,
        scheduleVarianceDays,
        isLateStart: startVarianceDays !== null && startVarianceDays > 0,
        isLateCompletion: completionVarianceDays !== null && completionVarianceDays > 0,
        isComplete
    };
}
