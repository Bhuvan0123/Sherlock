# Skills

Built-in skills are markdown playbooks in `skills/<name>/SKILL.md` plus executable definitions in `InternalSkillRegistry`. Recurring workflows should go through `skill_execute` rather than long `ado_*` chains.

Playbooks load locally. They do not call Azure DevOps until a skill is executed.

## Modes

`skill_execute` supports:

| Mode | Audience | Shape |
| --- | --- | --- |
| `brief` | Fast decision | KPI table, at most 3 findings, at most 3 recommendations, important query links |
| `verbose` | Investigation | Module evidence, items when count ≤ 3, queries when > 3, assumptions |
| `visual` | Dashboard | Tables, severity marks, navigation links |

Severity: 🔴 critical · 🟠 attention · 🟡 watch · 🟢 healthy · 🔵 information.

Examples:

```text
Execute skill daily-standup-starter in brief mode
Execute skill daily-standup-starter in visual mode
Execute skill workload-analysis in brief mode
Execute skill project-health-analysis in visual mode
```

## Count > 3 and queries

When a category has more than three items, S.H.E.R.L.O.C.K. creates or reuses **one** saved query in `My Queries/{ADO_TEAM}` and returns the real URL. Count ≤ 3 lists items. Count 0 reports empty; no empty query.

Azure DevOps saved queries created by S.H.E.R.L.O.C.K. are automatically organized by the configured team under `My Queries/{Team Name}`. This keeps queries isolated and manageable when the same project contains multiple teams.

Reuse is team-scoped. Titles stay readable (`Overdue Work`), not `Platform - Overdue Work`.

Work items stay read-only. Query creation is the controlled exception.

## Built-in catalogue

| Skill | Purpose | Typical modules | Queries | Navigation |
| --- | --- | --- | --- | --- |
| `daily-standup-starter` | Per-member open/active work for standup | review | when groups > 3 | work-item / query URLs |
| `team-morning-brief` | Morning triage: load, deadlines, blockers | review, workload, deadline | yes | yes |
| `daily-team-report` | Keepable daily dashboard | review, sprint, workload | yes | yes |
| `weekly-team-review` | Weekly planned vs actual and next actions | review, sprint, workload | yes | yes |
| `project-health-analysis` | Executive health across sprint, load, risk, backlog, deps | sprint, workload, deadline, risk, backlog, dependency | yes | yes |
| `sprint-health-analysis` | Current sprint vs progress / carry-over signals | sprint | yes | sprint + query URLs |
| `workload-analysis` | Distribution and capacity signals (not a ranking) | workload, team-capacity, deadline | yes | yes |
| `deadline-risk-analysis` | Overdue / due soon / missing dates | deadline, risk | yes | yes |
| `dependency-analysis` | Blocked work and chains | dependency | yes | yes |
| `backlog-data-quality` | Hierarchy, fields, dates, ownership, stale, etc. | backlog, date, hierarchy, stale-work | one query per large category | yes |
| `hierarchy-health-analysis` | Epic/feature/story linking gaps | backlog, hierarchy | yes | yes |
| `schedule-variance-analysis` | Planned vs actual date completeness | backlog, date | yes | yes |
| `stale-work-analysis` | Open work with no recent change | stale-work | yes | yes |
| `delivery-forecast` | Throughput-based outlook when history exists | delivery-forecast | usually off | usually off |
| `team-productivity-review` | Team throughput and load | productivity, workload | yes | yes |
| `tl-productivity-review` | Coverage/follow-through from local audit + ADO | productivity, workload, deadline, review | optional | yes |
| `work-assignment-recommendation` | Who *could* take an item — never assigns | assignment | as needed | work-item URLs |
| `skill-index` | Router / catalogue | (router) | no | no |

Recommendations are advisory. Token strategy: shared aggregator, compact DTOs, query links instead of dumping large item lists.

## Programmatic vs conversational

- Conversational: “How is my team doing?” → `skill_execute` `daily-standup-starter` or `team-morning-brief`
- Programmatic: MCP tool `skill_execute` with name + mode

Compound **saved** workflows should be composed once (`kaarflow_compose_skill`) instead of four separate executes. See [CUSTOM-SKILLS.md](CUSTOM-SKILLS.md).

## Safety

- No skill may mutate Azure DevOps work items
- `create_ado_query` is allowed
- V1 has no email skill
