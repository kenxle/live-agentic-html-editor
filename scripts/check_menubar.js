#!/usr/bin/env node
"use strict";
// check:menubar, part of `npm run gate`.
//
// On macOS: build the menu bar app with the one recipe in
// src/service/menubar.js, into a temp state folder, and run the app's
// --self-test (the address allowlist, count formatting, and the proof vectors
// in test/fixtures/menubar/proof_vectors.json). It runs from the clone's root,
// so the self-test finds the fixtures by their repo path.
//
// It skips, with one line and exit 0, anywhere but macOS, when the app's
// Swift source is not in this checkout, and on a Mac without Apple's command
// line tools: the app is an optional Mac extra, and the gate stays green on
// Linux CI and on a fresh clone. A build that starts and fails, or a self-test
// that fails, exits 1.
//
// It builds and runs the program only. It writes no login item and runs no
// launchctl, so it never touches a real or a test label.
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");

var ROOT = path.join(__dirname, "..");

if (process.platform !== "darwin") {
  console.log("check:menubar skipped: the menu bar app is macOS only");
  process.exit(0);
}

var menubar = require(path.join(ROOT, "src", "service", "menubar.js"));
var source = path.join.apply(path, [ROOT].concat(menubar.SOURCE_DIR, [menubar.SOURCE_FILES[0]]));
if (!fs.existsSync(source)) {
  console.log("check:menubar skipped: " + path.relative(ROOT, source) + " is not in this checkout");
  process.exit(0);
}

async function main() {
  var stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-check-menubar-"));
  try {
    var built = await menubar.build({ clone: ROOT, stateDir: stateDir });
    if (!built.ok && built.code === menubar.FAILED.NO_TOOLS) {
      console.log("check:menubar skipped: " + built.message);
      return 0;
    }
    if (!built.ok) {
      console.error("check:menubar: the build failed: " + built.message);
      return 1;
    }
    console.log("check:menubar: built " + built.app + " (source " + built.stamp.slice(0, 12) + ")");
    var program = path.join(built.app, "Contents", "MacOS", menubar.EXECUTABLE);
    var selfTest = childProcess.spawnSync(program, ["--self-test"], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
    if (selfTest.error) {
      console.error("check:menubar: the self-test did not run: " + selfTest.error.message);
      return 1;
    }
    process.stdout.write(selfTest.stdout || "");
    process.stderr.write(selfTest.stderr || "");
    if (selfTest.status !== 0) {
      console.error("check:menubar: the self-test failed (exit " + selfTest.status + ")");
      return 1;
    }
    console.log("check:menubar passed");
    return 0;
  } finally {
    // The script's own temp folder; nothing else lives in it.
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

main().then(function (code) { process.exit(code); }, function (err) {
  console.error("check:menubar: " + (err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
