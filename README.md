# S.H.E.R.L.O.C.K.

Sprint Health, Execution, Risk, Logistics, Operations & Coordination Knowledge

## What Is S.H.E.R.L.O.C.K.?

S.H.E.R.L.O.C.K. is an MCP server for Azure DevOps team intelligence. It reads the configured organization, project and team, runs sprint/backlog/workload/risk analysis, creates recommendations, and can create or reuse controlled Azure DevOps saved queries for evidence.

## Key Features

- Azure DevOps sprint, backlog, deadline, dependency, workload and project-health analysis.
- Built-in skills plus persisted custom skills with `brief`, `verbose` and `visual` modes.
- Azure DevOps work-item read-only security with controlled saved-query creation.
- Team-scoped saved queries under `My Queries/{ADO_TEAM}`.
- Local SQLite persistence for audit activity and custom skills.
- Health check and `npm run doctor` diagnostics.

## Architecture

MCP clients call the MCP tool layer, which routes into the Skill Executor, Analysis Module Registry, Data Aggregator, Cache Manager, Query Engine, Navigation Engine, Recommendation Engine and Azure DevOps layer. See `docs/ARCHITECTURE.md`.

## Requirements

- Node.js 22.5 or newer.
- An Azure DevOps organization, project and team.
- An Azure DevOps PAT with the minimum read/query permissions needed by your enabled workflows.

## Installation

```bash
npm install
cp .env.example .env
npm run doctor
npm run build
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

## Configuration

Edit `.env`:

```env
ADO_ORGANIZATION=your_organization
ADO_PROJECT=your_project
ADO_TEAM=your_team
ADO_PAT=your_personal_access_token
SHERLOCK_ENV=development
LOG_LEVEL=info
TOKEN_DEBUG=false
```

The sample values in `.env.example` are examples only. Runtime source code does not hardcode an organization, project or team.

## Azure DevOps PAT

Never commit `.env` or paste a PAT into chat, docs, query names or tool inputs. S.H.E.R.L.O.C.K. masks known credentials in logs and tool responses and never stores the PAT in SQLite.

## Running The MCP

```bash
npm run build
npm run start
```

## Claude Code Setup

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "node",
      "args": ["/absolute/path/to/sherlock/dist/index.js"]
    }
  }
}
```

## Claude Desktop Setup

Add the same `mcpServers.sherlock` block to your Claude Desktop MCP configuration file, using an absolute path to `dist/index.js`.

## Cursor Setup

Add the same server block to your Cursor MCP configuration, or run from this repository with `npm run inspector` for local validation.

## Kiro Setup

Configure an MCP server named `sherlock` with command `node` and args pointing to `/absolute/path/to/sherlock/dist/index.js`.

## MCP Inspector

```bash
npm run build
npm run inspector
```

Verify `sherlock_health_check`, `skill_execute`, custom skill tools, ADO reads and `create_ado_query`.

## Available Skills

Core skills include `daily-standup-starter`, `team-morning-brief`, `sprint-health-analysis`, `project-health-analysis`, `workload-analysis`, `deadline-risk-analysis`, `dependency-analysis`, `backlog-data-quality`, `stale-work-analysis`, `delivery-forecast`, `weekly-team-review` and `work-assignment-recommendation`.

## Custom Skills

Use the custom skill tools to create, preview, confirm, save, list, update, duplicate, enable, disable, remove, compose and execute custom skills. Custom skills remain organization/project/team independent and support `brief`, `verbose` and `visual`.

## Security Model

S.H.E.R.L.O.C.K. v1 does not create, update, delete, assign or modify Azure DevOps work items. It can read Azure DevOps data, execute WIQL, create/reuse controlled saved queries, perform analysis, create recommendations and manage local custom skills.

Generated saved queries are stored under `My Queries/{ADO_TEAM}`. Changing `ADO_TEAM=Development` stores/reuses queries under `My Queries/Development`.

## Troubleshooting

Run `npm run doctor` first. Common issues are missing PAT, invalid PAT, inaccessible organization/project, team not found, stale MCP process, unrebuilt `dist`, SQLite path problems and MCP Inspector config mistakes.

## Development

```bash
npm run build
npm run test
npx vitest run
```

Live Azure DevOps verification should be opt-in and must not be required in CI.

## Roadmap

V1 is focused on Azure DevOps, team/sprint intelligence, read-only work-item analysis, controlled query creation, custom skills and MCP. Email and additional platform adapters may be considered for a future V2.

## License

No license file is currently included. A license decision is required before public distribution.
