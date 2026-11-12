// read-when: Changing a TypeScript compiler flag, a project's references, an ESLint rule for .ts files, or when this test fails.

// The TypeScript gate, pinned and proved. Two halves:
//
// 1. THE CONFIGURATION, PINNED. For every TypeScript project, the options tsc
//    actually resolves (after `extends`) must equal the table below, and for one
//    file in each lint area, the rules ESLint actually resolves must equal the
//    table below. So any edit to a tsconfig*.json or eslint.config.mjs that
//    loosens a rule fails here, and a deliberate change means editing these
//    tables, in the open, in the same commit.
//
// 2. EVERY RULE BITES. Each rule has a fixture under test/fixtures/strictness/
//    that breaks it, and the real configuration has to refuse it. This also
//    covers what a table cannot: the local rules' own code.
//
// It runs the real configs, not copies of their contents: the tsconfig and
// package.json files, the ESLint config and the local rules are copied into a
// temp folder, the fixtures are laid over them in their own folders, and tsc -b
// and ESLint run there once each. node_modules is a link to the clone's.
//
// Node-only. The tools run synchronously or in this process, so nothing
// outlives a test; the temp folder is removed in `after`.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = path.join(__dirname, "..", "..");
const FIXTURES = path.join(REPO, "test", "fixtures", "strictness");
const TSC = require.resolve("typescript/bin/tsc");

// ---------------------------------------------------------------------------
// The compiler's table
// ---------------------------------------------------------------------------

// What every project resolves to from tsconfig.base.json: the architecture's
// list (Question 5), plus the settings tsc needs for a project another project
// references (see docs/ongoing/code/README.md).
const BASE_OPTIONS = {
  target: "es2024",
  module: "nodenext",
  moduleResolution: "nodenext",
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
  allowImportingTsExtensions: true,
  allowJs: false,
  composite: true,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  forceConsistentCasingInFileNames: true
};

// What tsc --showConfig adds because the options above imply it.
const IMPLIED_OPTIONS = {
  moduleDetection: "force",
  declaration: true,
  preserveConstEnums: true,
  incremental: true
};

const ALL_SRC = [
  "src/contract",
  "src/domain",
  "src/server",
  "src/cli",
  "src/browser/review-layer",
  "src/browser/library-page"
];

// The folder table in docs/features/20261112.01_typescript_migration/parts/target_layout.md
// ("The folders"), and docs/ongoing/code/README.md's project table.
const PROJECTS = {
  "src/contract": { lib: ["es2024"], types: [], references: [] },
  "src/domain": { lib: ["es2024"], types: [], references: ["src/contract"] },
  "src/server": { lib: ["es2024"], types: ["node"], references: ["src/contract", "src/domain"] },
  "src/cli": { lib: ["es2024"], types: ["node"], references: ["src/contract", "src/domain", "src/server"] },
  "src/browser/review-layer": { lib: ["es2024", "dom"], types: [], references: ["src/contract", "src/domain"] },
  "src/browser/library-page": { lib: ["es2024", "dom"], types: [], references: ["src/contract", "src/domain"] },
  "test/unit": { lib: ["es2024"], types: ["node"], references: ALL_SRC },
  scripts: { lib: ["es2024"], types: ["node"], references: [], include: ["*.mts", "eslint-rules/**/*.ts"] }
};

// ---------------------------------------------------------------------------
// ESLint's table
// ---------------------------------------------------------------------------

// The rules eslint.config.mjs sets on top of typescript-eslint's
// strict-type-checked set, for every .ts and .mts file. Messages are left out
// of no-restricted-syntax and no-restricted-imports: the selectors and patterns
// are the rule, the wording is not.
const OUR_RULES = {
  "@typescript-eslint/no-explicit-any": ["error"],
  "@typescript-eslint/no-unsafe-assignment": ["error"],
  "@typescript-eslint/no-unsafe-call": ["error"],
  "@typescript-eslint/no-unsafe-member-access": ["error"],
  "@typescript-eslint/no-unsafe-return": ["error"],
  "@typescript-eslint/no-unsafe-argument": ["error"],
  "@typescript-eslint/ban-ts-comment": [
    "error",
    { "ts-check": true, "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true }
  ],
  "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
  "@typescript-eslint/no-non-null-assertion": ["error"],
  "@typescript-eslint/switch-exhaustiveness-check": [
    "error",
    {
      allowDefaultCaseForExhaustiveSwitch: false,
      considerDefaultExhaustiveForUnions: false,
      requireDefaultForNonUnion: true
    }
  ],
  "@typescript-eslint/naming-convention": [
    "error",
    { selector: "default", format: ["camelCase"], leadingUnderscore: "forbid", trailingUnderscore: "forbid" },
    { selector: "typeLike", format: ["PascalCase"] },
    { selector: "variable", modifiers: ["const"], format: ["camelCase", "UPPER_CASE"] },
    { selector: "variable", modifiers: ["destructured"], format: null },
    { selector: "import", format: ["camelCase", "PascalCase"] },
    {
      selector: ["objectLiteralProperty", "objectLiteralMethod", "typeProperty", "typeMethod"],
      format: ["camelCase", "PascalCase", "snake_case", "UPPER_CASE"]
    },
    {
      selector: ["objectLiteralProperty", "typeProperty", "objectLiteralMethod", "typeMethod"],
      modifiers: ["requiresQuotes"],
      format: null
    }
  ],
  "no-restricted-syntax": [
    "error",
    { selector: "ExportDefaultDeclaration" },
    { selector: "ExportSpecifier[exported.name='default']" },
    { selector: "ExportNamedDeclaration > VariableDeclaration[kind!='const']" },
    { selector: "AwaitExpression:not(:function AwaitExpression)" },
    { selector: "ForOfStatement[await=true]:not(:function ForOfStatement)" },
    { selector: "TSEnumDeclaration" },
    { selector: "TSModuleDeclaration" },
    { selector: "CallExpression[callee.name='require']" }
  ],
  "max-lines": ["off", { max: 400, skipBlankLines: false, skipComments: false }],
  "lahe/no-comments": ["error"],
  "lahe/no-js-imports": ["error"]
};

const LINTER_OPTIONS = { noInlineConfig: true, reportUnusedDisableDirectives: 2 };

const NO_PACKAGES = "^(?![./]|node:)";
const NO_NODE = "^node:";
function notFolders(names) {
  return "^(?:\\.\\./)+(?:" + names.join("|") + ")(?:/|$)";
}
function restrictedImports(regexes) {
  return { "no-restricted-imports": ["error", { patterns: regexes.map((regex) => ({ regex: regex })) }] };
}

const TEST_RULES = {
  "@typescript-eslint/no-floating-promises": [
    "error",
    {
      allowForKnownSafeCalls: [
        {
          from: "package",
          package: "node:test",
          name: ["test", "it", "describe", "suite", "before", "after", "beforeEach", "afterEach"]
        }
      ]
    }
  ]
};

// One file in each lint area, and what that area adds to OUR_RULES. The files
// need not exist: ESLint works the configuration out from the path.
const LINT_AREAS = {
  "src/contract/probe.ts": restrictedImports([NO_PACKAGES, NO_NODE, notFolders(["domain", "server", "cli", "browser"])]),
  "src/domain/probe.ts": restrictedImports([NO_PACKAGES, NO_NODE, notFolders(["server", "cli", "browser"])]),
  "src/server/probe.ts": restrictedImports([NO_PACKAGES, notFolders(["cli", "browser"])]),
  "src/cli/probe.ts": restrictedImports([NO_PACKAGES, notFolders(["browser"])]),
  "src/browser/review-layer/probe.ts": restrictedImports([
    NO_PACKAGES,
    NO_NODE,
    notFolders(["server", "cli", "library-page"])
  ]),
  "src/browser/library-page/probe.ts": restrictedImports([
    NO_PACKAGES,
    NO_NODE,
    notFolders(["server", "cli", "review-layer"])
  ]),
  "test/unit/probe.test.ts": TEST_RULES,
  "scripts/probe.mts": {},
  "scripts/eslint-rules/probe.ts": {}
};

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

// Which fixture each tool must refuse, and with what. `tsc` lists error codes,
// any one of which counts; `eslint` lists rule ids, every one of which must report.
const REFUSALS = [
  { file: "src/server/explicit-any.ts", eslint: ["@typescript-eslint/no-explicit-any"] },
  { file: "src/server/eslint-disable-any.ts", eslint: ["@typescript-eslint/no-explicit-any"] },
  { file: "test/unit/server/explicit-any.test.ts", eslint: ["@typescript-eslint/no-explicit-any"] },
  { file: "src/server/unsafe-json.ts", eslint: ["@typescript-eslint/no-unsafe-assignment"] },
  { file: "src/server/unsafe-call.ts", eslint: ["@typescript-eslint/no-unsafe-call"] },
  { file: "src/server/unsafe-return.ts", eslint: ["@typescript-eslint/no-unsafe-return"] },
  { file: "src/server/unsafe-member.ts", eslint: ["@typescript-eslint/no-unsafe-member-access"] },
  { file: "src/server/unsafe-argument.ts", eslint: ["@typescript-eslint/no-unsafe-argument"] },
  { file: "src/server/ts-ignore.ts", eslint: ["@typescript-eslint/ban-ts-comment"] },
  { file: "src/server/ts-expect-error.ts", eslint: ["@typescript-eslint/ban-ts-comment"] },
  { file: "src/server/ts-nocheck.ts", eslint: ["@typescript-eslint/ban-ts-comment"] },
  { file: "src/server/as-cast.ts", eslint: ["@typescript-eslint/consistent-type-assertions"] },
  { file: "src/server/non-null.ts", eslint: ["@typescript-eslint/no-non-null-assertion"] },
  { file: "src/server/switch-missing-member.ts", eslint: ["@typescript-eslint/switch-exhaustiveness-check"] },
  { file: "src/server/switch-default-exhaustive.ts", eslint: ["@typescript-eslint/switch-exhaustiveness-check"] },
  { file: "src/server/switch-non-union.ts", eslint: ["@typescript-eslint/switch-exhaustiveness-check"] },
  { file: "test/unit/server/floating-promise.test.ts", eslint: ["@typescript-eslint/no-floating-promises"] },
  { file: "src/contract/imports-domain.ts", tsc: [6307], eslint: ["no-restricted-imports"] },
  { file: "src/domain/imports-server.ts", tsc: [6307], eslint: ["no-restricted-imports"] },
  { file: "src/server/imports-cli.ts", tsc: [6307], eslint: ["no-restricted-imports"] },
  { file: "src/cli/imports-browser.ts", tsc: [6307], eslint: ["no-restricted-imports"] },
  { file: "src/browser/review-layer/imports-server.ts", tsc: [6307], eslint: ["no-restricted-imports"] },
  { file: "src/browser/review-layer/imports-library-page.ts", tsc: [6307], eslint: ["no-restricted-imports"] },
  { file: "src/browser/library-page/imports-review-layer.ts", tsc: [6307], eslint: ["no-restricted-imports"] },
  { file: "src/server/uses-document.ts", tsc: [2584] },
  { file: "src/domain/uses-document.ts", tsc: [2584] },
  { file: "src/domain/uses-process.ts", tsc: [2580, 2591] },
  { file: "src/browser/review-layer/imports-node.ts", tsc: [2307, 2591], eslint: ["no-restricted-imports"] },
  { file: "src/server/imports-package.ts", eslint: ["no-restricted-imports"] },
  { file: "src/server/stray-comment.ts", eslint: ["lahe/no-comments"] },
  { file: "src/server/header-extra-field.ts", eslint: ["lahe/no-comments"] },
  { file: "src/server/header-misplaced.ts", eslint: ["lahe/no-comments"] },
  { file: "src/server/header-missing.ts", eslint: ["lahe/no-comments"] },
  { file: "src/server/imports-js.ts", eslint: ["lahe/no-js-imports"] },
  { file: "src/server/export-from-js.ts", eslint: ["lahe/no-js-imports"] },
  { file: "src/server/export-star-js.ts", eslint: ["lahe/no-js-imports"] },
  { file: "src/server/default-export.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/server/default-export-specifier.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/domain/exports-let.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/domain/exports-var.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/server/top-level-await.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/server/uses-enum.ts", tsc: [1294], eslint: ["no-restricted-syntax"] },
  { file: "src/server/uses-namespace.ts", tsc: [1294], eslint: ["no-restricted-syntax"] },
  { file: "src/server/uses-require.ts", eslint: ["no-restricted-syntax"] },
  { file: "src/server/bad-name.ts", eslint: ["@typescript-eslint/naming-convention"] },
  { file: "src/server/snake-function.ts", eslint: ["@typescript-eslint/naming-convention"] }
];

// Files that break nothing. imports-contract.ts imports clean-module.ts, so it
// also proves a declared reference lets an import through. The plain-value.ts
// files are what the boundary fixtures reach for: refused there, fine in their
// own folder. clean.test.ts calls node:test without awaiting it.
const CLEAN = [
  "src/contract/clean-module.ts",
  "src/server/imports-contract.ts",
  "src/server/plain-value.ts",
  "src/domain/plain-value.ts",
  "src/browser/review-layer/plain-value.ts",
  "src/browser/library-page/plain-value.ts",
  "test/unit/server/clean.test.ts"
];

// What a boundary fixture in another folder imports. Laid beside the refused
// fixtures and not checked themselves: src/cli has no package.json yet, so an
// ES module there does not compile until the CLI slice gives it one.
const BOUNDARY_TARGETS = ["src/cli/plain-value.ts"];

// ---------------------------------------------------------------------------
// Running the tools
// ---------------------------------------------------------------------------

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

function slash(file) {
  return file.split(path.sep).join("/");
}

function projectFiles() {
  return ["src", "test", "scripts"].flatMap((top) =>
    walk(path.join(REPO, top), (file) => /^(tsconfig|package)\.json$/.test(path.basename(file)), [])
  );
}

/** A temp copy of the real configs and local rules, with the named fixtures laid over it. */
function workspace(fixtures) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-strictness-")));
  ["tsconfig.base.json", "tsconfig.json", "package.json", "eslint.config.mjs"].forEach((rel) =>
    copyInto(root, path.join(REPO, rel), rel)
  );
  projectFiles().forEach((file) => copyInto(root, file, path.relative(REPO, file)));
  walk(path.join(REPO, "scripts", "eslint-rules"), (file) => file.endsWith(".ts"), []).forEach((file) =>
    copyInto(root, file, path.relative(REPO, file))
  );
  fixtures.forEach((rel) => copyInto(root, path.join(FIXTURES, rel), rel));
  const nodeModules = path.dirname(path.dirname(require.resolve("typescript/package.json")));
  fs.symlinkSync(nodeModules, path.join(root, "node_modules"), "dir");
  return root;
}

function tscErrors(root) {
  const run = spawnSync(process.execPath, [TSC, "-b", "--pretty", "false"], { cwd: root, encoding: "utf8" });
  const byFile = new Map();
  for (const line of run.stdout.split("\n")) {
    const found = /^(.+?)\(\d+,\d+\): error TS(\d+):/.exec(line);
    if (!found) continue;
    const file = slash(found[1]);
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
    byFile.set(slash(path.relative(root, result.filePath)), result.messages);
  }
  return byFile;
}

/** A project's options as tsc resolves them, with its paths made relative to the repo. */
function resolvedProject(project) {
  const dir = path.join(REPO, project);
  const run = spawnSync(process.execPath, [TSC, "--showConfig", "-p", dir], { cwd: REPO, encoding: "utf8" });
  assert.equal(run.status, 0, project + ": tsc --showConfig failed:\n" + run.stdout + run.stderr);
  const shown = JSON.parse(run.stdout);
  const fromRepo = (p) => slash(path.relative(REPO, path.resolve(dir, p)));
  const options = Object.assign({}, shown.compilerOptions);
  if (typeof options.outDir === "string") options.outDir = fromRepo(options.outDir);
  return {
    compilerOptions: options,
    references: (shown.references || []).map((reference) => fromRepo(reference.path)),
    include: shown.include,
    exclude: (shown.exclude || []).map(fromRepo)
  };
}

const SEVERITY = { off: 0, warn: 1, error: 2 };

/**
 * A rule setting as [severity number, ...options]. A rule that is off is just [0]: its options do
 * nothing, and ESLint fills in defaults for some. The wording is taken out of the two rules whose
 * messages are prose.
 */
function normalRule(name, setting) {
  const parts = Array.isArray(setting) ? setting.slice() : [setting];
  if (typeof parts[0] === "string") parts[0] = SEVERITY[parts[0]];
  if (parts[0] === 0) return [0];
  if (name === "no-restricted-syntax") {
    return [parts[0]].concat(parts.slice(1).map((entry) => ({ selector: typeof entry === "string" ? entry : entry.selector })));
  }
  if (name === "no-restricted-imports" && parts[1] && Array.isArray(parts[1].patterns)) {
    const patterns = parts[1].patterns.map((pattern) => {
      const kept = Object.assign({}, pattern);
      delete kept.message;
      return kept;
    });
    return [parts[0], Object.assign({}, parts[1], { patterns: patterns })];
  }
  return parts;
}

/** Every rule's setting, normalized, from a configuration ESLint resolved for one file. */
function normalRules(config) {
  const rules = {};
  for (const [name, setting] of Object.entries(config.rules)) rules[name] = normalRule(name, setting);
  return rules;
}

// The expected rules for a file are what ESLint resolves from typescript-eslint's
// own strict-type-checked set plus the tables above, with no config file. ESLint
// fills in some rules' default options as it resolves, so the expected side has
// to go through it too. The local rules take no options, so a stand-in will do.
function referenceConfig(areaRules) {
  const tseslint = require("typescript-eslint");
  const standIn = { meta: { schema: [] }, create: () => ({}) };
  return [
    ...tseslint.configs.strictTypeChecked,
    {
      files: ["**/*.ts", "**/*.mts"],
      plugins: { lahe: { rules: { "no-comments": standIn, "no-js-imports": standIn } } },
      rules: Object.assign({}, OUR_RULES, areaRules)
    }
  ];
}

function allFixtures() {
  return walk(FIXTURES, (file) => file.endsWith(".ts"), []).map((file) => slash(path.relative(FIXTURES, file)));
}

// Two builds. A project holding a refused fixture does not emit its
// declarations (noEmitOnError), so a clean file importing from it would fail
// too. The clean files get a build of their own, which must have no error at all.
const roots = [];
let tsc;
let eslint;
let cleanTsc;
let cleanEslint;
let lintConfigs;
let expectedRules;

test.before(async () => {
  const everything = workspace(allFixtures());
  roots.push(everything);
  tsc = tscErrors(everything);
  eslint = eslintMessages(everything, REFUSALS.map((r) => r.file));
  const clean = workspace(CLEAN);
  roots.push(clean);
  cleanTsc = tscErrors(clean);
  cleanEslint = eslintMessages(clean, CLEAN);
  const { ESLint } = require("eslint");
  const api = new ESLint({ cwd: REPO });
  lintConfigs = new Map();
  expectedRules = new Map();
  for (const [file, areaRules] of Object.entries(LINT_AREAS)) {
    lintConfigs.set(file, await api.calculateConfigForFile(path.join(REPO, file)));
    const reference = new ESLint({ cwd: REPO, overrideConfigFile: true, overrideConfig: referenceConfig(areaRules) });
    expectedRules.set(file, normalRules(await reference.calculateConfigForFile(path.join(REPO, file))));
  }
});

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. The configuration, pinned
// ---------------------------------------------------------------------------

test("the TypeScript projects are exactly the ones in the table, and the root builds every one", () => {
  const found = projectFiles()
    .filter((file) => path.basename(file) === "tsconfig.json")
    .map((file) => slash(path.relative(REPO, path.dirname(file))))
    .sort();
  assert.deepEqual(found, Object.keys(PROJECTS).sort());
  const rootConfig = JSON.parse(fs.readFileSync(path.join(REPO, "tsconfig.json"), "utf8"));
  assert.deepEqual(rootConfig.files, []);
  assert.deepEqual(
    rootConfig.references.map((reference) => reference.path),
    Object.keys(PROJECTS)
  );
});

for (const [project, expected] of Object.entries(PROJECTS)) {
  test("the " + project + " project resolves to its row of the table, every strict flag included", () => {
    const resolved = resolvedProject(project);
    const outDir = ".tsbuild/" + project;
    assert.deepEqual(
      resolved.compilerOptions,
      Object.assign({}, BASE_OPTIONS, { lib: expected.lib, types: expected.types, outDir: outDir }, IMPLIED_OPTIONS)
    );
    assert.deepEqual(resolved.references, expected.references, "references");
    assert.deepEqual(resolved.include, expected.include || ["**/*.ts"], "include");
    assert.deepEqual(resolved.exclude, [outDir], "exclude: only the build output");
    const raw = JSON.parse(fs.readFileSync(path.join(REPO, project, "tsconfig.json"), "utf8"));
    assert.deepEqual(raw.files, [], "files: [] stays, so a folder with no .ts file yet still builds");
  });
}

for (const file of Object.keys(LINT_AREAS)) {
  test("ESLint's rules for " + file + " are exactly strict-type-checked plus the table", () => {
    const config = lintConfigs.get(file);
    assert.ok(config, file + " is linted, not ignored");
    assert.deepEqual(config.linterOptions, LINTER_OPTIONS, "no file can switch a rule off for itself");
    assert.deepEqual(normalRules(config), expectedRules.get(file));
  });
}

// ---------------------------------------------------------------------------
// 2. Every rule bites
// ---------------------------------------------------------------------------

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

test("every fixture is in one of the two lists", () => {
  const listed = REFUSALS.map((r) => r.file).concat(CLEAN, BOUNDARY_TARGETS).sort();
  assert.deepEqual(allFixtures().sort(), listed);
});

test("the clean files pass tsc and ESLint, and a declared reference lets its import through", () => {
  assert.deepEqual(Object.fromEntries(cleanTsc.byFile), {}, "no error at all:\n" + cleanTsc.output);
  for (const file of CLEAN) assert.deepEqual(cleanEslint.get(file), [], file + " lints clean");
  assert.match(tsc.output, /error TS/, "and the other build did run, refusing the fixtures");
});
