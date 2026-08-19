import { RELATION } from '../../azure-devops/fields.js';
import type { WorkItem } from '../../azure-devops/types.js';

export function typeKind(
    type: string
): 'epic' | 'feature' | 'story' | 'task' | 'bug' | 'issue' | 'requirement' | 'other' {
    const t = type.toLowerCase();
    if (t.includes('epic')) return 'epic';
    if (t.includes('feature')) return 'feature';
    if (t.includes('user story') || t.includes('product backlog') || t === 'pbi' || t === 'story') return 'story';
    if (t === 'task' || t.endsWith(' task')) return 'task';
    if (t.includes('bug') || t.includes('defect')) return 'bug';
    if (t.includes('issue') || t.includes('impediment')) return 'issue';
    if (t.includes('requirement')) return 'requirement';
    return 'other';
}

export function isOpen(item: WorkItem): boolean {
    return item.stateCategory !== 'Completed' && item.stateCategory !== 'Resolved' && item.stateCategory !== 'Removed';
}

export function isComplete(item: WorkItem): boolean {
    return item.stateCategory === 'Completed' || item.stateCategory === 'Resolved';
}

export function isActive(item: WorkItem): boolean {
    return item.stateCategory === 'InProgress';
}

export function isProposed(item: WorkItem): boolean {
    return item.stateCategory === 'Proposed' || item.stateCategory === null;
}

export function isIntentionallyWaiting(item: WorkItem): boolean {
    const state = item.state.toLowerCase();
    if (state.includes('waiting') || state.includes('hold') || state.includes('blocked') || state.includes('imped')) {
        return true;
    }
    if (item.blockedField && item.blockedField.toLowerCase() === 'yes') return true;
    return item.tags.some(tag => /blocked|on.?hold|waiting|impediment/i.test(tag));
}

/** True when the item has Hierarchy-Forward links or known children, including id-only stubs. */
export function hasChildHierarchy(item: WorkItem, children: WorkItem[] = []): boolean {
    if (children.length > 0) return true;
    return item.relations.some(rel => rel.rel === RELATION.child);
}

export function estimateOf(item: WorkItem): number | null {
    if (item.storyPoints != null) return item.storyPoints;
    if (item.effort != null) return item.effort;
    if (item.originalEstimate != null) return item.originalEstimate;
    return null;
}

export function isHighPriority(item: WorkItem): boolean {
    return item.priority === 1 || item.priority === 2;
}

export function stripHtml(value: string | null | undefined): string {
    return (value ?? '').trim();
}

const PLACEHOLDER_TITLE = /^(test|demo|sample|tbd|todo|new item|new story|new task|asdf|xxx|foo|bar|temp|placeholder)$/i;

export function isPlaceholderTitle(title: string): boolean {
    const t = title.trim();
    if (t.length === 0) return true;
    if (PLACEHOLDER_TITLE.test(t)) return true;
    if (/\b(tbd|todo|placeholder|lorem ipsum)\b/i.test(t) && t.length < 24) return true;
    return false;
}

export function isWeakTitle(title: string, type: string): boolean {
    const t = title.trim();
    if (t.length === 0) return true;
    if (isPlaceholderTitle(t)) return true;
    if (t.length < 8 && !/^[A-Z]{2,}-\d+$/.test(t)) return true;
    const kind = typeKind(type);
    if ((kind === 'story' || kind === 'epic' || kind === 'feature') && t.length < 12) return true;
    return false;
}

export function isWeakDescription(text: string | null, kind: ReturnType<typeof typeKind>): boolean {
    if (!text) return kind === 'story' || kind === 'bug' || kind === 'epic' || kind === 'feature';
    if (text.length < 40 && (kind === 'story' || kind === 'bug' || kind === 'epic')) return true;
    if (/\b(tbd|todo|placeholder|lorem ipsum|n\/a|na)\b/i.test(text) && text.length < 80) return true;
    return false;
}

export function kaarFlowQueryName(category: string): string {
    return `KaarFlow - ${category}`;
}
