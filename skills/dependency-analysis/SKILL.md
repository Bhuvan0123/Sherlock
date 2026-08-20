---
name: dependency-analysis
title: Dependency Analysis
description: Analyse blocked Platform work, items that block others, cross-team dependencies and overdue dependency chains. Creates an Azure DevOps saved query for each dependency category with more than three items.
version: 2.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_dependencies
  - analysis_blocked_items
supporting_tools:
  - analysis_cross_team_dependencies
  - analysis_items_blocking_release
  - analysis_critical_dependencies
  - ado_get_blocked_items
  - ado_get_related_work_items
  - ado_get_work_item
  - ado_query_work_items
missing_capabilities:
  - "KaarPulse cannot add, remove or complete predecessor links."
  - "WIQL cannot project relation rows; saved queries list the item set, while blocker → downstream is shown in this response from analysis tools."
  - "There is no saved-query discovery tool. Reuse happens only via QUERY_ALREADY_EXISTS."
triggers:
  - run dependency analysis
  - check dependency analysis
  - analyze dependencies
  - what is blocking us
  - what is blocking what
  - check dependency impact
---

# Dependency Analysis

## Purpose

Show what is blocked, what is blocking multiple items, which dependencies cross team boundaries, and which chains are overdue. Identify the highest-impact blocker. When a dependency category has more than three work items, create or reuse a saved Azure DevOps query for that set.

## When to Use

Use when the Team Lead asks what is blocking delivery, what blocks what, cross-team waits, or dependency impact.

Use `deadline-risk-analysis` for date risk. Use this skill when links and blockers are the subject.

## Required Inputs

None. Optional: a work item id — still run the team view, then expand that item with `ado_get_related_work_items` / `ado_get_work_item`.

## Data Sources

- `analysis_blocked_items` — blocked work with `blockedSignals` and days unchanged.
- `analysis_dependencies` — predecessor/successor scan (bounded; pass coverage on).
- `analysis_cross_team_dependencies` — links outside the team area paths.
- `analysis_items_blocking_release` — unresolved work others wait on.
- `analysis_critical_dependencies` — longest chains and circular links.
- `ado_get_blocked_items`, `ado_get_related_work_items` — drill-down.
- `ado_query_work_items` — e.g. `Platform - Blocked Work` when count > 3.

## Workflow

1. **Call `analysis_blocked_items` and `analysis_dependencies`.** Record coverage/limits. Deduplicate by id.
2. **Call `analysis_cross_team_dependencies`, `analysis_items_blocking_release` and `analysis_critical_dependencies`.** Do not reconstruct chains from primitives while these succeed.
3. **Group** into: blocked work; work blocking multiple items; cross-team dependencies; overdue dependencies; circular / critical chains.
4. **Count.** For count > 3, `ado_query_work_items` with columns ID, Title, Type, State, Assigned To, Priority, Iteration, Parent, Planned End (if mapped). Title examples: `Platform - Blocked Work`, `Platform - Cross-Team Dependencies`, `Platform - Overdue Dependencies`. Reuse existing titles.
5. **Identify the highest-impact dependency** (most downstream items, or blocked + overdue + current sprint). Show:

```
Blocker  →  Downstream items  →  Potential impact
```

Use real ids and titles. Include work-item navigation from tool `webUrl` fields when present — never invent URLs. Query links come only from `ado_query_work_items`.

6. **Recommend** unblock order. KaarPulse cannot complete predecessors. No work items are modified.

## Analysis Rules

"Blocked" without `blockedSignals` is not actionable. Always print the evidence (state, tag, CMMI field, unfinished predecessor).

Coverage: `analysis_dependencies` defaults to a bounded scan. If the result says it hit a limit, qualify every chain conclusion.

Circular links are reported with the ids returned. Do not "fix" the loop in prose by omitting an id.

Do not blame a person for a cross-team wait.

## Output Format

**Output Mode**: The user may request a specific output mode (e.g. `brief`, `verbose`, `visual`). You must adapt your formatting to match the requested mode.


Follow `_shared/output-format.md`.

1. `# 📊 KaarPulse — Dependency Analysis`
2. Executive summary naming the top blocker.
3. **📌 At a Glance** — blocked count, items blocking others, cross-team, circular.
4. **🔗 Dependency Impact** — blocker → downstream → impact, with ids.
5. **🔎 Azure DevOps Queries** for categories with count > 3.
6. **🧠 Insights**, **⚠️ Risks**, **💡 Recommendations**, **🧭 TL Decision Support** (swarm the top blocker vs spread unblocks).
7. **🎯 Actions**. Footer: **ADO Work Items Modified: No**.

## Edge Cases

| Situation | What to do |
| --- | --- |
| Nothing blocked and no links | Say so. Short response. No queries. |
| Count <= 3 blocked | List them with evidence. Skip query unless asked. |
| Scan truncated | State the limit. Do not present the chain list as complete. |
| Cross-team blocker | Recommend a conversation; KaarPulse cannot change the other team. |
| Circular dependency | Report the loop. Human fix in Azure DevOps. |
| Query creation fails | Keep the impact diagram; no fake query URL. |
| Team Lead asks to add a predecessor | Refuse. Read-only for work items. |

## Safety Rules

All of `_shared/safety-rules.md` applies. Work items and links stay read-only. `ado_query_work_items` is the only Azure DevOps write. Never invent a relation or a query URL.

## Example Requests

- "What is blocking us?"
- "What is blocking what?"
- "Analyse dependencies."
- "Show cross-team dependencies."
- "Blocked work — give me an Azure DevOps query if there are several."
