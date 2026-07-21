# Relay MCP MVP — Demo 使用說明書

本文件對應 `team-memory-production` 的目前實作。主 Demo 使用預設的 `RoamTogether` Workspace，也支援 Agent 透過 `relay_create_workspace` 建立其他隔離 Workspace。重點是展示多個 Codex／Agent 經由 Relay MCP 共用團隊記憶，以及 Semantic Cache、RAG、Full Generation 三層路由如何降低重複模型用量。

| 展示版本 | 最適合 | Relay 接入方式 | 建議時間 |
| --- | --- | --- | --- |
| **Codex App 版** | 評審、影片、非技術觀眾 | 安裝 ShareXspace Plugin | 3 分鐘 |
| **Codex CLI 版** | 工程驗證、雙人協作、除錯 | One-click installer 或 `codex mcp add` | 5–10 分鐘 |

兩個版本使用同一個 Production MCP Server、同一個 `RoamTogether` Workspace 與同一套三層路由。請在一次展示中選定一個版本；不需要同時操作兩套安裝流程。

## 最快方式：安裝 Relay Codex Plugin

本專案已把 Relay MCP endpoint、Workspace workflow 與三層路由規則包成 **ShareXspace** Codex plugin。這是 Demo 的首選安裝方式；不需要手動執行 `codex mcp add`、編輯 `~/.codex/config.toml`、準備模型 API key 或 Relay Member token。

1. 先安裝並登入 Codex App，然後用 Codex 開啟本專案資料夾。
2. 完整關閉並重開 Codex App，讓它讀取 `.agents/plugins/marketplace.json`。
3. 打開 **Plugins**，選擇 **ShareXspace**。
4. 找到 **ShareXspace**，按一次 **Install**。
5. 建立新的 Codex task，貼上：

   ```text
   Set up Relay and show available workspaces.
   ```

6. Codex 會透過 plugin 內建的 MCP 連線呼叫 `relay_list_workspaces`，接著列出 Workspace name／ID。選擇 `RoamTogether` 即可開始 Demo，也可以直接要求它建立新 Workspace。

安裝 plugin 後，下方手動 installer 與 `codex mcp add` 章節只作為故障排除或不支援 plugin 的 CLI 環境備用。Plugin 無法替使用者安裝 Codex 本體，因此 Codex App／CLI 與 ChatGPT 登入仍是唯一必要前提。

## 1. Demo 目前能展示什麼

- Web Dashboard 與多個 MCP Client 共用同一個 Workspace。
- Codex、ChatGPT、IDE Agent 或其他 MCP Client 可連接 `/api/mcp`。
- Agent 可呼叫 `relay_create_workspace` 建立新的 Workspace，並在同一條 MCP 連線立即使用。
- 建立結果會回傳對應的 Dashboard URL，例如 `https://relay-production-2026.opompm841218.chatgpt.site/ProductLaunch`。
- `relay_list_workspaces` 可列出所有可用的 Workspace name／ID。
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

Codex 只需連接一次 shared-workspace MCP Server。每個 Workspace tool 都帶 `workspaceId`，Server 以它選定獨立的 D1／R2 partition；memory、embeddings、chat、cache 與 analytics 不會跨 Workspace。Dashboard 目前顯示預設的 `RoamTogether`，新增 Workspace 主要透過 MCP Agent 操作。上傳到 R2 的文件會自動解析、建立 chunks 與 embeddings，並納入後續 RAG retrieval；原始 bytes 與處理 metadata 仍完整保留。

## 2. Demo 前準備

### 必要條件

- Node.js 22.13 或更新版本。
- pnpm。
- 已套用 `drizzle/0000` 至 `drizzle/0008` 的 D1 database。
- D1 binding：`DB`。
- R2 binding：`FILES`。
- 不需要 MCP Member token；Workspace ID 在每次 tool call 中指定。
- `OPENAI_API_KEY` 僅為選用的 embedding／精確 token count 增強。

### 環境設定

複製 `.env.example` 為 `.env.local`，至少設定：

```env
RELAY_APP_MODE=production
RELAY_WORKSPACE_ID=RoamTogether
RELAY_WORKSPACE_NAME=RoamTogether
RELAY_ALLOW_LOCAL_ANONYMOUS=true
RELAY_MCP_JOIN_MODE=open
```

不要把 `.env.local` 或真實 API key commit 到 Git。`open` 模式刻意以方便展示為優先，不應視為正式產品的權限邊界。

### 安裝與驗證

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm dev
```

Web Dashboard 使用開發伺服器顯示的 URL。MCP endpoint 是相同 host 下的 `/api/mcp`。

## 3. Codex App 展示版本（評審 Demo 建議）

這個版本完全在 Codex App 與 Relay Dashboard 之間切換，適合三分鐘影片或讓不熟悉 Terminal 的評審操作。Relay Plugin 已同時包含 MCP connection 與 routing workflow；不需要執行 `codex mcp add`。Codex 官方也建議安裝 Plugin 後建立新 task，讓 bundled skills 與 MCP tools 一起載入。[OpenAI Plugins](https://learn.chatgpt.com/docs/plugins)

### 3.1 App 版畫面分工

| 畫面 | 展示內容 |
| --- | --- |
| Codex App | 安裝 Plugin、輸入任務、顯示 similarity、cached answer 與 Agent handoff |
| Relay Dashboard | Workspace ID、Shared Chat、Shared Knowledge、Connected Agents 與 Token analytics |
| 瀏覽器 | 只用來開啟 `https://relay-production-2026.opompm841218.chatgpt.site/RoamTogether` |

### 3.2 App 版前置設定

1. 安裝 ChatGPT desktop app，登入可以使用 Codex 的 ChatGPT 帳號。
2. 使用 Codex 開啟 `team-memory-production` 專案資料夾。
3. 使用 `Command + Q` 完整退出 App，再重新開啟，讓 App 發現 repo marketplace：

   ```text
   .agents/plugins/marketplace.json
   ```

4. 進入 **Codex → Plugins**，選擇 **ShareXspace**。
5. 打開 **ShareXspace**，按 **Install**。確認看到藍紫色雙手托住 AI Workspace 的 Plugin icon。
6. 建立一個新的 Codex task。Plugin 安裝前已開啟的舊 task 不會自動載入新的 skill／MCP tools。

若 Plugin 已安裝但剛更新過，重新打開 Plugin 詳細頁進行更新，再建立新 task。

### 3.3 App 版連線驗證

在新 task 輸入：

```text
Set up Relay and show available workspaces.
Use workspaceId "RoamTogether" and report its dashboard URL,
embedding provider, Semantic Cache count, RAG count,
Full Generation count, and estimated tokens saved.
```

預期 Codex 自動呼叫：

```text
relay_list_workspaces
relay_get_workspace
```

並至少顯示：

```text
Workspace name: RoamTogether
Workspace ID: RoamTogether
Workspace UI: https://relay-production-2026.opompm841218.chatgpt.site/RoamTogether
Embedding provider: gemini
```

接著測試 Shared Chat：

```text
Use Relay MCP to post this discussion to workspaceId "RoamTogether":
"Alice connected from Codex App and is ready to start frontend work."
Do not generate or rewrite the message.
```

回到 Dashboard，確認 Shared Chat 出現訊息，MCP activity 也增加。

### 3.4 App 版建立 Workspace

在相同 task 輸入：

```text
Use Relay MCP to create a shared Workspace named ProductLaunch
with workspaceId "ProductLaunch".
Return only the Workspace name, ID, and UI URL.
```

Codex 應呼叫 `relay_create_workspace` 並顯示：

```text
https://relay-production-2026.opompm841218.chatgpt.site/ProductLaunch
```

不需要安裝第二個 MCP，也不需要重新啟動 App。後續 Relay tool 只要改用 `workspaceId: "ProductLaunch"`。

### 3.5 App 版三層路由展示

依序執行本文件「三分鐘共用 Demo 腳本」的 Scene 1、2、3：

1. Scene 1：App 顯示三個 similarity 都是 `0%` 後自動進入 Full Generation，不詢問路由。
2. Scene 2：App 顯示非零 similarity，詢問 RAG 或 Full Generation；回答 `RAG` 後才繼續。
3. Scene 3：App 直接顯示完整 cached answer，詢問接受或 RAG 更新；接受時不再呼叫任何工具。

每個 Scene 完成後切到 Dashboard，展示 route counter、Shared Knowledge 與 estimated tokens saved 的變化。

### 3.6 App 版常見問題

- 看不到 Plugin：確認開啟的是含 `.agents/plugins/marketplace.json` 的專案根目錄，完整重開 App。
- Plugin 已安裝但沒有 Relay tools：建立新 task；不要沿用安裝前的 task。
- Dashboard 要求登入：這是正常的 ChatGPT Site 登入；Plugin 內的 MCP endpoint 是另一條公開 Demo transport。
- App 顯示 MCP startup error：打開 Plugin 詳細頁確認已啟用，然後重開 App。若仍失敗，使用下一節 CLI 版的 handshake 檢查。

## 4. Codex CLI 展示版本（工程驗證／雙人 Demo）

這一節是給「只想連上 Demo、不需要理解 MCP 程式碼」的成員。Production 使用的是遠端 Streamable HTTP MCP Server，使用者不需要下載 Relay 原始碼，也不需要在自己的電腦啟動 Relay Server。

### 4.1 先取得四項資料

每位成員應收到：

| 項目 | Production Demo 值 | 用途 |
| --- | --- | --- |
| Dashboard | `https://relay-production-2026.opompm841218.chatgpt.site` | 查看 Workspace、聊天、路由及 Token 統計 |
| MCP Base URL | `https://relay-production-2026.opompm841218.chatgpt.site/api/mcp` | Codex 連接的 MCP endpoint |
| Workspace | `RoamTogether` | 人類可讀的預設 Workspace 名稱 |
| Workspace ID | `RoamTogether` | 呼叫預設 Workspace tools 時使用的唯一值 |

使用者只需把 Relay MCP Base URL 加入 Codex 一次，不需要 Member token，也不把 Workspace ID 寫進 MCP URL。連線後先呼叫 `relay_list_workspaces`；操作資料時把選定的 ID 傳入各 tool 的 `workspaceId`。要建立其他 Workspace 時使用 `relay_create_workspace`。

### 4.2 開啟 Dashboard 並抄下 Workspace ID

1. 用瀏覽器開啟 [Relay Production Dashboard](https://relay-production-2026.opompm841218.chatgpt.site)。
2. 若出現 Sign in with ChatGPT，使用獲准存取此私人 Site 的 ChatGPT 帳號登入。
3. 在左側 Workspace 卡片或頂部導覽列確認：

   ```text
   RoamTogether
   RoamTogether
   ```

4. 點擊 Workspace ID 即可複製。

Dashboard 仍可能要求 ChatGPT 登入；MCP Demo 是單一共用入口，Workspace 由 tool argument 選擇。兩者是不同入口。

### 4.3 CLI One-click installer（現場 Demo 建議）

CLI 有兩種可行方式：在專案根目錄啟動 `codex`，用 `/plugins` 從 **ShareXspace** 安裝 Plugin；或使用下方 installer 直接註冊 MCP。單人展示可用 Plugin，Alice／Bob 需要不同 Dashboard audit label 時，使用 installer 分別輸入 `Alice`、`Bob` 最清楚。

#### 一鍵安裝與啟動

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
3. 詢問非敏感的成員顯示名稱。
4. 移除同名舊設定，再以 shared-workspace Production URL 註冊 `relay` MCP。
5. 執行 `codex mcp get relay --json` 驗證設定。
6. 在啟動 Codex 前送出一次 MCP `initialize` handshake，必須收到 HTTP 200；不再讓 HTML 401 混進 Codex startup log。
7. 直接啟動 Codex；第一次使用時依畫面選擇 **Sign in with ChatGPT**。

腳本不再要求或設定 `RELAY_MCP_TOKEN`。它只註冊一次 shared-workspace MCP；Workspace ID 會在 Agent 呼叫工具時傳入。

若 macOS 阻止雙擊執行，可在 Terminal 改用：

```bash
bash scripts/install-relay-demo.sh
```

若只想設定、不想立刻啟動 Codex：

```bash
./scripts/install-relay-demo.sh --no-launch
```

以下 Step CLI-1–CLI-5 是 one-click installer 所做事情的手動版本，發生問題時可用來逐步排查。

#### Step CLI-1 — 安裝 Codex CLI（macOS／Linux）

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

#### Step CLI-2 — 第一次登入 Codex

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

#### Step CLI-3 — 加入 shared-workspace MCP Server

只需註冊一次 Relay。`member` 只是 Dashboard audit log 顯示名稱，不是密碼：

```bash
codex mcp add relay \
  --url "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?member=Alice"
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
  --url "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?member=Alice"
```

#### Step CLI-4 — 確認 Codex 已儲存設定

```bash
codex mcp get relay --json
```

確認輸出包含：

```text
member=Alice
```

也可列出全部 MCP servers：

```bash
codex mcp list
```

#### Step CLI-5 — 啟動 Codex

```bash
codex
```

### 4.4 CLI 設定也可供 Codex App 共用

Codex App 和 CLI 共用 `~/.codex/config.toml` 內的 MCP server 定義；不需要額外環境變數。

#### CLI 設定內容

如果尚未執行 CLI installer 或手動的 `codex mcp add`，執行：

```bash
codex mcp add relay \
  --url "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?member=Alice"
```

等價的 `~/.codex/config.toml` 設定是：

```toml
[mcp_servers.relay]
url = "https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?member=Alice"
```

Codex 對 Streamable HTTP MCP Server 支援 `url` 設定。[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers)

#### 在 App 載入同一份設定

1. 使用 `Command + Q` 完全退出 Codex App。
2. 重新開啟 Codex App。
3. 建立一個新的 Local Codex chat。

完整重開可確保 App 重新載入 MCP 設定。

### 4.5 在 CLI 中驗證連線

在新的 Codex chat 貼上：

```text
請先不要做任何生成任務。
請先使用 Relay MCP 的 relay_list_workspaces 列出所有 Workspace。
接著以 workspaceId "RoamTogether" 呼叫 relay_get_workspace，
回報 Workspace name、Workspace ID、embedding provider，
以及目前 Semantic Cache、RAG、Full Generation 次數。
```

成功時應看到 Codex 呼叫：

```text
relay_get_workspace
```

回傳至少應包含：

```text
Workspace name: RoamTogether
Workspace ID: RoamTogether
Embedding provider: gemini
```

接著測試 Shared Chat：

```text
請使用 Relay MCP 的 relay_post_update，
以 workspaceId "RoamTogether" 發布 discussion：
「Alice 已成功從 Codex 連上 Relay，準備開始前端工作。」
不要改寫內容，也不要呼叫生成模型。
```

回到 Dashboard 的 Shared Chat，應該能看到成員名稱與訊息。Dashboard 的 Connected Agents／MCP activity 也應新增一次 tool call。

### 4.6 透過 CLI Agent 建立新 Workspace

在已連上 shared-workspace MCP 的 Codex 對話輸入：

```text
請使用 Relay MCP 的 relay_create_workspace 建立一個新的共享 Workspace：
name: ProductLaunch
workspaceId: ProductLaunch
建立後只回報 Workspace name、Workspace ID 與 Workspace UI URL。
```

Codex 會呼叫 `relay_create_workspace`，Relay 回傳：

```text
Workspace created: ProductLaunch
Workspace ID: ProductLaunch
Workspace UI: https://relay-production-2026.opompm841218.chatgpt.site/ProductLaunch
Keep using this shared-workspace MCP connection.
Use workspaceId "ProductLaunch" in the next Relay tool.
```

不需要執行任何 command line，也不需要重開 Codex。直接在同一個對話要求：

```text
請以 workspaceId "ProductLaunch" 呼叫 relay_get_workspace，
再用 relay_post_update 發布「ProductLaunch workspace is ready.」。
```

`relay_get_workspace` 應回傳 `ProductLaunch`。新 Workspace 的 knowledge、embeddings、chat、cache 與 analytics 都是空白且獨立的；切回 `RoamTogether` 只需在下一個 tool call 改回該 `workspaceId`。

使用瀏覽器打開 Relay 回傳的 Workspace UI URL。登入 ChatGPT 後會直接進入該 Workspace Dashboard；Dashboard 的 chat、knowledge、embeddings、route logs、token analytics 與 connected agents 都只讀取 URL 所指定的 Workspace。

### 4.7 Alice 與 Bob 雙人 CLI Demo

最穩定的雙人 Demo 是兩台電腦：兩人都安裝相同 shared-workspace MCP，但 installer 的 Display name 分別填 `Alice` 與 `Bob`。兩人的 Agent 在 tool call 中使用相同 `workspaceId` 即可共同工作。

`member` 只是 Demo audit label，可以被使用者自行修改；它不是可信任的身份驗證。

### 4.8 CLI Demo 結束後清除設定

若不再使用 Relay：

```bash
codex mcp remove relay
```

### 4.9 CLI 連線常見問題

#### Codex 看不到 Relay tools

依序確認：

1. `codex mcp get relay --json` 是否存在。
2. URL 是否包含 `/api/mcp?member=<你的名稱>`。
3. 呼叫 Workspace tool 時是否傳入有效的 `workspaceId`。
4. 是否完整重開 Codex App。
5. 是否開了一個新的 Codex chat。

#### `workspace_id_required`／`workspace_not_found`

代表該 tool call 沒有 `workspaceId`，或 ID 尚未建立。先呼叫 `relay_list_workspaces`，再以正確 ID 重試；不需修改 MCP 設定。

#### MCP startup 顯示 `HTTP 401` 與 `Sign in required` HTML

這不是 Workspace ID 錯誤，而是 Sites 外層存取政策攔住 MCP transport。此版本的 Production Site 已改為 public dispatch，讓 Codex CLI 能直接到達 `/api/mcp`；Dashboard 頁面仍由 `app/layout.tsx` 要求 Sign in with ChatGPT，browser API 也會驗證登入身份。若仍看到舊錯誤，請確認 URL 指向目前 Production host，執行 `codex mcp remove relay` 後重新跑 installer，再建立新的 Codex session。

#### MCP URL 貼進瀏覽器只看到錯誤或空白

這是正常的。`/api/mcp` 是給 MCP Client 傳送 JSON-RPC 的 endpoint，不是一般網頁。人類應開 Dashboard 根網址，Codex 才連 `/api/mcp`。

#### Dashboard 可登入，但 MCP 仍驗證失敗

Dashboard 使用 ChatGPT Site 登入；MCP Demo 使用同一條 shared-workspace connection。這兩個入口彼此獨立。

#### 是否需要 `OPENAI_API_KEY`

一般成員不需要設定 `OPENAI_API_KEY`。Codex 使用自己的 Host Model；Relay Production 使用 Server 端設定的 Gemini embedding provider 做語意檢索。任何 provider key 都只應放在 Relay Server 的安全環境變數，不應交給 Workspace 成員。

## 5. 建議 Demo 角色

### Codex App 版

由一位 Presenter 在同一個 Codex task 依序扮演兩個工作角色：

| Agent 身份 | Demo 工作 |
| --- | --- | --- |
| Alice Frontend Codex | 建立第一筆全新結果，展示 Full Generation |
| Bob Backend Codex | 使用團隊知識延伸答案，展示 RAG 與 Semantic Cache |

Plugin transport 的 MCP member label 固定顯示為 `Codex Plugin`；實際產生結果的 Agent 名稱會由 `relay_execute`／`relay_submit_result` 顯示。這個版本以三層路由故事為主，不強調兩台電腦同時上線。

### Codex CLI 版

| 成員 | Terminal | Demo 工作 |
| --- | --- | --- |
| Alice | `member=Alice` | Frontend Developer，建立第一筆全新結果 |
| Bob | `member=Bob` | Backend Developer，用團隊知識延伸答案 |

兩台 CLI 都連相同 MCP host 與相同 Workspace ID，但使用不同 `member` audit label：

```text
Alice: https://<relay-host>/api/mcp?member=Alice
Bob:   https://<relay-host>/api/mcp?member=Bob
```

Dashboard 會把 Alice 與 Bob 顯示為不同的近期 Connected Agents。

## 6. 三分鐘共用 Demo 腳本

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

若三個分數全部顯示 `0%` 且推薦 Full Generation，Relay 會自動回傳可執行的 Full Generation preflight。Codex 不應詢問路由，應立即呼叫 `relay_execute`、使用自己的模型完成 handoff，再呼叫 `relay_submit_result`。

只有存在非零的相關歷史訊號時，Codex 才詢問使用者要走 RAG 或 Full Generation，結束當前 turn 並等待。使用者回答後才呼叫：

```text
relay.relay_confirm_route({
  "workspaceId": "RoamTogether",
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
  "workspaceId": "RoamTogether",
  "question": "Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.",
  "operation": "auto"
}
```

保護規則：即使 Agent 誤把 Scene 2 的 `generate_with_team_knowledge` 沿用到完全相同的 Scene 3 問題，fresh exact fingerprint 現在仍會優先走 `semantic_cache`。只有非 exact 的相關問題才會被該 operation 強制走 RAG。

`relay_execute` 會把完整的既有答案直接顯示在 Codex App 或 CLI，並列出兩個選擇：接受快取答案時不需再呼叫任何工具；若看完後想用目前團隊知識更新，呼叫：

```text
relay.relay_rag_refresh_preflight({
  "workspaceId": "RoamTogether",
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

## 7. MCP JSON-RPC 範例

下列範例適合 smoke test。請替換 host、Workspace ID 與成員顯示名稱。

### Initialize

```bash
curl "https://<relay-host>/api/mcp?member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"alice-codex","version":"1.0"}}}'
```

### List tools

```bash
curl "https://<relay-host>/api/mcp?member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

### Create Workspace

```bash
curl "https://<relay-host>/api/mcp?member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"relay_create_workspace","arguments":{"name":"ProductLaunch","workspaceId":"ProductLaunch"}}}'
```

保留同一個 MCP client connection；後續工具的 `workspaceId` 改成新 ID 即可使用其獨立 partition。

### Preflight、handoff 與結果回寫

```bash
curl "https://<relay-host>/api/mcp?member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"relay_preflight","arguments":{"workspaceId":"RoamTogether","question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","operation":"auto"}}}'
```

從 `structuredContent.estimate.id` 複製 preflight ID，再執行：

```bash
curl "https://<relay-host>/api/mcp?member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"relay_execute","arguments":{"workspaceId":"RoamTogether","preflightId":"<preflight-id>","question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","agent":"Alice Codex","operation":"auto","knowledgeType":"semi_dynamic"}}}'
```

Preflight ID 會過期、綁定成員與問題，而且只能使用一次。修改問題文字、換成員或重複送出都會被拒絕。

若 `relay_execute` 回傳 `status=agent_action_required`，Agent 應使用 `handoff.systemInstructions`、`handoff.context` 和 `handoff.question` 自己完成工作，接著呼叫：

```bash
curl "https://<relay-host>/api/mcp?member=Alice" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"relay_submit_result","arguments":{"workspaceId":"RoamTogether","preflightId":"<preflight-id>","question":"Create a five-day Tokyo itinerary for our team. Prioritize walkable neighborhoods, one day trip, and a moderate budget.","answer":"<agent-final-answer>","agent":"Alice Codex","model":"codex-host-model","knowledgeType":"semi_dynamic"}}}'
```

## 8. Refresh Demo

Refresh 需要一筆包含 `source_url` 的 knowledge record。Production 不會自動建立假 seed，因此若沒有這類紀錄，可在主 Demo 中略過 Refresh。

若已準備 sourced record：

1. 使用 `relay_refresh_preflight({ recordId })`。
2. 取得 preflight ID。
3. 使用 `relay_refresh({ preflightId, recordId })`。
4. Relay 回傳 source URL 與 Full Generation handoff，Host Agent 自行查證並生成。
5. Agent 呼叫 `relay_submit_result`。
6. 舊紀錄保留並設定 `superseded_by`；新紀錄版本加一。

## 9. Demo 成功檢查表

- [ ] 已明確選擇 Codex App 版或 CLI 版，不混用兩套前置設定。
- [ ] App 版已安裝 Relay Plugin 並建立新 task；或 CLI 版已通過 MCP initialize handshake。
- [ ] 兩個工作角色使用相同 `RoamTogether` Workspace ID。
- [ ] CLI 雙人版的 Alice、Bob 使用不同 `member` 顯示名稱。
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

## 10. 常見問題

### `database_not_ready`

D1 migration 尚未完整套用。確認 `drizzle/0000` 到 `drizzle/0008` 都已執行。

### `workspace_id_required`／`workspace_not_found`

Workspace tool 缺少 `workspaceId`，或該 ID 尚未建立。

### 沒有 `OPENAI_API_KEY`

一般 Workspace 成員不需要 `OPENAI_API_KEY`。MCP 仍會把 RAG／Full 工作交給 Codex Host Agent；Production 的 embedding provider key 由 Relay Server 管理，不會提供給成員。

### `estimate_expired` 或 `estimate_prompt_changed`

重新執行 `relay_preflight`，並確保 execute 使用完全相同的問題文字。

### RAG 變成 Full Generation

新問題與既有答案的 Hybrid score 低於 RAG threshold。Demo 時使用與 Alice 高度相關的問題，並設定 `operation=generate_with_team_knowledge`。

### Semantic Cache 沒有命中

確認問題完全相同，且原紀錄沒有過期、`requires_refresh`、`superseded_by`，也不是 `transactional`。

## 11. 主要文件

- `README.md`：產品、環境變數與部署概覽。
- `DEVELOPMENT.md`：架構和檔案／function 交接。
- `DEMO_GUIDE.md`：本文件。
- `app/api/mcp/route.ts`：MCP tools/resources 與 JSON-RPC transport。
- `app/api/_lib/relay-service.ts`：Web 與 MCP 共用流程。
- `app/api/_lib/workspace.ts`：D1、TTL、Retrieval、Token estimate 與統計。
- `app/api/_lib/model.ts`：Prompt、token counting 與 GPT-5.6 generation。
