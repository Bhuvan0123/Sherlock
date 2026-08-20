# Troubleshooting

Start with:

```bash
npm run doctor
```

Common issues:

- `ADO_PAT` missing: create `.env` from `.env.example` and set the PAT.
- Invalid PAT: create a fresh Azure DevOps PAT and restart the MCP process.
- Organization inaccessible: verify `ADO_ORGANIZATION` and PAT tenant access.
- Project inaccessible: verify `ADO_PROJECT` and PAT permissions.
- Team not found: verify `ADO_TEAM` exactly matches the Azure DevOps team.
- MCP not appearing: rebuild with `npm run build`, restart the client and check the absolute path.
- Stale process: fully quit the MCP client and restart it.
- Custom skills not loading: run `npm run doctor` and check SQLite path permissions.
- MCP Inspector issues: run `npm run build` before `npm run inspector`.
