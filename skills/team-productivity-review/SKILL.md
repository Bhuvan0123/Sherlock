---
name: team-productivity-review
title: Team Productivity Review
description: Analyse the Platform team's delivery over recent sprints and a rolling window - completed work, throughput, cycle and lead time where measurable, reopened items, carry-over, blocked duration and workload distribution - without scoring or ranking any individual.
version: 1.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_team_productivity
  - analysis_team_delivery_metrics
supporting_tools:
  - analysis_member_completed_work
  - analysis_member_sprint_history
  - analysis_team_workload
  - analysis_work_distribution
  - analysis_blocked_items
  - ado_get_sprint_progress
  - ado_get_team_members
  - ado_get_work_item_history
missing_capabilities:
  - "There is no measure of effort actually spent. Azure DevOps records estimates and remaining work, not hours worked, so productivity per person-hour cannot be calculated."
  - "Work done outside Azure DevOps - reviews, incident handling, mentoring, meetings, design work tracked elsewhere - is invisible to every tool here."
  - "Completion is attributed to the CURRENT assignee, so a reassigned item is credited to its current owner and the original contributor cannot be recovered from these tools."
  - "There is no per-person availability, leave or allocation data, so a low completed count cannot be separated from absence or part-time allocation."
triggers:
  - team productivity review
  - how is the team delivering
  - how productive has the team been
  - team delivery trends
  - are we getting faster or slower
  - show me what the team completed over the last few sprints
  - team throughput and cycle time
  - review the team's output this quarter
---

# Team Productivity Review

## Purpose

Give the Team Lead an evidence-based picture of how work has been flowing through the Platform team over a recent period: how much was completed, how long items took where that can be measured, how much was carried over or reopened, where work sat blocked, and how the load is spread. The point is to find where the *system* is slow, not to rate people.

The server deliberately produces no productivity score, for the team or for any individual, and this skill must not construct one. Item counts, completion rates and cycle times are properties of the work and the process. They are not a measure of a person.

## When to Use

Use this skill when the Team Lead asks how the team is performing over time, wants delivery trends across sprints, or is preparing for a retrospective or a status conversation with their own manager. Typical phrasings are in the `triggers` list.

Use a different skill when:

- the question is about right now rather than the trend → `team-morning-brief`
- the Team Lead wants a keepable document for today → `daily-team-report`
- the question covers the past week including the Team Lead's own actions → `weekly-team-review`
- the question is only about who is carrying what right now → `workload-analysis`
- the question is about the Team Lead's own management activity → `tl-productivity-review`
- the Team Lead wants to chase somebody about what was found → `team-email-assistant`

If the Team Lead asks for a ranking, an individual score, or "who is my weakest performer", decline the framing, explain that these tools measure work and not people, and offer the per-member activity table instead.

## Required Inputs

None. Organization, project and team are fixed by server configuration and must never be passed.

Optional, if the Team Lead supplies them:

| Input | Effect |
| --- | --- |
| A number of sprints ("last 5 sprints") | Pass as `sprint_count` to `analysis_team_productivity` (default 3) and as `sprint_count` to `analysis_member_sprint_history` (default 3). |
| A number of days ("last 60 days") | Pass as `window_days` to `analysis_team_productivity` (default 30) and as `days` to `analysis_team_delivery_metrics` (default 30). |
| A named member | Restrict `MEMBER ACTIVITY` to that person using `analysis_member_completed_work` and `analysis_member_sprint_history`, and say the rest of the review still covers the whole team. |
| A focus ("just cycle time") | Run the primary tools and present only the requested part, keeping the summary line for context. |

The tools resolve members by display name, unique name or a partial match. If the Team Lead names somebody ambiguously, confirm against `ado_get_team_members` rather than guessing.

## Data Sources

All data comes from KaarPulse MCP tools. There is no other source, and nothing here is recalled from an earlier conversation.

**Primary:**

- `analysis_team_productivity` (`sprint_count`, `window_days`) — completed work, throughput, cycle and lead time indicators, reopened items, sprint completion trend, carry-over, mid-sprint additions and workload distribution, in the standard envelope with `facts` separate from `observations`, `concerns` and `recommendations`. It produces no score by design.
- `analysis_team_delivery_metrics` (`days`) — the raw metrics with no interpretation: completed counts by type, throughput, cycle-time and lead-time distributions, reopened events, and how many items were actually measurable.

**Supporting — for drill-down or verification:**

| Need | Tool |
| --- | --- |
| Roster the review covers | `ado_get_team_members` |
| One member's completions in the window | `analysis_member_completed_work` (`member`, `days`) |
| One member's per-sprint assigned, completed and carried-in counts | `analysis_member_sprint_history` (`member`, `sprint_count`) |
| Current per-member counts, points, capacity | `analysis_team_workload` |
| Evenness of the spread and the imbalance flag | `analysis_work_distribution` |
| Blocked items with evidence and time in state | `analysis_blocked_items` |
| A single sprint's committed versus completed and carry-over | `ado_get_sprint_progress` (`sprint`, `include_carry_over`) |
| What actually happened to one contested item | `ado_get_work_item_history` |

## Workflow

1. **Fix the window and say it out loud.** Default to three sprints and 30 days. If the Team Lead named a period, translate it into `sprint_count` and `window_days` / `days` and state the resolved window in the output header.
2. **Call `analysis_team_productivity`** with the resolved `sprint_count` and `window_days`. This is the backbone of the review.
3. **Call `analysis_team_delivery_metrics`** with the matching `days`. Use it to state the raw numbers, and note how many items were measurable for cycle and lead time.
4. **Read both envelopes carefully.** Keep `facts` apart from `observations`, `concerns` and `recommendations`, and note `methodology` — it carries the thresholds you will quote when a finding needs justifying.
5. **Call `ado_get_team_members`** to establish the roster the numbers apply to, including anyone with no completed work in the window.
6. **Build `MEMBER ACTIVITY`.** For each member, use the per-member facts already in the productivity envelope. Where the Team Lead wants more detail, call `analysis_member_completed_work` (`member`, `days`) and `analysis_member_sprint_history` (`member`, `sprint_count`). Report counts only — completed, overdue, blocked, carried in — and never a verdict.
7. **Call `analysis_work_distribution`** for the current spread and its imbalance flag, and `analysis_team_workload` if you need the underlying per-member counts, remaining hours and capacity.
8. **Call `analysis_blocked_items`** for the bottleneck section. Use the returned `blockedSignals` evidence and the time-in-state figures, and lead with anything flagged as unchanged for five or more days.
9. **Establish the sprint trend.** Take the sprint completion trend from the productivity envelope. If the Team Lead questions one sprint, call `ado_get_sprint_progress` with that sprint reference and `include_carry_over: true` to show committed versus completed and the carry-over evidence.
10. **Assemble the output** in the order given below, marking every generated conclusion as interpretation.
11. **Close with the read-only statement.** Nothing in this review changed Azure DevOps, and none of the recommendations can be carried out by KaarPulse.

If `analysis_team_productivity` fails, run `analysis_team_delivery_metrics` alone, say plainly that the trend and carry-over sections are unavailable and why, and do not reconstruct them from primitives.

## Analysis Rules

**Never judge a person.** Forbidden in every form: "Person X is productive", "X is the strongest contributor", any ordering of members by output, and any phrasing that implies a ranking through placement or emphasis. The permitted form is factual: "Priya Menon completed 7 items in the window, with 1 overdue and 2 blocked." See `_shared/analysis-rules.md`; this skill adds no exceptions to it.

**Attribution is current-owner attribution.** `analysis_member_completed_work` credits a completed item to whoever holds it *now*. An item completed by one person and later reassigned is counted for the new owner. Say this next to the member table every time, not only when the numbers look odd.

**Cycle and lead time exist only where the dates exist.** `analysis_team_delivery_metrics` measures them only for items carrying the required dates and reports how many were measurable. Always give the measured count alongside the figure — "cycle time measured for 9 of 24 completed items" — and drop the metric entirely if nothing was measurable rather than presenting a figure drawn from a handful of items as a team characteristic.

**A short window is not a trend.** Two sprints show a difference, not a direction. State the number of data points behind any trend claim, and where there are fewer than three sprints of history, describe the change and explicitly decline to call it a trend.

**Use the server's thresholds and quote them.** Work distribution is flagged as imbalanced only when the busiest member holds at least twice the median *and* at least four more items than the lightest. `analysis_blocked_items` flags items unchanged for five or more days. Quote the rule that fired; do not invent your own.

**Reopened items are not new completions.** Report reopen counts separately, never net them off the completed total, and treat a reopen as a signal about definition of done or acceptance, not about the person who closed it.

**Carry-over needs its evidence.** `ado_get_sprint_progress` derives carry-over from revision history. Pass that evidence through. Carry-over is a planning and sizing signal first, not a delivery failure.

**Offer the innocent explanation.** Where a number looks unusual, name the ordinary causes: leave, part-time allocation, a large item spanning the window, onboarding, work blocked by another team, or work tracked outside Azure DevOps. The tools cannot distinguish between these and anything else, and neither can you.

## Output Format

Follow the KaarPulse Dashboard UI schema defined in `_shared/output-format.md`.
Use the templates from `_shared/templates/` to construct the response.

**Specific structure for Team Productivity Review:**
1. **Header**: `# 📊 KaarPulse — Team Productivity Review`
2. **Executive Summary**: State the window measured and a 1-2 sentence summary of delivery trends.
3. **📌 At a Glance (Productivity KPIs)**:
   Provide a KPI table of: Completed items, Throughput, Cycle Time, Lead Time, Reopened, Carry-over. 
   *(State if not measurable).*
4. **🔎 Key Findings & 🚨 Bottlenecks**: Identify blocked items or negative sprint completion trends.
5. **👥 Member Activity (Data)**:
   | Member | Completed | Open Now | Overdue | Blocked | Carried In |
   |---|---:|---:|---:|---:|---:|
6. **🧠 AI Analysis (Trends)**: List the observed sprint-to-sprint delivery trends. Reiterate that data is based on the current assignee and is not a performance evaluation.
7. **💡 Recommended Actions**: Actionable next steps to unblock work or adjust planning based on throughput.
8. **⚠️ Data Quality**: State limits of the review (e.g., Cycle time not measurable for X items).

Ensure you state: "No Azure DevOps changes were made. KaarPulse is read-only for Azure DevOps."

## Edge Cases

| Situation | What to do |
| --- | --- |
| Fewer than three sprints of history exist | Report what history there is, name the sprints covered, and say the sprint completion trend is not established. Do not extrapolate a direction from two points. |
| No iteration is marked current | `ado_get_sprint_progress` and the sprint trend lose their anchor. Report the window in days only, say why the sprint view is unavailable, and continue with the rolling metrics. |
| Cycle and lead time are measurable for very few items | Give the measured count with the figure, or drop the metric. Say which dates the process does not record rather than implying the team has no cycle time. |
| The process defines no due-date field | Overdue cannot be measured at all. Report that in place of a zero, and remove the `Overdue` column rather than filling it with zeros. |
| A member completed nothing in the window | State the count as `0` and immediately name the ordinary explanations. Never present it as a finding about that person. |
| Work was reassigned during the window | The completed count follows the current owner. Say so beside the table; if the Team Lead disputes a specific item, call `ado_get_work_item_history` on that id and report what the revisions actually show. |
| A member has left the team or joined mid-window | The roster from `ado_get_team_members` is current membership only. Say that the window may include work by people no longer listed, and that partial-window membership is not visible to these tools. |
| Reopened items inflate or deflate the picture | Report reopens as their own line. Do not adjust the completed total, and do not attribute a reopen to whoever closed the item. |
| Story points are unset on many items | Report points only where set, give the count of items without them, and do not compute velocity or a completion forecast from a partial set. |
| A list reached its `limit` | Say the result was truncated and give the limit next to the count, so the Team Lead knows the figure is a floor. |
| The Team Lead asks for a per-person score or ranking | Decline, explain that the server produces no score by design and that these tools cannot measure effort or work done outside Azure DevOps, and offer the `MEMBER ACTIVITY` counts instead. |
| `analysis_team_productivity` fails | Fall back to `analysis_team_delivery_metrics`, state which sections are missing and quote the tool's user-facing message. Never show a stack trace. |
| Azure DevOps is unreachable or the PAT is invalid | Report that the review could not be produced and suggest `ado_get_connection_status`. Never guess at any number. |

## Safety Rules

All of `_shared/safety-rules.md` applies. The points that bite hardest here:

- **No performance judgements about people.** This is the defining constraint of the skill. Assume the output will be forwarded to every person it names; write it so that would be fine.
- **No manufactured precision.** No composite score, no velocity, no completion forecast, no percentage likelihood. Risk and workload stay categorical with their reasons attached, exactly as the tools return them.
- **No invented data.** Every id, title, owner, count and date comes from a tool call made during this request. Unknown is not zero, and a metric that could not be measured is reported as such.
- **Read-only.** The review will surface work that ought to be re-sized, reassigned or closed. KaarPulse can do none of it. End with the read-only statement and offer a recommendation or an email draft instead.
- **No email as a side effect.** This skill never drafts or sends anything. If the Team Lead wants the findings sent on, hand over to `team-email-assistant`, where sending requires explicit per-draft confirmation.

## Example Requests

- "How has the team been doing over the last three sprints?"
- "Team productivity review for the last 60 days."
- "Are we delivering faster than we were?"
- "What did the team complete this month, and what got reopened?"
- "Show me cycle time and where work is getting stuck."
- "Give me a productivity review and tell me who my best performer is." → run the review, decline the ranking, present `MEMBER ACTIVITY` as counts.
- "Productivity review, then draft a note to whoever has blocked items." → this skill, then `team-email-assistant` (draft only; sending needs explicit confirmation).
- "How is Priya doing?" → prefer `workload-analysis` for her current load; if this skill is used, report her counts and carry the attribution caveat.
