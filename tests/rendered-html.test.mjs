import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(workspace, /directReuseAllowed/);
  assert.match(model, /Retrieved historical summaries and sources/);
  assert.ok(model.indexOf("Stable workspace policy and knowledge") < model.indexOf("Current member request"));
  assert.match(model, /prompt_cache_breakpoint/);
  assert.match(model, /prompt_cache_key/);
  assert.match(relayService, /superseded_by/);
  assert.match(relayService, /old\.version \+ 1/);
  assert.match(refreshRoute, /relayExecute/);
});

test("MCP is a first-class gateway over the same Relay service", async () => {
  const [mcpRoute, relayService, workspace, schema, migration7, page] = await Promise.all([
    read("../app/api/mcp/route.ts"),
    read("../app/api/_lib/relay-service.ts"),
    read("../app/api/_lib/workspace.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0007_mysterious_ironclad.sql"),
    read("../app/page.tsx"),
  ]);

  for (const tool of ["relay_preflight", "relay_execute", "relay_search_memory", "relay_refresh", "relay_post_update", "relay_get_workspace"]) {
    assert.match(mcpRoute, new RegExp(tool));
  }
  assert.match(mcpRoute, /tools\/list/);
  assert.match(mcpRoute, /resources\/list/);
  assert.match(mcpRoute, /resources\/read/);
  assert.match(mcpRoute, /requireMcpActor/);
  assert.match(relayService, /relayPreflight/);
  assert.match(relayService, /relayExecute/);
  assert.match(workspace, /RELAY_MCP_ACCESS_TOKENS/);
  assert.match(schema, /mcpEvents/);
  assert.match(migration7, /CREATE TABLE `mcp_events`/);
  assert.match(page, /One workspace gateway for every agent/);
  assert.match(page, /relay_preflight/);
});

test("production removes runtime demo bootstrap and requires identity", async () => {
  const [workspace, envExample, hosting, readme] = await Promise.all([
    read("../app/api/_lib/workspace.ts"),
    read("../.env.example"),
    read("../.openai/hosting.json"),
    read("../README.md"),
  ]);

  assert.match(workspace, /requireActor/);
  assert.match(workspace, /authentication_required/);
  assert.doesNotMatch(workspace, /ensureKnowledgeSeeds|demoAnswer|INSERT OR IGNORE INTO memory_records/);
  assert.match(envExample, /RELAY_APP_MODE=production/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"project_id": "appgprj_/);
  assert.match(readme, /no demo seeds/);
  await access(new URL("../dist/server/index.js", import.meta.url));
});
