# Installation

This guide walks through a first-time install of S.H.E.R.L.O.C.K. on Windows, macOS, and Linux.

When this is finished you will have:

1. A cloned repository
2. Dependencies installed
3. A local `.env` with your Azure DevOps organization, project, team, and PAT
4. A successful `npm run doctor` (configuration and Node checks)
5. A built `dist/index.js` MCP entrypoint
6. A client (Claude, Cursor, or Kiro) connected to the server

Connecting the MCP client is covered in [MCP-CLIENTS.md](./MCP-CLIENTS.md). Configuration details are in [CONFIGURATION.md](./CONFIGURATION.md).

## What you are installing

S.H.E.R.L.O.C.K. is a **local stdio MCP server**. It is not a website and not a hosted SaaS API.

- Your MCP client (Claude Desktop, Claude Code, Cursor, Kiro) starts `node dist/index.js`.
- The process talks JSON-RPC on stdin/stdout.
- Logs go to stderr.
- Azure DevOps is called over HTTPS using the PAT in `.env`.
- Local state (audit trail + custom skills) is stored under `data/` as SQLite.

You never need to expose a port for V1.

## Requirements


| Requirement  | Details                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Node.js      | **22.5.0 or newer** (`package.json` `engines.node`)                                                     |
| npm          | Ships with Node.js                                                                                      |
| Git          | To clone the repository                                                                                 |
| Azure DevOps | An organization, a project, and a **team** you can read                                                 |
| PAT          | Personal Access Token with work-item / project / team read, plus query create if you want saved queries |
| Disk         | Write access so `data/` can be created for SQLite                                                       |


Check Node:

```bash
node -v
npm -v
```

If Node is older than 22.5, install a current LTS from [nodejs.org](https://nodejs.org/) or use `nvm` / `fnm` / `nvs`.

On Windows, Git Bash, PowerShell, and Command Prompt all work. PowerShell examples are given where syntax differs.

## 1. Clone the repository

Replace the URL with your Git remote.

```bash
git clone https://github.com/<owner>/<repo>.git sherlock
cd sherlock
```

SSH:

```bash
git clone git@github.com:<owner>/<repo>.git sherlock
cd sherlock
```

You can keep any folder name. This guide uses `sherlock` as the clone directory.

Record the **absolute path**. MCP clients require it.


| OS      | Example clone path          |
| ------- | --------------------------- |
| Windows | `C:\Users\you\src\sherlock` |
| macOS   | `/Users/you/src/sherlock`   |
| Linux   | `/home/you/src/sherlock`    |


Windows paths in JSON must escape backslashes: `C:\\Users\\you\\src\\sherlock\\dist\\index.js`. Forward slashes usually also work: `C:/Users/you/src/sherlock/dist/index.js`.

## 2. Install dependencies

From the repository root:

```bash
npm install
```

This installs production and development dependencies, including TypeScript, Vitest, and MCP Inspector.

If `npm ci` is preferred (CI / lockfile-strict installs):

```bash
npm ci
```



## 3. Create the environment file

Never commit `.env`. `.gitignore` already excludes it.

**macOS / Linux / Git Bash:**

```bash
cp .env.example .env
```

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

**Windows cmd:**

```bat
copy .env.example .env
```

Open `.env` in an editor and set the four required values:

```env
ADO_ORGANIZATION=your_organization
ADO_PROJECT=your_project
ADO_TEAM=your_team
ADO_PAT=your_personal_access_token
```

`.env.example` uses `KEBS4KAAR` / `K4K` / `Platform` as **examples only**. Put **your** Azure DevOps names.


| Variable           | Meaning                                                            | Example               |
| ------------------ | ------------------------------------------------------------------ | --------------------- |
| `ADO_ORGANIZATION` | Azure DevOps organization slug (the name in `dev.azure.com/{org}`) | `contoso`             |
| `ADO_PROJECT`      | Project name                                                       | `Payments`            |
| `ADO_TEAM`         | Team name (must match Azure DevOps exactly)                        | `Development`         |
| `ADO_PAT`          | Personal Access Token                                              | *(never commit this)* |


Optional variables (`SHERLOCK_ENV`, `LOG_LEVEL`, `TOKEN_DEBUG`, `DATABASE_URL`, `CACHE_TTL_SECONDS`, `ADO_API_VERSION`) are documented in [CONFIGURATION.md](./CONFIGURATION.md).

### How to create an Azure DevOps PAT

1. Sign in to `https://dev.azure.com/{your-organization}`.
2. Open **User settings** → **Personal access tokens**.
3. Create a token.
4. Set an expiry you can rotate.
5. Grant the **minimum** scopes this server actually uses:
  - Work Items: **Read** (required)
  - Project and Team: **Read** (required)
  - Work Items / Query: **Read & Write** only if you want `create_ado_query` / skill saved-query creation
6. Copy the token **once** into `.env` as `ADO_PAT`.
7. Do not paste the PAT into chat, README, query titles, or MCP JSON if you can avoid it. The server loads `.env` from the repository root.

Full PAT and security notes: [SECURITY.md](./SECURITY.md).

## 4. Run diagnostics

```bash
npm run doctor
```

Expected shape (PAT is never printed):

```text
S.H.E.R.L.O.C.K. Doctor

Environment
✓ Node.js
✓ Dependencies
✓ .env

Configuration
✓ Organization
✓ Project
✓ Team
✓ PAT

Azure DevOps
✓ Authentication
✓ Project
✓ Team

Runtime
✓ Database
✓ Skills
✓ Build

Status: READY
```

If **Build** is marked missing, continue to the next step, then re-run doctor.

If Azure DevOps checks fail, doctor still tells you whether `.env` is present. Fix org/project/team/PAT and retry. Details: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

`doctor` talks to Azure DevOps. It is not required for unit tests.

## 5. Build

```bash
npm run build
```

This compiles TypeScript to `dist/` using `tsconfig.build.json`. The MCP entrypoint is:

```text
dist/index.js
```

Confirm the file exists:

**macOS / Linux:**

```bash
ls dist/index.js
```

**Windows PowerShell:**

```powershell
Test-Path .\dist\index.js
```

Rebuild after every source change before connecting a client to `dist/index.js`. Stale `dist` is a common “MCP tools missing / old behaviour” cause.

## 6. Run unit tests (recommended)

```bash
npm test
```

or:

```bash
npx vitest run
```

CI runs the same commands **without** a real PAT. Live Azure DevOps tests are opt-in (`npm run verify:live`) and are not required for a first install.

## 7. Optional: MCP Inspector

Inspector is a browser UI for listing tools and calling them without Claude/Cursor/Kiro.

```bash
npm run build
npm run inspector
```

`npm run inspector` launches Inspector against `mcp-inspector.config.json` using `tsx src/index.ts`. To inspect the production build:

```bash
npm run inspector:build
```

Verify at least:

- tools register
- `sherlock_health_check`
- `skill_list` / `skill_execute`
- custom skill tools (`kaarflow_*`)
- an `ado_*` read
- `create_ado_query` (if your PAT allows query write)



## 8. Start the MCP server manually (optional)

Clients start the process for you. You can still start it yourself to confirm it boots:

```bash
npm run start
```

That runs `node dist/index.js`. It will sit waiting on stdin (stdio MCP). That is expected. Stop it with Ctrl+C.

Do **not** leave a stray `npm run start` running in a terminal **and** also attach the same `dist/index.js` from a client if you are debugging “stale process” issues. Prefer letting the client own the process.

Development watch mode (not for production clients):

```bash
npm run dev
```



## 9. Connect a client

Pick one (Cursor preview cannot follow `file.md#heading` links; these open the client guide, then jump to the matching `##` heading):

- [Claude Desktop](./MCP-CLIENTS.md)
- [Claude Code](./MCP-CLIENTS.md)
- [Claude CLI](./MCP-CLIENTS.md)
- [Cursor](./MCP-CLIENTS.md)
- [Kiro](./MCP-CLIENTS.md)

After connecting, run:

```text
Run sherlock_health_check
```

then:

```text
Execute skill daily-standup-starter in brief mode
```

If that returns live team data for **your** `ADO_TEAM`, the install is complete.

## First-run checklist

- [ ] Node.js ≥ 22.5
- [ ] `npm install` completed
- [ ] `.env` exists and is **not** committed
- [ ] `ADO_ORGANIZATION`, `ADO_PROJECT`, `ADO_TEAM`, `ADO_PAT` set
- [ ] `npm run doctor` reports READY (or only Build missing, then rebuild)
- [ ] `npm run build` produced `dist/index.js`
- [ ] MCP client uses an **absolute** path to `dist/index.js`
- [ ] Client fully restarted after editing MCP JSON
- [ ] `sherlock_health_check` succeeds
- [ ] A built-in skill executes against the configured team



## Switching team, project, or organization

Edit `.env` only:

```env
ADO_TEAM=Development
```

Restart the MCP client so it relaunches the server. Skills, WIQL team scope, navigation URLs, and saved-query folders (`My Queries/Development`) all follow configuration. No code change is required.

## Updating

```bash
git pull
npm install
npm run build
```

Then fully restart the MCP client so it does not keep a stale Node process.

## Uninstall

1. Remove the `sherlock` entry from the client MCP config.
2. Restart the client.
3. Delete the clone directory.
4. Optionally delete Azure DevOps saved queries under `My Queries/{Team}` if you no longer want them. S.H.E.R.L.O.C.K. does **not** delete queries automatically.

