---
name: relay-workspace
description: Use Relay Shared Workspace MCP whenever the user wants to set up Relay, create or join a shared workspace, collaborate through shared chat or memory, check duplicate work, use semantic cache or RAG, or inspect workspace token savings.
---

# Relay Shared Workspace

Use the bundled `relay` MCP server. Installing this plugin already configures the remote MCP endpoint; do not ask the user to run `codex mcp add`, provide an API key, add a member token, or create another MCP connection.

## First use

When the user asks to set up, connect, or start Relay:

1. Call `relay_list_workspaces`.
2. Show each Workspace name and ID. Explain that `RoamTogether` is the demo Workspace when it is present.
3. Ask which existing Workspace to use only when the user has not named one and more than one exists. If only one exists, use it. If none exists, ask for a Workspace name and call `relay_create_workspace`.
4. Call `relay_get_workspace` with the selected `workspaceId` and report the Workspace name, ID, dashboard URL when available, embedding provider, route counts, and token savings.
5. Remember the selected `workspaceId` for the current task and pass it to every Workspace-scoped Relay tool.

Creating another Workspace never requires another MCP installation. Call `relay_create_workspace`, show the returned `uiUrl`, and use its returned ID in later calls.

## Required routing lifecycle

For every new Workspace question or agent task:

1. Call `relay_preflight` first with the exact question and `operation: "auto"`.
2. Display Hybrid similarity, raw embedding similarity, normalized lexical similarity, recommended route, and token estimate.
3. Follow the returned route exactly:
   - `semantic_cache`: call `relay_execute` immediately. Display the complete cached answer, then ask whether the user accepts it or wants a RAG update. End the turn and wait. If accepted, call no more tools. Only after an explicit update request, call `relay_rag_refresh_preflight` with `confirmedByUser: true`, then execute its new preflight.
   - automatic `full_generation` with all three similarities at zero: do not ask the user to choose a route. Call `relay_execute`, complete the returned handoff with the current Codex model, then call `relay_submit_result`.
   - a nonzero related match: show the three scores, ask the user to choose RAG or Full Generation, end the turn, and wait. In the next turn call `relay_confirm_route` with the explicit selection and `confirmedByUser: true`, then call `relay_execute`.
4. For `rag` or `full_generation`, Relay does not call a generation model. Use this Codex agent to complete `handoff.question` using `handoff.systemInstructions` and `handoff.context`.
5. Call `relay_submit_result` with the unchanged question, returned preflight ID, final answer, agent name, model name when known, knowledge type, and token usage when available. Do not claim a RAG or Full Generation task is complete until submission succeeds.

Never bypass preflight for Workspace work. Never invent similarity, cache status, route, token usage, Workspace IDs, or saved results.

## Collaboration

- Use `relay_post_update` to post human discussion, progress, decisions, or completed agent work to the Workspace chat without invoking a model.
- Use `relay_search_memory` for read-only lookup when the user explicitly wants to inspect existing team knowledge rather than start a new routed task.
- Use `relay_get_workspace` to inspect activity, route statistics, connected-agent activity, and savings.
- Treat each Workspace as isolated. Never reuse a Workspace ID from another team unless the user selected it.
- Show the Workspace dashboard as `https://relay-production-2026.opompm841218.chatgpt.site/<workspaceId>` when a tool response does not already include `uiUrl`.

## Safety and freshness

Do not directly reuse stale, expired, refresh-required, superseded, or transactional knowledge. Let Relay enforce TTL and routing. A refresh must preserve the old record and save the new response through the returned lifecycle.

This Hackathon deployment allows joining by Workspace ID for demonstration. Do not describe a Workspace ID as a production-grade secret or authorization boundary.
