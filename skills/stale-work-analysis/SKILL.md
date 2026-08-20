---
name: stale-work-analysis
title: Stale Work Analysis
description: Find active Platform work with no updates for 7, 14 or 30+ days, group by age band, and create an Azure DevOps saved query for each band with more than three items.
version: 2.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_stale_work
supporting_tools:
  - ado_query_work_items
  - ado_get_blocked_items
  - ado_get_work_item
  - ado_query_work_items
missing_capabilities:
  - "Silence in Azure DevOps is not proof that nobody worked — comments elsewhere, meetings and work tracked outside ADO are invisible."
  - "There is no saved-query discovery tool. Reuse happens only via QUERY_ALREADY_EXISTS."
triggers:
  - run stale work analysis
  - check stale work analysis
  - find stale work
  - find stale work items
  - what work is abandoned
  - check stale work
---

# Stale Work Analysis

## Purpose

Surface active work that has not moved. Age bands are 7+, 14+ and 30+ days since `Changed Date`, matching `analysis_stale_work`. Group by band. Create a saved Azure DevOps query when a band has more than three items.

## When to Use

Use when the Team Lead asks what is abandoned, stale, or unchanged for days.

Use `deadline-risk-analysis` if the question is lateness. Use `dependency-analysis` if the question is blocked work (blocked items may be excluded from stale by the tool when waiting/hold/blocked).

## Required Inputs

None. Optional: a minimum age ("only 30 days") — still compute all bands, then emphasise the requested band.

## Data Sources

- `analysis_stale_work` — items with 7 / 14 / 30 day flags and tool severity.
- `ado_query_work_items` with `preset: stale` (14-day default in the query engine) to corroborate. Do not treat the preset as the 7-day band.
- `ado_get_blocked_items` — so blocked/waiting work is not narrated as abandoned without evidence.
- `ado_query_work_items` — queries for bands with count > 3.

## Workflow

1. **Call `analysis_stale_work`.** Split `staleItems` into 7–13 days, 14–29 days, and 30+ days using the issue text / days the tool returned. Do not re-derive days unless the tool omitted them; if you compute days from `changedDate`, say calendar days.
2. **Call `ado_get_blocked_items`** and mark overlap. An item can be stale and blocked; count it in both sections but do not add the counts into a total without deduplicating ids.
3. **Apply count > 3.** Titles: `Platform - Active Work Stale 7+ Days`, `Platform - Active Work Stale 14+ Days`, `Platform - Active Work Stale 30+ Days`. Columns must include Changed Date, Assigned To, State, Priority, Iteration, Planned End when mapped. Reuse existing queries by title.
4. **Build** Category | Count | Oldest Item | Query. Oldest item is the measured maximum age in that band, with `#id`.
5. **Recommend** review vs close vs unblock. No work items are modified.

## Analysis Rules

The analysis tool skips completed/removed items and typically skips waiting/hold/blocked-field items. Pass that through. Do not call a waiting item abandoned.

`ado_query_work_items` preset `stale` is 14 days. If you also need 7 or 30, use `changedBefore` with an ISO date you compute from today, and state the cutoff.

Never judge the assignee. Stale is a signal about the item.

## Output Format

**Output Mode**: The user may request a specific output mode (e.g. `brief`, `verbose`, `visual`). You must adapt your formatting to match the requested mode.


Follow `_shared/output-format.md`.

1. `# 📊 KaarPulse — Stale Work`
2. Executive summary.
3. **📌 At a Glance** — analysed, stale total, 7 / 14 / 30 counts.
4. Table: Category | Count | Oldest Item | Query.
5. **🔎 Azure DevOps Queries**
6. **🧠 Insights** — what silence implies for sprint risk.
7. **💡 Recommendations**, **🎯 Actions** (review 30+ today).
8. Footer: **ADO Work Items Modified: No**.

## Edge Cases

| Situation | What to do |
| --- | --- |
| No stale items | Say so. No queries. |
| Count <= 3 in a band | List the items with last changed date. |
| Preset vs analysis counts differ | Name both tools and cutoffs (14-day preset vs 7/14/30 analysis). |
| Blocked items excluded by analysis | Report them under blocked via `ado_get_blocked_items`, not as stale, and say why. |
| Query folder or WIQL failure | Analysis without fake URLs. |
| Team Lead asks to close stale work | Refuse the write. Offer the query. |

## Safety Rules

All of `_shared/safety-rules.md` applies. Read-only for work items. `ado_query_work_items` only for saved queries. Never fabricate last-changed dates or URLs.

## Example Requests

- "Find stale work items."
- "What work is abandoned?"
- "Show active work with no updates for 14 days."
- "Stale 30+ days — give me an Azure DevOps query."
