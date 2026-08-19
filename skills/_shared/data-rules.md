# Shared Data Rules

These rules apply to every KaarPulse skill. A skill may add stricter rules of its own, but may never relax these.

## Azure DevOps is the source of truth

Every factual statement about the project, the team, a sprint or a work item must come from a KaarPulse MCP tool call made during the current request. Do not answer from memory, from an earlier conversation, or from what a work item "probably" says.

If you have not called a tool, you do not know the answer.

## Never fabricate a value

Do not invent, estimate, extrapolate or round a value that a tool did not return. This includes work-item ids, titles, assignees, states, priorities, due dates, story points, remaining hours, sprint names, capacity and velocity.

If a needed value is absent, say it is absent. "Story points are not set on 6 of the 14 sprint items" is a useful finding. Inventing the points is a defect.

## Unknown is not zero

These three cases are different and must be reported differently:

| Situation | How to report it |
| --- | --- |
| The tool returned `0` | "0 overdue items" |
| The tool returned `null` or omitted the field | "not set" or "unknown" |
| The tool could not run, or the field does not exist in this process | "could not be measured, because …" |

For example, `ado_get_work_items_due_today` returns `dueDateField: null` with an explanatory `note` when the process defines no due-date field. That is *not* "nothing is due today" — it means due dates cannot be measured at all, and you must say so.

## Preserve identifiers exactly

- Work item ids are integers and must be reproduced exactly, prefixed with `#` (for example `#1234`).
- Work item titles must be quoted verbatim. Do not paraphrase, shorten, correct spelling, or translate. If a title is very long, truncate visibly with an ellipsis and keep the id.
- Assignee names must be the `assignedTo` display name exactly as Azure DevOps returned it. Never guess an assignee from context, an area path, or who commented.
- States, priorities, tags, area paths and iteration paths must be the literal values returned.

## Respect the configured scope

The server is bound to one organization, project and team, resolved from configuration (`KEBS4KAAR` / `K4K` / `Platform` by default). Do not pass an organization, project or team argument unless the Team Lead explicitly asks about a different team, and only where the tool accepts a `team` parameter.

Most work-item tools are already restricted to the team's area paths. Where a tool exposes `team_scoped`, leave it at the default unless the Team Lead has asked for a project-wide view, and state clearly which scope produced the numbers.

## Respect the selected iteration

Sprint-scoped tools accept `"current"` (default), `"next"`, `"previous"`, or an iteration name, path or id. When the Team Lead does not name a sprint, use the current one and say which sprint that resolved to. Never assume a sprint name.

If `ado_get_current_sprint` returns `currentSprint: null`, no iteration is marked current. Report that, and do not silently substitute another sprint.

## Use real states and categories, not assumptions

K4K may define custom state names. Do not assume "Active" or "Closed" exist. Work items carry both `state` (the literal name) and `stateCategory` (`Proposed`, `InProgress`, `Resolved`, `Completed` or `Removed`).

- Use `stateCategory` when you need to reason about whether work is done or in flight.
- Use `state` when you display the value to the Team Lead.
- Call `ado_get_work_item_types` when you need the exact state names this process defines, for example before filtering with `ado_get_work_items_by_state`.

## Use real priority values

Azure DevOps priority 1 is the *highest*. Priority may be unset. `ado_get_high_priority_items` defaults to priority 1 and 2. Do not describe an item as high priority unless its `priority` value says so.

## Handle limits and truncation honestly

Most list tools accept a `limit` and apply a default (commonly 200; the tool description states it). If a result reaches the limit, the list is truncated and you must say so rather than presenting it as complete: "the 200 most recent matches (the result was truncated)".

Dependency and blocked-work analysis scans a bounded number of items and reports its coverage. Pass that coverage on when it matters to the conclusion.

## Handle duplicates

The same work item can legitimately appear in several buckets — an item can be overdue *and* blocked *and* high priority. Count each work item once per section, deduplicate by id when merging lists from different tools, and never add counts from two tools together to produce a total. If you need a total, derive it from a deduplicated set of ids and say how you derived it.

## Handle missing fields

Fields commonly absent in real projects: due date, story points, remaining work, priority, area path detail, and email address on an identity. Treat every one as optional. When a calculation depends on a missing field, either exclude the item and report how many were excluded, or report the metric as unavailable. Never substitute a default.

Call `ado_get_field_mapping` before writing WIQL that mentions planned or actual dates. Only use field reference names the mapping (or `ado_get_work_item_fields`) shows exist.

## Saved query URLs are measured too

A query navigation link is a fact. It may only appear when `create_ado_query` returned `savedQueryUrl`, `navigationUrl` or `existingQueryUrl`. Never construct `https://dev.azure.com/.../_queries/...` from an id you did not receive.

## Handle completed and removed work correctly

- Open-work tools exclude completed items by default; several accept `include_completed`.
- Items in the `Removed` category are not completed work. Never count them as delivered.
- A closed item can be reopened. `analysis_team_delivery_metrics` detects reopened items; do not treat a reopen as a new completion.

## Pagination and batching

Batch lookups (`ado_get_work_items`) accept up to 200 ids per call and silently omit ids that do not exist or are not visible. Compare `requested` against `returned` and mention any gap rather than assuming every id resolved.

## Prefer the composite tool

When a single tool already assembles what you need — `analysis_daily_team_review`, `analysis_project`, `tl_get_weekly_review` — call it instead of reconstructing the same picture from a dozen primitive reads. It is faster, cheaper, internally consistent, and its thresholds are documented. Use primitive `ado_*` reads to drill into specifics the composite tool does not carry.
