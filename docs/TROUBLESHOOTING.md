# Troubleshooting

Always start with:

```bash
npm run doctor
```

Doctor never prints the PAT. Fix what it marks `✗`, then restart the MCP client.

## PAT missing

**Symptom:** startup or doctor says `ADO_PAT is missing`.

**Fix:** `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`), set `ADO_PAT`, save, restart the client.

## Invalid PAT

**Symptom:** `ADO_AUTH_FAILED`, sign-in HTML instead of JSON, 401.

**Fix:** Create a new PAT in Azure DevOps, replace `ADO_PAT`, restart. Confirm the token belongs to the same organization as `ADO_ORGANIZATION`.

## Organization inaccessible

**Symptom:** cannot list projects; 404/401 on `_apis/projects`.

**Fix:** `ADO_ORGANIZATION` must be the slug in `https://dev.azure.com/{organization}`. Check VPN/SSO. Check PAT org access.

## Project inaccessible

**Symptom:** doctor fails **Project**; 404 on `_apis/projects/{name}`.

**Fix:** `ADO_PROJECT` must match the project **name** exactly (spelling and spacing). Confirm the PAT identity can open that project in the browser.

## Team not found

**Symptom:** doctor fails **Team**; 404 on teams API.

**Fix:** `ADO_TEAM` must match the Azure DevOps **team** name, not an area path and not a group display name. Team settings → the team picker is the source of truth.

## MCP not appearing

1. `npm run build` and confirm `dist/index.js`
2. Absolute path in client JSON
3. Valid JSON (no trailing comma)
4. `command` points at a Node 22.5+ binary the **GUI** can exec
5. Full quit/relaunch (Desktop) or new session (`claude` / `/mcp`)
6. Cursor: Settings → Tools & MCP, enable `sherlock`, use Agent chat
7. Kiro: absolute `node` path; Kiro often has no shell PATH

See [MCP-CLIENTS.md](./MCP-CLIENTS.md).

## Stale MCP process

**Symptom:** old tools (email_*), old folder `KaarFlow`, or old skill list.

**Fix:** Quit every client using the server. Rebuild. Start one client. On Windows, Task Manager → end leftover `node.exe` running `dist/index.js` if needed.

## dist not rebuilt

**Symptom:** code changed, client behaviour did not.

**Fix:** `npm run build`. Clients pointed at `dist/index.js` do not pick up `src/` until compile.

## Custom skills not loading

**Symptom:** skill missing after restart.

**Fix:** Same `DATABASE_URL` / `data/sherlock.sqlite`. Directory must be writable. `skipDatabaseInit` is test-only. Call `kaarflow_list_skills`.

## SQLite initialization

**Symptom:** cannot open activity database.

**Fix:** Ensure `data/` is writable. Avoid pointing `DATABASE_URL` at a read-only network path. `:memory:` will not persist custom skills.

## MCP Inspector

**Symptom:** Inspector empty or spawn error.

**Fix:** `npm run build` then `npm run inspector` from repo root. For the compiled server use `npm run inspector:build`. `.env` must exist for live ADO calls.

## Query folder errors

**Symptom:** `QUERY_FOLDER_NOT_FOUND`.

**Fix:** The identity needs permission to create folders under **My Queries**. `My Queries/{ADO_TEAM}` is created when the parent exists. Shared Queries are not used unless you pass an explicit `parentPath`.

## Cross-team query reuse

Queries are isolated by team folder. If you changed `ADO_TEAM` but still see old titles, you are looking at a different folder in Azure DevOps — that is expected.

## PAT leaked in a response

Should not happen. If you see a token-shaped string, stop, rotate the PAT, and open an issue with a **redacted** payload. Do not paste the live secret.

## Tests fail locally

```bash
npm run build
npx vitest run
```

Unit tests use fixtures and a fake PAT (`test-pat-value-not-a-real-secret`). They must not require live Azure DevOps.
