import { ensureWorkspace, errorResponse, requireMcpActor, runtimeEnv, workspaceId } from "../../_lib/workspace";

const ONE_TIME_CONFIRMATION = "RESET-RELAY-DEMO-2026-07-19-4f7c2a91";

type CountRow = { count: number };

async function counts() {
  const { DB } = runtimeEnv();
  const id = workspaceId();
  const [knowledge, embeddings, files, chat, routes, agents] = await Promise.all([
    DB.prepare("SELECT COUNT(*) AS count FROM memory_records WHERE workspace_id = ?").bind(id).first<CountRow>(),
    DB.prepare("SELECT COUNT(*) AS count FROM record_embeddings WHERE workspace_id = ?").bind(id).first<CountRow>(),
    DB.prepare("SELECT COUNT(*) AS count FROM workspace_files WHERE workspace_id = ?").bind(id).first<CountRow>(),
    DB.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE workspace_id = ?").bind(id).first<CountRow>(),
    DB.prepare("SELECT COUNT(*) AS count FROM routing_events WHERE workspace_id = ?").bind(id).first<CountRow>(),
    DB.prepare("SELECT COUNT(*) AS count FROM mcp_events WHERE workspace_id = ?").bind(id).first<CountRow>(),
  ]);
  return {
    sharedKnowledge: knowledge?.count ?? 0,
    embeddings: embeddings?.count ?? 0,
    uploadedFiles: files?.count ?? 0,
    chatMessages: chat?.count ?? 0,
    routingEvents: routes?.count ?? 0,
    connectedAgentEvents: agents?.count ?? 0,
  };
}

export async function POST(request: Request) {
  try {
    const actor = await requireMcpActor(request);
    await ensureWorkspace();
    const body = await request.json().catch(() => ({})) as { workspaceId?: string; confirmation?: string };
    if (body.workspaceId !== workspaceId() || body.confirmation !== ONE_TIME_CONFIRMATION) {
      return Response.json({ error: "The reset confirmation did not match.", code: "reset_confirmation_required" }, { status: 403 });
    }

    const { DB, FILES } = runtimeEnv();
    const id = workspaceId();
    const before = await counts();
    const objects = (await DB.prepare("SELECT object_key FROM workspace_files WHERE workspace_id = ?").bind(id).all<{ object_key: string }>()).results;
    if (FILES) await Promise.all(objects.map((object) => FILES.delete(object.object_key)));

    const now = new Date().toISOString();
    await DB.batch([
      DB.prepare("DELETE FROM record_embeddings WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM answer_cache WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM reuse_events WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM routing_events WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM token_estimates WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM model_calls WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM chat_messages WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM mcp_events WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM memory_records WHERE workspace_id = ?").bind(id),
      DB.prepare("DELETE FROM workspace_files WHERE workspace_id = ?").bind(id),
      DB.prepare("UPDATE workspace_cache_state SET knowledge_version = 1, updated_at = ? WHERE workspace_id = ?").bind(now, id),
    ]);

    return Response.json({ reset: true, workspaceId: id, actor, before, after: await counts() });
  } catch (error) {
    return errorResponse(error, "The demo workspace could not be reset.");
  }
}
