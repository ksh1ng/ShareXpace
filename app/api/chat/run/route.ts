import { generateWorkspaceAnswer, type BillingMode } from "../../_lib/model";
import {
  claimTokenEstimate,
  consumeTokenEstimate,
  classifyDefenseRoute,
  ensureWorkspace,
  errorResponse,
  findBestMatch,
  getWorkspaceState,
  recordRoutingEvent,
  relativeTime,
  requireActor,
  requireTokenEstimate,
  resolveApiKey,
  runtimeEnv,
  validateQuestion,
  withRequestedWorkspaceResponse,
  workspaceId,
} from "../../_lib/workspace";

export async function POST(request: Request) {
  return withRequestedWorkspaceResponse(request, "The agent task failed.", async () => {
    let sourceId: string | null = null;
    try {
    const actor = requireActor(request);
    await ensureWorkspace();
    const body = await request.json() as {
      sourceMessageId?: string;
      instruction?: string;
      agent?: string;
      billingMode?: BillingMode;
      personalApiKey?: string;
      estimateId?: string;
    };
    const instruction = validateQuestion(body.instruction);
    if (!body.sourceMessageId) return Response.json({ error: "Source message is required.", code: "source_message_required" }, { status: 400 });
    if (!body.estimateId) return Response.json({ error: "Estimate agent tokens before running.", code: "estimate_required" }, { status: 428 });
    const { DB } = runtimeEnv();
    const source = await DB.prepare("SELECT id FROM chat_messages WHERE id = ? AND workspace_id = ?")
      .bind(body.sourceMessageId, workspaceId())
      .first<{ id: string }>();
    if (!source) return Response.json({ error: "Shared chat message not found.", code: "message_not_found" }, { status: 404 });
    sourceId = source.id;
    const agent = body.agent?.trim() || `${actor}'s Agent`;
    const billingMode = body.billingMode === "personal" ? "personal" : "master";
    await DB.prepare("UPDATE chat_messages SET message_type = 'task', task_status = 'running', agent = ?, billing_mode = ? WHERE id = ? AND workspace_id = ?")
      .bind(agent, billingMode, source.id, workspaceId())
      .run();

    const apiKey = resolveApiKey(billingMode, body.personalApiKey);
    const retrieval = await findBestMatch(instruction, apiKey);
    const match = retrieval.match;
    const route = classifyDefenseRoute(match);
    let answer: string;
    let model: string;
    let usedBillingMode: "master" | "personal" | "cache" = billingMode;
    let defense;
    let usage;
    if (match && route === "semantic_cache") {
      const estimate = await requireTokenEstimate({ estimateId: body.estimateId, actor, question: instruction, route, operation: "auto", recordId: match.record.id });
      await claimTokenEstimate(estimate.id);
      answer = match.record.detail;
      model = match.record.model || "shared memory";
      usedBillingMode = "cache";
      await DB.prepare("INSERT INTO reuse_events (id, workspace_id, record_id, question, saved_tokens, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), workspaceId(), match.record.id, instruction, match.record.token_count, actor, new Date().toISOString())
        .run();
      await recordRoutingEvent({ route, action: "reuse", similarity: match.score, estimatedTokensSaved: match.record.token_count, recordId: match.record.id });
      await consumeTokenEstimate({ estimateId: estimate.id, actualInputTokens: 0, actualOutputTokens: 0, actualTotalTokens: 0, actualCachedTokens: 0, actualRetrievalInputTokens: estimate.retrieval_input_tokens + retrieval.embeddingInputTokens });
      defense = (await getWorkspaceState()).defense;
      usage = { source: "semantic_cache", modelCalled: false, estimatedInputTokens: 0, retrievalInputTokens: estimate.retrieval_input_tokens + retrieval.embeddingInputTokens, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, inputEstimateDelta: 0, savedTokens: match.record.token_count };
    } else {
      const generated = await generateWorkspaceAnswer({ question: instruction, actor, agent, billingMode, personalApiKey: body.personalApiKey, estimateId: body.estimateId, operation: "auto" });
      answer = generated.record.detail;
      model = generated.record.model || "gpt-5.6";
      defense = generated.defense;
      usage = generated.usage;
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await DB.batch([
      DB.prepare("UPDATE chat_messages SET task_status = 'done' WHERE id = ? AND workspace_id = ?").bind(source.id, workspaceId()),
      DB.prepare(`INSERT INTO chat_messages
        (id, workspace_id, author, message_type, content, agent, model, billing_mode, task_status, source_message_id, created_at)
        VALUES (?, ?, ?, 'agent', ?, ?, ?, ?, 'done', ?, ?)`)
        .bind(id, workspaceId(), agent, answer, agent, model, usedBillingMode, source.id, createdAt),
    ]);
    return Response.json({
      message: { id, author: agent, type: "agent", content: answer, agent, model, billingMode: usedBillingMode, status: "done", sourceMessageId: source.id, time: relativeTime(createdAt) },
      route,
      defense,
      usage,
    }, { status: 201 });
    } catch (error) {
      if (sourceId) await runtimeEnv().DB.prepare("UPDATE chat_messages SET task_status = 'failed' WHERE id = ? AND workspace_id = ?").bind(sourceId, workspaceId()).run();
      return errorResponse(error, "The agent task failed.");
    }
  });
}
