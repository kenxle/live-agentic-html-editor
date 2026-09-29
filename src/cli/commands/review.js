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
  "usage: lahe review <file-or-directory> [--session <id>] [--new-session] [--name <name>] [add options]",
  "",
  "Starts a new agent session for a new target, or infers the existing target's session.",
  "Markdown is rendered in the St. Clair AI document style with local Mermaid diagrams.",
  "A folder of HTML pages is served whole: one review, and every page in it carries",
  "the rail, including pages written after the review was opened.",
  "Use the printed session id for later documents and the status monitor.",
  "--new-session deliberately starts a separate session and review.",
  "--name records the human's name for this agent session (what your host calls it,",
  "for example after /rename), so the reviewer's rail can say which agent to check."
].join("\n");

/**
 * Take `--name <value>` off the argument list, before add.parseArgs sees it.
 *
 * @param {string[]} list
 * @returns {{list: string[], name?: string, error?: string}}
 */
/**
 * Whether `lahe review --name` may name this session.
 *
 * @param {{name?: string, created: boolean, explicit: boolean, session?: string}} input
 * @returns {{apply: boolean, note: string|null}}
 */
function nameAction(input) {
  var spec = input || {};
  if (spec.name === undefined) return { apply: false, note: null };
  if (spec.created || spec.explicit) return { apply: true, note: null };
  return {
    apply: false,
    note:
      "lahe review: --name was not applied, because this document already belongs to session " +
      spec.session + "; to rename it, run: lahe session name " + spec.session + " " + JSON.stringify(spec.name)
  };
}

function takeName(list) {
  var rest = [];
  var name;
  for (var i = 0; i < list.length; i += 1) {
    if (list[i] !== "--name") {
      rest.push(list[i]);
      continue;
    }
    if (list[i + 1] === undefined) return { list: list, error: "--name needs a value" };
    name = String(list[(i += 1)]);
  }
  var out = { list: rest };
  if (name !== undefined) out.name = name;
  return out;
}

/**
 * Does `lahe review` serve this target itself, and as what?
 *
 * "file" is one HTML page (or the page LAHE rendered a Markdown file into), and
 * the server is rooted at the page's own folder. "folder" is a set of pages
 * that is itself the document: the server is rooted at the folder, one review
 * covers all of it, and every page it serves carries the rail.
 *
 * Null means somebody else serves these pages: `--origin` was passed, the run is
 * a `--remove`, the target is a project checkout with no pages of its own, or
 * there is nothing there at all. Those are the app-in-dev row, unchanged.
 *
 * @param {string} target an absolute path
 * @param {{remove: boolean, origins: string[]}} options as `add.parseArgs` returns them
 * @returns {"file"|"folder"|null}
 */
function servedKind(target, options) {
  var opts = options || {};
  if (opts.remove || (opts.origins || []).length > 0) return null;
  if (!fs.existsSync(target)) return null;
  var kind = add.classify(target);
  if (kind === "static") return "file";
  if (kind === "static-folder") return "folder";
  return null;
}

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

/**
 * The newest review of this agent session that recorded `target`, or null.
 * Read off disk, the way `add` just wrote it.
 */
function recordedReviewFor(dir, sessionId, target) {
  var resolved = path.resolve(target);
  var best = null;
  metaFiles(dir).forEach(function (file) {
    var meta;
    try { meta = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { return; }
    if (!meta || meta.agent_session_id !== sessionId) return;
    var targets = Array.isArray(meta.target_paths) ? meta.target_paths.slice() : [];
    if (meta.target_path && targets.indexOf(meta.target_path) === -1) targets.push(meta.target_path);
    if (targets.indexOf(resolved) === -1) return;
    var at = typeof meta.created_at === "string" ? meta.created_at : "";
    if (best && at <= best.at) return;
    best = { id: path.basename(path.dirname(file)), at: at };
  });
  return best ? best.id : null;
}

/**
 * @param {string[]} argv
 * @param {{notes?: boolean, notesFolder?: string}} [mode] `lahe write` runs
 *   this with notes: true (src/cli/commands/write.js), after its own path
 *   checks. The page then gets its own one-page server (static_servers.js),
 *   no asset mount and no link mounts, and the review is minted as a notes
 *   review. `notesFolder` is the real parent path it prints.
 */
async function run(argv, mode) {
  var notesMode = !!(mode && mode.notes);
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
  var named = takeName(list);
  if (named.error) {
    process.stderr.write("lahe review: " + named.error + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  list = named.list;
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
    // Only a session this call made, or one the agent named with --session. A
    // session found from the target's path may be another agent's, and its
    // name is not this agent's to change.
    var naming = nameAction({ name: named.name, created: createdSession, explicit: !!opts.session, session: sessionId });
    if (naming.apply) store.setName(sessionId, named.name);
    else if (naming.note) process.stderr.write(naming.note + "\n");
    // The block printed below names the wake feed's path, so the file has to be
    // there before an agent copies that line. A session created before the feed
    // existed gets one here too.
    store.wake.ensure(sessionId);
  } catch (err) {
    process.stderr.write("lahe review: " + err.message + "\n");
    return 1;
  }
  if (newSession && list.indexOf("--new") === -1) list.push("--new");
  if (!opts.session) list.push("--session", sessionId);
  var staticServer = null;
  var rendered = null;
  var served = null;
  var openPage = null;
  var target = originalTarget;
  try {
    if (notesMode && !markdownTarget) throw new Error("lahe write serves a Markdown file only");
    if (markdownTarget) {
      rendered = markdown.writeArtifact(dir, sessionId, originalTarget);
      var targetIndex = list.indexOf(opts.target);
      if (targetIndex === -1) throw new Error("could not identify the Markdown target argument");
      list[targetIndex] = rendered.target;
      list.push("--source", originalTarget);
      target = rendered.target;
    }
    if (notesMode) {
      // ITS OWN ONE-PAGE SERVER, keyed by the page and never by a folder, so
      // it never reuses a folder server even with --session. Nothing else in
      // the notes folder, or in the folder of renders, is reachable over it.
      staticServer = await staticServers.start({ dir: dir, sessionId: sessionId, root: rendered.target });
      openPage = path.basename(rendered.target);
      served = "page";
      // A notes review is minted as one. A render of this file that already
      // has an ordinary review keeps that review; this run starts a new one.
      var existing = recordedReviewFor(dir, sessionId, rendered.target);
      if (existing && !isNotesReview(dir, existing) && list.indexOf("--new") === -1) list.push("--new");
      list.push("--notes");
      list.push("--origin", "http://" + staticServer.meta.host + ":" + staticServer.meta.port);
      list.push("--under-review");
    }
    if (!notesMode) served = servedKind(target, opts);
    if (served && !notesMode) {
      // A single page's server is rooted at the page's own folder; a folder of
      // pages is its own root, so links between the pages resolve and a page
      // added later is served the moment it exists.
      staticServer = await staticServers.start({
        dir: dir,
        sessionId: sessionId,
        root: served === "folder" ? target : path.dirname(target)
      });
      if (served === "folder") {
        openPage = add.folderEntryPage(target);
        if (!openPage) throw new Error("there are no pages in " + target + " to open");
      } else {
        openPage = path.basename(target);
      }
      if (rendered) {
        await staticServers.registerMount(
          dir,
          sessionId,
          staticServer.meta,
          rendered.assetPrefix,
          rendered.assetRoot
        );
        // Local links the renderer translated need their target directory
        // served read-only. The Markdown on disk keeps the links its author
        // wrote; only the rendered page points at these mounts.
        for (var i = 0; i < rendered.linkMounts.length; i += 1) {
          await staticServers.registerMount(
            dir,
            sessionId,
            staticServer.meta,
            rendered.linkMounts[i].prefix,
            rendered.linkMounts[i].dir
          );
        }
      }
      list.push("--origin", "http://" + staticServer.meta.host + ":" + staticServer.meta.port);
      // This command owns the server, knows the exact path under it, and
      // prints its own "server"/"open" lines below. `--under-review` tells
      // `add` to hold back its own "Open it"/"Fallback: file://" block so the
      // reviewer is handed exactly one URL, not three (see add.js).
      list.push("--under-review");
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
  if (code === 0 && rendered && staticServer && !notesMode) {
    // WHICH REVIEW LINKED TO WHICH FILE, recorded once the review exists. The
    // mounts above had to be registered before `add` ran, when this review may
    // not have had an id yet. A linked document rides this review's rail only
    // because of this record (spec 20260922.02). Best effort: a failure here
    // leaves the links read-only, which is what they were before.
    try {
      var owner = recordedReviewFor(dir, sessionId, rendered.target);
      if (owner) staticServers.recordLinks(dir, sessionId, staticServer.meta.id, owner, rendered.linked || []);
    } catch (err) {
      process.stderr.write("lahe review: linked documents stay read-only: " + err.message + "\n");
    }
  }
  if (code === 0) {
    if (staticServer) {
      // The link below is about to be handed to the reviewer. The helper's idle
      // sweep gives a server two minutes from this stamp before it stops it, so
      // a reused server is not stopped before the page has had time to load.
      try { staticServers.noteLinkGiven(dir, sessionId, staticServer.meta.id); }
      catch (err) { /* the link still works now; only the grace is shorter */ }
      process.stdout.write(
        "\n  server    http://" + staticServer.meta.host + ":" + staticServer.meta.port +
          (staticServer.started ? "  (started for this agent session)" : "  (reused for this agent session)") +
          "\n  open      http://" + staticServer.meta.host + ":" + staticServer.meta.port +
          "/" + encodeURIComponent(openPage) + "\n"
      );
      // THE SERVED ROOT, PRINTED. It is not always the folder the reviewer
      // named: a single page's server is rooted at the page's own directory,
      // which is what decides whether `../assets/x.png` resolves and what else
      // on disk is reachable over the link being handed out. Not labelled
      // "folder": `add` already prints that for the review's own directory in
      // the state dir, and two different paths under one label is how a reader
      // (or a script) takes the wrong one.
      if (notesMode) {
        process.stdout.write(
          "  scope     this page only, on its own server. Nothing else in its folder is served\n" +
          "  notes in  " + mode.notesFolder + "\n"
        );
      } else process.stdout.write(
        "  root      " + staticServer.meta.root +
          (served === "folder"
            ? "  (every page in it is this one review; links between them keep the rail)"
            : "  (the page's own folder, which is everything this server can serve)") +
          "\n"
      );
      if (notesMode) {
        // No scope line beyond the one above: there is no folder to follow.
      } else if (opts.only) {
        process.stdout.write(
          "  scope     only this page. Other pages under that root are served without the rail\n"
        );
      } else if (served === "file") {
        process.stdout.write(
          "  scope     the rail follows links onto any page under that root.\n" +
          "            Rerun with --only to keep this review to the one page.\n"
        );
      }
    }
    if (rendered) {
      process.stdout.write(
        "  source    " + originalTarget + "  (Markdown rendered deterministically)\n" +
        "  rebuild   nothing to do. Edit the Markdown and the page re-renders and reloads itself\n" +
        (rendered.linkMounts.length && !notesMode
          ? "  links     " + rendered.linkMounts.length + " linked folder" +
            (rendered.linkMounts.length === 1 ? "" : "s") + " served read-only for this session\n"
          : "") +
        (rendered.linkMountsSkipped && !notesMode
          ? "  links     " + rendered.linkMountsSkipped + " local link" +
            (rendered.linkMountsSkipped === 1 ? "" : "s") + " past the " + markdown.MOUNT_CAP +
            "-folder cap render as inert text\n"
          : "")
      );
    }
    process.stdout.write(
      (staticServer ? "" : "\n") + sessions.commandBlock({ dir: dir, session: sessionId })
    );
  }
  return code;
}

function isNotesReview(dir, reviewId) {
  try {
    return JSON.parse(fs.readFileSync(stateDir.metaPath(dir, reviewId), "utf8")).notes === true;
  } catch (err) {
    return false;
  }
}

module.exports = { USAGE: USAGE, inferSession: inferSession, servedKind: servedKind, takeName: takeName, nameAction: nameAction, run: run };
