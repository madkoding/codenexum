import type { Database } from "bun:sqlite"
import { dbChunkCount, dbFileCount, dbGetMeta, dbStatsByLang, dbTopFiles, dbFindLoadedFiles, dbEdgeCount } from "./store"
import { getUsage, estimateSavings, getFillRatio, type SearchRecord } from "./budget"
import { getCompactionCount } from "./compact"
import { getRecentIndexEvents } from "./indexer"

export const DEFAULT_DASHBOARD_PORT = parseInt(process.env.CONTEXT_MANAGER_DASHBOARD_PORT || "3567", 10)

export interface DashboardState {
  port: number
  url: string
  ready: boolean
  error?: string
}

let server: ReturnType<typeof Bun.serve> | null = null
let state: DashboardState = { port: 0, url: "", ready: false }

export function getDashboardState(): DashboardState {
  return { ...state }
}

export function stopDashboard(): void {
  try {
    server?.stop(true)
  } catch {}
  server = null
  state = { port: 0, url: "", ready: false }
}

export function startDashboard(db: Database, sessionID?: string): DashboardState {
  if (server) return state
  try {
    // Try default port first; if occupied, let Bun pick an ephemeral port.
    let usedPort = DEFAULT_DASHBOARD_PORT
    try {
      server = Bun.serve({
        port: DEFAULT_DASHBOARD_PORT,
        hostname: "127.0.0.1",
        fetch(req) { return handleRequest(req, db, sessionID) },
      })
    } catch (e) {
      if (String(e).includes("EADDRINUSE")) {
        server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(req) { return handleRequest(req, db, sessionID) },
        })
        usedPort = server.port ?? usedPort
      } else {
        throw e
      }
    }
    const port = server.port ?? usedPort
    if (!port) throw new Error("Bun.serve did not return a port")
    const url = `http://127.0.0.1:${port}`
    state = { port, url, ready: true }
    return state
  } catch (e) {
    state = { port: DEFAULT_DASHBOARD_PORT, url: "", ready: false, error: String(e) }
    return state
  }
}

function handleRequest(req: Request, db: Database, sessionID?: string): Response {
  const url = new URL(req.url)
  if (!isLocalhost(url.hostname)) {
    return new Response("Forbidden: localhost only", { status: 403 })
  }
  if (url.pathname === "/") return new Response(dashboardHtml(db, sessionID), { headers: { "Content-Type": "text/html" } })
  if (url.pathname === "/api/stats") return json(stats(db, sessionID))
  if (url.pathname === "/api/recent-searches") return json(recentSearches(sessionID))
  if (url.pathname === "/api/health") return json({ ok: true })
  return new Response("Not found", { status: 404 })
}

function isLocalhost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]"
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  })
}

function stats(db: Database, sessionID?: string) {
  const usage = getUsage(sessionID)
  return {
    status: dbChunkCount(db) > 0 ? "ready" : "empty",
    chunks: dbChunkCount(db),
    files: dbFileCount(db),
    edges: dbEdgeCount(db),
    languages: dbStatsByLang(db),
    projectRoot: dbGetMeta(db, "projectRoot") || "",
    indexedAt: dbGetMeta(db, "indexedAt") || null,
    fillRatio: getFillRatio(sessionID),
    contextLimit: parseInt(process.env.CONTEXT_MANAGER_CONTEXT_LIMIT || "200000", 10),
    searches: usage.searchQueries || 0,
    snippetOnly: usage.snippetsUsed || 0,
    filesRead: usage.filesRead || 0,
    compactions: getCompactionCount() + (usage.compactions || 0),
    estimatedSavings: estimateSavings(usage),
    hotFiles: dbFindLoadedFiles(db, 10),
    topFiles: dbTopFiles(db, 10),
    recentEvents: getRecentIndexEvents(),
  }
}

function recentSearches(sessionID?: string): SearchRecord[] {
  return getUsage(sessionID).recentSearches || []
}

function dashboardHtml(db: Database, sessionID?: string): string {
  const initial = JSON.stringify(stats(db, sessionID))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Context Manager Dashboard</title>
  <style>
    :root { --bg:#0b0d10; --panel:#12151b; --text:#e6e9ef; --muted:#8b92a8; --accent:#3b82f6; --good:#22c55e; --warn:#f59e0b; --bad:#ef4444; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height:1.5; }
    header { padding: 2rem 1.5rem 1rem; max-width: 1200px; margin: 0 auto; }
    h1 { margin:0; font-size: 1.6rem; }
    .subtitle { color: var(--muted); margin-top:.25rem; }
    main { max-width:1200px; margin:0 auto; padding:1rem 1.5rem 3rem; display:grid; grid-template-columns: repeat(auto-fit, minmax(280px,1fr)); gap:1rem; }
    .card { background: var(--panel); border:1px solid #1f2937; border-radius:.75rem; padding:1.25rem; }
    .card h2 { margin:0 0 .75rem; font-size:1rem; color: var(--muted); text-transform:uppercase; letter-spacing:.04em; }
    .hero { grid-column: 1 / -1; display:flex; gap:1.5rem; flex-wrap:wrap; align-items:center; }
    .metric { flex:1; min-width:160px; }
    .metric-value { font-size:2.25rem; font-weight:700; color: var(--accent); }
    .metric-label { color: var(--muted); font-size:.9rem; }
    .row { display:flex; justify-content:space-between; padding:.35rem 0; border-bottom:1px solid #1f2937; }
    .row:last-child { border-bottom:none; }
    .pill { display:inline-block; padding:.15rem .5rem; border-radius:999px; font-size:.75rem; font-weight:600; background:#1f2937; }
    .pill.good { background: rgba(34,197,94,.15); color: var(--good); }
    .pill.warn { background: rgba(245,158,11,.15); color: var(--warn); }
    .pill.bad { background: rgba(239,68,68,.15); color: var(--bad); }
    .bar { height:.5rem; background:#1f2937; border-radius:999px; overflow:hidden; margin-top:.5rem; }
    .bar > div { height:100%; border-radius:999px; background: var(--accent); }
    .empty { color: var(--muted); font-size:.9rem; }
    pre { margin:0; font-size:.78rem; color: var(--muted); white-space:pre-wrap; }
    a { color: var(--accent); text-decoration:none; }
    a:hover { text-decoration:underline; }
    .grid-2 { grid-column: span 1; }
    @media (min-width: 800px) { .grid-2 { grid-column: span 2; } }
  </style>
</head>
<body>
  <header>
    <h1>Context Manager Dashboard</h1>
    <div class="subtitle">Live metrics from the opencode Context Manager plugin</div>
  </header>
  <main id="app">
    <p class="empty">Loading…</p>
  </main>
  <script>
    const app = document.getElementById('app')
    const initial = ${initial.replace(/</g, '\\u003c')}

    function fmt(n) { return n?.toLocaleString?.() ?? n }
    function relTime(ts) {
      if (!ts) return '-';
      const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
      if (s < 60) return s + 's ago';
      if (s < 3600) return Math.floor(s/60) + 'm ago';
      return Math.floor(s/3600) + 'h ago';
    }
    function fillStatus(pct) {
      if (pct < 0.5) return 'good';
      if (pct < 0.8) return 'warn';
      return 'bad';
    }

    function render(data) {
      const fillPct = Math.min(100, Math.round(data.fillRatio * 100));
      const fillClass = fillStatus(data.fillRatio);
      const statusClass = data.status === 'ready' ? 'good' : data.status === 'indexing' ? 'warn' : 'bad';
      const hero = \`
        <div class="card hero">
          <div class="metric">
            <div class="metric-value">\${fmt(data.estimatedSavings)}</div>
            <div class="metric-label">Tokens saved (estimated)</div>
          </div>
          <div class="metric">
            <div class="metric-value">\${fmt(data.searches)}</div>
            <div class="metric-label">Searches this session</div>
          </div>
          <div class="metric">
            <div class="metric-value">\${fmt(data.snippetOnly)}</div>
            <div class="metric-label">Snippet-only answers</div>
          </div>
          <div class="metric">
            <div class="metric-value">\${fmt(data.filesRead)}</div>
            <div class="metric-label">Files read via search</div>
          </div>
          <div class="metric">
            <div class="metric-value">\${fmt(data.compactions)}</div>
            <div class="metric-label">Compactions</div>
          </div>
        </div>
      \`;

      const index = \`
        <div class="card">
          <h2>Index Status</h2>
          <div class="row"><span>Status</span><span class="pill \${statusClass}">\${data.status}</span></div>
          <div class="row"><span>Chunks</span><span>\${fmt(data.chunks)}</span></div>
          <div class="row"><span>Files</span><span>\${fmt(data.files)}</span></div>
          <div class="row"><span>Edges</span><span>\${fmt(data.edges)}</span></div>
          <div class="row"><span>Indexed</span><span>\${relTime(data.indexedAt)}</span></div>
          <div class="row"><span>Project</span><span style="font-size:.78rem;color:var(--muted)">\${data.projectRoot || '-'}</span></div>
        </div>
      \`;

      const context = \`
        <div class="card">
          <h2>Context Pressure</h2>
          <div class="row"><span>Fill ratio</span><span class="pill \${fillClass}">\${fillPct}%</span></div>
          <div class="bar"><div style="width:\${fillPct}%;background:var(--\${fillClass})"></div></div>
          <div class="row" style="margin-top:.75rem"><span>Limit</span><span>\${fmt(data.contextLimit)} tokens</span></div>
        </div>
      \`;

      const langs = data.languages.length ? data.languages.map(l => \`<div class="row"><span>\${l.ext}</span><span>\${fmt(l.n)}</span></div>\`).join('') : '<p class="empty">No data</p>';
      const langCard = \`<div class="card"><h2>Languages</h2>\${langs}</div>\`;

      const hot = data.hotFiles.length ? data.hotFiles.map(f => \`<div class="row"><span>\${f.file}</span><span>\${fmt(f.n)} deps</span></div>\`).join('') : '<p class="empty">No dependents yet</p>';
      const hotCard = \`<div class="card grid-2"><h2>Hot files (most dependents)</h2>\${hot}<p class="subtitle" style="margin-top:.5rem">Be careful editing these — many files depend on them.</p></div>\`;

      const top = data.topFiles.length ? data.topFiles.map(f => \`<div class="row"><span>\${f.file}</span><span>\${fmt(f.n)} symbols</span></div>\`).join('') : '<p class="empty">No data</p>';
      const topCard = \`<div class="card grid-2"><h2>Project map (top files)</h2>\${top}</div>\`;

      const searches = initial?.recentSearches?.length ? initial.recentSearches.map(s => \`<div class="row"><span>\${s.query}</span><span class="pill \${s.usedSnippet?'good':'warn'}">\${s.usedSnippet?'snippet':'read'}</span></div>\`).join('') : '<p class="empty">No searches yet</p>';
      const searchCard = \`<div class="card grid-2"><h2>Recent searches</h2>\${searches}</div>\`;

      const events = data.recentEvents.length ? data.recentEvents.map(e => \`<div class="row"><span>\${e.file}</span><span class="pill">\${e.action}</span></div>\`).join('') : '<p class="empty">No recent index activity</p>';
      const eventsCard = \`<div class="card grid-2"><h2>Recent index activity</h2>\${events}</div>\`;

      app.innerHTML = hero + index + context + langCard + hotCard + topCard + searchCard + eventsCard;
    }

    async function refresh() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        render(data);
      } catch (e) {
        app.innerHTML = '<div class="card"><p class="empty">Unable to reach dashboard API. Is opencode running?</p></div>';
      }
    }

    render(initial);
    setInterval(refresh, 3000);
  </script>
</body>
</html>`
}
