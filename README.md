# KaarPulse MCP (Team Lead Decision Support)

KaarPulse is an intelligent Model Context Protocol (MCP) server that transforms Azure DevOps data into a Team Lead Decision-Support assistant. It is strictly read-only and designed to help Team Leads quickly understand sprint health, workload, blockages, and productivity.

## Configuration & Setup

1. Copy `.env.example` to `.env`.
2. Configure your strictly read-only Azure DevOps PAT (`ADO_PAT`), Organization (`ADO_ORGANIZATION`), Project (`ADO_PROJECT`), and Team (`ADO_TEAM`).
3. (Optional) Configure Microsoft Graph email credentials (`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `EMAIL_SENDER`) if you intend to use the email sending features.

> [!WARNING]
> KaarPulse is **read-only** for Azure DevOps. It cannot create, edit, reassign, or delete work items. Any recommendations it provides must be executed manually by the Team Lead. 

## KaarPulse Skills Directory

The assistant uses 13 defined "Skills" that govern its workflow.

### Briefing & Reporting
- **`daily-standup-starter`**: A very brief, targeted summary designed specifically for the daily stand-up meeting. Identifies who is working on what, who is idle, and immediate sprint risks.
- **`team-morning-brief`**: The Team Lead's prioritized morning triage — what needs attention today, overdue/blocked work, and workload.
- **`daily-team-report`**: A comprehensive daily report intended to be kept, forwarded, or pasted into status updates.
- **`weekly-team-review`**: A full review of the past working week, capturing what was completed, carried over, recurring blockers, and assistant activity.

### Analysis & Recommendations
- **`project-health-analysis`**: An overarching review of the backlog, delivery picture, and project health.
- **`sprint-health-analysis`**: A deep-dive into the current sprint's trajectory and risk of missing the sprint goal.
- **`workload-analysis`**: Understands how work is distributed across the team and identifies imbalances.
- **`deadline-risk-analysis`**: Focuses purely on what work is overdue or at risk of missing deadlines.
- **`work-assignment-recommendation`**: Diagnoses the backlog and recommends who should pick up unassigned items.
- **`team-productivity-review`**: Evaluates team delivery and productivity trends over the last few sprints.
- **`tl-productivity-review`**: Analyzes the Team Lead's own management activity by reading the local assistant audit trail.

### Actions & Routing
- **`team-email-assistant`**: Safely drafts emails for the team. Contains strict built-in protocols that require explicit user confirmation before any email is actually sent.
- **`skill-index`**: The master router that helps the assistant pick the right skill for your prompt and combines skills for compound requests.

## KaarPulse Tools Index

The skills are powered by an extensive suite of low-level MCP tools exposed by the server. 

### Azure DevOps Tools (`ado_*`)
Raw read operations from the Azure DevOps API.
- **Work Item Queries**: `ado_get_work_item`, `ado_get_work_items`, `ado_search_work_items`, `ado_get_work_items_by_type`, `ado_get_work_items_by_state`, `ado_get_work_items_by_assignee`, `ado_get_work_items_by_sprint`.
- **Status Queries**: `ado_get_work_items_due_today`, `ado_get_work_items_due_this_week`, `ado_get_overdue_items`, `ado_get_blocked_items`, `ado_get_unassigned_items`, `ado_get_high_priority_items`, `ado_get_recently_changed_items`.
- **Project/Sprint Data**: `ado_get_project_overview`, `ado_get_team_members`, `ado_get_team_iterations`, `ado_get_current_sprint`, `ado_get_sprint_progress`.
- **Context**: `ado_get_work_item_comments`, `ado_get_connection_status`.

### Analysis Tools (`analysis_*`)
Tools that perform aggregations, calculations, and generate actionable insights from the ADO data.
- **Health & Delivery**: `analysis_project_health`, `analysis_project`, `analysis_team_productivity`, `analysis_team_delivery_metrics`.
- **Risk & Dependencies**: `analysis_deadline_risk`, `analysis_at_risk_items`, `analysis_deadlines`, `analysis_blocked_items`, `analysis_dependencies`, `analysis_cross_team_dependencies`, `analysis_items_blocking_release`, `analysis_critical_dependencies`.
- **Workload & Team**: `analysis_team_workload`, `analysis_work_distribution`, `analysis_available_team_members`, `analysis_member_workload`, `analysis_member_work`, `analysis_member_completed_work`, `analysis_member_sprint_history`.
- **Aggregations**: `analysis_daily_team_review`, `analysis_assignment_recommendation`, `analysis_assignment_recommendations`.

### Email Tools (`email_*`)
Tools mapping to Microsoft Graph for communication.
- **Config & Contacts**: `email_get_team_contacts`, `email_get_configuration`.
- **Drafting**: `email_draft`, `email_draft_deadline_reminder`, `email_draft_overdue_work`, `email_draft_daily_team_summary`.
- **Management**: `email_list_drafts`, `email_cancel_draft`, `email_send_confirmed`, `email_get_send_log`.

### Team Lead Activity Tools (`tl_*`)
Tools that read from the local SQLite audit log to track the TL's assistant usage.
- `tl_get_activity`, `tl_get_activity_summary`, `tl_analyze_activity`, `tl_analyze_productivity`, `tl_analyze_work_management`, `tl_get_weekly_review`, `tl_purge_activity`.

### Skills Catalog Tools (`skill_*`)
- `skill_list` (list available workflows) and `skill_get` (load a specific skill's instructions).
