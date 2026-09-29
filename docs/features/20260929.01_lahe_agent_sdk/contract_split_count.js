// A first cut at splitting today's contract into lines only a chat agent needs
// (waking, monitors, hosts, the reply command) and lines every agent needs.
// The architecture quotes its counts. The plan replaces this keyword guess with
// a real audience tag on each line in src/shared/review_format.js.
//
// Run from the repo root: node docs/features/20260929.01_lahe_agent_sdk/contract_split_count.js

"use strict";

var path = require("node:path");
var CONTRACT = require(path.join(process.cwd(), "src/shared/review_format.js")).CONTRACT;

var CHAT_ONLY = /monitor|wake|Codex|Antigravity|Any other host|ACTION REQUIRED|orchestrator|forever daemon|To answer, run|append by hand|A reply line looks|To see what is open|session takeover|hold their comments|rail counts|drain command is/i;

var out = { total_lines: 0, total_words: 0, chat_lines: 0, chat_words: 0, shared_lines: 0, shared_words: 0 };
CONTRACT.forEach(function (line, index) {
  var words = line.split(/\s+/).filter(Boolean).length;
  var chat = CHAT_ONLY.test(line);
  out.total_lines += 1;
  out.total_words += words;
  if (chat) { out.chat_lines += 1; out.chat_words += words; } else { out.shared_lines += 1; out.shared_words += words; }
  console.log((chat ? "chat  " : "shared") + "\t" + index + "\t" + words + "\t" + line.slice(0, 60));
});
console.log(JSON.stringify(out));
