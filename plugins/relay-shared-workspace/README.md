# Relay Shared Workspace Codex Plugin

This plugin bundles two pieces into one install:

- the production Relay remote MCP connection;
- the guided Relay workflow used by Codex for Workspace selection, Semantic Cache, RAG and Full Generation handoffs, shared chat, and result submission.

After installation, users do **not** need to run `codex mcp add`, edit `~/.codex/config.toml`, provide `OPENAI_API_KEY`, provide `GEMINI_API_KEY`, or add a Relay member token. Those server-side concerns are already handled by the hosted Relay deployment.

## Install from this repository

1. Open this repository in the Codex desktop app.
2. Restart the app once so it discovers `.agents/plugins/marketplace.json`.
3. Open **Plugins**, choose **Relay Build Week**, and install **Relay Shared Workspace**.
4. Start a new Codex task and use the starter prompt: `Set up Relay and show available workspaces.`

The plugin calls `relay_list_workspaces`, lets the user select an existing Workspace or create a new one, and keeps using the same MCP connection for every Workspace.

## What remains a prerequisite

The user needs Codex or the ChatGPT desktop app because a plugin cannot install its own host application. No separate model API key is required: Semantic Cache is served by Relay, while RAG and Full Generation are performed by the user's existing Codex host model.

## Demo default

- Workspace: `RoamTogether`
- Dashboard: <https://relay-production-2026.opompm841218.chatgpt.site/RoamTogether>
- MCP endpoint: bundled in `.mcp.json`

Use a new Codex task after installing or updating the plugin so the bundled skill and MCP tools load together.
