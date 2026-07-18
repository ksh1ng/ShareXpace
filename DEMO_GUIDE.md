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
RELAY_WORKSPACE_NAME=RoamTogether Development
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

## 3. 使用者如何透過 Codex 連接 Relay MCP（小白版）

這一節是給「只想連上 Demo、不需要理解 MCP 程式碼」的成員。Production 使用的是遠端 Streamable HTTP MCP Server，使用者不需要下載 Relay 原始碼，也不需要在自己的電腦啟動 Relay Server。

### 3.1 先向 Workspace 管理員取得五項資料

每位成員應收到：

| 項目 | Production Demo 值 | 用途 |
| --- | --- | --- |
| Dashboard | `https://relay-production-2026.opompm841218.chatgpt.site` | 查看 Workspace、聊天、路由及 Token 統計 |
| MCP URL | `https://relay-production-2026.opompm841218.chatgpt.site/api/mcp` | Codex 實際連接的 MCP endpoint |
| Workspace | `RoamTogether Development` | 人類可讀的 Workspace 名稱 |
| Workspace ID | `relay-production` | 確認 Codex 與 Dashboard 使用同一個 Workspace |
| Member token | 每人不同，由管理員私下提供 | Relay 用來辨識 Alice、Bob 等成員 |

Member token 不是 OpenAI API key，也不是 ChatGPT 密碼。不要把它貼進 Codex 對話、GitHub、README、截圖或 Demo 影片。

目前 Demo 只有一個固定 Workspace。MCP Server 會自動把所有通過驗證的 tool call 放進 `relay-production`；使用者連線後應呼叫 `relay_get_workspace`，確認回傳的 ID 與 Dashboard 相同。現階段不是由使用者在每個 tool 參數中切換 Workspace。

### 3.2 開啟 Dashboard 並抄下 Workspace ID

1. 用瀏覽器開啟 [Relay Production Dashboard](https://relay-production-2026.opompm841218.chatgpt.site)。
2. 若出現 Sign in with ChatGPT，使用獲准存取此私人 Site 的 ChatGPT 帳號登入。
3. 在左側 Workspace 卡片或頂部導覽列確認：

   ```text
   RoamTogether Development
   relay-production
   ```

4. 點擊 Workspace ID 即可複製。

Dashboard 登入和 MCP token 是兩層不同驗證：能打開 Dashboard，不代表 Codex 已連上 MCP；Codex 仍需要自己的 Member token。

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
3. 安全詢問 Relay Member token；輸入時畫面不會顯示 token。
4. 在 macOS 目前登入 session 設定 `RELAY_MCP_TOKEN`，供 Codex App 使用。
5. 移除同名舊設定，再以正確 Production URL 註冊 `relay` MCP。
6. 執行 `codex mcp get relay --json` 驗證設定。
7. 直接啟動 Codex；第一次使用時依畫面選擇 **Sign in with ChatGPT**。

腳本不會把 Member token 寫進 Git、MCP URL 或 `~/.codex/config.toml`。它只會在目前 process 與 macOS 登入 session 中提供環境變數。Demo 結束後請依 3.7 節清除。

若 macOS 阻止雙擊執行，可在 Terminal 改用：

```bash
bash scripts/install-relay-demo.sh
```

若只想設定、不想立刻啟動 Codex：

```bash
./scripts/install-relay-demo.sh --no-launch
```

以下 Step A1–A6 是 one-click installer 所做事情的手動版本，發生問題時可用來逐步排查。

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

#### Step A3 — 把 Member token 放進目前 Terminal

為避免 token 顯示在畫面上，輸入：

```bash
read -s RELAY_MCP_TOKEN
export RELAY_MCP_TOKEN
```

游標會停住且不顯示輸入內容。貼上管理員提供的 Member token，按 Enter。

確認變數存在，但不要印出真正 token：

```bash
if [ -n "$RELAY_MCP_TOKEN" ]; then echo "Relay token is configured"; else echo "Relay token is missing"; fi
```

預期：

```text
Relay token is configured
```

關閉這個 Terminal 後，這個臨時環境變數通常就不再存在。

#### Step A4 — 將 Relay MCP Server 加入 Codex

在同一個 Terminal 執行：

```bash
codex mcp add relay \
  --url https://relay-production-2026.opompm841218.chatgpt.site/api/mcp \
  --bearer-token-env-var RELAY_MCP_TOKEN
```

這個命令只記錄環境變數名稱 `RELAY_MCP_TOKEN`，不會把 token 本身寫進 MCP URL。Codex 官方文件說明 `codex mcp add` 會管理 `~/.codex/config.toml` 內的 MCP server，`--url` 註冊 Streamable HTTP server，而 `--bearer-token-env-var` 指定 Bearer token 的環境變數。[Codex MCP commands](https://learn.chatgpt.com/docs/developer-commands#codex-mcp)

若之前已加入同名 `relay`，先檢查：

```bash
codex mcp get relay --json
```

如果 URL 錯誤，可重建：

```bash
codex mcp remove relay
codex mcp add relay \
  --url https://relay-production-2026.opompm841218.chatgpt.site/api/mcp \
  --bearer-token-env-var RELAY_MCP_TOKEN
```

#### Step A5 — 確認 Codex 已儲存設定

```bash
codex mcp get relay --json
```

確認輸出包含：

```text
https://relay-production-2026.opompm841218.chatgpt.site/api/mcp
RELAY_MCP_TOKEN
```

也可列出全部 MCP servers：

```bash
codex mcp list
```

不要期待在設定輸出中看到真正 token；看到環境變數名稱才是正確且較安全的結果。

#### Step A6 — 從同一個 Terminal 啟動 Codex

```bash
codex
```

一定要從剛才設定 `RELAY_MCP_TOKEN` 的同一個 Terminal 啟動，否則新 Codex process 可能讀不到 token。

### 3.4 方法 B：macOS Codex App 連線

Codex App 和 CLI 共用 `~/.codex/config.toml` 內的 MCP server 定義，但圖形 App 必須在啟動時讀得到 `RELAY_MCP_TOKEN`。

#### Step B1 — 設定 macOS App 可讀的環境變數

在 Terminal 執行。第一行會安靜地讀取 token，不把 token 本身留在 shell history：

```bash
read -s RELAY_MCP_TOKEN
export RELAY_MCP_TOKEN
launchctl setenv RELAY_MCP_TOKEN "$RELAY_MCP_TOKEN"
```

執行第一行後貼上管理員提供的 Member token，再按 Enter。這個做法適合短期 Hackathon Demo；不要把真的 token 寫進教學文件或錄影畫面。

#### Step B2 — 加入 MCP 設定

如果尚未執行方法 A 的 `codex mcp add`，執行：

```bash
codex mcp add relay \
  --url https://relay-production-2026.opompm841218.chatgpt.site/api/mcp \
  --bearer-token-env-var RELAY_MCP_TOKEN
```

等價的 `~/.codex/config.toml` 設定是：

```toml
[mcp_servers.relay]
url = "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp"
bearer_token_env_var = "RELAY_MCP_TOKEN"
```

Codex 對 Streamable HTTP MCP Server 支援 `url` 與 `bearer_token_env_var`，後者會把環境變數值放進 Authorization header。[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers)

#### Step B3 — 完整重開 Codex App

1. 使用 `Command + Q` 完全退出 Codex App。
2. 重新開啟 Codex App。
3. 建立一個新的 Local Codex chat。

只關閉視窗不一定會重新載入環境變數，所以要完整退出 App。

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

同一個 Codex App process 只能讀到一份 `RELAY_MCP_TOKEN`。最穩定的雙人 Demo 是使用兩台電腦；若只有一台 Mac，可使用：

- Alice：Codex App，透過 `launchctl` 使用 Alice token。
- Bob：另一個 Terminal 啟動 Codex CLI，在該 Terminal 中 export Bob token。

Bob 的 Terminal：

```bash
read -s RELAY_MCP_TOKEN
export RELAY_MCP_TOKEN
codex
```

貼上 Bob token 後啟動。CLI process 會使用 Terminal 裡的 Bob token，不需要改掉 Alice App 目前使用的 token。

驗證方式：Alice 與 Bob 各呼叫一次 `relay_get_workspace` 或 `relay_post_update`，Dashboard 應顯示兩個不同 actor。

### 3.7 Demo 結束後清除設定

若不再使用 Relay：

```bash
codex mcp remove relay
launchctl unsetenv RELAY_MCP_TOKEN
unset RELAY_MCP_TOKEN
```

管理員也應從 Production 的 `RELAY_MCP_ACCESS_TOKENS` 移除或更換已公開、誤傳或不再使用的 token。

### 3.8 連線常見問題

#### Codex 看不到 Relay tools

依序確認：

1. `codex mcp get relay --json` 是否存在。
2. URL 是否以 `/api/mcp` 結尾。
3. `bearer_token_env_var` 是否為 `RELAY_MCP_TOKEN`。
4. 設定 token 後是否完整重開 Codex App或從同一 Terminal 啟動 CLI。
5. 是否開了一個新的 Codex chat。

#### `mcp_authentication_required`

代表 Relay 沒收到有效 Member token：

- token 可能貼錯或多了空白。
- 管理員可能尚未把 token 加入 `RELAY_MCP_ACCESS_TOKENS`。
- Codex App 啟動時可能讀不到環境變數。
- Alice 與 Bob 不應共用同一個 token，否則 Dashboard 無法區分身份。

#### MCP URL 貼進瀏覽器只看到錯誤或空白

這是正常的。`/api/mcp` 是給 MCP Client 傳送 JSON-RPC 的 endpoint，不是一般網頁。人類應開 Dashboard 根網址，Codex 才連 `/api/mcp`。

#### Dashboard 可登入，但 MCP 仍驗證失敗

Dashboard 使用 ChatGPT Site 登入；MCP 使用 Relay Member token。這兩種驗證互相獨立，必須分別成功。

#### 是否需要 `OPENAI_API_KEY`

一般成員不需要設定 `OPENAI_API_KEY`。Codex 使用自己的 Host Model；Relay Production 使用 Server 端設定的 Gemini embedding provider 做語意檢索。任何 provider key 都只應放在 Relay Server 的安全環境變數，不應交給 Workspace 成員。

## 4. 建議 Demo 角色

| 成員 | Client | Demo 工作 |
| --- | --- | --- |
| Alice | Codex App | Frontend Developer，建立第一筆全新結果 |
| Bob | Codex CLI | Backend Developer，用團隊知識延伸答案 |

MCP Client 應設定：

```text
URL: https://<relay-host>/api/mcp
Authorization: Bearer <member-token>
```

每位成員使用不同 token，Dashboard 才能分辨成員與 Client 活動。

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

Alice 或 Bob 再次輸入與 Alice 完全相同的問題：

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

## 6. MCP JSON-RPC 範例

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

- [ ] Alice 與 Bob 使用不同 bearer tokens。
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

### `mcp_authentication_required`

Bearer token 不在 `RELAY_MCP_ACCESS_TOKENS` 中，或 Authorization header 格式錯誤。

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
