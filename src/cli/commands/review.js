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
var pageRoutes = require("../../service/page_routes.js");

var USAGE = [
  "usage: lahe review <file-or-directory> [--session <id>] [--new-session] [--name <name>] [add options]",
  "       lahe review retire <review-id> --session <id>",
  "",
  "Starts a new agent session for a new target, or infers the existing target's session.",
  "Markdown is rendered in the St. Clair AI document style with local Mermaid diagrams.",
  "A folder of HTML pages is served whole: one review, and every page in it carries",
  "the rail, including pages written after the review was opened.",
  "Use the printed session id for later documents and the status monitor.",
  "--new-session deliberately starts a separate session and review.",
  "--name records the human's name for this agent session (what your host calls it,",
  "for example after /rename), so the reviewer's rail can say which agent to check.",
  "",
  "One review per file: a file that already has a review opens that review. In another",
  "session's review, the command says whose it is and makes no second one.",
  "retire ends one of your own session's reviews on purpose, so the file can get a new one."
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
    if (typeof meta.retired_at === "string") return;
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
    if (!meta || meta.agent_session_id !== sessionId || typeof meta.retired_at === "string") return;
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
 *   checks. The page then gets its own notes site (a page-only site in
 *   src/service/sites.js, served by the helper), no asset mount and no link
 *   mounts, and the review is minted as a notes review. `notesFolder` is the real parent path it prints.
 */
/**
 * `lahe review retire <review-id> --session <id>`: end one of this session's
 * reviews on purpose. The helper checks the owner (review.retire).
 */
async function runRetire(argv) {
  var reviewId = null;
  var sessionId = null;
  var port = null;
  var stateDirArg = null;
  for (var i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--session") sessionId = argv[(i += 1)];
    else if (argv[i] === "--port") port = Number(argv[(i += 1)]);
    else if (argv[i] === "--state-dir") stateDirArg = argv[(i += 1)];
    else if (!reviewId) reviewId = argv[i];
    else {
      process.stderr.write("lahe review retire: unexpected argument " + JSON.stringify(argv[i]) + "\n");
      return protocol.CLI_EXIT.BAD_USAGE;
    }
  }
  if (!protocol.isSafeId(reviewId) || !protocol.isSafeId(sessionId)) {
    process.stderr.write("usage: lahe review retire <review-id> --session <id>\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  var dir;
  try {
    dir = stateDirArg ? stateDir.stateDir({ dir: stateDirArg }) : stateDir.stateDir();
  } catch (err) {
    process.stderr.write("lahe review retire: " + err.message + "\n");
    return 1;
  }
  var secret = sitesModule.readCliSecret(dir);
  var ready = null;
  try { ready = JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8")); } catch (err) { ready = null; }
  var helperPort = Number.isInteger(port) && port > 0 ? port : ready && typeof ready.port === "number" ? ready.port : protocol.DEFAULT_PORT;
  if (!secret || !(await service.probeHealth(protocol.DEFAULT_HOST, helperPort))) {
    process.stderr.write("lahe review retire: no helper is running for " + dir + "; start one with lahe serve\n");
    return protocol.CLI_EXIT.HELPER_UNREACHABLE;
  }
  var headers = {};
  headers[protocol.HEADER.CLIENT] = protocol.CLIENT_CLI;
  headers[protocol.HEADER.CONTENT_TYPE] = protocol.JSON_CONTENT_TYPE;
  headers[protocol.HEADER.CLI_SECRET] = secret;
  var res = await fetch("http://" + protocol.DEFAULT_HOST + ":" + helperPort + protocol.route("review.retire").path, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ review: reviewId, session: sessionId })
  });
  var answer = null;
  try { answer = await res.json(); } catch (err) { answer = null; }
  if (res.status !== 200) {
    var code = answer && answer.error ? answer.error.code : null;
    var why = code === "PROTO_NOT_OWNER"
      ? "review " + reviewId + " belongs to another agent session, so this session cannot retire it. Ask your human."
      : code === "PROTO_UNKNOWN_REVIEW"
        ? "there is no review " + reviewId
        : "the helper refused (status " + res.status + ")";
    process.stderr.write("lahe review retire: " + why + "\n");
    return 1;
  }
  process.stdout.write("review " + reviewId + " retired at " + answer.retired_at + ". Its log is kept; `lahe review` of its file makes a new review.\n");
  return protocol.CLI_EXIT.OK;
}

async function run(argv, mode) {
  if (argv && argv[0] === "retire" && !(mode && mode.notes)) return runRetire(argv.slice(1));
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

  // ONE REVIEW PER FILE (each_page_its_own_comments.md, Part 1). A file that
  // already has a review opens that review. In this session's own review the
  // command goes on as before; in another session's it prints the address,
  // says whose it is, and makes nothing. It never makes a second review.
  if (!notesMode) {
    var holder = null;
    try { holder = pageRoutes.holderOfFile(dir, originalTarget); } catch (err) { holder = null; }
    if (holder) {
      var owner = typeof holder.meta.agent_session_id === "string" ? holder.meta.agent_session_id : sessions.LEGACY_ID;
      var own = !!opts.session && owner === opts.session;
      // A Library pick-up of a review from before sessions (lahe library serve
      // passes --review <id> --adopt): add takes it into this session, and only
      // while that pick-up is pending (add.js refuseForeign).
      if (!own && owner === sessions.LEGACY_ID && opts.adopt && opts.review === holder.review) own = true;
      if (newSession || opts.isNew) {
        process.stderr.write(
          "lahe review: " + path.basename(originalTarget) + " already has a review (" + holder.review + "), and a file has one review. " +
            (own
              ? "To start over, retire it first: lahe review retire " + holder.review + " --session " + opts.session + "\n"
              : "It belongs to another agent session. Ask your human before doing anything else with it.\n" +
                ownSessionHint(store, owner, opts))
        );
        return protocol.CLI_EXIT.BAD_USAGE;
      }
      if (!own) return openOthersReview(dir, opts, store, holder, owner, originalTarget);
      // This session's folder or linking review holds the file: add it there.
      // So does a review that followed this file out of a removed worktree, or
      // one the tier-1 rule chose over a newer empty review (spec 20261015.01
      // R7, R8): add would otherwise go by the recorded page and miss it.
      if ((holder.tier > 1 || holder.moved || holder.ruled) && !opts.review) list.push("--review", holder.review);
    }
  }

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
  var used = {};
  var code = await add.run(list, used);
  var bound = null;
  if (code === 0 && site) {
    try {
      // The review add made or reused: `--review` or a script line on the
      // page can pick one that is not the session's newest.
      var owner = used.review || recordedReviewFor(dir, sessionId, target);
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
      // The same question `session close` asks: an always-on or installed
      // helper serves every page and stays up, as does one a page or the
      // Library is still using.
      try {
        var sessionCommand = require("./session.js");
        var wanted = await sessionCommand.helperStillWanted(dir, Date.now());
        if (!wanted.keep) await sessionCommand.stopVerifiedHelper(dir);
      } catch (err) { /* the original add failure remains primary */ }
    }
  }
  if (code === 0) {
    if (bound) {
      process.stdout.write("\n  open      " + bound.url + "\n");
      // The helper may have put the file in a larger site that already held it.
      if (typeof bound.root === "string" && bound.root !== site.root) {
        site.root = bound.root;
        site.inOuter = true;
      }
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
        (rendered.linkFilesPast && !notesMode
          ? "  links     " + rendered.linkFilesPast + " local link" +
            (rendered.linkFilesPast === 1 ? "" : "s") + " past the " + markdown.FILE_LIMIT +
            "-file limit render as inert text\n"
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

/**
 * The file's review belongs to another agent session (or to none, from before
 * sessions). Open it: the helper serves the file's address with that review's
 * rail, and nothing is made or moved. What to do next is the human's call when
 * that session's agent is listening; a closed or unwatched session can be
 * taken over, which reopens it.
 */
async function openOthersReview(dir, opts, store, holder, owner, target) {
  var port = typeof opts.port === "number" ? opts.port : protocol.DEFAULT_PORT;
  var bound = null;
  try {
    await require("./session.js").startHelper(dir, port);
    // A linking review answers on its link address, on the linking page's
    // site: print that, and bind nothing.
    var link = holder.tier === 3 ? pageRoutes.linkAddressFor(dir, holder.review, target) : null;
    if (link) {
      var ready = null;
      try { ready = JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8")); } catch (err) { ready = null; }
      var pages = ready && ready.pages ? ready.pages : {};
      var printed = Number.isInteger(pages.printed_port) ? pages.printed_port : Number.isInteger(pages.port) ? pages.port : protocol.PAGES.PORT;
      bound = { url: protocol.siteOrigin(link.name, printed) + link.path };
    } else {
      var isFolder = fs.existsSync(target) && fs.statSync(target).isDirectory();
      var plan = isFolder
        ? { root: target, mode: "folder", entry: add.folderEntryPage(target), served: "folder", stamp: false }
        : { root: path.dirname(target), mode: "folder", entry: path.basename(target), served: "file", stamp: false };
      if (isFolder && !plan.entry) throw new Error("there are no pages in " + target + " to open");
      bound = await bindSite(dir, port, holder.review, plan);
    }
  } catch (err) {
    process.stderr.write("lahe review: " + err.message + "\n");
    return 1;
  }
  var legacy = owner === sessions.LEGACY_ID;
  var session = null;
  try { session = legacy ? null : store.read(owner); } catch (err) { session = null; }
  var agentName = session && typeof session.name === "string" && session.name ? session.name : null;
  var listening = !legacy && sessions.isListening(store, owner, Date.now());
  var lines = [
    "",
    "  open      " + bound.url,
    "  review    " + holder.review + (legacy ? "  (from before agent sessions)" : "  (agent session " + owner + (agentName ? ", " + agentName : "") + (session && session.closed_at ? ", closed" : "") + ")"),
    "",
    "This file already has a review, so this command opened it and made no second one."
  ];
  if (legacy) {
    lines.push("It is from before agent sessions. To work on it, pick it up from the Library.");
  } else if (listening) {
    lines.push(
      "That session's agent is listening right now. Ask your human before doing anything else with this page:",
      "handing a session to another agent is theirs to ask for."
    );
  } else {
    lines.push(
      "Nobody is listening to that session. If your human asks you to continue it, take it over (this reopens it",
      "if it is closed):",
      "  lahe session takeover " + owner
    );
  }
  var hint = ownSessionHint(store, owner, opts);
  if (hint) lines.push(hint.replace(/\n$/, ""));
  process.stdout.write(lines.join("\n") + "\n");
  return protocol.CLI_EXIT.OK;
}

/**
 * The owner may be the caller itself, run without --session. When the caller
 * named no session and the owning session is open, say how to carry on as
 * itself. Empty otherwise.
 */
function ownSessionHint(store, owner, opts) {
  if (opts.session || owner === sessions.LEGACY_ID) return "";
  var session = null;
  try { session = store.read(owner); } catch (err) { session = null; }
  if (!session || session.closed_at) return "";
  return "If agent session " + owner + " is your own, rerun with --session " + owner + ".\n";
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
    linked: site.linked || [],
    // A file goes into the folder site that already holds it, if there is one.
    containing: site.served === "file",
    // Opening another session's review never re-stamps it.
    stamp: site.stamp !== false
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
        : site.inOuter
          ? "  (a folder already served at this address, which holds this page)"
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
