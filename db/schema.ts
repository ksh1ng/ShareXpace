import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const memoryRecords = sqliteTable("memory_records", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  author: text("author").notNull(),
  agent: text("agent").notNull(),
  model: text("model"),
  tokenCount: integer("token_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  knowledgeType: text("knowledge_type").notNull().default("dynamic"),
  expiresAt: text("expires_at"),
  generatedAt: text("generated_at"),
  allowDirectReuse: integer("allow_direct_reuse").notNull().default(1),
  requiresRefresh: integer("requires_refresh").notNull().default(0),
  supersededBy: text("superseded_by"),
  sourceUrl: text("source_url"),
  summary: text("summary"),
  recordVersion: integer("version").notNull().default(1),
});

export const reuseEvents = sqliteTable("reuse_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  recordId: text("record_id").notNull(),
  question: text("question").notNull(),
  savedTokens: integer("saved_tokens").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
});

export const workspaceFiles = sqliteTable("workspace_files", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectKey: text("object_key").notNull(),
  author: text("author").notNull(),
  createdAt: text("created_at").notNull(),
});

export const answerCache = sqliteTable("answer_cache", {
  workspaceId: text("workspace_id").notNull(),
  questionFingerprint: text("question_fingerprint").notNull(),
  recordId: text("record_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.questionFingerprint] })]);

export const workspaceCacheState = sqliteTable("workspace_cache_state", {
  workspaceId: text("workspace_id").primaryKey(),
  knowledgeVersion: integer("knowledge_version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const modelCalls = sqliteTable("model_calls", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  promptCacheKey: text("prompt_cache_key").notNull(),
  knowledgeVersion: integer("knowledge_version").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  author: text("author").notNull(),
  messageType: text("message_type").notNull(),
  content: text("content").notNull(),
  agent: text("agent"),
  model: text("model"),
  billingMode: text("billing_mode"),
  taskStatus: text("task_status"),
  sourceMessageId: text("source_message_id"),
  createdAt: text("created_at").notNull(),
});

export const recordEmbeddings = sqliteTable("record_embeddings", {
  recordId: text("record_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  model: text("model").notNull(),
  dimensions: integer("dimensions").notNull(),
  embeddingJson: text("embedding_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const routingEvents = sqliteTable("routing_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  route: text("route").notNull(),
  action: text("action").notNull(),
  similarity: real("similarity").notNull().default(0),
  actualCachedTokens: integer("actual_cached_tokens").notNull().default(0),
  estimatedTokensSaved: integer("estimated_tokens_saved").notNull().default(0),
  recordId: text("record_id"),
  createdAt: text("created_at").notNull(),
});

export const tokenEstimates = sqliteTable("token_estimates", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  actor: text("actor").notNull(),
  questionFingerprint: text("question_fingerprint").notNull(),
  operation: text("operation").notNull(),
  route: text("route").notNull(),
  model: text("model").notNull(),
  recordId: text("record_id"),
  estimatedInputTokens: integer("estimated_input_tokens").notNull().default(0),
  maxOutputTokens: integer("max_output_tokens").notNull().default(0),
  estimatedSavedTokens: integer("estimated_saved_tokens").notNull().default(0),
  retrievalInputTokens: integer("retrieval_input_tokens").notNull().default(0),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  claimedAt: text("claimed_at"),
  consumedAt: text("consumed_at"),
  actualInputTokens: integer("actual_input_tokens"),
  actualOutputTokens: integer("actual_output_tokens"),
  actualTotalTokens: integer("actual_total_tokens"),
  actualCachedTokens: integer("actual_cached_tokens"),
  actualRetrievalInputTokens: integer("actual_retrieval_input_tokens"),
});
