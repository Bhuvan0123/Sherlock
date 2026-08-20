# S.H.E.R.L.O.C.K. skills (playbooks)

Repeatable workflows for the S.H.E.R.L.O.C.K. MCP server. A skill is a markdown playbook plus an executable `SkillDefinition`. Skills orchestrate existing MCP tools. **They cannot change Azure DevOps work items**, because no work-item write tool exists.

Full catalogue, modes, and query rules: [docs/SKILLS.md](../docs/SKILLS.md). Custom skills: [docs/CUSTOM-SKILLS.md](../docs/CUSTOM-SKILLS.md).

## Layout

```text
skills/
├── README.md
├── TESTING.md
├── _shared/                 rules every skill inherits
├── skill-index/
├── daily-standup-starter/
├── team-morning-brief/
├── daily-team-report/
├── weekly-team-review/
├── workload-analysis/
├── deadline-risk-analysis/
├── project-health-analysis/
├── sprint-health-analysis/
├── work-assignment-recommendation/
├── team-productivity-review/
├── tl-productivity-review/
├── backlog-data-quality/
├── hierarchy-health-analysis/
├── schedule-variance-analysis/
├── stale-work-analysis/
├── delivery-forecast/
└── dependency-analysis/
```

Directories starting with `_` are shared material, not skills. There is **no** V1 email skill.

## How the model reaches a skill

**Tools:** `skill_list`, `skill_get`, `skill_execute`

**Resources:** skill catalogue resources registered by the MCP server (local file reads)

Prefer `skill_execute` for recurring briefings instead of chaining many `ado_*` calls.

## Safety

- Work items: read-only
- Saved queries: allowed under `My Queries/{ADO_TEAM}`
- Credentials: never in SKILL.md
- Confirmation: custom skill persist requires explicit confirm; email is not in V1
