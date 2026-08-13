---
name: project-health-analysis
title: Project Health Analysis
description: Assess the overall health of the K4K project across delivery, backlog, resourcing, risk and sprint dimensions, using the server's measured health ratings plus backlog composition, hierarchy sampling, blocked work and dependency data from live Azure DevOps.
version: 1.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_project_health
  - analysis_project
supporting_tools:
  - ado_get_project_overview
  - ado_get_backlogs
  - ado_get_work_item_types
  - analysis_team_workload
  - analysis_deadlines
  - analysis_blocked_items
  - analysis_dependencies
  - analysis_cross_team_dependencies
  - ado_get_sprint_progress
  - ado_get_work_items_by_type
  - ado_get_work_item_hierarchy
  - ado_get_parent_work_item
missing_capabilities:
  - "Azure DevOps exposes no budget, cost or resource-plan data, so financial health cannot be assessed."
  - "There is no project-level quality signal here - build results, test results, code coverage and pull requests are outside this server's read scope."
  - "Hierarchy quality has no aggregate query, so orphaned and parentless work can only be sampled item by item, never counted across the whole backlog."
  - "There is no recorded project baseline or original plan, so scope growth against a plan cannot be measured, only carry-over and mid-sprint additions."
triggers:
  - how healthy is the project
  - project health check
  - give me a project health score
  - how is k4k doing overall
  - what is the state of the project
  - project status overview
  - where are the biggest risks in the project
  - is the project on track
---

# Project Health Analysis

## Purpose

Give the Team Lead a whole-project view of K4K — how delivery is going, what the backlog looks like, how work is spread, where the risk sits, and how the current sprint is faring — with a named rating for each dimension and the reasoning behind it.

The server already rates project health across its own dimensions. This skill presents those ratings in the five dimensions the Team Lead uses, adds the backlog and hierarchy detail the health tool does not cover, and keeps every rating attached to the reasons that produced it.

## When to Use

Use this skill when the question is about the project as a whole rather than one sprint, one person or one deadline. Typical phrasings are in the `triggers` list above. Use a different skill when:

- the question is about the current sprint's trajectory → `sprint-health-analysis`
- the question is about who holds the work → `workload-analysis`
- the question is about what is late or slipping → `deadline-risk-analysis`
- the question is about today specifically → `team-morning-brief`
- the Team Lead wants a document to keep or forward → `daily-team-report`

## Required Inputs

None. The organization, project and team are fixed by server configuration and must not be passed.

Optional, if the Team Lead supplies them:

| Input | Effect |
| --- | --- |
| A dimension focus ("just the backlog health") | Run the full analysis for consistency, then print the requested dimension in full and the others as one line each. |
| A depth request ("the deep version") | Use `analysis_project`, which adds current-sprint detail including carry-over and 30-day delivery metrics on top of health. |
| A hierarchy question ("how many orphans do we have") | Say up front that hierarchy quality can only be sampled, follow the sampling procedure in the Workflow, and report the sample size. |
| A scope beyond the team | Most work-item tools are scoped to the team's area paths. Where a tool exposes `team_scoped`, widen it only if the Team Lead asked for a project-wide view, and label which scope produced the numbers. |

## Data Sources

All data comes from KaarPulse MCP tools. There are no other sources.

**Primary:**

- `analysis_project_health` — rates delivery, schedule, workload, blocked work, sprint health, dependency risk and assignment coverage. `facts.health.overall` carries the overall rating and `facts.health.dimensions` carries each dimension with a `rating` of `Good`, `Moderate Risk`, `At Risk`, `High Risk` or `Unknown` plus `reasons[]`.
- `analysis_project` — the deepest single view: the same health assessment plus current-sprint detail including carry-over, plus 30-day delivery metrics. Prefer it when the Team Lead wants depth rather than a summary.

**Supporting:**

| Need | Tool |
| --- | --- |
| Member count, current sprint, counts by type and state category, unassigned, overdue, blocked and high-priority open counts | `ado_get_project_overview` |
| Backlog levels and the types at each level | `ado_get_backlogs` |
| Real type and state names, and their state categories | `ado_get_work_item_types` |
| Per-member counts, effort, capacity and distribution statistics | `analysis_team_workload` |
| Overdue, due-today, due-this-week and no-due-date counts | `analysis_deadlines` |
| Blocked work with evidence and days unchanged | `analysis_blocked_items` |
| Predecessor and successor links across open work, with unresolved ones marked, and those pointing outside the team's area paths | `analysis_dependencies`, `analysis_cross_team_dependencies` |
| Sprint counts, points, capacity, carry-over | `ado_get_sprint_progress` |
| A sample of items of one type, and the descendant tree for an epic or feature | `ado_get_work_items_by_type`, `ado_get_work_item_hierarchy` |
| Whether one item has a parent | `ado_get_parent_work_item` |

## Workflow

1. **Call `analysis_project_health`.** This is the spine of the report. Record `facts.health.overall` and every entry in `facts.health.dimensions` with its `rating` and `reasons[]`, and read `methodology` for the thresholds behind them.
2. **Call `analysis_project`** when the Team Lead asked for depth or when the sprint and delivery detail is needed. Do not reconstruct either from primitives while the composite call is succeeding.
3. **Call `ado_get_project_overview`** for the counts that drive backlog composition — items by type and by state category, and the open unassigned, overdue, blocked and high-priority counts.
4. **Call `ado_get_work_item_types` before interpreting any state.** K4K may use custom state names; reason about done-versus-in-flight from `stateCategory` and display the literal `state`.
5. **Call `ado_get_backlogs`** to learn the backlog levels in use and which types sit at each, so backlog composition is described in this project's own terms.
6. **Call `analysis_team_workload`** for resourcing, `analysis_deadlines` for the overdue percentage denominators, and `analysis_blocked_items` for blocked work with evidence and staleness flags.
7. **Call `analysis_dependencies` and `analysis_cross_team_dependencies`** for dependency risk, and note the coverage each reports — the defaults scan 400 and a bounded set respectively.
8. **Call `ado_get_sprint_progress`** (default `"current"`) for sprint health, including committed versus completed points, remaining hours and evidence-based carry-over.
9. **Sample hierarchy quality.** There is no aggregate orphan query, so sample deliberately and say so. Call `ado_get_work_items_by_type` for the lowest backlog level identified in step 5 with `limit: 25` and `include_completed: false`, then call `ado_get_parent_work_item` for each returned item. Then call `ado_get_work_item_hierarchy` on up to five Epics or Features, again from `ado_get_work_items_by_type`, to spot levels with no children. Report the result strictly as "n of the N sampled items had no parent", never as a backlog-wide percentage.
10. **Map the server's dimension ratings** onto the five named dimensions using the mapping below, and derive the overall from `facts.health.overall`. State once that the mapping is this skill's presentation of the server's ratings.
11. **Attach reasoning to every score** from the tool's `reasons[]`, adding the measured counts behind each. A dimension printed without reasons is a defect.
12. **Assemble the report** in the order given in Output Format, then close with the read-only statement.

If `analysis_project_health` fails, build what you can from `ado_get_project_overview`, `analysis_team_workload`, `analysis_deadlines` and `analysis_blocked_items`, report the measured counts without ratings, and say the health ratings are unavailable rather than inventing them.

## Analysis Rules

`_shared/analysis-rules.md` applies in full. Three rules bite hardest here.

**Dimension mapping.** The server rates seven dimensions. The Team Lead reads five. The mapping is fixed, and each named dimension states which server dimensions fed it:

| Named dimension | Fed by |
| --- | --- |
| Delivery Health | the server's delivery dimension, with the 30-day delivery metrics from `analysis_project` where available |
| Backlog Health | the server's assignment-coverage dimension, plus backlog composition from `ado_get_project_overview` and `ado_get_backlogs`, plus the hierarchy sample |
| Resource Health | the server's workload dimension, plus `analysis_team_workload` distribution statistics |
| Risk Health | the worst of the server's blocked-work, dependency-risk and schedule dimensions, naming which one set it |
| Sprint Health | the server's sprint-health dimension, plus `ado_get_sprint_progress` |

Where a named dimension draws on more than one server dimension, take the worst constituent rating and say which one drove it. Where a constituent is `Unknown`, say so rather than dropping it silently.

**Rating and overall mapping.** The server's per-dimension vocabulary maps to the report as `Good` → Healthy, `Moderate Risk` → Needs Attention, `At Risk` → At Risk, `High Risk` → Critical, `Unknown` → Unknown. The overall follows `facts.health.overall` through the same mapping and is never computed independently or averaged. If the overall is `Unknown`, print Unknown and explain what was missing. This mapping is a skill-level presentation of the server's ratings, not a second assessment, and the output must say so once.

**Sampling honesty.** Hierarchy quality and stale work are sampled, not counted. Always give the numerator and the denominator of the sample, name how the sample was chosen, and never extrapolate it to the whole backlog. If the Team Lead needs a true count, say it requires a query in Azure DevOps that this server does not expose.

**Percentages need both numbers.** Overdue percentage, active-to-completed ratio and type distribution are only printed with numerator and denominator — "18 of 142 open items are overdue (13%)". Exclude items with no due date from the overdue denominator and say how many were excluded.

## Output Format

Follow the KaarPulse Dashboard UI schema defined in `_shared/output-format.md`.
Use the templates from `_shared/templates/` to construct the response.

**Specific structure for Project Health Analysis:**
1. **Header**: `# 📊 K4K Platform — Project Health`
2. **Executive Summary**: State the `Overall Health` clearly (e.g., `# 🟠 AT RISK`). Add 1-2 sentences explaining why.
3. **📌 At a Glance (Health Dimensions)**:
   | Dimension | Status | Evidence/Why |
   |---|---|---|
   | Delivery Health | <indicator> | <short reason> |
   | Backlog Health | <indicator> | <short reason> |
   | Resource Health | <indicator> | <short reason> |
   | Risk Health | <indicator> | <short reason> |
   | Sprint Health | <indicator> | <short reason> |
   *(Use indicator emojis for status, e.g., 🟢, 🟡, 🟠, 🔴).*
4. **🚨 Top 5 Risks / Key Findings**: Extract the most critical issues from the reasoning, backlog anomalies, or dependency blocks.
5. **🧠 AI Analysis (Reasoning)**: Detail the reasoning behind the worst dimensions.
6. **💡 Recommendations & 🧭 TL Decision Support**: Address the biggest risks found.
7. **🎯 Recommended Actions**: Actionable next steps.
8. **📋 Detailed Data**:
   - Backlog Metrics (Open vs Completed, overdue percentage)
   - Dependency Risks (circular loops, blocking dependencies)
9. **⚠️ Data Quality**: Note if hierarchy sampling was used or if metrics (like points) were missing.

Ensure you state: "No Azure DevOps changes were made. KaarPulse is read-only for Azure DevOps."

## Edge Cases

| Situation | What to do |
| --- | --- |
| A server dimension returns `Unknown` | Print Unknown for the named dimension it feeds, quote what the tool said was missing, and never substitute a neighbouring dimension's rating. |
| `facts.health.overall` is `Unknown` | Print Unknown as the overall, list the dimensions that were rated, and say what prevented an overall rating. Do not average the dimensions yourself. |
| No current sprint (`currentSprint: null`) | Sprint Health becomes Unknown with the reason stated. The other four dimensions still stand. Suggest checking iteration dates in Azure DevOps. |
| The process defines no due-date field | Overdue percentage cannot be measured at all. Say so, remove it from Backlog Health reasoning, and state that Risk Health lost its schedule input. |
| Story points unset across the backlog | Report delivery in item counts, say points-based measures are unavailable, and never estimate points. |
| Hierarchy sample comes back all parentless | Report it as a sample finding with the numbers, note that the lowest backlog level may legitimately have no parent in this process, and recommend a check in Azure DevOps rather than declaring the backlog broken. |
| Dependency scan hit its `limit` | `analysis_dependencies` defaults to 400 and `analysis_blocked_items` to 300. Say the scan was bounded, give the coverage, and qualify the Risk Health reasoning accordingly. |
| Cross-team dependencies exist | Report them separately from internal ones. They are outside the Platform team's control and the recommendation must reflect that. |
| The project has almost no work items | Say the sample is too small for meaningful ratings, print the counts, and avoid a confident overall. |
| Custom state names | Reason about done-versus-in-flight from `stateCategory`, display the literal `state`, and call `ado_get_work_item_types` before any state filter. |
| `analysis_project` times out or fails | Fall back to `analysis_project_health` plus the supporting primitives, and name the sections that came from the fallback path. |
| The Team Lead asks you to fix something the report found | Refuse the change, state that KaarPulse is read-only for Azure DevOps, and offer the recommendation or an email draft via `team-email-assistant`. |
| Azure DevOps unreachable or PAT invalid | Report that the analysis could not be produced and suggest `ado_get_connection_status`. Never guess a rating. |

## Safety Rules

All of `_shared/safety-rules.md` applies. The points that bite most often here:

- **Read-only.** A health report invites action. None of it happens here; every run ends with the read-only statement.
- **Ratings are the server's, presentation is this skill's.** Never present the five-dimension view as though Azure DevOps produced those names, and never present a mapped rating as a fresh measurement.
- **Sampled is not counted.** Hierarchy and staleness findings always carry their sample size; extrapolating a sample to the backlog would be fabrication. Counts, ratings, reasons and dates all come from tool calls made in this run, and unknown is not zero.
- **No performance judgements.** Resource Health describes distribution of work, never the capability of the people holding it. Assume the report could be forwarded to the whole team.

## Example Requests

- "How healthy is the project?"
- "Give me a project health score for K4K."
- "What is the state of the project overall?"
- "Where are the biggest risks in the project right now?"
- "How many items have no parent?" → this skill, answered as a sample with its size stated.
- "Is the project on track, and what should I do about the worst dimension?" → this skill; the actions are recommendations only.
- "Health check, then show me the sprint in detail." → this skill, then `sprint-health-analysis`.
