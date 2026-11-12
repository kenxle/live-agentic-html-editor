// read-when: Changing a TypeScript compiler flag, a project's references, an ESLint rule for .ts files, or when this test fails.

// The TypeScript gate, proved rule by rule. Every rule in the architecture's
// enforcement list has a fixture under test/fixtures/strictness/ that breaks
// it, and this test checks the real configuration refuses each one. A rule
// someone turns off, a flag someone drops from tsconfig.base.json, or a
// reference someone adds to a project fails here.
//
// It runs the real configs, not copies of their contents: the tsconfig and
// package.json files, the ESLint config and the local rules are copied into a
// temp folder, the fixtures are laid over them in their src/ folders, and tsc -b
// and ESLint run there once each. node_modules is a link to the clone's.
//
// Node-only. Both tools run synchronously, so nothing outlives a test; the temp
// folder is removed in `after`.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = path.join(__dirname, "..", "..");
const FIXTURES = path.join(REPO, "test", "fixtures", "strictness");

// Which file each tool must refuse, and with what. `tsc` lists error codes, any
// one of which counts; `eslint` lists rule ids, every one of which must report.
const REFUSALS = [
  { file: "src/server/explicit-any.ts", eslint: ["@typescript-eslint/no-explicit-any"] },
  { file: "src/server/unsafe-json.ts", eslint: ["@typescript-eslint/no-unsafe-assignment"] },
  { file: "src/server/ts-ignore.ts", eslint: ["@typescript-eslint/ban-ts-comment"] },
  { file: "src/server/ts-expect-error.ts", eslint: ["@typescript-eslint/ban-ts-comment"] },
  { file: "src/server/as-cast.ts", eslint: ["@typescript-eslint/consistent-type-assertions"] },
  { file: "src/server/non-null.ts", eslint: ["@typescript-eslint/no-non-null-assertion"] },
  { file: "src/server/switch-missing-member.ts", eslint: ["@typescript-eslint/switch-exhaustiveness-check"] },
  { file: "src/browser/review-layer/imports-server.ts", tsc: [6307], eslint: ["no-restricted-imports"] },
  { file: "src/server/uses-document.ts", tsc: [2584] },
  { file: "src/browser/review-layer/imports-node.ts", tsc: [2307, 2591], eslint: ["no-restricted-imports"] },
  { file: "src/server/imports-package.ts", eslint: ["no-restricted-imports"] },
  { file: "src/server/stray-comment.ts", eslint: ["lahe/no-comments"] },
  { file: "src/server/header-extra-field.ts", eslint: ["lahe/no-comments"] },
  { file: "src/server/header-misplaced.ts", eslint: ["lahe/no-comments"] },
  { file: "src/server/header-missing.ts", eslint: ["lahe/no-comments"] },
  { file: "src/server/imports-js.ts", eslint: ["lahe/no-js-imports"] },
  { file: "src/server/default-export.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/server/top-level-await.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/server/uses-enum.ts", tsc: [1294], eslint: ["no-restricted-syntax"] },
  { file: "src/server/uses-namespace.ts", tsc: [1294], eslint: ["no-restricted-syntax"] },
  { file: "src/server/uses-require.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/server/bad-name.ts", eslint: ["@typescript-eslint/naming-convention"] }
];

// Files that break nothing. imports-contract.ts imports clean-module.ts, so it
// also proves a declared reference lets an import through. plain-value.ts is
// what the browser fixture reaches for: refused there, fine in its own folder.
const CLEAN = ["src/contract/clean-module.ts", "src/server/imports-contract.ts", "src/server/plain-value.ts"];

// The architecture's compiler list (Question 5), plus the two settings tsc
// forces on a project another project references (see docs/ongoing/code/README.md).
const BASE_FLAGS = {
  strict: true,
  noImplicitAny: true,
  strictNullChecks: true,
  useUnknownInCatchVariables: true,
  strictBuiltinIteratorReturn: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noPropertyAccessFromIndexSignature: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  allowUnreachableCode: false,
  allowUnusedLabels: false,
  isolatedModules: true,
  verbatimModuleSyntax: true,
  erasableSyntaxOnly: true,
  isolatedDeclarations: true,
  noUncheckedSideEffectImports: true,
  module: "nodenext",
  allowImportingTsExtensions: true,
  composite: true,
  allowJs: false,
  emitDeclarationOnly: true,
  noEmitOnError: true
};

// What a folder's project may set for itself. Anything else would override the
// base, so a project could quietly turn a strict flag off.
const PROJECT_OPTIONS = ["lib", "types", "outDir"];

function walk(dir, keep, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "fixtures") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

function copyInto(root, from, rel) {
  const to = path.join(root, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function projectFiles() {
  return ["src", "test", "scripts"].flatMap((top) =>
    walk(path.join(REPO, top), (file) => /^(tsconfig|package)\.json$/.test(path.basename(file)), [])
  );
}

function workspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-strictness-")));
  ["tsconfig.base.json", "tsconfig.json", "package.json", "eslint.config.mjs"].forEach((rel) =>
    copyInto(root, path.join(REPO, rel), rel)
  );
  projectFiles().forEach((file) => copyInto(root, file, path.relative(REPO, file)));
  walk(path.join(REPO, "scripts", "eslint-rules"), (file) => file.endsWith(".ts"), []).forEach((file) =>
    copyInto(root, file, path.relative(REPO, file))
  );
  walk(path.join(FIXTURES, "src"), (file) => file.endsWith(".ts"), []).forEach((file) =>
    copyInto(root, file, path.relative(FIXTURES, file))
  );
  const nodeModules = path.dirname(path.dirname(require.resolve("typescript/package.json")));
  fs.symlinkSync(nodeModules, path.join(root, "node_modules"), "dir");
  return root;
}

function tscErrors(root) {
  const tsc = require.resolve("typescript/bin/tsc");
  const run = spawnSync(process.execPath, [tsc, "-b", "--pretty", "false"], { cwd: root, encoding: "utf8" });
  const byFile = new Map();
  for (const line of run.stdout.split("\n")) {
    const found = /^(.+?)\(\d+,\d+\): error TS(\d+):/.exec(line);
    if (!found) continue;
    const file = found[1].split(path.sep).join("/");
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(Number(found[2]));
  }
  return { byFile, output: run.stdout + run.stderr };
}

function eslintMessages(root, files) {
  const bin = path.join(path.dirname(require.resolve("eslint/package.json")), "bin", "eslint.js");
  const run = spawnSync(process.execPath, [bin, "--format", "json", ...files], { cwd: root, encoding: "utf8" });
  assert.ok(run.stdout.startsWith("["), "ESLint did not produce a report:\n" + run.stdout + run.stderr);
  const byFile = new Map();
  for (const result of JSON.parse(run.stdout)) {
    byFile.set(path.relative(root, result.filePath).split(path.sep).join("/"), result.messages);
  }
  return byFile;
}

let root;
let tsc;
let eslint;

test.before(() => {
  root = workspace();
  tsc = tscErrors(root);
  eslint = eslintMessages(root, REFUSALS.map((r) => r.file).concat(CLEAN));
});

test.after(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test("tsconfig.base.json has every strict flag the architecture lists", () => {
  const base = JSON.parse(fs.readFileSync(path.join(REPO, "tsconfig.base.json"), "utf8")).compilerOptions;
  for (const [flag, value] of Object.entries(BASE_FLAGS)) {
    assert.equal(base[flag], value, flag + " must be " + JSON.stringify(value));
  }
});

test("no project overrides the base: each sets only its lib, types and output folder", () => {
  const configs = projectFiles().filter((file) => path.basename(file) === "tsconfig.json");
  assert.ok(configs.length >= 8, "found " + configs.length + " project configs");
  for (const file of configs) {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const rel = path.relative(REPO, file);
    assert.equal(path.resolve(path.dirname(file), config.extends), path.join(REPO, "tsconfig.base.json"), rel);
    assert.deepEqual(Object.keys(config.compilerOptions).filter((k) => !PROJECT_OPTIONS.includes(k)), [], rel);
  }
});

for (const refusal of REFUSALS) {
  test("the gate refuses " + refusal.file, () => {
    if (refusal.tsc) {
      const codes = tsc.byFile.get(refusal.file) || [];
      assert.ok(
        codes.some((code) => refusal.tsc.includes(code)),
        "tsc should refuse it with TS" + refusal.tsc.join(" or TS") + "; it reported " + JSON.stringify(codes)
      );
    }
    const rules = (eslint.get(refusal.file) || []).map((message) => message.ruleId);
    for (const rule of refusal.eslint || []) {
      assert.ok(rules.includes(rule), "ESLint should report " + rule + "; it reported " + JSON.stringify(rules));
    }
  });
}

test("a clean file passes tsc and ESLint, and a declared reference lets its import through", () => {
  for (const file of CLEAN) {
    assert.deepEqual(tsc.byFile.get(file) || [], [], file + " compiles clean");
    assert.deepEqual(eslint.get(file), [], file + " lints clean");
  }
  assert.match(tsc.output, /error TS/, "and the build did run, refusing the other fixtures");
});
