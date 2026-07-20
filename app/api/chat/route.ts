import { ensureWorkspace, getChatMessages, relativeTime, requireActor, runtimeEnv, withRequestedWorkspaceResponse, workspaceId } from "../_lib/workspace";

function present(message: Awaited<ReturnType<typeof getChatMessages>>[number]) {
  return {
    id: message.id,
    author: message.author,
    type: message.message_type,
    content: message.content,
    agent: message.agent,
    model: message.model,
    billingMode: message.billing_mode,
    status: message.task_status,
    sourceMessageId: message.source_message_id,
    time: relativeTime(message.created_at),
  };
}

export async function GET(request: Request) {
  return withRequestedWorkspaceResponse(request, "Unable to load shared chat.", async () => {
    requireActor(request);
    return Response.json({ messages: (await getChatMessages()).map(present) });
  });
}

export async function POST(request: Request) {
  return withRequestedWorkspaceResponse(request, "Unable to post this message.", async () => {
    const actor = requireActor(request);
    await ensureWorkspace();
    const body = await request.json() as { content?: string; callAgent?: boolean; agent?: string; billingMode?: "master" | "personal" };
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return Response.json({ error: "Message is required.", code: "message_required" }, { status: 400 });
    if (content.length > 20_000) return Response.json({ error: "Message is too long.", code: "message_too_long" }, { status: 413 });
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const type = body.callAgent ? "task" : "discussion";
    const status = body.callAgent ? "queued" : null;
    const agent = body.callAgent ? (body.agent?.trim() || `${actor}'s Agent`) : null;
    const billingMode = body.callAgent ? (body.billingMode === "personal" ? "personal" : "master") : null;
    await runtimeEnv().DB.prepare(`INSERT INTO chat_messages
      (id, workspace_id, author, message_type, content, agent, model, billing_mode, task_status, source_message_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)`)
      .bind(id, workspaceId(), actor, type, content, agent, billingMode, status, createdAt)
      .run();
    return Response.json({ message: { id, author: actor, type, content, agent, model: null, billingMode, status, sourceMessageId: null, time: "Just now" } }, { status: 201 });
  });
}
