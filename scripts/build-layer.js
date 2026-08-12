#!/usr/bin/env node
// Concatenates the layer into the single artifact `setup` copies into a host
// application's own static assets.
//
// This is DEVELOPMENT TOOLING, not a runtime dependency (D1: one file in the
// page, one process beside it). A user clones the repo and adds the built file
// to a page; they never run this. That is only true because the artifact is
// COMMITTED, so the gate checks it is current rather than trusting a developer
// to remember.
//
// BUILDERS NEVER COMMIT dist/. A builder may rebuild it locally to run a
// browser test and must not stage it; the orchestrator rebuilds and commits it
// once at each checkpoint.
//
//   node scripts/build-layer.js          write dist/lahe-layer.js
//   node scripts/build-layer.js --check  exit non-zero if it is out of date
//
// Order is dependency order and comes from src/shared/manifest.js. There is no
// module loader in the browser here: a file may only use a namespace entry a
// file above it already registered.
//
// The manifest also names files a later task has not created yet
// (`planned: true`). Those are skipped rather than being a build failure: the
// ownership question has to have an answer before the file exists, which is
// what stopped two tasks implicitly claiming the same work. A manifest entry
// that is NOT planned and does not exist is still a hard error.

"use strict";

var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");

var manifest = require("../src/shared/manifest.js");
var pkg = require("../package.json");

var root = path.join(__dirname, "..");
var outPath = path.join(root, manifest.BUNDLE_OUTPUT);

function build() {
  var parts = [];
  var sources = [];

  manifest.builtFiles().forEach(function (entry) {
    var full = path.join(root, entry.path);
    if (!fs.existsSync(full)) {
      throw new Error(
        "manifest names a file that does not exist and is not marked planned: " + entry.path
      );
    }
    var src = fs.readFileSync(full, "utf8");
    sources.push(src);
    parts.push("/* ---- " + entry.path + "  (owner: " + entry.owner + ") ---- */");
    parts.push(src.replace(/\s+$/, ""));
    parts.push("");
  });

  // The stamp is content-derived, so re-running the build with no source change
  // produces a byte-identical file and the gate's check does not churn.
  var hash = crypto.createHash("sha256").update(sources.join("\n"), "utf8").digest("hex").slice(0, 12);
  var version = pkg.version + "+" + hash;

  var banner = [
    "/*",
    " * live-agentic-html-editor review layer",
    " * version " + version,
    " *",
    " * GENERATED FILE. Do not edit. Edit the sources under src/ and run",
    " *   npm run build:layer",
    " *",
    " * Concatenated in the order given by src/shared/manifest.js. Every module",
    " * registers itself on window." + manifest.GLOBAL_NAMESPACE + ".",
    " */",
    "(function () {",
    '  "use strict";',
    "  var g = typeof globalThis !== \"undefined\" ? globalThis : window;",
    "  g." + manifest.GLOBAL_NAMESPACE + " = g." + manifest.GLOBAL_NAMESPACE + " || {};",
    "  g." + manifest.GLOBAL_NAMESPACE + '.version = "' + version + '";',
    "})();",
    ""
  ].join("\n");

  var body = parts.join("\n");
  // The layer's own VERSION constant is stamped at concatenation time, which is
  // the only edit this script makes to a source file's text.
  body = body.replace('var VERSION = "0.0.0-dev";', 'var VERSION = "' + version + '";');

  return banner + body + "\n";
}

function main() {
  var contents = build();
  var check = process.argv.indexOf("--check") !== -1;

  if (check) {
    if (!fs.existsSync(outPath)) {
      process.stderr.write(
        "layer bundle is missing: " + manifest.BUNDLE_OUTPUT + "\nRun: npm run build:layer\n"
      );
      process.exit(1);
    }
    var current = fs.readFileSync(outPath, "utf8");
    if (current !== contents) {
      process.stderr.write(
        "layer bundle is out of date: " +
          manifest.BUNDLE_OUTPUT +
          "\nThe committed artifact is what setup copies into a host app, so it has to be current.\nRun: npm run build:layer\n"
      );
      process.exit(1);
    }
    process.stdout.write(
      "layer bundle is current (" +
        manifest.builtFiles().length +
        " files built, " +
        manifest.plannedFiles().length +
        " still planned)\n"
    );
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, contents, "utf8");
  process.stdout.write(
    "wrote " +
      manifest.BUNDLE_OUTPUT +
      " (" +
      manifest.builtFiles().length +
      " files, " +
      contents.length +
      " bytes; " +
      manifest.plannedFiles().length +
      " files still planned)\n"
  );
}

main();
