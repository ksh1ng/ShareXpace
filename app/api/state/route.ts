import { getWorkspaceState, relativeTime, requireActor, withRequestedWorkspaceResponse } from "../_lib/workspace";

export async function GET(request: Request) {
  return withRequestedWorkspaceResponse(request, "Unable to load workspace.", async () => {
    requireActor(request);
    const state = await getWorkspaceState();
    return Response.json({
      records: state.records.map((record, index) => ({
        id: record.id,
        kind: record.kind,
        title: record.title,
        detail: record.detail,
        author: record.author,
        agent: record.agent,
        time: relativeTime(record.created_at),
        accent: ["coral", "blue", "violet", "gold"][index % 4],
        tokenCount: record.token_count,
        model: record.model,
        knowledgeType: record.knowledge_type,
        expiresAt: record.expires_at,
        generatedAt: record.generated_at,
        allowDirectReuse: Boolean(record.allow_direct_reuse),
        requiresRefresh: Boolean(record.requires_refresh),
        supersededBy: record.superseded_by,
        sourceUrl: record.source_url,
        summary: record.summary,
        version: record.version,
        stale: Boolean(record.superseded_by || record.requires_refresh || (record.expires_at && new Date(record.expires_at).getTime() <= Date.now())),
      })),
      files: state.files,
      documents: state.documents,
      stats: state.stats,
      promptCache: state.promptCache,
      defense: state.defense,
      mcp: state.mcp,
      modelReady: state.modelReady,
      embedding: state.embedding,
      appMode: state.appMode,
      workspaceId: state.workspaceId,
      workspaceName: state.workspaceName,
      workspace: state.workspace,
    });
  });
}
