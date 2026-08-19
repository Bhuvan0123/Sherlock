---
name: tl-productivity-review
title: Team Lead Productivity Review
description: Review the Team Lead's own project-management activity using the local audit trail of actions taken through this assistant, combined with live Azure DevOps state, to show what is being monitored, where follow-through has stalled and which risks are still standing.
version: 2.0.0
category: analysis
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - tl_analyze_productivity
  - tl_analyze_work_management
supporting_tools:
  - tl_get_activity
  - tl_get_activity_summary
  - tl_analyze_activity
  - analysis_project_health
  - analysis_work_distribution
  - analysis_blocked_items
  - analysis_cross_team_dependencies
  - ado_get_unassigned_items
  - email_get_send_log
  - email_list_drafts
  - ado_get_overdue_items
  - ado_query_work_items
  - create_ado_query
missing_capabilities:
  - "The audit trail records only actions taken through this MCP server. Work done directly in the Azure DevOps web UI, in meetings, in Teams chat or by email outside this assistant is invisible to every tool here."
  - "There is no measure of time spent, decisions made or conversations held, so nothing about management effort or diligence can be derived."
  - "Azure DevOps does not attribute a field change to the person who prompted it, so a follow-up that worked cannot be linked back to the Team Lead's action."
  - "There is no benchmark or peer comparison for a Team Lead, and the server produces no management score of any kind."
  - "There is no saved-query discovery tool. Equivalent queries are reused only when create_ado_query returns QUERY_ALREADY_EXISTS for the same predictable title."
triggers:
  - review my own activity
  - how am i managing the team
  - tl productivity review
  - what have i been tracking
  - where am i not following through
  - review my project management
  - what have i missed this fortnight
  - show me my management gaps
---

# Team Lead Productivity Review

## Purpose

Show the Team Lead what their own project-management activity looks like from the data that genuinely exists: the local audit trail of everything done through this assistant, set against the live state of Azure DevOps. It answers questions such as what is being monitored and how often, which subjects keep coming back, where a follow-up was started but not finished, and which risks have been looked at repeatedly without moving.

**The single most important limitation, and it must be stated in the output every time.** The audit trail is a local SQLite log of tool calls made through this MCP server. It cannot observe anything the Team Lead did in the Azure DevOps web UI, in a stand-up, in a one-to-one, in Teams chat, or in email sent outside this assistant. A thin or empty trail therefore means *this assistant was not used* during the window. It does not mean the Team Lead did nothing, and it must never be presented, phrased or implied that way.

This review is about coverage and follow-through in the tracked data. It is not an appraisal, and the server produces no management score.

## When to Use

Use this skill when the Team Lead asks about their own activity, wants to know where their attention has been going, or is checking for management gaps before a sprint boundary or a conversation with their own manager. Typical phrasings are in the `triggers` list.

Use a different skill when:

- the question is about the team's delivery rather than the Team Lead's activity → `team-productivity-review`
- the question is about the past week including team output and what to do next → `weekly-team-review`
- the question is about the state of the project today → `team-morning-brief` or `daily-team-report`
- the question is only about which work is stuck or at risk → `deadline-risk-analysis`

If the Team Lead asks "am I doing a good job", answer with what the data shows about coverage and follow-through, and say directly that the question of how well they lead cannot be answered from a tool-call log.

## Required Inputs

None. Organization, project and team are fixed by server configuration and must never be passed.

Optional, if the Team Lead supplies them:

| Input | Effect |
| --- | --- |
| A window ("last month") | Pass as `days`. `tl_analyze_productivity` defaults to 14, `tl_analyze_work_management` to 30, `tl_get_activity_summary` to 7, `tl_analyze_activity` to 14. State the resolved window per tool rather than implying one window covered everything. |
| A category ("just the email activity") | `tl_get_activity` accepts a `category`. The permitted values are audit-trail categories rather than tool names: project review, team review, work item lookup, search, analysis, report, email draft, email send, confirmation, recommendation review and maintenance, each written in lower snake case. |
| An outcome ("show me what failed") | `tl_get_activity` accepts `outcome` from `success`, `error`, `rejected`. |
| A specific tool name | `tl_get_activity` accepts `tool`, for questions such as "how often did I look at blocked work". |

A window longer than the assistant has been installed will return only the days that exist. Say how much history the trail actually holds.

## Data Sources

All data comes from KaarPulse MCP tools. Two distinct kinds of data are combined here and must stay visibly distinct in the output.

**Primary:**

- `tl_analyze_productivity` (`days`, default 14) — combines the local trail with live Azure DevOps state: monitoring frequency, long-blocked items that repeated follow-ups have not moved, subjects reviewed more than once that are still open, unassigned high-priority work, and drafts prepared but never sent. Returns the standard envelope and produces no score.
- `tl_analyze_work_management` (`days`, default 30) — tool mix, category mix, days with activity against days in the window, busiest day, and email discipline: drafted against sent against expired.

**Supporting:**

| Need | Tool |
| --- | --- |
| The raw activity rows, filtered | `tl_get_activity` (`days`, `category`, `tool`, `outcome`, `limit`) |
| Totals by category, tool, outcome and day; repeated subjects | `tl_get_activity_summary` (`days`, default 7) |
| What is monitored, how often, where follow-through stalls | `tl_analyze_activity` (`days`, default 14) |
| Live project health with rated dimensions and reasons | `analysis_project_health` |
| Whether an imbalance is still standing | `analysis_work_distribution` |
| Blocked items with evidence and days in state | `analysis_blocked_items` |
| Dependencies on other teams that need chasing | `analysis_cross_team_dependencies` |
| Work still without an owner | `ado_get_unassigned_items` |
| What was actually sent, and when | `email_get_send_log` |
| Drafts left pending, cancelled or expired | `email_list_drafts` |

The audit trail stores a redacted parameter and result summary only. It never stores credentials and never stores email bodies, so this review cannot quote what an email said.

## Workflow

1. **Resolve the window** from the Team Lead's phrasing, and note that the two primary tools have different defaults (14 and 30 days). State both resolved windows in the output header rather than merging them.
2. **Call `tl_analyze_productivity`** with the resolved `days`. This is the core of the review: it is the only tool that joins the local trail to live Azure DevOps state.
3. **Call `tl_analyze_work_management`** with the resolved `days` for the coverage picture — tool and category mix, days with activity against days in the window, busiest day, and email discipline.
4. **Establish how much history exists.** Call `tl_get_activity_summary` (`days`) for the totals by category, tool, outcome and day, and for subjects revisited more than once. If the trail is empty or covers only a few days, that fact leads the output.
5. **Read the envelopes and keep the two data kinds apart.** Local trail facts and live Azure DevOps facts are both measured, but they answer different questions; `observations`, `concerns` and `recommendations` are generated. Note `methodology` for the thresholds you will quote.
6. **Verify each standing risk against live data before reporting it.** For a long-blocked item call `analysis_blocked_items`; for unowned work `ado_get_unassigned_items`; for an imbalance `analysis_work_distribution`; for external dependencies `analysis_cross_team_dependencies`; for the overall picture `analysis_project_health`. A risk is only worth raising if it is still true now.
7. **Check email follow-through.** Call `email_list_drafts` for drafts that are pending, cancelled or expired, and `email_get_send_log` for what actually went out. A draft that expired unsent is a follow-through gap worth naming; it is not a failing.
8. **Drill in only where it is needed.** Use `tl_get_activity` with `category`, `tool` or `outcome` to substantiate a specific claim, for example that the same work item was looked up on five separate days.
9. **Assemble the output** in the order below, with `Observed data` and `AI interpretation` visibly separated in every section that contains both.
10. **State the trail's limitation explicitly**, in the header and again beside any finding that depends on activity counts.
11. **Close with the read-only statement.**
12. **Create queries** via `create_ado_query` for underlying work-item groups with count > 3 (unassigned high-priority, long-blocked, overdue still open after repeated review) following `_shared/query-workflow.md`. Do not make unsupported claims about management quality.

If `tl_analyze_productivity` fails, run `tl_analyze_activity` and `tl_get_activity_summary` instead, and say plainly that the live-state correlation is missing from this run.

## Analysis Rules

**Absence of activity is never evidence of inaction.** This is the rule that overrides everything else in this skill. If a window shows few or no rows, the only supportable statement is that the assistant was not used during it. Forbidden: "you did not review the sprint", "no follow-up happened", "monitoring lapsed", and every equivalent phrasing. The supportable form is: "no activity was recorded through this assistant between <date> and <date>; work done directly in Azure DevOps or elsewhere is not visible here."

**No personal or psychological claims.** Nothing about attitude, diligence, effort, motivation, capability, focus or discipline — about the Team Lead or anyone else. The subject of every sentence is an action, an item or a count, never a character.

**No inference from missing data.** A gap in the trail supports no conclusion at all. Report the gap and stop there.

**Separate observed data from interpretation.** Every section that mixes them uses the two labels. `Observed data` carries counts, dates, tool names, work-item ids and states, taken directly from `facts`. `AI interpretation` carries anything derived, and must name the evidence and the threshold behind it.

**Follow-through is a two-part claim, and both parts need evidence.** "Reviewed repeatedly but still open" requires both the repeated-subject count from the trail *and* the item's current state from a live read in this run. Never assert a follow-through gap from the trail alone, and never from the live state alone.

**Correlation is not causation.** An item that has not moved despite being reviewed five times is an observation. It does not show that the reviews were ineffective; the item may be blocked on another team, waiting on a release, or deliberately parked.

**Use the server's thresholds and quote them.** `analysis_blocked_items` flags items unchanged for five or more days. `analysis_work_distribution` flags imbalance only when the busiest member holds at least twice the median and at least four more items than the lightest. Quote the rule that fired.

**Improvements are about coverage, not character.** An entry under `AREAS FOR IMPROVEMENT` names a specific gap in what is tracked or followed up — an unowned priority-1 item, a draft that expired, a dependency nobody has chased — and never a trait.

**No score.** No percentage, no grade, no maturity level, no comparison to any benchmark. The server produces none, and neither may this skill.

## Output Format

Follow the KaarPulse Dashboard UI schema defined in `_shared/output-format.md`.
Use the templates from `_shared/templates/` to construct the response.

**Specific structure for TL Productivity Review:**
1. **Header**: `# 📊 KaarPulse — Team Lead Productivity Review`
2. **Executive Summary**: State the window, the busiest day, and an overarching observation.
   *CRITICAL: Include the scope note that this ONLY tracks KaarPulse usage.*
3. **📌 At a Glance (TL Activity Summary)**:
   Provide a KPI table of: Recorded actions, Busiest day, Top Category, Subjects reviewed more than once, Emails drafted vs sent.
4. **🔎 Key Findings & 🚨 Risks**: 
   - `MANAGEMENT SIGNALS` (Observed data only, e.g., an item reviewed X times but still open).
   - Unassigned priority items or long-blocked items.
5. **🧠 Management Insights**: Interpretation of coverage and follow-through, labelled as interpretation, with trail limitation restated.
6. **💡 Improvement Recommendations**: Coverage and follow-through actions, not character judgements.
7. **🎯 TL Actions**: Today / This Week.
8. **🔎 Azure DevOps Queries** for work-item groups with count > 3.
9. **⚠️ Data Quality**: Reiterate the audit-trail limitation.

Ensure you state: "No Azure DevOps work items were modified."

## Edge Cases

| Situation | What to do |
| --- | --- |
| The audit trail is empty | Lead with it: no actions were recorded through this assistant in the window. State explicitly that this says nothing about work done elsewhere. Then offer the live-state sections — blocked, unassigned, health — which do not depend on the trail. |
| The assistant was installed part-way through the window | Report the number of days the trail actually covers against the days requested, and treat only the covered days as the denominator anywhere a frequency is stated. |
| Activity is concentrated in one or two days | Report the distribution as a fact. Do not describe it as inconsistent, sporadic or reactive; the assistant may simply be used at sprint boundaries. |
| A subject was reviewed repeatedly and is now closed | That is follow-through, and it belongs in `MANAGEMENT SIGNALS` as observed data. Do not list it as a gap. |
| An item was reviewed repeatedly and has not moved | Report both halves — the review count from the trail and the live state and days in state — and offer the non-management explanations before any interpretation. |
| A draft was created and never sent | Report it as a follow-through gap with the draft id and status from `email_list_drafts`. Note that drafts expire by default after 60 minutes, so an expired draft may simply mean the conversation moved on. |
| The send log is empty but drafts exist | State both facts. Never conclude that the Team Lead avoided communicating; email may have been sent from Outlook, which this server cannot see. |
| Microsoft Graph is not configured | `email_get_configuration` will say so. Drafting works, sending does not, so unsent drafts may reflect configuration rather than follow-through. Check before naming a gap. |
| Errors or rejected outcomes appear in the trail | Report the counts and the tools involved. A `rejected` row usually means a refused email send, which is the safety gate working as intended, not a mistake. |
| The Team Lead asks for a score, a grade or a comparison to other leads | Decline and explain that the server produces no score and holds no comparison data. Offer the coverage and follow-through facts instead. |
| The Team Lead asks whether they are working hard enough | Decline the question directly. The trail records tool calls, not effort or hours, and nothing about diligence can be derived from it. |
| A live verification call fails | Report the risk as unverified, name the tool that failed with its user-facing message, and do not carry the risk forward as though it were confirmed. |
| The Team Lead asks to clear the trail | `tl_purge_activity` exists for this, takes `older_than_days`, and must only be called when explicitly asked and after the window has been confirmed back to them. |

## Safety Rules

All of `_shared/safety-rules.md` applies. The points that bite hardest here:

- **The trail's blind spot must be stated, not buried.** It appears in the header and again next to any finding that rests on activity counts. Silently letting a low count read as inactivity is the primary failure mode of this skill.
- **No inference from missing data, and no personal claims.** Nothing about attitude, effort, diligence or capability, for the Team Lead or for any team member named in the risks.
- **No invented data.** Every count, date, id and state comes from a tool call made during this request. Unknown is not zero.
- **Read-only for work items.** Every recommendation here is text. Reassigning that unowned priority-1 item, unblocking an item or rebalancing a load all happen in Azure DevOps, by a human. Saved queries via `create_ado_query` are allowed.
- **Respect the audit trail.** Do not work around it, and do not call `tl_purge_activity` on your own initiative.
- **No credentials**, ever, including in quoted error messages. The trail is redacted by design; keep it that way in the output.

## Example Requests

- "Review my own activity for the last two weeks."
- "What have I been tracking, and what have I let slip?"
- "Where am I not following through?"
- "How am I managing the team?" → answer with coverage and follow-through facts, and state what the data cannot say.
- "Show me anything I looked at more than once that is still open."
- "Did I leave any emails unsent?"
- "My trail is empty — does that mean I did nothing?" → no; it means the assistant was not used in that window. Offer the live-state sections instead.
- "Review my activity, then draft a chase for the dependencies nobody has picked up." → this skill, then `team-email-assistant` (draft only; sending needs explicit confirmation).
