"use strict";

const { CATEGORY_META } = require("../utils/sinks");

function nodeId(name, idMap) {
  if (idMap.has(name)) return idMap.get(name);
  const id = "n" + idMap.size;
  idMap.set(name, id);
  return id;
}

function escapeLabel(s) {
  return s.replace(/"/g, "#quot;").replace(/[\[\]]/g, "");
}

function formatMermaid(result, config = {}) {
  const { graph } = result;
  const idMap = new Map();
  const out = [];

  const focus = config.focus || config.root || graph.primaryEntry();
  const maxNodes = config.maxNodes ?? 150;

  // BFS-rank by distance from focus
  let nodes;
  if (focus) {
    const dist = new Map([[focus, 0]]);
    const q = [focus];
    while (q.length) {
      const n = q.shift();
      const d = dist.get(n);
      const fwd = graph.forward.get(n);
      if (fwd) for (const next of fwd.keys()) {
        if (!dist.has(next)) { dist.set(next, d + 1); q.push(next); }
      }
      const rev = graph.reverse.get(n);
      if (rev) for (const prev of rev) {
        if (!dist.has(prev)) { dist.set(prev, d + 1); q.push(prev); }
      }
    }
    if (graph.functions.size > maxNodes) {
      const sorted = [...dist.entries()].sort((a, b) => a[1] - b[1]);
      nodes = new Set(sorted.slice(0, maxNodes).map(([n]) => n));
    } else {
      nodes = new Set(dist.keys());
    }
  } else {
    nodes = new Set([
      ...[...graph.functions.keys()].slice(0, maxNodes),
      ...graph.forward.keys(),
    ]);
  }

  out.push("```mermaid");
  out.push("flowchart TD");

  // Render nodes
  for (const name of nodes) {
    const info = graph.functions.get(name);
    const id = nodeId(name, idMap);
    const shape =
      info?.kind === "constructor"
        ? `${id}[["${escapeLabel(name)}"]]`
        : info?.isAsync
        ? `${id}(("${escapeLabel(name)}"))`
        : `${id}["${escapeLabel(name)}"]`;
    out.push("  " + shape);
  }

  // Render edges
  for (const [from, callees] of graph.forward) {
    if (!nodes.has(from)) continue;
    for (const [to, edge] of callees) {
      if (!nodes.has(to)) continue;
      const fromId = nodeId(from, idMap);
      const toId = nodeId(to, idMap);
      const lbl = edge.count > 1 ? `|×${edge.count}|` : "";
      out.push(`  ${fromId} -->${lbl} ${toId}`);
    }
  }

  // Class styling (sink categories)
  const cats = ["network", "dns", "child_process", "dynamic_exec", "fs", "env", "crypto"];
  for (const cat of cats) {
    const meta = CATEGORY_META[cat];
    out.push(`  classDef ${cat} fill:#161e21,stroke:${meta.color},color:${meta.color};`);
  }
  if (focus) {
    out.push(`  classDef entry fill:#0a2014,stroke:#5dffaf,stroke-width:3px,color:#5dffaf;`);
  }
  out.push(`  classDef unresolved fill:#0f1416,stroke:#6a7c80,color:#6a7c80,stroke-dasharray: 3 3;`);

  for (const name of nodes) {
    const info = graph.functions.get(name);
    const id = idMap.get(name);
    if (focus && name === focus) out.push(`  class ${id} entry;`);
    else if (info?.unresolved) out.push(`  class ${id} unresolved;`);
    else if (info?.category && cats.includes(info.category)) {
      out.push(`  class ${id} ${info.category};`);
    }
  }

  if (nodes.size < graph.functions.size) {
    out.push(`  %% Showing ${nodes.size} of ${graph.functions.size} nodes ` +
             `— closest BFS neighbors of "${focus}".`);
  }

  out.push("```");
  return out.join("\n");
}

module.exports = { formatMermaid };
