---
name: daily-standup-starter
title: Daily Standup Starter
description: Produce a short standup view of each Platform member's open and active work, with counts and a saved Azure DevOps query link so the Team Lead can open that person's board in one click.
version: 2.0.0
category: briefing
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_daily_team_review
  - analysis_team_workload
supporting_tools:
  - ado_get_team_members
  - ado_get_work_item_types
  - ado_get_field_mapping
  - ado_query_work_items
  - ado_get_work_items_by_assignee
  - analysis_assignment_recommendation
  - create_ado_query
missing_capabilities:
  - "Azure DevOps holds no leave or availability calendar, so this skill cannot know if a member with zero open items is out of office."
  - "There is no saved-query discovery tool. Equivalent member queries are reused only when create_ado_query returns QUERY_ALREADY_EXISTS for the same predictable title."
triggers:
  - daily meet starter
  - prepare my daily standup
  - standup prep
  - what is the team doing today
  - standup starter
---

# Daily Standup Starter

## Purpose

Give the Team Lead a standup-ready table of **who is carrying open/active work right now**, how many items each person has, and a clickable Azure DevOps query that already contains the columns needed to run the meeting (id, title, type, state, dates, iteration, priority, effort).

Do not dump every work item into chat. The table is the briefing; the query is where the Team Lead inspects the work.

## When to Use

Use immediately before or during the daily stand-up. Typical phrasing is in the `triggers` list.

Use a different skill when:
- the Team Lead wants a keepable full daily document → `daily-team-report`
- the Team Lead wants personal morning triage → `team-morning-brief`
- the question is only sprint trajectory → `sprint-health-analysis`

## Required Inputs

None. Organization, project and team come from server configuration.

Optional: "include assignment recommendations" — after the member table, suggest owners for unassigned items via `analysis_assignment_recommendation` (recommendation only).

## Data Sources

All facts come from KaarPulse MCP tools.

- `analysis_daily_team_review` / `analysis_team_workload` — roster-aligned open, active, blocked, overdue counts per member.
- `ado_get_team_members` — every member must appear, including those with zero items.
- `ado_get_work_item_types` — real completed vs in-progress state names (do not assume "Active" / "Closed").
- `ado_get_field_mapping` — which planned/actual date fields exist before building WIQL.
- `ado_query_work_items` with `assignedTo` and open-state filters — corroborate counts.
- `create_ado_query` — one saved query **per member who has at least one open/active item**. This skill is explicitly member-navigation; that is the exception to "no per-member queries".
- `analysis_assignment_recommendation` — only if the Team Lead asked who should take unassigned work.

## Workflow

1. **Call `ado_get_team_members` and `analysis_team_workload`.** Reconcile so every roster member has a row. Prefer workload open/active counts as the measured base; corroborate with `analysis_daily_team_review` when already loaded.
2. **Call `ado_get_work_item_types`.** Collect state names whose `stateCategory` is not `Completed`, `Resolved`, or `Removed`. Those are **open and active** for this process. Never hard-code Closed/Done.
3. **Call `ado_get_field_mapping`.** Record available planned/actual date reference names for the query columns.
4. **For each member, determine the open/active count** (Proposed + InProgress; exclude completed/removed). If two tools disagree, name both and do not silently pick one.
5. **Create a member query when count >= 1** via `create_ado_query` only. Title: `Platform - {Member display name} - Open Active Work`. Description must say it is that member's open/active Platform work for standup. WIQL: assigned to that identity **and** state in the open-state list from step 2. Pass `columns` listed in Analysis Rules. Queries are stored in `My Queries/KaarFlow`. On `QUERY_ALREADY_EXISTS`, reuse `existingQueryUrl` / `savedQueryUrl` and `resultCount`.
6. **Members with count 0:** no query. Show `0` and `—` in Navigate. Flag them as idle/available, not as a performance judgement.
7. **Team-level extras:** if blocked or overdue sets have **count > 3**, create those queries too (`Platform - Blocked Work`, `Platform - Overdue Work`) per `_shared/query-workflow.md`. If count <= 3, list the items.
8. **Keep the spoken briefing short.** The table plus blockers is the standup. Do not paste every work-item title into chat when a query exists.
9. **Close stating no work items were modified.** Query links are the only Azure DevOps writes.

## Analysis Rules

**Open and active** means `stateCategory` is `Proposed` or `InProgress` (or the process equivalent). Completed, Resolved and Removed are excluded. Use type catalogue states in WIQL, not invented names.

**Per-member queries are required for this skill** whenever the member has 1 or more open/active items, even if count <= 3, because the standup table is a navigation surface. Idle members (0) still get no query.

**Query columns (workload set).** Pass these as `columns` on `create_ado_query` (omit any date field `ado_get_field_mapping` marks unavailable):

- `System.Id`
- `System.Title`
- `System.WorkItemType`
- `System.State`
- `System.AssignedTo`
- `Microsoft.VSTS.Common.Priority`
- `Microsoft.VSTS.Scheduling.StoryPoints` or `Microsoft.VSTS.Scheduling.Effort` or `Microsoft.VSTS.Scheduling.OriginalEstimate` (whichever exists)
- `System.IterationPath`
- `System.AreaPath`
- `System.Tags`
- `System.ChangedDate`
- Planned Start / Planned End / Actual Start / Actual End from the mapping
- `System.Parent` if the process supports it

Do not invent reference names. WIQL must be SELECT-only.

**Idle.** Zero open/active items means available for assignment in standup, not "unproductive".

**No dump.** Chat shows counts and links. Opening the query is how the team sees the items.

## Output Format

Follow `_shared/output-format.md`. Standup-specific structure:

1. **Header**: `# 🌅 Daily Standup Starter`
2. **Executive summary**: one line (sprint name if known, how many people have open work, idle count).
3. **👥 Team members — open / active work** (required):

| Member | Open / active items | Navigate |
|---|---:|---|
| Arun | 6 | [🔗 Open query](SAVED_QUERY_URL) |
| Priya | 0 | — |

`Navigate` must be a markdown link to the URL returned by `create_ado_query` (`savedQueryUrl` preferred, else `existingQueryUrl`, else `navigationUrl`). Never construct a URL. Never use a placeholder.

4. **🚨 Blockers / overdue** — short bullets; query if count > 3, else list up to three ids.
5. **🎯 Assignment notes** — only if asked, or if there are idle members **and** unassigned items. Recommendation only.
6. Footer: **ADO Work Items Modified: No**

## Edge Cases

| Situation | What to do |
| --- | --- |
| Member has 0 open/active items | Row with `0` and `—`. No `create_ado_query`. Label idle/available. |
| Member has 1–3 items | Still create the member query (standup navigation exception). Count in the table; do not dump titles unless the query fails. |
| `create_ado_query` returns `QUERY_ALREADY_EXISTS` | Reuse the URL and count. Do not create `… Open Active Work 2`. |
| `QUERY_FOLDER_NOT_FOUND` / `INVALID_WIQL` | Keep the count. Navigate = `—`. Say the query could not be created. Never fabricate a link. |
| Display name vs unique name | Use the identity string Azure DevOps returns (`assignedTo`). If WIQL fails on display name, retry with uniqueName/email from `ado_get_team_members` if present. |
| No current sprint | Still build the member table from all open/active work. Say no iteration is current. |
| Empty roster | Say so. No table rows invented. |
| Counts from workload vs query differ | Show both, name the tools, use the query `resultCount` in the Navigate row when a query was created. |
| Team Lead asks to assign work | Refuse the write. Offer the query link and `work-assignment-recommendation` or `team-email-assistant`. |
| Azure DevOps unreachable | Suggest `ado_get_connection_status`. No invented counts or URLs. |

## Safety Rules

All of `_shared/safety-rules.md` applies.

- Work items are read-only. KaarPulse cannot assign work during standup.
- Saved queries via `create_ado_query` are allowed. Never invent a query URL.
- No performance judgements. Idle means capacity, not a character assessment.
- No invented data. Names, counts and links come from tools in this run.

## Example Requests

- "Daily meet starter please"
- "Prepare my daily standup"
- "What is the team doing today? Any idle members?"
- "Standup prep — I need a query per person for their active work"
