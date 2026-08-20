import { getDatabase, type Database } from '../connection.js';
import type { SkillDefinition } from '../../core/skill-definition.js';
import { AppError } from '../../utils/errors.js';

export interface CustomSkillRow {
    id: number;
    name: string;
    description: string;
    definitionJson: string;
    version: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    status: 'active' | 'disabled';
}

export class CustomSkillRepository {
    constructor(private readonly db: Database = getDatabase()) {}

    insert(skill: SkillDefinition, createdBy: string = 'team-lead'): void {
        const now = new Date().toISOString();
        const json = JSON.stringify(skill);
        
        try {
            this.db.run(
                `INSERT INTO custom_skills 
                    (name, description, definition_json, version, created_by, created_at, updated_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [skill.name, skill.description, json, 1, createdBy, now, now, skill.status]
            );
        } catch (e: any) {
            if (e.message?.includes('UNIQUE constraint failed')) {
                throw new AppError('INVALID_INPUT', `Custom skill '${skill.name}' already exists.`);
            }
            throw e;
        }
    }

    update(skill: SkillDefinition): void {
        const now = new Date().toISOString();
        const json = JSON.stringify(skill);

        const result = this.db.run(
            `UPDATE custom_skills 
             SET description = ?, definition_json = ?, version = version + 1, updated_at = ?, status = ?
             WHERE name = ?`,
            [skill.description, json, now, skill.status, skill.name]
        );

        if (result.changes === 0) {
            throw new AppError('NOT_FOUND', `Custom skill not found: ${skill.name}`);
        }
    }

    delete(name: string): void {
        const result = this.db.run(`DELETE FROM custom_skills WHERE name = ?`, [name]);
        if (result.changes === 0) {
            throw new AppError('NOT_FOUND', `Custom skill not found: ${name}`);
        }
    }

    getVersion(name: string): number | null {
        const row = this.db.get<{ version: number }>(`SELECT version FROM custom_skills WHERE name = ?`, [name]);
        return row ? Number(row.version) : null;
    }

    get(name: string): SkillDefinition | null {
        const row = this.db.get<{ definition_json: string; status: string }>(
            `SELECT definition_json, status FROM custom_skills WHERE name = ?`,
            [name]
        );

        if (!row) return null;

        try {
            const skill = JSON.parse(row.definition_json) as SkillDefinition;
            // Ensure status overrides what is in JSON in case they diverged
            skill.status = row.status as 'active' | 'disabled';
            return skill;
        } catch {
            return null;
        }
    }

    list(): SkillDefinition[] {
        const rows = this.db.all<{ definition_json: string; status: string }>(
            `SELECT definition_json, status FROM custom_skills ORDER BY name ASC`
        );

        const skills: SkillDefinition[] = [];
        for (const row of rows) {
            try {
                const skill = JSON.parse(row.definition_json) as SkillDefinition;
                skill.status = row.status as 'active' | 'disabled';
                skills.push(skill);
            } catch {
                // Skip malformed
            }
        }
        return skills;
    }

    setStatus(name: string, status: 'active' | 'disabled'): void {
        const now = new Date().toISOString();
        const result = this.db.run(
            `UPDATE custom_skills SET status = ?, updated_at = ? WHERE name = ?`,
            [status, now, name]
        );

        if (result.changes === 0) {
            throw new AppError('NOT_FOUND', `Custom skill not found: ${name}`);
        }
    }
}

let sharedRepository: CustomSkillRepository | null = null;

export function getCustomSkillRepository(): CustomSkillRepository {
    sharedRepository ??= new CustomSkillRepository();
    return sharedRepository;
}

export function setCustomSkillRepositoryForTesting(repository: CustomSkillRepository | null): void {
    sharedRepository = repository;
}
