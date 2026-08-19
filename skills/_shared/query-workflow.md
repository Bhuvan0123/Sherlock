# Shared Query Workflow

Every analysis, briefing and report skill follows this pipeline. Skills do not invent a parallel query path.

```
FETCH → ANALYSE → GROUP → COUNT → IDENTIFY SIGNIFICANT CATEGORIES
      → CREATE ADO QUERY (count > 3) → RETURN QUERY URL
      → VISUALIZE → EXPLAIN INSIGHTS → RECOMMEND ACTIONS → SUPPORT TL DECISION
```

The final response must not dump dozens or hundreds of work items. It identifies meaningful categories, creates a saved Azure DevOps query for each significant category, and lets the Team Lead continue investigation in Azure DevOps.

## Central tool — the only query writer

All saved queries go through `create_ado_query`. Never construct a query URL by hand. Never claim a query was created unless the tool returned `success: true` or `QUERY_ALREADY_EXISTS` with `existingQueryUrl` / `savedQueryUrl`.

Read work items with `ado_query_work_items` (structured filters / presets) or the relevant `analysis_*` / `ado_*` tool. Discover real date field names with `ado_get_field_mapping` before writing WIQL that mentions planned or actual dates. Do not assume field names.

`create_ado_query` is allowed to create or reuse a **saved query**. It must never modify work items, users, teams, backlogs, sprints or field values.

## Count > 3 rule

Whenever a skill identifies a category of work items:

| Count | What to do |
| --- | --- |
| `> 3` | Create (or reuse) one saved Azure DevOps query for that category. Include the fields needed to investigate the category. Obtain the navigation URL from the tool. Show the query in the Azure DevOps Queries table. |
| `<= 3` | Do **not** create a saved query unless the category is strategically important (for example a single CRITICAL blocker that also has downstream dependents). List the affected items directly: `#id — "verbatim title"` (Type, State, Assignee). |

Do not create a query for every individual work item. Do not create a query for every team member unless the Team Lead asked for a member-specific query **or the skill is `daily-standup-starter`**, whose purpose is a per-member navigation table. Do not create a query when the count is 0.

## What counts as a category

A category is a meaningful group sharing one condition, for example:

- Closed User Stories without Tasks
- Active work without planned end date
- Completed work without actual end date
- Invalid date sequence
- Overdue work
- Due within 3 days
- Stale work (7 / 14 / 30+ days)
- Unassigned work
- Missing estimates
- High-priority overdue work
- Blocked work
- Orphaned Tasks / Features without User Stories / User Stories without Features
- Schedule variance above the tool's threshold
- A named risk category returned by an `analysis_*` tool

## Query reuse

There is **no saved-query discovery / list tool** on this server. Reuse is title-based:

1. Use a predictable title: `{Team} - {Short Category}` (Team Lead friendly, searchable). Example: `Platform - Overdue Work`.
2. Call `create_ado_query` with that title.
3. If the tool returns `QUERY_ALREADY_EXISTS`, reuse `existingQueryUrl` (or `savedQueryUrl`) and the `resultCount` when present. Do not create a second query with a timestamped or numbered name.
4. Always store queries in `My Queries/KaarFlow`. `create_ado_query` has no folder argument and always uses this path. If the tool returns `QUERY_FOLDER_NOT_FOUND`, report that the folder could not be used. Do not retry Shared Queries. Never invent a folder.
5. Pass `project` from a live tool result (`ado_get_connection_status`, `ado_query_work_items`, or the analysis envelope). Do not guess the project name.

Bad titles: `Query1`, `ADO Data`, `Generated Query`.

## Query description

Pass `queryDescription` when calling `create_ado_query`. It must explain (1) what the query contains, (2) why it was created, (3) the identifying condition.

Example: `All completed User Stories in the K4K Platform team that have no child Tasks. Created by KaarPulse backlog quality analysis for governance review.`

## Query fields (dynamic, from live mapping)

Before creating a query, decide which columns the Team Lead needs in Azure DevOps so they can continue without returning to Claude. Put those fields in the WIQL `SELECT` list, or pass them as `columns` to `create_ado_query`.

Call `ado_get_field_mapping` first. Only include planned/actual date fields that the mapping marks `available: true`. Never invent a reference name.

Minimum, where relevant and available:

- ID, Title, Work Item Type, State, Assigned To, Priority
- Story Points / Effort (the field that actually exists)
- Area Path, Iteration Path, Tags
- Created Date, Changed Date
- Planned Start, Planned End, Actual Start, Actual End (canonical names from the mapping)
- Parent (`System.Parent`) where supported

Purpose-specific sets:

| Purpose | Extra / emphasised fields |
| --- | --- |
| Missing dates | Planned Start/End, Actual Start/End, Changed Date, Area, Iteration |
| Overdue | Priority, Planned End, Actual End, Iteration, Changed Date |
| Workload | Assigned To, Effort / Story Points, Priority, Planned/Actual dates, Iteration |
| Stale work | Changed Date, Priority, Iteration, Planned End |
| Dependencies | Assigned To, Priority, Iteration, Parent, Planned End |

Do not request fields that are not available. WIQL cannot project relation rows; for dependency categories, still create the query on the item set, and show blocker → downstream in the skill output using `ado_get_related_work_items` / analysis tools.

## Tool arguments

```
create_ado_query:
  project          — from live tool output (required by the tool; use the configured project)
  queryName        — "Platform - <Category>"
  queryDescription — what / why / condition
  wiql             — SELECT-only WIQL using real field reference names
  columns          — optional extra SELECT columns (reference names only)
  (no folder argument — always "My Queries/KaarFlow")
```

WIQL must be a single SELECT. It cannot update work items. If `create_ado_query` returns `INVALID_WIQL`, still present the analysis and say the query could not be created. Never fabricate a URL.

Prefer `savedQueryUrl` in the response. Fall back to `navigationUrl` only if `savedQueryUrl` is absent. If `navigationUrlWarning` is set, tell the Team Lead to use the saved query link.

## Response table (required whenever any query was created or reused)

```markdown
## 🔎 Azure DevOps Queries

| Title | Description | Count | Navigate |
|---|---|---:|---|
| Platform - Missing Planned End Dates | Active work items without planned completion date | 8 | [🔗 Open Query](SAVED_QUERY_URL) |
```

Show only queries the MCP actually created or reused. Never fake a URL. Internally retain title, description, condition, count, fields, project, team and URL; the table must expose at least Title, Description, Count and the real link.

## Visual category summary

When several categories have counts, add a compact distribution (only with real counts):

```markdown
## 🔎 Issue Distribution

Missing Planned Dates  ████████████████ 8 🔴
Missing Estimates      ████████         4 🟠
Unassigned             ███              2 🟡
```

Scale bars relative to the largest count in *this* response. Never invent percentages. A percentage is allowed only when both numerator and denominator were measured.

## Insights and recommendations

Do not repeat "there are 8 missing dates." Explain significance:

> 8 work items lack planned completion dates, representing 25% of active work (8 of 32). This reduces the reliability of deadline forecasting.

Each recommendation answers what, why, expected impact, when, and points at evidence:

```markdown
### 🔴 Review Missing Planned Dates

**Action:** Update planned completion dates for the 8 active work items.
**Why:** Current schedule forecasting is incomplete.
**Impact:** Improves deadline and sprint-risk visibility.
**When:** Before next sprint planning.
**Evidence:** [🔗 Open Query](SAVED_QUERY_URL)
**Confidence:** High
```

KaarPulse cannot apply the recommendation. The Team Lead makes the change in Azure DevOps.

## Source footer

Every major skill output ends with:

```
**Source:** Live Azure DevOps
**Project:** <from tool>
**Team:** <from tool>
**ADO Work Items Modified:** No
```
