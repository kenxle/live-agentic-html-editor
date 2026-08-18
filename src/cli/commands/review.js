// Public entrypoint for enrolling a document in one top-level agent session.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var stateDir = require("../../service/state_dir.js");
var sessions = require("../../service/agent_sessions.js");
var add = require("./add.js");

var USAGE = [
  "usage: lahe review <file-or-directory> [--session <id>] [--new-session] [add options]",
  "",
  "Starts a new agent session for a new target, or infers the existing target's session.",
  "Use the printed session id for later documents and for the status monitor.",
  "--new-session deliberately starts a separate session and review."
].join("\n");

function metaFiles(dir) {
  var root = stateDir.reviewsRoot(dir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(function (entry) { return entry.isDirectory() && protocol.isSafeId(entry.name); })
    .map(function (entry) { return stateDir.metaPath(dir, entry.name); });
}

function inferSession(dir, target) {
  var resolved = path.resolve(target);
  var owners = [];
  metaFiles(dir).forEach(function (file) {
    var meta;
    try { meta = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { return; }
    var targets = Array.isArray(meta.target_paths) ? meta.target_paths.slice() : [];
    if (meta.target_path && targets.indexOf(meta.target_path) === -1) targets.push(meta.target_path);
    if (targets.indexOf(resolved) === -1 && meta.source_path !== resolved) return;
    if (typeof meta.agent_session_id !== "string" || meta.agent_session_id === sessions.LEGACY_ID) return;
    if (owners.indexOf(meta.agent_session_id) === -1) owners.push(meta.agent_session_id);
  });
  if (owners.length > 1) {
    throw new Error(
      "this target belongs to more than one agent session (" + owners.sort().join(", ") +
        "); rerun with --session <id>"
    );
  }
  return owners.length === 1 ? owners[0] : null;
}

async function run(argv) {
  var list = (argv || []).slice();
  if (list.indexOf("--help") !== -1 || list.indexOf("-h") !== -1) {
    process.stdout.write(USAGE + "\n\n" + add.USAGE + "\n");
    return protocol.CLI_EXIT.OK;
  }
  var newSession = false;
  list = list.filter(function (arg) {
    if (arg === "--new-session") { newSession = true; return false; }
    return true;
  });
  var parsed = add.parseArgs(list);
  if (!parsed.ok) {
    process.stderr.write("lahe review: " + parsed.message + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  var opts = parsed.options;
  if (newSession && opts.session) {
    process.stderr.write("lahe review: --new-session and --session are alternatives; pick one.\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  var dir;
  try {
    dir = opts.stateDir ? stateDir.stateDir({ dir: opts.stateDir }) : stateDir.stateDir();
  } catch (err) {
    process.stderr.write("lahe review: " + err.message + "\n");
    return 1;
  }
  var store = sessions.createStore({ dir: dir });
  var sessionId = opts.session;
  var createdSession = false;
  try {
    if (sessionId) store.requireOpen(sessionId);
    if (!sessionId && !newSession) sessionId = inferSession(dir, opts.target);
    if (sessionId) store.requireOpen(sessionId);
    if (!sessionId) {
      sessionId = store.create().id;
      createdSession = true;
    }
  } catch (err) {
    process.stderr.write("lahe review: " + err.message + "\n");
    return 1;
  }
  if (newSession && list.indexOf("--new") === -1) list.push("--new");
  if (!opts.session) list.push("--session", sessionId);
  var code = await add.run(list);
  if (code !== 0 && createdSession) {
    store.close(sessionId);
    if (store.openSessions().length === 0) {
      try { await require("./session.js").stopVerifiedHelper(dir); } catch (err) { /* the original add failure remains primary */ }
    }
  }
  if (code === 0) {
    process.stdout.write(
      "\n  monitor   lahe status --session " + sessionId +
        " --json --seen-file <path> --quiet\n" +
        "  close     lahe session close " + sessionId + "\n"
    );
  }
  return code;
}

module.exports = { USAGE: USAGE, inferSession: inferSession, run: run };
