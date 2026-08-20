# MCP Clients

Build first:

```bash
npm run build
```

Use an absolute path to `dist/index.js`:

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

Use this shape for Claude Code, Claude Desktop, Cursor and Kiro where MCP server configuration is accepted. Do not put secrets in client config unless your environment requires it; prefer `.env`.

Inspector:

```bash
npm run inspector
```
