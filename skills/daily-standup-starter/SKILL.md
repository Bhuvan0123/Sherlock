---
name: daily-standup-starter
title: Daily Standup Starter
description: Produce a very short, targeted summary for the daily meeting - focusing on what the team is working on, idle members, and immediate sprint health/risks.
version: 1.0.0
category: briefing
mutates_azure_devops: false
requires_confirmation: false
primary_tools:
  - analysis_daily_team_review
supporting_tools:
  - analysis_assignment_recommendation
missing_capabilities:
  - "Azure DevOps holds no leave or availability calendar, so this skill cannot know if an idle member is actually out of office today."
triggers:
  - daily meet starter
  - prepare my daily standup
  - standup prep
  - what is the team doing today
  - standup starter
---

# Daily Standup Starter

## Purpose

Provide a very short, highly actionable summary tailored for a daily stand-up meeting. This skill quickly identifies what the team is working on, surfaces idle or under-allocated members for immediate work assignment, and flags immediate sprint health risks, delays, or ad-hoc activities. It is designed to be read out or referenced live during the meeting.

## When to Use

Use this skill immediately before or during a daily stand-up meeting. Typical triggers are in the `triggers` list: "prepare my daily standup", "daily meet starter".

Use a different skill when:
- the Team Lead wants a detailed, forwarded report → `daily-team-report`
- the Team Lead is doing personal triage first thing in the morning → `team-morning-brief`
- the Team Lead only wants to look at sprint trajectory → `sprint-health-analysis`

## Required Inputs

None. The organization, project and team are fixed by server configuration and must not be passed.

Optional, if the Team Lead supplies them:

| Input | Effect |
| --- | --- |
| "Include recommendations" | Run the analysis and append assignment recommendations for the idle members. |

## Data Sources

All data comes from KaarPulse MCP tools. 

**Primary:**
- `analysis_daily_team_review` — returns sprint context, workload, unassigned work, blocked work, and project health.

**Supporting:**
- `analysis_assignment_recommendation` — if the Team Lead specifically asks who to assign unassigned items to.

## Workflow

1. **Call `analysis_daily_team_review`.** This gathers all the sprint context, workload, and blocker facts in one pass.
2. **Read the envelope.** Keep measured facts apart from generated observations. Note the methodology.
3. **Build Today's Plan.** Review the `workload` from facts. List what each team member is working on. Explicitly flag any member who has zero active or assigned items as "Idle".
4. **Identify Sprint Health & Risks.** Pull `blockedWork`, `overdueWork`, and `sprintContext`. Highlight delays or ad-hoc (unplanned/high-priority) activities.
5. **Formulate Recommendations.** Recommend assigning specific unassigned items to the idle members based on the review.
6. **Keep it short.** Output must be concise enough to scan during a stand-up. 
7. **Close with the read-only statement.**

## Analysis Rules

**Idle Members.** Anyone with 0 active items is flagged as "Idle/No Active Work". Do not assume they are bad or unproductive; just state they are available for work assignment.

**Sprint Health.** Focus only on actionable delays (blocked items, overdue) and unplanned work (e.g., ad-hoc bugs added mid-sprint).

## Output Format

Follow the KaarPulse Dashboard UI schema defined in `_shared/output-format.md`.
Use the templates from `_shared/templates/` to construct the response.

**Specific structure for Daily Standup Starter:**
1. **Header**: `# 🌅 Daily Standup Starter`
2. **📌 Today's Plan (Who is doing what)**:
   - A short bulleted list by team member summarizing their active items.
   - **Idle Members**: Call out members with no active work clearly (e.g. `⚠️ Priya: Idle (0 active items)`).
3. **🎯 Assignment Recommendations**: Direct recommendations on what to assign to idle members from the unassigned backlog.
4. **🚨 Sprint Health & Blockers**: Bullet points highlighting risks, delays, or ad-hoc activities affecting the sprint.

Ensure you state: "No Azure DevOps changes were made. KaarPulse is read-only for Azure DevOps."

## Edge Cases

| Situation | What to do |
| --- | --- |
| No one is idle | Celebrate it briefly and skip the Assignment Recommendations section. |
| Everything is blocked | Make that the primary focus of the standup starter. |
| No sprint is active | Note that no sprint is active and focus purely on the active items. |
| The Team Lead asks to assign work | Remind them KaarPulse is read-only. Offer to draft an email instead. |
| The audit trail is empty | Not relevant for this skill as it relies on live Azure DevOps data. |
| `analysis_daily_team_review` fails | Fall back to individual tools or report the failure cleanly. |
| Azure DevOps unreachable | Report that the starter could not be produced and suggest `ado_get_connection_status`. |

## Safety Rules

All of `_shared/safety-rules.md` applies. 
- **Read-only.** KaarPulse cannot assign work. It only recommends assignments. 
- **No performance judgements.** Never call a team member lazy. Idle just means "has capacity".
- **No invented data.** Every id, title, owner, date and count comes from a tool call in this run. 

## Example Requests

- "Daily meet starter please"
- "Prepare my daily standup"
- "What is the team doing today? Any idle members?"
- "Standup prep"
