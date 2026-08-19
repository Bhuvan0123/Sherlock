# Skills

KaarPulse skills are markdown workflows in `skills/<name>/SKILL.md`. They tell the Team Lead assistant **how** to use existing MCP tools. Loading a skill contacts nothing.

## Decision-support pipeline

Every major skill follows `_shared/query-workflow.md`:

FETCH → ANALYSE → GROUP → COUNT → IDENTIFY SIGNIFICANT CATEGORIES → CREATE ADO QUERY → RETURN QUERY URL → VISUALIZE → EXPLAIN INSIGHTS → RECOMMEND ACTIONS → SUPPORT TL DECISION

The response is a dashboard, not a dump of work items.

## Count > 3 rule

When a skill identifies a **category** (a meaningful group sharing one condition):

| Count | Behaviour |
| --- | --- |
| `> 3` | Create or reuse one saved Azure DevOps query via `create_ado_query`. Show Title, Description, Count and the real Navigate link. |
| `<= 3` | List the items directly. Do not create a saved query unless the category is strategically important. |
| `0` | Report that nothing matched. Do not create an empty query. |

Do not create a query per work item or per team member unless asked.

## Central query creation

Skills must not invent their own query writer. Path:

Skill → analysis → query definition (WIQL + fields) → `create_ado_query` → saved query + URL → response table

Field names come from `ado_get_field_mapping` / the live process. See [query-engine.md](query-engine.md) and [query-fields.md](query-fields.md).

## Query reuse

There is **no** saved-query list/discovery tool. Reuse is by predictable title (`Platform - Overdue Work`). If `create_ado_query` returns `QUERY_ALREADY_EXISTS`, use `existingQueryUrl` / `savedQueryUrl` and `resultCount`. Do not create timestamped duplicates.

## Skill integration

Compound requests chain analysis first, then reporting, then email. Example:

`team-morning-brief` → `deadline-risk-analysis` → `workload-analysis` → `dependency-analysis` → `backlog-data-quality` → query creation → combined dashboard

Reuse fetched data. One saved query per unique title in a chain.

## Visual response

Skills use `_shared/output-format.md`: KPI tables, status indicators, progress/workload bars (only from measured values), Insights, Recommendations (what / why / impact / when / evidence), TL Decision Support, and Today / This Week / Optional actions.

## Recommendation framework

Each recommendation answers what the TL should do, why, expected impact, and when. Evidence should be a real query link when a query exists. KaarPulse does not apply work-item changes.

## Safety

Azure DevOps **work items** remain read-only. Creating a saved query is allowed. Email still requires explicit per-draft confirmation.
