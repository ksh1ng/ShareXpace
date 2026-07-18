import { env } from "cloudflare:workers";

export type KnowledgeType = "static" | "semi_dynamic" | "dynamic" | "transactional" | "internal_decision";
export type DefenseRoute = "semantic_cache" | "rag" | "full_generation";
export type BillingMode = "master" | "personal";
export type TokenOperation = "auto" | "generate_with_team_knowledge" | "refresh";

type RuntimeEnv = {
  DB: D1Database;
  FILES?: R2Bucket;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  RELAY_EMBEDDING_PROVIDER?: string;
  RELAY_APP_MODE?: string;
  RELAY_WORKSPACE_ID?: string;
  RELAY_WORKSPACE_NAME?: string;
  RELAY_SEMANTIC_CACHE_THRESHOLD?: string;
  RELAY_RAG_THRESHOLD?: string;
  RELAY_DEFAULT_TTL_HOURS?: string;
  RELAY_TOKEN_ESTIMATE_TTL_SECONDS?: string;
  RELAY_MAX_OUTPUT_TOKENS?: string;
  RELAY_MAX_INPUT_TOKENS?: string;
  RELAY_ALLOW_LOCAL_ANONYMOUS?: string;
  RELAY_MCP_ACCESS_TOKENS?: string;
};

export type MemoryRow = {
  id: string;
  workspace_id: string;
  kind: "answer" | "source" | "file";
  title: string;
  detail: string;
  author: string;
  agent: string;
  model: string | null;
  token_count: number;
  created_at: string;
  knowledge_type: KnowledgeType;
  expires_at: string | null;
  generated_at: string | null;
  allow_direct_reuse: number;
  requires_refresh: number;
  superseded_by: string | null;
  source_url: string | null;
  summary: string | null;
  version: number;
};

export type FileRow = {
  id: string;
  workspace_id: string;
  name: string;
  content_type: string;
  size: number;
  object_key: string;
  author: string;
  created_at: string;
};

export type ChatRow = {
  id: string;
  workspace_id: string;
  author: string;
  message_type: "discussion" | "task" | "agent";
  content: string;
  agent: string | null;
  model: string | null;
  billing_mode: "master" | "personal" | "cache" | null;
  task_status: "queued" | "running" | "done" | "failed" | null;
  source_message_id: string | null;
  created_at: string;
};

export type TokenEstimateRow = {
  id: string;
  workspace_id: string;
  actor: string;
  question_fingerprint: string;
  operation: TokenOperation;
  route: DefenseRoute;
  model: string;
  record_id: string | null;
  estimated_input_tokens: number;
  max_output_tokens: number;
  estimated_saved_tokens: number;
  retrieval_input_tokens: number;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  consumed_at: string | null;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  actual_total_tokens: number | null;
  actual_cached_tokens: number | null;
  actual_retrieval_input_tokens: number | null;
};

export class ApiError extends Error {
  constructor(message: string, public status = 400, public code = "bad_request") {
    super(message);
  }
}

export function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

function numberSetting(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function workspaceId() {
  return runtimeEnv().RELAY_WORKSPACE_ID?.trim() || "relay-production";
}

export function workspaceName() {
  return runtimeEnv().RELAY_WORKSPACE_NAME?.trim() || "Relay Production";
}

export function appMode() {
  return runtimeEnv().RELAY_APP_MODE?.trim() || "production";
}

export function tokenLimits() {
  const current = runtimeEnv();
  return {
    estimateTtlSeconds: Math.max(60, numberSetting(current.RELAY_TOKEN_ESTIMATE_TTL_SECONDS, 300)),
    maxOutputTokens: Math.max(64, numberSetting(current.RELAY_MAX_OUTPUT_TOKENS, 1200)),
    maxInputTokens: Math.max(1024, numberSetting(current.RELAY_MAX_INPUT_TOKENS, 100_000)),
  };
}

export function routeThresholds() {
  const current = runtimeEnv();
  return {
    semantic: numberSetting(current.RELAY_SEMANTIC_CACHE_THRESHOLD, 0.78),
    rag: numberSetting(current.RELAY_RAG_THRESHOLD, 0.42),
  };
}

export function expiresAtFor(type: KnowledgeType, generatedAt = new Date()) {
  const defaultHours = numberSetting(runtimeEnv().RELAY_DEFAULT_TTL_HOURS, 24);
  const hours: Record<KnowledgeType, number | null> = {
    static: 24 * 30,
    semi_dynamic: 24 * 7,
    dynamic: defaultHours,
    transactional: 0.25,
    internal_decision: null,
  };
  const ttl = hours[type];
  return ttl === null ? null : new Date(generatedAt.getTime() + ttl * 3_600_000).toISOString();
}

export function freshness(record: MemoryRow, now = Date.now()) {
  const expired = Boolean(record.expires_at && new Date(record.expires_at).getTime() <= now);
  const refreshRequired = Boolean(record.requires_refresh);
  const superseded = Boolean(record.superseded_by);
  const fresh = !expired && !refreshRequired && !superseded;
  const reason = superseded ? "superseded" : refreshRequired ? "refresh_required" : expired ? "ttl_expired" : null;
  return {
    fresh,
    expired,
    refreshRequired,
    superseded,
    reason,
    directReuseAllowed: fresh && Boolean(record.allow_direct_reuse) && record.knowledge_type !== "transactional",
  };
}

export function actorFrom(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email");
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall back to the verified email header.
    }
  }
  return email?.split("@")[0] || null;
}

export function requireActor(request: Request) {
  const actor = actorFrom(request);
  if (actor) return actor;
  if (runtimeEnv().RELAY_ALLOW_LOCAL_ANONYMOUS === "true") return "Local Developer";
  throw new ApiError("Authentication is required.", 401, "authentication_required");
}

function configuredMcpTokens() {
  const raw = runtimeEnv().RELAY_MCP_ACCESS_TOKENS?.trim();
  if (!raw) return new Map<string, string>();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Map(Object.entries(parsed).filter((entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1].trim())));
  } catch {
    throw new ApiError("RELAY_MCP_ACCESS_TOKENS must be a JSON object mapping bearer tokens to member names.", 503, "mcp_auth_configuration_invalid");
  }
}

async function sameSecret(left: string, right: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  if (a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index += 1) different |= a[index] ^ b[index];
  return different === 0;
}

export async function requireMcpActor(request: Request) {
  const sitesActor = actorFrom(request);
  if (sitesActor) return sitesActor;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const configured = configuredMcpTokens();
  for (const [token, actor] of configured) {
    if (supplied && await sameSecret(token, supplied)) return actor.trim();
  }
  if (runtimeEnv().RELAY_ALLOW_LOCAL_ANONYMOUS === "true") return "Local MCP Developer";
  throw new ApiError("A valid Relay MCP bearer token is required.", 401, "mcp_authentication_required");
}

export function validateQuestion(value: unknown) {
  const question = typeof value === "string" ? value.trim() : "";
  if (!question) throw new ApiError("Question is required.", 400, "question_required");
  if (question.length > 20_000) throw new ApiError("Question is too long.", 413, "question_too_long");
  return question;
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : fallback, code: "internal_error" }, { status: 500 });
}

export function resolveApiKey(billingMode: BillingMode, personalApiKey?: string) {
  const apiKey = billingMode === "personal" ? personalApiKey?.trim() : runtimeEnv().OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ApiError(
      billingMode === "personal" ? "Add your personal OpenAI API key." : "The Workspace Master API key is not configured.",
      503,
      billingMode === "personal" ? "personal_api_key_required" : "master_api_key_unavailable",
    );
  }
  return apiKey;
}

export async function ensureWorkspace() {
  const { DB } = runtimeEnv();
  const id = workspaceId();
  try {
    await DB.prepare("SELECT id FROM memory_records WHERE workspace_id = ? LIMIT 1").bind(id).first();
    await DB.prepare("SELECT claimed_at FROM token_estimates WHERE workspace_id = ? LIMIT 1").bind(id).first();
  } catch {
    throw new ApiError("Database migrations have not been applied.", 503, "database_not_ready");
  }
  await DB.prepare("INSERT OR IGNORE INTO workspace_cache_state (workspace_id, knowledge_version, updated_at) VALUES (?, 1, ?)")
    .bind(id, new Date().toISOString())
    .run();
}

export async function getChatMessages() {
  await ensureWorkspace();
  return (await runtimeEnv().DB.prepare("SELECT * FROM chat_messages WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 120")
    .bind(workspaceId())
    .all<ChatRow>()).results;
}

export function normalizeQuestion(value: string) {
  return value.toLowerCase().normalize("NFKC").replace(/[^a-z0-9\u3400-\u9fff\s]/g, " ").replace(/\s+/g, " ").trim();
}

export async function questionFingerprint(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeQuestion(value)));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function cacheAnswer(question: string, recordId: string, createdAt: string) {
  await runtimeEnv().DB.prepare("INSERT OR REPLACE INTO answer_cache (workspace_id, question_fingerprint, record_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(workspaceId(), await questionFingerprint(question), recordId, createdAt)
    .run();
}

export async function getKnowledgeVersion() {
  return (await runtimeEnv().DB.prepare("SELECT knowledge_version FROM workspace_cache_state WHERE workspace_id = ?")
    .bind(workspaceId())
    .first<{ knowledge_version: number }>())?.knowledge_version ?? 1;
}

export async function bumpKnowledgeVersion() {
  await runtimeEnv().DB.prepare("UPDATE workspace_cache_state SET knowledge_version = knowledge_version + 1, updated_at = ? WHERE workspace_id = ?")
    .bind(new Date().toISOString(), workspaceId())
    .run();
  return getKnowledgeVersion();
}

export async function recordRoutingEvent(input: {
  route: DefenseRoute;
  action: "reuse" | "generate" | "refresh" | "agent_handoff" | "agent_result";
  similarity?: number;
  actualCachedTokens?: number;
  estimatedTokensSaved?: number;
  recordId?: string | null;
}) {
  await runtimeEnv().DB.prepare(`INSERT INTO routing_events
    (id, workspace_id, route, action, similarity, actual_cached_tokens, estimated_tokens_saved, record_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      workspaceId(),
      input.route,
      input.action,
      input.similarity ?? 0,
      input.actualCachedTokens ?? 0,
      input.estimatedTokensSaved ?? 0,
      input.recordId ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function recordMcpEvent(input: {
  actor: string;
  clientName: string;
  method: string;
  toolName?: string | null;
  success: boolean;
  route?: DefenseRoute | null;
}) {
  await ensureWorkspace();
  await runtimeEnv().DB.prepare(`INSERT INTO mcp_events
    (id, workspace_id, actor, client_name, method, tool_name, success, route, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      workspaceId(),
      input.actor,
      input.clientName.slice(0, 120),
      input.method.slice(0, 120),
      input.toolName?.slice(0, 120) ?? null,
      input.success ? 1 : 0,
      input.route ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function createTokenEstimate(input: {
  actor: string;
  question: string;
  operation: TokenOperation;
  route: DefenseRoute;
  model: string;
  recordId?: string | null;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  estimatedSavedTokens?: number;
  retrievalInputTokens?: number;
}) {
  const { DB } = runtimeEnv();
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + tokenLimits().estimateTtlSeconds * 1000);
  await DB.prepare(`INSERT INTO token_estimates
    (id, workspace_id, actor, question_fingerprint, operation, route, model, record_id,
     estimated_input_tokens, max_output_tokens, estimated_saved_tokens, retrieval_input_tokens, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      workspaceId(),
      input.actor,
      await questionFingerprint(input.question),
      input.operation,
      input.route,
      input.model,
      input.recordId ?? null,
      input.estimatedInputTokens,
      input.maxOutputTokens,
      input.estimatedSavedTokens ?? 0,
      input.retrievalInputTokens ?? 0,
      createdAt.toISOString(),
      expiresAt.toISOString(),
    )
    .run();
  return {
    id,
    route: input.route,
    operation: input.operation,
    model: input.model,
    recordId: input.recordId ?? null,
    inputTokens: input.estimatedInputTokens,
    maxOutputTokens: input.maxOutputTokens,
    totalTokenCeiling: input.estimatedInputTokens + input.maxOutputTokens + (input.retrievalInputTokens ?? 0),
    estimatedSavedTokens: input.estimatedSavedTokens ?? 0,
    retrievalInputTokens: input.retrievalInputTokens ?? 0,
    expiresAt: expiresAt.toISOString(),
    source: input.route === "semantic_cache" ? "semantic_cache" : "openai_input_token_count",
  };
}

export async function requireTokenEstimate(input: {
  estimateId: string;
  actor: string;
  question: string;
  route: DefenseRoute;
  operation: TokenOperation;
  recordId?: string | null;
}) {
  const estimate = await runtimeEnv().DB.prepare("SELECT * FROM token_estimates WHERE id = ? AND workspace_id = ?")
    .bind(input.estimateId, workspaceId())
    .first<TokenEstimateRow>();
  if (!estimate) throw new ApiError("Token estimate not found. Estimate again before sending.", 409, "estimate_not_found");
  if (estimate.actor !== input.actor) throw new ApiError("This token estimate belongs to another user.", 403, "estimate_actor_mismatch");
  if (estimate.claimed_at) throw new ApiError("This token estimate is already being processed. Estimate again.", 409, "estimate_claimed");
  if (estimate.consumed_at) throw new ApiError("This token estimate was already used. Estimate again.", 409, "estimate_consumed");
  if (new Date(estimate.expires_at).getTime() <= Date.now()) throw new ApiError("This token estimate expired. Estimate again.", 409, "estimate_expired");
  if (estimate.question_fingerprint !== await questionFingerprint(input.question)) throw new ApiError("The prompt changed after estimation. Estimate again.", 409, "estimate_prompt_changed");
  if (estimate.route !== input.route || estimate.operation !== input.operation) throw new ApiError("The route changed after estimation. Estimate again.", 409, "estimate_route_changed");
  if ((estimate.record_id ?? null) !== (input.recordId ?? null)) throw new ApiError("Workspace knowledge changed after estimation. Estimate again.", 409, "estimate_record_changed");
  return estimate;
}

export async function claimTokenEstimate(estimateId: string) {
  const result = await runtimeEnv().DB.prepare(`UPDATE token_estimates
    SET claimed_at = ?
    WHERE id = ? AND workspace_id = ? AND claimed_at IS NULL AND consumed_at IS NULL`)
    .bind(new Date().toISOString(), estimateId, workspaceId())
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ApiError("This token estimate is already being processed. Estimate again.", 409, "estimate_claimed");
  }
}

export async function consumeTokenEstimate(input: {
  estimateId: string;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualTotalTokens: number;
  actualCachedTokens: number;
  actualRetrievalInputTokens?: number;
}) {
  await runtimeEnv().DB.prepare(`UPDATE token_estimates
    SET consumed_at = ?, actual_input_tokens = ?, actual_output_tokens = ?, actual_total_tokens = ?, actual_cached_tokens = ?, actual_retrieval_input_tokens = ?
    WHERE id = ? AND workspace_id = ? AND claimed_at IS NOT NULL AND consumed_at IS NULL`)
    .bind(
      new Date().toISOString(),
      input.actualInputTokens,
      input.actualOutputTokens,
      input.actualTotalTokens,
      input.actualCachedTokens,
      input.actualRetrievalInputTokens ?? 0,
      input.estimateId,
      workspaceId(),
    )
    .run();
}

export async function getWorkspaceState() {
  await ensureWorkspace();
  const { DB, OPENAI_API_KEY } = runtimeEnv();
  const id = workspaceId();
  const name = workspaceName();
  const [records, files, reuse, model, cacheState, routes, estimated, preflights, mcpMembers, mcpEvents] = await Promise.all([
    DB.prepare("SELECT * FROM memory_records WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 80").bind(id).all<MemoryRow>(),
    DB.prepare("SELECT * FROM workspace_files WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 30").bind(id).all<FileRow>(),
    DB.prepare("SELECT COUNT(*) AS duplicates FROM reuse_events WHERE workspace_id = ?").bind(id).first<{ duplicates: number }>(),
    DB.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(cached_tokens), 0) AS cached_tokens, COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens FROM model_calls WHERE workspace_id = ?").bind(id).first<{ calls: number; cached_tokens: number; cache_write_tokens: number }>(),
    DB.prepare("SELECT knowledge_version FROM workspace_cache_state WHERE workspace_id = ?").bind(id).first<{ knowledge_version: number }>(),
    DB.prepare("SELECT route, COUNT(*) AS count FROM routing_events WHERE workspace_id = ? GROUP BY route").bind(id).all<{ route: DefenseRoute; count: number }>(),
    DB.prepare("SELECT COALESCE(SUM(estimated_tokens_saved), 0) AS saved FROM routing_events WHERE workspace_id = ?").bind(id).first<{ saved: number }>(),
    DB.prepare("SELECT COUNT(*) AS count FROM token_estimates WHERE workspace_id = ?").bind(id).first<{ count: number }>(),
    DB.prepare("SELECT actor, client_name, MAX(created_at) AS last_seen, COUNT(*) AS calls FROM mcp_events WHERE workspace_id = ? GROUP BY actor, client_name ORDER BY last_seen DESC LIMIT 20").bind(id).all<{ actor: string; client_name: string; last_seen: string; calls: number }>(),
    DB.prepare("SELECT actor, client_name, method, tool_name, success, route, created_at FROM mcp_events WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 30").bind(id).all<{ actor: string; client_name: string; method: string; tool_name: string | null; success: number; route: DefenseRoute | null; created_at: string }>(),
  ]);
  const routeCounts = { semanticCache: 0, rag: 0, fullGeneration: 0 };
  for (const row of routes.results) {
    if (row.route === "semantic_cache") routeCounts.semanticCache = row.count;
    if (row.route === "rag") routeCounts.rag = row.count;
    if (row.route === "full_generation") routeCounts.fullGeneration = row.count;
  }
  return {
    records: records.results,
    files: files.results,
    stats: { duplicates: reuse?.duplicates ?? 0, tokensSaved: estimated?.saved ?? 0 },
    defense: {
      routes: routeCounts,
      actualCachedTokens: model?.cached_tokens ?? 0,
      estimatedTokensSaved: estimated?.saved ?? 0,
      preflightCount: preflights?.count ?? 0,
    },
    promptCache: {
      calls: model?.calls ?? 0,
      cachedTokens: model?.cached_tokens ?? 0,
      cacheWriteTokens: model?.cache_write_tokens ?? 0,
      knowledgeVersion: cacheState?.knowledge_version ?? 1,
    },
    modelReady: Boolean(OPENAI_API_KEY?.trim()),
    embedding: (() => {
      const status = embeddingProviderStatus();
      return { ready: status.ready, provider: status.provider, model: status.model, dimensions: status.dimensions };
    })(),
    mcp: {
      enabled: configuredMcpTokens().size > 0 || runtimeEnv().RELAY_ALLOW_LOCAL_ANONYMOUS === "true",
      members: mcpMembers.results.map((member) => ({ actor: member.actor, clientName: member.client_name, lastSeen: member.last_seen, calls: member.calls })),
      events: mcpEvents.results.map((event) => ({ actor: event.actor, clientName: event.client_name, method: event.method, toolName: event.tool_name, success: Boolean(event.success), route: event.route, createdAt: event.created_at })),
    },
    appMode: appMode(),
    workspaceId: id,
    workspaceName: name,
    workspace: { id, name },
  };
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "best", "do", "for", "how", "i", "is", "of", "our", "the", "to", "we", "what", "which", "with"]);
const SYNONYMS: Record<string, string> = { jr: "rail", railway: "rail", train: "rail", trains: "rail", ticket: "pass", tickets: "pass", travelling: "travel" };

function terms(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map((term) => SYNONYMS[term] ?? term).filter((term) => !STOP_WORDS.has(term)));
}

export function similarity(left: string, right: string) {
  const a = terms(left);
  const b = terms(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((term) => b.has(term)).length;
  return Math.min(0.98, (intersection / Math.min(a.size, b.size)) * 0.82 + (intersection / new Set([...a, ...b]).size) * 0.18);
}

type EmbeddingResponse = {
  data?: Array<{ index: number; embedding: number[] }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
};

type GeminiEmbeddingResponse = {
  embeddings?: Array<{ values?: number[] }>;
  usageMetadata?: { promptTokenCount?: number };
};

type EmbeddingProvider = {
  kind: "gemini" | "openai";
  model: string;
  dimensions: number;
  apiKey: string;
};

export function embeddingProviderStatus(openAiApiKey?: string) {
  const current = runtimeEnv();
  const preference = current.RELAY_EMBEDDING_PROVIDER?.trim().toLowerCase() || "auto";
  const geminiKey = current.GEMINI_API_KEY?.trim();
  const openAiKey = openAiApiKey?.trim() || current.OPENAI_API_KEY?.trim();
  const provider: EmbeddingProvider | null = preference === "lexical"
    ? null
    : preference === "gemini"
      ? geminiKey ? { kind: "gemini", model: "gemini-embedding-001", dimensions: 768, apiKey: geminiKey } : null
      : preference === "openai"
        ? openAiKey ? { kind: "openai", model: "text-embedding-3-small", dimensions: 256, apiKey: openAiKey } : null
        : geminiKey
          ? { kind: "gemini", model: "gemini-embedding-001", dimensions: 768, apiKey: geminiKey }
          : openAiKey
            ? { kind: "openai", model: "text-embedding-3-small", dimensions: 256, apiKey: openAiKey }
            : null;
  return {
    ready: Boolean(provider),
    provider: provider?.kind ?? "lexical",
    model: provider?.model ?? null,
    dimensions: provider?.dimensions ?? 0,
    preference,
    config: provider,
  };
}

async function createOpenAiEmbeddings(provider: EmbeddingProvider, inputs: string[]) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: provider.model, input: inputs, encoding_format: "float", dimensions: provider.dimensions }),
  });
  if (!response.ok) throw new ApiError(`Embedding request failed (${response.status}).`, 502, "embedding_failed");
  const data = await response.json() as EmbeddingResponse;
  return {
    vectors: (data.data ?? []).sort((a, b) => a.index - b.index).map((item) => item.embedding),
    inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0,
  };
}

async function createGeminiEmbeddings(provider: EmbeddingProvider, query: string, documents: string[]) {
  const requests = [
    { text: query, taskType: "RETRIEVAL_QUERY" },
    ...documents.map((text) => ({ text, taskType: "RETRIEVAL_DOCUMENT" })),
  ];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:batchEmbedContents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": provider.apiKey },
    body: JSON.stringify({
      requests: requests.map((request) => ({
        model: `models/${provider.model}`,
        content: { parts: [{ text: request.text }] },
        taskType: request.taskType,
        outputDimensionality: provider.dimensions,
        autoTruncate: true,
      })),
    }),
  });
  if (!response.ok) throw new ApiError(`Gemini embedding request failed (${response.status}).`, 502, "embedding_failed");
  const data = await response.json() as GeminiEmbeddingResponse;
  return {
    vectors: (data.embeddings ?? []).map((item) => item.values ?? []),
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
  };
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    left += a[index] ** 2;
    right += b[index] ** 2;
  }
  return left && right ? dot / (Math.sqrt(left) * Math.sqrt(right)) : 0;
}

export async function retrieveWorkspaceAnswers(question: string, apiKey?: string, limit = 3) {
  await ensureWorkspace();
  const { DB } = runtimeEnv();
  const id = workspaceId();
  const exact = await DB.prepare(`SELECT memory_records.* FROM answer_cache
    JOIN memory_records ON memory_records.id = answer_cache.record_id
    WHERE answer_cache.workspace_id = ? AND answer_cache.question_fingerprint = ? LIMIT 1`)
    .bind(id, await questionFingerprint(question))
    .first<MemoryRow>();
  if (exact) {
    return { matches: [{ record: exact, score: 1, lexicalScore: 1, semanticScore: 1, matchType: "exact" as const, retrievalMode: "exact" as const, freshness: freshness(exact) }], embeddingInputTokens: 0 };
  }

  const results = (await DB.prepare("SELECT * FROM memory_records WHERE workspace_id = ? AND kind = 'answer' AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 80")
    .bind(id)
    .all<MemoryRow>()).results;
  if (!results.length) return { matches: [], embeddingInputTokens: 0 };
  const lexical = results.map((record) => ({ record, lexicalScore: similarity(question, `${record.title} ${record.summary ?? ""}`) }));

  // MCP hosts already have an LLM. When Relay has no embedding credential, keep
  // routing local and deterministic instead of blocking the agent handoff.
  const embedding = embeddingProviderStatus(apiKey);
  if (!embedding.config) {
    const matches = lexical.map((item) => ({
      ...item,
      score: item.lexicalScore,
      semanticScore: 0,
      matchType: "similar" as const,
      retrievalMode: "lexical" as const,
      freshness: freshness(item.record),
    })).sort((a, b) => b.score - a.score).slice(0, limit);
    return { matches, embeddingInputTokens: 0, embeddingProvider: "lexical" as const };
  }

  const provider = embedding.config;
  const stored = await DB.prepare("SELECT record_id, embedding_json FROM record_embeddings WHERE workspace_id = ? AND model = ? AND dimensions = ?")
    .bind(id, provider.model, provider.dimensions)
    .all<{ record_id: string; embedding_json: string }>();
  const vectors = new Map(stored.results.map((row) => [row.record_id, JSON.parse(row.embedding_json) as number[]]));
  const missing = results.filter((record) => !vectors.has(record.id));
  const documents = missing.map((record) => `${record.title}\n${record.summary ?? record.detail}`);
  let generated: { vectors: number[][]; inputTokens: number };
  try {
    generated = provider.kind === "gemini"
      ? await createGeminiEmbeddings(provider, question, documents)
      : await createOpenAiEmbeddings(provider, [question, ...documents]);
  } catch {
    const matches = lexical.map((item) => ({
      ...item,
      score: item.lexicalScore,
      semanticScore: 0,
      matchType: "similar" as const,
      retrievalMode: "lexical" as const,
      freshness: freshness(item.record),
    })).sort((a, b) => b.score - a.score).slice(0, limit);
    return { matches, embeddingInputTokens: 0, embeddingProvider: "lexical_fallback" as const };
  }
  let cursor = 1;
  const query = generated.vectors[0];
  if (!query) throw new ApiError("Embedding response was empty.", 502, "embedding_empty");
  if (missing.length) {
    await DB.batch(missing.map((record) => {
      const vector = generated.vectors[cursor] ?? [];
      cursor += 1;
      vectors.set(record.id, vector);
      return DB.prepare("INSERT OR REPLACE INTO record_embeddings (record_id, workspace_id, model, dimensions, embedding_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(record.id, id, provider.model, provider.dimensions, JSON.stringify(vector), new Date().toISOString());
    }));
  }
  const matches = lexical.map((item) => {
    const semanticScore = Math.max(0, cosineSimilarity(query, vectors.get(item.record.id) ?? []));
    return {
      ...item,
      score: semanticScore * 0.76 + item.lexicalScore * 0.24,
      semanticScore,
      matchType: "hybrid" as const,
      retrievalMode: "hybrid" as const,
      freshness: freshness(item.record),
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  return { matches, embeddingInputTokens: generated.inputTokens, embeddingProvider: provider.kind };
}

export function classifyDefenseRoute(
  match: Awaited<ReturnType<typeof retrieveWorkspaceAnswers>>["matches"][number] | null,
  operation: TokenOperation = "auto",
): DefenseRoute {
  if (operation === "refresh") return "full_generation";
  const thresholds = routeThresholds();
  if (!match || match.score < thresholds.rag) return "full_generation";
  if (operation === "generate_with_team_knowledge") return "rag";
  if (match.score >= thresholds.semantic && match.freshness.directReuseAllowed) return "semantic_cache";
  return "rag";
}

export async function findBestMatch(question: string, apiKey?: string) {
  const retrieval = await retrieveWorkspaceAnswers(question, apiKey, 1);
  return { match: retrieval.matches[0] ?? null, embeddingInputTokens: retrieval.embeddingInputTokens };
}

export function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}
