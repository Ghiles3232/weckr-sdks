# @weckr/mcp

Query your Weckr AI cost and margin data directly from Claude, Cursor, or any
other MCP-compatible AI assistant.

## Try it live

See what Weckr looks like before connecting your own data.
👉 https://app.useweckr.com/demo

## What you can ask

Ask things like:

- *"Which of my users are losing me money this month?"*
- *"What's my AI margin right now?"*
- *"Which feature should I switch to a cheaper model?"*
- *"Is my pricing sustainable given my actual AI costs?"*
- *"Show me the feature cost breakdown."*

Claude calls the Weckr API and gives you the real numbers from your dashboard,
in the conversation.

## Get an api key

Sign up at [app.useweckr.com](https://app.useweckr.com). Your `wk_` key is
shown once when you create a project — copy it. If you missed it, mint a new
project at
[app.useweckr.com/dashboard/projects/new](https://app.useweckr.com/dashboard/projects/new).

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "weckr": {
      "command": "npx",
      "args": ["-y", "@weckr/mcp"],
      "env": {
        "WECKR_API_KEY": "wk_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. Try: *"Use the Weckr tools to show me my AI costs this month."*

> **Why `npx` and not `npm install -g`?** Claude Desktop runs under launchd on
> macOS, which doesn't inherit your interactive shell's PATH. If you installed
> Node via nvm / asdf / volta, a globally-installed `weckr-mcp` binary
> usually isn't on Claude Desktop's PATH and the server fails to start with no
> diagnostic. `npx -y @weckr/mcp` sidesteps the PATH problem entirely.

## Cursor

Add to `.cursor/mcp.json` at your project root (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "weckr": {
      "command": "npx",
      "args": ["-y", "@weckr/mcp"],
      "env": {
        "WECKR_API_KEY": "wk_your_key_here"
      }
    }
  }
}
```

## Tools exposed

| Tool | Use it to ask |
|---|---|
| `get_overview` | "How am I doing this month?" — total cost, revenue, margin, requests, unprofitable user count |
| `get_users` | "Which users are unprofitable?" / "Show me my top-cost users." — per-user margin (filterable) |
| `get_feature_breakdown` | "Which features cost me the most?" — per-feature cost share |
| `get_model_recommendations` | "Where can I cut AI cost?" — same-provider cheaper-model swaps with $-saving estimate |
| `get_pricing_recommendations` | "Is my pricing sustainable?" — per-plan margin health + recommended price |
| `get_spending_cap_url` | Returns the dashboard URL where caps are edited (does NOT mutate state) |

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `WECKR_API_KEY` | yes | — | Your `wk_` key from [app.useweckr.com](https://app.useweckr.com) |
| `WECKR_PROJECT_ID` | no | resolved from `/api/v1/me` | Optional: pre-set the project UUID to skip one round-trip on startup |
| `WECKR_BASE_URL` | no | `https://app.useweckr.com` | Override for self-hosted Weckr. **Your wk_ key is sent here on every request — do not set this to a host you do not control.** Only `https://` is accepted (loopback `http://` allowed for dev). |

## How it works

The MCP server is a tiny stdio process spawned by your AI client. It calls
the Weckr HTTP API using your `wk_` key (server-to-server, no JWT needed).
The api key authoritatively identifies one project — the server uses it to
resolve `projectId` once at startup, then scopes every subsequent call to
that project. The dashboard endpoints (`/api/v1/stats`, `/users`,
`/recommendations/*`) verify the URL project id matches the api key's project
and return 404 on mismatch, so a leaked api key cannot be used to read
another project's data.

No prompt text or completion text is sent anywhere by this package — the
tools only read aggregated stats. The api key never leaves your local
process *except* to the URL configured via `WECKR_BASE_URL` (default
`app.useweckr.com`). If you change `WECKR_BASE_URL`, the SDK prints a stderr
warning so you can spot a copy-paste config that points at the wrong host.

## Troubleshooting

**Claude Desktop shows "weckr — server disconnected" with no error.**
Likely a PATH issue — switch to the `npx -y @weckr/mcp` form above. To see
the actual error from the spawn, run the server manually in a terminal:
`WECKR_API_KEY=wk_... npx -y @weckr/mcp`. Anything wrong (missing api key,
401 from Weckr, network issue) prints to stderr.

**`Weckr API 401 on /api/v1/me`.**
Your `WECKR_API_KEY` is empty, malformed, revoked, or pasted with a trailing
space. Confirm a working key by visiting
[app.useweckr.com/dashboard/projects/new](https://app.useweckr.com/dashboard/projects/new)
and creating a fresh project.

**Tools show "Project not found or forbidden" (404).**
You set `WECKR_PROJECT_ID` to a UUID that doesn't belong to the project the
api key owns. Remove `WECKR_PROJECT_ID` so the server resolves the right
project id from the api key.

## Local development

```bash
git clone https://github.com/Ghiles3232/weckr-sdks
cd weckr-sdks/mcp
npm install
npm run build

# Smoke-test against production:
WECKR_API_KEY=wk_... node dist/index.js
# (prints "weckr-mcp running on stdio" to stderr, then waits for JSON-RPC on stdin)
```

To point at a local Weckr backend:

```bash
WECKR_API_KEY=wk_... WECKR_BASE_URL=http://localhost:3000 node dist/index.js
```

## Source

Open source at
[github.com/Ghiles3232/weckr-sdks](https://github.com/Ghiles3232/weckr-sdks/tree/main/mcp).

## License

MIT
