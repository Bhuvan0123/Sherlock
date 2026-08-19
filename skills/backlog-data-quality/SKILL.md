---
name: backlog-data-quality
title: Backlog Governance and Quality Analysis
description: Analyse the Platform backlog across hierarchy, fields, dates, state, ownership, estimates, sprint, bugs, stale work, duplicates, dependencies and custom K4K fields. Count each category; create_ado_query when count > 3 under My Queries/KaarFlow.
version: 3.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_backlog_quality
supporting_tools:
  - ado_get_field_mapping
  - ado_get_work_item_types
  - ado_query_work_items
  - ado_get_unassigned_items
  - analysis_stale_work
  - analysis_hierarchy_health
  - analysis_dependencies
  - ado_get_work_item
  - ado_get_blocked_items
  - ado_get_current_sprint
  - create_ado_query
missing_capabilities:
  - "Cannot fix missing dates, estimates, parents or descriptions — those changes happen in Azure DevOps."
  - "There is no saved-query list tool. Equivalent queries are reused only when create_ado_query returns QUERY_ALREADY_EXISTS for the same KaarFlow title."
  - "History-based reopen counts are not loaded for every item (too expensive). Reopen is flagged when Reason indicates it."
triggers:
  - run backlog data quality
  - check backlog data quality
  - find backlog items with missing information
  - show faulty work items
  - find stories without descriptions
  - find items without acceptance criteria
  - find backlog quality issues
  - show me the problematic work items
  - analyse the entire platform backlog for data quality and governance issues
  - find all faults in the current backlog
  - perform a deep backlog health analysis
---

# Backlog Governance and Quality Analysis

## Purpose

Give the Team Lead a **broad** governance view of the K4K Platform backlog — not only missing dates or stories without tasks. `analysis_backlog_quality` scans hierarchy, required fields, title/description quality, type-specific Story/Epic/Feature/Task/Bug checks, dates, state consistency, ownership, estimates, sprint/area, priority, stale work, duplicates, dependencies and discovered custom fields.

Findings are grouped and counted. When a category has **count > 3**, create (or reuse) a saved Azure DevOps query under **My Queries / KaarFlow** and return the real navigation URL. Never dump large item lists. Never modify work items.

## When to Use

Use when the Team Lead asks to analyse backlog quality, governance, faults, missing data, hierarchy holes, stale or unassigned work, or wants Azure DevOps queries for cleanup.

Use a different skill when:

- the question is **only** hierarchy → `hierarchy-health-analysis`
- the question is **only** stale activity → `stale-work-analysis`
- the question is schedule delay on dates that exist → `schedule-variance-analysis`
- the Team Lead wants the whole-project score → `project-health-analysis`

If they ask for a deep / entire-backlog health analysis, **this** skill is the right one.

## Required Inputs

None. Organization, project and team come from server configuration (KEBS4KAAR / K4K / Platform).

Optional: a focus such as "just missing planned dates" — still run the full `analysis_backlog_quality` scan for consistent counts, then emphasise the requested categories.

## Data Sources

All facts come from KaarPulse MCP tools. Do not invent work items, URLs, fields or percentages.

- `analysis_backlog_quality` — primary scan. `facts.categories[]` has count, severity, samples, `createQuery`, `queryName`, `queryDescription`, `suggestedWiql`. `facts.queryHints` lists categories that need a saved query. `methodology` states field and coverage limits.
- `ado_get_field_mapping` — which planned/actual/description/custom fields exist. Unknown is not zero.
- `ado_get_work_item_types` — real type and state names (do not assume Agile-only names).
- `create_ado_query` — the only Azure DevOps write. Folder is always `My Queries/KaarFlow`.
- Supporting: `analysis_hierarchy_health`, `analysis_stale_work`, `analysis_dependencies`, `ado_get_unassigned_items`, `ado_get_blocked_items`, `ado_query_work_items` if the primary envelope is incomplete. Prefer the primary tool when both exist; if they disagree, name both.

## Workflow

1. **Call `ado_get_field_mapping`** (and `ado_get_work_item_types` if types are not already in the envelope). Record unavailable field families as limitations, not zeros.
2. **Call `analysis_backlog_quality`.** This is the single-pass scan. Do not re-query Azure DevOps once per check.
3. **Read `facts.categories`.** Every category already has a count. Deduplicate by `category` name. Do not invent extra categories.
4. **Apply the count rule** from `_shared/query-workflow.md`:
   - `count > 3` → `create_ado_query` using that category's `queryName` (`KaarFlow - <Category>`), `queryDescription`, `suggestedWiql` (ID IN list of measured items — this is exact, including structural checks), and `facts.defaultColumns`. `project` from `facts.project`.
   - `count <= 3` → list the items (`samples` or `itemIds`) with real `webUrl`. Do **not** create a query unless the Team Lead asked or the issue is strategically critical (for example a Critical blocker set).
   - `count == 0` → omit.
5. **Deduplicate queries.** Same `queryName` → one `create_ado_query`. On `QUERY_ALREADY_EXISTS`, reuse `savedQueryUrl` / `existingQueryUrl` and `resultCount`. Never create `KaarFlow - … 2`.
6. **Do not dump** more than three items per category. For large sets show count, up to three samples, and the query link.
7. **Assemble the dashboard** in Output Format. Insights only from `observations` or measured counts/denominators (`totalAnalyzed`, `openCount`). Close with the source footer. **ADO Work Items Modified: No.**

If `analysis_backlog_quality` fails, fall back to `ado_query_work_items` presets (`missingDates`, `missingEstimate`, `unassigned`, `stale`) plus `analysis_hierarchy_health` / `analysis_stale_work`, and say which sections used the fallback.

## Analysis Rules

`_shared/analysis-rules.md` and `_shared/query-workflow.md` apply in full.

Search **broadly** but do **not** report trivia. Prioritise delivery, schedule, hierarchy, ownership, dependencies, then governance, stale work, metadata.

False-positive control: if a field is not in the mapping, skip that check. Task-less **New** stories are not automatically faults — the tool already uses state. Uncertain items are `reviewRecommended` (🟡 Review Recommended), not 🔴 Fault.

Do not assume every Epic must have children, every Bug must have a parent, or every field exists. Use discovered types (`facts.workItemTypesDiscovered`).

**Queries.** Title `KaarFlow - <Category>`. Description must say what, why, and the condition. Columns from `defaultColumns` plus the field that caused the fault when it is a real reference name. Prefer `savedQueryUrl`. Never fabricate a URL. On `QUERY_FOLDER_NOT_FOUND` present analysis without links.

**WIQL.** For structural categories the tool supplies an ID IN WIQL of the measured ids. Use it. Do not substitute a looser "all Closed User Stories" filter unless `suggestedWiql` is missing.

## Output Format

Follow `_shared/output-format.md`. Structure:

1. `# 📊 KaarFlow — Backlog Analysis`
2. **Executive Summary** — one sentence with a status indicator and the biggest governance gap (from measured categories).
3. **📌 Backlog Health** — Total Items Analysed, Issues Found (unique items), Critical / High / Medium / Informational **category** counts from `severityCounts`.
4. **🚨 Issues Found** — table: Issue, Description, Count, Severity. No full lists.
5. **🔗 Azure DevOps Queries** — only queries actually created or reused. Title, Description, Count, [🔗 Open Query](real URL).
6. **🔎 Detailed Findings** — important categories: What, Why it matters, Evidence (query or item table if count ≤ 3). Top 3 examples when count > 3.
7. **🧠 CROSS-BACKLOG INSIGHTS** — from `observations` and co-occurrence of measured categories. Percentages only with a measured denominator.
8. **⚠️ RISK ASSESSMENT** — Risk, Severity, Evidence, Impact.
9. **💡 RECOMMENDATIONS** — Action, Why, Evidence link, When. KaarPulse cannot apply them.
10. **🧭 TL DECISION SUPPORT** — Situation, Option A, Option B, KaarFlow Recommendation.
11. **🎯 ACTION PLAN** — Today / This Week / Later.
12. **📊 VISUAL SUMMARY** — bars from real category counts.
13. **⚠️ Analysis Limitations** — from `methodology` (truncated scan, unmapped dates, relation limits).
14. Footer: Source, Project, Team, **ADO Work Items Modified: No**.

## Edge Cases

| Situation | What to do |
| --- | --- |
| Zero issues | Say the analysed set is clean for the checks that ran. Do not call `create_ado_query`. |
| Count <= 3 | List `#id — title` with owner, state, and real work-item URL. Skip saved query unless strategically critical. |
| Count > 3 | Query, not a dump. Optionally three samples then "view all in Azure DevOps". |
| Date/description fields unavailable | "Could not be measured" from mapping / methodology. Never print 0 missing dates. |
| `QUERY_ALREADY_EXISTS` | Reuse URL and count. |
| `QUERY_FOLDER_NOT_FOUND` | Analysis without links. Never retry another folder. Never fabricate a URL. |
| `INVALID_WIQL` | Keep analysis, omit the link, quote the error. |
| Truncated scan | State `scannedLimit` from facts. |
| Team Lead asks to fill dates / assign / close | Refuse the work-item write. Offer the query link and `team-email-assistant` if they want a chase. |
| Azure DevOps unreachable | Failure + `ado_get_connection_status`. |

## Safety Rules

All of `_shared/safety-rules.md` applies.

- Azure DevOps work items are **read-only**. Never patch dates, states, parents, tags or assignments.
- The only Azure DevOps write is `create_ado_query` (saved query metadata under My Queries/KaarFlow).
- Never invent a query URL. Prefer `savedQueryUrl`, then `existingQueryUrl`, then `navigationUrl`.
- Unknown is not zero. Unmapped fields are limitations.
- Recommendations are text. Cleanup happens in Azure DevOps, by a human.
- Do not make employee-performance claims from assignment concentration alone.

## Example Requests

- "Analyse the entire Platform backlog for data quality and governance issues."
- "Find all faults in the current backlog."
- "Perform a deep backlog health analysis."
- "Find backlog issues."
- "Check backlog data quality."
- "Show closed stories without tasks."
- "Which items are missing planned end dates?"
- "Find unassigned active work items."
