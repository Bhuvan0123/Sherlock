import { type ExecutionContext } from './context-manager.js';
export class AnalysisEngine {
    /**
     * Executes a specific analysis module by name.
     * This acts as an allowlist for custom skills to call analysis logic securely.
     */
    static async runAnalysisModule(
        moduleName: string, 
        context: ExecutionContext,
        args?: any
    ): Promise<any> {
        switch (moduleName) {
            case 'backlogQualityAnalysis':
                return { status: 'mocked backlogQualityAnalysis' };
            case 'dateAnalysis':
                return { status: 'mocked dateAnalysis' };
            case 'hierarchyAnalysis':
                return { status: 'mocked hierarchyAnalysis' };
            case 'workloadAnalysis':
                return { status: 'mocked workloadAnalysis' };
            case 'sprintAnalysis':
                return { status: 'mocked sprintAnalysis' };
            case 'deadlineAnalysis':
                return { status: 'mocked deadlineAnalysis' };
            case 'dependencyAnalysis':
                return { status: 'mocked dependencyAnalysis' };
            case 'staleWorkAnalysis':
                return { status: 'mocked staleWorkAnalysis' };
            case 'productivityAnalysis':
                return { status: 'mocked productivityAnalysis' };
            default:
                throw new Error(`Analysis module '${moduleName}' is not allowed or does not exist.`);
        }
    }

    /** Returns all available modules for custom skills */
    static getAvailableModules(): string[] {
        return [
            'backlogQualityAnalysis',
            'dateAnalysis',
            'hierarchyAnalysis',
            'workloadAnalysis',
            'sprintAnalysis',
            'deadlineAnalysis',
            'dependencyAnalysis',
            'staleWorkAnalysis',
            'productivityAnalysis'
        ];
    }
}
