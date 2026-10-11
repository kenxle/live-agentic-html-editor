// Public entrypoint for enrolling a document in one top-level agent session.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var stateDir = require("../../service/state_dir.js");
var sessions = require("../../service/agent_sessions.js");
var markdown = require("../../service/markdown.js");
var sitesModule = require("../../service/sites.js");
var service = require("../../service/index.js");
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
  var notesFolder = mode && mode.notesFolder ? mode.notesFolder : null;
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
  // PAGE MODE IS THE REVIEW'S, NOT THE COMMAND'S (adversary review 5). A
  // Markdown file whose render already belongs to a notes review is a notes
  // page, whichever command brings it back: `lahe review notes.md --session
  // <id>` gets the same one-page server `lahe write` gave it, and the same
  // path rules. The notes flag wins.
  if (!notesMode && markdownTarget) {
    var prior = recordedReviewFor(dir, sessionId, markdown.artifactPath(dir, sessionId, originalTarget));
    if (prior && stateDir.isNotesReview(dir, prior)) {
      var checked = require("./write.js").prepare(originalTarget);
      if (checked.error) {
        if (createdSession) store.close(sessionId);
        process.stderr.write("lahe review: this file is a notes page, and " + checked.error + "\n");
        return protocol.CLI_EXIT.BAD_USAGE;
      }
      notesMode = true;
      notesFolder = checked.folder;
    }
  }
  var rendered = null;
  var served = null;
  var site = null;
  var target = originalTarget;
  // The helper serves the page itself. When no helper is up yet, the pages
  // port is checked first, so a taken port is said plainly, naming it, rather
  // than as a helper that never came up.
  var taken = await pagesPortTaken(opts.port);
  if (taken) {
    if (createdSession) store.close(sessionId);
    process.stderr.write(
      "lahe review: port " + taken + " is taken by another program, so the helper cannot serve pages. " +
        "Free that port and run this again.\n"
    );
    return 1;
  }
  try {
    if (notesMode && !markdownTarget) throw new Error("lahe write serves a Markdown file only");
    if (markdownTarget) {
      rendered = markdown.writeArtifact(dir, sessionId, originalTarget, { noFollow: notesMode });
      var targetIndex = list.indexOf(opts.target);
      if (targetIndex === -1) throw new Error("could not identify the Markdown target argument");
      list[targetIndex] = rendered.target;
      list.push("--source", originalTarget);
      target = rendered.target;
    }
    site = planSite(target, originalTarget, rendered, opts, notesMode);
    if (site) {
      if (notesMode) markNotes(dir, sessionId, rendered, list);
      served = site.served;
      list.push("--served-by-helper");
    }
  } catch (err) {
    if (createdSession) store.close(sessionId);
    process.stderr.write("lahe review: " + err.message + "\n");
    return 1;
  }
  var code = await add.run(list);
  var bound = null;
  if (code === 0 && site) {
    try {
      var owner = recordedReviewFor(dir, sessionId, target);
      if (!owner) throw new Error("the review add just made is not on disk");
      bound = await bindSite(dir, opts.port, owner, site);
    } catch (err) {
      process.stderr.write("lahe review: " + err.message + "\n");
      code = 1;
    }
  }
  if (code !== 0 && createdSession) {
    store.close(sessionId);
    if (store.openSessions().length === 0) {
      try { await require("./session.js").stopVerifiedHelper(dir); } catch (err) { /* the original add failure remains primary */ }
    }
  }
  if (code === 0) {
    if (bound) {
      process.stdout.write("\n  open      " + bound.url + "\n");
      printSiteScope(notesMode ? "notes" : served, site, opts, notesFolder);
    }
    if (rendered) {
      process.stdout.write(
        "  source    " + originalTarget + "  (Markdown rendered deterministically)\n" +
        "  rebuild   nothing to do. Edit the Markdown and the page re-renders and reloads itself\n" +
        (rendered.linkMounts.length && !notesMode
          ? "  links     " + rendered.linkMounts.length + " linked folder" +
            (rendered.linkMounts.length === 1 ? "" : "s") + " served read-only at this address\n"
          : "") +
        (rendered.linkMountsSkipped && !notesMode
          ? "  links     " + rendered.linkMountsSkipped + " local link" +
            (rendered.linkMountsSkipped === 1 ? "" : "s") + " past the " + markdown.MOUNT_CAP +
            "-folder cap render as inert text\n"
          : "")
      );
    }
    process.stdout.write(
      (bound ? "" : "\n") + sessions.commandBlock({ dir: dir, session: sessionId })
    );
  }
  return code;
}

// ---------------------------------------------------------------------------
// Stable addresses: the helper serves the page itself
// ---------------------------------------------------------------------------

/**
 * The pages port, when no helper is answering and something else holds it;
 * else null. A running helper already holds the pages port itself.
 */
async function pagesPortTaken(port) {
  var helperPort = typeof port === "number" ? port : protocol.DEFAULT_PORT;
  if (await service.probeHealth(protocol.DEFAULT_HOST, helperPort)) return null;
  var fromEnv = process.env[protocol.PAGES.PORT_ENV];
  var pagesPort = fromEnv !== undefined && fromEnv !== "" ? Number(fromEnv) : protocol.PAGES.PORT;
  if (!Number.isInteger(pagesPort) || pagesPort <= 0) return null;
  return (await portFree(pagesPort)) ? null : pagesPort;
}

/** Can this process listen on 127.0.0.1:<port> right now? */
function portFree(port) {
  return new Promise(function (resolve) {
    var probe = require("node:net").createServer();
    probe.once("error", function () { resolve(false); });
    probe.listen(port, protocol.DEFAULT_HOST, function () {
      probe.close(function () { resolve(true); });
    });
  });
}

/**
 * The site a target is served as, decided the way a page server's root was:
 * a single page by its own folder, a folder by itself, a Markdown file by its
 * source folder (with the mounts its links need), a notes page by itself.
 * Null when somebody else serves these pages (servedKind).
 */
function planSite(target, originalTarget, rendered, opts, notesMode) {
  if (notesMode) {
    return { root: originalTarget, mode: "page-only", entry: path.basename(originalTarget), served: "page" };
  }
  var served = servedKind(target, opts);
  if (!served) return null;
  if (rendered) {
    var mounts = {};
    rendered.linkMounts.forEach(function (mount) { mounts[mount.prefix] = mount.dir; });
    return {
      root: path.dirname(originalTarget),
      mode: "folder",
      entry: path.basename(originalTarget),
      mounts: mounts,
      linked: rendered.linked || [],
      served: "file"
    };
  }
  if (served === "folder") {
    var entry = add.folderEntryPage(target);
    if (!entry) throw new Error("there are no pages in " + target + " to open");
    return { root: target, mode: "folder", entry: entry, served: "folder" };
  }
  return { root: path.dirname(target), mode: "folder", entry: path.basename(target), served: "file" };
}

/** A notes review is minted as one, and never reuses an ordinary review. */
function markNotes(dir, sessionId, rendered, list) {
  var existing = recordedReviewFor(dir, sessionId, rendered.target);
  if (existing && !stateDir.isNotesReview(dir, existing) && list.indexOf("--new") === -1) list.push("--new");
  if (list.indexOf("--notes") === -1) list.push("--notes");
}

/**
 * Ask the helper to bind `reviewId` to its site. The helper is the registry's
 * only writer; this sends the CLI secret it wrote into the state folder.
 *
 * @returns {Promise<{name: string, url: string, origin: string}>}
 */
async function bindSite(dir, port, reviewId, site) {
  var secret = sitesModule.readCliSecret(dir);
  if (!secret) throw new Error("the helper has not written its CLI secret into " + dir + "; is it running from this clone?");
  var helperPort = typeof port === "number" ? port : protocol.DEFAULT_PORT;
  var headers = {};
  headers[protocol.HEADER.CLIENT] = protocol.CLIENT_CLI;
  headers[protocol.HEADER.CONTENT_TYPE] = protocol.JSON_CONTENT_TYPE;
  headers[protocol.HEADER.CLI_SECRET] = secret;
  var body = {
    review: reviewId,
    root: site.root,
    mode: site.mode,
    entry: site.entry,
    mounts: site.mounts || {},
    linked: site.linked || []
  };
  var res = await fetch("http://" + protocol.DEFAULT_HOST + ":" + helperPort + protocol.route("site.bind").path, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body)
  });
  var answer = null;
  try { answer = await res.json(); } catch (err) { answer = null; }
  if (res.status !== 200 || !answer || typeof answer.url !== "string") {
    var why = answer && answer.error ? (answer.error.detail || answer.error.message) : "status " + res.status;
    throw new Error("the helper did not give this page an address: " + why);
  }
  return answer;
}

/** What the printed address covers: the root folder and the rail's reach, or one notes page. */
function printSiteScope(kind, site, opts, notesFolder) {
  if (kind === "notes") {
    process.stdout.write(
      "  scope     this page only. Nothing else in its folder is served at this address\n" +
        (notesFolder ? "  notes in  " + notesFolder + "\n" : "")
    );
    return;
  }
  process.stdout.write(
    "  root      " + site.root +
      (kind === "folder"
        ? "  (every page in it is this one review; links between them keep the rail)"
        : "  (the page's own folder, which is everything this address can serve)") +
      "\n"
  );
  if (opts.only) {
    process.stdout.write("  scope     only this page. Other pages under that root are served without the rail\n");
  } else if (kind === "file") {
    process.stdout.write(
      "  scope     the rail follows links onto any page under that root.\n" +
        "            Rerun with --only to keep this review to the one page.\n"
    );
  }
}

module.exports = { USAGE: USAGE, inferSession: inferSession, servedKind: servedKind, takeName: takeName, nameAction: nameAction, run: run };
