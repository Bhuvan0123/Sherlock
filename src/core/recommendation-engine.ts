export type RecommendationPriority = 'High' | 'Medium' | 'Low';

export interface StructuredFinding {
    priority: RecommendationPriority;
    finding: string;
    evidence: string[];
    recommendedAction: string;
    timeframe: 'Immediate' | 'Next Standup' | 'Next Sprint' | 'Backlog Refinement';
    confidence: 'High' | 'Medium' | 'Low';
}

export class RecommendationEngine {
    /**
     * Converts a set of raw insights or rule violations into structured findings
     * that tools and skills can format directly for the user.
     */
    static generateFindings(insights: {
        issue: string;
        severity: 'critical' | 'warning' | 'info';
        data: string[];
        action: string;
    }[]): StructuredFinding[] {
        return insights.map(insight => {
            const priority = insight.severity === 'critical' ? 'High' : 
                             insight.severity === 'warning' ? 'Medium' : 'Low';
            const timeframe = priority === 'High' ? 'Immediate' :
                              priority === 'Medium' ? 'Next Standup' : 'Backlog Refinement';
                              
            return {
                priority,
                finding: insight.issue,
                evidence: insight.data,
                recommendedAction: insight.action,
                timeframe,
                confidence: 'High'
            };
        });
    }

    /**
     * Formats structured findings into markdown.
     */
    static formatFindings(findings: StructuredFinding[]): string {
        if (findings.length === 0) {
            return 'No actionable findings at this time.';
        }

        const lines = ['### Recommended Actions'];
        findings.sort((a, b) => {
            const weights = { 'High': 3, 'Medium': 2, 'Low': 1 };
            return weights[b.priority] - weights[a.priority];
        });

        for (const finding of findings) {
            lines.push(`\n**[${finding.priority} Priority] ${finding.finding}**`);
            if (finding.evidence.length > 0) {
                lines.push(`*Evidence*: ${finding.evidence.join(', ')}`);
            }
            lines.push(`*Action*: **${finding.recommendedAction}** (Timeframe: ${finding.timeframe})`);
        }

        return lines.join('\n');
    }
}
