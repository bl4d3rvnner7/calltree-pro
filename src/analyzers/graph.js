"use strict";

const { classifyCall } = require("../utils/sinks");

/**
 * CallGraph stores:
 *  - functions: Map<qualifiedName, FunctionInfo>
 *  - forward:   Map<qualifiedName, Map<calleeName, EdgeInfo>>
 *  - reverse:   Map<qualifiedName, Set<callerName>>
 *
 * A "qualified name" is something like:
 *   "myFunction"
 *   "MyClass.method"
 *   "MyClass#privateMethod"
 *   "<anonymous@/path/to/file.js:12:4>"
 *
 * EdgeInfo tracks call sites (line/col + count) so we can show locations
 * and avoid double-counting trivially.
 */
class CallGraph {
  constructor() {
    /** @type {Map<string, FunctionInfo>} */
    this.functions = new Map();
    /** @type {Map<string, Map<string, EdgeInfo>>} */
    this.forward = new Map();
    /** @type {Map<string, Set<string>>} */
    this.reverse = new Map();
  }

  registerFunction(info) {
    if (!this.functions.has(info.name)) {
      this.functions.set(info.name, info);
    } else {
      const existing = this.functions.get(info.name);
      existing.locations.push(...info.locations);
      // Promote: if the existing was a filler and we now have real info,
      // keep the locations and overwrite everything else.
      if (existing.unresolved && !info.unresolved) {
        Object.assign(existing, info);
      }
    }
  }

  addEdge(from, to, location) {
    if (!from || !to) return;

    if (!this.forward.has(from)) this.forward.set(from, new Map());
    const callees = this.forward.get(from);
    if (!callees.has(to)) {
      callees.set(to, { count: 0, locations: [] });
    }
    const edge = callees.get(to);
    edge.count++;
    if (location) edge.locations.push(location);

    if (!this.reverse.has(to)) this.reverse.set(to, new Set());
    this.reverse.get(to).add(from);
  }

  totalEdges() {
    let n = 0;
    for (const callees of this.forward.values()) {
      for (const edge of callees.values()) n += edge.count;
    }
    return n;
  }

  // -------- Queries ----------------------------------------------------

  /**
   * Functions with no callers in the graph. These are entry points / roots.
   */
  roots() {
    const out = [];
    for (const name of this.functions.keys()) {
      const incoming = this.reverse.get(name);
      if (!incoming || incoming.size === 0) out.push(name);
    }
    // Also include any caller that has outgoing edges but is not itself
    // a defined function (e.g. "<root>" — top-level code).
    for (const caller of this.forward.keys()) {
      if (
        !this.functions.has(caller) &&
        !this.reverse.has(caller)
      ) {
        out.push(caller);
      }
    }
    return [...new Set(out)].sort();
  }

  /**
   * Defined functions never called anywhere in the analyzed code.
   * Excludes roots and exported names (we can't tell exports for free,
   * so we just report and let the user filter).
   */
  deadFunctions() {
    const dead = [];
    for (const name of this.functions.keys()) {
      const incoming = this.reverse.get(name);
      if (!incoming || incoming.size === 0) {
        // Not called by anyone — but maybe it's the entry point.
        // We mark it dead only if it also has no body that calls things.
        // Practically: report all such functions; user filters.
        dead.push(name);
      }
    }
    return dead.sort();
  }

  /**
   * Find recursive cycles using Tarjan's strongly-connected-components.
   * Returns array of arrays — each inner array is a cycle.
   */
  cycles() {
    const index = new Map();
    const lowlink = new Map();
    const onStack = new Set();
    const stack = [];
    const result = [];
    let counter = 0;

    const nodes = new Set([
      ...this.forward.keys(),
      ...this.reverse.keys(),
    ]);

    const strongConnect = (v) => {
      index.set(v, counter);
      lowlink.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);

      const successors = this.forward.get(v);
      if (successors) {
        for (const w of successors.keys()) {
          if (!nodes.has(w)) continue;
          if (!index.has(w)) {
            strongConnect(w);
            lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
          } else if (onStack.has(w)) {
            lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
          }
        }
      }

      if (lowlink.get(v) === index.get(v)) {
        const scc = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        // Only report SCCs that are real cycles (size > 1, or self-loop)
        if (scc.length > 1) {
          result.push(scc);
        } else {
          const self = scc[0];
          if (this.forward.get(self)?.has(self)) {
            result.push(scc);
          }
        }
      }
    };

    for (const v of nodes) {
      if (!index.has(v)) strongConnect(v);
    }

    return result;
  }

  /**
   * Top-N most-called functions across the whole graph.
   */
  hotspots(n = 10) {
    const totals = new Map();
    for (const callees of this.forward.values()) {
      for (const [callee, edge] of callees) {
        totals.set(callee, (totals.get(callee) || 0) + edge.count);
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));
  }

  /**
   * Resolve a free-text name to a qualified name when possible:
   *   "foo" -> "foo" if defined
   *   "foo" -> "MyClass.foo" if uniquely matched
   *   "this.bar" / "Class.bar" -> "Class.bar"
   */
  resolve(name) {
    if (!name) return null;
    if (this.forward.has(name) || this.functions.has(name)) return name;

    const last = name.split(".").pop();
    if (this.forward.has(last) || this.functions.has(last)) return last;

    const all = [
      ...new Set([...this.forward.keys(), ...this.functions.keys()]),
    ];
    const matches = all.filter((x) => x.endsWith("." + last) || x.endsWith("#" + last));
    if (matches.length === 1) return matches[0];
    return null;
  }

  /**
   * Walk every edge; if the callee has no FunctionInfo, register a filler
   * stub so it shows up in the report. Critical for obfuscated code.
   * Filler locations are populated from the call-site of each incoming edge,
   * so an analyst sees where in the source the unresolved name is referenced.
   */
  fillUnresolved() {
    // Collect all callee → list of call-site locations from edges
    const calleeSites = new Map();
    for (const [, callees] of this.forward) {
      for (const [callee, edge] of callees) {
        if (!calleeSites.has(callee)) calleeSites.set(callee, []);
        for (const loc of edge.locations || []) {
          calleeSites.get(callee).push(loc);
        }
      }
    }
    for (const [name, sites] of calleeSites) {
      if (this.functions.has(name)) continue;
      const sink = classifyCall(name);
      this.functions.set(name, {
        name,
        kind: name.startsWith("new ") ? "constructor" : "function",
        isAsync: false,
        isGenerator: false,
        isStatic: false,
        isPrivate: false,
        loc: 0,
        complexity: 0,
        unresolved: true,
        category: sink ? sink.category : "unknown",
        severity: sink ? sink.severity : null,
        locations: sites.slice(0, 8), // cap to keep payload small
      });
    }
    // Classify defined-but-unclassified functions too.
    for (const info of this.functions.values()) {
      if (info.category) continue;
      const sink = classifyCall(info.name);
      info.category = sink ? sink.category : "user";
      info.severity = sink ? sink.severity : null;
    }
  }

  /** Group functions by category. */
  byCategory() {
    const groups = {};
    for (const info of this.functions.values()) {
      const cat = info.category || "unknown";
      (groups[cat] = groups[cat] || []).push(info);
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }

  /**
   * Shortest path from `from` to any function whose category is in
   * `categories`. Returns array of names or null.
   */
  shortestPathToCategory(from, categories) {
    const set = new Set(categories);
    const queue = [[from]];
    const visited = new Set([from]);
    while (queue.length) {
      const path = queue.shift();
      const node = path[path.length - 1];
      const info = this.functions.get(node);
      if (info && set.has(info.category) && path.length > 1) return path;
      const callees = this.forward.get(node);
      if (!callees) continue;
      for (const next of callees.keys()) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push([...path, next]);
      }
    }
    return null;
  }

  /** Set of all functions reachable from `from`. */
  reachable(from) {
    const out = new Set();
    const stack = [from];
    while (stack.length) {
      const node = stack.pop();
      if (out.has(node)) continue;
      out.add(node);
      const callees = this.forward.get(node);
      if (callees) for (const next of callees.keys()) stack.push(next);
    }
    return out;
  }

  /**
   * Identify the most important "main" entry point. Roots are scored by:
   *   1. how many functions they transitively reach (bigger subgraph wins)
   *   2. they must not be <anonymous> / <top-level> / synthetic
   * Returns the best name, or null if there are no real roots.
   * Useful for obfuscated code where the orchestrator (e.g. `OQh`) is
   * one root among 60+ anonymous IIFEs.
   */
  primaryEntry() {
    const roots = this.roots();
    const candidates = roots.filter(
      (r) => !r.startsWith("<anonymous@") && !r.startsWith("<top-level"),
    );
    if (!candidates.length) return null;
    let best = null;
    let bestSize = -1;
    for (const r of candidates) {
      const info = this.functions.get(r);
      // Skip filler/unresolved roots — they have no body
      if (info && info.unresolved) continue;
      const size = this.reachable(r).size;
      if (size > bestSize) {
        bestSize = size;
        best = r;
      }
    }
    return best;
  }

  /** Fan-in / fan-out per function. */
  fanInOut() {
    const out = new Map();
    for (const name of this.functions.keys()) {
      out.set(name, {
        fanIn: this.reverse.get(name)?.size || 0,
        fanOut: this.forward.get(name)?.size || 0,
      });
    }
    return out;
  }
}

module.exports = { CallGraph };
