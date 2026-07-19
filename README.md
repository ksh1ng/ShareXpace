# Relay Production

Relay is a shared AI workspace and MCP gateway for teams and their personal agents. This directory is the production-oriented edition; the original seeded web demo remains unchanged in `../team-memory`.

The production edition deliberately has no demo seeds, fabricated model answers, anonymous hosted fallback, or shared demo database. It requires migrated D1 storage and authenticated requests. For MCP clients, Relay is now a routing and shared-memory layer rather than an LLM proxy: Semantic Cache returns a stored answer, while RAG and Full Generation return an agent handoff so Codex, ChatGPT, or an IDE agent performs the generation with its own host model.

## Product architecture

```mermaid
flowchart LR
  C[Codex] --> M[/Relay MCP /api/mcp/]
  H[ChatGPT] --> M
  I[IDE / other agent] --> M
  W[Relay Web Dashboard] --> S[Relay domain service]
  M --> S
  S --> P[Required preflight]
  P --> R{Three-layer router}
  R -->|high + fresh| SC[Semantic Cache]
  R -->|medium| RG[RAG agent handoff]
  R -->|low| FG[Full-context agent handoff]
  SC --> D[(D1 shared memory)]
  RG --> A[Host agent / its own model]
  FG --> A
  A -->|relay_submit_result| D
  D --> W
```

The Web API and MCP server share routing and freshness rules in `app/api/_lib/relay-service.ts`. MCP makes `relay_preflight` mandatory before `relay_execute`; RAG and Full Generation then require `relay_submit_result` after the host agent completes the work. The preflight is identity-bound, prompt-bound, expiring and single-use.

## MCP server

The stateless Streamable HTTP-compatible endpoint is `https://<relay-host>/api/mcp`. It exposes:

- `relay_preflight` — performs semantic retrieval, TTL/version validation, input-token estimation, and previews every prompt with Hybrid, raw embedding, and normalized lexical similarity.
- `relay_confirm_route` — records the member's explicit RAG or Full Generation choice and returns a new executable preflight.
- `relay_execute` — returns a Semantic Cache answer or an `agent_action_required` handoff containing fresh context and host-agent instructions.
- `relay_submit_result` — stores the answer produced by the MCP host's model in shared memory and shared chat.
- `relay_search_memory` — read-only shared memory search.
- `relay_refresh_preflight` and `relay_refresh` — refresh a sourced record while preserving the old version.
- `relay_post_update` — return agent progress or results to the shared chat without an LLM call.
- `relay_get_workspace` — read route, savings, memory and MCP activity state.

Resources are available at `relay://workspace/<workspace-id>/{summary,memory,activity,savings}`. The Hackathon Demo uses `RELAY_MCP_JOIN_MODE=workspace_id`: clients append the Workspace ID and an optional display label to the MCP URL, for example `/api/mcp?workspace_id=relay-production&member=Alice`. The Sites dispatch access mode must be `public` so non-browser MCP clients reach the Worker instead of receiving the Sign in with ChatGPT HTML page. The root layout still requires ChatGPT sign-in for the Dashboard, and browser data/write routes enforce authenticated-user headers. MCP calls are recorded in `mcp_events`. Because Streamable HTTP is stateless, the Dashboard defines a connected agent as an actor/client pair with MCP activity inside `RELAY_AGENT_ONLINE_WINDOW_SECONDS` and refreshes that view every ten seconds.

The Dashboard's Shared Knowledge view is intentionally curated: it only includes persisted answers whose routing event proves they were produced through RAG or Full Generation. Semantic Cache reuse, chat, uploads, source records, handoff events, and seeds do not appear as generated team knowledge.

Authenticated Dashboard users can choose **Reset knowledge** and confirm both the current Workspace ID and `RESET SHARED KNOWLEDGE`. The server deletes all Workspace memory records, cached record embeddings, exact-answer cache entries, uploaded source objects/metadata, and pending token estimates, then increments the knowledge version so provider prompt-cache namespaces cannot reuse the deleted context. Shared chat and historical routing/model/MCP analytics are retained.

## Token lifecycle

Every agent action is a two-step transaction:

1. MCP preflight previews the route and always shows Hybrid, raw embedding, and normalized lexical similarity. Exact fingerprints are checked first. Semantic retrieval then uses cached D1 document vectors plus one query embedding; without an embedding credential (or during a provider outage) Relay falls back to lexical retrieval. Semantic Cache reports zero main-model input.
   A fresh exact or high-confidence paraphrase always wins over `generate_with_team_knowledge`; that operation can force RAG only for medium-similarity related questions. Deliberate revision after viewing a cached answer uses `relay_rag_refresh_preflight`.
2. For RAG/Full Generation, Codex asks the member to choose, ends the turn, and waits. `relay_confirm_route` consumes the preview and creates a route-bound executable preflight. Direct execution of an unconfirmed preview is rejected. The UI also displays exact planned input tokens, the configured output ceiling, and estimate expiry.
3. The server validates actor, prompt fingerprint, route, operation, matched record, TTL, and single-use state, then atomically claims the handoff.
4. Semantic Cache finishes immediately and prints the complete stored answer in the MCP response. The host must ask whether the member accepts it or wants a RAG update, end the turn, and wait. Acceptance triggers no tool; only an explicit update reply permits `relay_rag_refresh_preflight` with `confirmedByUser=true`. RAG/Full Generation returns context to the host agent, which generates with its own model and calls `relay_submit_result` to persist the answer and optional host-reported usage. A submitted RAG revision preserves and supersedes the old record.

An output token count cannot be known before generation, so the preflight shows `max_output_tokens`, not a fabricated prediction.

```mermaid
flowchart LR
  U[Member or personal agent] --> E[Token preflight]
  E --> C{Three-layer router}
  C -->|fresh high similarity| S[Semantic Cache\nno main LLM call]
  C -->|medium similarity| R[RAG handoff\nhistorical summaries + sources]
  C -->|low similarity| F[Full-context handoff\nall valid workspace knowledge]
  R --> O[Codex / ChatGPT / IDE host model]
  F --> O
  O -->|relay_submit_result| P[Shared result + optional host usage]
  S --> P
  P --> D[D1 audit + workspace UI]
```

## Production safeguards

- The Sites project is public at the dispatch layer because Codex CLI cannot complete the Dashboard's browser SIWC redirect during MCP initialization. `app/layout.tsx` protects the Dashboard with `requireChatGPTUser`, while browser APIs still call `requireActor`.
- The Hackathon MCP endpoint deliberately accepts the displayed Workspace ID as its join code; this is convenient for a demo but is not a production authorization boundary.
- Token estimates expire, are bound to the member and exact request, and are atomically single-use.
- Stale, transactional, refresh-required, expired, or superseded records cannot be returned by Semantic Cache.
- Refresh creates a new record version and preserves the old record as superseded.
- MCP RAG and Full Generation never call a generation model from Relay or require a Workspace Master generation key.
- Host-agent results are not trusted as fresh until they are submitted through the bound handoff lifecycle.
- Uploads have a 10 MB limit, an allow-listed MIME type, sanitized R2 keys, and metadata stored in D1.
- D1 schema creation is migration-only. Request handlers do not silently create tables or insert seeds.

## Local setup

Requirements: Node.js 22.13+, pnpm, and the Sites/vinext runtime dependencies.

```bash
cp .env.example .env.local
pnpm install
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
```

Apply every SQL file in `drizzle/` to the production D1 database before serving traffic. Set `RELAY_ALLOW_LOCAL_ANONYMOUS=true` only for local development. `GEMINI_API_KEY` enables free-tier multilingual semantic retrieval. `OPENAI_API_KEY` remains optional for exact OpenAI input counting and can also be used as the embedding fallback; the host agent still performs RAG/Full generation.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | recommended | Enables `gemini-embedding-001` semantic retrieval; it is never used for answer generation |
| `RELAY_EMBEDDING_PROVIDER` | no | `auto` (default) prefers Gemini, then OpenAI, then lexical; also accepts `gemini`, `openai`, or `lexical` |
| `OPENAI_API_KEY` | optional | Enables exact OpenAI input counting and provides an embedding fallback; MCP generation remains in the host agent |
| `RELAY_APP_MODE` | yes | Set to `production` |
| `RELAY_WORKSPACE_ID` | yes | Stable D1 partition and prompt-cache namespace |
| `RELAY_WORKSPACE_NAME` | yes | Human-readable workspace name shown by the Dashboard and MCP workspace status |
| `RELAY_SEMANTIC_CACHE_THRESHOLD` | no | High-similarity direct reuse threshold; default `0.78` |
| `RELAY_SEMANTIC_EMBEDDING_THRESHOLD` | no | Raw embedding similarity that independently permits fresh direct reuse; default `0.80` |
| `RELAY_LEXICAL_CACHE_THRESHOLD` | no | Conservative normalized lexical score that independently permits fresh direct reuse; default `0.88` |
| `RELAY_RAG_THRESHOLD` | no | Medium-similarity RAG threshold; default `0.42` |
| `RELAY_DEFAULT_TTL_HOURS` | no | Default TTL for dynamic knowledge; default `24` |
| `RELAY_TOKEN_ESTIMATE_TTL_SECONDS` | no | Preflight validity window; minimum 60, default `300` |
| `RELAY_MAX_OUTPUT_TOKENS` | no | Generation output ceiling; default `1200` |
| `RELAY_MAX_INPUT_TOKENS` | no | Workspace input safety limit; default `100000` |
| `RELAY_ALLOW_LOCAL_ANONYMOUS` | local only | Explicitly permits a local anonymous actor |
| `RELAY_MCP_JOIN_MODE` | yes | `workspace_id` for the Hackathon Demo; use `bearer_token` for stricter deployments |
| `RELAY_MCP_ACCESS_TOKENS` | bearer mode only | Optional secret JSON map of bearer tokens to workspace member names |
| `RELAY_AGENT_ONLINE_WINDOW_SECONDS` | no | Recent MCP activity window used for Connected Agents; minimum `30`, default `120` |

Bindings are declared in `.openai/hosting.json`: D1 as `DB` and R2 as `FILES`. Hosted access is private by default through Sites authentication.

Embedding vectors for prior question titles are generated once and cached in D1 by model, purpose version, and dimension. A query creates only one new embedding; exact duplicate questions bypass the embedding provider entirely. Gemini uses `SEMANTIC_SIMILARITY` at 768 dimensions for both the current and stored prompts, so the displayed raw score is a true prompt-to-prompt comparison. Answer summaries remain RAG context and do not contaminate this score. Provider failures degrade to lexical matching, but the preview explicitly labels `lexical_fallback` and reports the sanitized provider error instead of presenting 0% as a real Gemini score. OpenAI keeps the existing 256-dimensional `text-embedding-3-small` fallback path.

Semantic Cache eligibility accepts the configured Hybrid threshold, an independently high raw embedding score (80% by default), or a conservative normalized lexical score (88% by default), provided TTL and direct-reuse checks pass. Lexical matching normalizes common number words and equivalent budget wording, so paraphrases such as `five-day`/`5-day`, `one`/`1`, and `moderate`/`affordable` remain reusable even during an embedding-provider outage or conservative embedding result.

## Verification

`pnpm test` performs a production build and source-level contract tests for authentication, MCP tools/resources, agent handoff/submission, shared routing, estimate binding/claiming, stale-cache blocking, migration coverage, and the production UI. Live provider calls are intentionally not made in CI.

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the file-to-flow handoff guide and [DEMO_GUIDE.md](./DEMO_GUIDE.md) for the complete Chinese demo runbook, prompts, MCP examples and troubleshooting checklist.

## Official implementation references

- [OpenAI input token counting](https://platform.openai.com/docs/api-reference/responses/input-tokens)
- [OpenAI prompt caching](https://platform.openai.com/docs/guides/prompt-caching)
- [OpenAI Apps SDK MCP server quickstart](https://developers.openai.com/apps-sdk/quickstart#mcp-server-with-apps-sdk-resources)
- [Prompt Cache: Modular Attention Reuse for Low-Latency Inference](https://proceedings.mlsys.org/paper_files/paper/2024/file/a66caa1703fe34705a4368c3014c1966-Paper-Conference.pdf)
