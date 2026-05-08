"use strict";

const path = require("path");
const assert = require("assert");

const { analyzeProject } = require("../src/index");
const { formatTree } = require("../src/formatters/tree");
const { formatJson } = require("../src/formatters/json");
const { formatDot } = require("../src/formatters/dot");
const { formatMermaid } = require("../src/formatters/mermaid");
const { formatReport } = require("../src/formatters/report");
const { formatHtml } = require("../src/formatters/html");
const { CallGraph } = require("../src/analyzers/graph");
const { classifyCall } = require("../src/utils/sinks");

const sample = path.join(__dirname, "..", "examples", "sample.js");
const utils = path.join(__dirname, "..", "examples", "utils.js");

const baseConfig = {
  ignore: ["**/node_modules/**"],
  includeBuiltins: true,
  includeAnonymous: true,
  showLocations: false,
  detectCycles: true,
  detectDead: true,
  hotspots: 5,
  maxDepth: 100,
  noColor: true,
};

(async () => {
  // ---- 1. End-to-end analysis on the bundled examples ----
  console.log("[test] analyzing examples...");
  const result = await analyzeProject([sample, utils], baseConfig);

  assert.ok(result.stats.fileCount === 2, "should analyze 2 files");
  assert.ok(result.stats.functionCount > 5, "should find multiple functions");
  assert.ok(result.stats.callCount > 5, "should find multiple call edges");
  console.log(
    `[test] OK: ${result.stats.fileCount} files, ` +
      `${result.stats.functionCount} fns, ${result.stats.callCount} calls`,
  );

  const cycles = result.graph.cycles();
  const flat = cycles.flat();
  assert.ok(
    flat.includes("isEven") && flat.includes("isOdd"),
    "should detect isEven<->isOdd cycle",
  );
  console.log("[test] OK: detected mutual recursion");

  assert.ok(
    cycles.some((c) => c.length === 1 && c[0] === "factorial"),
    "should detect factorial self-recursion",
  );
  console.log("[test] OK: detected self-recursion");

  // ---- 2. All formatters run without throwing ----
  const tree = formatTree(result, baseConfig);
  assert.ok(tree.includes("ROOT FUNCTIONS"), "tree has ROOT section");
  assert.ok(tree.includes("SINKS BY CATEGORY"), "tree has new sinks section");
  console.log("[test] OK: tree formatter");

  const json = JSON.parse(formatJson(result, baseConfig));
  assert.ok(json.functions && json.edges.length > 0, "json complete");
  console.log("[test] OK: json formatter");

  assert.ok(formatDot(result, baseConfig).includes("digraph"), "dot ok");
  console.log("[test] OK: dot formatter");

  assert.ok(formatMermaid(result, baseConfig).includes("flowchart"), "mermaid ok");
  console.log("[test] OK: mermaid formatter");

  const report = formatReport(result, baseConfig);
  assert.ok(report.includes("# Call Graph Report"), "report header");
  assert.ok(report.includes("Hotspots"), "report has hotspots");
  assert.ok(report.includes("Sinks by category"), "report has sinks table");
  assert.ok(report.includes("Shortest path"), "report has danger paths section");
  console.log("[test] OK: report formatter");

  const html = formatHtml(result, baseConfig);
  assert.ok(html.startsWith("<!doctype html>"), "html doctype");
  assert.ok(html.includes("CALLTREE//PRO"), "html has logo");
  assert.ok(html.includes('const DATA = {'), "html data injection");
  assert.ok(!html.includes("__DATA__"), "html template marker replaced");
  console.log("[test] OK: html formatter");

  // ---- 3. Sinks classifier ----
  assert.deepStrictEqual(
    classifyCall("execSync"),
    { category: "child_process", severity: "high" },
    "execSync classified",
  );
  assert.deepStrictEqual(
    classifyCall("fetch"),
    { category: "network", severity: "high" },
    "fetch classified",
  );
  assert.deepStrictEqual(
    classifyCall("dns.resolve4"),
    { category: "dns", severity: "high" },
    "dns classified",
  );
  assert.deepStrictEqual(
    classifyCall("eval"),
    { category: "dynamic_exec", severity: "high" },
    "eval classified",
  );
  assert.strictEqual(classifyCall("myUserFn"), null, "user fns unclassified");
  console.log("[test] OK: sinks classifier");

  // ---- 4. fillUnresolved + analytics on a synthetic graph ----
  const g = new CallGraph();
  function fn(name, opts = {}) {
    g.registerFunction({
      name,
      kind: opts.kind || "function",
      isAsync: !!opts.isAsync,
      isGenerator: false,
      isStatic: false,
      isPrivate: false,
      loc: opts.loc || 1,
      complexity: opts.cx || 1,
      locations: [{ file: "a.js", line: opts.line || 1, column: 0 }],
    });
  }
  fn("OQh", { isAsync: true, line: 100 });
  fn("hQh", { isAsync: true, line: 200 });
  fn("Bf.error", { line: 50 });
  g.addEdge("OQh", "hQh", { file: "a.js", line: 110, column: 0 });
  g.addEdge("hQh", "execSync", { file: "a.js", line: 210, column: 5 });
  g.addEdge("OQh", "fetch", { file: "a.js", line: 120, column: 5 });

  // execSync and fetch are NOT defined yet
  assert.ok(!g.functions.has("execSync"), "before fill: no filler");

  g.fillUnresolved();

  assert.ok(g.functions.has("execSync"), "after fill: filler created");
  const exec = g.functions.get("execSync");
  assert.strictEqual(exec.unresolved, true, "filler is marked unresolved");
  assert.strictEqual(exec.category, "child_process", "filler classified");
  // NEW: filler should have the call-site line, not be empty
  assert.strictEqual(exec.locations[0].line, 210, "filler picked up call-site line");
  console.log("[test] OK: filler call-site line numbers");

  // shortestPathToCategory finds the danger path
  const path1 = g.shortestPathToCategory("OQh", ["child_process"]);
  assert.deepStrictEqual(path1, ["OQh", "hQh", "execSync"], "BFS path");
  console.log("[test] OK: fillUnresolved + shortestPathToCategory");

  // primaryEntry — picks OQh because it reaches more nodes than Bf.error
  assert.strictEqual(g.primaryEntry(), "OQh", "primaryEntry picks largest reachable root");
  console.log("[test] OK: primaryEntry");

  // byCategory groups
  const groups = g.byCategory();
  assert.ok(groups.child_process.length === 1);
  assert.ok(groups.network.length === 1);
  console.log("[test] OK: byCategory");

  // fanInOut
  const fan = g.fanInOut();
  assert.strictEqual(fan.get("OQh").fanOut, 2);
  assert.strictEqual(fan.get("hQh").fanIn, 1);
  console.log("[test] OK: fanInOut");

  // ---- 5. Dot/Mermaid: anchored, capped, top-down ----
  const result2 = { graph: g, files: ["a.js"], parseErrors: [],
    stats: { fileCount: 1, functionCount: g.functions.size, callCount: g.totalEdges(), parseErrors: 0 } };
  const { formatDot } = require("../src/formatters/dot");
  const { formatMermaid } = require("../src/formatters/mermaid");
  const dot = formatDot(result2, {});
  assert.ok(dot.includes('rankdir="TB"'), "dot is top-down");
  assert.ok(dot.includes("penwidth=3"), "dot has highlighted entry");
  assert.ok(dot.includes("CallGraph — entry: OQh"), "dot has entry label");
  console.log("[test] OK: dot anchored & top-down");

  const mmd = formatMermaid(result2, {});
  assert.ok(mmd.includes("flowchart TD"), "mermaid is top-down");
  assert.ok(mmd.includes("classDef entry"), "mermaid has entry class");
  console.log("[test] OK: mermaid anchored");

  // ---- 6. HTML has navigation features ----
  const { formatHtml } = require("../src/formatters/html");
  const html2 = formatHtml(result2, baseConfig);
  assert.ok(html2.includes("btn-back"), "html has back button");
  assert.ok(html2.includes("btn-forward"), "html has forward button");
  assert.ok(html2.includes("renderExplorer"), "html has explorer renderer");
  assert.ok(html2.includes("breadcrumb"), "html has breadcrumb");
  assert.ok(html2.includes("navTo"), "html has navTo function");
  console.log("[test] OK: html has navigation + explorer");

  console.log("\nAll tests passed ✓");
})().catch((err) => {
  console.error("[test] FAILED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
