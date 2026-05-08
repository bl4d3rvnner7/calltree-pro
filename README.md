# calltree-pro

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14-brightgreen)](https://nodejs.org/)
[![Made with Babel](https://img.shields.io/badge/parser-%40babel%2Fparser-fcc72c)](https://babeljs.io/)

> Reverse-engineer obfuscated JavaScript with one command. Interactive HTML disassembler view (IDA-style), severity-tagged sinks, auto-detected entry points, source-line annotations on unresolved calls.

`calltree-pro` parses your source with Babel, builds a full call graph, classifies suspicious API touchpoints (network, DNS, child-process, crypto, dynamic exec, …), and emits a complete report bundle — including an interactive single-file HTML view designed for analysts working with `obfuscator.io` output and minified malware samples.

![preview](./preview.png)

## Quick start

```bash
git clone https://github.com/YOUR_USERNAME/calltree-pro.git
cd calltree-pro
npm install
node src/cli.js examples/sample.js
```

That generates a `sample_report/` directory with every report at once. Open `sample_report/html.html` in any browser.

To analyze your own file:

```bash
node src/cli.js path/to/suspicious.js
```

## What it produces

One command writes everything into `<filename>_report/`:

| File | What it is |
|---|---|
| `html.html` | **Interactive disassembler view.** Searchable sidebar, IDA-style explorer, forward/back navigation, breadcrumb, severity-colored sinks. Open this first. |
| `report.md` | Full markdown audit. Box-drawing call trees, sinks tables, danger paths, function metrics, unresolved callees with line numbers. |
| `tree.txt` | Plain-text call tree (no ANSI codes, diff-friendly). |
| `json.json` | Machine-readable structured dump. |
| `graph.dot` | Graphviz DOT — top-down, capped at 200 nodes, anchored on the auto-detected primary entry. |
| `graph.<entry>.dot` | Focused 80-node, 3-hop neighborhood around the primary entry. |
| `graph.svg` | Auto-rendered DOT → SVG (if `dot` from graphviz is on PATH). |
| `graph.mermaid.md` | Mermaid flowchart for GitHub markdown. |
| `graph.mmd` | Raw Mermaid source, ready for `mmdc -i graph.mmd -o graph.svg`. |
| `graph.mermaid.svg` | Auto-rendered Mermaid → SVG (if `mmdc` is on PATH). |
| `INDEX.md` | Auto-generated index linking everything. |

The same colored tree streams to your terminal as it runs. After completion the CLI prints install hints for `graphviz` and `@mermaid-js/mermaid-cli` if either is missing.

```
┌─────────────────────────────────────────
│ CALL TREES
└─────────────────────────────────────────

OQh [async]
├── cEf.tryCreate [async]
│   ├── Mc.healthy [async]
│   │   └── dns.resolve4 [unresolved]
│   └── NX0 [async]
│       ├── Buffer.from [unresolved]
│       └── crypto.createVerify [unresolved]
├── fQh [async]
│   ├── K0f.execute [async]
│   │   └── execSync [unresolved]
│   └── vEf.execute [async]
│       ├── exec [unresolved]
│       └── fetch [unresolved]
└── hQh [async]
    └── process.exit [unresolved]
```

## Why

You drop a 6,000-line minified blob from `obfuscator.io` (or a suspicious npm package) into the tool and it tells you:

- Which entry points reach `child_process`, `fetch`, `dns`, `eval`, etc., **and the shortest call chain that gets there**
- What the symbol-mangled functions (`OQh`, `cEf.tryCreate`, `_0x11fbfb`) are connected to
- Hotspots — which functions get called the most (often utilities the obfuscator references everywhere)
- Cycles, dead code, async/generator/private flags, complexity, LOC, fan-in / fan-out
- Every callee that has **no definition** in your source — registered as `[unresolved]` *filler* stubs with the call-site line number, so the tree stays connected even when names come from string-array indirection

## How it differs from existing tools

[`madge`](https://github.com/pahen/madge) and [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) operate at the **module level** — they show which files import which. They're great for codebase architecture but useless on a single-file obfuscated bundle where everything lives in one `.js`.

`calltree-pro` operates at the **function level** inside a file. It traces who calls whom across class methods, prototypes, IIFEs, and arrow functions. The malware-analysis features (sink classification, danger paths, fillers for unresolved names) are designed for the case where you have one suspicious file and want to know what it actually does.

## The HTML view

![explorer view](./preview-explorer.png)

Single-file, no external deps (just Google Fonts CDN). Drop the `html.html` anywhere and double-click.

- **Navbar:** `◄ back`, `forward ►`, `▣ entry` buttons + breadcrumb. `Alt+←` / `Alt+→` shortcuts. `H` jumps to the primary entry. `/` focuses search.
- **Left sidebar:** every function with a category-colored dot. The primary entry is starred (`★`). Type to filter (substring or `/regex/`). Click category chips to toggle.
- **Center tabs:**
  - **Call tree** — clickable forward tree with box-drawing, async/ctor/unresolved badges, sink-category coloring, and source-line annotations (e.g. `dns.resolve4 [unresolved] L2570`).
  - **Callers (reverse)** — same UI for who calls this.
  - **Explorer** — IDA-style 3-column xrefs view: callers │ selected │ callees, each card showing its call-site line.
  - **Overview / Cycles / Dead** — project-wide views.
- **Right panel:** hotspots with bar chart; **sinks reached from the current selection** (shortest BFS path to each dangerous category, as clickable pills); all sinks grouped by category.

## Source line numbers

Every node in every tree shows its line in the source. For **defined** functions that's where the body starts; for **unresolved fillers** (the obfuscator.io case where the parser only sees the call) the line is the call-site, captured from the edge — so `dns.resolve4 L2570` tells you exactly where in the source to look. The function header lists up to 4 call sites for fillers (`called from: file.js:2570:8; file.js:2890:12; ...`).

## Sinks and categories

Every callee is classified into a category:

| Category | What it catches |
|---|---|
| `dynamic_exec` | `eval`, `new Function`, `vm.*` |
| `child_process` | `exec`, `execSync`, `spawn`, `fork`, `child_process.*` |
| `network` | `fetch`, `axios.*`, `http.get/request/post`, `.send`, `WebSocket` |
| `dns` | `dns.*`, `new Resolver` |
| `fs` | `fs.read*`, `fs.write*`, `createWriteStream`, … |
| `env` | `process.env`, `os.homedir`, `os.userInfo`, `os.networkInterfaces`, `process.argv`, … |
| `crypto` | `crypto.create*`, `randomBytes`, `sign`, `verify` |
| `encoding` | `Buffer.from`, `atob`, `btoa` |
| `fingerprint` | `navigator.*` |
| `dom` / `scheduling` / `error` / `control` | (lower-priority categories) |

Each category has a color, an icon, and a severity (`high` / `medium` / `low`). The HTML colors function names by category; the markdown report tags every entry. Add or override rules by editing `src/utils/sinks.js`.

## Filler functions (the obfuscator.io case)

When a function gets called but has no definition — extremely common with `obfuscator.io` output, where names come from a runtime string-array lookup the parser can't follow — the tool registers a **filler** stub:

```text
└── dns.resolve4  [unresolved,dns]  L2570
```

Filler stubs:

- Show up in the call tree, sidebar, and sinks tables
- Get classified by the same regex rules (so `fetch`, `execSync`, etc. are still caught)
- Are tagged `unresolved` everywhere they appear
- Carry the **line number** of every call site that referenced them
- Get a `[?]` marker in the HTML sidebar
- Get a dedicated **"Unresolved callees"** table in `report.md`, sorted by caller count

Your call graph never has dangling edges, even on heavily obfuscated code.

## Graph rendering (DOT and Mermaid)

A naïve dump of every node and edge produces a 20K-pixel SVG that's unreadable. The tool fights this two ways:

1. **Anchor on the primary entry.** All graph output is BFS-bounded around the auto-detected entry function. Default cap is 200 nodes for `graph.dot`, 80 for the focused `graph.<entry>.dot`, 120 for mermaid. Pass `--focus <name>` to anchor on something else.
2. **Auto-render.** If `dot` (graphviz) and/or `mmdc` (`@mermaid-js/mermaid-cli`) are on PATH, the tool runs them and produces `graph.svg` and `graph.mermaid.svg` directly:

   ```bash
   apt install graphviz             # debian / kali / ubuntu
   brew install graphviz            # macOS
   npm i -g @mermaid-js/mermaid-cli # mermaid renderer
   ```

The DOT output is top-down, with the primary entry highlighted in phosphor green (`penwidth=3`), unresolved fillers as dashed boxes, and edges into dangerous sinks colored by category (red for `child_process`/`dynamic_exec`, magenta for `network`/`dns`).

## Defaults

The "all in one shot" run uses analyst-friendly defaults — everything on, no filters:

| Default | Why |
|---|---|
| `--include-builtins` ON  | You want to see calls to `fetch`, `execSync`, `Buffer.from` — those are the dangerous ones |
| `--include-anonymous` ON | Obfuscated code is full of anonymous functions — hiding them hides the graph |
| `--detect-cycles` ON     | Free, useful |
| `--detect-dead` ON       | Helps spot leftover scaffolding |
| `--hotspots 15`          | Top 15 most-called functions |
| `--color` ON             | Terminal output is colored by sink category |
| no `-r` / `-d` / `-i`    | Full enumeration; no root filter, no depth cap, no ignore globs beyond `node_modules` |

Override any with `--no-builtins`, `--no-color`, `-r OQh`, `-d 5`, `-i '**/test/**'`, etc.

## Single-format mode

Want only one report? Use `--format`:

```bash
node src/cli.js suspicious.js --format html   -o report.html
node src/cli.js suspicious.js --format report -o audit.md
node src/cli.js suspicious.js --format dot    -o graph.dot
```

When `--format` is given the output dir is *not* created — only the requested file is emitted.

## Configuration file

Drop a `.calltreerc.json` in the project root to set defaults:

```json
{
  "includeBuiltins": true,
  "includeAnonymous": true,
  "detectCycles": true,
  "detectDead": true,
  "hotspots": 25,
  "ignore": ["**/node_modules/**", "**/dist/**", "**/.next/**"]
}
```

CLI flags override the rc file.

## Programmatic API

```js
const { analyzeProject } = require("calltree-pro");
const { formatReport } = require("calltree-pro/src/formatters/report");

const result = await analyzeProject(["./src/**/*.js"], {
  includeBuiltins: true,
  detectCycles: true,
});

console.log(formatReport(result, { hotspots: 15 }));
console.log(result.graph.shortestPathToCategory("OQh", ["network", "child_process"]));
console.log(result.graph.byCategory().child_process);
```

`result.graph` is a `CallGraph` with these analysis methods:

| Method | Returns |
|---|---|
| `roots()` | Functions with no callers (entry points) |
| `primaryEntry()` | The most "important" entry point (largest reachable subgraph) |
| `cycles()` | Tarjan SCC cycle detection |
| `deadFunctions()` | Defined but never called |
| `hotspots(n)` | Top-N most-called functions with counts |
| `byCategory()` | `{ [category]: FunctionInfo[] }` |
| `shortestPathToCategory(from, cats)` | BFS path to nearest dangerous sink |
| `reachable(from)` | Set of all transitively-reachable function names |
| `fanInOut()` | `Map<name, { fanIn, fanOut }>` |

## Project layout

```
src/
  cli.js                 # commander entry point + all-formats orchestration
  index.js               # analyzeProject (file walking + Babel parsing)
  analyzers/
    file.js              # Babel traversal — qualified names, locations, complexity
    graph.js             # CallGraph + cycles, dead, hotspots, fillers, sinks
  formatters/
    tree.js              # Box-drawing terminal output
    report.js            # Markdown report
    html.js              # Single-file interactive disassembler HTML
    json.js / dot.js / mermaid.js
  utils/
    sinks.js             # Sink classification rules + category metadata
    constants.js
    parser-config.js
examples/
test/
```

## Contributing

Issues and PRs welcome. Please run `npm test` before submitting.

## License

[MIT](./LICENSE)
