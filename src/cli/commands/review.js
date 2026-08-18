// Public entrypoint for enrolling a document in one top-level agent session.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var stateDir = require("../../service/state_dir.js");
var sessions = require("../../service/agent_sessions.js");
var staticServers = require("../../service/static_servers.js");
var markdown = require("../../service/markdown.js");
var add = require("./add.js");

var USAGE = [
  "usage: lahe review <file-or-directory> [--session <id>] [--new-session] [add options]",
  "",
  "Starts a new agent session for a new target, or infers the existing target's session.",
  "Markdown is rendered with a neutral reading style and local Mermaid diagrams.",
  "Use the printed session id for later documents and the status monitor.",
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
  var originalTarget = path.resolve(opts.target);
  var markdownTarget = fs.existsSync(originalTarget) && markdown.isMarkdown(originalTarget);
  if (markdownTarget && (opts.origins.length > 0 || opts.remove || opts.source)) {
    process.stderr.write("lahe review: Markdown owns its generated page and local server; do not combine it with --origin, --remove, or --source.\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
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
  var staticServer = null;
  var rendered = null;
  var target = originalTarget;
  try {
    if (markdownTarget) {
      rendered = markdown.writeArtifact(dir, sessionId, originalTarget);
      var targetIndex = list.indexOf(opts.target);
      if (targetIndex === -1) throw new Error("could not identify the Markdown target argument");
      list[targetIndex] = rendered.target;
      list.push("--source", originalTarget);
      target = rendered.target;
    }
    if (!opts.remove && opts.origins.length === 0 && fs.existsSync(target) && add.classify(target) === "static") {
      staticServer = await staticServers.start({ dir: dir, sessionId: sessionId, root: path.dirname(target) });
      if (rendered) {
        await staticServers.registerMount(
          dir,
          sessionId,
          staticServer.meta,
          rendered.assetPrefix,
          rendered.assetRoot
        );
      }
      list.push("--origin", "http://" + staticServer.meta.host + ":" + staticServer.meta.port);
    }
  } catch (err) {
    if (createdSession) store.close(sessionId);
    process.stderr.write("lahe review: " + err.message + "\n");
    return 1;
  }
  var code = await add.run(list);
  if (code !== 0) {
    if (staticServer && staticServer.started) {
      try { await staticServers.stopOne(dir, sessionId, staticServer.meta); } catch (err) { /* the add failure remains primary */ }
    }
    if (createdSession) {
      store.close(sessionId);
      if (store.openSessions().length === 0) {
        try { await require("./session.js").stopVerifiedHelper(dir); } catch (err) { /* the original add failure remains primary */ }
      }
    }
  }
  if (code === 0) {
    if (staticServer) {
      process.stdout.write(
        "\n  server    http://" + staticServer.meta.host + ":" + staticServer.meta.port +
          (staticServer.started ? "  (started for this agent session)" : "  (reused for this agent session)") +
          "\n  open      http://" + staticServer.meta.host + ":" + staticServer.meta.port +
          "/" + encodeURIComponent(path.basename(target)) + "\n"
      );
    }
    if (rendered) {
      process.stdout.write(
        "  source    " + originalTarget + "  (Markdown rendered deterministically)\n" +
        "  rebuild   rerun this same review command after editing the Markdown, before replying handled\n"
      );
    }
    process.stdout.write(
      (staticServer ? "" : "\n") + "  monitor   lahe status --session " + sessionId +
        " --json --seen-file <path> --quiet\n" +
        "            run every 20-30s in a background monitor; foreground loop only as fallback\n" +
        "  close     lahe session close " + sessionId + "\n"
    );
  }
  return code;
}

module.exports = { USAGE: USAGE, inferSession: inferSession, run: run };
