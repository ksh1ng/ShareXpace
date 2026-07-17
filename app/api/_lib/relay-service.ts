import { estimateWorkspaceTokens, generateWorkspaceAnswer, type BillingMode } from "./model";
import {
  ApiError,
  bumpKnowledgeVersion,
  cacheAnswer,
  claimTokenEstimate,
  consumeTokenEstimate,
  ensureWorkspace,
  expiresAtFor,
  freshness,
  getWorkspaceState,
  recordRoutingEvent,
  questionFingerprint,
  requireTokenEstimate,
  retrieveWorkspaceAnswers,
  routeThresholds,
  runtimeEnv,
  validateQuestion,
  workspaceId,
  type DefenseRoute,
  type KnowledgeType,
  type MemoryRow,
  type TokenEstimateRow,
  type TokenOperation,
} from "./workspace";

export function presentMemoryRecord(record: MemoryRow) {
  const status = freshness(record);
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    detail: record.detail,
    author: record.author,
    agent: record.agent,
    model: record.model,
    tokenCount: record.token_count,
    createdAt: record.created_at,
    knowledgeType: record.knowledge_type,
    expiresAt: record.expires_at,
    generatedAt: record.generated_at,
    allowDirectReuse: status.directReuseAllowed,
    requiresRefresh: status.refreshRequired,
    supersededBy: record.superseded_by,
    sourceUrl: record.source_url,
    summary: record.summary,
    version: record.version,
    stale: !status.fresh,
    staleReason: status.reason,
  };
}
export function presentMatch(match: Awaited<ReturnType<typeof estimateWorkspaceTokens>>["plan"]["best"]) {
  if (!match) return null;
  return {
    ...presentMemoryRecord(match.record),
    matchType: match.matchType,
    score: Math.round(match.score * 100),
    lexicalScore: Math.round(match.lexicalScore * 100),
    semanticScore: Math.round(match.semanticScore * 100),
    retrievalMode: match.retrievalMode,
  };
}

async function refreshTarget(recordId: string) {
  const record = await runtimeEnv().DB.prepare("SELECT * FROM memory_records WHERE id = ? AND workspace_id = ?")
    .bind(recordId, workspaceId())
    .first<MemoryRow>();
  if (!record) throw new ApiError("Knowledge record not found.", 404, "record_not_found");
  if (!record.source_url) throw new ApiError("This record has no source URL to refresh.", 409, "source_required");
  return record;
}

export async function relayPreflight(input: {
  actor: string;
  question: unknown;
  billingMode?: BillingMode;
  personalApiKey?: string;
  operation?: TokenOperation;
  recordId?: string | null;
}) {
  await ensureWorkspace();
  const operation = input.operation === "generate_with_team_knowledge" || input.operation === "refresh" ? input.operation : "auto";
  let question = validateQuestion(input.question);
  let target: MemoryRow | null = null;
  if (operation === "refresh") {
    if (!input.recordId) throw new ApiError("Record is required for refresh estimation.", 400, "record_required");
    target = await refreshTarget(input.recordId);
    question = target.title;
  }
  const result = await estimateWorkspaceTokens({
    question,
    actor: input.actor,
    billingMode: input.billingMode === "personal" ? "personal" : "master",
    personalApiKey: input.personalApiKey,
    operation,
    sourceUrl: target?.source_url ?? null,
    targetRecordId: target?.id ?? null,
  });
  const match = presentMatch(result.plan.best);
  return {
    estimate: result.estimate,
    route: result.plan.route,
    question,
    match: result.plan.route === "full_generation" && operation !== "refresh" ? null : match,
    thresholds: routeThresholds(),
    retrieval: result.plan.retrieval,
  };
}

export async function relayReuse(input: {
  actor: string;
  question: unknown;
  estimateId: string;
  recordId: string;
  similarity?: number;
}) {
  await ensureWorkspace();
  const question = validateQuestion(input.question);
  const record = await runtimeEnv().DB.prepare("SELECT * FROM memory_records WHERE id = ? AND workspace_id = ?")
    .bind(input.recordId, workspaceId())
    .first<MemoryRow>();
  if (!record) throw new ApiError("Shared answer not found.", 404, "record_not_found");
  const status = freshness(record);
  if (!status.directReuseAllowed) {
    throw new ApiError("This cached answer is stale, refresh-required, transactional, or superseded.", 409, "stale_cache_blocked");
  }
  const estimate = await requireTokenEstimate({
    estimateId: input.estimateId,
    actor: input.actor,
    question,
    route: "semantic_cache",
    operation: "auto",
    recordId: record.id,
  });
  await claimTokenEstimate(estimate.id);
  await runtimeEnv().DB.prepare("INSERT INTO reuse_events (id, workspace_id, record_id, question, saved_tokens, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), workspaceId(), record.id, question, record.token_count, input.actor, new Date().toISOString())
    .run();
  await recordRoutingEvent({ route: "semantic_cache", action: "reuse", similarity: (input.similarity ?? 100) / 100, estimatedTokensSaved: record.token_count, recordId: record.id });
  await consumeTokenEstimate({
    estimateId: estimate.id,
    actualInputTokens: 0,
    actualOutputTokens: 0,
    actualTotalTokens: 0,
    actualCachedTokens: 0,
    actualRetrievalInputTokens: estimate.retrieval_input_tokens,
  });
  const state = await getWorkspaceState();
  return {
    record: presentMemoryRecord(record),
    savedTokens: record.token_count,
    stats: state.stats,
    defense: state.defense,
    route: "semantic_cache" as const,
    usage: {
      source: "semantic_cache" as const,
      modelCalled: false,
      estimatedInputTokens: 0,
      retrievalInputTokens: estimate.retrieval_input_tokens,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      inputEstimateDelta: 0,
      savedTokens: record.token_count,
    },
  };
}

export async function relayExecute(input: {
  actor: string;
  question: unknown;
  estimateId: string;
  agent?: string;
  billingMode?: BillingMode;
  personalApiKey?: string;
  operation?: TokenOperation;
  knowledgeType?: KnowledgeType;
  recordId?: string | null;
}) {
  await ensureWorkspace();
  const estimate = await runtimeEnv().DB.prepare("SELECT * FROM token_estimates WHERE id = ? AND workspace_id = ?")
    .bind(input.estimateId, workspaceId())
    .first<TokenEstimateRow>();
  if (!estimate) throw new ApiError("Token estimate not found. Run relay_preflight first.", 409, "estimate_not_found");
  const operation = input.operation === "generate_with_team_knowledge" || input.operation === "refresh" ? input.operation : estimate.operation;
  if (operation === "refresh") {
    const old = await refreshTarget(input.recordId ?? estimate.record_id ?? "");
    const result = await generateWorkspaceAnswer({
      question: old.title,
      actor: input.actor,
      agent: input.agent?.trim() || `${input.actor}'s Refresh Agent`,
      billingMode: input.billingMode === "personal" ? "personal" : "master",
      personalApiKey: input.personalApiKey,
      estimateId: input.estimateId,
      operation: "refresh",
      action: "refresh",
      knowledgeType: old.knowledge_type,
      sourceUrl: old.source_url,
      targetRecordId: old.id,
      version: old.version + 1,
    });
    await runtimeEnv().DB.batch([
      runtimeEnv().DB.prepare("UPDATE memory_records SET superseded_by = ?, requires_refresh = 1, allow_direct_reuse = 0 WHERE id = ? AND workspace_id = ?")
        .bind(result.record.id, old.id, workspaceId()),
      runtimeEnv().DB.prepare("UPDATE memory_records SET expires_at = ?, source_url = ?, version = ? WHERE id = ? AND workspace_id = ?")
        .bind(expiresAtFor(old.knowledge_type), old.source_url, old.version + 1, result.record.id, workspaceId()),
    ]);
    if (old.knowledge_type === "static" || old.knowledge_type === "internal_decision") await bumpKnowledgeVersion();
    return result;
  }
  const question = validateQuestion(input.question);
  if (estimate.route === "semantic_cache") {
    if (!estimate.record_id) throw new ApiError("Semantic Cache estimate has no answer record.", 409, "estimate_record_missing");
    return relayReuse({ actor: input.actor, question, estimateId: input.estimateId, recordId: estimate.record_id });
  }
  return generateWorkspaceAnswer({
    question,
    actor: input.actor,
    agent: input.agent?.trim() || `${input.actor}'s Agent`,
    billingMode: input.billingMode === "personal" ? "personal" : "master",
    personalApiKey: input.personalApiKey,
    estimateId: input.estimateId,
    operation,
    knowledgeType: input.knowledgeType,
  });
}

export async function relaySearchMemory(input: { question: unknown; limit?: number }) {
  const question = validateQuestion(input.question);
  const key = runtimeEnv().OPENAI_API_KEY?.trim();
  const result = await retrieveWorkspaceAnswers(question, key, Math.min(Math.max(input.limit ?? 5, 1), 10));
  return {
    embeddingInputTokens: result.embeddingInputTokens,
    matches: result.matches.map((match) => ({ ...presentMatch(match), route: match.freshness.directReuseAllowed ? "semantic_cache" as DefenseRoute : "rag" as DefenseRoute })),
  };
}

function handoffContextLine(record: MemoryRow) {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary ?? record.detail,
    knowledgeType: record.knowledge_type,
    version: record.version,
    sourceUrl: record.source_url,
    generatedAt: record.generated_at,
    expiresAt: record.expires_at,
  };
}

export async function relayCreateAgentHandoff(input: {
  actor: string;
  question: unknown;
  estimateId: string;
  agent?: string;
  operation?: TokenOperation;
  recordId?: string | null;
}) {
  await ensureWorkspace();
  let question = validateQuestion(input.question);
  const estimate = await runtimeEnv().DB.prepare("SELECT * FROM token_estimates WHERE id = ? AND workspace_id = ?")
    .bind(input.estimateId, workspaceId())
    .first<TokenEstimateRow>();
  if (!estimate) throw new ApiError("Preflight not found. Run relay_preflight first.", 409, "estimate_not_found");
  const operation = input.operation === "generate_with_team_knowledge" || input.operation === "refresh" ? input.operation : estimate.operation;
  const refreshRecord = operation === "refresh" ? await refreshTarget(input.recordId ?? estimate.record_id ?? "") : null;
  if (refreshRecord) question = refreshRecord.title;
  if (estimate.route === "semantic_cache") {
    return relayExecute({ actor: input.actor, question, estimateId: input.estimateId, operation });
  }
  await requireTokenEstimate({
    estimateId: estimate.id,
    actor: input.actor,
    question,
    route: estimate.route,
    operation,
    recordId: estimate.record_id,
  });
  await claimTokenEstimate(estimate.id);

  const rows = (await runtimeEnv().DB.prepare("SELECT * FROM memory_records WHERE workspace_id = ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 100")
    .bind(workspaceId())
    .all<MemoryRow>()).results.filter((record) => freshness(record).fresh);
  const retrieved = await retrieveWorkspaceAnswers(question, runtimeEnv().OPENAI_API_KEY?.trim(), 5);
  const ragIds = new Set(retrieved.matches.filter((match) => match.score >= routeThresholds().rag).map((match) => match.record.id));
  const context = (estimate.route === "rag" ? rows.filter((record) => ragIds.has(record.id)) : rows)
    .slice(0, estimate.route === "rag" ? 5 : 30)
    .map(handoffContextLine);
  await recordRoutingEvent({
    route: estimate.route,
    action: "agent_handoff",
    similarity: retrieved.matches[0]?.score ?? 0,
    recordId: estimate.record_id,
  });
  return {
    status: "agent_action_required" as const,
    route: estimate.route,
    modelCalledByRelay: false,
    instruction: estimate.route === "rag"
      ? "Use your host model to answer the member request from the supplied fresh team knowledge. Then call relay_submit_result with this preflightId, the unchanged question, and your final answer."
      : "Use your host model to complete this new workspace request. Treat the supplied workspace context as authoritative only when it is relevant and fresh. Then call relay_submit_result with this preflightId, the unchanged question, and your final answer.",
    handoff: {
      preflightId: estimate.id,
      question,
      agent: input.agent?.trim() || `${input.actor}'s Agent`,
      systemInstructions: "You are an agent collaborating in a shared workspace. Do the requested work using your own host model. Do not claim stale records are current. Cite supplied source URLs when used. Return a concise actionable result for the whole group.",
      contextMode: estimate.route === "rag" ? "retrieved_team_knowledge" : "full_workspace_context",
      context,
      refreshSourceUrl: refreshRecord?.source_url ?? null,
      requiredNextTool: "relay_submit_result",
      submissionRequired: true,
    },
    usage: {
      source: "agent_handoff" as const,
      modelCalled: false,
      relayGenerationTokens: 0,
      estimatedHostInputTokens: estimate.estimated_input_tokens,
      retrievalInputTokens: estimate.retrieval_input_tokens + retrieved.embeddingInputTokens,
    },
  };
}

export async function relaySubmitAgentResult(input: {
  actor: string;
  preflightId: string;
  question: unknown;
  answer: unknown;
  agent?: string;
  model?: string;
  knowledgeType?: KnowledgeType;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}) {
  await ensureWorkspace();
  const question = validateQuestion(input.question);
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  if (!answer) throw new ApiError("Agent answer is required.", 400, "answer_required");
  if (answer.length > 100_000) throw new ApiError("Agent answer is too long.", 413, "answer_too_long");
  const estimate = await runtimeEnv().DB.prepare("SELECT * FROM token_estimates WHERE id = ? AND workspace_id = ?")
    .bind(input.preflightId, workspaceId())
    .first<TokenEstimateRow>();
  if (!estimate) throw new ApiError("Agent handoff not found.", 409, "estimate_not_found");
  if (estimate.actor !== input.actor) throw new ApiError("This handoff belongs to another member.", 403, "estimate_actor_mismatch");
  if (!estimate.claimed_at) throw new ApiError("Call relay_execute to obtain the agent handoff first.", 409, "handoff_required");
  if (estimate.consumed_at) throw new ApiError("This agent handoff was already submitted.", 409, "estimate_consumed");
  if (estimate.question_fingerprint !== await questionFingerprint(question)) throw new ApiError("The submitted question does not match the handoff.", 409, "estimate_prompt_changed");
  if (estimate.route === "semantic_cache") throw new ApiError("Semantic Cache results must use the cached answer.", 409, "semantic_cache_available");

  const old = estimate.operation === "refresh" && estimate.record_id ? await refreshTarget(estimate.record_id) : null;
  const createdAt = new Date();
  const id = crypto.randomUUID();
  const knowledgeType = old?.knowledge_type ?? input.knowledgeType ?? "dynamic";
  const version = old ? old.version + 1 : 1;
  const inputTokens = Math.max(0, Math.round(input.inputTokens ?? estimate.estimated_input_tokens));
  const outputTokens = Math.max(0, Math.round(input.outputTokens ?? Math.ceil(answer.length / 4)));
  const totalTokens = inputTokens + outputTokens;
  const cachedInputTokens = Math.max(0, Math.round(input.cachedInputTokens ?? 0));
  const summary = answer.length > 260 ? `${answer.slice(0, 257)}…` : answer;
  const agent = input.agent?.trim() || `${input.actor}'s Agent`;
  const model = input.model?.trim() || "host-agent-model";

  await runtimeEnv().DB.prepare(`INSERT INTO memory_records
    (id, workspace_id, kind, title, detail, author, agent, model, token_count, created_at,
     knowledge_type, expires_at, generated_at, allow_direct_reuse, requires_refresh,
     superseded_by, source_url, summary, version)
    VALUES (?, ?, 'answer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`)
    .bind(id, workspaceId(), question, answer, input.actor, agent, model, totalTokens, createdAt.toISOString(), knowledgeType,
      expiresAtFor(knowledgeType, createdAt), createdAt.toISOString(), knowledgeType === "transactional" ? 0 : 1,
      old?.source_url ?? null, summary, version)
    .run();
  if (old) {
    await runtimeEnv().DB.prepare("UPDATE memory_records SET superseded_by = ?, requires_refresh = 1, allow_direct_reuse = 0 WHERE id = ? AND workspace_id = ?")
      .bind(id, old.id, workspaceId()).run();
    if (knowledgeType === "static" || knowledgeType === "internal_decision") await bumpKnowledgeVersion();
  }
  await cacheAnswer(question, id, createdAt.toISOString());
  await recordRoutingEvent({ route: estimate.route, action: "agent_result", recordId: id, actualCachedTokens: cachedInputTokens });
  await consumeTokenEstimate({ estimateId: estimate.id, actualInputTokens: inputTokens, actualOutputTokens: outputTokens, actualTotalTokens: totalTokens, actualCachedTokens: cachedInputTokens, actualRetrievalInputTokens: estimate.retrieval_input_tokens });
  await runtimeEnv().DB.prepare(`INSERT INTO chat_messages
    (id, workspace_id, author, message_type, content, agent, model, billing_mode, task_status, source_message_id, created_at)
    VALUES (?, ?, ?, 'agent', ?, ?, ?, NULL, 'done', NULL, ?)`)
    .bind(crypto.randomUUID(), workspaceId(), input.actor, answer, agent, model, createdAt.toISOString()).run();
  const state = await getWorkspaceState();
  return {
    status: "stored" as const,
    route: estimate.route,
    record: presentMemoryRecord((await runtimeEnv().DB.prepare("SELECT * FROM memory_records WHERE id = ?").bind(id).first<MemoryRow>())!),
    usage: { source: "agent_reported_or_estimated" as const, modelCalledByRelay: false, inputTokens, outputTokens, totalTokens, cachedInputTokens },
    defense: state.defense,
  };
}
