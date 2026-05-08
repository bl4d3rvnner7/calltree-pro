"use strict";

const { CATEGORY_META } = require("../utils/sinks");

function formatHtml(result, config) {
  const { graph, stats, files, parseErrors } = result;

  // Build a serializable payload for the front-end
  const functions = {};
  for (const [name, info] of graph.functions) {
    functions[name] = {
      name,
      kind: info.kind,
      isAsync: !!info.isAsync,
      isGenerator: !!info.isGenerator,
      isPrivate: !!info.isPrivate,
      unresolved: !!info.unresolved,
      loc: info.loc || 0,
      complexity: info.complexity || 0,
      category: info.category || "user",
      severity: info.severity || null,
      locations: info.locations || [],
      callers: [...(graph.reverse.get(name) || [])],
      callees: [...(graph.forward.get(name)?.keys() || [])],
    };
  }

  const edges = [];
  for (const [from, callees] of graph.forward) {
    for (const [to, edge] of callees) {
      edges.push({
        from,
        to,
        count: edge.count,
        locations: (edge.locations || []).slice(0, 4), // cap per-edge
      });
    }
  }

  const data = {
    files,
    stats: {
      ...stats,
      unresolvedCount: [...graph.functions.values()].filter((i) => i.unresolved).length,
    },
    functions,
    edges,
    roots: graph.roots(),
    primaryEntry: graph.primaryEntry(),
    cycles: graph.cycles(),
    hotspots: graph.hotspots(config.hotspots || 15),
    dead: graph
      .deadFunctions()
      .filter((n) => !graph.roots().includes(n) && !n.startsWith("<top-level")),
    parseErrors,
    categoryMeta: CATEGORY_META,
    generatedAt: new Date().toISOString(),
    title: (files[0] || "report").split("/").pop(),
  };

  const dataJson = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return TEMPLATE.replace("__DATA__", dataJson);
}

const TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>calltree-pro report</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=VT323&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:        #0a0e0d;
    --bg-2:      #11181a;
    --bg-3:      #161e21;
    --line:      #233136;
    --line-2:    #1a2528;
    --fg:        #c8d4d6;
    --fg-dim:    #6a7c80;
    --fg-mute:   #4a5b5f;
    --accent:    #5dffaf;     /* phosphor green */
    --accent-2:  #ffb454;     /* amber */
    --warn:      #ffcc66;
    --danger:    #ff6464;
    --critical:  #ff3838;
    --network:   #ff6b6b;
    --crypto:    #a29bfe;
    --fs:        #feca57;
    --env:       #48dbfb;
    --enc:       #74b9ff;
    --dyn:       #ff3838;
    --cp:        #ff6464;
    --user:      #5dffaf;
    --unknown:   #6a7c80;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.5;
  }
  body {
    background-image:
      radial-gradient(circle at 20% 0%, rgba(93,255,175,0.06) 0%, transparent 40%),
      radial-gradient(circle at 80% 100%, rgba(255,180,84,0.04) 0%, transparent 40%);
    min-height: 100vh;
  }

  /* CRT scanline overlay — subtle */
  body::after {
    content: "";
    position: fixed; inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 2px,
      rgba(0,0,0,0.18) 2px,
      rgba(0,0,0,0.18) 3px
    );
    z-index: 9999;
    opacity: 0.35;
  }

  header.topbar {
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
    padding: 14px 22px;
    display: flex; align-items: center; gap: 18px;
    position: sticky; top: 0; z-index: 10;
  }
  .logo {
    font-family: "VT323", monospace;
    font-size: 28px; line-height: 1;
    color: var(--accent);
    letter-spacing: 0.04em;
  }
  .logo::before { content: "▣ "; }
  .crumb { color: var(--fg-dim); font-size: 12px; }
  .crumb b { color: var(--fg); }
  .topstats { margin-left: auto; display: flex; gap: 22px; }
  .topstats div { display: flex; flex-direction: column; align-items: flex-end; }
  .topstats .v { color: var(--accent); font-weight: 700; font-size: 16px; }
  .topstats .l { color: var(--fg-mute); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; }

  main {
    display: grid;
    grid-template-columns: 320px 1fr 360px;
    gap: 0;
    height: calc(100vh - 60px);
    overflow: hidden;
  }

  /* Sidebar — function list */
  aside.sidebar {
    border-right: 1px solid var(--line);
    background: var(--bg-2);
    overflow: auto;
    padding: 0;
  }
  .sb-head {
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-3);
    position: sticky; top: 0; z-index: 2;
  }
  .sb-head input {
    width: 100%; padding: 6px 8px;
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--fg);
    font-family: inherit; font-size: 12px;
    outline: none;
  }
  .sb-head input:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .sb-filters {
    margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;
  }
  .chip {
    padding: 2px 6px;
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--fg-dim);
    font-size: 10px;
    cursor: pointer;
    user-select: none;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .chip.active { color: var(--accent); border-color: var(--accent); }
  .chip:hover { color: var(--fg); }

  ul.fnlist { list-style: none; margin: 0; padding: 4px 0; }
  ul.fnlist li {
    padding: 3px 14px;
    cursor: pointer;
    border-left: 2px solid transparent;
    white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
    font-size: 12px;
  }
  ul.fnlist li:hover { background: var(--bg-3); }
  ul.fnlist li.active {
    background: var(--bg-3);
    border-left-color: var(--accent);
    color: var(--accent);
  }
  .cat-dot {
    display: inline-block;
    width: 6px; height: 6px;
    margin-right: 7px;
    vertical-align: middle;
  }

  /* Main pane */
  section.viewport {
    overflow: auto;
    padding: 18px 24px;
  }
  .panel-title {
    color: var(--fg-mute);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    margin: 0 0 10px;
    border-bottom: 1px dashed var(--line);
    padding-bottom: 6px;
  }
  .panel-title::before { content: "▶ "; color: var(--accent); }

  .fn-header {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 14px 22px;
    align-items: start;
    margin-bottom: 22px;
    padding: 14px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
  }
  .fn-name {
    font-size: 18px; font-weight: 700;
    color: var(--accent);
    word-break: break-all;
  }
  .fn-name .kind { color: var(--fg-mute); font-weight: 400; font-size: 12px; margin-left: 8px; }
  .fn-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px 14px; }
  .fn-meta dt { color: var(--fg-mute); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .fn-meta dd { margin: 0; color: var(--fg); }

  .badge {
    display: inline-block;
    padding: 1px 6px;
    border: 1px solid currentColor;
    font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    margin-right: 4px;
  }
  .badge.async    { color: var(--env); }
  .badge.gen      { color: var(--enc); }
  .badge.private  { color: var(--crypto); }
  .badge.ctor     { color: var(--accent-2); }
  .badge.unresolved { color: var(--fg-mute); border-style: dashed; }

  /* Tree */
  .tree {
    background: var(--bg-2);
    border: 1px solid var(--line);
    padding: 14px;
    overflow: auto;
    white-space: pre;
    font-size: 12.5px;
    line-height: 1.7;
  }
  .tree .node { cursor: pointer; padding: 0 4px; }
  .tree .node:hover { background: var(--bg-3); color: var(--accent); }
  .tree .recurse { color: var(--accent-2); }
  .tree .glyph { color: var(--fg-mute); }
  .tree .tag { color: var(--fg-mute); font-size: 11px; }

  /* Severity coloring on nodes */
  .cat-network      { color: var(--network); }
  .cat-dns          { color: var(--network); }
  .cat-child_process{ color: var(--cp); font-weight: 700; }
  .cat-dynamic_exec { color: var(--dyn); font-weight: 700; }
  .cat-fs           { color: var(--fs); }
  .cat-env          { color: var(--env); }
  .cat-crypto       { color: var(--crypto); }
  .cat-encoding     { color: var(--enc); }
  .cat-fingerprint  { color: var(--network); }
  .cat-error        { color: var(--fg-dim); }
  .cat-control      { color: var(--fg-dim); }
  .cat-scheduling   { color: var(--fg-dim); }
  .cat-user         { color: var(--user); }
  .cat-unknown      { color: var(--unknown); }
  .unresolved-name  { font-style: italic; opacity: 0.75; }

  /* Right pane */
  aside.detail {
    border-left: 1px solid var(--line);
    background: var(--bg-2);
    overflow: auto;
    padding: 14px 16px;
  }
  .section { margin-bottom: 22px; }
  .section h3 {
    font-size: 11px;
    color: var(--fg-mute);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    margin: 0 0 8px;
  }
  .section h3::before { content: "▌ "; color: var(--accent); }

  table.k-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.k-table td { padding: 3px 0; }
  table.k-table td:first-child { color: var(--fg-mute); padding-right: 14px; white-space: nowrap; }

  .pill {
    display: inline-block;
    padding: 1px 5px;
    margin: 1px 2px 1px 0;
    border: 1px solid var(--line);
    background: var(--bg);
    font-size: 11px;
    cursor: pointer;
    color: var(--fg);
  }
  .pill:hover { border-color: var(--accent); color: var(--accent); }

  .hotspot-row {
    display: grid;
    grid-template-columns: 28px 1fr 50px;
    gap: 6px; align-items: center;
    font-size: 12px; padding: 3px 0;
  }
  .hotspot-row .bar {
    height: 9px;
    background: linear-gradient(to right, var(--accent), var(--accent-2));
  }
  .hotspot-row .name { color: var(--fg); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hotspot-row .name:hover { color: var(--accent); }
  .hotspot-row .count { text-align: right; color: var(--accent); font-weight: 700; }

  .danger-path {
    border: 1px solid var(--danger);
    border-left-width: 3px;
    background: rgba(255,100,100,0.05);
    padding: 6px 8px;
    margin: 4px 0;
    font-size: 11px;
  }
  .danger-path b { color: var(--danger); }

  .tab-bar {
    display: flex; gap: 2px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 14px;
  }
  .tab {
    padding: 6px 12px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-bottom: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .tab.active { background: var(--bg-3); color: var(--accent); border-color: var(--accent) var(--line) transparent var(--line); }

  .tab-content { display: none; }
  .tab-content.active { display: block; }

  .empty { color: var(--fg-mute); font-style: italic; padding: 20px 0; text-align: center; }

  /* Navbar */
  nav.navbar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 14px;
    background: var(--bg-3);
    border-bottom: 1px solid var(--line);
    font-size: 11px;
    height: 30px;
    position: sticky; top: 60px; z-index: 9;
  }
  .nav-btn {
    background: var(--bg-2);
    border: 1px solid var(--line);
    color: var(--fg-dim);
    padding: 3px 10px;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .nav-btn:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .nav-sep { color: var(--line); margin: 0 4px; }
  .nav-breadcrumb {
    color: var(--fg-dim);
    overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .nav-breadcrumb .crumb-step {
    color: var(--fg);
    cursor: pointer;
    padding: 0 3px;
  }
  .nav-breadcrumb .crumb-step:hover { color: var(--accent); }
  .nav-breadcrumb .crumb-step.current { color: var(--accent); }
  .nav-breadcrumb .crumb-arrow { color: var(--fg-mute); margin: 0 2px; }
  .nav-spacer { flex: 0; }
  .nav-hint { color: var(--fg-mute); font-size: 10px; white-space: nowrap; }

  /* Adjust main height to account for navbar */
  main { height: calc(100vh - 60px - 30px); }

  /* Explorer (IDA-style neighborhood view) */
  .explorer {
    background: var(--bg-2);
    border: 1px solid var(--line);
    padding: 14px;
    overflow: auto;
    min-height: 500px;
  }
  .explorer-grid {
    display: grid;
    grid-template-columns: 1fr 60px 1.4fr 60px 1fr;
    gap: 8px 0;
    align-items: start;
  }
  .explorer-col-h {
    grid-column: span 1;
    color: var(--fg-mute);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    padding: 4px 0 8px;
    border-bottom: 1px dashed var(--line);
    margin-bottom: 8px;
  }
  .explorer-arrow-h { background: transparent; }
  .explorer-card {
    background: var(--bg-3);
    border: 1px solid var(--line);
    padding: 6px 10px;
    margin: 3px 0;
    cursor: pointer;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-left: 3px solid var(--line);
  }
  .explorer-card:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .explorer-card.center {
    background: var(--bg);
    border: 2px solid var(--accent);
    border-left-width: 5px;
    padding: 10px 12px;
    cursor: default;
    font-size: 14px;
    font-weight: 700;
    color: var(--accent);
  }
  .explorer-card .meta {
    display: block;
    font-size: 10px;
    color: var(--fg-mute);
    font-weight: 400;
    margin-top: 2px;
  }
  .explorer-card.danger { border-left-color: var(--danger); }
  .explorer-card.warn   { border-left-color: var(--warn);   }
  .explorer-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-mute);
    font-size: 14px;
    padding: 8px 0;
    margin: 3px 0;
    height: 32px;
  }
  .explorer-arrow.danger { color: var(--danger); }
  .explorer-empty {
    grid-column: span 1;
    color: var(--fg-mute);
    font-style: italic;
    padding: 6px;
    text-align: center;
    font-size: 11px;
  }

  /* Source location pills */
  .src-loc {
    color: var(--fg-mute);
    font-size: 10px;
    font-style: italic;
    margin-left: 4px;
  }

  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--line); border: 2px solid var(--bg); }
  ::-webkit-scrollbar-thumb:hover { background: var(--fg-mute); }
</style>
</head>
<body>

<header class="topbar">
  <span class="logo">CALLTREE//PRO</span>
  <span class="crumb"><b id="crumb-title"></b> · <span id="crumb-time"></span></span>
  <div class="topstats">
    <div><span class="v" id="s-fns">0</span><span class="l">functions</span></div>
    <div><span class="v" id="s-edges">0</span><span class="l">edges</span></div>
    <div><span class="v" id="s-roots">0</span><span class="l">roots</span></div>
    <div><span class="v" id="s-unres">0</span><span class="l">unresolved</span></div>
    <div><span class="v" id="s-cycles">0</span><span class="l">cycles</span></div>
  </div>
</header>

<nav class="navbar">
  <button id="btn-back"    class="nav-btn" title="Back (Alt+←)">◄ back</button>
  <button id="btn-forward" class="nav-btn" title="Forward (Alt+→)">forward ►</button>
  <button id="btn-home"    class="nav-btn" title="Jump to primary entry (H)">▣ entry</button>
  <span class="nav-sep">│</span>
  <span class="nav-breadcrumb" id="breadcrumb"></span>
  <span class="nav-spacer"></span>
  <span class="nav-hint">click any function in a tree to drill in · use ◄/► to retrace · H = entry</span>
</nav>

<main>
  <aside class="sidebar">
    <div class="sb-head">
      <input id="search" placeholder="Filter functions… (substring or /regex/)" />
      <div class="sb-filters" id="cat-filters"></div>
    </div>
    <ul class="fnlist" id="fnlist"></ul>
  </aside>

  <section class="viewport">
    <div class="tab-bar">
      <div class="tab active" data-tab="tree">▼ Call tree</div>
      <div class="tab" data-tab="callers">▲ Callers (reverse)</div>
      <div class="tab" data-tab="explorer">⬡ Explorer</div>
      <div class="tab" data-tab="overview">⬢ Overview</div>
      <div class="tab" data-tab="cycles">↻ Cycles</div>
      <div class="tab" data-tab="dead">✗ Dead</div>
    </div>

    <div class="tab-content active" id="tab-tree">
      <div id="fn-card"></div>
      <h2 class="panel-title">forward call tree (who this calls)</h2>
      <div class="tree" id="tree-fwd"></div>
    </div>

    <div class="tab-content" id="tab-callers">
      <div id="fn-card-2"></div>
      <h2 class="panel-title">reverse call tree (who calls this)</h2>
      <div class="tree" id="tree-rev"></div>
    </div>

    <div class="tab-content" id="tab-explorer">
      <h2 class="panel-title">explorer — neighbors of selection (IDA-style)</h2>
      <div id="explorer-content" class="explorer"></div>
    </div>

    <div class="tab-content" id="tab-overview">
      <h2 class="panel-title">project overview</h2>
      <div id="overview-content"></div>
    </div>

    <div class="tab-content" id="tab-cycles">
      <h2 class="panel-title">cycles & recursion</h2>
      <div id="cycles-content"></div>
    </div>

    <div class="tab-content" id="tab-dead">
      <h2 class="panel-title">possibly dead functions</h2>
      <div id="dead-content"></div>
    </div>
  </section>

  <aside class="detail">
    <div class="section">
      <h3>hotspots</h3>
      <div id="hotspots"></div>
    </div>
    <div class="section">
      <h3>sinks reached from selection</h3>
      <div id="danger"></div>
    </div>
    <div class="section">
      <h3>sinks by category</h3>
      <div id="cats"></div>
    </div>
  </aside>
</main>

<script>
const DATA = __DATA__;
window.DATA = DATA;
</script>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const escHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
  const fns = DATA.functions;
  const meta = DATA.categoryMeta;

  function catColor(cat) { return (meta[cat] || meta.unknown).color; }
  function catLabel(cat) { return (meta[cat] || meta.unknown).label; }
  function catIcon(cat)  { return (meta[cat] || meta.unknown).icon;  }

  // Top stats
  $("crumb-title").textContent = DATA.title;
  $("crumb-time").textContent = "generated " + DATA.generatedAt;
  $("s-fns").textContent = DATA.stats.functionCount;
  $("s-edges").textContent = DATA.stats.callCount;
  $("s-roots").textContent = DATA.roots.length;
  $("s-unres").textContent = DATA.stats.unresolvedCount;
  $("s-cycles").textContent = DATA.cycles.length;

  // Category filter chips
  const allCats = [...new Set(Object.values(fns).map((f) => f.category || "unknown"))];
  const activeCats = new Set(allCats);
  const chipBar = $("cat-filters");
  for (const cat of allCats) {
    const chip = document.createElement("span");
    chip.className = "chip active";
    chip.dataset.cat = cat;
    chip.innerHTML = '<span class="cat-dot" style="background:' + catColor(cat) + '"></span>' + catLabel(cat);
    chip.addEventListener("click", () => {
      if (activeCats.has(cat)) { activeCats.delete(cat); chip.classList.remove("active"); }
      else { activeCats.add(cat); chip.classList.add("active"); }
      renderList();
    });
    chipBar.appendChild(chip);
  }

  // Function list
  const search = $("search");
  search.addEventListener("input", renderList);

  let current = null;

  function renderList() {
    const q = search.value.trim();
    let pattern = null;
    if (q.length > 1 && q.startsWith("/") && q.endsWith("/")) {
      try { pattern = new RegExp(q.slice(1, -1), "i"); } catch (e) {}
    }
    const items = Object.values(fns)
      .filter((f) => activeCats.has(f.category || "unknown"))
      .filter((f) => {
        if (!q) return true;
        if (pattern) return pattern.test(f.name);
        return f.name.toLowerCase().includes(q.toLowerCase());
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const ul = $("fnlist");
    ul.innerHTML = "";
    for (const f of items) {
      const li = document.createElement("li");
      li.dataset.name = f.name;
      const dot = '<span class="cat-dot" style="background:' + catColor(f.category) + '"></span>';
      const isEntry = DATA.primaryEntry === f.name;
      const star = isEntry ? '<span style="color:var(--accent);font-weight:700">★</span> ' : '';
      const tag = f.unresolved ? ' <span style="color:var(--fg-mute)">[?]</span>' : "";
      li.innerHTML = dot + star + escHtml(f.name) + tag;
      if (current === f.name) li.classList.add("active");
      li.addEventListener("click", () => select(f.name));
      ul.appendChild(li);
    }
    if (!items.length) {
      ul.innerHTML = '<li class="empty">no matches</li>';
    }
  }

  // Tabs
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $("tab-" + t.dataset.tab).classList.add("active");
    });
  });

  // ---- Render fn header card ----
  function renderCard(name, target) {
    const f = fns[name];
    if (!f) {
      target.innerHTML = '<div class="empty">function not found: ' + escHtml(name) + "</div>";
      return;
    }
    const badges = [];
    if (f.isAsync)    badges.push('<span class="badge async">async</span>');
    if (f.isGenerator)badges.push('<span class="badge gen">gen</span>');
    if (f.isPrivate)  badges.push('<span class="badge private">private</span>');
    if (f.kind === "constructor") badges.push('<span class="badge ctor">ctor</span>');
    if (f.unresolved) badges.push('<span class="badge unresolved">unresolved</span>');
    if (DATA.primaryEntry === name) badges.push('<span class="badge ctor">★ entry</span>');

    const cat = f.category || "unknown";
    const sourceLabel = f.unresolved ? "called from" : "source";
    let sourceVal = "—";
    if (f.locations && f.locations[0]) {
      sourceVal = f.locations.slice(0, 4).map((l) => {
        const file = l.file.split("/").pop();
        return file + ":" + l.line + ":" + l.column;
      }).join("; ");
      if (f.locations.length > 4) sourceVal += "; +" + (f.locations.length - 4) + " more";
    }

    target.innerHTML = '' +
      '<div class="fn-header">' +
        '<div>' +
          '<div class="fn-name cat-' + cat + '">' + escHtml(f.name) +
            '<span class="kind">' + f.kind + "</span></div>" +
          '<div style="margin-top:6px">' + badges.join("") + '</div>' +
        '</div>' +
        '<dl class="fn-meta">' +
          '<div><dt>category</dt><dd>' + catIcon(cat) + " " + catLabel(cat) + '</dd></div>' +
          '<div><dt>loc</dt><dd>' + f.loc + '</dd></div>' +
          '<div><dt>complexity</dt><dd>' + f.complexity + '</dd></div>' +
          '<div><dt>callers</dt><dd>' + f.callers.length + '</dd></div>' +
          '<div><dt>callees</dt><dd>' + f.callees.length + '</dd></div>' +
          '<div><dt>' + sourceLabel + '</dt><dd>' + escHtml(sourceVal) + '</dd></div>' +
        '</dl>' +
      '</div>';
  }

  // ---- Render forward/reverse trees as inline boxes ----
  function buildTree(name, getNext, depth, prefix, isLast, isRoot, visited, lines) {
    if (depth > 15) {
      lines.push(prefix + (isLast ? "└── " : "├── ") + '<span class="glyph">…</span>');
      return;
    }
    const connector = isRoot ? "" : (isLast ? "└── " : "├── ");
    const nextPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");

    if (visited.has(name)) {
      lines.push(
        '<span class="glyph">' + prefix + connector + '</span>' +
        '<span class="recurse">↩ ' + escHtml(name) + '</span>',
      );
      return;
    }
    visited.add(name);

    const f = fns[name];
    const cat = f ? (f.category || "unknown") : "unknown";
    const nameClass = "cat-" + cat + (f && f.unresolved ? " unresolved-name" : "");
    const tags = [];
    if (f && f.isAsync) tags.push("async");
    if (f && f.kind === "constructor") tags.push("ctor");
    if (f && f.unresolved) tags.push("unresolved");
    const tagStr = tags.length ? '<span class="tag"> [' + tags.join(",") + "]</span>" : "";
    // For unresolved fillers, show the line(s) where they're called from.
    // For real functions, show the line where they're defined.
    let locStr = "";
    if (f && f.locations && f.locations[0]) {
      const ls = f.locations.slice(0, 2)
        .map((l) => "L" + l.line)
        .join(",");
      const more = f.locations.length > 2 ? "+" + (f.locations.length - 2) : "";
      locStr = ' <span class="src-loc">' + ls + more + "</span>";
    }

    lines.push(
      '<span class="glyph">' + prefix + connector + "</span>" +
      '<span class="node ' + nameClass + '" data-go="' + escHtml(name) + '">' +
        escHtml(name) + tagStr + locStr + "</span>"
    );

    const children = (getNext(name) || []).slice().sort();
    children.forEach((child, i) => {
      buildTree(
        child, getNext, depth + 1, nextPrefix,
        i === children.length - 1, false,
        new Set(visited), lines,
      );
    });
  }

  function renderTree(name, target, direction) {
    const lines = [];
    const getNext = direction === "fwd"
      ? (n) => (fns[n] ? fns[n].callees : [])
      : (n) => (fns[n] ? fns[n].callers : []);
    buildTree(name, getNext, 0, "", true, true, new Set(), lines);
    target.innerHTML = lines.join("\n");

    target.querySelectorAll(".node").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.go));
    });
  }

  // ---- Detail pane: sinks reached ----
  function renderSinksReached(name) {
    const f = fns[name];
    const target = $("danger");
    if (!f) { target.innerHTML = '<div class="empty">—</div>'; return; }

    const danger = ["dynamic_exec", "child_process", "network", "dns"];
    // BFS for shortest path to each category
    const out = [];
    for (const cat of danger) {
      const path = bfsToCategory(name, cat);
      if (path) {
        out.push(
          '<div class="danger-path">' +
            '<b>' + catIcon(cat) + " " + catLabel(cat) + ":</b> " +
            path.map((n) => '<span class="pill" data-go="' + escHtml(n) + '">' + escHtml(n) + "</span>").join(" → ") +
          '</div>'
        );
      }
    }
    target.innerHTML = out.length ? out.join("") : '<div class="empty">no dangerous sinks reachable</div>';

    target.querySelectorAll(".pill").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.go));
    });
  }

  function bfsToCategory(start, cat) {
    const visited = new Set([start]);
    const queue = [[start]];
    while (queue.length) {
      const path = queue.shift();
      const node = path[path.length - 1];
      const f = fns[node];
      if (f && f.category === cat && path.length > 1) return path;
      const callees = (f && f.callees) || [];
      for (const next of callees) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push([...path, next]);
      }
    }
    return null;
  }

  // ---- Static panels: hotspots, cats, overview, cycles, dead ----
  function renderHotspots() {
    const max = DATA.hotspots[0]?.count || 1;
    const t = $("hotspots");
    t.innerHTML = DATA.hotspots.map((h) => {
      const w = Math.round((h.count / max) * 100);
      const cat = (fns[h.name] && fns[h.name].category) || "unknown";
      return '<div class="hotspot-row">' +
        '<span style="color:' + catColor(cat) + '">' + catIcon(cat) + "</span>" +
        '<span class="name" data-go="' + escHtml(h.name) + '">' + escHtml(h.name) + "</span>" +
        '<span class="count">' + h.count + "</span>" +
        '<span style="grid-column: 2 / 4"><span class="bar" style="width:' + w + '%"></span></span>' +
      "</div>";
    }).join("");
    t.querySelectorAll(".name").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.go));
    });
  }

  function renderCategories() {
    const groups = {};
    for (const f of Object.values(fns)) {
      const c = f.category || "unknown";
      (groups[c] = groups[c] || []).push(f);
    }
    const order = ["dynamic_exec", "child_process", "network", "dns", "fs", "env", "crypto", "encoding", "fingerprint", "scheduling", "control", "error", "user", "unknown"];
    const t = $("cats");
    t.innerHTML = order.filter((c) => groups[c]).map((c) => {
      const list = groups[c].sort((a, b) => b.callers.length - a.callers.length).slice(0, 6);
      const more = groups[c].length > 6 ? ' <span style="color:var(--fg-mute)">+' + (groups[c].length - 6) + " more</span>" : "";
      return '<div style="margin-bottom:10px">' +
        '<div style="color:' + catColor(c) + ';font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">' +
          catIcon(c) + " " + catLabel(c) + " <span style=\"color:var(--fg-mute);font-weight:400\">(" + groups[c].length + ")</span>" +
        "</div>" +
        list.map((f) => '<span class="pill" data-go="' + escHtml(f.name) + '">' + escHtml(f.name) + "</span>").join("") +
        more +
      "</div>";
    }).join("");
    t.querySelectorAll(".pill").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.go));
    });
  }

  function renderOverview() {
    const files = DATA.files.map((f) => '<li><code>' + escHtml(f) + "</code></li>").join("");
    const errs = DATA.parseErrors.length
      ? '<h3 style="color:var(--danger)">Parse errors</h3>' +
        '<ul>' + DATA.parseErrors.map((e) => "<li><code>" + escHtml(e.file) + "</code>: " + escHtml(e.message) + "</li>").join("") + "</ul>"
      : "";
    const roots = DATA.roots.map((r) => '<span class="pill" data-go="' + escHtml(r) + '">' + escHtml(r) + "</span>").join(" ");
    $("overview-content").innerHTML =
      '<table class="k-table">' +
        '<tr><td>files</td><td>' + DATA.stats.fileCount + "</td></tr>" +
        '<tr><td>functions</td><td>' + DATA.stats.functionCount + "</td></tr>" +
        '<tr><td>call edges</td><td>' + DATA.stats.callCount + "</td></tr>" +
        '<tr><td>unresolved</td><td>' + DATA.stats.unresolvedCount + "</td></tr>" +
        '<tr><td>roots</td><td>' + DATA.roots.length + "</td></tr>" +
        '<tr><td>cycles</td><td>' + DATA.cycles.length + "</td></tr>" +
        '<tr><td>parse errors</td><td>' + DATA.parseErrors.length + "</td></tr>" +
      "</table>" +
      "<h3 style=\"margin-top:18px\">Files</h3><ul>" + files + "</ul>" +
      "<h3 style=\"margin-top:18px\">Roots</h3><div>" + roots + "</div>" +
      errs;
    $("overview-content").querySelectorAll(".pill").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.go));
    });
  }

  function renderCycles() {
    const t = $("cycles-content");
    if (!DATA.cycles.length) { t.innerHTML = '<div class="empty">no cycles detected</div>'; return; }
    t.innerHTML = DATA.cycles.map((cyc) =>
      '<div class="danger-path"><b>↻</b> ' +
      cyc.map((n) => '<span class="pill" data-go="' + escHtml(n) + '">' + escHtml(n) + "</span>").join(" → ") +
      "</div>"
    ).join("");
    t.querySelectorAll(".pill").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.go));
    });
  }

  function renderDead() {
    const t = $("dead-content");
    if (!DATA.dead.length) { t.innerHTML = '<div class="empty">no dead functions</div>'; return; }
    t.innerHTML = DATA.dead.map((n) => '<span class="pill" data-go="' + escHtml(n) + '">' + escHtml(n) + "</span>").join(" ");
    t.querySelectorAll(".pill").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.go));
    });
  }

  // ---- Explorer (IDA-style neighborhood view) ----
  function renderExplorer(name) {
    const t = $("explorer-content");
    const f = fns[name];
    if (!f) { t.innerHTML = '<div class="empty">—</div>'; return; }

    function cardHtml(other, side) {
      const fo = fns[other];
      const cat = fo?.category || "unknown";
      const meta = (DATA.categoryMeta[cat] || DATA.categoryMeta.unknown);
      const dangerous = cat === "child_process" || cat === "dynamic_exec" || cat === "network" || cat === "dns";
      const cls = "explorer-card" + (dangerous ? " danger" : "");
      // Find the call-site line(s) for this edge
      let metaLine;
      if (side === "callee") {
        // edge from name to other
        const callees = fns[name].callees;
        let callsiteLines = [];
        for (const e of DATA.edges) {
          if (e.from === name && e.to === other) {
            callsiteLines = (e.locations || []).slice(0, 2).map((l) => "L" + l.line);
            break;
          }
        }
        metaLine = (callsiteLines.length ? "@ " + callsiteLines.join(",") + " · " : "") +
                   meta.icon + " " + meta.label +
                   (fo?.unresolved ? " · unresolved" : "");
      } else {
        // edge from other to name
        let callsiteLines = [];
        for (const e of DATA.edges) {
          if (e.from === other && e.to === name) {
            callsiteLines = (e.locations || []).slice(0, 2).map((l) => "L" + l.line);
            break;
          }
        }
        metaLine = (callsiteLines.length ? "@ " + callsiteLines.join(",") + " · " : "") +
                   meta.icon + " " + meta.label;
      }
      return '<div class="' + cls + '" data-go="' + escHtml(other) + '" style="border-left-color:' + meta.color + '">' +
              escHtml(other) +
              '<span class="meta">' + escHtml(metaLine) + '</span>' +
             '</div>';
    }

    const callers = (f.callers || []).slice().sort();
    const callees = (f.callees || []).slice().sort();

    const callerCards = callers.length
      ? callers.map((c) => cardHtml(c, "caller")).join("")
      : '<div class="explorer-empty">(no callers — this is a root)</div>';
    const calleeCards = callees.length
      ? callees.map((c) => cardHtml(c, "callee")).join("")
      : '<div class="explorer-empty">(no callees)</div>';

    const arrowFrom = '<div class="explorer-arrow">─►</div>';
    const arrowTo   = '<div class="explorer-arrow">─►</div>';

    // Build the central card with badges
    const cat = f.category || "unknown";
    const meta = DATA.categoryMeta[cat] || DATA.categoryMeta.unknown;
    const tags = [];
    if (f.isAsync) tags.push("async");
    if (f.unresolved) tags.push("unresolved");
    if (f.kind === "constructor") tags.push("ctor");
    const centerCard =
      '<div class="explorer-card center" style="border-color:' + meta.color + '">' +
        escHtml(f.name) +
        '<span class="meta">' + meta.icon + " " + meta.label +
          (tags.length ? " · " + tags.join(",") : "") +
          " · in: " + callers.length + " · out: " + callees.length +
        '</span>' +
      '</div>';

    // Build the grid: 5 columns × N rows. Headers first.
    const callerRows = pad([callerCards], 1);
    const calleeRows = pad([calleeCards], 1);
    const arrowRows = '<div class="explorer-arrow">─►</div>';

    t.innerHTML =
      '<div class="explorer-grid">' +
        '<div class="explorer-col-h">CALLERS (' + callers.length + ')</div>' +
        '<div class="explorer-col-h explorer-arrow-h"></div>' +
        '<div class="explorer-col-h">SELECTED</div>' +
        '<div class="explorer-col-h explorer-arrow-h"></div>' +
        '<div class="explorer-col-h">CALLEES (' + callees.length + ')</div>' +

        '<div>' + callerCards + '</div>' +
        '<div>' + (callers.length ? arrowRows : "") + '</div>' +
        '<div>' + centerCard + '</div>' +
        '<div>' + (callees.length ? arrowRows : "") + '</div>' +
        '<div>' + calleeCards + '</div>' +
      '</div>';

    t.querySelectorAll(".explorer-card[data-go]").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.go));
    });
  }
  function pad(arr) { return arr; } // placeholder for layout helper

  // ---- Navigation: history stack + breadcrumb ----
  let history = [];
  let cursor = -1;

  function navTo(name, fromHistory) {
    if (!fns[name]) return;
    if (!fromHistory) {
      // Drop forward stack when navigating fresh
      history = history.slice(0, cursor + 1);
      // Avoid duplicate consecutive entries
      if (history[cursor] !== name) {
        history.push(name);
        cursor = history.length - 1;
        // Cap history to 100 entries
        if (history.length > 100) {
          history.shift();
          cursor--;
        }
      }
    }
    renderForCurrent(name);
    updateNavUI();
  }

  function navBack()    { if (cursor > 0)               { cursor--; renderForCurrent(history[cursor]); updateNavUI(); } }
  function navForward() { if (cursor < history.length - 1) { cursor++; renderForCurrent(history[cursor]); updateNavUI(); } }
  function navHome()    { if (DATA.primaryEntry) navTo(DATA.primaryEntry); }

  function renderForCurrent(name) {
    current = name;
    document.querySelectorAll("ul.fnlist li").forEach((li) => {
      li.classList.toggle("active", li.dataset.name === name);
    });
    const active = document.querySelector("ul.fnlist li.active");
    if (active) active.scrollIntoView({ block: "nearest" });

    renderCard(name, $("fn-card"));
    renderCard(name, $("fn-card-2"));
    renderTree(name, $("tree-fwd"), "fwd");
    renderTree(name, $("tree-rev"), "rev");
    renderExplorer(name);
    renderSinksReached(name);
  }

  function updateNavUI() {
    $("btn-back").disabled    = cursor <= 0;
    $("btn-forward").disabled = cursor >= history.length - 1;
    // Breadcrumb: show the trail with the current step highlighted
    const crumb = $("breadcrumb");
    const start = Math.max(0, cursor - 4);
    const trail = history.slice(start, cursor + 3);
    const offset = start;
    crumb.innerHTML = (start > 0 ? '<span class="crumb-arrow">…</span>' : "") +
      trail.map((n, i) => {
        const idx = offset + i;
        const cls = "crumb-step" + (idx === cursor ? " current" : "");
        return '<span class="' + cls + '" data-idx="' + idx + '">' + escHtml(n) + "</span>";
      }).join('<span class="crumb-arrow">›</span>') +
      (cursor + 3 < history.length ? '<span class="crumb-arrow">…</span>' : "");
    crumb.querySelectorAll(".crumb-step").forEach((el) => {
      el.addEventListener("click", () => {
        cursor = parseInt(el.dataset.idx, 10);
        renderForCurrent(history[cursor]);
        updateNavUI();
      });
    });
  }

  // The select() that the rest of the code calls should now go through navTo
  function select(name) { navTo(name); }

  // Wire nav buttons
  $("btn-back").addEventListener("click", navBack);
  $("btn-forward").addEventListener("click", navForward);
  $("btn-home").addEventListener("click", navHome);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // Don't interfere with typing in the search box
    if (e.target.tagName === "INPUT") return;
    if (e.altKey && e.key === "ArrowLeft")  { e.preventDefault(); navBack(); }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); navForward(); }
    if (e.key === "h" || e.key === "H")     { navHome(); }
    if (e.key === "/" )                     { e.preventDefault(); $("search").focus(); }
  });

  // Init
  renderList();
  renderHotspots();
  renderCategories();
  renderOverview();
  renderCycles();
  renderDead();
  // Default selection: graph.primaryEntry() (computed on the server side)
  // falls back to a non-anonymous root with callees, then anything.
  const candidates = [
    DATA.primaryEntry,
    ...DATA.roots.filter((r) => !r.startsWith("<") && fns[r]?.callees?.length),
    ...DATA.roots.filter((r) => !r.startsWith("<")),
    ...Object.keys(fns).filter((n) => fns[n].callees && fns[n].callees.length),
  ].filter(Boolean);
  const firstReal = candidates[0] || Object.keys(fns)[0];
  if (firstReal) navTo(firstReal);
})();
</script>
</body>
</html>
`;

module.exports = { formatHtml };
