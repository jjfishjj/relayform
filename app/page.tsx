"use client";

import { useMemo, useState } from "react";

type SourceMode = "website" | "openapi";
type Tool = {
  name: string;
  description: string;
  method: string;
  path: string;
  risk: "Read" | "Write";
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
};

const websiteTools: Tool[] = [
  { name: "search_content", description: "Search indexed pages and return ranked excerpts.", method: "GET", path: "/search", risk: "Read" },
  { name: "read_page", description: "Fetch a clean, structured version of a page.", method: "GET", path: "/pages/{slug}", risk: "Read" },
  { name: "list_resources", description: "List discovered articles, docs, PDFs, and downloads.", method: "GET", path: "/resources", risk: "Read" },
];

const apiTools: Tool[] = [
  { name: "list_products", description: "List products with filters and cursor pagination.", method: "GET", path: "/v1/products", risk: "Read" },
  { name: "get_product", description: "Retrieve one product by its identifier.", method: "GET", path: "/v1/products/{id}", risk: "Read" },
  { name: "create_order", description: "Create an order after explicit user confirmation.", method: "POST", path: "/v1/orders", risk: "Write" },
  { name: "get_order", description: "Retrieve order status and fulfillment details.", method: "GET", path: "/v1/orders/{id}", risk: "Read" },
];

const icons = {
  sparkle: "✦",
  grid: "▦",
  plug: "⌁",
  registry: "⌘",
  pulse: "↗",
  shield: "◇",
  docs: "≡",
};

export default function Home() {
  const [mode, setMode] = useState<SourceMode>("website");
  const [source, setSource] = useState("https://example.com");
  const [activeView, setActiveView] = useState<"builder" | "definition">("builder");
  const [selected, setSelected] = useState(0);
  const [running, setRunning] = useState(false);
  const [generated, setGenerated] = useState(true);
  const [copied, setCopied] = useState(false);
  const [detectedTools, setDetectedTools] = useState<Tool[] | null>(null);
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState("");

  const tools = detectedTools || (mode === "website" ? websiteTools : apiTools);
  const selectedTool = tools[Math.min(selected, tools.length - 1)];
  const host = useMemo(() => {
    try { return new URL(source).host || "docs.example.com"; }
    catch { return "docs.example.com"; }
  }, [source]);

  const definition = JSON.stringify({
    name: selectedTool.name,
    description: selectedTool.description,
    input_schema: {
      type: "object",
      properties: (selectedTool.inputSchema?.properties as Record<string, unknown>) || (selectedTool.name === "search_content"
        ? { query: { type: "string", description: "Search phrase" }, limit: { type: "integer", default: 10 } }
        : { id: { type: "string", description: "Resource identifier" } }),
      required: (selectedTool.inputSchema?.required as string[]) || [selectedTool.name === "search_content" ? "query" : "id"],
    },
    transport: { type: mode === "website" ? "crawler" : "http", method: selectedTool.method, url: `https://${host}${selectedTool.path}` },
    security: { confirmation: selectedTool.risk === "Write", scope: selectedTool.risk.toLowerCase() },
  }, null, 2);

  async function analyze() {
    setRunning(true);
    setGenerated(false);
    setError("");
    setTestResult("");
    try {
      const response = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceType: mode, sourceUrl: source }) });
      const payload = await response.json() as { connector?: { id: string; tools: Tool[] }; error?: string };
      if (!response.ok || !payload.connector) throw new Error(payload.error || "Analysis failed.");
      setDetectedTools(payload.connector.tools);
      setConnectorId(payload.connector.id);
      setRunning(false);
      setGenerated(true);
      setSelected(0);
    } catch (analysisError) {
      setRunning(false);
      setGenerated(false);
      setError(analysisError instanceof Error ? analysisError.message : "Analysis failed.");
    }
  }

  function switchMode(next: SourceMode) {
    setMode(next);
    setSelected(0);
    setDetectedTools(null);
    setConnectorId(null);
    setError("");
    setTestResult("");
    setSource(next === "website" ? "https://example.com" : "https://petstore3.swagger.io/api/v3/openapi.json");
  }

  async function copyDefinition() {
    await navigator.clipboard?.writeText(definition);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function testTool() {
    if (!connectorId) return;
    setTestResult("Running read-only test…");
    const properties = (selectedTool.inputSchema?.properties || {}) as Record<string, unknown>;
    const args = Object.fromEntries(Object.keys(properties).map((key) => [key, key === "query" ? "documentation" : "1"]));
    const response = await fetch("/api/tools/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectorId, toolName: selectedTool.name, arguments: args }) });
    const payload = await response.json() as { status?: number; durationMs?: number; error?: string };
    setTestResult(response.ok ? `HTTP ${payload.status} · ${payload.durationMs} ms` : payload.error || "Test failed.");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">{icons.sparkle}</span><span>Relayform</span></div>
        <nav className="nav-list" aria-label="Main navigation">
          <button className="nav-item active"><span>{icons.grid}</span>Workbench</button>
          <button className="nav-item"><span>{icons.plug}</span>Connectors <b>4</b></button>
          <button className="nav-item"><span>{icons.registry}</span>Tool registry <b>{tools.length}</b></button>
          <button className="nav-item"><span>{icons.pulse}</span>Observability</button>
          <button className="nav-item"><span>{icons.shield}</span>Security</button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><span>{icons.docs}</span>Documentation</button>
          <div className="workspace-card">
            <span className="avatar">JK</span>
            <div><strong>GrowthOS Lab</strong><small>Prototype workspace</small></div>
            <span className="chevron">⌄</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">WORKBENCH</span><h1>Connector builder</h1></div>
          <div className="top-actions"><span className="status-dot">●</span><span className="system-status">All systems operational</span><button className="icon-button" aria-label="Notifications">♢</button><button className="primary small">Publish connector</button></div>
        </header>

        <div className="content">
          <section className="hero">
            <div><p className="kicker">CONNECT ANYTHING → ANY AI</p><h2>Turn a source into<br/><em>AI-ready tools.</em></h2></div>
            <p className="hero-copy">Analyze a website or API, review the detected capabilities, then export a secure connector for MCP and other agent runtimes.</p>
          </section>

          <section className="builder-grid">
            <div className="source-panel panel">
              <div className="panel-heading"><span className="step">01</span><div><h3>Choose a source</h3><p>Start with a public website or an API specification.</p></div></div>
              <div className="mode-tabs" role="tablist">
                <button className={mode === "website" ? "selected" : ""} onClick={() => switchMode("website")}>Website</button>
                <button className={mode === "openapi" ? "selected" : ""} onClick={() => switchMode("openapi")}>OpenAPI</button>
              </div>
              <label className="source-label">{mode === "website" ? "WEBSITE URL" : "OPENAPI SPEC URL"}</label>
              <div className="source-input"><span>{mode === "website" ? "◎" : "{}"}</span><input value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source URL"/><button onClick={analyze} disabled={running || !source}>{running ? "Analyzing…" : "Analyze source"}</button></div>
              <div className="trust-row"><span>✓ Robots.txt aware</span><span>✓ Read-only by default</span><span>✓ No browser-side secrets</span></div>
              {error && <p className="analysis-error" role="alert">{error}</p>}
            </div>

            <div className="flow-panel panel">
              <div className="panel-heading compact"><span className="step">02</span><div><h3>Capability pipeline</h3><p>Your source is normalized before export.</p></div></div>
              <div className="pipeline">
                <div className="pipe-step complete"><span>01</span><div><strong>Source</strong><small>{mode === "website" ? "Website crawler" : "OpenAPI parser"}</small></div><b>✓</b></div>
                <div className="pipe-line" />
                <div className={`pipe-step ${generated ? "complete" : "processing"}`}><span>02</span><div><strong>Parse</strong><small>Structure + semantics</small></div><b>{generated ? "✓" : "···"}</b></div>
                <div className="pipe-line" />
                <div className={`pipe-step ${generated ? "complete" : ""}`}><span>03</span><div><strong>Normalize</strong><small>Universal definition</small></div><b>{generated ? "✓" : ""}</b></div>
                <div className="pipe-line" />
                <div className={`pipe-step ${generated ? "ready" : ""}`}><span>04</span><div><strong>Export</strong><small>MCP + JSON Schema</small></div><b>{generated ? "Ready" : ""}</b></div>
              </div>
            </div>
          </section>

          <section className="results panel">
            <div className="results-header">
              <div className="panel-heading compact"><span className="step">03</span><div><h3>Review detected tools</h3><p>{tools.length} capabilities found on <strong>{host}</strong></p></div></div>
              <div className="view-tabs"><button className={activeView === "builder" ? "selected" : ""} onClick={() => setActiveView("builder")}>Tool preview</button><button className={activeView === "definition" ? "selected" : ""} onClick={() => setActiveView("definition")}>Universal JSON</button></div>
            </div>
            {activeView === "builder" ? (
              <div className="tool-layout">
                <div className="tool-list">
                  {tools.map((tool, index) => <button key={tool.name} className={`tool-row ${selected === index ? "selected" : ""}`} onClick={() => setSelected(index)}><span className="tool-icon">{tool.method === "GET" ? "↗" : "+"}</span><span><strong>{tool.name}</strong><small>{tool.description}</small></span><code className={tool.method === "POST" ? "post" : ""}>{tool.method}</code></button>)}
                </div>
                <div className="tool-detail">
                  <div className="detail-title"><div><span className="badge">TOOL</span><h4>{selectedTool.name}</h4></div><span className={`risk ${selectedTool.risk.toLowerCase()}`}>{selectedTool.risk} operation</span></div>
                  <p>{selectedTool.description}</p>
                  <dl><div><dt>Endpoint</dt><dd><code>{selectedTool.method} {selectedTool.path}</code></dd></div><div><dt>Authentication</dt><dd>Workspace credential</dd></div><div><dt>Confirmation</dt><dd>{selectedTool.risk === "Write" ? "Required" : "Not required"}</dd></div></dl>
                  <div className="export-row"><span>Export targets</span><div><b>MCP</b><b>OpenAI</b><b>JSON Schema</b><b>TypeScript</b></div></div>
                  {connectorId && <div className="runtime-actions"><button onClick={testTool} disabled={selectedTool.risk === "Write"}>Test read tool</button><a href={`/api/connectors/${connectorId}/mcp`}>Download MCP server</a></div>}
                  {testResult && <p className="test-result">{testResult}</p>}
                </div>
              </div>
            ) : (
              <div className="json-view"><button onClick={copyDefinition}>{copied ? "Copied ✓" : "Copy JSON"}</button><pre>{definition}</pre></div>
            )}
          </section>

          <footer><span>Relayform prototype · Universal AI Connector</span><span>Designed for secure, portable agent tools</span></footer>
        </div>
      </section>
    </main>
  );
}
