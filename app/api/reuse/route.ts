import {
  claimTokenEstimate,
  consumeTokenEstimate,
  ensureWorkspace,
  errorResponse,
  freshness,
  getWorkspaceState,
  recordRoutingEvent,
  requireActor,
  requireTokenEstimate,
  runtimeEnv,
  validateQuestion,
  workspaceId,
  type MemoryRow,
} from "../_lib/workspace";

export async function POST(request: Request) {
  try {
    const actor = requireActor(request);
    await ensureWorkspace();
    const body = await request.json() as { recordId?: string; question?: string; similarity?: number; estimateId?: string };
    const question = validateQuestion(body.question);
    if (!body.recordId) return Response.json({ error: "Record is required.", code: "record_required" }, { status: 400 });
    if (!body.estimateId) return Response.json({ error: "Estimate tokens before reusing.", code: "estimate_required" }, { status: 428 });
    const record = await runtimeEnv().DB.prepare("SELECT * FROM memory_records WHERE id = ? AND workspace_id = ?")
      .bind(body.recordId, workspaceId())
      .first<MemoryRow>();
    if (!record) return Response.json({ error: "Shared answer not found.", code: "record_not_found" }, { status: 404 });
    const status = freshness(record);
    if (!status.directReuseAllowed) {
      return Response.json({ error: "This cached answer is stale, refresh-required, transactional, or superseded.", code: "stale_cache_blocked", staleReason: status.reason }, { status: 409 });
    }
    const estimate = await requireTokenEstimate({
      estimateId: body.estimateId,
      actor,
      question,
      route: "semantic_cache",
      operation: "auto",
      recordId: record.id,
    });
    await claimTokenEstimate(estimate.id);
    await runtimeEnv().DB.prepare("INSERT INTO reuse_events (id, workspace_id, record_id, question, saved_tokens, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), workspaceId(), record.id, question, record.token_count, actor, new Date().toISOString())
      .run();
    await recordRoutingEvent({ route: "semantic_cache", action: "reuse", similarity: (body.similarity ?? 100) / 100, estimatedTokensSaved: record.token_count, recordId: record.id });
    await consumeTokenEstimate({
      estimateId: estimate.id,
      actualInputTokens: 0,
      actualOutputTokens: 0,
      actualTotalTokens: 0,
      actualCachedTokens: 0,
      actualRetrievalInputTokens: estimate.retrieval_input_tokens,
    });
    const state = await getWorkspaceState();
    return Response.json({
      savedTokens: record.token_count,
      stats: state.stats,
      defense: state.defense,
      route: "semantic_cache",
      usage: {
        source: "semantic_cache",
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
    });
  } catch (error) {
    return errorResponse(error, "Unable to reuse this answer.");
  }
}
