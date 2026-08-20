export type ResponseMode = 'brief' | 'verbose' | 'visual';
import { QueryEngine } from './query-engine.js';
import type { ExecutionContext } from './context-manager.js';
import type { CompactWorkItem } from '../azure-devops/dto.js';
import type { SkillExecutionResult } from './skill-executor.js';
import { formatSkillMarkdown, type SkillContextLabel } from './skill-layouts.js';

export interface FormattableData {
    title: string;
    description?: string;
    items?: { label: string; value: string; url?: string }[];
    markdownTable?: string;
    summary?: string;
}

export class ResponseFormatter {
    static formatError(msg: string, mode: ResponseMode = 'brief'): string {
        return `**Error:** ${msg}`;
    }

    static format(data: FormattableData, mode: ResponseMode = 'verbose'): string {
        const lines: string[] = [];

        if (mode === 'brief') {
            lines.push(`**${data.title}**`);
            if (data.summary) {
                lines.push(data.summary);
            } else if (data.items) {
                lines.push(`Found ${data.items.length} items.`);
            }
            return lines.join('\n');
        }

        lines.push(`## ${data.title}`);
        if (data.description) lines.push(data.description);

        if (mode === 'visual' && data.markdownTable) {
            lines.push('\n' + data.markdownTable);
        } else if (data.items && data.items.length > 0) {
            lines.push('');
            for (const item of data.items) {
                if (item.url) {
                    lines.push(`- **${item.label}**: [${item.value}](${item.url})`);
                } else {
                    lines.push(`- **${item.label}**: ${item.value}`);
                }
            }
        }

        if (data.summary) {
            lines.push(`\n**Summary:** ${data.summary}`);
        }

        return lines.join('\n');
    }

    static formatStructured(result: SkillExecutionResult, ctx?: SkillContextLabel): string {
        return formatSkillMarkdown(result, ctx);
    }

    static async formatWorkItems(
        items: CompactWorkItem[],
        context: ExecutionContext,
        queryName: string,
        wiql: string,
        mode: ResponseMode = 'brief'
    ): Promise<string> {
        if (items.length === 0) return `0 items found.`;
        if (items.length <= 3) {
            return this.format({
                title: queryName,
                items: items.map(i => ({ label: `${i.id}`, value: i.title, url: i.url }))
            }, mode);
        }

        const engine = new QueryEngine();
        const query = await engine.reuseOrCreateQuery(queryName, wiql, context);
        const url = engine.getQueryUrl(query.id, context);

        return `Found ${items.length} items.\n[Open Query: ${queryName}](${url})`;
    }
}
