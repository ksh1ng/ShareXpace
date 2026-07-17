import { estimateWorkspaceTokens, type BillingMode } from "../../_lib/model";
import {
  ApiError,
  errorResponse,
  relativeTime,
  requireActor,
  routeThresholds,
  runtimeEnv,
  validateQuestion,
  workspaceId,
  type MemoryRow,
  type TokenOperation,
} from "../../_lib/workspace";

function presentMatch(match: Awaited<ReturnType<typeof estimateWorkspaceTokens>>["plan"]["best"]) {
  if (!match) return null;
  return {
    id: match.record.id,
    matchType: match.matchType,
    score: Math.round(match.score * 100),
    lexicalScore: Math.round(match.lexicalScore * 100),
    semanticScore: Math.round(match.semanticScore * 100),
    retrievalMode: match.retrievalMode,
    title: match.record.title,
    detail: match.record.detail,
    author: match.record.author,
    agent: match.record.agent,
    time: relativeTime(match.record.created_at),
    tokenCount: match.record.token_count,
    knowledgeType: match.record.knowledge_type,
    expiresAt: match.record.expires_at,
    generatedAt: match.record.generated_at,
    allowDirectReuse: match.freshness.directReuseAllowed,
    requiresRefresh: match.freshness.refreshRequired,
    supersededBy: match.record.superseded_by,
    sourceUrl: match.record.source_url,
    summary: match.record.summary,
    version: match.record.version,
    stale: !match.freshness.fresh,
    staleReason: match.freshness.reason,
  };
}

export async function POST(request: Request) {
  try {
    const actor = requireActor(request);
    const body = await request.json() as {
      question?: string;
      billingMode?: BillingMode;
      personalApiKey?: string;
      operation?: TokenOperation;
      recordId?: string;
    };
    const operation: TokenOperation = body.operation === "generate_with_team_knowledge" || body.operation === "refresh"
      ? body.operation
      : "auto";
    let question = validateQuestion(body.question);
    let sourceUrl: string | null = null;
    let targetRecordId: string | null = null;
    if (operation === "refresh") {
      if (!body.recordId) throw new ApiError("Record is required for refresh estimation.", 400, "record_required");
      const record = await runtimeEnv().DB.prepare("SELECT * FROM memory_records WHERE id = ? AND workspace_id = ?")
        .bind(body.recordId, workspaceId())
        .first<MemoryRow>();
      if (!record) return Response.json({ error: "Knowledge record not found.", code: "record_not_found" }, { status: 404 });
      if (!record.source_url) return Response.json({ error: "This record has no source URL to refresh.", code: "source_required" }, { status: 409 });
      question = record.title;
      sourceUrl = record.source_url;
      targetRecordId = record.id;
    }
    const result = await estimateWorkspaceTokens({
      question,
      actor,
      billingMode: body.billingMode === "personal" ? "personal" : "master",
      personalApiKey: body.personalApiKey,
      operation,
      sourceUrl,
      targetRecordId,
    });
    const match = presentMatch(result.plan.best);
    return Response.json({
      estimate: result.estimate,
      route: result.plan.route,
      match: result.plan.route === "full_generation" && operation !== "refresh" ? null : match,
      thresholds: routeThresholds(),
      retrieval: result.plan.retrieval,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to estimate tokens.");
  }
}
