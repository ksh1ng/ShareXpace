import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { lexicalSimilarity } from "../app/api/_lib/retrieval-scoring.ts";
import { chunkDocument } from "../app/api/_lib/document-chunking.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("production edition has exact preflight and provider-reported usage", async () => {
  const [page, layout, model, estimateRoute, askRoute, reuseRoute] = await Promise.all([
    read("../app/workspace-dashboard.tsx"),
    read("../app/layout.tsx"),
    read("../app/api/_lib/model.ts"),
    read("../app/api/questions/estimate/route.ts"),
    read("../app/api/questions/ask/route.ts"),
    read("../app/api/reuse/route.ts"),
  ]);

  assert.match(layout, /Relay Production/);
  assert.match(page, /Exact input/);
  assert.match(page, /Output limit/);
  assert.match(page, /ACTUAL TOKEN USAGE/);
  assert.match(page, /Provider cached input/);
  assert.match(page, /Retrieval embedding input/);
  assert.match(page, /inputEstimateDelta/);
  assert.match(estimateRoute, /relayPreflight/);
  assert.match(model, /\/v1\/responses\/input_tokens/);
  assert.match(model, /inputTokenPayload\(plan\)/);
  assert.match(askRoute, /estimate_required/);
  assert.match(askRoute, /status: 428/);
  assert.match(reuseRoute, /estimate_required/);
});

test("estimate is identity-bound, expiring, single-use, and atomically claimed", async () => {
  const [workspace, schema, migration5, migration6] = await Promise.all([
    read("../app/api/_lib/workspace.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0005_special_risque.sql"),
    read("../drizzle/0006_outgoing_terrax.sql"),
  ]);

  for (const contract of [
    "estimate_actor_mismatch",
    "estimate_expired",
    "estimate_prompt_changed",
    "estimate_route_changed",
    "estimate_record_changed",
    "estimate_claimed",
  ]) assert.match(workspace, new RegExp(contract));
  assert.match(workspace, /claimed_at IS NULL AND consumed_at IS NULL/);
  assert.match(workspace, /result\.meta\.changes/);
  assert.match(schema, /tokenEstimates/);
  assert.match(migration5, /CREATE TABLE `token_estimates`/);
  assert.match(migration6, /ADD `claimed_at`/);
});

test("three-layer routing and knowledge freshness remain enforced", async () => {
  const [workspace, model, relayService, refreshRoute] = await Promise.all([
    read("../app/api/_lib/workspace.ts"),
    read("../app/api/_lib/model.ts"),
    read("../app/api/_lib/relay-service.ts"),
    read("../app/api/knowledge/refresh/route.ts"),
  ]);

  for (const type of ["static", "semi_dynamic", "dynamic", "transactional", "internal_decision"]) {
    assert.match(workspace, new RegExp(type));
  }
  assert.match(workspace, /semantic_cache/);
  assert.match(workspace, /full_generation/);
  assert.match(workspace, /match\.matchType === "exact" && match\.freshness\.directReuseAllowed/);
  assert.match(workspace, /semanticEmbedding: numberSetting\(current\.RELAY_SEMANTIC_EMBEDDING_THRESHOLD, 0\.80\)/);
  assert.match(workspace, /lexicalCache: numberSetting\(current\.RELAY_LEXICAL_CACHE_THRESHOLD, 0\.88\)/);
  assert.match(workspace, /match\.semanticScore >= thresholds\.semanticEmbedding/);
  assert.match(workspace, /match\.lexicalScore >= thresholds\.lexicalCache/);
  assert.ok(
    workspace.indexOf("match.semanticScore >= thresholds.semanticEmbedding") <
      workspace.indexOf("match.score < thresholds.rag", workspace.indexOf("export function classifyDefenseRoute")),
    "independent high-similarity signals must be evaluated before the blended low-score fallback",
  );
  assert.ok(
    workspace.indexOf("match.semanticScore >= thresholds.semanticEmbedding") <
      workspace.indexOf('operation === "generate_with_team_knowledge"', workspace.indexOf("export function classifyDefenseRoute")),
    "high-confidence reuse must take precedence over the generic forced-RAG operation",
  );
  assert.ok(
    workspace.indexOf('match.matchType === "exact" && match.freshness.directReuseAllowed') <
      workspace.indexOf('operation === "generate_with_team_knowledge"', workspace.indexOf("export function classifyDefenseRoute")),
    "fresh exact matching must take precedence over forced RAG",
  );
  assert.match(workspace, /directReuseAllowed/);
  assert.match(model, /effectiveOperation = plan\.route === "semantic_cache" \? "auto" : operation/);
  assert.match(model, /Retrieved historical summaries and sources/);
  assert.ok(model.indexOf("Stable workspace policy and knowledge") < model.indexOf("Current member request"));
  assert.match(model, /prompt_cache_breakpoint/);
  assert.match(model, /prompt_cache_key/);
  assert.match(relayService, /superseded_by/);
  assert.match(relayService, /old\.version \+ 1/);
  assert.match(refreshRoute, /relayExecute/);
});

test("Tokyo itinerary paraphrase remains eligible for conservative lexical cache reuse", () => {
  const stored = "Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.";
  const paraphrase = "Create a 5-day Tokyo itinerary for us. Prioritize walkable neighborhoods, 1 day trip, and a affordable budget.";
  assert.ok(lexicalSimilarity(stored, paraphrase) >= 0.88);
});

test("MCP routes cache locally and hands RAG/full work to the host agent", async () => {
  const [mcpRoute, relayService, workspace, schema, migration7, migration8, page] = await Promise.all([
    read("../app/api/mcp/route.ts"),
    read("../app/api/_lib/relay-service.ts"),
    read("../app/api/_lib/workspace.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0007_mysterious_ironclad.sql"),
    read("../drizzle/0008_nosy_stranger.sql"),
    read("../app/workspace-dashboard.tsx"),
  ]);

  for (const tool of ["relay_create_workspace", "relay_list_workspaces", "relay_preflight", "relay_confirm_route", "relay_execute", "relay_submit_result", "relay_search_memory", "relay_rag_refresh_preflight", "relay_refresh", "relay_post_update", "relay_get_workspace"]) {
    assert.match(mcpRoute, new RegExp(tool));
  }
  assert.match(mcpRoute, /tools\/list/);
  assert.match(mcpRoute, /resources\/list/);
  assert.match(mcpRoute, /resources\/read/);
  assert.match(mcpRoute, /resolveMcpAccess/);
  assert.match(mcpRoute, /withWorkspaceContext\(workspace/);
  assert.match(mcpRoute, /workspaceId is required for this Relay tool/);
  assert.match(mcpRoute, /Never ask the member to add another MCP connection/);
  assert.match(relayService, /relayPreflight/);
  assert.match(relayService, /relayConfirmRoute/);
  assert.match(relayService, /relayExecute/);
  assert.match(relayService, /relayCreateAgentHandoff/);
  assert.match(relayService, /relaySubmitAgentResult/);
  assert.match(relayService, /agent_action_required/);
  assert.match(relayService, /modelCalledByRelay: false/);
  assert.match(relayService, /requiredNextTool: "relay_submit_result"/);
  assert.match(relayService, /status: "cached_answer_returned"/);
  assert.match(relayService, /answer: record\.detail/);
  assert.match(relayService, /refreshWithTeamKnowledge/);
  assert.match(mcpRoute, /## Cached answer/);
  assert.match(mcpRoute, /Display it to the member/);
  assert.match(mcpRoute, /Only if the member explicitly requests an update/);
  assert.match(mcpRoute, /MANDATORY HOST BEHAVIOR/);
  assert.match(mcpRoute, /Do not call another Relay tool in this turn/);
  assert.match(mcpRoute, /confirmedByUser/);
  assert.match(mcpRoute, /user_confirmation_required/);
  assert.match(mcpRoute, /Hybrid similarity/);
  assert.match(mcpRoute, /Raw embedding similarity/);
  assert.match(mcpRoute, /Normalized lexical similarity/);
  assert.match(mcpRoute, /ask whether to use RAG or Full Generation/);
  assert.match(mcpRoute, /preview\.route === "full_generation" && scores\.every\(\(score\) => score === 0\)/);
  assert.match(mcpRoute, /autoRouted: true/);
  assert.match(mcpRoute, /Do not ask the member to choose a route/);
  assert.match(mcpRoute, /all three displayed similarity scores are 0%/);
  assert.match(mcpRoute, /Relay route confirmed/);
  assert.match(mcpRoute, /Effective route/);
  assert.match(relayService, /route_confirmation_required/);
  assert.match(workspace, /force_full_generation/);
  assert.match(workspace, /operation === "rag_refresh"/);
  assert.match(workspace, /keep\n  \/\/ routing local and deterministic|routing local and deterministic/);
  assert.match(workspace, /RELAY_MCP_JOIN_MODE/);
  assert.match(workspace, /listWorkspaces/);
  assert.match(workspace, /requestedBrowserWorkspace/);
  assert.match(mcpRoute, /endpoint: "\/api\/mcp\?member=<display-name>"/);
  assert.match(schema, /mcpEvents/);
  assert.match(migration7, /CREATE TABLE `mcp_events`/);
  assert.match(schema, /export const workspaces/);
  assert.match(migration8, /CREATE TABLE `workspaces`/);
  assert.match(migration8, /VALUES \('RoamTogether', 'RoamTogether'/);
  assert.match(migration8, /UPDATE `memory_records` SET `workspace_id` = 'RoamTogether'/);
  assert.match(page, /One workspace gateway for every agent/);
  assert.match(page, /relay_preflight/);
});

test("semantic retrieval supports Gemini with cached vectors and safe fallback", async () => {
  const [workspace, envExample, readme] = await Promise.all([
    read("../app/api/_lib/workspace.ts"),
    read("../.env.example"),
    read("../README.md"),
  ]);
  assert.match(workspace, /batchEmbedContents/);
  assert.match(workspace, /gemini-embedding-001:semantic-similarity:v2/);
  assert.match(workspace, /taskType: "SEMANTIC_SIMILARITY"/);
  assert.match(workspace, /embedContentConfig/);
  assert.match(workspace, /documents = missing\.map\(\(record\) => record\.title\)/);
  assert.match(workspace, /outputDimensionality: provider\.dimensions/);
  assert.match(workspace, /lexical_fallback/);
  assert.match(workspace, /embeddingFallbackReason/);
  assert.match(workspace, /model = \? AND dimensions = \?/);
  assert.match(envExample, /GEMINI_API_KEY=/);
  assert.match(envExample, /RELAY_EMBEDDING_PROVIDER=auto/);
  assert.match(readme, /one query embedding/);
});

test("R2 uploads are parsed, chunked, embedded, retrieved, and reset per workspace", async () => {
  const [filesRoute, ingestion, schema, migration9, model, relayService, resetRoute, stateRoute, page, envExample] = await Promise.all([
    read("../app/api/files/route.ts"),
    read("../app/api/_lib/document-ingestion.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0009_famous_angel.sql"),
    read("../app/api/_lib/model.ts"),
    read("../app/api/_lib/relay-service.ts"),
    read("../app/api/knowledge/reset/route.ts"),
    read("../app/api/state/route.ts"),
    read("../app/workspace-dashboard.tsx"),
    read("../.env.example"),
  ]);
  assert.match(filesRoute, /FILES\.put/);
  assert.match(filesRoute, /indexUploadedDocument/);
  assert.match(ingestion, /extractDocumentText/);
  assert.match(ingestion, /document_chunk_embeddings/);
  assert.match(ingestion, /retrieveDocumentChunks/);
  assert.match(ingestion, /embedRetrievalTexts\(batch\.map\(\(chunk\) => chunk\.content\), "document"\)/);
  assert.match(schema, /documentChunks/);
  assert.match(schema, /documentChunkEmbeddings/);
  assert.match(migration9, /CREATE TABLE `document_chunks`/);
  assert.match(migration9, /ADD `processing_status`/);
  assert.match(model, /ragDocumentChunks/);
  assert.match(relayService, /uploaded document/);
  assert.match(resetRoute, /DELETE FROM document_chunk_embeddings/);
  assert.match(resetRoute, /DELETE FROM document_chunks/);
  assert.match(stateRoute, /documents: state\.documents/);
  assert.match(page, /Document RAG/);
  assert.match(envExample, /RELAY_DOCUMENT_PARSER_MODEL=gemini-2\.5-flash/);

  const text = `${"A".repeat(1_200)}\n\n${"B".repeat(1_200)}`;
  const chunks = chunkDocument(text);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.content.length <= 1_600));
  assert.ok(chunks[1].charStart < chunks[0].charEnd, "adjacent chunks should overlap");
});

test("dashboard and MCP expose the configured workspace identity", async () => {
  const [page, stateRoute, mcpRoute, workspace, envExample] = await Promise.all([
    read("../app/workspace-dashboard.tsx"),
    read("../app/api/state/route.ts"),
    read("../app/api/mcp/route.ts"),
    read("../app/api/_lib/workspace.ts"),
    read("../.env.example"),
  ]);

  assert.match(workspace, /RELAY_WORKSPACE_NAME/);
  assert.match(workspace, /const name = workspaceName\(\)/);
  assert.match(workspace, /workspace: \{ id, name \}/);
  assert.match(stateRoute, /workspace: state\.workspace/);
  assert.match(mcpRoute, /workspace: state\.workspace/);
  assert.match(page, /setWorkspace\(data\.workspace/);
  assert.match(page, /Workspace ID copied/);
  assert.match(page, /workspace-id-chip/);
  assert.match(envExample, /RELAY_WORKSPACE_ID=RoamTogether/);
  assert.match(envExample, /RELAY_WORKSPACE_NAME=RoamTogether/);
  assert.match(workspace, /AsyncLocalStorage<WorkspaceContext>/);
  assert.match(workspace, /createWorkspace/);
  assert.match(workspace, /INSERT INTO workspaces/);
  assert.match(mcpRoute, /uiUrl: `\$\{new URL\(request\.url\)\.origin\}\$\{created\.uiPath\}`/);
  assert.match(mcpRoute, /Workspace UI:/);
  assert.match(page, /workspaceApi\("\/api\/state"\)/);
});

test("workspace dashboard URLs scope every browser API to the selected partition", async () => {
  const [dashboard, dynamicPage, workspace, ...routes] = await Promise.all([
    read("../app/workspace-dashboard.tsx"),
    read("../app/[workspaceId]/page.tsx"),
    read("../app/api/_lib/workspace.ts"),
    ...[
      "chat/route.ts",
      "chat/run/route.ts",
      "files/route.ts",
      "knowledge/refresh/route.ts",
      "knowledge/reset/route.ts",
      "questions/ask/route.ts",
      "questions/check/route.ts",
      "questions/estimate/route.ts",
      "reuse/route.ts",
      "state/route.ts",
    ].map((route) => read(`../app/api/${route}`)),
  ]);

  assert.match(dynamicPage, /initialWorkspaceId=\{decodedWorkspaceId\}/);
  assert.match(dashboard, /workspaceQuery = initialWorkspaceId/);
  for (const endpoint of ["state", "chat", "questions/estimate", "reuse", "questions/ask", "knowledge/refresh", "chat/run", "files", "knowledge/reset"]) {
    assert.match(dashboard, new RegExp(`workspaceApi\\(\"\\/api\\/${endpoint.replace("/", "\\/")}\"\\)`));
  }
  assert.match(workspace, /searchParams\.get\("workspace_id"\)/);
  assert.match(workspace, /withWorkspaceContext\(workspace, operation\)/);
  for (const route of routes) assert.match(route, /withRequestedWorkspaceResponse/);
});

test("dashboard presence is recent-only and shared knowledge is generated-only", async () => {
  const [workspace, page, envExample, readme] = await Promise.all([
    read("../app/api/_lib/workspace.ts"),
    read("../app/workspace-dashboard.tsx"),
    read("../.env.example"),
    read("../README.md"),
  ]);

  assert.match(workspace, /agentOnlineWindowSeconds/);
  assert.match(workspace, /created_at >= \?/);
  assert.match(workspace, /RELAY_AGENT_ONLINE_WINDOW_SECONDS/);
  assert.match(workspace, /routing_events\.record_id = memory_records\.id/);
  assert.match(workspace, /routing_events\.route IN \('rag', 'full_generation'\)/);
  assert.match(workspace, /routing_events\.action IN \('agent_result', 'generate', 'refresh'\)/);
  assert.doesNotMatch(page, /const agents =/);
  assert.match(page, /No agents active in the last/);
  assert.match(page, /window\.setInterval\(loadWorkspace, 10000\)/);
  assert.match(page, /Responses saved after RAG or Full Generation/);
  assert.doesNotMatch(page, /Everything your team and their agents have contributed/);
  assert.match(envExample, /RELAY_AGENT_ONLINE_WINDOW_SECONDS=120/);
  assert.match(readme, /Shared Knowledge view is intentionally curated/);
});

test("shared knowledge reset is authenticated, confirmed, and clears vector state", async () => {
  const [page, route, readme] = await Promise.all([
    read("../app/workspace-dashboard.tsx"),
    read("../app/api/knowledge/reset/route.ts"),
    read("../README.md"),
  ]);

  assert.match(page, /Reset knowledge/);
  assert.match(page, /RESET SHARED KNOWLEDGE/);
  assert.match(page, /\/api\/knowledge\/reset/);
  assert.match(page, /resetWorkspaceId !== workspace\.id/);
  assert.match(route, /requireActor\(request\)/);
  assert.match(route, /body\.workspaceId !== workspaceId\(\)/);
  assert.match(route, /body\.confirmation !== RESET_PHRASE/);
  assert.match(route, /DELETE FROM record_embeddings/);
  assert.match(route, /DELETE FROM answer_cache/);
  assert.match(route, /DELETE FROM memory_records/);
  assert.match(route, /DELETE FROM workspace_files/);
  assert.match(route, /FILES\.delete/);
  assert.match(route, /bumpKnowledgeVersion/);
  assert.match(readme, /Authenticated Dashboard users can choose \*\*Reset knowledge\*\*/);
});

test("demo guide includes beginner Codex MCP setup and verification", async () => {
  const [guide, installer, launcher] = await Promise.all([
    read("../DEMO_GUIDE.md"),
    read("../scripts/install-relay-demo.sh"),
    read("../INSTALL_RELAY_DEMO.command"),
  ]);
  assert.match(guide, /curl -fsSL https:\/\/chatgpt\.com\/codex\/install\.sh \| sh/);
  assert.match(guide, /codex --version/);
  assert.match(guide, /Sign in with ChatGPT/);
  assert.match(guide, /INSTALL_RELAY_DEMO\.command/);
  assert.match(guide, /## 3\. Codex App 展示版本/);
  assert.match(guide, /## 4\. Codex CLI 展示版本/);
  assert.match(guide, /Codex → Plugins/);
  assert.match(guide, /ShareXspace/);
  assert.match(guide, /用 `\/plugins` 從 \*\*ShareXspace\*\* 安裝 Plugin/);
  assert.match(guide, /Plugin 安裝前已開啟的舊 task 不會自動載入/);
  assert.match(guide, /codex mcp add relay/);
  assert.match(guide, /api\/mcp\?member=Alice/);
  assert.match(guide, /relay_list_workspaces/);
  assert.doesNotMatch(guide, /--bearer-token-env-var RELAY_MCP_TOKEN/);
  assert.match(guide, /relay_get_workspace/);
  assert.match(guide, /Workspace ID: RoamTogether/);
  assert.match(guide, /一般成員不需要設定 `OPENAI_API_KEY`/);
  assert.match(guide, /codex mcp remove relay/);
  assert.match(installer, /https:\/\/chatgpt\.com\/codex\/install\.sh/);
  assert.match(installer, /codex mcp add "\$RELAY_NAME"/);
  assert.match(installer, /connection_url="\$\{RELAY_URL\}\?member=\$\{member_name\}"/);
  assert.doesNotMatch(installer, /entered_workspace_id|workspace_id=\$\{/);
  assert.doesNotMatch(installer, /launchctl setenv|bearer-token/);
  assert.match(installer, /launchctl unsetenv RELAY_MCP_TOKEN/);
  assert.match(installer, /"method":"initialize"/);
  assert.match(installer, /handshake returned HTTP/);
  assert.match(installer, /handshake succeeded \(HTTP 200\)/);
  assert.match(installer, /exec codex/);
  assert.match(launcher, /install-relay-demo\.sh/);
  assert.equal(spawnSync("bash", ["-n", new URL("../scripts/install-relay-demo.sh", import.meta.url).pathname]).status, 0);
  assert.equal(spawnSync("bash", ["-n", new URL("../INSTALL_RELAY_DEMO.command", import.meta.url).pathname]).status, 0);
});

test("ShareXspace plugin bundles the Relay MCP connection, hosted-data contract, and shareable installer", async () => {
  const [manifestText, mcpText, marketplaceText, skill, pluginReadme, rootReadme, installer, launcher, packager] = await Promise.all([
    read("../plugins/sharexspace/.codex-plugin/plugin.json"),
    read("../plugins/sharexspace/.mcp.json"),
    read("../.agents/plugins/marketplace.json"),
    read("../plugins/sharexspace/skills/sharexspace-workspace/SKILL.md"),
    read("../plugins/sharexspace/README.md"),
    read("../README.md"),
    read("../scripts/install-sharexspace-plugin.sh"),
    read("../INSTALL_SHAREXSPACE_PLUGIN.command"),
    read("../scripts/package-sharexspace-plugin.sh"),
  ]);
  const manifest = JSON.parse(manifestText);
  const mcp = JSON.parse(mcpText);
  const marketplace = JSON.parse(marketplaceText);

  assert.equal(manifest.name, "sharexspace");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.interface.composerIcon, "./assets/sharexspace-icon.png");
  assert.equal(manifest.interface.logo, "./assets/sharexspace-icon.png");
  assert.equal(mcp.mcpServers.relay.type, "http");
  assert.equal(mcp.mcpServers.relay.url, "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?member=Codex%20Plugin");
  assert.equal(marketplace.name, "sharexspace");
  assert.equal(marketplace.plugins[0].source.path, "./plugins/sharexspace");
  assert.match(skill, /Call `relay_preflight` first/);
  assert.match(skill, /automatic `full_generation` with all three similarities at zero/);
  assert.match(skill, /call `relay_submit_result`/);
  assert.match(skill, /call no more tools/);
  assert.match(skill, /user's Codex host owns all RAG and Full Generation inference/);
  assert.match(skill, /do not ask the user to run `codex mcp add`/);
  assert.match(pluginReadme, /使用者自己的 Codex host model/);
  assert.match(pluginReadme, /codex plugin marketplace add/);
  assert.match(pluginReadme, /codex plugin add sharexspace@sharexspace/);
  assert.match(pluginReadme, /使用者的 Codex 模型 credential 不會傳送給 Relay/);
  assert.match(rootReadme, /Produce the standalone package/);
  assert.match(installer, /codex plugin marketplace add "\$ROOT_DIR"/);
  assert.match(installer, /codex plugin add "\$PLUGIN_NAME@\$MARKETPLACE_NAME"/);
  assert.match(installer, /"method":"initialize"/);
  assert.match(packager, /plugins\/sharexspace/);
  assert.match(packager, /\.agents\/plugins\/marketplace\.json/);
  assert.match(launcher, /install-sharexspace-plugin\.sh/);
  assert.equal(spawnSync("bash", ["-n", new URL("../scripts/install-sharexspace-plugin.sh", import.meta.url).pathname]).status, 0);
  assert.equal(spawnSync("bash", ["-n", new URL("../scripts/package-sharexspace-plugin.sh", import.meta.url).pathname]).status, 0);
  assert.equal(spawnSync("bash", ["-n", new URL("../INSTALL_SHAREXSPACE_PLUGIN.command", import.meta.url).pathname]).status, 0);
});

test("production removes runtime demo bootstrap and requires identity", async () => {
  const [workspace, envExample, hosting, readme, layout, rootPage, workspacePage, stateRoute] = await Promise.all([
    read("../app/api/_lib/workspace.ts"),
    read("../.env.example"),
    read("../.openai/hosting.json"),
    read("../README.md"),
    read("../app/layout.tsx"),
    read("../app/page.tsx"),
    read("../app/[workspaceId]/page.tsx"),
    read("../app/api/state/route.ts"),
  ]);

  assert.match(workspace, /requireActor/);
  assert.match(workspace, /authentication_required/);
  assert.doesNotMatch(workspace, /ensureKnowledgeSeeds|demoAnswer|INSERT OR IGNORE INTO memory_records/);
  assert.match(envExample, /RELAY_APP_MODE=production/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"project_id": "appgprj_/);
  assert.match(readme, /no demo seeds/);
  assert.match(rootPage, /requireChatGPTUser\("\/"\)/);
  assert.match(workspacePage, /requireChatGPTUser\(`\/\$\{encodeURIComponent\(decodedWorkspaceId\)\}`\)/);
  assert.match(workspacePage, /import WorkspaceDashboardView from "\.\.\/workspace-dashboard"/);
  assert.match(workspacePage, /<WorkspaceDashboardView initialWorkspaceId=\{decodedWorkspaceId\} \/>/);
  assert.doesNotMatch(workspacePage, /import WorkspaceDashboard from "\.\.\/workspace-dashboard"/);
  assert.match(workspacePage, /initialWorkspaceId=\{decodedWorkspaceId\}/);
  assert.match(layout, /force-dynamic/);
  assert.match(stateRoute, /requireActor\(request\)/);
  assert.match(readme, /public at the dispatch layer/);
  await access(new URL("../dist/server/index.js", import.meta.url));
});
