# Security

S.H.E.R.L.O.C.K. v1 does not create work items, update work items, delete work items, assign work items, change work-item state or modify work-item fields.

It can read Azure DevOps data, execute WIQL, create/reuse controlled saved queries, perform analysis, create recommendations and manage local custom skills.

The Azure DevOps PAT is loaded from environment configuration only. It is not stored in SQLite, telemetry, query names, errors, logs or MCP tool responses. Use the minimum Azure DevOps PAT permissions needed for work item/project/team reads, WIQL execution and saved-query creation in your organization.

The repository ignores `.env`, runtime databases, logs, coverage and build output.
