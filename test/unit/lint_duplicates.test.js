"use strict";

// LAHE-lint-duplicate-functions: node --check accepts a function declared twice
// in one file, and Playwright's parser refuses it, so lint has to catch it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { duplicateDeclaration } = require("../../scripts/lint_duplicates.js");

function fixture(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-lint-dup-"));
  const file = path.join(dir, "file.js");
  fs.writeFileSync(file, body);
  return file;
}

test("a function declared twice at the top level is reported by name", () => {
  const file = fixture([
    "\"use strict\";",
    "function validPort(p) { return p > 0; }",
    "function other() {}",
    "function validPort(p) { return p < 65536; }",
    "module.exports = { validPort };"
  ].join("\n"));
  assert.match(duplicateDeclaration(file), /validPort/);
});

test("ordinary CommonJS passes, including a shebang, a top-level return and same-named inner functions", () => {
  const file = fixture([
    "#!/usr/bin/env node",
    "var fs = require(\"fs\");",
    "function a() { function inner() {} return inner; }",
    "function b() { function inner() {} return inner; }",
    "if (!fs) return;",
    "module.exports = { a, b };"
  ].join("\n"));
  assert.equal(duplicateDeclaration(file), null);
});
