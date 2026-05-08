"use strict";

const { CATEGORY_META } = require("../utils/sinks");

function escape(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Render a Graphviz DOT file.
 *
 * Options on `config`:
 *   focus:        function name to anchor on (defaults to graph.primaryEntry())
 *   maxNodes:     cap on total nodes rendered (default 200) — picks the
 *                 nearest N nodes to `focus` by BFS distance
 *   maxHops:      hard cap on BFS distance from focus (default Infinity)
 *   subgraphOnly: if true, drop nodes not reachable from focus
 */
function formatDot(result, config = {}) {
  const { graph } = result;
  const focus = config.focus || graph.primaryEntry() || graph.roots()[0] || null;
  const maxNodes = config.maxNodes ?? 200;
  const maxHops  = config.maxHops ?? Infinity;

  // BFS from focus (forward + reverse) to get distance-ranked node set
  const dist = new Map();
  if (focus) {
    dist.set(focus, 0);
    const q = [focus];
    while (q.length) {
      const node = q.shift();
      const d = dist.get(node);
      if (d >= maxHops) continue;
      const fwd = graph.forward.get(node);
      if (fwd) for (const next of fwd.keys()) {
        if (!dist.has(next)) { dist.set(next, d + 1); q.push(next); }
      }
      const rev = graph.reverse.get(node);
      if (rev) for (const prev of rev) {
        if (!dist.has(prev)) { dist.set(prev, d + 1); q.push(prev); }
      }
    }
  }

  // Pick which nodes to render
  let nodeNames;
  if (focus && (config.subgraphOnly || graph.functions.size > maxNodes)) {
    // Sort by distance, take closest maxNodes
    const sorted = [...dist.entries()].sort((a, b) => a[1] - b[1]);
    nodeNames = new Set(sorted.slice(0, maxNodes).map(([n]) => n));
  } else {
    nodeNames = new Set(graph.functions.keys());
  }

  const out = [];
  out.push("digraph CallGraph {");
  out.push('  rankdir="TB";');                           // top-down (was LR)
  out.push('  graph [splines=ortho, nodesep=0.4, ranksep=0.6, bgcolor="#0a0e0d"];');
  out.push('  node [shape=box, style="rounded,filled", fontname="JetBrains Mono,Helvetica", ' +
           'fontsize=10, color="#233136", fontcolor="#c8d4d6", fillcolor="#161e21"];');
  out.push('  edge [fontname="Helvetica", fontsize=8, color="#4a5b5f", arrowsize=0.6];');
  out.push("");

  // Render nodes
  for (const name of nodeNames) {
    const info = graph.functions.get(name);
    let attrs = `label="${escape(label(name, info))}"`;

    if (focus && name === focus) {
      // Highlight the entry point: phosphor-green border, bold, larger
      attrs += `, color="#5dffaf", penwidth=3, fontcolor="#5dffaf", fontsize=14, ` +
               `fillcolor="#11181a"`;
    } else if (info && info.unresolved) {
      attrs += `, style="rounded,filled,dashed", fontcolor="#6a7c80", fillcolor="#0f1416"`;
    } else if (info && info.category) {
      const meta = CATEGORY_META[info.category];
      if (meta && info.category !== "user" && info.category !== "unknown") {
        attrs += `, color="${meta.color}", fontcolor="${meta.color}"`;
        if (info.severity === "high") attrs += `, penwidth=2`;
      }
    }
    if (info && info.kind === "constructor") {
      attrs += `, shape=parallelogram`;
    }
    out.push(`  "${escape(name)}" [${attrs}];`);
  }

  out.push("");

  // Render edges (only between nodes we kept)
  for (const [from, callees] of graph.forward) {
    if (!nodeNames.has(from)) continue;
    for (const [to, edge] of callees) {
      if (!nodeNames.has(to)) continue;
      const toInfo = graph.functions.get(to);
      const cat = toInfo?.category;
      const meta = cat && CATEGORY_META[cat];
      let eAttrs = "";
      if (meta && (cat === "child_process" || cat === "dynamic_exec")) {
        eAttrs = `[color="${meta.color}", penwidth=1.6, arrowsize=0.8]`;
      } else if (meta && (cat === "network" || cat === "dns")) {
        eAttrs = `[color="${meta.color}", penwidth=1.3]`;
      }
      const lbl = edge.count > 1 ? ` xlabel="×${edge.count}"` : "";
      if (lbl && !eAttrs) eAttrs = `[${lbl.trim()}]`;
      else if (lbl && eAttrs) eAttrs = eAttrs.replace(/\]$/, `,${lbl.trim()}]`);
      out.push(`  "${escape(from)}" -> "${escape(to)}"${eAttrs ? " " + eAttrs : ""};`);
    }
  }

  // Note in the corner if we trimmed
  if (nodeNames.size < graph.functions.size) {
    out.push("");
    out.push(`  // Trimmed: showing ${nodeNames.size} of ${graph.functions.size} nodes ` +
             `(closest BFS neighbors of "${focus}").`);
    out.push(`  // Pass --dot-max-nodes <n> or --format dot --focus <name> to adjust.`);
    out.push(`  labelloc="t"; fontcolor="#5dffaf"; fontsize=14;`);
    out.push(`  label="CallGraph — anchored on ${escape(focus || "?")} ` +
             `(${nodeNames.size}/${graph.functions.size} nodes shown)";`);
  } else if (focus) {
    out.push("");
    out.push(`  labelloc="t"; fontcolor="#5dffaf"; fontsize=14;`);
    out.push(`  label="CallGraph — entry: ${escape(focus)}";`);
  }

  out.push("}");
  return out.join("\n");
}

function label(name, info) {
  if (!info) return name;
  const tags = [];
  if (info.unresolved) tags.push("?");
  if (info.isAsync) tags.push("async");
  if (info.kind === "constructor") tags.push("ctor");
  return tags.length ? `${name}\\n[${tags.join(",")}]` : name;
}

module.exports = { formatDot };
