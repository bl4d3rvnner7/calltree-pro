"use strict";

const fs = require("fs");
const path = require("path");
const fg = require("fast-glob");

const { analyzeFile } = require("./analyzers/file");
const { CallGraph } = require("./analyzers/graph");
const { JS_EXTENSIONS } = require("./utils/constants");

async function collectFiles(inputs, ignore) {
  const files = new Set();
  for (const input of inputs) {
    const abs = path.resolve(input);
    if (fs.existsSync(abs)) {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        const dirFiles = await fg(
          JS_EXTENSIONS.map((e) => `**/*${e}`),
          { cwd: abs, absolute: true, ignore, dot: false },
        );
        dirFiles.forEach((f) => files.add(f));
        continue;
      }
      if (stat.isFile()) {
        files.add(abs);
        continue;
      }
    }
    // Treat as glob
    const matches = await fg(input, { absolute: true, ignore, dot: false });
    matches.forEach((f) => files.add(f));
  }
  return [...files].sort();
}

async function analyzeProject(inputs, config) {
  const files = await collectFiles(inputs, config.ignore);

  if (files.length === 0) {
    throw new Error(
      `No JS/TS files matched. Inputs: ${inputs.join(", ")}`,
    );
  }

  const graph = new CallGraph();
  const parseErrors = [];

  for (const file of files) {
    try {
      analyzeFile(file, graph, config);
    } catch (err) {
      parseErrors.push({ file, message: err.message });
    }
  }

  // Register filler stubs for callees that weren't matched to a definition.
  graph.fillUnresolved();

  return {
    graph,
    files,
    stats: {
      fileCount: files.length,
      functionCount: graph.functions.size,
      callCount: graph.totalEdges(),
      parseErrors: parseErrors.length,
    },
    parseErrors,
  };
}

module.exports = { analyzeProject, collectFiles };
