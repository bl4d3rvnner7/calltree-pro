"use strict";

const path = require("path");
const parser = require("@babel/parser");

const COMMON_PLUGINS = [
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "optionalChaining",
  "nullishCoalescingOperator",
  "topLevelAwait",
  "dynamicImport",
  "decorators-legacy",
  "exportDefaultFrom",
  "exportNamespaceFrom",
  "importAssertions",
  "logicalAssignment",
  "numericSeparator",
];

function pluginsForFile(file) {
  const ext = path.extname(file).toLowerCase();
  const isTs = ext === ".ts" || ext === ".tsx";
  const isJsx = ext === ".jsx" || ext === ".tsx";
  const plugins = [...COMMON_PLUGINS];
  if (isJsx) plugins.push("jsx");
  if (isTs) plugins.push("typescript");
  else plugins.push("jsx"); // .js/.mjs/.cjs may still contain JSX
  return [...new Set(plugins)];
}

function parseSource(code, file) {
  return parser.parse(code, {
    sourceType: "unambiguous",
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    plugins: pluginsForFile(file),
  });
}

module.exports = { parseSource };
