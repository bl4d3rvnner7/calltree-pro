#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Command } = require("commander");

let pc;
try {
  pc = require("picocolors");
} catch {
  const id = (s) => s;
  pc = new Proxy(id, { get: () => id });
}

const { analyzeProject } = require("./index");
const { formatTree } = require("./formatters/tree");
const { formatJson } = require("./formatters/json");
const { formatDot } = require("./formatters/dot");
const { formatMermaid } = require("./formatters/mermaid");
const { formatReport } = require("./formatters/report");
const { formatHtml } = require("./formatters/html");

const FORMATTERS = {
  tree:    { fn: formatTree,    ext: "txt"  },
  json:    { fn: formatJson,    ext: "json" },
  dot:     { fn: formatDot,     ext: "dot"  },
  mermaid: { fn: formatMermaid, ext: "md"   },
  report:  { fn: formatReport,  ext: "md"   },
  html:    { fn: formatHtml,    ext: "html" },
};

function loadRc(cwd) {
  for (const file of [path.join(cwd, ".calltreerc.json"), path.join(cwd, ".calltreerc")]) {
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        console.error(pc.red(`Failed to parse ${path.basename(file)}: ${err.message}`));
        process.exit(1);
      }
    }
  }
  return {};
}

const program = new Command();

program
  .name("calltree")
  .description("Advanced static call-tree analyzer for JS/TS projects (Babel-based).")
  .version("2.0.0")
  .argument("<inputs...>", "files, directories, or globs to analyze")
  .option("-f, --format <type>", "single format: tree|json|dot|mermaid|report|html (omit for ALL)")
  .option("-o, --output <path>", "single-format mode: file path. Otherwise: directory name")
  .option("--no-all", "do not auto-generate all formats when --format is omitted")
  .option("-r, --root <name>", "show only the tree starting at this function")
  .option("-d, --max-depth <n>", "max recursion depth when printing trees", (v) => parseInt(v, 10), Infinity)
  .option("-i, --ignore <patterns>", "comma-separated globs to ignore", (v) =>
    v.split(",").map((s) => s.trim()).filter(Boolean))
  .option("--no-builtins", "exclude calls to console.log/Math.*/.map etc. (default: included)")
  .option("--no-anonymous", "hide <anonymous> functions (default: shown)")
  .option("--show-locations", "include file:line:col next to each function")
  .option("--no-detect-cycles", "skip cycle detection (default: on)")
  .option("--no-detect-dead", "skip dead-code detection (default: on)")
  .option("--hotspots <n>", "show top-N most-called functions (default: 15)", (v) => parseInt(v, 10), 15)
  .option("--no-color", "disable ANSI color in tree output")
  .option("--quiet", "suppress info logs to stderr", false)
  .parse(process.argv);

const opts = program.opts();
const inputs = program.args;

// SMART DEFAULTS — the user wants a one-shot "give me everything" run.
// `--no-foo` flags above flip these off; otherwise they default ON.
const rc = loadRc(process.cwd());
const config = {
  // include everything by default
  includeBuiltins:  opts.builtins !== false,
  includeAnonymous: opts.anonymous !== false,
  detectCycles:     opts.detectCycles !== false,
  detectDead:       opts.detectDead !== false,
  hotspots:         opts.hotspots ?? 15,
  showLocations:    opts.showLocations || false,
  noColor:          opts.color === false,
  // tree depth & filters off by default — full enumeration
  root:             opts.root || null,
  maxDepth:         Number.isFinite(opts.maxDepth) ? opts.maxDepth : Infinity,
  ignore:           opts.ignore || ["**/node_modules/**"],
  format:           opts.format || null,
  output:           opts.output || null,
  quiet:            opts.quiet || false,
  inputs,
  // Explicit force-color flag for when writing to a file but you want
  // ANSI codes preserved (we don't use it by default).
  forceColor:       false,
  // RC overrides (CLI flags take precedence)
  ...rc,
};
// CLI args still win after rc spread:
Object.assign(config, {
  format: opts.format || rc.format || null,
  output: opts.output || null,
  inputs,
});

(async () => {
  if (!config.quiet) {
    console.error(pc.dim(`calltree: analyzing ${inputs.length} input(s)...`));
  }

  let result;
  try {
    result = await analyzeProject(inputs, config);
  } catch (err) {
    console.error(pc.red(`Analysis failed: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }

  if (!config.quiet) {
    console.error(
      pc.dim(
        `calltree: parsed ${result.stats.fileCount} files, ` +
          `${result.stats.functionCount} functions, ` +
          `${result.stats.callCount} calls ` +
          `(${result.stats.parseErrors} parse errors)`,
      ),
    );
  }

  // ---- Single-format mode: original behavior ----
  if (config.format) {
    const formatter = FORMATTERS[config.format];
    if (!formatter) {
      console.error(
        pc.red(`Unknown format: ${config.format}. ` +
          `Use one of: ${Object.keys(FORMATTERS).join(", ")}`),
      );
      process.exit(1);
    }
    const out = formatter.fn(result, config);
    if (config.output) {
      fs.writeFileSync(config.output, out);
      if (!config.quiet) console.error(pc.green(`✓ wrote ${config.output}`));
    } else {
      process.stdout.write(out);
      if (!out.endsWith("\n")) process.stdout.write("\n");
    }
    return;
  }

  // ---- All-formats mode (default) ----
  // Output goes into <inputfilename>_report/  (e.g. newest.js → newest_report/)
  const firstInput = inputs[0];
  const baseName = path
    .basename(firstInput)
    .replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/i, "")
    .replace(/[^\w.-]/g, "_");
  const outDir = config.output || `${baseName}_report`;

  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  const primary = result.graph.primaryEntry();

  // Single-page formatters always run
  const single = [
    { name: "tree",    file: "tree.txt",         fn: formatTree,    cfg: { ...config, noColor: true } },
    { name: "json",    file: "json.json",        fn: formatJson,    cfg: config },
    { name: "report",  file: "report.md",        fn: formatReport,  cfg: config },
    { name: "html",    file: "html.html",        fn: formatHtml,    cfg: config },
  ];
  for (const s of single) {
    const out = s.fn(result, s.cfg);
    const fp  = path.join(outDir, s.file);
    fs.writeFileSync(fp, out);
    written.push(fp);
  }

  // Dot output: full (capped at 200 nodes by default) + focused on primary entry
  const dotFull = formatDot(result, { ...config, maxNodes: 200 });
  fs.writeFileSync(path.join(outDir, "graph.dot"), dotFull);
  written.push(path.join(outDir, "graph.dot"));

  if (primary) {
    const dotFocus = formatDot(result, { ...config, focus: primary, maxNodes: 80, maxHops: 3 });
    fs.writeFileSync(path.join(outDir, `graph.${safeName(primary)}.dot`), dotFocus);
    written.push(path.join(outDir, `graph.${safeName(primary)}.dot`));
  }

  // Mermaid output: focused on primary entry (mermaid struggles with > ~150 nodes)
  const mmdContent = formatMermaid(result, { ...config, focus: primary, maxNodes: 120 });
  fs.writeFileSync(path.join(outDir, "graph.mermaid.md"), mmdContent);
  written.push(path.join(outDir, "graph.mermaid.md"));

  // Raw .mmd for mmdc to consume (no markdown fence)
  const mmdRaw = mmdContent
    .replace(/^```mermaid\n?/, "")
    .replace(/\n?```$/, "");
  fs.writeFileSync(path.join(outDir, "graph.mmd"), mmdRaw);
  written.push(path.join(outDir, "graph.mmd"));

  // Auto-render to SVG: graphviz `dot` for the dot file, mmdc for mermaid.
  // Both are best-effort — failures don't break the run.
  await maybeRenderSvg(
    "dot",
    ["-Tsvg", path.join(outDir, "graph.dot"), "-o", path.join(outDir, "graph.svg")],
    written,
    path.join(outDir, "graph.svg"),
    config.quiet,
  );

  if (primary) {
    await maybeRenderSvg(
      "dot",
      ["-Tsvg",
        path.join(outDir, `graph.${safeName(primary)}.dot`),
        "-o", path.join(outDir, `graph.${safeName(primary)}.svg`)],
      written,
      path.join(outDir, `graph.${safeName(primary)}.svg`),
      config.quiet,
    );
  }

  await maybeRenderSvg(
    "mmdc",
    ["-i", path.join(outDir, "graph.mmd"),
     "-o", path.join(outDir, "graph.mermaid.svg"),
     "-b", "transparent"],
    written,
    path.join(outDir, "graph.mermaid.svg"),
    config.quiet,
  );

  // Also: a top-level INDEX.md so opening the directory gives an overview
  const indexMd = buildIndex(outDir, written, result, primary);
  fs.writeFileSync(path.join(outDir, "INDEX.md"), indexMd);
  written.push(path.join(outDir, "INDEX.md"));

  // Print colored tree to stdout too (so the user sees something live)
  if (!config.quiet) {
    process.stdout.write(formatTree(result, config));
    if (!process.stdout.toString().endsWith("\n")) process.stdout.write("\n");

    console.error("");
    if (primary) {
      console.error(pc.bold(pc.green(`★ Primary entry: `)) + pc.bold(primary));
    }
    console.error(pc.bold(pc.green(`✓ generated ${written.length} files in ${outDir}/`)));
    for (const f of written) {
      console.error("  " + pc.dim("→ ") + f);
    }
    console.error("");
    console.error(pc.dim("  Open the HTML report:"));
    console.error("  " + pc.cyan(`xdg-open ${path.join(outDir, "html.html")}`));
    console.error("  " + pc.dim("  or  ") + pc.cyan(`open ${path.join(outDir, "html.html")}`) + pc.dim("  (macOS)"));
    if (!hasCmd("dot")) {
      console.error("");
      console.error(pc.dim("  Tip: install graphviz to auto-render graph.svg from graph.dot:"));
      console.error("  " + pc.cyan("apt install graphviz   # debian/kali"));
      console.error("  " + pc.cyan("brew install graphviz  # macos"));
    }
    if (!hasCmd("mmdc")) {
      console.error("");
      console.error(pc.dim("  Tip: install @mermaid-js/mermaid-cli to auto-render graph.mermaid.svg:"));
      console.error("  " + pc.cyan("npm i -g @mermaid-js/mermaid-cli"));
    }
  }
})();

function safeName(name) {
  return name.replace(/[^\w-]/g, "_").slice(0, 80);
}

function hasCmd(cmd) {
  const { spawnSync } = require("child_process");
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}

async function maybeRenderSvg(cmd, args, written, outPath, quiet) {
  if (!hasCmd(cmd)) return;
  const { spawnSync } = require("child_process");
  const r = spawnSync(cmd, args, { stdio: quiet ? "ignore" : "pipe" });
  if (r.status === 0 && fs.existsSync(outPath)) {
    written.push(outPath);
  } else if (!quiet) {
    process.stderr.write(pc.dim(`  (skipped ${outPath} — ${cmd} ` +
      (r.status === 0 ? "produced no output" : `exited ${r.status}`) + ")\n"));
  }
}

function buildIndex(outDir, files, result, primaryEntry) {
  const lines = [];
  lines.push("# Call-tree report");
  lines.push("");
  lines.push(`Generated by **calltree-pro** on ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`- **Files analyzed:** ${result.stats.fileCount}`);
  lines.push(`- **Functions found:** ${result.stats.functionCount}`);
  lines.push(`- **Call edges:** ${result.stats.callCount}`);
  lines.push(`- **Parse errors:** ${result.stats.parseErrors}`);
  if (primaryEntry) {
    lines.push(`- **Primary entry point:** \`${primaryEntry}\` (auto-detected)`);
  }
  lines.push("");
  lines.push("## Reports in this directory");
  lines.push("");
  lines.push("| File | What it is |");
  lines.push("|---|---|");
  lines.push("| [`html.html`](./html.html) | Interactive disassembler-style report with forward/back navigation, breadcrumb, IDA-style explorer view, and per-call-site source line numbers. **Open this first.** |");
  lines.push("| [`report.md`](./report.md) | Full markdown audit with box-drawing call trees, sinks tables, danger paths, function metrics. |");
  lines.push("| [`tree.txt`](./tree.txt) | Plain-text call tree (no ANSI codes). |");
  lines.push("| [`json.json`](./json.json) | Machine-readable structured dump. |");
  lines.push("| [`graph.dot`](./graph.dot) | Graphviz DOT — capped at 200 nodes, anchored on the primary entry. |");
  if (primaryEntry) {
    const safe = primaryEntry.replace(/[^\w-]/g, "_").slice(0, 80);
    lines.push(`| [\`graph.${safe}.dot\`](./graph.${safe}.dot) | Focused 80-node, 3-hop neighborhood around \`${primaryEntry}\`. |`);
  }
  lines.push("| [`graph.mermaid.md`](./graph.mermaid.md) | Mermaid flowchart for GitHub markdown. |");
  lines.push("| [`graph.mmd`](./graph.mmd) | Raw Mermaid source, ready for `mmdc -i graph.mmd -o graph.svg`. |");
  lines.push("| [`graph.svg`](./graph.svg) | Auto-rendered DOT → SVG (only present if `dot` is on PATH). |");
  lines.push("| [`graph.mermaid.svg`](./graph.mermaid.svg) | Auto-rendered Mermaid → SVG (only present if `mmdc` is on PATH). |");
  lines.push("");
  lines.push("## Quick navigation");
  lines.push("");
  if (primaryEntry) {
    lines.push(`- **Start at the entry point:** click the ★ \`${primaryEntry}\` in the sidebar of \`html.html\` (it's auto-selected on load).`);
  }
  lines.push("- **Drill into a callee:** click it in any tree → use **◄ back** in the navbar to return.");
  lines.push("- **Severity overview:** the right panel of \`html.html\` shows the shortest path to every dangerous sink reachable from your selection.");
  lines.push("- **Source lines:** unresolved callees show the exact line in the source where they're invoked (e.g. `dns.resolve4 L1234`). Hover the function header for full file:line:column.");
  lines.push("- **Render the SVG manually:** `dot -Tsvg graph.dot -o graph.svg` or `mmdc -i graph.mmd -o graph.svg`.");
  lines.push("");
  return lines.join("\n");
}
