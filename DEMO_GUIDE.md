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
- Dashboard 的 **CONNECTED AGENTS** 只顯示最近 120 秒有 MCP 活動的 Agent，並約每 10 秒更新；停止使用後會自動離線。
- **Shared knowledge** 只顯示已完成並保存的 RAG／Full Generation 回答。Semantic Cache 重用、聊天訊息、上傳來源與尚未完成的 handoff 不會混入。
- 需要重新錄 Demo 時，可在 **Shared knowledge → Reset knowledge** 輸入畫面顯示的 Workspace ID，再輸入 `RESET SHARED KNOWLEDGE`。系統會清除共享知識、embedding vectors、Semantic Cache 與上傳來源，但保留共同聊天及效能統計。

目前尚未提供使用者自行建立／加入多個 Workspace；`RELAY_WORKSPACE_ID` 決定這次部署使用的固定 Workspace。上傳到 R2 的檔案目前只保存 bytes 與 metadata，尚未自動解析及建立文件 chunks。

## 2. Demo 前準備

### 必要條件

- Node.js 22.13 或更新版本。
- pnpm。
- 已套用 `drizzle/0000` 至 `drizzle/0007` 的 D1 database。
- D1 binding：`DB`。
- R2 binding：`FILES`。
- Dashboard 顯示的 Workspace ID；不需要 MCP Member token。
- `OPENAI_API_KEY` 僅為選用的 embedding／精確 token count 增強。

### 環境設定

複製 `.env.example` 為 `.env.local`，至少設定：

```env
RELAY_APP_MODE=production
RELAY_WORKSPACE_ID=relay-build-week-demo
RELAY_WORKSPACE_NAME=RoamTogether Development
RELAY_ALLOW_LOCAL_ANONYMOUS=true
RELAY_MCP_JOIN_MODE=workspace_id
```

不要把 `.env.local` 或真實 API key commit 到 Git。`workspace_id` 模式刻意以方便展示為優先，不應視為正式產品的權限邊界。

### 安裝與驗證

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm dev
```

Web Dashboard 使用開發伺服器顯示的 URL。MCP endpoint 是相同 host 下的 `/api/mcp`。

## 3. 使用者如何透過 Codex 連接 Relay MCP（小白版）

這一節是給「只想連上 Demo、不需要理解 MCP 程式碼」的成員。Production 使用的是遠端 Streamable HTTP MCP Server，使用者不需要下載 Relay 原始碼，也不需要在自己的電腦啟動 Relay Server。

### 3.1 先取得四項資料

每位成員應收到：

| 項目 | Production Demo 值 | 用途 |
| --- | --- | --- |
| Dashboard | `https://relay-production-2026.opompm841218.chatgpt.site` | 查看 Workspace、聊天、路由及 Token 統計 |
| MCP Base URL | `https://relay-production-2026.opompm841218.chatgpt.site/api/mcp` | Codex 連接的 MCP endpoint |
| Workspace | `RoamTogether Development` | 人類可讀的 Workspace 名稱 |
| Workspace ID | `relay-production` | 加入 Workspace 所需的唯一值 |

目前 Demo 只有一個固定 Workspace。使用者把 Dashboard 顯示的 ID 放進 MCP URL 即可加入，不需要 Member token。連線後應呼叫 `relay_get_workspace`，確認回傳 ID 相同。

### 3.2 開啟 Dashboard 並抄下 Workspace ID

1. 用瀏覽器開啟 [Relay Production Dashboard](https://relay-production-2026.opompm841218.chatgpt.site)。
2. 若出現 Sign in with ChatGPT，使用獲准存取此私人 Site 的 ChatGPT 帳號登入。
3. 在左側 Workspace 卡片或頂部導覽列確認：

   ```text
   RoamTogether Development
   relay-production
   ```

4. 點擊 Workspace ID 即可複製。

Dashboard 仍可能要求 ChatGPT 登入；MCP Demo 則只檢查 URL 中的 Workspace ID。兩者是不同入口。

### 3.3 方法 A：Codex CLI 連線（最容易測試，建議先用）

#### 最快方式：One-click installer（Demo 建議）

先把整個專案下載或 clone 到 Mac，接著在 Finder 打開專案資料夾並雙擊：

```text
INSTALL_RELAY_DEMO.command
```

也可以在專案根目錄的 Terminal 只執行一行：

```bash
./INSTALL_RELAY_DEMO.command
```

腳本會依序完成：

1. 從 OpenAI 官方 installer 安裝或更新 Codex CLI。
2. 確認 `codex --version` 可以執行。
3. 詢問 Workspace ID 與非敏感的成員顯示名稱。
4. 移除同名舊設定，再以帶有 Workspace ID 的 Production URL 註冊 `relay` MCP。
5. 執行 `codex mcp get relay --json` 驗證設定。
6. 在啟動 Codex 前送出一次 MCP `initialize` handshake，必須收到 HTTP 200；不再讓 HTML 401 混進 Codex startup log。
7. 直接啟動 Codex；第一次使用時依畫面選擇 **Sign in with ChatGPT**。

腳本不再要求或設定 `RELAY_MCP_TOKEN`。Workspace ID 會寫入 MCP URL；它在此 Demo 中等同加入碼，因此不要用這個模式保存敏感或正式資料。

若 macOS 阻止雙擊執行，可在 Terminal 改用：

```bash
bash scripts/install-relay-demo.sh
```

若只想設定、不想立刻啟動 Codex：

```bash
./scripts/install-relay-demo.sh --no-launch
```

以下 Step A1–A5 是 one-click installer 所做事情的手動版本，發生問題時可用來逐步排查。

#### Step A1 — 安裝 Codex CLI（macOS／Linux）

先打開 macOS 的 **Terminal**（可按 `Command + Space`，搜尋 `Terminal`）。貼上 OpenAI 官方安裝指令：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

安裝程式完成後，關閉並重新開啟 Terminal，再確認版本：

```bash
codex --version
```

若能看到 `codex-cli` 與版本號，就代表安裝成功。官方 standalone installer 不要求你先安裝 Node.js 或 npm；同一條指令也可用來更新既有 Codex CLI。[Codex CLI installation](https://learn.chatgpt.com/docs/codex/cli#cli-getting-started-title)

如果仍出現 `command not found`：

1. 完整關閉 Terminal，再開一個新視窗重試。
2. 執行 `echo $PATH`，確認輸出包含 `$HOME/.local/bin`。
3. 若沒有，把下面這行加入目前 shell，然後再確認版本：

   ```bash
   export PATH="$HOME/.local/bin:$PATH"
   codex --version
   ```

#### Step A2 — 第一次登入 Codex

執行：

```bash
codex
```

第一次啟動時，依畫面選擇 **Sign in with ChatGPT**，瀏覽器會開啟登入頁。使用自己的 ChatGPT 帳號完成授權後回到 Terminal。這裡登入的是 Codex Client，不是 Relay；一般成員不需要另外準備 `OPENAI_API_KEY`。

如果已經看到 Codex 的輸入畫面，先輸入 `/exit` 或按 `Ctrl + C` 回到 Terminal，繼續下一步。

日後要更新 Codex CLI，重新執行官方 installer 即可：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex --version
```

#### Step A3 — 使用 Workspace ID 加入 Relay

把 Dashboard 顯示的 Workspace ID 放在 `workspace_id` query parameter。`member` 只是 Dashboard audit log 顯示名稱，不是密碼：

```bash
codex mcp add relay \
  --url "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?workspace_id=relay-production&member=Alice"
```

Bob 將 `member=Alice` 改成 `member=Bob`。Codex 會把 Streamable HTTP server URL 寫入 `~/.codex/config.toml`。[Codex MCP commands](https://learn.chatgpt.com/docs/developer-commands#codex-mcp)

若之前已加入同名 `relay`，先檢查：

```bash
codex mcp get relay --json
```

如果 URL 錯誤，可重建：

```bash
codex mcp remove relay
codex mcp add relay \
  --url "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?workspace_id=relay-production&member=Alice"
```

#### Step A4 — 確認 Codex 已儲存設定

```bash
codex mcp get relay --json
```

確認輸出包含：

```text
workspace_id=relay-production
member=Alice
```

也可列出全部 MCP servers：

```bash
codex mcp list
```

#### Step A5 — 啟動 Codex

```bash
codex
```

### 3.4 方法 B：macOS Codex App 連線

Codex App 和 CLI 共用 `~/.codex/config.toml` 內的 MCP server 定義；Workspace-ID 模式不需要額外環境變數。

#### Step B1 — 加入 MCP 設定

如果尚未執行方法 A 的 `codex mcp add`，執行：

```bash
codex mcp add relay \
  --url "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?workspace_id=relay-production&member=Alice"
```

等價的 `~/.codex/config.toml` 設定是：

```toml
[mcp_servers.relay]
url = "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?workspace_id=relay-production&member=Alice"
```

Codex 對 Streamable HTTP MCP Server 支援 `url` 設定。[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers)

#### Step B2 — 完整重開 Codex App

1. 使用 `Command + Q` 完全退出 Codex App。
2. 重新開啟 Codex App。
3. 建立一個新的 Local Codex chat。

完整重開可確保 App 重新載入 MCP 設定。

### 3.5 在 Codex 中驗證連線

在新的 Codex chat 貼上：

```text
請先不要做任何生成任務。
請使用 Relay MCP 的 relay_get_workspace，
回報 Workspace name、Workspace ID、embedding provider，
以及目前 Semantic Cache、RAG、Full Generation 次數。
```

成功時應看到 Codex 呼叫：

```text
relay_get_workspace
```

回傳至少應包含：

```text
Workspace name: RoamTogether Development
Workspace ID: relay-production
Embedding provider: gemini
```

接著測試 Shared Chat：

```text
請使用 Relay MCP 的 relay_post_update，
在目前 Workspace 發布 discussion：
「Alice 已成功從 Codex 連上 Relay，準備開始前端工作。」
不要改寫內容，也不要呼叫生成模型。
```

回到 Dashboard 的 Shared Chat，應該能看到成員名稱與訊息。Dashboard 的 Connected Agents／MCP activity 也應新增一次 tool call。

### 3.6 同一台 Mac 模擬 Alice 與 Bob

最穩定的雙人 Demo 是兩台電腦：兩人都輸入相同 Workspace ID，但 installer 的 Display name 分別填 `Alice` 與 `Bob`。若只有一台 Mac，可以先以 Alice 示範 Codex App，再重建 MCP URL 將 `member=Alice` 改成 `member=Bob` 後用 CLI 示範。

`member` 只是 Demo audit label，可以被使用者自行修改；它不是可信任的身份驗證。

### 3.7 Demo 結束後清除設定

若不再使用 Relay：

```bash
codex mcp remove relay
```

### 3.8 連線常見問題

#### Codex 看不到 Relay tools

依序確認：

1. `codex mcp get relay --json` 是否存在。
2. URL 是否包含 `/api/mcp?workspace_id=relay-production`。
3. Workspace ID 是否與 Dashboard 完全相同。
4. 是否完整重開 Codex App。
5. 是否開了一個新的 Codex chat。

#### `workspace_access_denied`

代表 MCP URL 沒有 `workspace_id`，或 ID 與目前部署不一致。回到 Dashboard 重新複製 ID並重建 `relay` MCP 設定。

#### MCP startup 顯示 `HTTP 401` 與 `Sign in required` HTML

這不是 Workspace ID 錯誤，而是 Sites 外層存取政策攔住 MCP transport。此版本的 Production Site 已改為 public dispatch，讓 Codex CLI 能直接到達 `/api/mcp`；Dashboard 頁面仍由 `app/layout.tsx` 要求 Sign in with ChatGPT，browser API 也會驗證登入身份。若仍看到舊錯誤，請確認 URL 指向目前 Production host，執行 `codex mcp remove relay` 後重新跑 installer，再建立新的 Codex session。

#### MCP URL 貼進瀏覽器只看到錯誤或空白

這是正常的。`/api/mcp` 是給 MCP Client 傳送 JSON-RPC 的 endpoint，不是一般網頁。人類應開 Dashboard 根網址，Codex 才連 `/api/mcp`。

#### Dashboard 可登入，但 MCP 仍驗證失敗

Dashboard 使用 ChatGPT Site 登入；MCP Demo 使用 URL 中的 Workspace ID。這兩個入口彼此獨立。

#### 是否需要 `OPENAI_API_KEY`

一般成員不需要設定 `OPENAI_API_KEY`。Codex 使用自己的 Host Model；Relay Production 使用 Server 端設定的 Gemini embedding provider 做語意檢索。任何 provider key 都只應放在 Relay Server 的安全環境變數，不應交給 Workspace 成員。

## 4. 建議 Demo 角色

| 成員 | Client | Demo 工作 |
| --- | --- | --- |
| Alice | Codex App | Frontend Developer，建立第一筆全新結果 |
| Bob | Codex CLI | Backend Developer，用團隊知識延伸答案 |

MCP Client 應設定：

```text
URL: https://<relay-host>/api/mcp?workspace_id=relay-production&member=Alice
```

每位成員使用相同 Workspace ID、不同 `member` 顯示名稱，Dashboard 即可區分 Demo 活動。

## 5. 三分鐘 Demo 腳本

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

以下兩句應視為同一個高相似度需求並走 `semantic_cache`（前提是舊紀錄仍在 TTL 內且允許直接重用）：

```text
Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.
Create a 5-day Tokyo itinerary for us. Prioritize walkable neighborhoods, 1 day trip, and a affordable budget.
```

Relay 接受 Hybrid score 達設定門檻、raw embedding similarity 達 80%，或 normalized lexical similarity 達較保守的 88% 的 fresh match。數字寫法與 `moderate`／`affordable` 也會先做 lexical normalization；上述兩句的 normalized lexical score 約為 91%，因此即使 embedding provider 暫時失敗、分數偏保守，或 Agent 誤帶一般的 `generate_with_team_knowledge`，仍會優先走 Semantic Cache。看完後的刻意更新必須使用 `relay_rag_refresh_preflight`。

### 每次 Prompt 的 Route Preview

`relay_preflight` 後，Codex 必須先顯示：

```text
Hybrid similarity: …%
Raw embedding similarity: …%
Normalized lexical similarity: …%
Embedding provider: gemini (gemini-embedding-001, semantic_similarity)
Recommended route: RAG / Full Generation / Semantic Cache
```

若 Gemini 請求失敗，這一行會明確顯示 `lexical_fallback` 與錯誤原因；此時 Raw embedding 的 `0%` 代表「未取得 embedding」，不是 Gemini 判定兩句完全不相似。

若為 RAG 或 Full Generation，Codex 接著詢問使用者要走哪一條路，結束當前 turn 並等待。使用者回答後才呼叫：

```text
relay.relay_confirm_route({
  "previewId": "relay_preflight 回傳的 ID",
  "question": "原始完整問題",
  "selectedRoute": "rag 或 full_generation",
  "confirmedByUser": true
})
```

再用它回傳的新 preflight ID 呼叫 `relay_execute`。若跳過確認直接執行，Server 會回傳 `route_confirmation_required`。Semantic Cache 則維持原流程：顯示 cached answer 後詢問接受或 RAG 更新。

Alice 或 Bob 再次輸入與 Alice 完全相同的問題：

```text
Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.
```

執行：

1. `relay_preflight`，`operation` 使用 `auto`。
2. Exact fingerprint 應命中 Alice 的答案。
3. Route 顯示 `semantic_cache`。
4. Preflight 的 main-model input 與 output ceiling 應為 `0`。
5. 執行 `relay_execute`，`operation` 同樣使用 `auto`，直接取得既有答案。
6. Dashboard 的 Semantic 次數、Duplicates 與 Estimated tokens saved 增加。

建議的 Scene 3 payload：

```json
{
  "question": "Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.",
  "operation": "auto"
}
```

保護規則：即使 Agent 誤把 Scene 2 的 `generate_with_team_knowledge` 沿用到完全相同的 Scene 3 問題，fresh exact fingerprint 現在仍會優先走 `semantic_cache`。只有非 exact 的相關問題才會被該 operation 強制走 RAG。

`relay_execute` 會把完整的既有答案直接顯示在 Codex CLI，並列出兩個選擇：接受快取答案時不需再呼叫任何工具；若看完後想用目前團隊知識更新，呼叫：

```text
relay.relay_rag_refresh_preflight({
  "recordId": "relay_execute 回傳的 record ID",
  "question": "原本的完整問題",
  "confirmedByUser": true
})
```

重要：Codex 顯示完整 cached answer 後，必須先問使用者「接受舊答案」或「使用 RAG 更新」，然後結束當前 turn 等待回答。接受時不呼叫任何工具；只有使用者在下一個 turn 明確選擇更新，才帶 `confirmedByUser: true` 呼叫上述工具。再把新的 `preflightId` 交給 `relay_execute`。Codex 依 RAG handoff 產生新版後，呼叫 `relay_submit_result`，Relay 會保留舊紀錄並建立新版。

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

## 6. MCP JSON-RPC 範例

下列範例適合 smoke test。請替換 host、Workspace ID 與成員顯示名稱。

### Initialize

```bash
curl "https://<relay-host>/api/mcp?workspace_id=relay-production&member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"alice-codex","version":"1.0"}}}'
```

### List tools

```bash
curl "https://<relay-host>/api/mcp?workspace_id=relay-production&member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

### Preflight、handoff 與結果回寫

```bash
curl "https://<relay-host>/api/mcp?workspace_id=relay-production&member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"relay_preflight","arguments":{"question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","operation":"auto"}}}'
```

從 `structuredContent.estimate.id` 複製 preflight ID，再執行：

```bash
curl "https://<relay-host>/api/mcp?workspace_id=relay-production&member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"relay_execute","arguments":{"preflightId":"<preflight-id>","question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","agent":"Alice Codex","operation":"auto","knowledgeType":"semi_dynamic"}}}'
```

Preflight ID 會過期、綁定成員與問題，而且只能使用一次。修改問題文字、換成員或重複送出都會被拒絕。

若 `relay_execute` 回傳 `status=agent_action_required`，Agent 應使用 `handoff.systemInstructions`、`handoff.context` 和 `handoff.question` 自己完成工作，接著呼叫：

```bash
curl "https://<relay-host>/api/mcp?workspace_id=relay-production&member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"relay_submit_result","arguments":{"preflightId":"<preflight-id>","question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","answer":"<agent-final-answer>","agent":"Alice Codex","model":"codex-host-model","knowledgeType":"semi_dynamic"}}}'
```

## 7. Refresh Demo

Refresh 需要一筆包含 `source_url` 的 knowledge record。Production 不會自動建立假 seed，因此若沒有這類紀錄，可在主 Demo 中略過 Refresh。

若已準備 sourced record：

1. 使用 `relay_refresh_preflight({ recordId })`。
2. 取得 preflight ID。
3. 使用 `relay_refresh({ preflightId, recordId })`。
4. Relay 回傳 source URL 與 Full Generation handoff，Host Agent 自行查證並生成。
5. Agent 呼叫 `relay_submit_result`。
6. 舊紀錄保留並設定 `superseded_by`；新紀錄版本加一。

## 8. Demo 成功檢查表

- [ ] Alice 與 Bob 使用相同 Workspace ID、不同 `member` 顯示名稱。
- [ ] Alice 的第一題顯示 Full Generation。
- [ ] Bob 的延伸題顯示 RAG。
- [ ] Alice 或 Bob 的相同題顯示 Semantic Cache。
- [ ] Semantic Cache 的 main-model usage 為零。
- [ ] RAG／Full 回傳 `agent_action_required`，且 Relay generation usage 為零。
- [ ] Host Agent 完成後呼叫 `relay_submit_result`。
- [ ] Shared Chat 收到 Agent 貼回的進度。
- [ ] Dashboard 三種 Route 都有統計。
- [ ] Dashboard 分開顯示 actual cached tokens 與 estimated saved tokens。
- [ ] Shared Memory 可看到新答案。

## 9. 常見問題

### `database_not_ready`

D1 migration 尚未完整套用。確認 `drizzle/0000` 到 `drizzle/0007` 都已執行。

### `workspace_access_denied`

MCP URL 缺少 `workspace_id`，或 ID 與 Dashboard 顯示值不同。

### 沒有 `OPENAI_API_KEY`

一般 Workspace 成員不需要 `OPENAI_API_KEY`。MCP 仍會把 RAG／Full 工作交給 Codex Host Agent；Production 的 embedding provider key 由 Relay Server 管理，不會提供給成員。

### `estimate_expired` 或 `estimate_prompt_changed`

重新執行 `relay_preflight`，並確保 execute 使用完全相同的問題文字。

### RAG 變成 Full Generation

新問題與既有答案的 Hybrid score 低於 RAG threshold。Demo 時使用與 Alice 高度相關的問題，並設定 `operation=generate_with_team_knowledge`。

### Semantic Cache 沒有命中

確認問題完全相同，且原紀錄沒有過期、`requires_refresh`、`superseded_by`，也不是 `transactional`。

## 10. 主要文件

- `README.md`：產品、環境變數與部署概覽。
- `DEVELOPMENT.md`：架構和檔案／function 交接。
- `DEMO_GUIDE.md`：本文件。
- `app/api/mcp/route.ts`：MCP tools/resources 與 JSON-RPC transport。
- `app/api/_lib/relay-service.ts`：Web 與 MCP 共用流程。
- `app/api/_lib/workspace.ts`：D1、TTL、Retrieval、Token estimate 與統計。
- `app/api/_lib/model.ts`：Prompt、token counting 與 GPT-5.6 generation。
