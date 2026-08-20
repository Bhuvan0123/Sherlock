---
name: hierarchy-health-analysis
title: Hierarchy Health Analysis
description: Analyse Epic → Feature → User Story → Task structure for missing parents, orphaned items, empty epics or features, and closed stories without tasks. Creates an Azure DevOps saved query for each category with more than three items.
version: 2.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_hierarchy_health
supporting_tools:
  - ado_query_work_items
  - ado_get_backlogs
  - ado_get_work_items_by_type
  - ado_get_parent_work_item
  - ado_get_work_item_hierarchy
  - ado_get_work_item
  - ado_query_work_items
missing_capabilities:
  - "KaarPulse cannot re-parent or create child work items."
  - "There is no saved-query discovery tool. Reuse happens only when ado_query_work_items returns QUERY_ALREADY_EXISTS."
  - "Flat WIQL cannot always express 'has no children'. Closest valid filters are used and the limitation is stated."
triggers:
  - run hierarchy health analysis
  - check hierarchy health analysis
  - check hierarchy health
  - find orphaned tasks
  - are there orphaned tasks
  - find empty epics
---

# Hierarchy Health Analysis

## Purpose

Show whether the Platform backlog is a coherent Epic → Feature → User Story → Task tree, or a set of orphans and empty parents. Report affected **groups**, not every item. When a group has more than three work items, create or reuse a saved Azure DevOps query via `ado_query_work_items`.

## When to Use

Use when the Team Lead asks about orphans, missing parents, empty epics/features, broken hierarchy, or closed stories without tasks as a structural problem.

Use `backlog-data-quality` for the broader field-completeness picture; use this skill when hierarchy is the question.

## Required Inputs

None. Scope is the configured project and team.

## Data Sources

- `analysis_hierarchy_health` — orphans and empty parents on the scanned set.
- `ado_get_backlogs` — backlog levels and types actually in use.
- `ado_query_work_items` — presets `epics`, `features`, `userStories`, `tasks`.
- `ado_get_work_items_by_type`, `ado_get_parent_work_item`, `ado_get_work_item_hierarchy` — targeted parent/child checks. Do not N+1 the entire backlog; sample only when the composite tool is insufficient and state the sample size.
- `ado_query_work_items` — saved query for groups with count > 3.

## Workflow

1. **Call `ado_get_backlogs`** so hierarchy language matches this process (User Story vs Product Backlog Item).
2. **Call `analysis_hierarchy_health`.** Group `itemsWithIssues` by `issue`. Count each group.
3. **If needed, corroborate** with `ado_query_work_items` by type. Reuse items already fetched. Avoid duplicate ADO scans.
4. **Apply the count > 3 rule** from `_shared/query-workflow.md`. Example titles: `Platform - Orphaned Tasks`, `Platform - Stories Without Features`, `Platform - Empty Features`, `Platform - Closed Stories Without Tasks`.
5. **Call `ado_query_work_items`** only for qualifying groups, using real type names and `System.Parent` in SELECT when available. On `QUERY_ALREADY_EXISTS`, reuse the URL.
6. **Show groups, not dumps.** Three or fewer items: list them. More: count + query link.
7. **Explain why it matters** (traceability, sprint planning, completion claims) and recommend cleanup order. No work items are modified.

## Analysis Rules

Detect: missing parents; orphaned tasks; stories without features; features without epics; empty epics; empty features; closed stories without tasks (from hierarchy or from `analysis_backlog_quality` if already loaded).

An Epic with no children is empty, not orphaned. A Task with no parent is an orphan. Do not conflate them.

Sampling honesty: if parent checks were sampled, report "n of N sampled", never a backlog-wide percentage.

WIQL for "no children" is often approximate. State that the query lists candidate parents/types and the child gap was measured by the analysis tool.

## Output Format

**Output Mode**: The user may request a specific output mode (e.g. `brief`, `verbose`, `visual`). You must adapt your formatting to match the requested mode.


Follow `_shared/output-format.md`.

1. `# 📊 KaarPulse — Hierarchy Health`
2. Executive summary with indicator.
3. **📌 At a Glance** — items analysed, orphan count, empty-parent count.
4. **🚨 What Needs Attention** — highest-severity groups (orphan tasks before empty epics).
5. Tree sketch of the intended hierarchy and where it breaks.
6. **🔎 Azure DevOps Queries** — real links only.
7. **🧠 Insights** — impact on planning and "done" claims.
8. **💡 Recommendations** and **🧭 TL Decision Support** (re-parent orphans first vs fill empty epics first).
9. **🎯 Recommended Actions** — Today / This Week / Optional.
10. Footer: **ADO Work Items Modified: No**.

## Edge Cases

| Situation | What to do |
| --- | --- |
| No hierarchy issues | Say so. Do not create queries. |
| Count <= 3 | List items. Skip saved query. |
| Lowest backlog level has no parent by design | Do not call that "broken". Check `ado_get_backlogs` first. |
| Custom type names | Use literals from `ado_get_backlogs` / types. Never assume "User Story". |
| Query folder missing or WIQL invalid | Present groups without a fake URL. |
| Duplicate query title | Reuse `existingQueryUrl`. |
| Team Lead asks to link parents | Refuse the write. Offer the query and an email draft via `team-email-assistant`. |
| Composite tool fails | Sample with `ado_get_work_items_by_type` (limit 25), state coverage, never extrapolate. |

## Safety Rules

All of `_shared/safety-rules.md` applies. Work items stay read-only. Saved queries via `ado_query_work_items` are the only Azure DevOps write. Never invent URLs or parent relationships.

## Example Requests

- "Check hierarchy health."
- "Are there orphaned tasks?"
- "Find empty epics and features."
- "Show stories that are not under a Feature."
- "Closed stories without tasks — as a hierarchy issue."
