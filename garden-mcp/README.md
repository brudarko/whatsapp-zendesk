# garden-mcp

MCP server that gives an AI agent the Zendesk Garden component catalog
(`@zendeskgarden/react-*`) so it can build Zendesk app UIs without guessing prop
names or imports. Pairs with the `zendesk-garden-apps` skill.

## Tools

| Tool | Purpose |
|---|---|
| `garden_list_components` | Every package + its components + one-line "when to use". |
| `garden_get_component` | npm/install, exports, **full prop interfaces (JSDoc)**, README examples. |
| `garden_search` | Keyword search across names, props and examples. |
| `garden_theming` | Required `ThemeProvider` / `getColor` / dark mode / RTL / a11y. |
| `garden_app_setup` | ZAF v2 + React + Garden bootstrap recipe. |

Data is local in [`data/components.json`](data/components.json), generated from
[zendeskgarden/react-components](https://github.com/zendeskgarden/react-components).
No network access at runtime.

## Use it

Already registered for this repo in `../.cursor/mcp.json`. Install deps once:

```sh
npm install
```

Then reload MCP servers in Cursor (Settings → MCP) — the `garden` server should
list 5 tools.

Standalone / other clients:

```json
{ "mcpServers": { "garden": { "command": "node", "args": ["/abs/path/garden-mcp/server.mjs"] } } }
```

Inspect manually: `npm run inspect` (opens MCP Inspector).

## Update to a newer Garden version

```sh
npm run build:catalog        # fetches latest from main
GARDEN_REF=v9.15.8 npm run build:catalog   # or pin a tag
```

This rewrites `data/components.json` (Garden version is read from the
`react-theming` package). Regenerate the skill's `packages.md` too if you keep it.
