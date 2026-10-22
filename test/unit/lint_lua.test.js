"use strict";

// LAHE-lint-non-js-files: lint checked .js files only, so the pandoc filter
// src/service/lahe_render.lua got no check at all. It now gets a syntax check
// from luac or pandoc's own Lua, whichever the machine has.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { findLuaChecker, luaSyntaxError } = require("../../scripts/lint_lua.js");

const checker = findLuaChecker();
const noChecker = checker ? false : "neither luac nor pandoc is on this machine";

function fixture(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-lint-lua-"));
  const file = path.join(dir, "filter.lua");
  fs.writeFileSync(file, body);
  return file;
}

test("a Lua file with a syntax error is reported with its line", { skip: noChecker }, () => {
  const file = fixture("function Para(el)\n  return el\nend\nfunction Div(el\n  return el\nend\n");
  const message = luaSyntaxError(file, checker);
  assert.ok(message, "reported");
  assert.match(message, /:5:|:4:/);
});

test("a good Lua file passes, and is never run", { skip: noChecker }, () => {
  const marker = path.join(os.tmpdir(), "lahe-lint-lua-ran-" + process.pid);
  const file = fixture("os.exit(3)\nio.open(" + JSON.stringify(marker) + ", 'w')\n");
  assert.equal(luaSyntaxError(file, checker), null);
  assert.equal(fs.existsSync(marker), false, "compiled, not run");
});

test("the shipped pandoc filter passes", { skip: noChecker }, () => {
  assert.equal(luaSyntaxError(path.join(__dirname, "..", "..", "src", "service", "lahe_render.lua"), checker), null);
});

test("the manifest gives the Lua filter an owner, as it does every file under src/", () => {
  const manifest = require("../../src/shared/manifest.js");
  const all = [].concat(manifest.LAYER_FILES, manifest.NON_BUNDLE_FILES, manifest.CATALOG_PAGE)
    .map((e) => (typeof e === "string" ? e : e.path));
  assert.ok(all.includes("src/service/lahe_render.lua"));
});
