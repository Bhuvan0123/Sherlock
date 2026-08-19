---
name: schedule-variance-analysis
title: Schedule Variance Analysis
description: Compare planned versus actual duration, late starts, late completions and early completions on Platform work. Creates an Azure DevOps saved query for each variance category with more than three items.
version: 2.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_schedule_variance
supporting_tools:
  - ado_get_field_mapping
  - ado_query_work_items
  - ado_get_overdue_items
  - ado_get_work_item
  - create_ado_query
missing_capabilities:
  - "Variance cannot be calculated where planned or actual dates are unset — those items are excluded and counted as excluded, never estimated."
  - "There is no saved-query discovery tool. Reuse happens only via QUERY_ALREADY_EXISTS on a predictable title."
triggers:
  - run schedule variance analysis
  - check schedule variance analysis
  - check schedule variance
  - why are we delayed
  - show late starts
  - work exceeding planned end date
---

# Schedule Variance Analysis

## Purpose

Tell the Team Lead where work is departing from its plan: late start, late completion, early completion, and duration variance. Group the items. When a category has more than three matches, create or reuse a saved Azure DevOps query so the Team Lead can inspect the set in Boards.

Do not invent a forecast here. Use `delivery-forecast` for pace-based outlook.

## When to Use

Use when the Team Lead asks why work is delayed, which items exceeded planned end, late starts, or planned vs actual duration.

Use `deadline-risk-analysis` for overdue / due-soon risk ratings. Use `backlog-data-quality` when the problem is missing dates rather than variance on dates that exist.

## Required Inputs

None. Optional focus ("only late completions") still measures all categories, then emphasises the requested one.

## Data Sources

- `ado_get_field_mapping` — real planned/actual field names. Required before WIQL.
- `analysis_schedule_variance` — per-item start and completion variance days where dates exist.
- `ado_query_work_items` — overdue / date-bounded corroboration. Reuse fetched items.
- `ado_get_overdue_items` — open work past due/target.
- `create_ado_query` — saved queries for categories with count > 3.

## Workflow

1. **Call `ado_get_field_mapping`.** If planned or actual fields are unavailable, say variance cannot be measured and stop the numeric analysis. Missing mapping is not "0 variance".
2. **Call `analysis_schedule_variance`.** Keep items with null variance in an "excluded — dates missing" count.
3. **Group** into late start, late completion / exceeding planned end, early completion, high variance (use the tool's days; do not invent a threshold — if you apply one, state it, e.g. completion delay > 7 calendar days).
4. **Count each group.** Apply `_shared/query-workflow.md`: count > 3 → `create_ado_query`; count <= 3 → list items.
5. **Query titles** such as `Platform - Work Exceeding Planned End Date`, `Platform - Late Starts`, `Platform - High Schedule Variance`. Include planned and actual date columns from the mapping. Reuse on `QUERY_ALREADY_EXISTS`.
6. **Build the category table** with Count, Avg Variance (only from items that had numeric variance — never average in nulls), and Query link.
7. **Explain implications** for the current sprint and downstream work. Recommend date hygiene vs scope cuts as options. No work items are modified.

## Analysis Rules

Planned duration and actual duration come from the tool. Late start means actual start after planned start, both set. Late completion means actual or remaining work past planned end.

Average variance is the mean of measured `completionVarianceDays` or `startVarianceDays` in that category only. State n used for the average.

Do not rank people. Variance is about the item.

## Output Format

Follow `_shared/output-format.md`.

1. `# 📊 KaarPulse — Schedule Variance`
2. Executive summary.
3. **📌 At a Glance** — analysed, with variance data, excluded (missing dates).
4. Category table: Category | Count | Avg Variance | Query.
5. Visual planned vs actual bars **only** if the tool returned comparable planned/actual aggregates; otherwise omit.
6. **🔎 Azure DevOps Queries**
7. **🧠 Insights** — what the variance means for delivery confidence.
8. **⚠️ Risks**, **💡 Recommendations**, **🧭 TL Decision Support**, **🎯 Actions**.
9. Footer: **ADO Work Items Modified: No**.

## Edge Cases

| Situation | What to do |
| --- | --- |
| No date fields mapped | Lead with that. Do not print 0 late items. Point at `backlog-data-quality`. |
| All items excluded | Report how many lacked dates. No queries. |
| Count <= 3 | List items with their variance days from the tool. |
| Only planned dates, no actuals | Duration variance is unavailable; late-vs-plan for open work may still use `@Today` vs planned end via `ado_get_overdue_items`. Say which signal you used. |
| Query creation fails | Keep the table, omit fake links. |
| Team Lead asks to change dates | Refuse. Offer the query link. |

## Safety Rules

All of `_shared/safety-rules.md` applies. Work items are read-only. `create_ado_query` is the only Azure DevOps write. Never invent variance days or query URLs.

## Example Requests

- "Check schedule variance."
- "Why are we delayed?"
- "Which work exceeded its planned end date?"
- "Show late starts."
- "High schedule variance items — give me an Azure DevOps query."
