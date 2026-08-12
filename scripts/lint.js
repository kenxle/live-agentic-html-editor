#!/usr/bin/env node
// The lint gate. Zero dependencies, three checks, and it runs all three before
// it exits so one failure does not hide the other two.
//
//   1. SYNTAX. `node --check` over every tracked .js file. The cheapest possible
//      gate against a broken commit.
//   2. NO JSDOM. Not in package.json, and not required or imported anywhere
//      under test/. This is one of the four rules that bind every builder in the
//      plan: jsdom has no layout, no caret rectangles, no policy enforcement and
//      no real key events, so every assertion that would catch the three
//      symptoms is impossible in it. The rule stops being a slogan here.
//   3. MANIFEST COMPLETENESS. Every file under src/ appears exactly once across
//      the lists src/shared/manifest.js exposes. A file with two owners is a
//      merge conflict every time both touch it; a file with none is a thing
//      nobody built.
//
// On the manifest check being read GENERICALLY: 0A-kernel is rewriting
// shared/manifest.js, so this check does not bind to today's entry names. It
// takes every array the manifest exports, pulls a path out of each entry
// (a bare string, or an object with a path-ish field), and compares that set
// against the real tree. Whatever list-of-paths shape the rewrite lands on, this
// keeps working.

const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const skipDirs = new Set(["node_modules", ".git", "test-results", "playwright-report"]);

// ---------------------------------------------------------------------------
// Shared file walking
// ---------------------------------------------------------------------------

function collectFiles(dir, out, filter) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out, filter);
    } else if (entry.isFile() && filter(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function isJs(name) {
  return name.endsWith(".js");
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

const problems = [];

function fail(check, lines) {
  problems.push({ check: check, lines: lines });
}

// ---------------------------------------------------------------------------
// 1. Syntax
// ---------------------------------------------------------------------------

const jsFiles = collectFiles(root, [], isJs);
const syntaxErrors = [];

for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    syntaxErrors.push(
      "Syntax error in " + relative(file) + ":\n" + (err.stderr ? err.stderr.toString() : String(err))
    );
  }
}

if (syntaxErrors.length > 0) fail("syntax", syntaxErrors);

// ---------------------------------------------------------------------------
// 2. No jsdom
// ---------------------------------------------------------------------------
//
// Two halves, because a dependency and an import fail differently: a
// devDependency nobody imports is an invitation, and an import with no
// dependency is a test that only runs on the machine that has it lying around.

// This file lives in scripts/, and the import scan only reads test/, so naming
// the banned module here plainly does not trip the check on itself.
const JSDOM_NAME = "jsdom";

function jsdomInPackageJson() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const hits = [];
  sections.forEach(function (section) {
    const block = pkg[section] || {};
    Object.keys(block).forEach(function (name) {
      if (name === JSDOM_NAME || name.indexOf(JSDOM_NAME + "-") === 0 || name.indexOf("/" + JSDOM_NAME) !== -1) {
        hits.push("package.json " + section + " declares " + name);
      }
    });
  });
  return hits;
}

// require("jsdom"), require('jsdom/lib/...'), import ... from "jsdom",
// import("jsdom"). Matched against the module specifier only, so prose in a
// comment does not trip it and a real import cannot hide behind whitespace.
const JSDOM_SPECIFIER = new RegExp(
  "(?:require\\s*\\(|import\\s*\\(|from\\s+|import\\s+)\\s*[\"']" + JSDOM_NAME + "(?:[/\"'])",
  "g"
);

function jsdomImports() {
  const hits = [];
  collectFiles(path.join(root, "test"), [], isJs).forEach(function (file) {
    const source = fs.readFileSync(file, "utf8");
    source.split("\n").forEach(function (line, index) {
      JSDOM_SPECIFIER.lastIndex = 0;
      if (JSDOM_SPECIFIER.test(line)) {
        hits.push(relative(file) + ":" + (index + 1) + "  " + line.trim());
      }
    });
  });
  return hits;
}

const jsdomHits = jsdomInPackageJson().concat(jsdomImports());

if (jsdomHits.length > 0) {
  fail("no-jsdom", [
    "jsdom is banned in this project, in package.json and anywhere under test/.",
    "It has no layout, no caret rectangles, no CSP enforcement and no real key",
    "events, so every assertion that catches the symptoms this tool exists to fix",
    "is impossible in it. Write the test as a real browser test instead.",
    ""
  ].concat(jsdomHits.map(function (hit) {
    return "  " + hit;
  })));
}

// ---------------------------------------------------------------------------
// 3. Manifest completeness
// ---------------------------------------------------------------------------

const MANIFEST_PATH = "src/shared/manifest.js";
const PATH_FIELDS = ["path", "file", "src", "source"];

function pathOf(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    for (const field of PATH_FIELDS) {
      if (typeof entry[field] === "string") return entry[field];
    }
  }
  return null;
}

// Every array the manifest exports, flattened to the paths inside it. Read
// generically on purpose: 0A-kernel is rewriting this file, and a check that
// names LAYER_FILES and NON_BUNDLE_FILES would have to be rewritten with it.
function manifestPaths(manifest) {
  const counts = new Map();
  const lists = [];
  Object.keys(manifest).forEach(function (key) {
    const value = manifest[key];
    if (!Array.isArray(value)) return;
    const paths = value.map(pathOf).filter(function (value) {
      return typeof value === "string" && value.indexOf("src/") === 0;
    });
    if (paths.length === 0) return;
    lists.push(key);
    paths.forEach(function (file) {
      counts.set(file, (counts.get(file) || 0) + 1);
    });
  });
  return { counts: counts, lists: lists };
}

function checkManifest() {
  const manifestFile = path.join(root, MANIFEST_PATH);
  if (!fs.existsSync(manifestFile)) {
    fail("manifest", ["there is no " + MANIFEST_PATH + ", so no file in src/ has a stated owner."]);
    return;
  }

  let manifest;
  try {
    manifest = require(manifestFile);
  } catch (err) {
    fail("manifest", [MANIFEST_PATH + " could not be loaded: " + err.message]);
    return;
  }

  const { counts, lists } = manifestPaths(manifest);
  if (lists.length === 0) {
    fail("manifest", [
      MANIFEST_PATH + " exports no array holding src/ paths, so completeness cannot be checked.",
      "The check reads every exported array and pulls a path out of each entry (a bare",
      "string, or an object with a path field). Export the file list in one of those shapes."
    ]);
    return;
  }

  const onDisk = collectFiles(path.join(root, "src"), [], isJs).map(relative).sort();
  const missing = onDisk.filter(function (file) {
    return !counts.has(file);
  });
  const duplicated = Array.from(counts.entries())
    .filter(function (entry) {
      return entry[1] > 1;
    })
    .map(function (entry) {
      return entry[0] + " (listed " + entry[1] + " times)";
    });
  const phantom = Array.from(counts.keys())
    .filter(function (file) {
      return onDisk.indexOf(file) === -1;
    })
    .sort();

  if (missing.length === 0 && duplicated.length === 0 && phantom.length === 0) return;

  const lines = [
    "Every file under src/ must appear exactly once across the manifest's lists (" +
      lists.join(", ") +
      ")."
  ];
  if (missing.length > 0) {
    lines.push("");
    lines.push("  NO OWNER (on disk, not in the manifest):");
    missing.forEach(function (file) {
      lines.push("    " + file);
    });
  }
  if (duplicated.length > 0) {
    lines.push("");
    lines.push("  TWO OWNERS (listed more than once):");
    duplicated.forEach(function (file) {
      lines.push("    " + file);
    });
  }
  if (phantom.length > 0) {
    lines.push("");
    lines.push("  IN THE MANIFEST, NOT ON DISK:");
    phantom.forEach(function (file) {
      lines.push("    " + file);
    });
  }
  lines.push("");
  lines.push(
    "  EXPECTED TO PASS AFTER 0A-kernel. The manifest in the repo today was written"
  );
  lines.push(
    "  against the archived draft and is being rewritten against the plan's ownership"
  );
  lines.push(
    "  table by 0A-kernel, who owns this file. Until that lands this check fails, and"
  );
  lines.push(
    "  it fails loudly on purpose: skipping it is how a file with no owner ships."
  );
  fail("manifest", lines);
}

checkManifest();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (problems.length > 0) {
  problems.forEach(function (problem) {
    process.stderr.write("\nlint [" + problem.check + "] FAILED\n");
    problem.lines.forEach(function (line) {
      process.stderr.write(line + "\n");
    });
  });
  process.stderr.write(
    "\nlint failed: " +
      problems
        .map(function (problem) {
          return problem.check;
        })
        .join(", ") +
      "\n"
  );
  process.exit(1);
}

console.log(
  "lint passed (syntax: " +
    jsFiles.length +
    " files, no " +
    JSDOM_NAME +
    ", manifest complete)"
);
