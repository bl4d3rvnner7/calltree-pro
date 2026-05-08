"use strict";

const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"];

// Common builtins to optionally hide from the call graph.
// These almost always represent uninteresting noise in a call tree.
const BUILTINS = new Set([
  // Console
  "console.log",
  "console.warn",
  "console.error",
  "console.info",
  "console.debug",
  "console.trace",
  "console.dir",

  // Math
  "Math.max",
  "Math.min",
  "Math.abs",
  "Math.floor",
  "Math.ceil",
  "Math.round",
  "Math.random",
  "Math.pow",
  "Math.sqrt",
  "Math.log",
  "Math.exp",

  // Array prototype methods (when called as identifiers)
  "Array.isArray",
  "Array.from",
  "Array.of",

  // Object prototype methods
  "Object.keys",
  "Object.values",
  "Object.entries",
  "Object.assign",
  "Object.freeze",
  "Object.create",
  "Object.getPrototypeOf",
  "Object.defineProperty",

  // JSON
  "JSON.parse",
  "JSON.stringify",

  // Number
  "Number.isInteger",
  "Number.isFinite",
  "Number.isNaN",
  "Number.parseInt",
  "Number.parseFloat",

  // Globals
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
  "structuredClone",
]);

// Methods called on chained values that we usually don't want to follow
// e.g. .map, .filter, .then — these are *prototype* methods, hard to
// resolve statically, and would clutter the graph.
const PROTOTYPE_METHODS = new Set([
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "forEach",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "includes",
  "indexOf",
  "lastIndexOf",
  "slice",
  "splice",
  "concat",
  "join",
  "split",
  "push",
  "pop",
  "shift",
  "unshift",
  "sort",
  "reverse",
  "flat",
  "flatMap",
  "fill",
  "trim",
  "trimStart",
  "trimEnd",
  "padStart",
  "padEnd",
  "replace",
  "replaceAll",
  "match",
  "matchAll",
  "search",
  "toLowerCase",
  "toUpperCase",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "then",
  "catch",
  "finally",
]);

module.exports = { JS_EXTENSIONS, BUILTINS, PROTOTYPE_METHODS };
