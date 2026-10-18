"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const installer = require("../../scripts/install-skills.js");

test("installed skill routes reach every shipped reference without depending on the clone", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-skill-routes-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(installer.install({ home, hook: false, stdout() {}, stderr() {} }), 0);

  for (const target of installer.defaultTargets(home)) {
    const dir = path.dirname(target.file);
    const visited = new Set();
    function visit(file) {
      if (visited.has(file)) return;
      assert.ok(file.startsWith(dir + path.sep), "reference stays in installed skill: " + file);
      visited.add(file);
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
        visit(path.resolve(path.dirname(file), match[1]));
      }
    }
    visit(target.file);
    for (const ref of installer.REFERENCES) {
      const installed = path.join(dir, ref.to);
      assert.ok(visited.has(installed), "discoverable reference: " + ref.to);
      assert.equal(fs.readFileSync(installed, "utf8"), fs.readFileSync(ref.from, "utf8"), ref.to);
    }
  }
});
