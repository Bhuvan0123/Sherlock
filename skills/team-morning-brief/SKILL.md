---
name: team-morning-brief
title: Team Morning Brief
description: Produce the Team Lead's prioritised morning briefing for the Platform team - what needs attention today, overdue and blocked work, sprint status, workload and recommended follow-ups, all from live Azure DevOps data.
version: 2.0.0
category: briefing
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_daily_team_review
supporting_tools:
  - ado_get_team_members
  - ado_get_current_sprint
  - ado_get_sprint_progress
  - ado_get_work_items_due_today
  - ado_get_recently_changed_items
  - ado_get_overdue_items
  - ado_get_blocked_items
  - ado_get_high_priority_items
  - ado_get_unassigned_items
  - analysis_team_workload
  - analysis_deadlines
  - analysis_stale_work
  - analysis_schedule_variance
  - analysis_backlog_quality
  - ado_get_field_mapping
  - ado_query_work_items
  - ado_get_work_item
  - create_ado_query
missing_capabilities:
  - "Azure DevOps has no per-person availability or leave calendar, so the brief cannot know who is out today."
  - "Comments are not scanned for the brief; use ado_get_work_item_comments on a specific item when discussion context matters."
  - "There is no saved-query discovery tool. Equivalent queries are reused only when create_ado_query returns QUERY_ALREADY_EXISTS for the same predictable title."
triggers:
  - give me today's team status
  - morning briefing
  - team morning brief
  - what should I look at today
  - how is my team doing today
  - brief me on the team
  - start of day summary
---

# Team Morning Brief

## Purpose

Give the Team Lead, in one pass, an accurate picture of where the Platform team stands this morning and what deserves their attention first. The brief is grounded entirely in live Azure DevOps data and ends with a small number of concrete follow-ups, none of which KaarPulse can perform itself.

This is a triage aid. It surfaces work that is late, stuck, unowned or at risk, and it shows how work is spread across the team. It is not a performance report and must never read like one.

## When to Use

Use this skill when the Team Lead asks for the state of the team right now, typically at the start of the day. Typical phrasings are in the `triggers` list above: "morning briefing", "give me today's team status", "what should I look at today".

Use a different skill when:

- the question is only about workload or who is overloaded → `workload-analysis`
- the question is only about deadlines or what is at risk → `deadline-risk-analysis`
- the question is about the project as a whole rather than today → `project-health-analysis`
- the question is about the sprint's trajectory → `sprint-health-analysis`
- the Team Lead wants a document to keep or forward → `daily-team-report`
- the Team Lead wants to chase people about what the brief found → `team-email-assistant`

The brief is frequently the first half of a combined request such as "brief me and draft reminders for the overdue items". In that case run this skill first, then hand the overdue set to `team-email-assistant`.

## Required Inputs

None. The organization, project and team are fixed by server configuration and must not be passed.

Optional, if the Team Lead supplies them:

| Input | Effect |
| --- | --- |
| A date reference ("today", "this morning") | Cosmetic only. The tools always report the current state; you cannot brief for a past date. Say so if asked. |
| A team name other than the configured one | Only `ado_get_team_members` and `ado_get_team_iterations` accept a `team` argument. The analysis tools are bound to the configured team, so a full brief for another team is not available. Say so rather than mixing scopes. |
| A focus ("just the blockers") | Run the brief and present only the requested sections, keeping the counts line for context. |

## Data Sources

All data comes from KaarPulse MCP tools. There are no other sources.

**Primary — one call assembles the whole brief:**

- `analysis_daily_team_review` — current sprint, work due today, in-progress work, items changed in the last day, overdue work, blocked work with evidence, high-priority work, upcoming deadlines with risk ratings, unassigned work, per-member workload, project health ratings, and recommended follow-ups. Returns the standard envelope with `facts` separated from `observations`, `concerns` and `recommendations`.

**Supporting — for drill-down, or if the primary call fails:**

| Need | Tool |
| --- | --- |
| Team roster and emails | `ado_get_team_members` |
| Current sprint and dates | `ado_get_current_sprint` |
| Sprint counts, points, capacity, carry-over | `ado_get_sprint_progress` |
| Work due today | `ado_get_work_items_due_today` |
| What moved since yesterday | `ado_get_recently_changed_items` (`days: 1`) |
| Overdue work | `ado_get_overdue_items` |
| Blocked work with evidence | `ado_get_blocked_items` |
| Priority 1–2 work | `ado_get_high_priority_items` |
| Unowned work | `ado_get_unassigned_items` |
| Per-member counts and distribution | `analysis_team_workload` |
| Deadline counts and risk | `analysis_deadlines` |
| Full detail on one item the Team Lead asks about | `ado_get_work_item` |

## Workflow

1. **Call `analysis_daily_team_review`.** This is the whole brief in one call and keeps every section internally consistent. Do not reconstruct it from primitives when it succeeds.
2. **Read the envelope.** Keep `facts` (measured) apart from `observations`, `concerns` and `recommendations` (generated). Note `methodology` — it carries the thresholds behind the risk and health ratings, and you will quote them when a rating needs justifying.
3. **Establish the sprint context.** From `facts`, take the current sprint name, dates and days remaining. If no sprint is current, say so; do not substitute another iteration.
4. **Build the counts line.** Members, open items, overdue, blocked, high priority, unassigned. Deduplicate by work-item id within each bucket, and never sum buckets into a total — an item can be overdue *and* blocked *and* high priority.
5. **Choose today's attention list.** Rank across all buckets using the ordering in Analysis Rules and take the top three to five items. Each entry names the item, the owner and the single reason it is on the list.
6. **Assemble the detail sections** — overdue, blocked, workload, sprint status — using the exact ids, titles, owners, states and dates returned.
7. **Note what changed since yesterday.** From the recent-changes facts, mention only material movement: items that closed, items that became blocked, items that gained or lost an owner. Skip field-level noise.
8. **Carry the recommendations through.** Take the tool's `recommendations`, keep the three to five that matter most today, phrase each as a concrete follow-up naming the item and the person, and mark them as suggestions.
9. **Group remaining categories** (overdue, due today, due within 3 calendar days from dated items, blocked, stale, high-priority active, missing planned dates, unassigned). Reuse lists already in the envelope; only call `analysis_stale_work`, `analysis_schedule_variance`, `analysis_backlog_quality` or `ado_get_field_mapping` when that category is missing from the primary result.
10. **Create saved queries via `create_ado_query`** for each category with count > 3, following `_shared/query-workflow.md`. Titles: `Platform - Overdue Work`, `Platform - Due Within 3 Days`, `Platform - Stale Active Work`, `Platform - High Priority Active Work`, `Platform - Missing Planned Dates`. Count <= 3: list the items. Reuse `QUERY_ALREADY_EXISTS`. Never dump the full overdue list when a query exists.
11. **Build the TL Priority Queue** using the ranking in Analysis Rules (severity, deadline, downstream impact, priority, workload, sprint impact).
12. **Close with the source footer.** No work items were modified. Saved queries, if created, are listed with real URLs.

If `analysis_daily_team_review` fails, fall back to the supporting tools section by section, and say which sections came from the fallback path.

## Analysis Rules

**Ordering for today's attention list.** Apply in order, stopping when you have five entries:

1. Overdue **and** blocked — late with a known obstruction.
2. Overdue **and** high priority (1–2).
3. Due today and not yet in an `InProgress` state category.
4. Blocked for five or more days (`analysis_daily_team_review` and `analysis_blocked_items` flag staleness).
5. High priority and unassigned.
6. Due within the sprint but owned by a member already carrying overdue work.

Each entry states the single strongest reason, not all of them.

**Workload.** Report the measured counts per member and the distribution facts. Where the tool has classified load, pass the classification through with its factors. Where it has not, describe the counts and stop. Never infer that someone is slow, overloaded or idle from item count alone — see `_shared/analysis-rules.md`. A high count with no overdue and no blocked work is not a problem; two overdue items on a light load may be.

**Blocked work.** Always give the evidence the tool returned (`blockedSignals`: state, tag, the CMMI Blocked field, or an unfinished predecessor link). "Blocked" without evidence is not actionable, and Azure DevOps has no universal blocked field, so the evidence is what makes the call credible.

**Risk.** Use the tool's `Low Risk` / `Medium Risk` / `High Risk` categories and their `riskReasons`. Do not invent probabilities, dates or severities.

**Sprint status.** Report items complete against total, plus days remaining. Only mention story points if they are set; if some items lack points, say how many. Do not compute velocity or project a completion date.

## Output Format

Follow the KaarPulse Dashboard UI schema defined in `_shared/output-format.md`.
Use the templates from `_shared/templates/` to construct the response.

**Specific structure for Team Morning Brief:**
1. **Header**: `# 📊 KaarPulse — Team Morning Brief`
2. **Executive Summary**: 1-2 sentences on the sprint state and the most critical items for today. Use a status indicator.
3. **📌 At a Glance (KPI Table)**: Members, Active, Overdue, Due today, Due in 3 days, Blocked, Unassigned. Use `unknown` when a field cannot be measured.
4. **🎯 TL Priority Queue**: Ranked top issues (severity, deadline, downstream impact, priority, workload, sprint impact). Each row: issue, count or `#id`, why now.
5. **🚨 What Needs Your Attention**: The top 3-5 items from the analysis rules. Categories with count > 3 point at a query instead of listing every id.
6. **👥 Workload bars** from measured active counts (scale to the busiest member).
7. **🏃 Sprint Health**: progress bar only from `completionRate` or completed/total the tool returned.
8. **🔎 Azure DevOps Queries**: Title | Description | Count | Navigate — only URLs from `create_ado_query`.
9. **🧠 Insights**, **💡 Recommendations**, **🧭 TL Decision Support** (if a real choice exists), **🎯 Recommended Actions** (Today / This Week / Optional).
10. **⚠️ Data Quality**. Footer: **ADO Work Items Modified: No**.

Ensure you state that KaarPulse is read-only for Azure DevOps work items.

## Edge Cases

| Situation | What to do |
| --- | --- |
| No current sprint (`currentSprint: null`) | Report "no iteration is currently marked active for this team" and continue. Sprint status becomes one line. Suggest checking iteration dates in Azure DevOps. |
| The process defines no due-date field | `dueDateField: null` means overdue and due-today cannot be measured *at all*. Say that explicitly. Do not report "0 overdue". |
| Team has no members | Report the empty roster and stop the workload section. Everything else still runs; unassigned work becomes the main finding. |
| No open work items | State it plainly — that is a valid, healthy answer. Do not manufacture concerns. |
| Nothing overdue, blocked or unassigned | Say so in one line each and keep the brief short. A quiet morning is a legitimate outcome. |
| Everything is unassigned | Lead with it. This is the finding, not a footnote. Offer `work-assignment-recommendation`. |
| A member has no email address | Only matters if the brief feeds an email. Note the gap; never construct an address. |
| A list hit its `limit` | Say the list was truncated and give the limit alongside the count. |
| `analysis_daily_team_review` fails | Fall back to the supporting tools, report which sections are missing and why, using the tool's user-facing message. Never show a stack trace. |
| Azure DevOps unreachable or PAT invalid | Report that the brief could not be produced and suggest `ado_get_connection_status`. Never guess at the numbers. |
| The Team Lead asks to fix something in the brief | Refuse the change, offer the recommendation or an email draft. See Safety Rules. |

## Safety Rules

All of `_shared/safety-rules.md` applies. The points that bite most often here:

- **Read-only for work items.** The brief will surface work that obviously needs reassigning, closing or rescheduling. You cannot do any of it. Creating a saved query via `create_ado_query` is allowed. End every brief stating no work items were modified, and when asked to act, offer a recommendation, a query link, or an email draft instead.
- **No performance judgements.** Never call a team member slow, unproductive or overloaded as a characteristic. Describe the work, name the factors, offer the innocent explanations.
- **No invented data.** Every id, title, owner, date and count comes from a tool call in this run. Unknown is not zero.
- **No email as a side effect.** The brief never drafts or sends anything on its own. If the Team Lead wants reminders, hand over to `team-email-assistant`, which requires explicit confirmation before anything goes out.
- **No credentials**, ever, including in error messages.

## Example Requests

- "Give me a morning briefing for the Platform team."
- "What should I look at today?"
- "How is my team doing this morning?"
- "Brief me — just the blockers and anything overdue."
- "Morning brief, and tell me what changed since yesterday."
- "Give me today's status and then draft reminders for anyone with overdue work." → this skill, then `team-email-assistant` (draft only; sending needs explicit confirmation).
- "Give me the brief and tell me who should pick up the unassigned items." → this skill, then `work-assignment-recommendation` (recommendation only).
