# Changelog

## 1.0.0

- Renamed public product identity to S.H.E.R.L.O.C.K.
- Centralized required Azure DevOps configuration.
- Added S.H.E.R.L.O.C.K. health check and `npm run doctor`.
- Removed email functionality from the V1 executable MCP surface.
- Kept Azure DevOps work items read-only with controlled saved-query creation.
- Changed generated saved-query storage to `My Queries/{ADO_TEAM}`.
- Added public installation, configuration, security, skills, MCP client and troubleshooting docs.
- Expanded Git documentation: per-client MCP setup (Claude Desktop, Claude Code, Claude CLI, Cursor, Kiro, Inspector), architecture diagrams, and a documentation index under `docs/`.

Future V2 candidates include email workflows and non-Azure DevOps platform adapters.
