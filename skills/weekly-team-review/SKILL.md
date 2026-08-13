---
name: weekly-team-review
title: Weekly Team Review
description: Review the past working week for the Platform team - what was completed, what was not, overdue work, sprint progress, workload, recurring blockers, major changes and risks - from live Azure DevOps data, stating plainly wherever the history needed is not available.
version: 1.0.0
category: report
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - tl_get_weekly_review
  - analysis_team_productivity
supporting_tools:
  - analysis_team_delivery_metrics
  - ado_get_sprint_progress
  - ado_get_team_iterations
  - analysis_member_sprint_history
  - analysis_work_distribution
  - analysis_blocked_items
  - analysis_cross_team_dependencies
  - analysis_project_health
  - ado_get_recently_changed_items
  - ado_get_overdue_items
  - tl_get_activity_summary
  - ado_get_team_members
missing_capabilities:
  - "There is no snapshot of how the project looked at the start of the week, so before-and-after comparisons can only be made where a tool derives them from revision history."
  - "Sprint history depends on iterations being configured with start and finish dates; where they are not, per-sprint comparison is unavailable rather than zero."
  - "Cycle and lead time exist only for items carrying the required dates, and the tools report how many items were measurable."
  - "The local audit trail covers only what was done through this assistant, so a quiet week in the trail says nothing about work done in the Azure DevOps web UI, in meetings or in chat."
  - "Azure DevOps holds no leave or working-pattern data beyond the team's configured working days, so a quiet week cannot be separated from absence."
triggers:
  - weekly team review
  - how did the week go
  - review last week for the team
  - what did we finish this week
  - end of week summary
  - weekly review before the retro
  - what carried over from this week
  - week in review for the platform team
---

# Weekly Team Review

## Purpose

Review the working period just ended: what the Platform team completed, what did not finish, what is overdue, how the sprint progressed, how the load sits, which blockers keep recurring, what materially changed, and what the Team Lead should carry into next week.

The review is built only from what Azure DevOps and the local audit trail actually record. Where the history needed for a comparison does not exist, the review says exactly what is unavailable and why, rather than filling the gap. A weekly review that quietly invents last week's numbers is worse than one that admits the gap.

## When to Use

Use this skill at the end of a week, before a retrospective, at a sprint boundary, or when the Team Lead asks how the period went. Typical phrasings are in the `triggers` list.

Use a different skill when:

- the question is about today → `team-morning-brief` or `daily-team-report`
- the question is about delivery trends across several sprints rather than one week → `team-productivity-review`
- the question is about the Team Lead's own activity alone → `tl-productivity-review`
- the question is only about what is stuck or at risk → the matching focused analysis skill
- the review needs to go to the team by email → produce it here, then hand over to `team-email-assistant`. There is no weekly template, so the body is composed through the generic drafting tool, and sending requires explicit confirmation of that specific draft.

## Required Inputs

None. Organization, project and team are fixed by server configuration and must never be passed.

Optional, if the Team Lead supplies them:

| Input | Effect |
| --- | --- |
| A look-back window ("last two weeks") | Pass as `days` to `analysis_team_delivery_metrics`, `ado_get_recently_changed_items` and `tl_get_activity_summary`, and as `window_days` to `analysis_team_productivity`. Note that `tl_get_weekly_review` takes no arguments and always reports the current week. |
| A sprint reference | `ado_get_sprint_progress` accepts `"current"` (default), `"next"`, `"previous"`, or a name, path or id. Use `"previous"` when the week ended with a sprint. |
| A named member | Add `analysis_member_sprint_history` (`member`, `sprint_count`) for their per-sprint assigned, completed and carried-in counts. |
| "Just what changed" | Run `ado_get_recently_changed_items` with `days: 7` and present that section alone, keeping the header for context. |

`ado_get_recently_changed_items` accepts a look-back of up to 90 days, so a 7-day window for "what changed this week" is always available, as is a longer window if the Team Lead asks for one.

## Data Sources

All data comes from KaarPulse MCP tools. Two kinds of data are combined — live Azure DevOps state and the local audit trail — and they must not be conflated.

**Primary:**

- `tl_get_weekly_review` () — the assembled weekly view: assistant activity this week, delivery and sprint completion trend, what needs attention (overdue, blocked, unassigned, cross-team dependencies, health concerns), per-member workload, email activity, and recommended actions for the week ahead.
- `analysis_team_productivity` (`sprint_count`, `window_days`) — completed work, throughput, cycle and lead time where measurable, reopened items, sprint completion trend, carry-over, mid-sprint additions and workload distribution. Defaults are 3 sprints and 30 days; set `window_days: 7` for a strictly weekly view and say so.

**Supporting:**

| Need | Tool |
| --- | --- |
| Raw delivery metrics with no interpretation | `analysis_team_delivery_metrics` (`days`) |
| Committed against completed, points, capacity, carry-over evidence | `ado_get_sprint_progress` (`sprint`, `include_carry_over`) |
| Which iterations exist, with dates and timeframe | `ado_get_team_iterations` |
| One member's per-sprint assigned, completed and carried-in counts | `analysis_member_sprint_history` (`member`, `sprint_count`) |
| Evenness of the current spread and the imbalance flag | `analysis_work_distribution` |
| Recurring blockers with evidence and days in state | `analysis_blocked_items` (`limit`) |
| Work waiting on another team | `analysis_cross_team_dependencies` |
| Rated health dimensions with reasons | `analysis_project_health` |
| What moved during the week | `ado_get_recently_changed_items` (`days: 7`) |
| Work still late at the end of the week | `ado_get_overdue_items` |
| What the Team Lead did through this assistant | `tl_get_activity_summary` (`days: 7`) |
| The roster the numbers apply to | `ado_get_team_members` |

## Workflow

1. **Call `tl_get_weekly_review`.** It takes no arguments and assembles the week in one call, keeping the sections internally consistent. Note that its assistant-activity portion covers only actions taken through this server.
2. **Call `analysis_team_productivity`** with `window_days: 7` for the weekly figures, or the window the Team Lead named. Keep `sprint_count` at the default 3 unless they asked otherwise, and state both resolved settings.
3. **Read the envelopes.** Keep `facts` apart from `observations`, `concerns` and `recommendations`, and note `methodology` for the thresholds you will quote.
4. **Establish which period the review actually covers.** Call `ado_get_team_iterations` to see which iterations exist, their start and finish dates and their `timeFrame`. If the week spans a sprint boundary, say which sprints the numbers straddle.
5. **Call `ado_get_sprint_progress`** with `include_carry_over: true` for the sprint that governed the week — `"current"`, or `"previous"` if it closed during the week — for committed against completed, story points, capacity and carry-over evidence drawn from revision history.
6. **Call `ado_get_recently_changed_items`** with `days: 7` for what materially moved: items closed, items newly blocked, items that gained or lost an owner, items that changed iteration. Skip field-level noise.
7. **Call `ado_get_overdue_items`** for work still late at the close of the week, and `analysis_blocked_items` for blockers with their evidence and days in state; anything flagged as unchanged for five or more days is a recurring blocker and leads that section.
8. **Call `analysis_cross_team_dependencies`** and `analysis_project_health` for the risk section, and `analysis_work_distribution` for the workload section and its imbalance flag.
9. **Call `tl_get_activity_summary`** with `days: 7` when the Team Lead wants their own week included. Label it clearly as assistant activity, not as the whole of their work.
10. **Assemble the output** in the order below, marking generated content and keeping every unmeasurable item in the explicit limitations line rather than silently omitting it.
11. **Close with the read-only statement**, and offer the email hand-over if the review is to be shared.

If `tl_get_weekly_review` fails, build the review from `analysis_team_productivity`, `ado_get_sprint_progress` and `ado_get_recently_changed_items`, and say which sections came from the fallback path.

## Analysis Rules

**Never invent history.** This is the defining constraint. If a comparison needs data the tools did not return — last week's open count, a previous sprint that was never configured with dates, cycle time on items with no activation date — do not estimate it, do not infer it from today's numbers, and do not quietly drop the comparison. Name what is missing and why, in the review's limitations line.

**Be specific about which limit applies.** The honest statements differ and should not be blurred together:

- The local audit trail covers only actions taken through this assistant; a quiet trail means the assistant was not used, not that the Team Lead was idle.
- Sprint history exists only where iterations are configured with start and finish dates; without them, per-sprint comparison is unavailable rather than zero.
- Cycle and lead time are measured only where the underlying dates exist, and the tools report how many items were measurable.
- Overdue cannot be measured at all where the process defines no due-date field.
- There is no snapshot of how things looked on Monday, so "what changed" comes from revision history through `ado_get_recently_changed_items` and the carry-over evidence in `ado_get_sprint_progress`, and nothing else.

**Completed means completed.** Use `stateCategory` to decide what finished. Items in the `Removed` category are not delivered work and are never counted as such. A reopened item is not a new completion; report reopens as their own figure.

**Carry-over is a planning signal.** `ado_get_sprint_progress` derives it from revision history. Pass that evidence through and describe carry-over as a sizing or planning observation, not as a failure by whoever holds the item.

**One week is one data point.** Where the review states a direction, give the number of periods behind it, and where there are fewer than three, describe the change and explicitly decline to call it a trend.

**Judge no one.** Report counts per member — completed, still open, overdue, blocked, carried in — and never a ranking, a score or a characterisation. Completion is attributed to the item's current assignee, so reassigned work is credited to its current owner; say so beside any per-member table. See `_shared/analysis-rules.md`.

**Use the server's thresholds and quote them.** `analysis_blocked_items` flags items unchanged for five or more days. `analysis_work_distribution` flags imbalance only when the busiest member holds at least twice the median and at least four more items than the lightest. Health dimensions come with `reasons`; risk comes with `riskReasons`. Quote the rule that fired rather than inventing one.

**Recommendations for next week are suggestions.** Each names the item or person and why now, and each is something a human does in Azure DevOps.

## Output Format

Follow the KaarPulse Dashboard UI schema defined in `_shared/output-format.md`.
Use the templates from `_shared/templates/` to construct the response.

**Specific structure for Weekly Team Review:**
1. **Header**: `# 📊 KaarPulse — Weekly Team Review`
2. **Executive Summary**: State the Team, period reviewed, sprint covered, and a short high-level summary of the week's outcomes.
3. **📌 At a Glance (Weekly KPIs)**:
   KPI table: Completed items, Reopened, Median Cycle Time, Not Completed (Carry-over/Mid-sprint added), Overdue.
4. **👥 Team Workload & Completions**: 
   | Member | Completed | Still Open | Overdue | Blocked | Carried In |
   |---|---|---|---|---|---|
   *(Note attribution rule: Completion is attributed to current assignee)*
5. **🏃 Sprint Progress**: Items complete vs total, Story points committed/completed.
6. **🚨 Recurring Blockers & Risks**: The major issues blocking the team or specific work items.
7. **🔎 Major Changes This Week**: Movement in work items (newly blocked, reassigned, closed).
8. **🧠 TL Assistant Activity**: Brief stats on KaarPulse usage this week.
9. **💡 Recommendations For Next Week**: specific TL actions based on the weekly findings.
10. **⚠️ Data Quality**: Explicitly list what was not available for this period.

Ensure you state: "No Azure DevOps changes were made. KaarPulse is read-only for Azure DevOps."

Use `unknown` where a value could not be measured and `—` where it does not apply. Never print `0` for something unmeasurable. See `_shared/output-format.md` for work-item rendering and cell conventions.

## Edge Cases

| Situation | What to do |
| --- | --- |
| No iteration was current during the period | Report the week in calendar days, keep the `SPRINT PROGRESS` heading and state that no iteration was marked current, so committed-against-completed and carry-over are unavailable. Do not substitute another iteration. |
| Iterations exist but have no start or finish dates | `ado_get_team_iterations` will show it. Say that per-sprint comparison is unavailable because the iterations are not dated, and fall back to the rolling day window. |
| The week spans a sprint boundary | Name both sprints and say which figures came from which. Do not merge two sprints' committed and completed counts into one pair of numbers. |
| The process defines no due-date field | Overdue cannot be measured at all. Say so in place of the `OVERDUE AT END OF PERIOD` table rather than reporting zero. |
| Cycle time is measurable for very few items | Give the measured count alongside the figure, or drop the metric and name the date the process does not record. Never present a figure drawn from two items as the team's cycle time. |
| Nothing was completed during the period | Report `0` completions as a fact, then name the ordinary explanations: a holiday period, large items still in flight, work blocked externally, or work tracked outside Azure DevOps. Do not present it as a verdict. |
| The audit trail is empty for the week | State that the assistant was not used, and that this says nothing about work done elsewhere. Keep the rest of the review, which does not depend on the trail. |
| Items were reassigned during the week | Completed counts follow the current owner. Say so beside the member table; the original contributor cannot be recovered from these tools. |
| Story points are unset on many items | Report points only where set with the count of items lacking them, and compute no velocity or forecast for next week. |
| A blocker recurs from previous weeks | Report the days in state from `analysis_blocked_items` and the evidence. There is no cross-week blocker history beyond time in current state, so say that is the basis. |
| A list reached its `limit` | Say the result was truncated and give the limit next to the count. |
| Cross-team dependencies are detected | Report them with the ids and the direction of the dependency, and note that the detection keys off the configured team's area paths, so the other team's name may not resolve. |
| The Team Lead asks to compare against last week's report | There is no stored report and no snapshot history. Offer what revision history supports — `ado_get_recently_changed_items` and the carry-over evidence — and say the rest is unavailable. |
| The Team Lead asks to send the review to the team | Hand over to `team-email-assistant`. There is no weekly template, so the body is composed from these measured facts through the generic drafting tool, and sending requires explicit confirmation of that draft. |
| `tl_get_weekly_review` fails | Rebuild from `analysis_team_productivity`, `ado_get_sprint_progress` and `ado_get_recently_changed_items`, name the missing sections and quote the tool's user-facing message. |
| Azure DevOps is unreachable or the PAT is invalid | Say the review could not be produced and suggest `ado_get_connection_status`. Never guess at a number. |

## Safety Rules

All of `_shared/safety-rules.md` applies. The points that bite hardest here:

- **No invented history.** Every figure comes from a tool call made during this request. A comparison the data cannot support is reported as unavailable, with the reason, in the limitations line. This is the failure mode a weekly review is most prone to.
- **No performance judgements.** Per-member figures are counts of work, never a ranking or a characterisation. Assume the review will be read by everyone it names.
- **No manufactured precision.** No velocity, no forecast for next week, no percentage likelihood. Risk and health stay categorical with their reasons attached.
- **The audit trail's blind spot must be stated** wherever assistant activity appears, so a quiet trail is never read as a quiet week.
- **Read-only.** Everything the review suggests happens in Azure DevOps, by a human. The read-only statement closes every run.
- **No email as a side effect.** Sharing the review means handing over to `team-email-assistant`, where sending requires explicit per-draft confirmation.

## Example Requests

- "Weekly team review for the Platform team."
- "How did the week go?"
- "What did we finish this week, and what carried over?"
- "End of week summary before tomorrow's retro."
- "Review the week — I want the recurring blockers in particular."
- "What changed this week?" → `ado_get_recently_changed_items` with `days: 7`, presented as the changes section.
- "Compare this week with last week." → only what revision history supports; say plainly that there is no stored snapshot of last week.
- "Weekly review, then email it to the team." → this skill, then `team-email-assistant` (no weekly template, so the body is composed from these facts; sending needs explicit confirmation).
