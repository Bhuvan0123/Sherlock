import { getAdoClient } from './client.js';
import type { AdoField } from './types.js';

export interface CanonicalFieldMap {
    plannedStart: string[];
    plannedEnd: string[];
    actualStart: string[];
    actualEnd: string[];
}

export interface FieldMappingInfo {
    canonicalName: string;
    adoFields: string[];
    available: boolean;
    source: string;
}

export class FieldMappingService {
    private cachedFields: AdoField[] | null = null;
    private cachedMap: CanonicalFieldMap | null = null;

    constructor(private readonly project: string) {}

    async getAvailableFields(): Promise<AdoField[]> {
        if (!this.cachedFields) {
            const client = getAdoClient();
            this.cachedFields = await client.getFields(this.project);
        }
        return this.cachedFields;
    }

    async getCanonicalMap(): Promise<CanonicalFieldMap> {
        if (this.cachedMap) return this.cachedMap;

        const fields = await this.getAvailableFields();
        const map: CanonicalFieldMap = {
            plannedStart: [],
            plannedEnd: [],
            actualStart: [],
            actualEnd: []
        };

        for (const field of fields) {
            const lower = field.name.toLowerCase();
            const refLower = field.referenceName.toLowerCase();
            
            // Check for Planned Start
            if ((lower.includes('planned start') || lower.includes('panned start')) || refLower.includes('plannedstartdate') || refLower.includes('pannedstartdate')) {
                map.plannedStart.push(field.referenceName);
            } else if (refLower === 'microsoft.vsts.scheduling.startdate') {
                map.plannedStart.push(field.referenceName);
            }

            // Check for Planned End
            if (lower.includes('planned end') || refLower.includes('plannedenddate')) {
                map.plannedEnd.push(field.referenceName);
            } else if (refLower === 'microsoft.vsts.scheduling.finishdate' || refLower === 'microsoft.vsts.scheduling.targetdate' || refLower === 'microsoft.vsts.scheduling.duedate') {
                map.plannedEnd.push(field.referenceName);
            }

            // Check for Actual Start
            if (lower.includes('actual start') || refLower.includes('actualstartdate')) {
                map.actualStart.push(field.referenceName);
            }

            // Check for Actual End
            if (lower.includes('actual end') || refLower.includes('actualenddate')) {
                map.actualEnd.push(field.referenceName);
            } else if (refLower === 'microsoft.vsts.common.closeddate') {
                map.actualEnd.push(field.referenceName);
            }
        }

        this.cachedMap = map;
        return map;
    }

    async getDiagnosticMapping(): Promise<FieldMappingInfo[]> {
        const map = await this.getCanonicalMap();
        const fields = await this.getAvailableFields();
        const byName = (match: (f: AdoField) => boolean): string[] =>
            fields.filter(match).map(f => f.referenceName);

        const quality: FieldMappingInfo[] = [
            {
                canonicalName: 'Planned Start',
                adoFields: map.plannedStart,
                available: map.plannedStart.length > 0,
                source: map.plannedStart.length > 0 ? 'Discovered' : 'Unavailable'
            },
            {
                canonicalName: 'Planned End',
                adoFields: map.plannedEnd,
                available: map.plannedEnd.length > 0,
                source: map.plannedEnd.length > 0 ? 'Discovered' : 'Unavailable'
            },
            {
                canonicalName: 'Actual Start',
                adoFields: map.actualStart,
                available: map.actualStart.length > 0,
                source: map.actualStart.length > 0 ? 'Discovered' : 'Unavailable'
            },
            {
                canonicalName: 'Actual End',
                adoFields: map.actualEnd,
                available: map.actualEnd.length > 0,
                source: map.actualEnd.length > 0 ? 'Discovered' : 'Unavailable'
            },
            {
                canonicalName: 'Description',
                adoFields: byName(f => f.referenceName === 'System.Description'),
                available: fields.some(f => f.referenceName === 'System.Description'),
                source: fields.some(f => f.referenceName === 'System.Description') ? 'Discovered' : 'Unavailable'
            },
            {
                canonicalName: 'Acceptance Criteria',
                adoFields: byName(f => /acceptancecriteria/i.test(f.referenceName) || /acceptance criteria/i.test(f.name)),
                available: fields.some(f => /acceptancecriteria/i.test(f.referenceName) || /acceptance criteria/i.test(f.name)),
                source: 'Discovered'
            }
        ];

        const custom = fields.filter(f => {
            const lower = f.referenceName.toLowerCase();
            return lower.startsWith('custom.') || lower.startsWith('k4k.') || lower.includes('.k4k');
        });
        for (const field of custom.slice(0, 40)) {
            quality.push({
                canonicalName: field.name,
                adoFields: [field.referenceName],
                available: true,
                source: 'Custom / process field'
            });
        }

        return quality;
    }
}
