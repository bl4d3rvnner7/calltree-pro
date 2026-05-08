"use strict";

function formatJson(result, config) {
  const { graph } = result;

  const functions = {};
  for (const [name, info] of graph.functions) {
    functions[name] = {
      ...info,
      callers: [...(graph.reverse.get(name) || [])],
      callees: [...(graph.forward.get(name)?.keys() || [])],
    };
  }

  const edges = [];
  for (const [from, callees] of graph.forward) {
    for (const [to, edge] of callees) {
      edges.push({ from, to, count: edge.count, locations: edge.locations });
    }
  }

  const payload = {
    stats: result.stats,
    files: result.files,
    roots: graph.roots(),
    functions,
    edges,
    cycles: config.detectCycles ? graph.cycles() : undefined,
    dead: config.detectDead ? graph.deadFunctions() : undefined,
    hotspots: config.hotspots > 0 ? graph.hotspots(config.hotspots) : undefined,
    parseErrors: result.parseErrors,
  };

  return JSON.stringify(payload, null, 2);
}

module.exports = { formatJson };
