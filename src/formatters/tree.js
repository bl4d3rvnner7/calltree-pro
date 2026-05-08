"use strict";

let pc;
try {
  pc = require("picocolors");
} catch {
  pc = null;
}

const { CATEGORY_META } = require("../utils/sinks");

const noColor = new Proxy(
  function (s) { return s; },
  { get() { return noColor; } },
);

const BOX = {
  branch:  "├── ",
  last:    "└── ",
  vert:    "│   ",
  empty:   "    ",
  recurse: "↩",
  cycle:   "↻",
  dead:    "✗",
};

function formatTree(result, config) {
  const { graph } = result;
  const useColor =
    pc &&
    config.color !== false &&
    !config.noColor &&
    (process.stdout.isTTY || config.forceColor);
  const c = useColor ? pc : noColor;

  const out = [];

  const roots = config.root
    ? [graph.resolve(config.root) || config.root]
    : graph.roots();

  banner(c, out, "cyan", "ROOT FUNCTIONS");
  for (const r of roots) out.push("  " + decorateName(graph, r, c, config));

  banner(c, out, "cyan", "CALL TREES");
  for (const root of roots) {
    out.push("");
    out.push(c.dim("─".repeat(60)));
    renderTree(graph, root, "", true, true, new Set(), config, c, out);
  }

  if (config.detectCycles) {
    banner(c, out, "yellow", "CYCLES");
    const cycles = graph.cycles();
    if (cycles.length === 0) out.push(c.dim("  (none)"));
    else for (const cycle of cycles) {
      out.push("  " + c.yellow(BOX.cycle + " ") + cycle.join(" → "));
    }
  }

  if (config.detectDead) {
    banner(c, out, "magenta", "UNCALLED FUNCTIONS");
    const dead = graph
      .deadFunctions()
      .filter((n) => !roots.includes(n) && !n.startsWith("<top-level"));
    if (dead.length === 0) out.push(c.dim("  (none)"));
    else for (const d of dead) out.push("  " + c.magenta(BOX.dead + " ") + d);
  }

  if (config.hotspots > 0) {
    banner(c, out, "green", `TOP ${config.hotspots} HOTSPOTS`);
    const hot = graph.hotspots(config.hotspots);
    const max = hot[0]?.count || 1;
    const nameWidth = Math.max(...hot.map((h) => h.name.length), 1);
    for (const { name, count } of hot) {
      const bar = "█".repeat(Math.max(1, Math.round((count / max) * 24)));
      const cat = graph.functions.get(name)?.category || "unknown";
      const meta = CATEGORY_META[cat] || CATEGORY_META.unknown;
      const tag = c.dim(`[${meta.label}]`);
      out.push(
        `  ${c.green(bar.padEnd(24))} ` +
          `${count.toString().padStart(4)}  ` +
          `${name.padEnd(nameWidth)}  ${tag}`,
      );
    }
  }

  banner(c, out, "red", "SINKS BY CATEGORY");
  const groups = graph.byCategory();
  const interestingCats = [
    "dynamic_exec", "child_process", "network", "dns",
    "fs", "env", "crypto", "encoding", "fingerprint",
  ];
  let any = false;
  for (const cat of interestingCats) {
    if (!groups[cat] || !groups[cat].length) continue;
    any = true;
    const meta = CATEGORY_META[cat];
    out.push(`  ${meta.icon} ${c.bold(meta.label)} ` +
      c.dim(`(${groups[cat].length})`));
    for (const info of groups[cat]) {
      const callers = graph.reverse.get(info.name)?.size || 0;
      out.push(
        "    " + decorateName(graph, info.name, c, config) +
        c.dim(`  callers=${callers}`),
      );
    }
  }
  if (!any) out.push(c.dim("  (no sinks detected)"));

  if (result.parseErrors.length) {
    banner(c, out, "red", `PARSE ERRORS (${result.parseErrors.length})`);
    for (const err of result.parseErrors) {
      out.push("  " + c.red("!") + " " + err.file);
      out.push("    " + c.dim(err.message));
    }
  }

  return out.join("\n");
}

function banner(c, out, color, title) {
  out.push("");
  const fn = c[color] || ((s) => s);
  out.push(fn(c.bold("┌─────────────────────────────────────────")));
  out.push(fn(c.bold("│ " + title)));
  out.push(fn(c.bold("└─────────────────────────────────────────")));
  out.push("");
}

function renderTree(graph, name, prefix, isLast, isRoot, visited, config, c, out) {
  if (prefix.length / 4 > config.maxDepth) {
    out.push(prefix + (isLast ? BOX.last : BOX.branch) + c.dim("… (max depth)"));
    return;
  }
  const resolved = graph.resolve(name) || name;
  const connector = isRoot ? "" : (isLast ? BOX.last : BOX.branch);
  const nextPrefix = isRoot ? "" : prefix + (isLast ? BOX.empty : BOX.vert);

  if (visited.has(resolved)) {
    out.push(prefix + connector + c.yellow(BOX.recurse + " " + resolved));
    return;
  }

  out.push(prefix + connector + decorateName(graph, resolved, c, config));

  const callees = graph.forward.get(resolved);
  if (!callees) return;

  visited.add(resolved);
  const sorted = [...callees.keys()].sort();
  sorted.forEach((callee, i) => {
    const last = i === sorted.length - 1;
    renderTree(
      graph, callee, nextPrefix, last, false,
      new Set(visited), config, c, out,
    );
  });
}

function decorateName(graph, name, c, config) {
  const info = graph.functions.get(name);
  let label = name;

  if (info) {
    const tags = [];
    if (info.unresolved) tags.push("unresolved");
    if (info.isAsync) tags.push("async");
    if (info.isGenerator) tags.push("gen");
    if (info.isPrivate) tags.push("private");
    if (info.kind === "constructor") tags.push("ctor");
    if (info.kind === "getter") tags.push("get");
    if (info.kind === "setter") tags.push("set");
    if (tags.length) label += " " + c.dim(`[${tags.join(",")}]`);

    const cat = info.category || "unknown";
    if (cat === "dynamic_exec" || cat === "child_process") {
      label = c.red(label);
    } else if (cat === "network" || cat === "dns") {
      label = c.magenta(label);
    } else if (cat === "fs" || cat === "env" || cat === "crypto") {
      label = c.yellow(label);
    } else if (info.unresolved) {
      label = c.dim(label);
    }

    if (config.showLocations && info.locations[0]) {
      const { file, line: ln, column } = info.locations[0];
      label += " " + c.dim(`(${shorten(file)}:${ln}:${column})`);
    }
  } else if (name.startsWith("new ")) {
    label = c.cyan(name);
  } else if (name.startsWith("<")) {
    label = c.dim(name);
  }

  return label;
}

function shorten(file) {
  const cwd = process.cwd();
  if (file.startsWith(cwd)) return "." + file.slice(cwd.length);
  return file;
}

module.exports = { formatTree };
