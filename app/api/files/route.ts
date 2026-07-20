import { bumpKnowledgeVersion, ensureWorkspace, expiresAtFor, requireActor, runtimeEnv, withRequestedWorkspaceResponse, workspaceId } from "../_lib/workspace";
import { indexUploadedDocument } from "../_lib/document-ingestion";

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function POST(request: Request) {
  return withRequestedWorkspaceResponse(request, "The file could not be uploaded.", async () => {
    const author = requireActor(request);
    await ensureWorkspace();
    const { DB, FILES } = runtimeEnv();
    if (!FILES) return Response.json({ error: "File storage is unavailable.", code: "file_storage_unavailable" }, { status: 503 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload.", code: "file_required" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return Response.json({ error: "Files must be 10 MB or smaller.", code: "file_too_large" }, { status: 413 });
    const contentType = file.type || "application/octet-stream";
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return Response.json({ error: "This file type is not allowed.", code: "file_type_not_allowed" }, { status: 415 });

    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "upload";
    const objectKey = `${workspaceId()}/${id}/${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await FILES.put(objectKey, bytes, { httpMetadata: { contentType } });
    const createdAt = new Date().toISOString();
    const expiresAt = expiresAtFor("static", new Date(createdAt));
    await DB.batch([
      DB.prepare(`INSERT INTO workspace_files
        (id, workspace_id, name, content_type, size, object_key, author, created_at, processing_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
        .bind(id, workspaceId(), file.name, contentType, file.size, objectKey, author, createdAt),
      DB.prepare(`INSERT INTO memory_records
        (id, workspace_id, kind, title, detail, author, agent, model, token_count, created_at,
         knowledge_type, expires_at, generated_at, allow_direct_reuse, requires_refresh,
         superseded_by, source_url, summary, version)
        VALUES (?, ?, 'file', ?, ?, ?, 'Uploaded by member', NULL, 0, ?,
                'static', ?, ?, 0, 0, NULL, NULL, ?, 1)`)
        .bind(`memory-${id}`, workspaceId(), file.name, `${contentType} · ${(file.size / 1024).toFixed(0)} KB`, author, createdAt, expiresAt, createdAt, `Member-uploaded workspace file: ${file.name}`),
    ]);
    const indexing = await indexUploadedDocument({
      fileId: id,
      fileName: file.name,
      contentType,
      bytes,
      createdAt,
    });
    const indexedDetail = indexing.chunkCount
      ? `${contentType} · ${(file.size / 1024).toFixed(0)} KB · ${indexing.chunkCount} searchable chunks`
      : `${contentType} · ${(file.size / 1024).toFixed(0)} KB · stored in R2`;
    await DB.prepare("UPDATE memory_records SET detail = ?, summary = ? WHERE id = ? AND workspace_id = ?")
      .bind(
        indexedDetail,
        indexing.chunkCount
          ? `Member-uploaded workspace document indexed into ${indexing.chunkCount} chunks: ${file.name}`
          : `Member-uploaded workspace file stored without searchable chunks: ${file.name}`,
        `memory-${id}`,
        workspaceId(),
      ).run();
    const knowledgeVersion = await bumpKnowledgeVersion();
    return Response.json({
      record: {
        id: `memory-${id}`, kind: "file", title: file.name, detail: indexedDetail,
        author, agent: "Uploaded by member", time: "Just now", accent: "lime", tokenCount: 0, model: null,
        knowledgeType: "static", expiresAt, generatedAt: createdAt, allowDirectReuse: false, requiresRefresh: false,
        supersededBy: null, sourceUrl: null, summary: indexing.chunkCount
          ? `Member-uploaded workspace document indexed into ${indexing.chunkCount} chunks: ${file.name}`
          : `Member-uploaded workspace file stored without searchable chunks: ${file.name}`, version: 1, stale: false,
      },
      indexing,
      knowledgeVersion,
    }, { status: 201 });
  });
}
