// examples/sample.js — exercises most graph features
"use strict";

const fs = require("fs");

class Logger {
  constructor(prefix) {
    this.prefix = prefix;
  }
  log(msg) {
    this._format(msg);
  }
  _format(msg) {
    return `[${this.prefix}] ${msg}`;
  }
  static create(prefix) {
    return new Logger(prefix);
  }
}

class Cache {
  #store = new Map();
  #log = Logger.create("cache");

  get size() {
    return this.#store.size;
  }

  has(key) {
    return this.#store.has(key);
  }

  set(key, value) {
    this.#store.set(key, value);
    this.#trace("set", key);
  }

  get(key) {
    this.#trace("get", key);
    return this.#store.get(key);
  }

  #trace(op, key) {
    this.#log.log(`${op} ${key}`);
  }
}

async function loadConfig(file) {
  const cache = new Cache();
  if (cache.has(file)) return cache.get(file);
  const data = await readFileAsync(file);
  cache.set(file, data);
  return data;
}

function readFileAsync(file) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, "utf8", (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// Mutual recursion
function isEven(n) {
  if (n === 0) return true;
  return isOdd(n - 1);
}
function isOdd(n) {
  if (n === 0) return false;
  return isEven(n - 1);
}

// Self-recursion
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

// Dead function
function neverCalled() {
  return 42;
}

// Top-level entry
async function main() {
  const cfg = await loadConfig("./config.json");
  const logger = Logger.create("main");
  logger.log("loaded");
  factorial(5);
  isEven(10);
  return cfg;
}

main();
