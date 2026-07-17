# Relay MCP MVP — Demo 使用說明書

本文件對應 `team-memory-production` 的目前實作。Demo 使用一個固定 Workspace，重點是展示多個 Codex／Agent 經由 Relay MCP 共用團隊記憶，以及 Semantic Cache、RAG、Full Generation 三層路由如何降低重複模型用量。

## 1. Demo 目前能展示什麼

- Web Dashboard 與多個 MCP Client 共用同一個 Workspace。
- Codex、ChatGPT、IDE Agent 或其他 MCP Client 可連接 `/api/mcp`。
- 每次 Agent 工作前必須先執行 `relay_preflight`。
- 全新問題走 Full Generation。
- 相關問題可強制展示 RAG，引用團隊既有答案摘要與來源。
- 相同或高度相似且未過期的問題走 Semantic Cache，不呼叫主 LLM。
- RAG／Full Generation 由 MCP Host 的 Agent 自己推理，Relay 不需要 Generation API key。
- Agent 完成後呼叫 `relay_submit_result`，答案才會進入共享記憶與聊天。
- Agent 可透過 `relay_post_update` 把結果貼回共同聊天。
- Refresh 會建立新版本並保留、supersede 舊版本。

目前尚未提供使用者自行建立／加入多個 Workspace；`RELAY_WORKSPACE_ID` 決定這次部署使用的固定 Workspace。上傳到 R2 的檔案目前只保存 bytes 與 metadata，尚未自動解析及建立文件 chunks。

## 2. Demo 前準備

### 必要條件

- Node.js 22.13 或更新版本。
- pnpm。
- 已套用 `drizzle/0000` 至 `drizzle/0007` 的 D1 database。
- D1 binding：`DB`。
- R2 binding：`FILES`。
- MCP bearer token；`OPENAI_API_KEY` 僅為選用的 embedding／精確 token count 增強。

### 環境設定

複製 `.env.example` 為 `.env.local`，至少設定：

```env
RELAY_APP_MODE=production
RELAY_WORKSPACE_ID=relay-build-week-demo
RELAY_ALLOW_LOCAL_ANONYMOUS=true
RELAY_MCP_ACCESS_TOKENS={"alice-demo-token":"Alice","bob-demo-token":"Bob","carol-demo-token":"Carol"}
```

不要把 `.env.local`、真實 API key 或 MCP bearer tokens commit 到 Git。

### 安裝與驗證

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm dev
```

Web Dashboard 使用開發伺服器顯示的 URL。MCP endpoint 是相同 host 下的 `/api/mcp`。

## 3. 建議 Demo 角色

| 成員 | Client | Demo 工作 |
| --- | --- | --- |
| Alice | Codex | 建立第一筆全新研究結果 |
| Bob | ChatGPT／另一個 MCP Client | 用團隊知識延伸答案 |
| Carol | IDE Agent／第三個 MCP Client | 重問相同問題並命中 Semantic Cache |

MCP Client 應設定：

```text
URL: https://<relay-host>/api/mcp
Authorization: Bearer <member-token>
```

每位成員使用不同 token，Dashboard 才能分辨成員與 Client 活動。

## 4. 三分鐘 Demo 腳本

### Scene 1 — Full Generation

Alice 輸入：

```text
Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.
```

執行：

1. `relay_preflight`，`operation` 使用 `auto`。
2. 畫面確認 Route 為 `full_generation`。
3. 說明送出前已顯示 route 與 token estimate；沒有 provider key 時是 Relay 本機估算。
4. 將 preflight ID 傳給 `relay_execute`。
5. Relay 回傳 `agent_action_required`、完整有效 Workspace context 與 `requiredNextTool=relay_submit_result`。
6. Alice 的 Codex 使用自己的 Host Model 完成答案，再呼叫 `relay_submit_result` 寫入 Shared Memory。

### Scene 2 — RAG

Bob 輸入：

```text
Create a five-day Tokyo itinerary for our team, but adapt the existing plan for one rainy day and vegetarian dining.
```

為了讓現場 Demo 穩定展示 RAG，執行 `relay_preflight` 時設定：

```json
{
  "operation": "generate_with_team_knowledge"
}
```

接著：

1. 確認結果包含 Alice 的既有答案。
2. 確認 Route 為 `rag`。
3. 執行 `relay_execute`。
4. 指出 Relay 只把相關且未過期的摘要／來源交還 Bob 的 Agent；Relay 本身沒有呼叫 Generation API。
5. Bob 的 Agent 完成後呼叫 `relay_submit_result`。

### Scene 3 — Semantic Cache

Carol 再次輸入與 Alice 完全相同的問題：

```text
Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.
```

執行：

1. `relay_preflight`，`operation` 使用 `auto`。
2. Exact fingerprint 應命中 Alice 的答案。
3. Route 顯示 `semantic_cache`。
4. Preflight 的 main-model input 與 output ceiling 應為 `0`。
5. 執行 `relay_execute`，直接取得既有答案。
6. Dashboard 的 Semantic 次數、Duplicates 與 Estimated tokens saved 增加。

### Scene 4 — 貼回共同聊天

任一 Agent 執行：

```text
relay_post_update
```

內容範例：

```text
Tokyo itinerary completed. The rainy-day version and vegetarian options are now available in shared memory.
```

切回 Web Dashboard，展示 Agent 結果已出現在 Shared Chat，其他成員不需要複製貼上。

### Scene 5 — Dashboard 收尾

展示：

- Semantic Cache、RAG、Full Generation 次數。
- Estimated tokens saved。
- Provider-reported actual cached input tokens。
- Preflight 次數。
- MCP connected identities 與 audited tool calls。
- Shared Memory 中 Alice、Bob 建立的答案。

## 5. MCP JSON-RPC 範例

下列範例適合本機 smoke test。請替換 host 與 token。

### Initialize

```bash
curl https://<relay-host>/api/mcp \
  -H "Authorization: Bearer alice-demo-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"alice-codex","version":"1.0"}}}'
```

### List tools

```bash
curl https://<relay-host>/api/mcp \
  -H "Authorization: Bearer alice-demo-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

### Preflight、handoff 與結果回寫

```bash
curl https://<relay-host>/api/mcp \
  -H "Authorization: Bearer alice-demo-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"relay_preflight","arguments":{"question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","operation":"auto"}}}'
```

從 `structuredContent.estimate.id` 複製 preflight ID，再執行：

```bash
curl https://<relay-host>/api/mcp \
  -H "Authorization: Bearer alice-demo-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"relay_execute","arguments":{"preflightId":"<preflight-id>","question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","agent":"Alice Codex","operation":"auto","knowledgeType":"semi_dynamic"}}}'
```

Preflight ID 會過期、綁定成員與問題，而且只能使用一次。修改問題文字、換成員或重複送出都會被拒絕。

若 `relay_execute` 回傳 `status=agent_action_required`，Agent 應使用 `handoff.systemInstructions`、`handoff.context` 和 `handoff.question` 自己完成工作，接著呼叫：

```bash
curl https://<relay-host>/api/mcp \
  -H "Authorization: Bearer alice-demo-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"relay_submit_result","arguments":{"preflightId":"<preflight-id>","question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","answer":"<agent-final-answer>","agent":"Alice Codex","model":"codex-host-model","knowledgeType":"semi_dynamic"}}}'
```

## 6. Refresh Demo

Refresh 需要一筆包含 `source_url` 的 knowledge record。Production 不會自動建立假 seed，因此若沒有這類紀錄，可在主 Demo 中略過 Refresh。

若已準備 sourced record：

1. 使用 `relay_refresh_preflight({ recordId })`。
2. 取得 preflight ID。
3. 使用 `relay_refresh({ preflightId, recordId })`。
4. Relay 回傳 source URL 與 Full Generation handoff，Host Agent 自行查證並生成。
5. Agent 呼叫 `relay_submit_result`。
6. 舊紀錄保留並設定 `superseded_by`；新紀錄版本加一。

## 7. Demo 成功檢查表

- [ ] 三位 MCP 身份使用不同 bearer tokens。
- [ ] Alice 的第一題顯示 Full Generation。
- [ ] Bob 的延伸題顯示 RAG。
- [ ] Carol 的相同題顯示 Semantic Cache。
- [ ] Semantic Cache 的 main-model usage 為零。
- [ ] RAG／Full 回傳 `agent_action_required`，且 Relay generation usage 為零。
- [ ] Host Agent 完成後呼叫 `relay_submit_result`。
- [ ] Shared Chat 收到 Agent 貼回的進度。
- [ ] Dashboard 三種 Route 都有統計。
- [ ] Dashboard 分開顯示 actual cached tokens 與 estimated saved tokens。
- [ ] Shared Memory 可看到新答案。

## 8. 常見問題

### `database_not_ready`

D1 migration 尚未完整套用。確認 `drizzle/0000` 到 `drizzle/0007` 都已執行。

### `mcp_authentication_required`

Bearer token 不在 `RELAY_MCP_ACCESS_TOKENS` 中，或 Authorization header 格式錯誤。

### 沒有 `OPENAI_API_KEY`

MCP 仍可使用 exact／lexical retrieval 並把 RAG／Full 工作交給 Host Agent。設定 `OPENAI_API_KEY` 只會提升 embedding retrieval 與 input-token count，不會讓 Relay 代替 Agent 生成。

### `estimate_expired` 或 `estimate_prompt_changed`

重新執行 `relay_preflight`，並確保 execute 使用完全相同的問題文字。

### RAG 變成 Full Generation

新問題與既有答案的 Hybrid score 低於 RAG threshold。Demo 時使用與 Alice 高度相關的問題，並設定 `operation=generate_with_team_knowledge`。

### Semantic Cache 沒有命中

確認問題完全相同，且原紀錄沒有過期、`requires_refresh`、`superseded_by`，也不是 `transactional`。

## 9. 主要文件

- `README.md`：產品、環境變數與部署概覽。
- `DEVELOPMENT.md`：架構和檔案／function 交接。
- `DEMO_GUIDE.md`：本文件。
- `app/api/mcp/route.ts`：MCP tools/resources 與 JSON-RPC transport。
- `app/api/_lib/relay-service.ts`：Web 與 MCP 共用流程。
- `app/api/_lib/workspace.ts`：D1、TTL、Retrieval、Token estimate 與統計。
- `app/api/_lib/model.ts`：Prompt、token counting 與 GPT-5.6 generation。
