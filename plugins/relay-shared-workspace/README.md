# Relay Shared Workspace Codex Plugin

其他使用者可以直接使用這個 Plugin，不需要部署自己的 Relay，也不需要取得 Relay Owner 的 Cloudflare 或 Gemini credentials。

## 成本與資料由誰負責

| 能力 | 執行位置／負責者 |
| --- | --- |
| D1 shared memory、chat、route logs | Relay Owner 的 hosted D1 |
| R2 原始檔案 | Relay Owner 的 hosted R2 |
| 文件解析、chunks、embeddings | Relay hosted service／Owner 設定的 Gemini key |
| Semantic Cache | Relay hosted service，不呼叫使用者 LLM |
| RAG／Full Generation | 使用者自己的 Codex host model |
| Dashboard | Relay hosted Sites UI |

Relay 在 RAG／Full Generation case 只把 route、shared context 與操作指令交給 Codex。Codex 使用使用者目前登入帳號可用的模型完成推理，再透過 `relay_submit_result` 把結果存回 Workspace。使用者不需要把自己的 LLM API key 提供給 Relay。

## 安裝套件需要的全部檔案

```text
relay-plugin-package/
├── .agents/
│   └── plugins/
│       └── marketplace.json
├── plugins/
│   └── relay-shared-workspace/
│       ├── .codex-plugin/
│       │   └── plugin.json
│       ├── .mcp.json
│       ├── README.md
│       ├── assets/
│       │   └── relay-shared-workspace-icon.png
│       └── skills/
│           └── relay-workspace/
│               └── SKILL.md
├── scripts/
│   └── install-relay-plugin.sh
└── INSTALL_RELAY_PLUGIN.command
```

其中：

- `plugin.json`：Plugin identity、版本、UI metadata 與 bundled components。
- `.mcp.json`：連接 hosted Relay MCP endpoint。
- `SKILL.md`：規定 preflight、Semantic Cache、RAG、Full Generation 與 result submission 流程。
- `marketplace.json`：讓 Codex App／CLI 找到 Plugin。
- `assets/`：Plugin icon。
- installer：驗證 package、測試 MCP handshake、註冊 marketplace 並安裝 Plugin。

不要把 `GEMINI_API_KEY`、Cloudflare D1/R2 credentials、`OPENAI_API_KEY` 或其他 server secrets 放進 Plugin。它只應包含公開 MCP URL 與工作流程。

## 方法一：Codex App 安裝（最適合一般使用者）

### 前置條件

1. 安裝 ChatGPT desktop app。
2. 登入可使用 Codex 的 ChatGPT 帳號。
3. 取得並解壓縮 Relay plugin package，或取得包含本目錄與 `.agents/plugins/marketplace.json` 的 repository。

### 安裝步驟

1. 在 Codex App 開啟解壓縮後的 package/repository 根目錄。
2. 完整退出並重新啟動 ChatGPT desktop app，讓 Codex 讀取 repo marketplace。
3. 開啟 **Codex → Plugins → Relay Build Week**。
4. 選擇 **Relay Shared Workspace**，按 **Install**。
5. 建立新的 Codex task。安裝前已開啟的 task 不會載入新的 skill 與 MCP tools。
6. 輸入：

   ```text
   Set up Relay and show available workspaces.
   ```

7. 選擇 `RoamTogether`，或請 Codex 呼叫 `relay_create_workspace` 建立新 Workspace。

Dashboard：<https://relay-production-2026.opompm841218.chatgpt.site>

## 方法二：一鍵安裝（macOS／Linux）

在解壓縮後的 package 根目錄執行：

```bash
./INSTALL_RELAY_PLUGIN.command
```

若 macOS 阻止雙擊，改用：

```bash
bash scripts/install-relay-plugin.sh
```

installer 會：

1. 檢查 Plugin 必要檔案。
2. 驗證 JSON manifest 與 marketplace。
3. 對 hosted MCP server 執行 `initialize` handshake。
4. 以 `codex plugin marketplace add` 註冊 package 根目錄。
5. 安裝 `relay-shared-workspace@relay-build-week`。

只檢查、不安裝：

```bash
bash scripts/install-relay-plugin.sh --check-only
```

## 方法三：CLI 手動安裝

在 package/repository 根目錄執行：

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add relay-shared-workspace@relay-build-week
codex plugin list
```

接著重新啟動 Codex CLI，建立新 session：

```bash
codex
```

第一個 prompt：

```text
Set up Relay and show available workspaces.
Use workspaceId "RoamTogether" and report its Dashboard URL,
embedding provider, route counts, and estimated tokens saved.
```

## Owner 分享 Plugin 的方式

### 分享 package/repository

Owner 可在完整 repository 執行：

```bash
./scripts/package-relay-plugin.sh
```

把產生的 `.tar.gz` 傳給使用者。解壓縮後可直接執行 `INSTALL_RELAY_PLUGIN.command`，不需要整個 Dashboard source code。

### 透過 ChatGPT Workspace 分享

Owner 在 ChatGPT desktop app 開啟 Plugin 詳細頁，選擇 **Share**，加入 workspace members/groups 或複製 share link。接收者會在 **Plugins → Shared with you** 看到它。這不等於公開發布到 Plugins Directory，而且 workspace 管理員可以關閉 plugin sharing。

## 安裝後驗證

在新的 task 要求：

```text
Use Relay MCP to list workspaces, then inspect RoamTogether.
Do not invent any Workspace data.
```

預期 Codex 呼叫：

```text
relay_list_workspaces
relay_get_workspace
```

並顯示：

- Workspace name／ID
- Dashboard URL
- embedding provider
- Semantic Cache／RAG／Full Generation counts
- estimated tokens saved

接著可測試 shared chat：

```text
Use relay_post_update in workspaceId "RoamTogether" to post:
"Plugin installation verified from a second Codex user."
Do not rewrite the message.
```

## 更新與移除

更新 marketplace 來源後：

```bash
codex plugin marketplace upgrade relay-build-week
codex plugin add relay-shared-workspace@relay-build-week
```

更新或首次安裝後都要建立新的 Codex task/session。

移除：

```bash
codex plugin remove relay-shared-workspace@relay-build-week
codex plugin marketplace remove relay-build-week
```

如果 CLI 的實際 remove 語法因版本不同，先執行 `codex plugin --help`。

## 資料與安全限制

- 使用者輸入的問題、Agent 回答、聊天訊息及上傳文件會傳送到 Relay hosted service，並可能保存於 Owner 的 D1/R2。
- 目前 Hackathon join mode 以 Workspace ID 為加入條件，不是 production-grade secret 或 authorization boundary。
- 不要用此 Demo Workspace 上傳密碼、API keys、私人訂單、公司機密或個人敏感資料。
- Owner 應只分享給受信任測試者，並監控 embedding request、R2 storage、錯誤與濫用情況。
- 使用者的 Codex 模型 credential 不會傳送給 Relay；但 Codex 產生並提交的最終回答會成為 shared knowledge。

## 常見問題

### 安裝後看不到 Relay tools

完整重啟 App/CLI，並建立新 task。Plugin components 只會在安裝後的新 task/session 載入。

### MCP startup 出現 401 HTML

確認 `.mcp.json` 使用：

```text
https://relay-production-2026.opompm841218.chatgpt.site/api/mcp?member=Codex%20Plugin
```

不要把 Dashboard 的 `/signin-with-chatgpt` URL 當成 MCP endpoint。

### 使用者需要 API key 嗎？

不需要。Semantic Cache、D1、R2 和 embeddings 使用 Owner 的 hosted service；RAG／Full Generation 使用使用者已登入的 Codex host model。

### Dashboard 打不開

用瀏覽器開啟 <https://relay-production-2026.opompm841218.chatgpt.site> 並完成 ChatGPT sign-in。選定 Workspace 後也可直接開啟 `https://relay-production-2026.opompm841218.chatgpt.site/<workspaceId>`。

## 官方 Codex Plugin 參考

- [Use and install plugins](https://learn.chatgpt.com/docs/plugins)
- [Build and distribute plugins](https://learn.chatgpt.com/docs/build-plugins)
