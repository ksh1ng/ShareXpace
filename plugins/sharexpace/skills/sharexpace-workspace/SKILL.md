---
name: sharexpace-workspace
description: Use ShareXpace MCP whenever the user wants to set up ShareXpace, create or join a shared workspace, collaborate through shared chat or memory, check duplicate work, use semantic cache or RAG, or inspect workspace token savings.
---

# ShareXpace

Use the bundled `relay` MCP server. Installing this plugin already configures the remote MCP endpoint; do not ask the user to run `codex mcp add`, provide an API key, add a member token, or create another MCP connection.

Relay's hosted service owns D1 shared memory, R2 uploads, document chunks, embeddings, Semantic Cache, and Dashboard analytics. The user's Codex host owns all RAG and Full Generation inference: never request or send the user's model API key to Relay. Uploaded documents may be retrieved as chunk context in a handoff, but the host agent must still submit its generated result through `relay_submit_result`.

## First use

When the user asks to set up, connect, or start Relay:

1. Before calling any Relay tool, ask: **"What name would you like to use in ShareXpace?"** End the turn and wait for the answer unless the user already provided a name in the current task.
2. Treat the answer as `memberName`. It must contain 1–80 characters after trimming. Never silently use the ChatGPT account name, email address, API credential, or the generic `Codex Plugin` label.
3. Remember `memberName` for the current task and pass it unchanged to every Relay tool call, including list/create, preflight/confirm/execute/submit, refresh, chat, search, and Workspace status calls. This is the member identity shown in Workspace activity and Connected Agents.
4. Call `relay_list_workspaces` with `memberName`.
5. Show each Workspace name and ID. Explain that `RoamTogether` is the demo Workspace when it is present.
6. Ask which existing Workspace to use only when the user has not named one and more than one exists. If only one exists, use it. If none exists, ask for a Workspace name and call `relay_create_workspace` with `memberName`.
7. Call `relay_get_workspace` with the selected `workspaceId` and `memberName`, then report the Workspace name, ID, dashboard URL when available, embedding provider, route counts, and token savings.
8. Remember the selected `workspaceId` for the current task and pass it to every Workspace-scoped Relay tool.

If the user later asks to change identity, confirm the new name once, replace the remembered `memberName`, and use it for all later calls. A new MCP installation is not required.

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

Pass the remembered `memberName` to every tool in this lifecycle. Never bypass preflight for Workspace work. Never invent similarity, cache status, route, token usage, Workspace IDs, or saved results.

## Collaboration

- Use `relay_post_update` to post human discussion, progress, decisions, or completed agent work to the Workspace chat without invoking a model.
- Use `relay_search_memory` for read-only lookup when the user explicitly wants to inspect existing team knowledge rather than start a new routed task.
- Use `relay_get_workspace` to inspect activity, route statistics, connected-agent activity, and savings.
- Treat each Workspace as isolated. Never reuse a Workspace ID from another team unless the user selected it.
- Show the Workspace dashboard as `https://relay-production-2026.opompm841218.chatgpt.site/<workspaceId>` when a tool response does not already include `uiUrl`.

## Safety and freshness

Do not directly reuse stale, expired, refresh-required, superseded, or transactional knowledge. Let Relay enforce TTL and routing. A refresh must preserve the old record and save the new response through the returned lifecycle.

This Hackathon deployment allows joining by Workspace ID for demonstration. Do not describe a Workspace ID as a production-grade secret or authorization boundary.
