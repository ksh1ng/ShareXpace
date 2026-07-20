import { bumpKnowledgeVersion, ensureWorkspace, requireActor, runtimeEnv, withRequestedWorkspaceResponse, workspaceId } from "../../_lib/workspace";

const RESET_PHRASE = "RESET SHARED KNOWLEDGE";

type CountRow = { count: number };

async function countRows(table: "memory_records" | "record_embeddings" | "workspace_files" | "document_chunks" | "document_chunk_embeddings") {
  return (await runtimeEnv().DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`)
    .bind(workspaceId())
    .first<CountRow>())?.count ?? 0;
}

export async function POST(request: Request) {
  return withRequestedWorkspaceResponse(request, "Shared knowledge could not be reset.", async () => {
    const actor = requireActor(request);
    await ensureWorkspace();
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "A JSON confirmation is required.", code: "json_required" }, { status: 415 });
    }
    const body = await request.json().catch(() => ({})) as { workspaceId?: string; confirmation?: string };
    if (body.workspaceId !== workspaceId() || body.confirmation !== RESET_PHRASE) {
      return Response.json({ error: "Workspace ID or confirmation phrase did not match.", code: "reset_confirmation_required" }, { status: 403 });
    }

    const { DB, FILES } = runtimeEnv();
    const id = workspaceId();
    const before = {
      sharedKnowledge: await countRows("memory_records"),
      embeddings: await countRows("record_embeddings"),
      uploadedFiles: await countRows("workspace_files"),
      documentChunks: await countRows("document_chunks"),
      documentChunkEmbeddings: await countRows("document_chunk_embeddings"),
    };
    const objects = (await DB.prepare("SELECT object_key FROM workspace_files WHERE workspace_id = ?")
      .bind(id)
      .all<{ object_key: string }>()).results;
    if (FILES) await Promise.all(objects.map((object) => FILES.delete(object.object_key)));

    await DB.batch([
      DB.prepare("DELETE FROM document_chunk_embeddings WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM document_chunks WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM record_embeddings WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM answer_cache WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM token_estimates WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM memory_records WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM workspace_files WHERE workspace_id = ?").bind(id),
    ]);
    const knowledgeVersion = await bumpKnowledgeVersion();

    return Response.json({
      reset: true,
      workspaceId: id,
      actor,
      deleted: before,
      knowledgeVersion,
      retained: ["chat_messages", "routing_events", "model_calls", "mcp_events"],
    });
  });
}
