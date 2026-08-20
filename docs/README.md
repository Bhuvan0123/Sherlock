# S.H.E.R.L.O.C.K. documentation

This folder is the source of truth for installing, configuring, securing, and operating S.H.E.R.L.O.C.K.

Start here if you just cloned the repository.

## Read in this order

| Order | Document | Use it when |
| --- | --- | --- |
| 1 | [INSTALLATION.md](./INSTALLATION.md) | Cloning, Node.js, `.env`, PAT, first build |
| 2 | [CONFIGURATION.md](./CONFIGURATION.md) | Environment variables, team switching, SQLite |
| 3 | [MCP-CLIENTS.md](./MCP-CLIENTS.md) | Connecting Claude Desktop, Claude Code, Claude CLI, Cursor, Kiro, Inspector |
| 4 | [architecture.md](./architecture.md) | How the MCP server, skills, query engine and Azure DevOps layer fit together |
| 5 | [skills.md](./skills.md) | Built-in analysis skills and modes |
| 6 | [custom-skills.md](./custom-skills.md) | Creating and composing custom skills |
| 7 | [SECURITY.md](SECURITY.md) | Read-only work items, PAT handling, query writes |
| 8 | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Doctor command, MCP not appearing, ADO errors |
| 9 | [CONTRIBUTING.md](CONTRIBUTING.md) | Local development and pull requests |

## Supporting technical notes

| Document | Contents |
| --- | --- |
| [query-engine.md](query-engine.md) | Query engine behaviour |
| [query-fields.md](query-fields.md) | Azure DevOps field mapping used in WIQL |

The product README at the repository root is a short map. The files in this folder are the detailed guides.
