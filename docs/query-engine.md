# Query engine

S.H.E.R.L.O.C.K. queries Azure DevOps in two layers. Neither layer modifies **work items**.

Architecture overview: [ARCHITECTURE.md](ARCHITECTURE.md). Team folders: [CONFIGURATION.md](CONFIGURATION.md).

## 1. Read: `ado_query_work_items`

Structured filters and presets (`overdue`, `stale`, `missingDates`, `unassigned`, `highPriority`, `currentSprint`, and others) are compiled to WIQL by `WiqlBuilderService` and executed through the read-only WIQL POST allowlist.

Returns normalised work items, `totalCount` / `returnedCount`, `hasMore`, project, and timing. Use this (or a dedicated `ado_*` / `analysis_*` tool) to **measure** categories.

## 2. Save: `create_ado_query`

The **only** Azure DevOps write in V1. It:

1. Validates WIQL (`SELECT` only; mutation keywords rejected).
2. Optionally injects `columns` into the SELECT list (safe field reference names only).
3. Executes WIQL to obtain `resultCount`.
4. Stores the query under `parentPath`, which defaults to `My Queries/{ADO_TEAM}` (creates the leaf folder if `My Queries` exists).
5. If a query with the same name exists **in that team folder**, returns `QUERY_ALREADY_EXISTS` with `existingQueryUrl`, `savedQueryUrl`, `resultCount` — **reuse it**.
6. Otherwise creates a flat saved query (optional `queryDescription`) and returns `savedQueryUrl` plus `navigationUrl`.

Work items, users, teams, backlogs, sprints and field values are not modified.

### Typical arguments

| Argument | Purpose |
| --- | --- |
| `project` | Defaults to configured project if omitted |
| `queryName` | Short searchable title, e.g. `Overdue Work` (folder already isolates the team) |
| `queryDescription` | What / why / condition |
| `wiql` | SELECT-only WIQL using real field reference names |
| `columns` | Optional SELECT projection |
| `parentPath` | Optional folder. Defaults to `My Queries/{configured team}`. |

Azure DevOps saved queries created by S.H.E.R.L.O.C.K. are automatically organized by the configured team under `My Queries/{Team Name}`. This keeps queries isolated and manageable when the same project contains multiple teams.

Prefer `savedQueryUrl` in the response. Do not invent a query URL; use `NavigationEngine`.

## Workflow for skills

1. Fetch and group work items.
2. Count each category.
3. If count > 3, call `create_ado_query` once for that category.
4. Put the tool's URL in the queries table.

```text
Skill → Analysis → Query definition → create_ado_query → My Queries/{ADO_TEAM} → URL → Response
```

## Reuse and isolation

Reuse is scoped to organization + project + **team folder** + query identity. The same title in Platform and Development is two queries.

This server does **not** expose a list-queries tool. Duplicate avoidance is title-based inside the target folder. If the folder cannot be found or created, the tool returns `QUERY_FOLDER_NOT_FOUND`.

Legacy folders (`My Queries/KaarFlow`, etc.) are not deleted or auto-migrated.

## Navigation URLs

- Work item: `https://dev.azure.com/{organization}/{project}/_workitems/edit/{id}`
- Query: `https://dev.azure.com/{organization}/{project}/_queries/query/{queryId}`
- `navigationUrl` — dynamic WIQL URL. If it is too long, tell the user to use `savedQueryUrl`.

## MCP Inspector

Use `npm run inspector` and exercise overdue, missing dates, stale, unassigned, current sprint, and high-priority flows. Confirm counts, SELECT fields, `savedQueryUrl`, folder errors, and that no work-item PATCH occurs.
