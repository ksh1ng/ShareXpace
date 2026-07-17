"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type MemoryItem = {
  id: string;
  kind: "answer" | "source" | "file";
  title: string;
  detail: string;
  author: string;
  agent: string;
  time: string;
  accent: string;
  tokenCount: number;
  model: string | null;
  knowledgeType: KnowledgeType;
  expiresAt: string | null;
  generatedAt: string | null;
  allowDirectReuse: boolean;
  requiresRefresh: boolean;
  supersededBy: string | null;
  sourceUrl: string | null;
  summary: string | null;
  version: number;
  stale: boolean;
};

type KnowledgeType = "static" | "semi_dynamic" | "dynamic" | "transactional" | "internal_decision";
type DefenseRoute = "semantic_cache" | "rag" | "full_generation";
type TokenOperation = "auto" | "generate_with_team_knowledge" | "refresh";
type DefenseStats = {
  routes: { semanticCache: number; rag: number; fullGeneration: number };
  actualCachedTokens: number;
  estimatedTokensSaved: number;
  preflightCount: number;
};

type TokenEstimate = {
  id: string;
  route: DefenseRoute;
  operation: TokenOperation;
  model: string;
  recordId: string | null;
  inputTokens: number;
  maxOutputTokens: number;
  totalTokenCeiling: number;
  estimatedSavedTokens: number;
  retrievalInputTokens: number;
  expiresAt: string;
  source: "semantic_cache" | "openai_input_token_count";
};

type TokenUsage = {
  source: "semantic_cache" | "openai_response";
  modelCalled: boolean;
  estimatedInputTokens: number;
  retrievalInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  inputEstimateDelta: number;
  savedTokens: number;
};

type Match = {
  id: string;
  matchType: "exact" | "similar" | "hybrid";
  score: number;
  lexicalScore: number;
  semanticScore: number;
  retrievalMode: "exact" | "hybrid" | "lexical";
  title: string;
  detail: string;
  author: string;
  agent: string;
  time: string;
  tokenCount: number;
  route: DefenseRoute;
  knowledgeType: KnowledgeType;
  expiresAt: string | null;
  generatedAt: string | null;
  allowDirectReuse: boolean;
  requiresRefresh: boolean;
  supersededBy: string | null;
  sourceUrl: string | null;
  summary: string | null;
  version: number;
  stale: boolean;
  staleReason: "ttl_expired" | "refresh_required" | "superseded" | null;
};

type PromptCache = {
  calls: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  knowledgeVersion: number;
};

type ChatMessage = {
  id: string;
  author: string;
  type: "discussion" | "task" | "agent";
  content: string;
  agent: string | null;
  model: string | null;
  billingMode: "master" | "personal" | "cache" | null;
  status: "queued" | "running" | "done" | "failed" | null;
  sourceMessageId: string | null;
  time: string;
};

const agents = [
  { initials: "YA", name: "Your agent", role: "Workspace collaborator", color: "gold" },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState("Workspace");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [match, setMatch] = useState<Match | null>(null);
  const [reused, setReused] = useState(false);
  const [answer, setAnswer] = useState<MemoryItem | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [duplicates, setDuplicates] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [promptCache, setPromptCache] = useState<PromptCache>({ calls: 0, cachedTokens: 0, cacheWriteTokens: 0, knowledgeVersion: 1 });
  const [defense, setDefense] = useState<DefenseStats>({ routes: { semanticCache: 0, rag: 0, fullGeneration: 0 }, actualCachedTokens: 0, estimatedTokensSaved: 0, preflightCount: 0 });
  const [preflight, setPreflight] = useState<{ estimate: TokenEstimate; route: DefenseRoute; match: Match | null; operation: TokenOperation; question: string } | null>(null);
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null);
  const [lastRoute, setLastRoute] = useState<DefenseRoute | null>(null);
  const [lastCacheRead, setLastCacheRead] = useState<number | null>(null);
  const [lastRetrieval, setLastRetrieval] = useState<{ mode: string; sources: Array<{ id: string; title: string; score: number }> } | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatMode, setChatMode] = useState<"discussion" | "agent">("discussion");
  const [billingMode, setBillingMode] = useState<"master" | "personal">("master");
  const [personalApiKey, setPersonalApiKey] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatEstimate, setChatEstimate] = useState<{ question: string; estimate: TokenEstimate } | null>(null);
  const [pendingChatRun, setPendingChatRun] = useState<{ sourceMessageId: string; instruction: string; estimate: TokenEstimate } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/state")
      .then(async (response) => {
        if (!response.ok) throw new Error("The shared workspace could not be loaded.");
        return response.json();
      })
      .then((data: { records: MemoryItem[]; stats: { tokensSaved: number; duplicates: number }; promptCache: PromptCache; defense: DefenseStats; modelReady: boolean }) => {
        setMemory(data.records);
        setDuplicates(data.stats.duplicates);
        setPromptCache(data.promptCache);
        setDefense(data.defense);
        setModelReady(data.modelReady);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoadingWorkspace(false));
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/chat").then((response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load shared chat.")))
      .then((data: { messages: ChatMessage[] }) => { if (active) setChat(data.messages); }).catch(() => undefined);
    void load();
    const interval = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  const filteredMemory = useMemo(
    () => memory.filter((item) => filter === "all" || item.kind === filter),
    [filter, memory],
  );

  async function requestEstimate(question: string, operation: TokenOperation = "auto", recordId?: string) {
    if (billingMode === "personal" && !personalApiKey.trim()) throw new Error("Add your personal OpenAI API key first.");
    const response = await fetch("/api/questions/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, operation, recordId, billingMode, personalApiKey: billingMode === "personal" ? personalApiKey : undefined }),
    });
    const data = await response.json() as { estimate: TokenEstimate; route: DefenseRoute; match: Omit<Match, "route"> | null; error?: string };
    if (!response.ok) throw new Error(data.error || "Unable to estimate this prompt.");
    return { ...data, match: data.match ? { ...data.match, route: data.route } : null };
  }

  async function checkMemory(operation: TokenOperation = "auto", recordId?: string) {
    if (!query.trim()) return;
    setSearching(true);
    setMatch(null);
    setPreflight(null);
    setReused(false);
    setAnswer(null);
    setLastUsage(null);
    setError("");
    try {
      const data = await requestEstimate(query, operation, recordId);
      const estimatedQuestion = operation === "refresh" ? data.match?.title ?? query : query;
      setMatch(data.match);
      setPreflight({ estimate: data.estimate, route: data.route, match: data.match, operation, question: estimatedQuestion });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to estimate this prompt.");
    } finally {
      setSearching(false);
    }
  }

  async function reuseAnswer() {
    if (!match || !preflight) return;
    setSearching(true);
    setError("");
    try {
      const response = await fetch("/api/reuse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: match.id, question: preflight.question, similarity: match.score, estimateId: preflight.estimate.id }) });
      const data = await response.json() as { savedTokens: number; stats: { tokensSaved: number; duplicates: number }; defense: DefenseStats; usage: TokenUsage; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to reuse this answer.");
      setReused(true);
      setDuplicates(data.stats.duplicates);
      setDefense(data.defense);
      setLastRoute("semantic_cache");
      setLastUsage(data.usage);
      setPreflight(null);
      setToast(`Answer added to your agent's context · ${data.savedTokens.toLocaleString()} tokens saved`);
      window.setTimeout(() => setToast(""), 3200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reuse this answer.");
    } finally {
      setSearching(false);
    }
  }

  async function askModel() {
    if (!preflight) return;
    setSearching(true);
    setMatch(null);
    setError("");
    try {
      if (billingMode === "personal" && !personalApiKey.trim()) throw new Error("Add your personal OpenAI API key first.");
      const response = await fetch("/api/questions/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: preflight.question, agent: "Your Agent", billingMode, personalApiKey: billingMode === "personal" ? personalApiKey : undefined, estimateId: preflight.estimate.id, operation: preflight.operation }) });
      const data = await response.json() as { record: MemoryItem; modelReady: boolean; promptCache: { cachedTokens: number; cacheWriteTokens: number; eligible: boolean }; retrieval: { mode: string; sources: Array<{ id: string; title: string; score: number }> }; route: DefenseRoute; defense: DefenseStats; usage: TokenUsage; error?: string };
      if (!response.ok) throw new Error(data.error || "Your agent could not complete the request.");
      setAnswer(data.record);
      if (billingMode === "master") setModelReady(data.modelReady);
      setLastCacheRead(data.promptCache.cachedTokens);
      setLastRetrieval(data.retrieval);
      setLastRoute(data.route);
      setDefense(data.defense);
      setLastUsage(data.usage);
      setPreflight(null);
      if (data.modelReady) {
        setPromptCache((current) => ({
          ...current,
          calls: current.calls + 1,
          cachedTokens: current.cachedTokens + data.promptCache.cachedTokens,
          cacheWriteTokens: current.cacheWriteTokens + data.promptCache.cacheWriteTokens,
        }));
      }
      setMemory((items) => [data.record, ...items]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your agent could not complete the request.");
    } finally {
      setSearching(false);
    }
  }

  async function refreshAnswer() {
    if (!match || !preflight || preflight.operation !== "refresh") return;
    setSearching(true);
    setError("");
    try {
      if (billingMode === "personal" && !personalApiKey.trim()) throw new Error("Add your personal OpenAI API key first.");
      const response = await fetch("/api/knowledge/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: match.id, estimateId: preflight.estimate.id, agent: "Your Refresh Agent", billingMode, personalApiKey: billingMode === "personal" ? personalApiKey : undefined }) });
      const data = await response.json() as { record: MemoryItem; route: DefenseRoute; defense: DefenseStats; promptCache: { cachedTokens: number; cacheWriteTokens: number }; usage: TokenUsage; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to refresh this source.");
      setMemory((items) => [data.record, ...items.map((item) => item.id === match.id ? { ...item, supersededBy: data.record.id, requiresRefresh: true, allowDirectReuse: false, stale: true } : item)]);
      setAnswer(data.record);
      setLastRoute(data.route);
      setDefense(data.defense);
      setLastCacheRead(data.promptCache.cachedTokens);
      setLastUsage(data.usage);
      setPreflight(null);
      setMatch(null);
      setToast(`Source refreshed · version ${data.record.version} created and the old version preserved`);
      window.setTimeout(() => setToast(""), 3600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to refresh this source.");
    } finally {
      setSearching(false);
    }
  }

  async function prepareChatAgent(sourceMessageId: string, instruction: string) {
    setChatBusy(true);
    setError("");
    try {
      const data = await requestEstimate(instruction);
      setPendingChatRun({ sourceMessageId, instruction, estimate: data.estimate });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to estimate this agent task.");
    } finally {
      setChatBusy(false);
    }
  }

  async function runChatAgent(sourceMessageId: string, instruction: string, estimateId: string) {
    if (billingMode === "personal" && !personalApiKey.trim()) {
      setError("Add your personal OpenAI API key before sending work to the agent.");
      return;
    }
    setChatBusy(true);
    setError("");
    setChat((messages) => messages.map((message): ChatMessage => message.id === sourceMessageId ? { ...message, type: "task", status: "running", agent: "Your Agent", billingMode } : message));
    try {
      const response = await fetch("/api/chat/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceMessageId, instruction, estimateId, agent: "Your Agent", billingMode, personalApiKey: billingMode === "personal" ? personalApiKey : undefined }) });
      const data = await response.json() as { message: ChatMessage; route: DefenseRoute; defense: DefenseStats; usage: TokenUsage; error?: string };
      if (!response.ok) throw new Error(data.error || "The agent could not complete this task.");
      setChat((messages) => [...messages.map((message): ChatMessage => message.id === sourceMessageId ? { ...message, type: "task", status: "done", agent: "Your Agent", billingMode } : message), data.message]);
      setDefense(data.defense);
      setLastRoute(data.route);
      setLastUsage(data.usage);
      setPendingChatRun(null);
      setToast(data.message.billingMode === "cache" ? "Agent reused an exact workspace answer — no model call" : "Agent result posted back to shared chat");
      window.setTimeout(() => setToast(""), 3200);
    } catch (reason) {
      setChat((messages) => messages.map((message) => message.id === sourceMessageId ? { ...message, status: "failed" } : message));
      setError(reason instanceof Error ? reason.message : "The agent could not complete this task.");
    } finally {
      setChatBusy(false);
    }
  }

  async function sendChat() {
    const content = chatDraft.trim();
    if (!content || chatBusy) return;
    if (chatMode === "agent" && billingMode === "personal" && !personalApiKey.trim()) {
      setError("Add your personal OpenAI API key before sending work to the agent.");
      return;
    }
    if (chatMode === "agent" && (!chatEstimate || chatEstimate.question !== content)) {
      setChatBusy(true);
      setError("");
      try {
        const data = await requestEstimate(content);
        setChatEstimate({ question: content, estimate: data.estimate });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to estimate this agent task.");
      } finally {
        setChatBusy(false);
      }
      return;
    }
    setChatBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, callAgent: chatMode === "agent", agent: "Your Agent", billingMode }) });
      const data = await response.json() as { message: ChatMessage; error?: string };
      if (!response.ok) throw new Error(data.error || "The message could not be posted.");
      setChat((messages) => [...messages, data.message]);
      setChatDraft("");
      if (chatMode === "agent" && chatEstimate) await runChatAgent(data.message.id, content, chatEstimate.estimate.id);
      setChatEstimate(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The message could not be posted.");
    } finally {
      setChatBusy(false);
    }
  }

  async function uploadFile(file: File) {
    setSearching(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/files", { method: "POST", body: form });
      const data = await response.json() as { record: MemoryItem; knowledgeVersion: number; error?: string };
      if (!response.ok) throw new Error(data.error || "The file could not be uploaded.");
      setMemory((items) => [data.record, ...items]);
      setPromptCache((current) => ({ ...current, knowledgeVersion: data.knowledgeVersion }));
      setToast(`${file.name} added to shared knowledge`);
      window.setTimeout(() => setToast(""), 2600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file could not be uploaded.");
    } finally {
      setSearching(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Relay home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>relay</span>
        </a>

        <button className="workspace-switcher" type="button">
          <span className="workspace-icon">✦</span>
          <span><b>Relay production</b><small>Shared workspace</small></span>
          <span className="chevrons">⌃<br />⌄</span>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          {["Workspace", "Shared chat", "Shared memory"].map((item) => (
            <button
              key={item}
              className={activeTab === item ? "active" : ""}
              onClick={() => setActiveTab(item)}
              type="button"
            >
              <span>{item === "Workspace" ? "⌂" : item === "Shared chat" ? "◌" : "◫"}</span>
              {item}
              {item === "Shared memory" && <em>{memory.length}</em>}
              {item === "Shared chat" && <em>{chat.length}</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-label">CONNECTED AGENTS</div>
        <div className="agent-list">
          {agents.map((agent) => (
            <button key={agent.name} type="button">
              <span className={`avatar ${agent.color}`}>{agent.initials}</span>
              <span><b>{agent.name}</b><small>{agent.role}</small></span>
              <i className="online" />
            </button>
          ))}
        </div>
        <button className="connect-agent" type="button"><span>＋</span> Connect your agent</button>

        <div className="sidebar-bottom">
          <button type="button"><span>?</span> Help & feedback</button>
          <div className="profile"><span>YO</span><div><b>Signed-in user</b><small>Workspace member</small></div><button type="button">•••</button></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspaces</span><b>/</b><strong>Relay production</strong><span className="live-pill"><i /> Authenticated workspace</span><span className="mode-pill live">PRODUCTION</span></div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Search" type="button">⌕</button>
            <button className="icon-button notification" aria-label="Notifications" type="button">♢<i /></button>
            <button className="share-button" type="button">Invite members</button>
          </div>
        </header>

        <div className="content">
          <section className="hero-row">
            <div>
              <p className="eyebrow">PRODUCTION SHARED AI WORKSPACE</p>
              <h1>Know the token path<br />before you run it.</h1>
              <p className="hero-copy">Every AI task is counted before execution, routed through Semantic Cache, RAG or Full Generation, then reconciled against provider-reported usage.</p>
            </div>
            <div className="impact-card">
              <div className="impact-top"><span>TOKEN DEFENSE</span><span className="trend">{defense.preflightCount} preflights</span></div>
              <strong>{loadingWorkspace ? "—" : defense.estimatedTokensSaved.toLocaleString()}</strong>
              <p>estimated tokens saved from {duplicates} direct answer reuses</p>
              <div className="cache-summary"><span>Actual cached</span><b>{defense.actualCachedTokens.toLocaleString()} input tokens</b><small>provider-reported prompt cache · knowledge v{promptCache.knowledgeVersion}</small></div>
              <div className="route-counts"><span>Semantic <b>{defense.routes.semanticCache}</b></span><span>RAG <b>{defense.routes.rag}</b></span><span>Full <b>{defense.routes.fullGeneration}</b></span></div>
            </div>
          </section>

          <section className="collab-section">
            <div className="section-heading"><div><p className="eyebrow">TEAM THREAD</p><h2>Shared chat & agent tasks</h2><p>Discuss together, then hand any message to an agent without leaving the conversation.</p></div><span className="sync-pill"><i /> Live workspace history</span></div>
            <div className="collab-grid">
              <div className="chat-panel">
                <div className="chat-feed">
                  {chat.map((message) => (
                    <article className={`chat-message ${message.type}`} key={message.id}>
                      <span className={`chat-avatar ${message.type === "agent" ? "agent" : "member"}`}>{message.type === "agent" ? "✦" : message.author.slice(0, 1).toUpperCase()}</span>
                      <div className="chat-bubble">
                        <header><b>{message.author}</b><time>{message.time}</time>{message.type === "task" && <span className={`task-status ${message.status}`}>{message.status === "running" ? "Agent working…" : message.status}</span>}</header>
                        <p>{message.content}</p>
                        {message.type === "agent" && <footer><span>{message.model}</span><span>{message.billingMode === "cache" ? "Reused memory" : message.billingMode === "personal" ? "Personal API key" : "Team Master key"}</span></footer>}
                        {message.type === "discussion" && <button className="handoff-button" type="button" disabled={chatBusy} onClick={() => prepareChatAgent(message.id, message.content)}>✦ Estimate agent task</button>}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="chat-composer">
                  <div className="chat-mode-toggle">
                    <button className={chatMode === "discussion" ? "active" : ""} onClick={() => setChatMode("discussion")} type="button">Message team</button>
                    <button className={chatMode === "agent" ? "active" : ""} onClick={() => setChatMode("agent")} type="button">✦ Message + run agent</button>
                  </div>
                  <textarea value={chatDraft} onChange={(event) => { setChatDraft(event.target.value); setChatEstimate(null); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendChat(); }} rows={2} placeholder={chatMode === "agent" ? "Describe work for your agent; estimate first, then run…" : "Share an update, decision or question with the team…"} />
                  {chatEstimate && <div className="chat-token-preview"><b>{chatEstimate.estimate.route.replaceAll("_", " ")}</b><span>{chatEstimate.estimate.inputTokens.toLocaleString()} input · up to {chatEstimate.estimate.maxOutputTokens.toLocaleString()} output</span></div>}
                  {pendingChatRun && <div className="chat-token-preview handoff"><b>Agent task estimate ready</b><span>{pendingChatRun.estimate.inputTokens.toLocaleString()} input · {pendingChatRun.estimate.route.replaceAll("_", " ")}</span><button type="button" onClick={() => runChatAgent(pendingChatRun.sourceMessageId, pendingChatRun.instruction, pendingChatRun.estimate.id)}>Confirm run</button></div>}
                  <div><span>{chatMode === "agent" ? `Runs with ${billingMode === "personal" ? "your key" : "team key"}` : "No AI call"}</span><button onClick={sendChat} disabled={chatBusy || !chatDraft.trim()} type="button">{chatBusy ? "Working…" : chatMode === "agent" ? chatEstimate?.question === chatDraft.trim() ? "Post & run" : "Estimate tokens" : "Post message"} →</button></div>
                </div>
              </div>
              <aside className="model-source-card">
                <span className="card-kicker">MODEL COST SOURCE</span>
                <h3>Who pays for agent work?</h3>
                <label className={billingMode === "master" ? "selected" : ""}><input type="radio" checked={billingMode === "master"} onChange={() => { setBillingMode("master"); setPreflight(null); setChatEstimate(null); setPendingChatRun(null); }} /><span><b>Team Master key</b><small>{modelReady ? "Connected · shared workspace billing" : "Not configured · generation is blocked"}</small></span></label>
                <label className={billingMode === "personal" ? "selected" : ""}><input type="radio" checked={billingMode === "personal"} onChange={() => { setBillingMode("personal"); setPreflight(null); setChatEstimate(null); setPendingChatRun(null); }} /><span><b>My API key</b><small>Your own OpenAI usage and limits</small></span></label>
                {billingMode === "personal" && <div className="personal-key"><label htmlFor="personal-key">Personal OpenAI API key</label><input id="personal-key" type="password" autoComplete="off" value={personalApiKey} onChange={(event) => { setPersonalApiKey(event.target.value); setPreflight(null); setChatEstimate(null); setPendingChatRun(null); }} placeholder="sk-…" /><p>Held only in this page until refresh. Never saved to shared history.</p></div>}
                <div className="source-note"><i>✓</i><span><b>Results stay shared</b><small>Only billing changes. Agent output always returns to this team thread.</small></span></div>
              </aside>
            </div>
          </section>

          <section className="ask-card">
            <div className="ask-heading">
              <div className="selected-agent"><span className="avatar gold">YA</span><div><small>ASKING AS</small><b>Your Agent⌄</b></div></div>
              <div className="memory-status"><i /> Preflight required before every AI call</div>
            </div>
            <label htmlFor="workspace-question">What should your agent work on?</label>
            <div className="composer">
              <textarea
                id="workspace-question"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPreflight(null); setMatch(null); setAnswer(null); setLastUsage(null); }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") checkMemory();
                }}
                rows={2}
                placeholder="Ask a question or give your agent a task…"
              />
              <div className="composer-bottom"><button type="button" aria-label="Attach file">＋</button><span>Exact OpenAI input count · ⌘ Enter</span><button className="check-button" onClick={() => checkMemory()} disabled={searching || !query.trim()} type="button">{searching ? "Counting tokens…" : "Estimate tokens & route"} <b>→</b></button></div>
            </div>

            {error && <div className="inline-error" role="alert">{error}</div>}

            {preflight && (
              <div className={`token-preflight-card ${preflight.route}`} role="status">
                <header><span>BEFORE SEND · VERIFIED PREFLIGHT</span><b>{preflight.route.replaceAll("_", " ")}</b></header>
                <div className="token-metrics">
                  <span><small>Exact input</small><strong>{preflight.estimate.inputTokens.toLocaleString()}</strong></span>
                  <span><small>Output limit</small><strong>{preflight.estimate.maxOutputTokens.toLocaleString()}</strong></span>
                  <span><small>Maximum total</small><strong>{preflight.estimate.totalTokenCeiling.toLocaleString()}</strong></span>
                  <span><small>Retrieval used</small><strong>{preflight.estimate.retrievalInputTokens.toLocaleString()}</strong></span>
                </div>
                <p>{preflight.route === "semantic_cache" ? `No main LLM call. Expected saving: ${preflight.estimate.estimatedSavedTokens.toLocaleString()} tokens.` : "Input count comes from OpenAI's token-counting endpoint using the same prompt payload that will be generated."}</p>
                {!preflight.match && preflight.route === "full_generation" && <button className="preflight-send" type="button" onClick={askModel}>Send with Full Generation</button>}
              </div>
            )}

            {match && (
              <div className={`match-card ${match.stale ? "stale" : match.route}`} role="status">
                <div className="match-score"><span>{match.score}%</span><small>{match.matchType === "exact" ? "exact cache" : match.retrievalMode === "hybrid" ? "hybrid match" : "text match"}</small></div>
                <div className="match-content">
                  <div className="match-label"><i /> {match.stale ? `Cached answer blocked — ${match.staleReason === "ttl_expired" ? "TTL expired" : match.staleReason === "superseded" ? "a newer version exists" : "refresh required"}` : match.route === "semantic_cache" ? "Semantic Cache · fresh and direct reuse allowed" : "RAG · related valid knowledge will ground a new answer"}</div>
                  <h3>“{match.title}”</h3>
                  <p>{match.detail}</p>
                  {match.retrievalMode === "hybrid" && <div className="retrieval-scores"><span>Semantic {match.semanticScore}%</span><span>Keyword {match.lexicalScore}%</span></div>}
                  <div className="knowledge-meta"><span>{match.knowledgeType.replaceAll("_", " ")}</span><span>v{match.version}</span>{match.expiresAt && <span>expires {new Date(match.expiresAt).toLocaleDateString()}</span>}</div>
                  <div className="match-meta"><span className="avatar coral">{match.author.slice(0, 2).toUpperCase()}</span><span><b>{match.agent}</b><small>{match.time} · {match.tokenCount.toLocaleString()} tokens{match.sourceUrl ? " · source attached" : ""}</small></span></div>
                </div>
                <div className="match-actions">
                  {preflight?.route === "semantic_cache" && !match.stale && <button className="reuse-button" onClick={reuseAnswer} type="button">Use cached answer</button>}
                  {preflight?.route === "semantic_cache" && !match.stale && <button onClick={() => checkMemory("generate_with_team_knowledge")} type="button">Estimate RAG generation</button>}
                  {preflight?.route === "rag" && preflight.operation !== "refresh" && <button className="reuse-button" onClick={askModel} type="button">Generate with team knowledge</button>}
                  {preflight?.route === "full_generation" && preflight.operation !== "refresh" && <button className="reuse-button" onClick={askModel} type="button">Send with Full Generation</button>}
                  {match.sourceUrl && (match.stale || match.requiresRefresh) && preflight?.operation !== "refresh" && <button className="refresh-button" onClick={() => checkMemory("refresh", match.id)} type="button">Estimate source refresh</button>}
                  {preflight?.operation === "refresh" && <button className="refresh-button" onClick={refreshAnswer} type="button">Confirm Refresh from source</button>}
                </div>
              </div>
            )}

            {reused && (
              <div className="answer-result success-result"><span>✓</span><div><small>REUSED FROM SHARED MEMORY</small><h3>Your agent has the answer — no new model call needed.</h3><p>The existing answer was added to your agent’s working context and the reuse event was saved.</p></div></div>
            )}

            {answer && (
              <div className="answer-result"><span>✦</span><div><small>{lastRoute === "rag" ? "RAG ANSWER ADDED TO WORKSPACE" : lastRoute === "full_generation" ? "FULL GENERATION ADDED TO WORKSPACE" : "ANSWER ADDED TO WORKSPACE"}</small><h3>{answer.title}</h3><p>{answer.detail}</p>{lastRetrieval && <div className="rag-readout"><b>{lastRoute === "rag" ? (lastRetrieval.mode === "hybrid" ? "Hybrid RAG" : "Keyword RAG") : "Full workspace context"}</b><span>{lastRetrieval.sources.length ? `Grounded with ${lastRetrieval.sources.length} valid workspace answer${lastRetrieval.sources.length === 1 ? "" : "s"}` : "Stable prefix first · dynamic request last"}</span></div>}{lastCacheRead !== null && answer.model === "gpt-5.6" && <p className="cache-readout">Actual provider-reported prompt cache: {lastCacheRead.toLocaleString()} input tokens on this call.</p>}</div></div>
            )}

            {lastUsage && (
              <div className={`actual-usage-card ${lastUsage.modelCalled ? "generated" : "cached"}`}>
                <header><span>AFTER ROUTE · ACTUAL TOKEN USAGE</span><b>{lastUsage.modelCalled ? "Provider reported" : "No main LLM call"}</b></header>
                <div className="token-metrics">
                  <span><small>Input</small><strong>{lastUsage.inputTokens.toLocaleString()}</strong></span>
                  <span><small>Output</small><strong>{lastUsage.outputTokens.toLocaleString()}</strong></span>
                  <span><small>Total</small><strong>{lastUsage.totalTokens.toLocaleString()}</strong></span>
                  <span><small>Provider cached input</small><strong>{lastUsage.cachedInputTokens.toLocaleString()}</strong></span>
                </div>
                <p>Retrieval embedding input: {lastUsage.retrievalInputTokens.toLocaleString()} · Estimate delta: {lastUsage.inputEstimateDelta >= 0 ? "+" : ""}{lastUsage.inputEstimateDelta.toLocaleString()} · Tokens avoided: {lastUsage.savedTokens.toLocaleString()}</p>
              </div>
            )}
          </section>

          <section className="knowledge-section">
            <div className="section-heading"><div><h2>Shared knowledge</h2><p>Everything your team and their agents have contributed.</p></div><button className="upload-button" onClick={() => fileInput.current?.click()} disabled={searching} type="button">↑ Upload file</button></div>
            <input ref={fileInput} className="visually-hidden" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} />
            <div className="filter-row">
              {[["all", "All"], ["answer", "Answers"], ["source", "Sources"], ["file", "Files"]].map(([value, label]) => (
                <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} type="button">{label}{value === "all" && <span>{memory.length}</span>}</button>
              ))}
              <button className="sort-button" type="button">Newest first⌄</button>
            </div>
            <div className="memory-grid">
              {filteredMemory.map((item) => (
                <article className={`memory-card ${item.stale ? "stale" : ""}`} key={item.id}>
                  <div className="memory-card-top"><span className={`type-icon ${item.accent}`}>{item.kind === "answer" ? "✦" : item.kind === "source" ? "↗" : "▤"}</span><span className={`type-label ${item.kind}`}>{item.kind}</span><span className="knowledge-type">{item.knowledgeType.replaceAll("_", " ")}</span><span className="version-tag">v{item.version}</span>{item.stale && <span className="stale-tag">stale</span>}<button type="button" aria-label="More options">•••</button></div>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                  {item.sourceUrl && <a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">↗ View source</a>}
                  <div className="memory-author"><span className={`mini-avatar ${item.accent}`}>{item.author.slice(0, 1)}</span><span><b>{item.author}</b><small>{item.agent}{item.model === "gpt-5.6" ? " · GPT-5.6" : ""}</small></span><time>{item.supersededBy ? "Superseded" : item.time}</time></div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
