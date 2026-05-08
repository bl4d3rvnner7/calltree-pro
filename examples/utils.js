// examples/utils.js — second file for multi-file analysis test
function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

const helpers = {
  shout(s) {
    return s.toUpperCase() + "!";
  },
  whisper(s) {
    return s.toLowerCase();
  },
};

class Counter {
  constructor() {
    this.n = 0;
  }
  inc() {
    this.n++;
    this.report();
  }
  report() {
    return clamp(this.n, 0, 100);
  }
}

const c = new Counter();
c.inc();
helpers.shout("hi");

module.exports = { clamp, helpers, Counter };
