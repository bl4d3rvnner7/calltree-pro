"use strict";

const SINK_RULES = [
  { match: /^fetch$/, category: "network", severity: "high" },
  { match: /^new XMLHttpRequest$/, category: "network", severity: "high" },
  { match: /^https?\.(get|request|post)$/, category: "network", severity: "high" },
  { match: /^axios(\.|$)/, category: "network", severity: "high" },
  { match: /^got(\.|$)/, category: "network", severity: "high" },
  { match: /^request(\.|$)/, category: "network", severity: "medium" },
  { match: /^node-fetch$/, category: "network", severity: "high" },
  { match: /\.send$/, category: "network", severity: "low" },
  { match: /\.post$/, category: "network", severity: "medium" },
  { match: /\.get$/, category: "network", severity: "low" },
  { match: /^new WebSocket$/, category: "network", severity: "high" },

  { match: /^dns\./, category: "dns", severity: "high" },
  { match: /^new Resolver$/, category: "dns", severity: "high" },

  { match: /^exec$/, category: "child_process", severity: "high" },
  { match: /^execSync$/, category: "child_process", severity: "high" },
  { match: /^execFile(Sync)?$/, category: "child_process", severity: "high" },
  { match: /^spawn(Sync)?$/, category: "child_process", severity: "high" },
  { match: /^fork$/, category: "child_process", severity: "high" },
  { match: /^child_process\./, category: "child_process", severity: "high" },

  { match: /^fs\.(read|write|append|unlink|rename|chmod|chown|mkdir|rm)/, category: "fs", severity: "medium" },
  { match: /^fs\.createWriteStream$/, category: "fs", severity: "medium" },
  { match: /^fs\.createReadStream$/, category: "fs", severity: "low" },
  { match: /^require\.cache$/, category: "fs", severity: "medium" },

  { match: /^process\.env/, category: "env", severity: "medium" },
  { match: /^process\.exit$/, category: "control", severity: "medium" },
  { match: /^process\.argv/, category: "env", severity: "low" },
  { match: /^process\.cwd$/, category: "env", severity: "low" },
  { match: /^process\.platform/, category: "env", severity: "low" },
  { match: /^os\.(homedir|userInfo|hostname|networkInterfaces|tmpdir|platform|release|arch)/, category: "env", severity: "medium" },

  { match: /^crypto\.(create|randomBytes|publicEncrypt|privateDecrypt|sign|verify)/, category: "crypto", severity: "medium" },
  { match: /^Buffer\.from$/, category: "encoding", severity: "low" },
  { match: /^atob$/, category: "encoding", severity: "medium" },
  { match: /^btoa$/, category: "encoding", severity: "low" },

  { match: /^eval$/, category: "dynamic_exec", severity: "high" },
  { match: /^new Function$/, category: "dynamic_exec", severity: "high" },
  { match: /^vm\./, category: "dynamic_exec", severity: "high" },
  { match: /^require$/, category: "dynamic_exec", severity: "low" },

  { match: /^navigator\./, category: "fingerprint", severity: "medium" },
  { match: /^document\./, category: "dom", severity: "low" },
  { match: /^window\./, category: "dom", severity: "low" },

  { match: /^setInterval$/, category: "scheduling", severity: "low" },
  { match: /^setTimeout$/, category: "scheduling", severity: "low" },
  { match: /^setImmediate$/, category: "scheduling", severity: "low" },

  { match: /^Error$/, category: "error", severity: "low" },
  { match: /^new Error$/, category: "error", severity: "low" },
];

const CATEGORY_META = {
  network:        { color: "#ff6b6b", icon: "⇄", label: "Network" },
  dns:            { color: "#ff9f43", icon: "⌖", label: "DNS" },
  child_process:  { color: "#ee5253", icon: "⚙", label: "Child process" },
  fs:             { color: "#feca57", icon: "▤", label: "Filesystem" },
  env:            { color: "#48dbfb", icon: "ϵ", label: "Environment" },
  crypto:         { color: "#a29bfe", icon: "✦", label: "Crypto" },
  encoding:       { color: "#74b9ff", icon: "▦", label: "Encoding" },
  dynamic_exec:   { color: "#d63031", icon: "⚡", label: "Dynamic exec" },
  fingerprint:    { color: "#fd79a8", icon: "◉", label: "Fingerprint" },
  dom:            { color: "#81ecec", icon: "◳", label: "DOM" },
  scheduling:     { color: "#b2bec3", icon: "⏱", label: "Scheduling" },
  error:          { color: "#dfe6e9", icon: "✕", label: "Error" },
  control:        { color: "#dfe6e9", icon: "↺", label: "Control flow" },
  user:           { color: "#55efc4", icon: "ƒ", label: "User function" },
  unknown:        { color: "#636e72", icon: "?", label: "Unresolved" },
};

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function classifyCall(name) {
  if (!name) return null;
  for (const rule of SINK_RULES) {
    if (rule.match.test(name)) {
      return { category: rule.category, severity: rule.severity };
    }
  }
  return null;
}

module.exports = { classifyCall, CATEGORY_META, SEVERITY_RANK };
