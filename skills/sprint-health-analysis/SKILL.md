---
name: sprint-health-analysis
title: Sprint Health Analysis
description: Analyse a chosen or the current sprint for the Platform team - dates, days elapsed and remaining, planned against completed work, remaining effort, completion percentage, overdue and blocked items, workload signals and evidence-based carry-over from live Azure DevOps.
version: 1.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - ado_get_sprint_progress
  - analysis_project
supporting_tools:
  - ado_get_current_sprint
  - ado_get_team_iterations
  - ado_get_upcoming_sprints
  - ado_get_work_items_by_sprint
  - analysis_team_workload
  - analysis_deadline_risk
  - analysis_blocked_items
  - analysis_team_productivity
  - ado_get_work_item
missing_capabilities:
  - "Azure DevOps exposes no burndown series through this server, so a daily burndown curve cannot be drawn - only the current snapshot."
  - "Scope change is only visible as evidence-based carry-over and mid-sprint additions; items removed from the sprint or silently rescoped cannot be detected."
  - "There is no leave or availability calendar, so configured capacity cannot be adjusted for who is actually present."
  - "No sprint goal or commitment record is available, so progress cannot be judged against a stated goal."
triggers:
  - how is the sprint going
  - sprint health
  - sprint status
  - are we going to finish the sprint
  - how much is left in this sprint
  - show me sprint progress
  - sprint health for the next sprint
  - what is at risk in this sprint
---

# Sprint Health Analysis

## Purpose

Tell the Team Lead how the selected sprint is actually going: how much time is left, how much work is planned, done and in flight, what remains, what is overdue or blocked inside it, and how the load is spread across the team. Everything is measured from live Azure DevOps data for one named iteration.

The skill deliberately stops short of forecasting. Where the data to support a projection does not exist, it says so and names what would be needed, rather than producing a number that looks authoritative and is not.

## When to Use

Use this skill when the question is about one sprint. Typical phrasings are in the `triggers` list above.

Use a different skill when:

- the question is about the project rather than the iteration → `project-health-analysis`
- the question is about who holds the work → `workload-analysis`
- the question is about deadlines regardless of sprint → `deadline-risk-analysis`
- the question is about today → `team-morning-brief`
- the Team Lead wants owners suggested for unassigned sprint work → `work-assignment-recommendation`

## Required Inputs

None strictly. The organization, project and team are fixed by server configuration and must not be passed.

Optional, and frequently supplied:

| Input | Effect |
| --- | --- |
| A sprint reference | `ado_get_sprint_progress` and `ado_get_work_items_by_sprint` accept `"current"` (the default), `"next"`, `"previous"`, or an iteration name, path or id. Always state which sprint the reference resolved to. Never assume a sprint name. |
| Carry-over interest ("what came over from last sprint") | Pass `include_carry_over: true` to `ado_get_sprint_progress`. Carry-over is evidence-based, detected from revision history where an item's iteration was changed *into* this sprint. |
| A history depth ("compare the last five sprints") | Pass `sprint_count` to `analysis_team_productivity`. The default is 3. Report the measured per-sprint completion, not a projection. |
| A focus ("just the risks") | Run the full analysis, then print `SPRINT SUMMARY` and the requested section. |

## Data Sources

All data comes from KaarPulse MCP tools. There are no other sources.

**Primary:**

- `ado_get_sprint_progress` (`sprint`, `include_carry_over`) — the measured core: item counts by state category, blocked, unassigned and overdue counts, story points committed against completed, remaining hours, per-member capacity, `completionRate`, and evidence-based carry-over.
- `analysis_project` — the deepest view, combining project health with current-sprint detail including carry-over and 30-day delivery metrics. Use it when the sprint question is really "how are we doing", and when the current sprint is the subject.

**Supporting:**

| Need | Tool |
| --- | --- |
| Whether an iteration is marked current, and its dates | `ado_get_current_sprint` |
| All iterations with start and finish dates, `timeFrame`, days elapsed and remaining | `ado_get_team_iterations` |
| What is coming next | `ado_get_upcoming_sprints` (default limit 3) |
| Every item in the sprint, including completed ones | `ado_get_work_items_by_sprint` |
| Per-member counts, effort, capacity and distribution | `analysis_team_workload` |
| Risk ratings and reasons for dated sprint work | `analysis_deadline_risk` |
| Blocked work with `blockedSignals` evidence and days unchanged | `analysis_blocked_items` |
| Sprint completion trend, carry-over and mid-sprint additions across recent sprints | `analysis_team_productivity` |
| Full detail on one item | `ado_get_work_item` |

## Workflow

1. **Resolve the sprint.** If the Team Lead named one, pass it through as given. Otherwise call `ado_get_current_sprint`. If it returns `currentSprint: null`, no iteration is marked current — say so, offer `ado_get_team_iterations` or `ado_get_upcoming_sprints` to pick one, and do not silently substitute another sprint.
2. **Call `ado_get_sprint_progress`** with the resolved reference and `include_carry_over: true`. This supplies the counts, points, remaining hours, per-member capacity, `completionRate` and carry-over that the rest of the report is built on.
3. **Confirm the dates.** Take start, finish, days elapsed and days remaining from `ado_get_team_iterations` for the resolved iteration. If start or finish is unset, days elapsed and remaining cannot be computed at all; say so and drop every time-based statement.
4. **Call `analysis_project`** when the subject is the current sprint and the Team Lead wants depth. It carries the sprint detail and 30-day delivery metrics in one internally consistent envelope.
5. **Call `ado_get_work_items_by_sprint`** for the item-level list when the report needs named items rather than counts, remembering that it includes completed items. Deduplicate by id and use `stateCategory` to separate done from in flight.
6. **Call `analysis_blocked_items`** and keep, per blocked item, the evidence and the days unchanged; the tool flags items unchanged for five or more days. Restrict the reported set to items in the resolved sprint and say you did.
7. **Call `analysis_deadline_risk`** for the dated items and carry its `Low Risk`, `Medium Risk` and `High Risk` ratings with `riskReasons[]` into the `RISKS` section. Do not invent your own severities.
8. **Call `analysis_team_workload`** for capacity signals — per-member open, active, blocked, overdue and high-priority counts, remaining hours, story points and configured sprint capacity — and compare only where both sides are set.
9. **Call `analysis_team_productivity`** when history is wanted. It returns the sprint completion trend, carry-over and mid-sprint additions across recent sprints as measured values, and deliberately produces no single productivity score.
10. **Compute only what the data supports.** Completion percentage from the counts the tool returned, remaining effort only where remaining hours or points are set, carry-over only from the evidence-based figure. Say which items were excluded from any effort figure and how many.
11. **Assemble the five sections** in the order given in Output Format, then close with the read-only statement.

If `ado_get_sprint_progress` fails, fall back to `ado_get_work_items_by_sprint` plus `ado_get_team_iterations` for the counts and dates, and say the points, capacity and carry-over figures are unavailable.

## Analysis Rules

`_shared/analysis-rules.md` applies in full. Three rules bite hardest here.

**Do not fabricate velocity.** If historical sprint data is unavailable, say so explicitly and say what would be needed. The permitted position is: report the measured per-sprint completion figures from `analysis_team_productivity` where at least two completed sprints exist, describe them as history, and stop. Never project a completion date, never extrapolate a burn rate from days elapsed, and never state that the sprint "will" or "will not" finish. If asked directly whether the sprint will land, answer with the measured position — items remaining, effort remaining where set, days left — and say that a forecast would require a consistent velocity history and complete estimates, which this project may not have.

**Completion is stated with both numbers.** Print "9 of 14 items complete (64%)" and use the tool's `completionRate` where it returned one. Points completion is reported separately from item completion, and only when points are set; where some items lack points, say how many were excluded.

**Scope change means carry-over and mid-sprint additions, and nothing else.** Carry-over comes from revision history where an item's iteration was changed into this sprint, and mid-sprint additions come from `analysis_team_productivity`. Items removed from the sprint, or rescoped in place, cannot be detected. Treat every other form of scope change as unavailable and say so rather than implying the sprint was stable.

**Capacity signals are signals.** Configured sprint capacity is a number a human entered on the iteration; it does not know about leave, meetings or support duty. Compare remaining hours against capacity only where both are set, present the result as a signal, and never conclude that a member is overcommitted from item counts alone.

## Output Format

Follow the KaarPulse Dashboard UI schema defined in `_shared/output-format.md`.
Use the templates from `_shared/templates/` to construct the response.

**Specific structure for Sprint Health Analysis:**
1. **Header**: `# 📊 KaarPulse — Sprint Health Analysis`
2. **Sprint Info & Executive Summary**: Mention the Sprint name, dates, and days elapsed/remaining. Follow with a 1-2 sentence assessment of sprint completion risk.
3. **🏃 Sprint Health (KPIs & Visuals)**:
   - Provide a visual progress bar (e.g. `██████████████░░░░░░` 70%).
   - KPI Table showing Total, Completed, Active, Blocked, Overdue.
4. **🚨 Risks & 🔎 Key Findings**: Detail blocked items, overdue items, or carry-over issues.
5. **🧠 AI Analysis**: Interpretation of velocity (if historical data exists), or reasons why it isn't calculated. Address any team capacity signals.
6. **💡 AI Recommendations & 🎯 Recommended Actions**: Next steps for the TL to save the sprint or unblock items.
7. **📋 Detailed Data**: The `TEAM CAPACITY SIGNALS` table.

Ensure you state: "No Azure DevOps changes were made. KaarPulse is read-only for Azure DevOps."

## Edge Cases

| Situation | What to do |
| --- | --- |
| No current sprint (`currentSprint: null`) | Lead with it. Say no iteration is marked current for this team, list the nearest iterations from `ado_get_team_iterations` or `ado_get_upcoming_sprints`, and ask which one to analyse. Do not pick one silently. |
| Iteration dates not set | Days elapsed, days remaining and any time-based statement cannot be computed at all. Say so prominently, report the counts and effort that survive, and suggest setting the dates in Azure DevOps. |
| The named sprint does not resolve | Say the reference did not match an iteration, list the candidates from `ado_get_team_iterations`, and stop rather than analysing the wrong sprint. |
| Sprint has no work items | Report the empty sprint plainly. That is a finding, not an error, and it usually means planning has not happened yet. |
| Story points unset on some or all items | Report item completion only, say how many items lack points, and never estimate. Points completion is omitted entirely when no item carries points. |
| No historical sprints | Say the completion trend and any velocity figure are unavailable, name that at least two completed sprints with consistent estimates would be needed, and give the current position instead. |
| Capacity not configured on the iteration | Print `unknown` in the capacity column, drop the remaining-hours-against-capacity comparison, and say the comparison was unavailable. |
| The process defines no due-date field | Overdue inside the sprint cannot be measured at all. Say so, and keep the blocked, unassigned and priority signals in the risks section. |
| Carry-over is high | Report the evidence-based count and which items came over. Do not claim the previous sprint failed; carry-over has many causes and the data does not distinguish them. |
| Mid-sprint additions appear | Report them from `analysis_team_productivity` as measured additions, and note that removals cannot be detected, so this is not a full scope-change picture. |
| The sprint is already over (`timeFrame` past) | Say the sprint has ended and report it as a retrospective snapshot, not as progress. Completion figures are final, not in flight. |
| A list hit its `limit` | Say the list was truncated and give the limit beside the count. |
| The Team Lead asks to move an item out of the sprint | Refuse the change, state that KaarPulse is read-only for Azure DevOps, and offer the recommendation or an email draft via `team-email-assistant`. |
| Azure DevOps unreachable or PAT invalid | Report that the analysis could not be produced and suggest `ado_get_connection_status`. Never estimate progress. |

## Safety Rules

All of `_shared/safety-rules.md` applies. The points that bite most often here:

- **Read-only.** Sprint scope, dates, states and assignments cannot be changed here. Every run ends with the read-only statement.
- **No fabricated forecast.** Velocity, burndown projections and completion dates are forbidden unless a tool actually returned them, and none of these tools does. Saying "not calculated" with the reason is the correct answer.
- **Unknown is not zero.** Unset points, unset capacity, unset iteration dates and a missing due-date field are each reported as what they are.
- **No performance judgements.** Low completion is a fact about the sprint, not about the team. Offer the innocent explanations — large items, blocked dependencies, mid-sprint additions, absence.
- **No email as a side effect.** If the sprint position needs communicating, hand over to `team-email-assistant`, where sending requires explicit confirmation.

## Example Requests

- "How is the sprint going?"
- "Sprint health, please."
- "How much work is left in this sprint?"
- "Show me sprint health for the next sprint."
- "What came over from the previous sprint?"
- "Are we going to finish everything this sprint?" → answered with the measured position; a forecast is refused with the reason.
- "Sprint health, then who is overloaded inside it?" → this skill, then `workload-analysis`.
- "Sprint status and draft a summary for the team." → this skill, then `team-email-assistant` (draft only; sending needs explicit confirmation).
