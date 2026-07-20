import {
  ApiError,
  embedRetrievalTexts,
  runtimeEnv,
  workspaceId,
} from "./workspace";
import { lexicalSimilarity } from "./retrieval-scoring";
import { chunkDocument } from "./document-chunking";

const MAX_EXTRACTED_CHARACTERS = 2_000_000;
const EMBEDDING_BATCH_SIZE = 32;

export type DocumentChunkRow = {
  id: string;
  workspace_id: string;
  file_id: string;
  file_name: string;
  chunk_index: number;
  content: string;
  token_count: number;
  char_start: number;
  char_end: number;
  created_at: string;
};

function cleanExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARACTERS);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function extractBinaryDocument(bytes: Uint8Array, contentType: string, name: string) {
  const { GEMINI_API_KEY, RELAY_DOCUMENT_PARSER_MODEL } = runtimeEnv();
  const apiKey = GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ApiError(
      "Binary document parsing requires GEMINI_API_KEY; the original file is still stored in R2.",
      503,
      "document_parser_unavailable",
    );
  }
  const model = RELAY_DOCUMENT_PARSER_MODEL?.trim() || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          {
            text: `Extract the readable content from ${name} for a team RAG index. Preserve headings, lists, table rows, dates, URLs, and factual labels. Return only extracted text; do not summarize or add commentary.`,
          },
          { inlineData: { mimeType: contentType, data: bytesToBase64(bytes) } },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new ApiError(
      `Document parsing failed (${response.status})${detail ? `: ${detail}` : "."}`,
      502,
      "document_parse_failed",
    );
  }
  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return cleanExtractedText(
    (data.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("\n"),
  );
}

export async function extractDocumentText(bytes: Uint8Array, contentType: string, name: string) {
  if (["text/plain", "text/markdown", "text/csv"].includes(contentType)) {
    return cleanExtractedText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  }
  if (contentType === "application/json") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    try {
      return cleanExtractedText(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      throw new ApiError("The uploaded JSON document is invalid.", 422, "invalid_json_document");
    }
  }
  if (contentType === "application/pdf" || contentType.startsWith("image/")) {
    return extractBinaryDocument(bytes, contentType, name);
  }
  throw new ApiError("This file type cannot be converted into searchable document chunks.", 415, "document_type_not_indexable");
}

async function sha256(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runInBatches<T>(items: T[], size: number, operation: (batch: T[]) => Promise<void>) {
  for (let offset = 0; offset < items.length; offset += size) await operation(items.slice(offset, offset + size));
}

export async function indexUploadedDocument(input: {
  fileId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  createdAt: string;
}) {
  const { DB } = runtimeEnv();
  const id = workspaceId();
  const contentHash = await sha256(input.bytes);
  try {
    const text = await extractDocumentText(input.bytes, input.contentType, input.fileName);
    if (!text) throw new ApiError("No readable text was found in the document.", 422, "document_text_empty");
    const chunks = chunkDocument(text);
    if (!chunks.length) throw new ApiError("No searchable chunks could be created.", 422, "document_chunks_empty");
    const rows = chunks.map((chunk, index) => ({
      id: `chunk-${input.fileId}-${index}`,
      fileId: input.fileId,
      fileName: input.fileName,
      chunkIndex: index,
      ...chunk,
    }));

    await runInBatches(rows, 50, async (batch) => {
      await DB.batch(batch.map((chunk) => DB.prepare(`INSERT INTO document_chunks
        (id, workspace_id, file_id, file_name, chunk_index, content, token_count, char_start, char_end, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        chunk.id, id, chunk.fileId, chunk.fileName, chunk.chunkIndex, chunk.content,
        chunk.tokenCount, chunk.charStart, chunk.charEnd, input.createdAt,
      )));
    });

    let embeddedChunkCount = 0;
    let embeddingError: string | null = null;
    for (let offset = 0; offset < rows.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const embedded = await embedRetrievalTexts(batch.map((chunk) => chunk.content), "document");
      if (!embedded.cacheModel || !embedded.vectors.length) {
        embeddingError = embedded.fallbackReason;
        break;
      }
      const vectorRows = batch.flatMap((chunk, index) => {
        const vector = embedded.vectors[index];
        return vector?.length ? [{ chunk, vector }] : [];
      });
      if (vectorRows.length) {
        await DB.batch(vectorRows.map(({ chunk, vector }) => DB.prepare(`INSERT OR REPLACE INTO document_chunk_embeddings
          (chunk_id, workspace_id, model, dimensions, embedding_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`).bind(
          chunk.id, id, embedded.cacheModel, embedded.dimensions, JSON.stringify(vector), input.createdAt,
        )));
      }
      embeddedChunkCount += vectorRows.length;
    }
    const status = embeddedChunkCount === rows.length ? "indexed" : "indexed_lexical";
    const processedAt = new Date().toISOString();
    await DB.prepare(`UPDATE workspace_files SET
      content_hash = ?, processing_status = ?, processing_error = ?, extracted_text_length = ?,
      chunk_count = ?, embedded_chunk_count = ?, processed_at = ?
      WHERE id = ? AND workspace_id = ?`).bind(
      contentHash, status, embeddingError, text.length, rows.length, embeddedChunkCount,
      processedAt, input.fileId, id,
    ).run();
    return { status, contentHash, extractedTextLength: text.length, chunkCount: rows.length, embeddedChunkCount, processingError: embeddingError };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document processing failed.";
    const status = error instanceof ApiError && ["document_parser_unavailable", "document_type_not_indexable"].includes(error.code)
      ? "stored_only"
      : "failed";
    const processedAt = new Date().toISOString();
    await DB.prepare(`UPDATE workspace_files SET
      content_hash = ?, processing_status = ?, processing_error = ?, processed_at = ?
      WHERE id = ? AND workspace_id = ?`).bind(contentHash, status, message.slice(0, 1000), processedAt, input.fileId, id).run();
    return { status, contentHash, extractedTextLength: 0, chunkCount: 0, embeddedChunkCount: 0, processingError: message };
  }
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    left += a[index] ** 2;
    right += b[index] ** 2;
  }
  return left && right ? dot / (Math.sqrt(left) * Math.sqrt(right)) : 0;
}

export async function retrieveDocumentChunks(question: string, openAiApiKey?: string, limit = 5) {
  const { DB } = runtimeEnv();
  const id = workspaceId();
  const chunks = (await DB.prepare(`SELECT document_chunks.* FROM document_chunks
    JOIN workspace_files ON workspace_files.id = document_chunks.file_id
    WHERE document_chunks.workspace_id = ? AND workspace_files.processing_status IN ('indexed', 'indexed_lexical')
    ORDER BY document_chunks.created_at DESC, document_chunks.chunk_index ASC LIMIT 300`)
    .bind(id).all<DocumentChunkRow>()).results;
  if (!chunks.length) return { matches: [], embeddingInputTokens: 0, embeddingProvider: "none", embeddingModel: null, embeddingFallbackReason: null };

  const lexical = chunks.map((chunk) => ({ chunk, lexicalScore: lexicalSimilarity(question, `${chunk.file_name} ${chunk.content}`) }));
  const queryEmbedding = await embedRetrievalTexts([question], "query", openAiApiKey);
  if (!queryEmbedding.cacheModel || !queryEmbedding.vectors[0]?.length) {
    const matches = lexical.map((item) => ({ ...item, semanticScore: 0, score: item.lexicalScore, retrievalMode: "lexical" as const }))
      .sort((a, b) => b.score - a.score).slice(0, limit);
    return { matches, embeddingInputTokens: 0, embeddingProvider: "lexical", embeddingModel: queryEmbedding.model, embeddingFallbackReason: queryEmbedding.fallbackReason };
  }

  const stored = await DB.prepare(`SELECT chunk_id, embedding_json FROM document_chunk_embeddings
    WHERE workspace_id = ? AND model = ? AND dimensions = ?`).bind(id, queryEmbedding.cacheModel, queryEmbedding.dimensions)
    .all<{ chunk_id: string; embedding_json: string }>();
  const vectors = new Map(stored.results.map((row) => [row.chunk_id, JSON.parse(row.embedding_json) as number[]]));
  const missing = chunks.filter((chunk) => !vectors.has(chunk.id));
  let documentEmbeddingTokens = 0;
  await runInBatches(missing, EMBEDDING_BATCH_SIZE, async (batch) => {
    const embedded = await embedRetrievalTexts(batch.map((chunk) => chunk.content), "document", openAiApiKey);
    documentEmbeddingTokens += embedded.inputTokens;
    if (!embedded.cacheModel || !embedded.vectors.length) return;
    const createdAt = new Date().toISOString();
    const vectorRows = batch.flatMap((chunk, index) => embedded.vectors[index]?.length ? [{ chunk, vector: embedded.vectors[index] }] : []);
    if (!vectorRows.length) return;
    await DB.batch(vectorRows.map(({ chunk, vector }) => {
      vectors.set(chunk.id, vector);
      return DB.prepare(`INSERT OR REPLACE INTO document_chunk_embeddings
        (chunk_id, workspace_id, model, dimensions, embedding_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(chunk.id, id, embedded.cacheModel, embedded.dimensions, JSON.stringify(vector), createdAt);
    }));
  });
  const query = queryEmbedding.vectors[0];
  const matches = lexical.map((item) => {
    const semanticScore = Math.max(0, cosineSimilarity(query, vectors.get(item.chunk.id) ?? []));
    return { ...item, semanticScore, score: semanticScore * 0.82 + item.lexicalScore * 0.18, retrievalMode: "hybrid" as const };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  return {
    matches,
    embeddingInputTokens: queryEmbedding.inputTokens + documentEmbeddingTokens,
    embeddingProvider: queryEmbedding.provider,
    embeddingModel: queryEmbedding.model,
    embeddingFallbackReason: queryEmbedding.fallbackReason,
  };
}
