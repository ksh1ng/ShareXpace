import {
  ApiError,
  cacheAnswer,
  claimTokenEstimate,
  classifyDefenseRoute,
  consumeTokenEstimate,
  createTokenEstimate,
  expiresAtFor,
  freshness,
  getKnowledgeVersion,
  getWorkspaceState,
  recordRoutingEvent,
  requireTokenEstimate,
  resolveApiKey,
  retrieveWorkspaceAnswers,
  routeThresholds,
  runtimeEnv,
  tokenLimits,
  workspaceId,
  type BillingMode,
  type DefenseRoute,
  type KnowledgeType,
  type MemoryRow,
  type TokenOperation,
} from "./workspace";

export type { BillingMode } from "./workspace";

const MODEL = "gpt-5.6";
const INSTRUCTIONS = "You are a personal agent collaborating inside a shared team workspace. Use only valid, non-superseded knowledge. Never present expired or refresh-required records as current facts. Cite supplied source URLs when they support a claim. Give a concise actionable result for the whole group.";

type OpenAIResponse = {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
};

type InputTokenCountResponse = {
  object?: "response.input_tokens";
  input_tokens?: number;
};

type WorkspacePlan = {
  route: DefenseRoute;
  operation: TokenOperation;
  best: Awaited<ReturnType<typeof retrieveWorkspaceAnswers>>["matches"][number] | null;
  retrievalInputTokens: number;
  recordId: string | null;
  promptCacheKey: string;
  knowledgeVersion: number;
  requestInput: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  retrieval: {
    mode: string;
    sources: Array<{ id: string; title: string; score: number; summary: string | null; sourceUrl: string | null }>;
  };
};

function outputText(response: OpenAIResponse) {
  return (response.output ?? [])
    .flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .filter((part) => part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function safetyIdentifier(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.toLowerCase()));
  return `relay_${Array.from(new Uint8Array(hash)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function contextLine(record: MemoryRow) {
  return `- [${record.knowledge_type} v${record.version}] ${record.title}: ${record.summary ?? record.detail}${record.source_url ? ` (Source: ${record.source_url})` : ""}`;
}

async function buildWorkspacePlan(input: {
  question: string;
  apiKey?: string;
  operation: TokenOperation;
  sourceUrl?: string | null;
  targetRecordId?: string | null;
}) : Promise<WorkspacePlan> {
  const { DB } = runtimeEnv();
  const retrievalResult = await retrieveWorkspaceAnswers(input.question, input.apiKey, 5);
  const retrieved = retrievalResult.matches;
  const best = retrieved[0] ?? null;
  const route = classifyDefenseRoute(best, input.operation);
  const validRetrieved = retrieved.filter((match) => match.freshness.fresh);
  const allRows = (await DB.prepare("SELECT * FROM memory_records WHERE workspace_id = ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 100")
    .bind(workspaceId())
    .all<MemoryRow>()).results;
  const validRows = allRows.filter((record) => freshness(record).fresh);
  const stableRows = validRows.filter((record) => record.knowledge_type === "static" || record.knowledge_type === "internal_decision");
  const dynamicRows = validRows.filter((record) => record.knowledge_type !== "static" && record.knowledge_type !== "internal_decision");
  const ragRows = validRetrieved.filter((match) => match.score >= routeThresholds().rag).slice(0, 5);
  const stableContext = stableRows.map(contextLine).join("\n") || "No stable workspace knowledge is available.";
  const dynamicContext = route === "rag"
    ? ragRows.map((match) => `${contextLine(match.record)} [retrieval confidence ${Math.round(match.score * 100)}%]`).join("\n")
    : dynamicRows.map(contextLine).join("\n");
  const refreshInstruction = input.operation === "refresh" && input.sourceUrl
    ? `Refresh target source: ${input.sourceUrl}\nUse current source information and explicitly note uncertainty if the source cannot be verified.`
    : "";
  const knowledgeVersion = await getKnowledgeVersion();
  const promptCacheKey = `relay:${workspaceId()}:stable-v${knowledgeVersion}`;
  const requestInput = [{
    role: "user",
    content: [
      {
        type: "input_text",
        text: `Stable workspace policy and knowledge (version ${knowledgeVersion}):\n${stableContext}`,
        prompt_cache_breakpoint: { mode: "explicit" },
      },
      {
        type: "input_text",
        text: `${route === "rag" ? "Retrieved historical summaries and sources" : "Complete valid dynamic workspace context"}:\n${dynamicContext || "No valid dynamic context is available."}\n${refreshInstruction}`,
      },
      { type: "input_text", text: `Current member request:\n${input.question}` },
    ],
  }];
  const tools = input.operation === "refresh" && input.sourceUrl ? [{ type: "web_search" }] : undefined;
  const recordId = input.operation === "refresh"
    ? input.targetRecordId ?? null
    : route === "full_generation" ? null : best?.record.id ?? null;
  return {
    route,
    operation: input.operation,
    best,
    retrievalInputTokens: retrievalResult.embeddingInputTokens,
    recordId,
    promptCacheKey,
    knowledgeVersion,
    requestInput,
    tools,
    retrieval: {
      mode: best?.retrievalMode ?? "hybrid",
      sources: (route === "rag" ? ragRows : []).map((match) => ({
        id: match.record.id,
        title: match.record.title,
        score: Math.round(match.score * 100),
        summary: match.record.summary,
        sourceUrl: match.record.source_url,
      })),
    },
  };
}

function inputTokenPayload(plan: WorkspacePlan) {
  return {
    model: MODEL,
    instructions: INSTRUCTIONS,
    input: plan.requestInput,
    ...(plan.tools ? { tools: plan.tools } : {}),
  };
}

function approximateInputTokens(plan: WorkspacePlan) {
  return Math.max(1, Math.ceil(JSON.stringify(inputTokenPayload(plan)).length / 4));
}

async function countInputTokens(apiKey: string, plan: WorkspacePlan) {
  const response = await fetch("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(inputTokenPayload(plan)),
  });
  if (!response.ok) throw new ApiError(`Token counting failed (${response.status}).`, 502, "token_count_failed");
  const data = await response.json() as InputTokenCountResponse;
  if (!Number.isInteger(data.input_tokens)) throw new ApiError("Token counting returned no input token total.", 502, "token_count_empty");
  return data.input_tokens as number;
}

export async function estimateWorkspaceTokens(input: {
  question: string;
  actor: string;
  billingMode: BillingMode;
  personalApiKey?: string;
  operation?: TokenOperation;
  sourceUrl?: string | null;
  targetRecordId?: string | null;
}) {
  const apiKey = input.billingMode === "personal"
    ? input.personalApiKey?.trim()
    : runtimeEnv().OPENAI_API_KEY?.trim();
  const operation = input.operation ?? "auto";
  const plan = await buildWorkspacePlan({
    question: input.question,
    apiKey,
    operation,
    sourceUrl: input.sourceUrl,
    targetRecordId: input.targetRecordId,
  });
  const maxOutputTokens = tokenLimits().maxOutputTokens;
  const estimatedInputTokens = plan.route === "semantic_cache"
    ? 0
    : apiKey ? await countInputTokens(apiKey, plan) : approximateInputTokens(plan);
  if (estimatedInputTokens > tokenLimits().maxInputTokens) {
    throw new ApiError(`This prompt would use ${estimatedInputTokens.toLocaleString()} input tokens, above the workspace limit.`, 413, "input_token_limit_exceeded");
  }
  // Semantic reuse is the effective operation even when a client mistakenly
  // requests generate_with_team_knowledge for an exact duplicate.
  const effectiveOperation = plan.route === "semantic_cache" ? "auto" : operation;
  const estimate = await createTokenEstimate({
    actor: input.actor,
    question: input.question,
    operation: effectiveOperation,
    route: plan.route,
    model: MODEL,
    recordId: plan.recordId,
    estimatedInputTokens,
    maxOutputTokens: plan.route === "semantic_cache" ? 0 : maxOutputTokens,
    estimatedSavedTokens: plan.route === "semantic_cache" ? plan.best?.record.token_count ?? 0 : 0,
    retrievalInputTokens: plan.retrievalInputTokens,
  });
  return {
    estimate: {
      ...estimate,
      source: plan.route === "semantic_cache"
        ? "semantic_cache" as const
        : apiKey ? "openai_input_token_count" as const : "relay_local_estimate" as const,
    },
    plan,
  };
}

export async function generateWorkspaceAnswer(input: {
  question: string;
  actor: string;
  agent: string;
  billingMode: BillingMode;
  personalApiKey?: string;
  estimateId: string;
  operation?: TokenOperation;
  action?: "generate" | "refresh";
  knowledgeType?: KnowledgeType;
  sourceUrl?: string | null;
  targetRecordId?: string | null;
  version?: number;
}) {
  const { DB } = runtimeEnv();
  const apiKey = resolveApiKey(input.billingMode, input.personalApiKey);
  const operation = input.operation ?? (input.action === "refresh" ? "refresh" : "auto");
  const plan = await buildWorkspacePlan({
    question: input.question,
    apiKey,
    operation,
    sourceUrl: input.sourceUrl,
    targetRecordId: input.targetRecordId,
  });
  const estimate = await requireTokenEstimate({
    estimateId: input.estimateId,
    actor: input.actor,
    question: input.question,
    route: plan.route,
    operation,
    recordId: plan.recordId,
  });
  if (plan.route === "semantic_cache") {
    throw new ApiError("This request is eligible for Semantic Cache. Use the cached-answer endpoint or estimate a RAG generation.", 409, "semantic_cache_available");
  }
  await claimTokenEstimate(estimate.id);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...inputTokenPayload(plan),
      reasoning: { effort: "low" },
      max_output_tokens: estimate.max_output_tokens,
      prompt_cache_key: plan.promptCacheKey,
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
      safety_identifier: await safetyIdentifier(input.actor),
    }),
  });
  if (!response.ok) throw new ApiError(`The model request failed (${response.status}).`, 502, "model_request_failed");
  const data = await response.json() as OpenAIResponse;
  const answer = outputText(data);
  if (!answer) throw new ApiError("The model returned no text.", 502, "model_output_empty");

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const totalTokens = data.usage?.total_tokens ?? inputTokens + outputTokens;
  const cachedTokens = data.usage?.input_tokens_details?.cached_tokens ?? 0;
  const cacheWriteTokens = data.usage?.input_tokens_details?.cache_write_tokens ?? 0;
  const createdAt = new Date();
  const id = crypto.randomUUID();
  const knowledgeType = input.knowledgeType ?? "dynamic";
  const expiresAt = expiresAtFor(knowledgeType, createdAt);
  const allowDirectReuse = knowledgeType === "transactional" ? 0 : 1;
  const summary = answer.length > 260 ? `${answer.slice(0, 257)}…` : answer;

  await DB.batch([
    DB.prepare(`INSERT INTO model_calls
      (id, workspace_id, prompt_cache_key, knowledge_version, input_tokens, cached_tokens, cache_write_tokens, output_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), workspaceId(), plan.promptCacheKey, plan.knowledgeVersion, inputTokens, cachedTokens, cacheWriteTokens, outputTokens, createdAt.toISOString()),
    DB.prepare(`INSERT INTO memory_records
      (id, workspace_id, kind, title, detail, author, agent, model, token_count, created_at,
       knowledge_type, expires_at, generated_at, allow_direct_reuse, requires_refresh,
       superseded_by, source_url, summary, version)
      VALUES (?, ?, 'answer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`)
      .bind(
        id,
        workspaceId(),
        input.question,
        answer,
        input.actor,
        input.agent,
        MODEL,
        totalTokens,
        createdAt.toISOString(),
        knowledgeType,
        expiresAt,
        createdAt.toISOString(),
        allowDirectReuse,
        input.sourceUrl ?? null,
        summary,
        input.version ?? 1,
      ),
  ]);
  await cacheAnswer(input.question, id, createdAt.toISOString());
  await recordRoutingEvent({
    route: plan.route,
    action: input.action ?? "generate",
    similarity: plan.best?.score ?? 0,
    actualCachedTokens: cachedTokens,
    recordId: id,
  });
  await consumeTokenEstimate({
    estimateId: estimate.id,
    actualInputTokens: inputTokens,
    actualOutputTokens: outputTokens,
    actualTotalTokens: totalTokens,
    actualCachedTokens: cachedTokens,
    actualRetrievalInputTokens: estimate.retrieval_input_tokens + plan.retrievalInputTokens,
  });

  const state = await getWorkspaceState();
  return {
    record: {
      id,
      kind: "answer" as const,
      title: input.question,
      detail: answer,
      author: input.actor,
      agent: input.agent,
      time: "Just now",
      accent: "gold",
      tokenCount: totalTokens,
      model: MODEL,
      knowledgeType,
      expiresAt,
      generatedAt: createdAt.toISOString(),
      allowDirectReuse: Boolean(allowDirectReuse),
      requiresRefresh: false,
      supersededBy: null,
      sourceUrl: input.sourceUrl ?? null,
      summary,
      version: input.version ?? 1,
      stale: false,
    },
    stats: state.stats,
    defense: state.defense,
    modelReady: true,
    promptCache: {
      key: plan.promptCacheKey,
      cachedTokens,
      cacheWriteTokens,
      eligible: inputTokens >= 1024,
    },
    route: plan.route,
    retrieval: plan.retrieval,
    usage: {
      source: "openai_response" as const,
      modelCalled: true,
      estimatedInputTokens: estimate.estimated_input_tokens,
      retrievalInputTokens: estimate.retrieval_input_tokens + plan.retrievalInputTokens,
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens: cachedTokens,
      cacheWriteTokens,
      inputEstimateDelta: inputTokens - estimate.estimated_input_tokens,
      savedTokens: 0,
    },
  };
}
