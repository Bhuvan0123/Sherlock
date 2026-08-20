# Contributing

Keep V1 focused on Azure DevOps, team/sprint intelligence, read-only work-item analysis, controlled saved-query creation, custom skills and MCP.

Before opening a PR:

```bash
npm run build
npx vitest run
```

Do not commit `.env`, runtime databases, logs or production credentials. Live Azure DevOps checks must be opt-in and must not be required by public CI.
