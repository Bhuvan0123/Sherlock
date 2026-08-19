---
name: workload-analysis
title: Workload Analysis
description: Measure how work is distributed across the Platform team and classify each member's load as Under-utilised, Balanced, High, Overloaded or Unknown, using live Azure DevOps item counts, effort, overdue and blocked work, priority and sprint capacity.
version: 2.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_work_distribution
  - analysis_team_workload
supporting_tools:
  - analysis_member_workload
  - analysis_available_team_members
  - ado_get_sprint_progress
  - ado_get_overdue_items
  - ado_get_blocked_items
  - ado_get_team_members
  - analysis_member_work
  - analysis_schedule_variance
  - ado_get_unassigned_items
  - ado_get_high_priority_items
  - ado_query_work_items
  - ado_get_field_mapping
  - create_ado_query
missing_capabilities:
  - "Azure DevOps holds no leave, holiday or part-time allocation data, so a light load cannot be distinguished from an absence."
  - "There is no record of work done outside Azure DevOps - support rotas, meetings, interviews and incident duty are invisible to every workload number here."
  - "Sprint capacity is only known where a human configured it on the iteration; where it is unset, load cannot be compared against available hours."
  - "There is no saved-query discovery tool. Equivalent queries are reused only when create_ado_query returns QUERY_ALREADY_EXISTS for the same predictable title."
triggers:
  - who is overloaded
  - show me team workload
  - how is work distributed across the team
  - is anyone overloaded right now
  - who has capacity
  - workload analysis for the platform team
  - is the work balanced
  - who has too much on
---

# Workload Analysis

## Purpose

Show the Team Lead how work is actually spread across the Platform team, and mark where the spread looks unsustainable. The analysis is built from live Azure DevOps data only, and every classification is printed with the factors that produced it.

This describes the *work*, not the *worker*. A member holding many items may be carrying small tasks; a member holding two may own the hardest work in the sprint. The output must never read as a performance comparison, and must never be usable as one.

## When to Use

Use this skill when the question is about distribution of work or about a person's load. Typical phrasings are in the `triggers` list above.

Use a different skill when:

- the question is about what is late or slipping → `deadline-risk-analysis`
- the question is about the sprint's trajectory rather than who holds the work → `sprint-health-analysis`
- the question is about the project as a whole → `project-health-analysis`
- the Team Lead wants to know who should take a specific item → `work-assignment-recommendation`
- the Team Lead wants the whole morning picture → `team-morning-brief`

A frequent combined request is "who is overloaded, and who should take the unassigned work". Run this skill first, then hand over to `work-assignment-recommendation`.

## Required Inputs

None. The organization, project and team are fixed by server configuration and must not be passed.

Optional, if the Team Lead supplies them:

| Input | Effect |
| --- | --- |
| A member name or email ("how loaded is Priya") | Run the team analysis for context, then `analysis_member_workload` for the named person. The member argument is fuzzy-resolved against real team membership; if it resolves to nobody, say so and list the roster. |
| A sprint reference | `ado_get_sprint_progress` accepts `"current"` (default), `"next"`, `"previous"` or an iteration name. The workload tools themselves are not sprint-scoped, so state which numbers are sprint-scoped and which are all open work. |
| A focus ("just tell me who is over") | Print the table plus `OVERLOAD RISKS` only, and keep the factor lines. |

## Data Sources

All data comes from KaarPulse MCP tools. There are no other sources.

**Primary:**

- `analysis_work_distribution` — per-member workload plus an interpretation of evenness. It flags imbalance when the busiest member holds at least twice the team median *and* at least four more items than the lightest member. Quote that threshold whenever you rely on it.
- `analysis_team_workload` — the measured base. Per member: open, active, proposed, blocked, overdue, due-this-week and high-priority counts, remaining hours, story points, configured sprint capacity; plus the unassigned bucket and distribution statistics. This tool returns facts directly, not the standard envelope.

**Supporting:**

| Need | Tool |
| --- | --- |
| Spare capacity ranking and the load factors behind it | `analysis_available_team_members` |
| One member in depth, with the actual item lists | `analysis_member_workload` |
| One member's active, completed, overdue, blocked and carry-over work | `analysis_member_work` |
| Sprint days remaining, per-member capacity, remaining hours | `ado_get_sprint_progress` |
| Overdue items to attribute to owners | `ado_get_overdue_items` |
| Blocked items with `blockedSignals` evidence | `ado_get_blocked_items` |
| The roster, including members with no assigned work | `ado_get_team_members` |

## Workflow

1. **Call `analysis_team_workload`.** This is the measured base for every number in the output. Record, per member, the open, active, blocked, overdue, due-this-week and high-priority counts, remaining hours, story points and configured capacity, plus the distribution statistics and the unassigned bucket.
2. **Call `analysis_work_distribution`.** Take its evenness interpretation and its imbalance flag. Keep its `facts` apart from its `observations`, `concerns` and `recommendations`, and read `methodology` for the thresholds you will quote.
3. **Call `ado_get_sprint_progress`** (default `"current"`). Take days remaining and per-member sprint capacity. Remaining hours mean little without the time left to burn them in.
4. **Call `ado_get_team_members`.** Reconcile against the workload rows so members with nothing assigned still appear. Absence from the workload data is not absence from the team.
5. **Call `ado_get_overdue_items` and `ado_get_blocked_items`** to attach concrete ids to the counts. Carry the `blockedSignals` evidence through; deduplicate by id, since an item can be both overdue and blocked.
6. **Classify each member** using the rules below. Evaluate the classes in order and take the first match. Record the factors that fired — they are printed, not summarised away.
7. **Call `analysis_available_team_members`** when at least one member is classified `High` or `Overloaded`, so the balancing options name people with measured spare capacity rather than guesses.
8. **Drill in where it matters.** For each `Overloaded` member, call `analysis_member_workload` to obtain the actual active, blocked, overdue and high-priority item lists, so the overload section names items rather than only counts.
9. **Build the output** in the order given in Output Format. Every row carries its factors; every risk carries its ids.
10. **Group team-level categories** — overloaded members' active work (one query for the overloaded set, not one query per person), overdue work, unassigned work, high-priority active work, work with measured schedule variance. Follow `_shared/query-workflow.md`: count > 3 → `create_ado_query`; count <= 3 → list items. Titles such as `Platform - Overdue Work`, `Platform - Unassigned Work`, `Platform - High Priority Active Work`. Do not create a per-member query unless the Team Lead named that member.
11. **Close with the source footer.** Nothing in this analysis assigns, moves or changes work items. Saved queries are listed with real URLs.

If `analysis_work_distribution` fails, continue from `analysis_team_workload` alone, apply the classification rules yourself, and say that the evenness interpretation is missing.

## Analysis Rules

`_shared/analysis-rules.md` applies in full. Three rules bite hardest here.

**Never classify from item count alone.** This is the central rule of this skill. A classification requires at least two independent signals from the list below. Where the only available signal is the active item count, the highest class you may assign is `High`, and only when the count crosses the server's documented imbalance threshold; `Overloaded` on counts alone is forbidden, and `Under-utilised` on counts alone must be reported as `Unknown`.

The signals are: active count against the team median; remaining hours or story points against configured sprint capacity and days remaining; overdue count; blocked count; high-priority (1–2) count among active items.

**Classification rules.** Evaluate in order; first match wins. Let *median* be the team median active count from the distribution statistics, and *capacity* be the member's configured sprint capacity where it is set.

| Class | Rule |
| --- | --- |
| `Overloaded` | Any of: remaining hours exceed the member's remaining capacity for the days left in the sprint (both values set); or the member meets the server's imbalance threshold (at least 2× median *and* at least 4 more items than the lightest member) *and* holds at least one overdue or blocked item; or three or more overdue items; or two or more overdue items together with two or more active priority 1–2 items. |
| `High` | Not `Overloaded`, and any two of: active count at or above 1.5× median; remaining hours at or above 80% of remaining capacity; at least one overdue item; at least two blocked items; three or more active priority 1–2 items. Also `High` where the imbalance threshold is met but no second signal exists. |
| `Balanced` | Active count within the band from 0.5× to 1.5× median, no overdue work, at most one blocked item, and effort within capacity where both are set. |
| `Under-utilised` | Active count at or below 0.5× median, no overdue and no blocked work, *and* either remaining hours well below capacity or an active count of zero. Always print the non-performance explanations alongside it. |
| `Unknown` | Effort fields are unset and the counts alone are ambiguous — that is, the active count sits inside the band from 0.5× to 1.5× median with no overdue, blocked or priority signal to separate it; or the member is absent from the workload data; or capacity is not configured and no second signal exists. |

`Unknown` is a correct and expected answer. Where story points and remaining work are unset across the team — common in real projects — most rows will legitimately read `Unknown`, and the honest output says so and names the missing fields rather than manufacturing a ranking.

**Show the factors.** Every classification is followed by the factors that produced it, in the form `2× median (12 vs 6), 3 overdue, 1 blocked`. A classification printed without its factors is a defect. Where the class is `Unknown`, the factors state what was missing.

**Do not judge the person.** Never write that someone is slow, struggling, disengaged or coasting. Offer the innocent explanations for a light or heavy load — leave, part-time allocation, onboarding, support duty, work tracked outside Azure DevOps, or a single very large item.

## Output Format

Follow the KaarPulse Dashboard UI schema defined in `_shared/output-format.md`.
Use the templates from `_shared/templates/` to construct the response.

**Specific structure for Workload Analysis:**
1. **Header**: `# 📊 KaarPulse — Workload Analysis`
2. **Executive Summary**: 1-2 sentences summarizing team balance and highlighting overloaded members.
3. **👥 Team Workload**:
   | Member | Active | Pending | Effort | Overdue | Blocked | Load |
   |---|---:|---:|---:|---:|---:|---|
   Show `unknown` for Effort if missing. Load is the classification. Then workload bars scaled to the highest measured active count.
4. **🔎 Workload Patterns**: team-level patterns (concentration, unassigned pile, overdue clustered on one person) — not a repeat of the table.
5. **🚨 Overload Risks**: `Overloaded` rows with factors and named items (or a query if that member's overdue/blocked set has count > 3).
6. **🔎 Relevant Queries**: Title | Description | Count | Navigate from `create_ado_query` only.
7. **💡 Recommended Balancing Options** and **🧭 TL Decision Support**.
8. Footer: **ADO Work Items Modified: No**. Nothing was assigned, reassigned or modified.

## Edge Cases

| Situation | What to do |
| --- | --- |
| No story points and no remaining work anywhere | Print `unknown` in every `Effort` cell, classify on counts plus overdue, blocked and priority signals only, and state that effort-based classification was not possible. Expect several `Unknown` rows. |
| Sprint capacity not configured on the iteration | Say capacity is unset, drop the capacity comparison from every rule, and never assume a default working day. |
| No current sprint (`currentSprint: null`) | Report that no iteration is marked current, drop days-remaining and capacity comparisons, and analyse all open work instead. |
| The process defines no due-date field | Overdue cannot be measured at all. Print `unknown` in the `Overdue` column, remove overdue from every classification rule, and say which rules were weakened. Do not print `0`. |
| A member has no assigned work | Show the row with 0 active items and classify `Under-utilised` or `Unknown` per the rules, always with the leave, onboarding and work-tracked-elsewhere explanations attached. |
| Team has one member | Median, lightest and busiest are the same person, so the distribution rules cannot fire. Report the raw counts, effort and overdue or blocked work, and classify only against capacity. Say why the comparison is unavailable. |
| Team has no members | Report the empty roster, skip the table, and lead with the unassigned bucket as the finding. |
| Everything is unassigned | Lead with the unassigned count. The per-member table will be empty of work; say so and offer `work-assignment-recommendation`. |
| One member holds nearly all the work | Report it as a distribution fact with the numbers, quote the server's imbalance threshold, and put the balancing options first. Do not speculate about why. |
| Counts from two tools disagree | Prefer `analysis_team_workload` as the measured base, state that the tools were called at different moments, and give both numbers rather than silently picking one. |
| A list hit its `limit` | Say the list was truncated and give the limit next to the count. Do not present a truncated bucket as a complete one. |
| The Team Lead asks you to move an item to balance the load | Refuse the change, explain that KaarPulse is read-only for Azure DevOps, and offer the balancing recommendation or an email draft via `team-email-assistant`. |
| Azure DevOps unreachable or PAT invalid | Report that the analysis could not be produced and suggest `ado_get_connection_status`. Never estimate the numbers. |

## Safety Rules

All of `_shared/safety-rules.md` applies. The points that bite most often here:

- **Read-only for work items.** This skill identifies work that ought to move. It cannot move it. Every output ends with the statement that nothing was assigned or modified. Saved queries via `create_ado_query` are allowed.
- **No performance judgements.** Workload classes describe the work in a person's queue, never the person. Assume the output could be forwarded to the member it describes.
- **Unknown is not zero.** An unset effort field, an unmeasurable due date and a genuine zero are three different findings and are reported differently.
- **No invented data.** Names, ids, counts, hours and capacities come from tool calls made in this run. Never estimate an effort value to fill a cell.
- **No email as a side effect.** If the Team Lead wants to talk to an overloaded member, hand over to `team-email-assistant`, where sending needs explicit confirmation.

## Example Requests

- "Who is overloaded right now?"
- "Show me the team workload."
- "Is work evenly distributed across the Platform team?"
- "Who has capacity to take something on this sprint?"
- "How loaded is Priya compared with the rest of the team?"
- "Give me the workload table and just the overload risks."
- "Who is overloaded, and who should pick up the unassigned items?" → this skill, then `work-assignment-recommendation` (recommendation only).
- "Show me the workload and draft a note to anyone carrying overdue work." → this skill, then `team-email-assistant` (draft only; sending needs explicit confirmation).
