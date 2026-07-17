import { generateWorkspaceAnswer, type BillingMode } from "../../_lib/model";
import {
  bumpKnowledgeVersion,
  ensureWorkspace,
  errorResponse,
  expiresAtFor,
  requireActor,
  runtimeEnv,
  workspaceId,
  type MemoryRow,
} from "../../_lib/workspace";

export async function POST(request: Request) {
  try {
    const actor = requireActor(request);
    await ensureWorkspace();
    const body = await request.json() as { recordId?: string; estimateId?: string; billingMode?: BillingMode; personalApiKey?: string; agent?: string };
    if (!body.recordId) return Response.json({ error: "Record is required.", code: "record_required" }, { status: 400 });
    if (!body.estimateId) return Response.json({ error: "Estimate refresh tokens before sending.", code: "estimate_required" }, { status: 428 });
    const { DB } = runtimeEnv();
    const old = await DB.prepare("SELECT * FROM memory_records WHERE id = ? AND workspace_id = ?")
      .bind(body.recordId, workspaceId())
      .first<MemoryRow>();
    if (!old) return Response.json({ error: "Knowledge record not found.", code: "record_not_found" }, { status: 404 });
    if (!old.source_url) return Response.json({ error: "This record has no source URL to refresh.", code: "source_required" }, { status: 409 });
    const result = await generateWorkspaceAnswer({
      question: old.title,
      actor,
      agent: body.agent?.trim() || `${actor}'s Refresh Agent`,
      billingMode: body.billingMode === "personal" ? "personal" : "master",
      personalApiKey: body.personalApiKey,
      estimateId: body.estimateId,
      operation: "refresh",
      action: "refresh",
      knowledgeType: old.knowledge_type,
      sourceUrl: old.source_url,
      targetRecordId: old.id,
      version: old.version + 1,
    });
    await DB.batch([
      DB.prepare("UPDATE memory_records SET superseded_by = ?, requires_refresh = 1, allow_direct_reuse = 0 WHERE id = ? AND workspace_id = ?")
        .bind(result.record.id, old.id, workspaceId()),
      DB.prepare("UPDATE memory_records SET expires_at = ?, source_url = ?, version = ? WHERE id = ? AND workspace_id = ?")
        .bind(expiresAtFor(old.knowledge_type), old.source_url, old.version + 1, result.record.id, workspaceId()),
    ]);
    if (old.knowledge_type === "static" || old.knowledge_type === "internal_decision") await bumpKnowledgeVersion();
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to refresh this knowledge record.");
  }
}
