# Contributing

V1 stays focused on:

- Azure DevOps
- Team / sprint intelligence
- Read-only work-item analysis
- Controlled saved-query creation
- Custom skills
- MCP

Do not add a frontend, scheduler, email, or work-item writes.

## Setup

Follow [INSTALLATION.md](INSTALLATION.md). Use a throwaway PAT in `.env` if you run live checks.

```bash
npm install
Copy-Item .env.example .env   # then edit
npm run build
npm test
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Compile to `dist/` |
| `npm run start` | stdio MCP server |
| `npm run dev` | `tsx watch` (development) |
| `npm run test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run doctor` | Config + ADO diagnostics |
| `npm run inspector` | MCP Inspector |
| `npm run test:security` | Read-only / tool-surface tests |

## Rules of the road

- Do not rewrite SkillExecutor unless fixing a defect.
- Do not hardcode organization, project, team, or people in `src/`.
- Access config via `getConfig()`.
- Never log or return `ADO_PAT`.
- Keep work items read-only; saved queries stay team-scoped under `My Queries/{ADO_TEAM}`.
- Do not commit `.env`, `data/`, `dist/` (ignored), or credentials.

## Pull requests

1. `npm run build`
2. `npx vitest run`
3. Describe behaviour, not only files
4. Live ADO verification is **opt-in**, not required for CI

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run build`, and `npm test` on Node 22 with **no** real PAT.

## Docs

User-facing docs live in this folder. The root [README.md](../README.md) is the map. Update both when behaviour changes.

## License

No `LICENSE` file is in the repository yet. Do not invent a license in a PR; a license decision is still required for public distribution.
