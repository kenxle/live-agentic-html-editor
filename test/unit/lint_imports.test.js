// read-when: Changing the lint check that old .js files under src/ and bin/ import no package (lint_imports.js), or when its tests fail.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { packageImports, filesToCheck } = require("../../scripts/lint_imports.js");

const REPO = path.join(__dirname, "..", "..");

function folder(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-lint-imports-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test("a require of a package fails the check and names the file and the package", (t) => {
  const dir = folder(t, {
    "src/service/bundler.js": '"use strict";\nconst esbuild = require("esbuild");\nmodule.exports = esbuild;\n'
  });
  const found = packageImports([path.join(dir, "src/service/bundler.js")], dir);
  assert.equal(found.length, 1);
  assert.match(found[0], /src\/service\/bundler\.js:2/);
  assert.match(found[0], /esbuild/);
});

test("relative paths and Node's own modules pass, with or without node:", (t) => {
  const dir = folder(t, {
    "bin/ok.js": [
      '"use strict";',
      'var path = require("path");',
      'const fs = require("node:fs");',
      'const sibling = require("./sibling.js");',
      'const up = require("../src/shared/manifest.js");',
      'module.exports = { path, fs, sibling, up };'
    ].join("\n")
  });
  assert.deepEqual(packageImports([path.join(dir, "bin/ok.js")], dir), []);
});

test("every way of loading a module is checked: import, export from, import() and a template require", (t) => {
  const dir = folder(t, {
    "src/a.js": 'import x from "left-pad";\nexport { y } from "lodash";\nexport * from "chalk";\nimport("axios");\nrequire(`yaml`);\n'
  });
  const found = packageImports([path.join(dir, "src/a.js")], dir).join("\n");
  for (const name of ["left-pad", "lodash", "chalk", "axios", "yaml"]) assert.match(found, new RegExp(name));
});

test("a require whose name is worked out at run time cannot be checked, so it fails", (t) => {
  const dir = folder(t, { "src/b.js": 'const name = "esb" + "uild";\nrequire(name);\n' });
  const found = packageImports([path.join(dir, "src/b.js")], dir);
  assert.equal(found.length, 1);
  assert.match(found[0], /src\/b\.js:2/);
});

test("a package named in a comment or a string is not an import", (t) => {
  const dir = folder(t, {
    "src/c.js": '// require("esbuild") is not allowed here\nconst text = "require(\\"esbuild\\")";\nmodule.exports = text;\n'
  });
  assert.deepEqual(packageImports([path.join(dir, "src/c.js")], dir), []);
});

test("the files checked are every .js under src/ and in bin/", () => {
  const files = filesToCheck(REPO).map((file) => path.relative(REPO, file).split(path.sep).join("/"));
  assert.ok(files.includes("bin/lahe.js"));
  assert.ok(files.includes("bin/node_floor.js"));
  assert.ok(files.includes("src/service/index.js"));
  assert.ok(files.includes("src/layer/overlay.js"));
  assert.ok(files.every((file) => /^(src\/.+|bin\/[^/]+)\.js$/.test(file)), "only .js under src/ and directly in bin/");
});

test("the real tree passes", () => {
  assert.deepEqual(packageImports(filesToCheck(REPO), REPO), []);
});
