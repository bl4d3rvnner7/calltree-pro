"use strict";

const fs = require("fs");
const nodePath = require("path");
const traverseModule = require("@babel/traverse");
const traverse = traverseModule.default || traverseModule;

const { parseSource } = require("../utils/parser-config");
const { BUILTINS, PROTOTYPE_METHODS } = require("../utils/constants");

/**
 * @typedef {Object} FunctionInfo
 * @property {string} name
 * @property {string} kind           // function|arrow|method|constructor|getter|setter
 * @property {boolean} isAsync
 * @property {boolean} isGenerator
 * @property {boolean} isStatic
 * @property {boolean} isPrivate
 * @property {number} loc            // physical line count
 * @property {number} complexity     // crude cyclomatic complexity
 * @property {{file:string,line:number,column:number}[]} locations
 */

/**
 * @typedef {Object} EdgeInfo
 * @property {number} count
 * @property {{file:string,line:number,column:number}[]} locations
 */

function memberName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "PrivateName") return `#${node.id.name}`;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "NumericLiteral") return String(node.value);
  return null;
}

function getClassName(path) {
  const cls = path.findParent(
    (p) => p.isClassDeclaration() || p.isClassExpression(),
  );
  if (!cls) return null;
  if (cls.node.id?.name) return cls.node.id.name;
  // Class expressions assigned to a variable: const Foo = class { ... }
  const grand = cls.parentPath;
  if (grand?.isVariableDeclarator() && grand.node.id?.name) {
    return grand.node.id.name;
  }
  if (grand?.isAssignmentExpression() && grand.node.left?.type === "Identifier") {
    return grand.node.left.name;
  }
  return "AnonymousClass";
}

function locOf(node, file) {
  if (!node?.loc) return null;
  return {
    file,
    line: node.loc.start.line,
    column: node.loc.start.column,
  };
}

/**
 * Determine a stable, qualified name for the function at `path`.
 * Handles: declarations, arrows assigned to vars, class methods (including
 * static/private/getter/setter), object methods, default-export anonymous
 * functions, and falls back to "<anonymous@file:line:col>".
 */
function qualifiedFunctionName(path, file) {
  const node = path.node;

  if (path.isFunctionDeclaration()) {
    return node.id?.name || anonName(path, file);
  }

  if (path.isClassMethod() || path.isClassPrivateMethod()) {
    const cls = getClassName(path) || "AnonymousClass";
    const key = node.kind === "constructor" ? "constructor" : memberName(node.key);
    const sep = node.static ? "." : node.kind === "method" ? "." : ".";
    // Private methods always start with '#', preserve it after the separator.
    const prefix = node.kind === "get" ? "get " : node.kind === "set" ? "set " : "";
    return `${cls}${sep}${prefix}${key}`;
  }

  if (path.isObjectMethod()) {
    const objName = enclosingObjectName(path) || "<obj>";
    const key = memberName(node.key);
    const prefix = node.kind === "get" ? "get " : node.kind === "set" ? "set " : "";
    return `${objName}.${prefix}${key}`;
  }

  // FunctionExpression or ArrowFunctionExpression: try to get a name
  // from the immediate parent.
  const parent = path.parentPath;
  if (parent?.isVariableDeclarator() && parent.node.id?.type === "Identifier") {
    return parent.node.id.name;
  }
  if (parent?.isAssignmentExpression()) {
    return calleeName(parent.node.left) || anonName(path, file);
  }
  if (parent?.isObjectProperty() && !parent.node.computed) {
    const objName = enclosingObjectName(path) || "<obj>";
    const key = memberName(parent.node.key);
    if (key) return `${objName}.${key}`;
  }
  if (parent?.isClassProperty() && !parent.node.computed) {
    const cls = getClassName(parent) || "AnonymousClass";
    const key = memberName(parent.node.key);
    const sep = parent.node.static ? "." : ".";
    if (key) return `${cls}${sep}${key}`;
  }
  if (parent?.isExportDefaultDeclaration()) {
    return `${path.hub?.file?.opts?.filename || "default"}::default`;
  }
  if (parent?.isCallExpression()) {
    // IIFE — give it a positional name.
    return anonName(path, file);
  }

  return anonName(path, file);
}

function anonName(path, file) {
  const loc = path.node.loc;
  const rel = file ? nodePath.relative(process.cwd(), file) : "?";
  if (!loc) return `<anonymous@${rel}>`;
  return `<anonymous@${rel}:${loc.start.line}:${loc.start.column}>`;
}

function enclosingObjectName(path) {
  // For `const obj = { foo() {} }` → "obj"
  const objExpr = path.findParent((p) => p.isObjectExpression());
  if (!objExpr) return null;
  const decl = objExpr.parentPath;
  if (decl?.isVariableDeclarator() && decl.node.id?.type === "Identifier") {
    return decl.node.id.name;
  }
  if (decl?.isAssignmentExpression() && decl.node.left?.type === "Identifier") {
    return decl.node.left.name;
  }
  return null;
}

function getCurrentFunctionName(path, file) {
  const fn = path.getFunctionParent();
  if (!fn) {
    const rel = nodePath.relative(process.cwd(), file);
    return `<top-level@${rel}>`;
  }
  return qualifiedFunctionName(fn, file);
}

function calleeName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "PrivateName") return `#${node.id.name}`;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "Super") return "super";

  if (
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression"
  ) {
    const obj = calleeName(node.object);
    const prop = node.computed
      ? null // computed access — we can't resolve statically
      : memberName(node.property);
    if (obj && prop) return `${obj}.${prop}`;
    return prop || obj || null;
  }

  if (
    node.type === "CallExpression" ||
    node.type === "OptionalCallExpression"
  ) {
    return calleeName(node.callee);
  }

  if (node.type === "NewExpression") {
    const inner = calleeName(node.callee);
    return inner ? `new ${inner}` : null;
  }

  if (node.type === "TaggedTemplateExpression") {
    return calleeName(node.tag);
  }

  return null;
}

/**
 * Normalize names like:
 *   this.foo  ->  Class.foo   (when caller is in a class)
 *   super.foo ->  ParentOf(Class).foo  (best effort: we can't know parent)
 */
function normalizeCalleeName(name, callerName) {
  if (!name) return null;

  if (name === "this" || name.startsWith("this.")) {
    // Caller name is qualified like "MyClass.method" or "MyClass.#m"
    const cls = qualifyingClass(callerName);
    if (!cls) return name;
    if (name === "this") return cls;
    return `${cls}.${name.slice(5)}`;
  }

  if (name.startsWith("super.")) {
    // Best effort: keep as super.x; the resolver can match by leaf.
    return name;
  }

  return name;
}

function qualifyingClass(callerName) {
  if (!callerName) return null;
  // Strip leading "<...>" prefixes (top-level/anonymous wrappers won't have a class).
  if (callerName.startsWith("<")) return null;
  const dot = callerName.indexOf(".");
  if (dot < 0) return null;
  return callerName.slice(0, dot);
}

// ----- Per-function metrics --------------------------------------------

const COMPLEXITY_NODES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchCase",
  "CatchClause",
  "LogicalExpression", // && || ??
]);

function computeMetrics(fnPath) {
  const node = fnPath.node;
  let loc = 0;
  if (node.loc) {
    loc = node.loc.end.line - node.loc.start.line + 1;
  }
  let complexity = 1;
  fnPath.traverse({
    enter(p) {
      if (COMPLEXITY_NODES.has(p.node.type)) complexity++;
    },
  });
  return { loc, complexity };
}

// ----- Main entry ------------------------------------------------------

function analyzeFile(file, graph, config) {
  const code = fs.readFileSync(file, "utf8");
  const ast = parseSource(code, file);

  // Pass 1: register every function we can see.
  traverse(ast, {
    "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ClassPrivateMethod|ObjectMethod"(
      fnPath,
    ) {
      const name = qualifiedFunctionName(fnPath, file);
      if (!config.includeAnonymous && name.startsWith("<anonymous")) {
        return;
      }
      const node = fnPath.node;
      const { loc, complexity } = computeMetrics(fnPath);
      const info = {
        name,
        kind: kindOf(fnPath),
        isAsync: !!node.async,
        isGenerator: !!node.generator,
        isStatic: !!node.static,
        isPrivate: fnPath.isClassPrivateMethod() || (typeof name === "string" && /\.#/.test(name)),
        loc,
        complexity,
        locations: [locOf(node, file)].filter(Boolean),
      };
      graph.registerFunction(info);
    },
  });

  // Pass 2: every call site.
  traverse(ast, {
    CallExpression(path) {
      addCallEdge(path, path.node.callee, graph, file, config);
    },
    OptionalCallExpression(path) {
      addCallEdge(path, path.node.callee, graph, file, config);
    },
    NewExpression(path) {
      const caller = getCurrentFunctionName(path, file);
      const inner = calleeName(path.node.callee);
      if (!inner) return;
      const callee = `new ${inner}`;
      if (shouldSkip(callee, config)) return;
      graph.addEdge(caller, callee, locOf(path.node, file));
    },
    TaggedTemplateExpression(path) {
      const caller = getCurrentFunctionName(path, file);
      let callee = calleeName(path.node.tag);
      callee = normalizeCalleeName(callee, caller);
      if (!callee || shouldSkip(callee, config)) return;
      graph.addEdge(caller, callee, locOf(path.node, file));
    },
  });
}

function addCallEdge(path, calleeNode, graph, file, config) {
  const caller = getCurrentFunctionName(path, file);
  let callee = calleeName(calleeNode);
  callee = normalizeCalleeName(callee, caller);
  if (!callee || shouldSkip(callee, config)) return;
  graph.addEdge(caller, callee, locOf(path.node, file));
}

function shouldSkip(callee, config) {
  if (!config.includeBuiltins && BUILTINS.has(callee)) return true;
  if (!config.includeBuiltins) {
    // skip "x.map", "y.then", "z.forEach" style chains
    const last = callee.split(".").pop();
    if (PROTOTYPE_METHODS.has(last) && callee !== last) return true;
  }
  return false;
}

function kindOf(fnPath) {
  if (fnPath.isArrowFunctionExpression()) return "arrow";
  if (fnPath.isClassMethod() || fnPath.isClassPrivateMethod()) {
    const k = fnPath.node.kind;
    if (k === "constructor") return "constructor";
    if (k === "get") return "getter";
    if (k === "set") return "setter";
    return "method";
  }
  if (fnPath.isObjectMethod()) {
    const k = fnPath.node.kind;
    if (k === "get") return "getter";
    if (k === "set") return "setter";
    return "method";
  }
  return "function";
}

module.exports = { analyzeFile };
