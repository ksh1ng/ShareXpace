import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { lexicalSimilarity } from "../app/api/_lib/retrieval-scoring.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("production edition has exact preflight and provider-reported usage", async () => {
  const [page, layout, model, estimateRoute, askRoute, reuseRoute] = await Promise.all([
    read("../app/page.tsx"),
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
  const [mcpRoute, relayService, workspace, schema, migration7, page] = await Promise.all([
    read("../app/api/mcp/route.ts"),
    read("../app/api/_lib/relay-service.ts"),
    read("../app/api/_lib/workspace.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0007_mysterious_ironclad.sql"),
    read("../app/page.tsx"),
  ]);

  for (const tool of ["relay_preflight", "relay_execute", "relay_submit_result", "relay_search_memory", "relay_rag_refresh_preflight", "relay_refresh", "relay_post_update", "relay_get_workspace"]) {
    assert.match(mcpRoute, new RegExp(tool));
  }
  assert.match(mcpRoute, /tools\/list/);
  assert.match(mcpRoute, /resources\/list/);
  assert.match(mcpRoute, /resources\/read/);
  assert.match(mcpRoute, /requireMcpActor/);
  assert.match(relayService, /relayPreflight/);
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
  assert.match(workspace, /operation === "rag_refresh"/);
  assert.match(workspace, /keep\n  \/\/ routing local and deterministic|routing local and deterministic/);
  assert.match(workspace, /RELAY_MCP_JOIN_MODE/);
  assert.match(workspace, /workspace_access_denied/);
  assert.match(workspace, /searchParams\.get\("workspace_id"\)/);
  assert.match(schema, /mcpEvents/);
  assert.match(migration7, /CREATE TABLE `mcp_events`/);
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
  assert.match(workspace, /RETRIEVAL_QUERY/);
  assert.match(workspace, /RETRIEVAL_DOCUMENT/);
  assert.match(workspace, /outputDimensionality: provider\.dimensions/);
  assert.match(workspace, /lexical_fallback/);
  assert.match(workspace, /model = \? AND dimensions = \?/);
  assert.match(envExample, /GEMINI_API_KEY=/);
  assert.match(envExample, /RELAY_EMBEDDING_PROVIDER=auto/);
  assert.match(readme, /one query embedding/);
});

test("dashboard and MCP expose the configured workspace identity", async () => {
  const [page, stateRoute, mcpRoute, workspace, envExample] = await Promise.all([
    read("../app/page.tsx"),
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
  assert.match(envExample, /RELAY_WORKSPACE_NAME=RoamTogether Development/);
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
  assert.match(guide, /codex mcp add relay/);
  assert.match(guide, /workspace_id=relay-production/);
  assert.doesNotMatch(guide, /--bearer-token-env-var RELAY_MCP_TOKEN/);
  assert.match(guide, /relay_get_workspace/);
  assert.match(guide, /Workspace ID: relay-production/);
  assert.match(guide, /一般成員不需要設定 `OPENAI_API_KEY`/);
  assert.match(guide, /codex mcp remove relay/);
  assert.match(installer, /https:\/\/chatgpt\.com\/codex\/install\.sh/);
  assert.match(installer, /codex mcp add "\$RELAY_NAME"/);
  assert.match(installer, /workspace_id=\$\{workspace_id\}/);
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

test("production removes runtime demo bootstrap and requires identity", async () => {
  const [workspace, envExample, hosting, readme, layout, stateRoute] = await Promise.all([
    read("../app/api/_lib/workspace.ts"),
    read("../.env.example"),
    read("../.openai/hosting.json"),
    read("../README.md"),
    read("../app/layout.tsx"),
    read("../app/api/state/route.ts"),
  ]);

  assert.match(workspace, /requireActor/);
  assert.match(workspace, /authentication_required/);
  assert.doesNotMatch(workspace, /ensureKnowledgeSeeds|demoAnswer|INSERT OR IGNORE INTO memory_records/);
  assert.match(envExample, /RELAY_APP_MODE=production/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"project_id": "appgprj_/);
  assert.match(readme, /no demo seeds/);
  assert.match(layout, /requireChatGPTUser\("\/"\)/);
  assert.match(layout, /force-dynamic/);
  assert.match(stateRoute, /requireActor\(request\)/);
  assert.match(readme, /public at the dispatch layer/);
  await access(new URL("../dist/server/index.js", import.meta.url));
});
