---
name: delivery-forecast
title: Delivery Forecast
description: Estimate Platform delivery outlook from remaining work, historical completion, schedule variance, sprint pace, blocked and overdue items — or explain why a forecast cannot be produced. Creates saved queries for forecast-risk groups with more than three items.
version: 2.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_team_delivery_metrics
  - analysis_schedule_variance
supporting_tools:
  - ado_get_sprint_progress
  - analysis_team_productivity
  - analysis_blocked_items
  - ado_get_overdue_items
  - ado_get_field_mapping
  - ado_query_work_items
  - ado_query_work_items
missing_capabilities:
  - "This server exposes no burndown series and no official velocity field. A numeric finish date is only possible when historical completion and estimates both exist; otherwise the forecast is unavailable, not guessed."
  - "There is no saved-query discovery tool. Reuse happens only via QUERY_ALREADY_EXISTS."
triggers:
  - run delivery forecast
  - check delivery forecast
  - show delivery forecast
  - when will we finish
  - when will we deliver
---

# Delivery Forecast

## Purpose

Give the Team Lead an honest delivery outlook. If remaining work, historical completion and date fields support it, state a bounded forecast with the assumptions. If they do not, say why a forecast is unavailable. Either way, group forecast-risk items (blocked, overdue, high variance, missing planned end) and create saved queries when count > 3.

Never invent a completion date, probability or velocity.

## When to Use

Use when the Team Lead asks when the team will deliver, finish the sprint, or wants a forecast.

Use `sprint-health-analysis` for the current snapshot without a projection. Use `schedule-variance-analysis` for planned vs actual on existing dates.

## Required Inputs

None. Optional sprint reference — pass through to `ado_get_sprint_progress`. Default current sprint; if none is current, say so.

## Data Sources

- `analysis_team_delivery_metrics` — completed counts, throughput, measurable cycle time.
- `analysis_team_productivity` — sprint completion trend, carry-over (no score).
- `analysis_schedule_variance` — delay days where dates exist.
- `ado_get_sprint_progress` — remaining items, points, days remaining, completionRate.
- `analysis_blocked_items`, `ado_get_overdue_items` — risk that invalidates a pace assumption.
- `ado_get_field_mapping` — whether planned end exists for remaining work.
- `ado_query_work_items` — risk groups with count > 3.

## Workflow

1. **Call `ado_get_sprint_progress`** (current unless named). Record remaining items, remaining days, points completeness.
2. **Call `analysis_team_delivery_metrics` and `analysis_team_productivity`.** Note how many items were measurable. Fewer than three completed sprints → no trend, no extrapolated finish date.
3. **Call `analysis_schedule_variance`, `analysis_blocked_items`, `ado_get_overdue_items`.** These are forecast-risk inputs, not a second forecast.
4. **Decide forecast availability.** Produce a numeric outlook only when all of these are true and you state them: remaining work counted; days remaining known; at least two completed sprints of history; estimates present on enough remaining items that you can say how many were excluded. If any fail, **explain why the forecast is unavailable** and give the measured position instead (items left, days left, blocked, overdue).
5. **If a forecast is produced**, describe it as an extrapolation of measured throughput, not a commitment. No percentages of "chance to finish".
6. **Risk groups:** overdue remaining work; blocked remaining work; missing planned end on active work; high completion variance. Count > 3 → `ado_query_work_items` (`Platform - Overdue Work`, `Platform - Blocked Work`, `Platform - Missing Planned End Dates`). Reuse titles. Follow `_shared/query-workflow.md`.
7. Close with actions that would make a later forecast possible (complete planned dates, unblock). No work items are modified.

## Analysis Rules

Forbidden unless a tool returned it: "70% chance", "we will finish Friday", a velocity number you computed from a handful of points.

Throughput may be stated as "N items completed in D days" from `analysis_team_delivery_metrics`. Dividing remaining items by that rate is allowed only if you show the arithmetic, the exclusions, and that blocked/overdue work can void the rate.

Missing planned dates reduce forecast reliability — say what share of remaining work lacks them when both numbers exist.

## Output Format

**Output Mode**: The user may request a specific output mode (e.g. `brief`, `verbose`, `visual`). You must adapt your formatting to match the requested mode.


Follow `_shared/output-format.md`.

1. `# 📊 KaarPulse — Delivery Forecast`
2. Executive summary: outlook **or** "forecast unavailable because …".
3. **📌 At a Glance** — remaining work, days remaining, completed in window, blocked, overdue.
4. Forecast section or unavailability reasons (explicit list).
5. **🔎 Azure DevOps Queries** for risk groups with count > 3.
6. **🧠 Insights**, **💡 Recommendations**, **🎯 Actions**.
7. Footer: **ADO Work Items Modified: No**.

## Edge Cases

| Situation | What to do |
| --- | --- |
| No current sprint / no dates | Forecast unavailable. Report why. |
| No historical completions | Unavailable. Need at least two completed sprints with comparable scope. |
| Story points mostly unset | Do not compute point velocity. Item-count pace only if you state the limitation. |
| Heavy blocked/overdue set | Even if arithmetic is possible, qualify the outlook as unreliable and lead with those queries. |
| Count <= 3 in a risk group | List the items. |
| Query failure | Keep the outlook; no fake URLs. |
| Team Lead wants a guaranteed date | Refuse to invent certainty. Offer measured position + risks. |

## Safety Rules

All of `_shared/safety-rules.md` applies. No fabricated forecasts. Work items read-only. `ado_query_work_items` is the only Azure DevOps write. Never invent query URLs.

## Example Requests

- "When will we deliver?"
- "Show delivery forecast."
- "When will we finish this sprint?"
- "Is a finish date even knowable from the data we have?"
