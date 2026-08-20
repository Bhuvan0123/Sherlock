# MCP client setup

S.H.E.R.L.O.C.K. is a **local stdio** MCP server. Every client below starts the same process:

```text
node /absolute/path/to/sherlock/dist/index.js
```

Secrets live in the repository `.env`. Prefer **not** putting `ADO_PAT` in client JSON. The server loads `.env` from the repo root (see `src/config/env.ts`).

Complete [INSTALLATION.md](./INSTALLATION.md) (`npm install`, `.env`, `npm run build`) **before** this document.

| Client | Jump to heading in this file |
| --- | --- |
| Claude Desktop | **Claude Desktop** |
| Claude Code | **Claude Code** |
| Claude CLI | **Claude CLI** |
| Cursor | **Cursor** |
| Kiro | **Kiro** |
| Inspector | **MCP Inspector** |

## Shared rules (all clients)

1. Use an **absolute** path to `dist/index.js`. Relative paths fail when the client’s working directory is not the repo.
2. Use the `node` executable that is Node **22.5+**. If the GUI app cannot find `node`, put the full path to `node` in `command`.
3. Rebuild after source changes: `npm run build`.
4. Fully quit and relaunch the client after editing MCP JSON. Reloading a chat is often not enough.
5. Never commit files that contain a real PAT.
6. JSON must be valid. A trailing comma disables the whole file in most clients.
7. stdout is the MCP protocol. Do not wrap the server in scripts that `echo` to stdout.

### Find Node

**macOS / Linux:**

```bash
which node
node -v
```

**Windows PowerShell:**

```powershell
Get-Command node | Select-Object -ExpandProperty Source
node -v
```

Example Windows Node path: `C:\\Program Files\\nodejs\\node.exe`

### Path placeholders used below

Replace these:

| Placeholder | Meaning |
| --- | --- |
| `/absolute/path/to/sherlock` | Clone directory (POSIX) |
| `C:\\Users\\you\\src\\sherlock` | Clone directory (Windows JSON) |
| `C:/Users/you/src/sherlock` | Same path with forward slashes |

---

## Claude Desktop

Claude Desktop reads **only** `claude_desktop_config.json`. It does not read `.cursor/mcp.json` or `.mcp.json`.

### Config file location

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows (Win32 installer) | `%APPDATA%\Claude\claude_desktop_config.json` typically `C:\Users\<you>\AppData\Roaming\Claude\claude_desktop_config.json` |
| Linux (if you have a Desktop build) | `~/.config/Claude/claude_desktop_config.json` |

**Recommended way to open the file:**

1. Open Claude Desktop.
2. **Claude** menu (macOS menu bar) or **File** / gear → **Settings**.
3. Open **Developer**.
4. Click **Edit Config**.
5. The file is created if it does not exist.

### JSON to add

Merge into existing `mcpServers` if the file already has other servers. Do not delete unrelated entries.

**macOS / Linux:**

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

**Windows:**

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "node",
      "args": ["C:\\Users\\you\\src\\sherlock\\dist\\index.js"]
    }
  }
}
```

If Desktop cannot find `node` (common when Node was installed via nvm and Desktop was started from the GUI):

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/sherlock/dist/index.js"]
    }
  }
}
```

Windows equivalent:

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\you\\src\\sherlock\\dist\\index.js"]
    }
  }
}
```

Optional `env` (only if you cannot use `.env`; still do not commit this file with a PAT):

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "node",
      "args": ["/absolute/path/to/sherlock/dist/index.js"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Apply the config

1. Save the JSON file.
2. **Quit Claude Desktop completely** (macOS: Claude → Quit Claude; Windows: system tray → Exit). Closing the window is not always enough.
3. Open Claude Desktop again.
4. Start a new chat.
5. Look for the hammer / MCP / tools indicator and confirm a server named `sherlock`.

### Verify in chat

```text
List your MCP tools related to Azure DevOps and S.H.E.R.L.O.C.K.
```

Then:

```text
Call sherlock_health_check and summarise which checks passed. Do not print any token.
```

Then:

```text
Execute the daily-standup-starter skill in brief mode.
```

### Desktop logs

| OS | Logs |
| --- | --- |
| macOS | `~/Library/Logs/Claude/` |
| Windows | `%APPDATA%\Claude\logs` |

Look for spawn errors: `ENOENT` usually means a bad `command` or `args` path.

---

## Claude Code

Claude Code is the IDE / terminal coding agent. It supports three **scopes**.

| Scope | Flag | File | Who sees it |
| --- | --- | --- | --- |
| local (default) | `--scope local` | `~/.claude.json` under this project | You, this project |
| project | `--scope project` | `.mcp.json` in the repo root | Anyone who clones (if committed) |
| user | `--scope user` | `~/.claude.json` top-level `mcpServers` | You, all projects |

Do **not** commit `.mcp.json` if it contains a PAT. Prefer `.env` in the clone and only store the `node` + `dist/index.js` command in MCP JSON.

### Option A — CLI (recommended)

From **any** directory, with Claude Code CLI installed (`claude` on PATH):

**macOS / Linux:**

```bash
claude mcp add --transport stdio --scope user sherlock -- node /absolute/path/to/sherlock/dist/index.js
```

**Windows (PowerShell):**

```powershell
claude mcp add --transport stdio --scope user sherlock -- node C:\Users\you\src\sherlock\dist\index.js
```

Project-only (writes `.mcp.json`):

```bash
cd /absolute/path/to/sherlock
claude mcp add --transport stdio --scope project sherlock -- node /absolute/path/to/sherlock/dist/index.js
```

Useful commands:

```bash
claude mcp list
claude mcp get sherlock
claude mcp remove sherlock
```

Inside an active Claude Code session:

```text
/mcp
```

shows servers and lets you reconnect.

### Option B — hand-edit `.mcp.json` (project scope)

Create `/absolute/path/to/sherlock/.mcp.json`:

```json
{
  "mcpServers": {
    "sherlock": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/sherlock/dist/index.js"]
    }
  }
}
```

Windows:

```json
{
  "mcpServers": {
    "sherlock": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\Users\\you\\src\\sherlock\\dist\\index.js"]
    }
  }
}
```

`type` is required in current Claude Code JSON for stdio servers. Start a **new** Claude Code session in that project after saving.

### Option C — user scope file

Edit `~/.claude.json` and add under the top-level `mcpServers` object the same `sherlock` entry as above. Do not wipe other keys in that file.

### Verify in Claude Code

1. Open the sherlock repo (or any repo if you used `--scope user`).
2. Start Claude Code.
3. Run `/mcp` and confirm `sherlock` is connected.
4. Ask: `Run sherlock_health_check`.
5. Ask: `skill_execute daily-standup-starter with mode brief`.

---

## Claude CLI

The Claude CLI is the same `claude` binary used by Claude Code. MCP registration is the same command family.

### Install / confirm CLI

```bash
claude --version
```

If that fails, install Claude Code / CLI from Anthropic’s current documentation, then retry.

### Register S.H.E.R.L.O.C.K.

User-wide (available in every `claude` session):

```bash
claude mcp add --transport stdio --scope user sherlock -- node /absolute/path/to/sherlock/dist/index.js
```

Windows PowerShell:

```powershell
claude mcp add --transport stdio --scope user sherlock -- node C:\Users\you\src\sherlock\dist\index.js
```

### Start a CLI session

```bash
cd /absolute/path/to/sherlock
claude
```

Then:

```text
/mcp
```

```text
Run sherlock_health_check. Do not print secrets.
```

```text
Execute skill project-health-analysis in brief mode.
```

### CLI extras

```bash
claude mcp list
claude mcp get sherlock
```

To pass extra env without putting a PAT in git:

```bash
claude mcp add --transport stdio --scope user sherlock --env LOG_LEVEL=info -- node /absolute/path/to/sherlock/dist/index.js
```

(Exact `--env` flag availability depends on your CLI version. If your CLI rejects `--env`, put optional non-secret vars in `.env` instead.)

---

## Cursor

Cursor reads MCP config from:

| Scope | File |
| --- | --- |
| Project | `<repo>/.cursor/mcp.json` |
| User (all workspaces) | `~/.cursor/mcp.json` on macOS/Linux, `%USERPROFILE%\.cursor\mcp.json` on Windows |

Project wins if the same server name exists in both.

You can also use **Cursor Settings → Tools & MCP → New MCP Server**, which opens `mcp.json`.

### Project config (this repository)

Create or edit `.cursor/mcp.json` in the clone:

**macOS / Linux:**

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

**Windows:**

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\you\\src\\sherlock\\dist\\index.js"]
    }
  }
}
```

Using `${workspaceFolder}` if your Cursor version supports it in `args`:

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"]
    }
  }
}
```

If variable expansion fails on your Cursor version, use the absolute path.

### User config (all projects)

Put the same `mcpServers.sherlock` block in `~/.cursor/mcp.json` / `%USERPROFILE%\.cursor\mcp.json`.

### Apply in Cursor

1. Save `mcp.json`.
2. Open **Cursor Settings → Tools & MCP**.
3. Confirm `sherlock` is listed and enabled (green / connected).
4. If it stays red, toggle the server off/on or reload the window (`Developer: Reload Window`).
5. Open **Agent** chat (MCP tools are used in Agent mode, not always in plain Tab autocomplete).

### Verify in Cursor

```text
Use the sherlock MCP server. Call sherlock_health_check.
Then execute skill workload-analysis in brief mode for the configured Azure DevOps team.
```

### Cursor-specific pitfalls

- A project `.cursor/mcp.json` that still names an old server (`k4k-team-lead-assistant`) will not load S.H.E.R.L.O.C.K. Rename the key to `sherlock` and point `args` at current `dist/index.js`.
- On Windows, `npx` spawned from the GUI sometimes fails PATH lookup. Prefer `node` + absolute `dist/index.js`.
- Do not commit a PAT inside `.cursor/mcp.json`.

---

## Kiro

Kiro MCP files:

| Scope | File |
| --- | --- |
| Workspace | `.kiro/settings/mcp.json` |
| User | `~/.kiro/settings/mcp.json` |

Workspace overrides user for the same server name.

### Open the file from Kiro

1. Command Palette: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
2. Run **Kiro: Open workspace MCP config (JSON)** or **Kiro: Open user MCP config (JSON)**.
3. Alternatively open the Kiro panel → **Open MCP Config**.

### JSON

Kiro often does **not** inherit your shell `PATH`. Prefer absolute `node` and absolute `dist/index.js`.

**macOS:**

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/sherlock/dist/index.js"],
      "disabled": false
    }
  }
}
```

If Node is installed via Homebrew Apple Silicon, `command` is often `/opt/homebrew/bin/node`. Confirm with `which node`.

**Linux:**

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "/usr/bin/node",
      "args": ["/home/you/src/sherlock/dist/index.js"],
      "disabled": false
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\you\\src\\sherlock\\dist\\index.js"],
      "disabled": false
    }
  }
}
```

Optional: pass PATH so child processes can find Node:

```json
{
  "mcpServers": {
    "sherlock": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/sherlock/dist/index.js"],
      "env": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
      },
      "disabled": false
    }
  }
}
```

Kiro supports `autoApprove` / `disabledTools`. Leave them unset until you know which tools you want auto-approved. Do not auto-approve `create_ado_query` unless you intend saved queries to be created without a prompt.

### Apply

Save the file. Kiro reconnects MCP servers on save. Check the **MCP servers** tab in the Kiro panel for a connected `sherlock` entry.

### Kiro CLI (if installed)

```bash
kiro-cli mcp add --name sherlock --scope global --command node --args /absolute/path/to/sherlock/dist/index.js
```

Exact flags vary by `kiro-cli` version. If the command fails, use the JSON files above (those are the documented source of truth).

### Verify in Kiro

```text
Connect to the sherlock MCP server if needed.
Call sherlock_health_check.
Execute skill sprint-health-analysis in visual mode.
```

---

## MCP Inspector

Inspector is not an assistant. It is the official MCP debugging UI.

```bash
cd /absolute/path/to/sherlock
npm run build
npm run inspector
```

This uses `mcp-inspector.config.json`:

- `sherlock` → `npx tsx src/index.ts` (TypeScript, needs repo + deps)
- `sherlock-dist` → `node dist/index.js` (what production clients should run)

Production-shaped Inspector:

```bash
npm run inspector:build
```

Checklist inside Inspector:

1. Tools list includes `sherlock_health_check`, `skill_execute`, `kaarflow_list_skills`, `create_ado_query`, and `ado_*` reads.
2. Call `sherlock_health_check` — no PAT in the payload.
3. Call `skill_list`.
4. Call `skill_execute` with `{ "name": "daily-standup-starter", "mode": "brief" }` (argument names follow the live tool schema).
5. Call an `ado_get_current_sprint` (or equivalent) read.
6. Optionally `create_ado_query` only if your PAT may write queries.

---

## After any client is connected

Suggested first conversation:

```text
1. Run sherlock_health_check.
2. List available skills.
3. Execute daily-standup-starter in brief mode.
4. Explain that work items are read-only and saved queries go under My Queries/{configured team}.
```

Create a custom skill (preview first):

```text
Compose a custom skill named weekly-engineering-review that combines
sprint-health-analysis, workload-analysis, stale-work-analysis and
deadline-risk-analysis. Preview only; do not save until I confirm.
```

---

## Client comparison

| Client | Config file | How to add | Restart needed |
| --- | --- | --- | --- |
| Claude Desktop | `claude_desktop_config.json` | Settings → Developer → Edit Config | Full quit/relaunch |
| Claude Code | `.mcp.json` / `~/.claude.json` | `claude mcp add` or edit JSON | New session; `/mcp` |
| Claude CLI | same as Claude Code | `claude mcp add` | New `claude` session |
| Cursor | `.cursor/mcp.json` or `~/.cursor/mcp.json` | Settings → Tools & MCP | Reload window / toggle server |
| Kiro | `.kiro/settings/mcp.json` or `~/.kiro/settings/mcp.json` | Command Palette → Open MCP config | Usually on save |
| Inspector | `mcp-inspector.config.json` | `npm run inspector` | Re-run command |

---

## If the server does not appear

1. `npm run doctor`
2. Confirm `dist/index.js` exists
3. Run `node /absolute/path/to/sherlock/dist/index.js` in a terminal — it should wait on stdin, not crash
4. Validate JSON (`python -m json.tool < config.json`)
5. Confirm absolute paths
6. Fully restart the client
7. Read client MCP logs
8. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
