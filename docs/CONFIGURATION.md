# Configuration

All runtime settings go through `src/config/env.ts`. Application code should read `getConfig()`, not scatter `process.env` lookups.

`.env` is loaded from the repository root once. Values already present in the real process environment win (`override: false`), so an MCP client may inject env without editing `.env`.

## Create the file

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Never commit `.env`. Keep `.env.example` committed and secret-free.

## Required variables

| Variable | Purpose |
| --- | --- |
| `ADO_ORGANIZATION` | Azure DevOps organization slug |
| `ADO_PROJECT` | Project name |
| `ADO_TEAM` | Team name (exact match) |
| `ADO_PAT` | Personal Access Token |

Startup fails with a message like:

```text
S.H.E.R.L.O.C.K. configuration error:

ADO_PAT is missing.

Create a .env file from .env.example and provide your
Azure DevOps Personal Access Token.
```

The PAT value is never printed.

Typed access:

```text
config.ado.organization
config.ado.project
config.ado.team
config.ado.pat
```

## Optional variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADO_API_VERSION` | `7.1` | REST api-version query parameter |
| `SHERLOCK_ENV` | `development` | `development` \| `test` \| `production` |
| `LOG_LEVEL` | `info` | `silent` \| `error` \| `warn` \| `info` \| `debug` (stderr only) |
| `TOKEN_DEBUG` | `false` | Telemetry counts for API/token optimization |
| `DATABASE_URL` | `file:./data/sherlock.sqlite` | SQLite path, or `:memory:` |
| `CACHE_TTL_SECONDS` | `300` | Metadata cache TTL |

## Example `.env`

```env
ADO_ORGANIZATION=your_organization
ADO_PROJECT=your_project
ADO_TEAM=your_team
ADO_PAT=your_personal_access_token

SHERLOCK_ENV=development
LOG_LEVEL=info
TOKEN_DEBUG=false

DATABASE_URL=file:./data/sherlock.sqlite
CACHE_TTL_SECONDS=300
ADO_API_VERSION=7.1
```

`.env.example` may show `KEBS4KAAR` / `K4K` / `Platform` as **documentation examples**. Production source does not default to those values.

## Team, project, and organization independence

Skills, WIQL team scope, navigation URLs, and saved-query folders all follow `.env`.

| Change | Effect after MCP restart |
| --- | --- |
| `ADO_TEAM=Development` | Analyses the Development team; queries under `My Queries/Development` |
| `ADO_PROJECT=Payments` | All project-scoped REST and URLs use Payments |
| `ADO_ORGANIZATION=contoso` | Base URL becomes `https://dev.azure.com/contoso` |

No code change is required.

## Saved-query folders

Azure DevOps saved queries created by S.H.E.R.L.O.C.K. are automatically organized by the configured team under `My Queries/{Team Name}`. This keeps queries isolated and manageable when the same project contains multiple teams.

```text
ADO_TEAM=Platform      →  My Queries/Platform/
ADO_TEAM=Development   →  My Queries/Development/
ADO_TEAM=QA            →  My Queries/QA/
```

- Folders are created if missing (when the parent `My Queries` exists).
- Reuse is **within that team folder only**.
- Query titles stay human-readable (`Open Active Work`), without a redundant team prefix.
- Navigation URLs: `https://dev.azure.com/{organization}/{project}/_queries/query/{queryId}`
- Existing queries under old folders (`My Queries/KaarFlow`, etc.) are not deleted or moved.

## Database

| Setting | Behaviour |
| --- | --- |
| Default path | `data/sherlock.sqlite` |
| Created | On startup if missing |
| Git | `data/` and `*.sqlite` are ignored |
| Custom skills | Persist across restarts |
| Credentials | Must never appear in rows |

`DATABASE_URL=:memory:` is for tests.

## Logging and stdout

MCP stdio uses **stdout** for JSON-RPC. All logs go to **stderr**. `LOG_LEVEL=debug` is useful in Inspector, not in production Desktop configs unless you are diagnosing a spawn failure.

## Doctor

```bash
npm run doctor
```

Validates Node, `node_modules`, `.env`, required variables, Azure DevOps auth/project/team, SQLite, skills, and `dist/index.js`. Never prints the PAT.
