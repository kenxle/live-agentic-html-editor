// Installs test/fixtures/catalog_state/ into a fresh temporary directory, as a
// real state dir plus the documents its reviews point at.
//
// LAHE Library plan, Task 1.1. See catalog_state_build.js for why the committed
// tree needs installing: ${ROOT} placeholders, dot-<name> segments, and modified
// times git does not keep. The oversized log is extended here too.
//
// Never the real state dir and never port 7817: every install is its own
// directory under the OS temp folder, and the fixture's recorded ports are
// fixed numbers nothing listens on.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var protocol = require("../../src/shared/protocol.js");

var SOURCE = path.join(__dirname, "catalog_state");

// The instant every fixture time was built around.
var NOW = "2026-09-28T16:00:00.000Z";
// Comment text in the fixture carries this; nothing in a list response may.
var MARKER = "MARKER-7f3c-comment-text-never-listed";
// The review whose log the install makes larger than REPROJECT_MAX_BYTES.
var BIG_REVIEW = "r_big";

function installedName(segment) {
  return segment.indexOf("dot-") === 0 ? "." + segment.slice(4) : segment;
}

function copyTree(from, to, root) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach(function (entry) {
    var src = path.join(from, entry.name);
    var dest = path.join(to, installedName(entry.name));
    if (entry.isDirectory()) return copyTree(src, dest, root);
    var bytes = fs.readFileSync(src);
    if (/\.(json|jsonl)$/.test(entry.name) || entry.name === "dot-git") {
      bytes = Buffer.from(bytes.toString("utf8").split("${ROOT}").join(root));
    }
    fs.writeFileSync(dest, bytes, { mode: 0o600 });
  });
}

/**
 * @returns {{root: string, dir: string, home: string, now: string,
 *            nowMs: number, marker: string, reviewDirs: string[]}}
 *   `dir` is the state dir, `home` the folder the documents live in.
 */
function install() {
  // realpath: on macOS the temp folder is behind a symlink, and a static
  // server records its root by real path.
  var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-catalog-fixture-")));
  fs.readdirSync(SOURCE, { withFileTypes: true }).forEach(function (entry) {
    if (!entry.isDirectory()) return;
    copyTree(path.join(SOURCE, entry.name), path.join(root, installedName(entry.name)), root);
  });
  var dir = path.join(root, "state");
  fs.chmodSync(dir, 0o700);

  var big = path.join(dir, "reviews", BIG_REVIEW, "events.jsonl");
  // Padding goes BEFORE the events, as one blank line, so the log's end still
  // holds real events: the Library reads `last` from the newest one there.
  var events = fs.readFileSync(big, "utf8");
  fs.writeFileSync(big, " ".repeat(protocol.CATALOG.REPROJECT_MAX_BYTES + 1024) + "\n" + events, { mode: 0o600 });

  var mtimes = JSON.parse(fs.readFileSync(path.join(SOURCE, "mtimes.json"), "utf8"));
  Object.keys(mtimes).forEach(function (rel) {
    var target = path.join(root, rel.split(path.sep).map(installedName).join(path.sep));
    var at = new Date(mtimes[rel]);
    fs.utimesSync(target, at, at);
  });

  return {
    root: root,
    dir: dir,
    home: path.join(root, "home"),
    now: NOW,
    nowMs: Date.parse(NOW),
    marker: MARKER,
    reviewDirs: fs.readdirSync(path.join(dir, "reviews")).sort()
  };
}

module.exports = { install: install, NOW: NOW, MARKER: MARKER, BIG_REVIEW: BIG_REVIEW };
