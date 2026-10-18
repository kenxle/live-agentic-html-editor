// V38 (R12, agents are told): the skill, the contract and its copies, the CLI
// doc, the serving docs, the diagrams and the manifest describe stable
// addresses and the always-on helper, and none of them still describes
// per-session page servers or random ports. A scripted grep, so a sentence
// that drifts back in fails the gate.
//
// Dated history bullets ("- 2026-09-16: ...") are a record of what was true
// then, and are not read.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..", "..");

const FILES = [
  "skills/lahe/SKILL.md",
  ...require("../../scripts/install-skills.js").REFERENCES.map((ref) => path.relative(REPO_ROOT, ref.from)),
  "src/shared/review_format.js",
  "test/unit/review_format.test.js",
  "docs/CONTRACTS.md",
  "docs/CLI.md",
  "docs/ongoing/SERVING_ARCHITECTURES.md",
  "docs/ongoing/STATIC_SITE_FOLDER.md",
  "docs/ongoing/FREE_WRITING.md",
  "docs/ongoing/SESSION_OWNERSHIP.md",
  "docs/diagrams/system_overview.md",
  "docs/diagrams/session_ownership.md",
  "docs/diagrams/review_round_trip.md",
  "docs/diagrams/module_map.md",
  "docs/diagrams/README.md",
  "docs/ongoing/LIBRARY.md",
  "docs/ongoing/STYLES.md",
  "docs/INSTALL.md",
  "README.md",
  "src/shared/manifest.js"
];

// Wording that describes the retired serving model.
const STALE = [
  /random (loopback )?port/i,
  /ephemeral port/i,
  /per-session (page|static)/i,
  /session-owned static/i,
  /one per folder per agent session/i,
  /static servers? (of|owned by) (this|the|that|a) session/i,
  /session's (static|page) servers?/i,
  /stops? (its|the|every|a session's) (static|page) servers?/i,
  /on its old port/i,
  /idle[- ]stop/i,
  /one-page server/i,
  /stopping the servers/i,
  /helper is (often|usually) down/i,
  /static review server injects/i,
  /\.lahe-styles` route in `src\/service\/static_servers/i,
  /loopback page server/i
];

test("V38: no doc an agent reads still describes per-session page servers or random ports", () => {
  const found = [];
  FILES.forEach((rel) => {
    const lines = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/^\s*- \d{4}-\d{2}-\d{2}:/.test(line)) return;
      STALE.forEach((pattern) => {
        if (pattern.test(line)) found.push(rel + ":" + (index + 1) + ": " + line.trim().slice(0, 120));
      });
    });
  });
  assert.deepEqual(found, []);
});

test("V38: the skill and the CLI doc name the stable address", () => {
  const skill = require("../support/skill.js").readSkillText();
  const cli = fs.readFileSync(path.join(REPO_ROOT, "docs/CLI.md"), "utf8");
  for (const [name, text] of [["skill", skill], ["CLI doc", cli]]) {
    assert.match(text, /<name>\.lahe\.localhost:1483/, name);
    assert.match(text, /after\s+(the|this)\s+session\s+closes/, name);
  }
});

// The docs agree on the rule: every place an agent or a reader learns the
// address form also says it may print with no port (the port-80 forward), and
// names the name rule the same way, including a file inside a reviewed folder.
test("V38: the docs agree on the name rule and on 1483 or no port", () => {
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const sources = [
    ["skill", require("../support/skill.js").readSkillText()],
    ["CLI doc", read("docs/CLI.md")]
  ];
  for (const [name, text] of sources) {
    assert.match(text, /no `?:1483`?\s+(when|once)\s+the\s+port-80\s+forward\s+is\s+set\s+up/, name + " says the address may have no port");
    assert.match(text, /two\s+parent\s+folders/, name + " states the name rule");
    assert.match(text, /folder\s+that\s+already\s+(holds|has\s+an\s+address)/, name + " says a file in a reviewed folder takes that folder's name");
  }
});
