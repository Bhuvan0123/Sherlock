export type SkillType = 'builtin' | 'custom';
export type SkillStatus = 'active' | 'disabled';
export type AnalysisModule = 'review' | 'backlog' | 'workload';

export interface SkillDefinition {
    id: string;
    name: string;
    type: SkillType;
    description: string;
    defaultMode: 'brief' | 'verbose' | 'visual';
    supportedModes: string[];
    requiredContext: string[];
    requiredData: string[];
    analysisModules: string[];
    recommendationEnabled: boolean;
    queryEnabled: boolean;
    navigationEnabled: boolean;
    status: SkillStatus;
}
