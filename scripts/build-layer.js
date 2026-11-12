#!/usr/bin/env node
/*
 * read-when: Changing how the layer bundle or the Library page's file is built, or when check:layer says a committed bundle is out of date.
 */

// Builds the two files the browser loads, with esbuild:
//
//   dist/lahe-layer.js    the review layer, from manifest.builtFiles()
//   dist/lahe-library.js  the Library page, from manifest.libraryFiles()
//
// This is DEVELOPMENT TOOLING, not a runtime dependency (D1: one file in the
// page, one process beside it). A user clones the repo and adds the built file
// to a page; they never run this. That is only true because both files are
// COMMITTED, so the gate checks they are current rather than trusting a
// developer to remember.
//
// BUILDERS NEVER COMMIT dist/. A builder may rebuild it locally to run a
// browser test and must not stage it; the orchestrator rebuilds and commits it
// once at each checkpoint.
//
//   node scripts/build-layer.js          write both files
//   node scripts/build-layer.js --check  exit non-zero if either is out of date
//
// Browser tests build the same bundles in memory through buildAll(), so they
// always test the source in their worktree (test/browser/support/bundles.js).
//
// How the input is put together, during the TypeScript migration
// (docs/features/20261112.01_typescript_migration, architecture Question 7):
//
// - The entry is generated in memory, one import per manifest entry, in
//   manifest order. Nothing is written to disk.
// - An old .js file goes in as it is. It still registers itself on
//   window.LAHE in the browser, and esbuild runs it at its place in the order.
// - A converted module (an entry whose path ends in .ts) does not register
//   itself. The entry imports a generated registration in its place, which
//   imports the module and assigns it to window.LAHE under every name in the
//   entry's `registers`.
// - Every require() call is left out of the bundle (marked external). The only
//   require() calls in these files are the old wrappers' Node branches, which
//   a browser never runs: they sit behind `typeof window !== "undefined" &&
//   !!window.document`. Bundling them would pull Node-only code into the
//   browser file (contracts.js and manifest.js from index.js, node:crypto from
//   record.js), which is dead weight at best and a build error for node:
//   modules. esbuild leaves each one as a call that would throw if it ever
//   ran, and none does.
//
// What stays as it was before esbuild:
//
// - The banner, and on the layer a first statement that creates window.LAHE
//   and sets window.LAHE.version.
// - The version is the package version plus a hash of the bundle's own code,
//   so a rebuild with no change is byte-identical and the check does not churn.
// - `var VERSION = "0.0.0-dev";` in src/layer/index.js is stamped with the
//   same version. It is the only edit made to the bundled code.
// - A fixed target and no source maps. esbuild is pinned to an exact version
//   in package.json, because the check compares bytes and esbuild promises
//   nothing about identical output across versions.

"use strict";

var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");
var esbuild = require("esbuild");

var manifest = require("../src/shared/manifest.js");
var pkg = require("../package.json");

var ROOT = path.join(__dirname, "..");
var NAMESPACE = manifest.GLOBAL_NAMESPACE;

// The oldest browsers the layer supports already run ES2022: the floor is the
// CSS Custom Highlight API (Chrome and Edge 105, Safari 17.2, Firefox 140).
// The old files are ES5, so nothing in them is rewritten; a converted module
// is lowered only if it uses something newer.
var TARGET = "es2022";

var VERSION_PLACEHOLDER = 'var VERSION = "0.0.0-dev";';
var REGISTER_PREFIX = "lahe-register:";
var REGISTER_NAMESPACE = "lahe-register";
var NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

var BUNDLES = [
  {
    output: manifest.BUNDLE_OUTPUT,
    title: "live-agentic-html-editor review layer",
    entries: manifest.builtFiles,
    namespace: true
  },
  {
    output: manifest.LIBRARY_OUTPUT,
    title: "live-agentic-html-editor Library page",
    entries: manifest.libraryFiles,
    namespace: false
  }
];

function isConverted(entry) {
  return /\.ts$/.test(entry.path);
}

function checkEntries(root, entries) {
  entries.forEach(function (entry) {
    if (!entry || typeof entry.path !== "string") {
      throw new Error("a bundle entry has no path: " + JSON.stringify(entry));
    }
    if (!fs.existsSync(path.join(root, entry.path))) {
      throw new Error("manifest names a file that does not exist and is not marked planned: " + entry.path);
    }
    if (!isConverted(entry)) return;
    var names = entry.registers;
    if (!Array.isArray(names) || names.length === 0) {
      throw new Error(
        entry.path +
          " is a converted module, so its manifest entry needs `registers`: the " +
          NAMESPACE +
          " names its old file registered."
      );
    }
    names.forEach(function (name) {
      if (typeof name !== "string" || !NAME.test(name)) {
        throw new Error(entry.path + " registers " + JSON.stringify(name) + ", which is not a plain name.");
      }
    });
  });
}

function entrySource(entries) {
  return entries
    .map(function (entry) {
      var specifier = isConverted(entry) ? REGISTER_PREFIX + entry.path : "./" + entry.path;
      return "import " + JSON.stringify(specifier) + ";";
    })
    .join("\n") + "\n";
}

function registrationSource(entry) {
  var global = "globalThis." + NAMESPACE;
  return [
    "import * as converted from " + JSON.stringify("./" + entry.path) + ";",
    global + " = " + global + " || {};"
  ]
    .concat(
      entry.registers.map(function (name) {
        return global + "." + name + " = converted;";
      })
    )
    .join("\n") + "\n";
}

function layerPlugin(root, entries) {
  var converted = {};
  entries.filter(isConverted).forEach(function (entry) {
    converted[entry.path] = entry;
  });
  return {
    name: "lahe-layer",
    setup: function (build) {
      build.onResolve({ filter: /^lahe-register:/ }, function (args) {
        return { path: args.path.slice(REGISTER_PREFIX.length), namespace: REGISTER_NAMESPACE };
      });
      build.onLoad({ filter: /.*/, namespace: REGISTER_NAMESPACE }, function (args) {
        return { contents: registrationSource(converted[args.path]), resolveDir: root, loader: "js" };
      });
      build.onResolve({ filter: /.*/ }, function (args) {
        if (args.kind === "require-call") return { path: args.path, external: true };
        return undefined;
      });
    }
  };
}

function banner(title, version, namespace) {
  var lines = [
    "/*",
    " * " + title,
    " * version " + version,
    " *",
    " * GENERATED FILE. Do not edit. Edit the sources under src/ and run",
    " *   npm run build:layer",
    " *",
    " * Bundled by esbuild in the order given by src/shared/manifest.js.",
    " */"
  ];
  if (namespace) {
    lines = lines.concat([
      "(function () {",
      '  "use strict";',
      '  var g = typeof globalThis !== "undefined" ? globalThis : window;',
      "  g." + NAMESPACE + " = g." + NAMESPACE + " || {};",
      "  g." + NAMESPACE + '.version = "' + version + '";',
      "})();"
    ]);
  }
  return lines.join("\n") + "\n";
}

function describe(messages) {
  return messages
    .map(function (message) {
      var where = message.location ? message.location.file + ":" + message.location.line + ": " : "";
      return where + message.text;
    })
    .join("\n");
}

/**
 * One bundle, in memory.
 *
 * @param {{root: string, entries: Array<{path: string, registers?: string[]}>,
 *   title: string, namespace: boolean}} options entry paths are relative to
 *   root; `namespace` adds the statement that creates window.LAHE and sets its
 *   version
 * @returns {Promise<string>} the file's contents
 */
async function bundle(options) {
  var root = options.root;
  var entries = options.entries;
  checkEntries(root, entries);

  var result = await esbuild.build({
    absWorkingDir: root,
    stdin: {
      contents: entrySource(entries),
      resolveDir: root,
      sourcefile: "lahe-entry.js",
      loader: "js"
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: TARGET,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    plugins: [layerPlugin(root, entries)]
  });
  if (result.warnings.length > 0) {
    throw new Error("esbuild warned while building " + options.title + ":\n" + describe(result.warnings));
  }

  var code = result.outputFiles[0].text;
  var hash = crypto.createHash("sha256").update(code, "utf8").digest("hex").slice(0, 12);
  var version = pkg.version + "+" + hash;
  code = code.replace(VERSION_PLACEHOLDER, function () {
    return 'var VERSION = "' + version + '";';
  });
  return banner(options.title, version, options.namespace) + code;
}

/**
 * Both browser files for this checkout, in memory.
 *
 * @returns {Promise<Array<{output: string, files: number, contents: string}>>}
 *   `output` is the path under the repo root the file is written to
 */
async function buildAll() {
  var built = [];
  for (var i = 0; i < BUNDLES.length; i += 1) {
    var spec = BUNDLES[i];
    var entries = spec.entries();
    var contents = await bundle({ root: ROOT, entries: entries, title: spec.title, namespace: spec.namespace });
    built.push({ output: spec.output, files: entries.length, contents: contents });
  }
  return built;
}

// esbuild runs a helper process for its JavaScript API. It does not keep Node
// alive, but a long-lived caller (a test worker) stops it when done.
function stop() {
  return esbuild.stop();
}

async function main() {
  var check = process.argv.indexOf("--check") !== -1;
  var built = await buildAll();
  var planned = manifest.plannedFiles().length;

  if (check) {
    var stale = built.filter(function (file) {
      var full = path.join(ROOT, file.output);
      if (!fs.existsSync(full)) {
        process.stderr.write("bundle is missing: " + file.output + "\nRun: npm run build:layer\n");
        return true;
      }
      if (fs.readFileSync(full, "utf8") !== file.contents) {
        process.stderr.write(
          "bundle is out of date: " +
            file.output +
            "\nThe committed artifact is what the helper serves and setup copies into a host app, so it has to be current.\nRun: npm run build:layer\n"
        );
        return true;
      }
      return false;
    });
    if (stale.length > 0) {
      process.exitCode = 1;
      return;
    }
    built.forEach(function (file) {
      process.stdout.write(file.output + " is current (" + file.files + " files built)\n");
    });
    process.stdout.write(planned + " files still planned\n");
    return;
  }

  built.forEach(function (file) {
    var full = path.join(ROOT, file.output);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file.contents, "utf8");
    process.stdout.write(
      "wrote " + file.output + " (" + file.files + " files, " + Buffer.byteLength(file.contents, "utf8") + " bytes)\n"
    );
  });
  process.stdout.write(planned + " files still planned\n");
}

module.exports = {
  TARGET: TARGET,
  bundle: bundle,
  buildAll: buildAll,
  stop: stop
};

if (require.main === module) {
  main()
    .catch(function (err) {
      process.stderr.write((err && err.message ? err.message : String(err)) + "\n");
      process.exitCode = 1;
    })
    .then(stop);
}
