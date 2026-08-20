# Security

S.H.E.R.L.O.C.K. v1 is **Azure DevOps work-item read-only with controlled saved-query creation.**

That wording is intentional. The server is not “completely read-only” because it can create or reuse saved Boards queries.

## Forbidden

The server must not, and the tool surface is audited so it cannot:

- create work items
- update work items
- delete work items
- assign work items
- change work-item state
- change work-item fields (priority, area, iteration, tags, comments, …)
- modify backlogs, sprints, repos, pipelines, or permissions

When a user asks for a work-item change, the assistant should say work items are read-only and offer analysis or a recommendation instead.

## Allowed

- Read Azure DevOps project, team, sprint, and work-item data
- Execute SELECT-only WIQL (POST to the WIQL endpoint is an Azure DevOps **read** API)
- Create or reuse saved queries under `My Queries/{ADO_TEAM}`
- Run analysis and recommendations
- Manage **local** custom skills in SQLite
- Record redacted audit rows

The only registered MCP tool with `readOnly: false` is `create_ado_query`.

## PAT handling

| Rule | Detail |
| --- | --- |
| Source | `.env` or process env (`ADO_PAT`) |
| Logs | Redacted |
| MCP responses | Redacted |
| Errors | Redacted |
| SQLite | Not stored |
| Telemetry | Counts only, no token |
| Health / doctor | “PAT configured”, never the value |
| Query names | Must not include the PAT |

`src/utils/redact.ts` masks known secrets and credential-shaped strings.

Never paste a live PAT into README, issues, chat, or committed MCP JSON.

## Minimum PAT scopes (from actual usage)

Do not grant organization-wide Full Access.

Observed API usage:

| Capability | Why | Suggested PAT area |
| --- | --- | --- |
| Projects, teams, members, iterations, backlogs | Reads | **Project and Team: Read** |
| Work items, comments, updates, relations | Reads | **Work Items: Read** |
| WIQL | Read query | **Work Items: Read** |
| Saved query GET/POST under My Queries | Controlled write | **Work Items: Read & write** (or the Query permission your org uses for saving queries in My Queries) |

If you only want analysis and never saved queries, a **read-only** work-item PAT is enough; `create_ado_query` and skill query creation will fail with a permission error.

This document does not invent extra scopes (Analytics, Graph, Code, Pipelines) that V1 does not call.

## Local data

- Default DB: `data/sherlock.sqlite`
- Audit summaries are truncated and redacted
- Custom skill JSON is module lists and flags, not credentials
- `.gitignore` excludes `.env`, `data/`, `*.sqlite`, `dist/`, `node_modules/`, logs, coverage

## Git history

If a PAT was ever committed, **do not** rewrite history from this guide automatically. Rotate the PAT in Azure DevOps and treat the old token as compromised.

## Email

V1 has **no** email tools, Graph credentials, or send path. Email is a possible V2 feature only ([CHANGELOG.md](../CHANGELOG.md) / README roadmap).
