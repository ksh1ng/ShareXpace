import {
  classifyDefenseRoute,
  findBestMatch,
  relativeTime,
  requireActor,
  resolveApiKey,
  routeThresholds,
  validateQuestion,
  withRequestedWorkspaceResponse,
  type BillingMode,
} from "../../_lib/workspace";

export async function POST(request: Request) {
  return withRequestedWorkspaceResponse(request, "Unable to check shared memory.", async () => {
    requireActor(request);
    const body = await request.json() as { question?: string; billingMode?: BillingMode; personalApiKey?: string };
    const question = validateQuestion(body.question);
    const apiKey = resolveApiKey(body.billingMode === "personal" ? "personal" : "master", body.personalApiKey);
    const retrieval = await findBestMatch(question, apiKey);
    const match = retrieval.match;
    const route = classifyDefenseRoute(match);
    const thresholds = routeThresholds();
    if (!match || match.score < thresholds.rag) return Response.json({ match: null, route: "full_generation", thresholds, deprecated: "Use /api/questions/estimate before generation." });
    return Response.json({
      route,
      thresholds,
      deprecated: "Use /api/questions/estimate before generation.",
      match: {
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
      },
    });
  });
}
