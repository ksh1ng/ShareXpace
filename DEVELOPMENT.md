# Relay Production — Development Handoff

## Repository split

| Directory | Purpose | Data policy |
| --- | --- | --- |
| `../team-memory` | Hackathon demo | Seeded scenarios and demo-friendly behavior |
| `./` (`team-memory-production`) | Production edition | Empty workspace, migrated schema, authenticated users, real provider responses |

Never point both editions at the same D1 database or Sites `project_id`. Production does not import demo records at runtime.

## Request flow and owning files

```mermaid
sequenceDiagram
  participant Client as Web UI or MCP client
  participant Gateway as Web API or /api/mcp
  participant Relay as _lib/relay-service.ts
  participant Workspace as _lib/workspace.ts
  participant Agent as Codex / host agent model
  participant D1 as D1

  Client->>Gateway: prompt + operation
  Gateway->>Relay: relayPreflight
  Relay->>Workspace: auth, validate, retrieve, classify
  Workspace->>Workspace: exact/lexical retrieval; embeddings when configured
  Relay->>D1: short-lived token_estimates row
  Relay-->>Client: route + estimate + preflight ID
  Client->>Gateway: relayExecute with preflight ID
  Gateway->>Relay: validate and atomically claim
  alt Semantic Cache
    Relay-->>Client: stored answer; no model call
  else RAG or Full Generation
    Relay-->>Client: agent_action_required + fresh context
    Client->>Agent: generate using host model
    Client->>Gateway: relay_submit_result
    Gateway->>D1: answer + routing event + optional host usage
  end
```

### UI

- `app/page.tsx`: workspace state, shared chat, Ask flow, two-click estimate/confirm interaction, actual-usage cards, master/BYOK selection.
- `app/globals.css`: production UI styling, preflight, usage, and chat handoff states.
- `app/layout.tsx`: metadata and social card URL.

The UI invalidates an estimate whenever the prompt or billing selection changes. The API remains authoritative and rejects stale or mismatched estimates even if a client bypasses the UI.

### API routes

| Route | Responsibility |
| --- | --- |
| `api/state` | Authenticated workspace records, chat, statistics, model readiness |
| `api/questions/estimate` | Route selection and exact preflight token count |
| `api/questions/ask` | Estimated RAG/full-generation submission |
| `api/reuse` | Estimated Semantic Cache reuse with freshness guard |
| `api/knowledge/refresh` | Full refresh, new version creation, old version supersession |
| `api/chat` | Human discussion messages; never calls a model by itself |
| `api/chat/run` | Converts a shared message into an estimated agent task and posts the result back |
| `api/files` | Validated R2 upload plus D1 metadata/knowledge record |
| `api/questions/check` | Deprecated compatibility read; new clients use `estimate` |
| `/api/mcp` | Authenticated JSON-RPC MCP endpoint with tools and resources |

Every route uses `requireActor()` and `errorResponse()` from `workspace.ts`.

### MCP gateway

- `app/api/mcp/route.ts` owns MCP protocol handling, tool/resource descriptors, Workspace-ID join validation, and tool-call audit events.
- `app/layout.tsx` enforces Dashboard SIWC after the Sites dispatch layer is made public for remote MCP transport. Route handlers under `app/api/mcp` are not wrapped by the page layout; browser APIs retain their own `requireActor` checks.
- `app/api/_lib/relay-service.ts` is the transport-neutral application layer shared by MCP and Web API routes.
- `relay_preflight` must precede `relay_execute`; direct execute attempts fail because no matching `token_estimates` authorization record exists.
- MCP `relay_preflight` is a preview operation. It returns all three similarity scores. For non-Semantic routes, `relay_confirm_route` must consume that preview after explicit user choice and create the executable RAG or Full Generation preflight; an unconfirmed preview cannot execute.
- Raw embedding similarity is prompt-to-prompt: Gemini embeds both questions with `SEMANTIC_SIMILARITY` and stores question-title vectors under a purpose-versioned cache key. The preview exposes provider, model, purpose, and sanitized fallback reason; lexical fallback never masquerades as a Gemini 0% result.
- Route precedence is `source refresh → explicit post-hit RAG revision → fresh exact/high-confidence Semantic Cache → forced RAG for medium related knowledge → low-match Full Generation → RAG fallback`. High confidence accepts a Hybrid score of 78%, raw embedding score of 80%, or normalized lexical score of 88% when freshness allows it. This prevents both wording differences and a carried-over generic RAG operation from bypassing reusable team memory.
- `relay_execute` never invokes a generation model for RAG/Full Generation. It returns `agent_action_required`, a bounded context payload, and `requiredNextTool: relay_submit_result`.
- `relay_submit_result` must be called by the same MCP identity with the unchanged question. It stores the host-agent answer in memory and shared chat and consumes the preflight.
- `RELAY_MCP_JOIN_MODE=workspace_id` enables the low-friction Hackathon Demo join flow. The `workspace_id` query value must match `RELAY_WORKSPACE_ID`; the optional `member` value is only an audit label, not verified identity. For a real production deployment, switch to `bearer_token` and configure independent `RELAY_MCP_ACCESS_TOKENS` values.
- MCP cannot control how a third-party host performs its internal inference. Relay controls shared-memory access and requires the result-submission lifecycle before host output becomes reusable team knowledge.

### Shared domain layer

`app/api/_lib/workspace.ts` owns:

- Cloudflare bindings and environment parsing
- Sites identity extraction
- workspace/schema readiness checks
- TTL and direct-reuse policy
- exact/lexical retrieval without credentials, plus optional embedding retrieval, and three-layer classification
- query/record embedding persistence
- prompt estimate creation, validation, atomic claim, and final accounting
- workspace analytics

`app/api/_lib/model.ts` remains the optional Web/API provider adapter and owns:

- stable-first prompt construction
- RAG versus full context selection
- exact `/v1/responses/input_tokens` preflight
- GPT-5.6 Responses calls
- explicit prompt-cache breakpoint/key
- provider usage parsing
- answer/version/audit persistence

The MCP gateway does not call `generateWorkspaceAnswer`; it uses `relayCreateAgentHandoff` and `relaySubmitAgentResult`. Keep retrieval and lifecycle rules out of React components.

`app/api/_lib/relay-service.ts` owns the end-to-end use cases (`relayPreflight`, Semantic Cache reuse, `relayCreateAgentHandoff`, `relaySubmitAgentResult`, refresh and search), so transports cannot bypass lifecycle policy by reimplementing database writes.

## Token accounting contract

`token_estimates` is an audit and authorization record, not only a UI cache.

- `estimated_input_tokens`: exact provider count when configured, otherwise a labelled local approximation; zero for Semantic Cache.
- `max_output_tokens`: configured ceiling, because future output cannot be known exactly.
- `retrieval_input_tokens`: embedding tokens used before routing.
- `claimed_at`: concurrency lock. Only one submission can claim an estimate.
- `actual_input_tokens`, `actual_output_tokens`, `actual_total_tokens`: optional host-agent reported usage, with local estimates used when the MCP host does not expose usage.
- `actual_cached_tokens`: optional host-reported prompt-cache hit; not the same as semantic reuse savings.
- `actual_retrieval_input_tokens`: embedding usage accumulated across preflight/submission.
- `estimated_tokens_saved`: avoided generation estimate for Semantic Cache.

An estimate is rejected if its actor, prompt hash, route, operation, target record, expiry, claim, or consumed state does not match. If an upstream model request fails after claim, the user must estimate again; this prevents accidental duplicate provider calls.

## Three-layer router

1. Semantic Cache: high similarity plus fresh/direct-reuse eligibility. Returns stored answer and makes no main LLM call.
2. RAG: medium similarity or explicit “Generate with team knowledge.” Relay returns only matching fresh summaries/sources to the host agent.
3. Full Generation: low similarity or refresh. Relay returns the bounded valid Workspace context; the host agent decides how to use its own model and prompt cache.

The five knowledge types are `static`, `semi_dynamic`, `dynamic`, `transactional`, and `internal_decision`. Freshness uses `generated_at`, `expires_at`, `allow_direct_reuse`, `requires_refresh`, and `superseded_by`.

## Persistence

- `db/schema.ts`: Drizzle schema source of truth.
- `drizzle/0000...0004`: original MVP schema and lifecycle additions.
- `drizzle/0005_special_risque.sql`: token estimate audit table.
- `drizzle/0006_outgoing_terrax.sql`: atomic estimate claim column.
- `record_embeddings`: 256-dimension `text-embedding-3-small` vectors, including hashed preflight query embeddings to avoid repeating retrieval work on submit.
- `answer_cache`: exact normalized-question lookup.
- `routing_events`: route counts, provider cached tokens, and avoided-generation estimates.
- `model_calls`: provider prompt-cache audit.
- `mcp_events`: MCP member/client activity, tool success and selected route.
- `workspace_files` plus R2 `FILES`: uploaded object metadata and bytes.

Request handlers call `ensureWorkspace()` only to verify required tables and initialize the cache-version row. They never create schema or insert demo content.

## Security and operations

- Hosted identity comes from Sites-managed headers. Do not accept actor names from request JSON.
- Personal keys are request-scoped; never log or persist them.
- Use distinct D1/R2 resources and `RELAY_WORKSPACE_ID` per environment.
- Configure the workspace master key as a secret, not a plain repository variable.
- Apply migrations before deploying application code that expects them.
- Monitor 409 estimate errors, OpenAI 429/5xx rates, route distribution, and estimate-vs-actual deltas.
- Add rate limiting and organization membership/RBAC before opening a public multi-tenant deployment; the current Sites deployment is private and single-workspace.

## Safe change checklist

1. If provider payload fields change, update the shared plan/payload function so token counting and generation remain identical.
2. If route thresholds or freshness change, cover stale, transactional, and superseded cases.
3. If schema changes, run `pnpm db:generate` and inspect the SQL.
4. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
5. Apply migrations to a staging D1 database and smoke-test master and BYOK modes.
6. Deploy production separately; never overwrite the demo project ID.
