// `lahe add`: put the library on a page, mint that review's token, and make
// sure a helper is up. This is the install.
//
// Owner: 3B. Architecture D1 (one file in the page, one process beside it) and
// D11's add-step half: the add step mints the per-review token, embeds it on the
// script line, and registers the page's origin, so the allowlist is built by the
// same deliberate act that adds the library and the reviewer does nothing extra.
//
//   lahe add <file-or-directory> [--new] [--review <id>] [--origin <origin>]
//            [--source <path>] [--port <n>] [--state-dir <path>]
//
// FOUR THINGS HAPPEN, IN THIS ORDER, AND THE ORDER MATTERS.
//
//  1. The target is read and classified. An .html file is a static page and gets
//     the line written into it. Anything else (a directory, a layout template)
//     is a dev server, and the line is PRINTED with a comment telling the human
//     to add the framework's real development-only conditional. `add` never
//     edits application code because it cannot know that framework-specific guard.
//  2. The review is settled, from three things in this order: `--review <id>`
//     names one outright, the script line already in the page names one, and
//     failing both, THE RECORDED TARGET PATH matches one. That third rule is
//     what keeps a rebuilt page (which loses its script line, and with it the
//     only copy of its identity) on the review it has always had. `--new`
//     overrides all three and mints a fresh review.
//  3. The helper is made to know about it, AND NOTHING EVER RESTARTS IT WHILE
//     IT IS UP. A restart disconnects every open review page. So:
//       - no helper answering: `add` writes to disk itself and starts one.
//         `serve` is idempotent, which is what makes the install one command.
//       - a helper is up and does NOT hold this review: `add` writes the review
//         to disk (nothing else is touching that events.jsonl) and asks the
//         helper for it; the helper looks on disk once for a review it does not
//         hold. There is no create-review route, on purpose.
//       - a helper is up and DOES hold this review: `add` writes nothing. It
//         hands the helper what it needs written (more origins, the recorded
//         paths, the source hint) over the `review.write` route and the helper,
//         the single writer of that log, applies it. This is the design
//         constraint stated as code: writes to a held review serialize through
//         the helper rather than racing its file handles.
//     A restart is the fallback of last resort, when a running helper will not
//     take either path, and the reason is printed. Nothing is lost by it: the
//     log is append-only, tokens persist, and the library re-posts anything
//     unacknowledged.
//  4. Only then is the script line written, so a page loaded the instant after
//     `add` prints has a helper that will accept it.
//
// THE SCRIPT LINE CARRIES BOTH HALVES, and it needs both.
//
// The PRIMARY src is the helper's own URL. One absolute URL resolves from any
// folder, any origin and any depth, which a bare relative path could not: it
// resolves against wherever the page is SERVED from, so the first time that is
// another folder the library 404s. The helper serves those bytes
// unauthenticated (public code, no review data, no token).
//
// The FALLBACK is a copy of the built library written BESIDE the page, named
// relatively on the line, and injected by an inline onerror when the primary
// src does not load. It restores what D1 asked for and an earlier pass cut: a
// page opened while the helper is down. Without it that page loaded no library
// at all: no rail, no honest "the helper is unreachable" chip, no local
// capture, no export. The note that justified cutting it ("a review with no
// helper cannot record anything anyway") was wrong. The library alone records
// into browser storage, says the helper is unreachable, and posts what it held
// the moment the helper is back. That is R10.
//
// The copy is REFRESHED ON EVERY add run, so it tracks dist closely (the
// rebuild loop re-runs add per rebuild). The helper URL stays the primary and
// is always current, so a stale copy can only ever be what a reviewer gets
// while the helper is down, which beats nothing at all.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");
var childProcess = require("node:child_process");

var protocol = require("../../shared/protocol.js");
var manifest = require("../../shared/manifest.js");
var scriptLine = require("../../shared/script_line.js");
var stateDirModule = require("../../service/state_dir.js");
var logModule = require("../../service/log.js");
var reviewsModule = require("../../service/reviews.js");
var agentSessionsModule = require("../../service/agent_sessions.js");
var staticServersModule = require("../../service/static_servers.js");
var sourceStamp = require("../../service/source_stamp.js");
var service = require("../../service/index.js");

var REPO_ROOT = path.join(__dirname, "..", "..", "..");
var BIN = path.join(REPO_ROOT, "bin", "lahe.js");
var BUNDLE = path.join(REPO_ROOT, manifest.BUNDLE_OUTPUT);
var BUNDLE_BASENAME = path.basename(manifest.BUNDLE_OUTPUT);

// Exit codes: the two command-specific outcomes plus the shared caller error.
var EXIT = {
  OK: 0,
  FAILED: 1,
  BAD_USAGE: protocol.CLI_EXIT.BAD_USAGE
};

// A page opened from disk sends the literal origin "null" on every request, on
// all three browsers (the 1A spike, architecture D11). That is a legitimate
// value in a review's registered set, and it is what a static file registers.
var FILE_ORIGIN = "null";

// When the target is a dev server and nobody said which origin, these two are
// registered and the fact is PRINTED. Both, because browser storage is
// partitioned by origin: localhost and 127.0.0.1 are physically separate
// buckets and one review spans them only because the helper holds a set.
var DEFAULT_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

/**
 * Every named loopback origin brings its twin. `http://localhost:8899` and
 * `http://127.0.0.1:8899` are the same server in every human's mind and two
 * different origins to every browser, and a review registered under one refuses
 * the other. That is exactly the trap the dev-server default already avoids by
 * registering both, so a named --origin gets the same treatment; a review
 * session died on this for real (2026-08-17, the reviewer typed localhost, the
 * agent registered 127.0.0.1). Non-loopback origins pass through untouched.
 */
function withLoopbackTwins(list) {
  var out = [];
  (list || []).forEach(function (origin) {
    if (out.indexOf(origin) === -1) out.push(origin);
    var twin = null;
    var atLocalhost = origin.match(/^(https?:\/\/)localhost(:\d+)?$/);
    var atLoopbackIp = origin.match(/^(https?:\/\/)127\.0\.0\.1(:\d+)?$/);
    if (atLocalhost) twin = atLocalhost[1] + "127.0.0.1" + (atLocalhost[2] || "");
    if (atLoopbackIp) twin = atLoopbackIp[1] + "localhost" + (atLoopbackIp[2] || "");
    if (twin && out.indexOf(twin) === -1) out.push(twin);
  });
  return out;
}

// Directories a static page is likely to load its own scripts from. When one
// sits beside the page, the bundle is copied into it and the src is a short
// relative URL; otherwise the src is a relative path back to the repo's dist.
var ASSET_DIR_NAMES = ["assets", "js", "javascripts", "scripts", "static", "public"];

var STATIC_EXTENSIONS = [".html", ".htm"];

var USAGE = [
  "usage: lahe add <file-or-directory> [options]",
  "",
  "  <file-or-directory>  an .html file gets the script line written into it. Anything else",
  "                       (a directory, a layout template) is treated as a dev server and the",
  "                       line is printed with a reminder comment. Before pasting it, wrap the",
  "                       line in your framework's actual development-only conditional.",
  "",
  "  --new                mint a second review even though the file already carries one.",
  "  --review <id>        re-attach this page to a review that already exists, by id. Use it when a",
  "                       rebuild stripped the script line and the page did not match by path.",
  "  --session <id>       enroll or reuse only reviews owned by this open agent session.",
  "  --remove             take the script line back out of the page and change nothing else.",
  "                       The review's history stays where it is; see `Removing it` in the README.",
  "  --origin <origin>    an origin to register for this review. Repeatable. A static file needs",
  "                       none: a page opened from disk sends the origin " + FILE_ORIGIN + ".",
  "  --source <path>      where this page's source lives, so an agent edits the template rather",
  "                       than build output the next build overwrites.",
  "  --port <n>           the helper's port. Default " + protocol.DEFAULT_PORT + ", which is fixed on purpose:",
  "                       the page carries it in its script tag and has no way to learn a new one.",
  "  --state-dir <path>   where the helper keeps its data. Default $LAHE_STATE_DIR, then",
  "                       $XDG_STATE_HOME/lahe, then ~/.local/state/lahe."
].join("\n");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  var list = argv || [];
  var options = {
    target: null,
    isNew: false,
    remove: false,
    origins: [],
    source: null,
    review: null,
    session: null,
    // Internal only, never in USAGE: `lahe review` sets this on the argv it
    // hands to `add` when it already owns and printed the served URL itself
    // (its own "server"/"open" lines). It means one thing, said two ways.
    //
    // It tells this command to hold back the "Open it" / "Fallback: file://"
    // block below, which is otherwise a second, less confident URL competing
    // with the one `review` already printed. A reviewer who is handed both
    // pastes both, and the same document forks into two page identities
    // (observed 2026-08-18).
    //
    // And it means A SERVER OF OURS IS ANSWERING FOR THIS PAGE, so nothing is
    // written into the reviewer's own folder: no script line into the file, no
    // copy of the bundle beside it. The server puts the line into the response
    // and serves the bundle from its own reserved route
    // (src/service/static_servers.js). `review` only ever sets this flag in the
    // same block where it starts that server, so the two facts arrive together.
    underReview: false
  };
  var index = 0;

  function takeValue(name, inline) {
    if (inline !== null) return inline;
    index += 1;
    var value = list[index];
    if (value === undefined) throw new Error(name + " takes a value");
    return value;
  }

  try {
    for (; index < list.length; index += 1) {
      var arg = list[index];
      var name = arg;
      var inline = null;
      var eq = arg.indexOf("=");
      if (arg.indexOf("--") === 0 && eq !== -1) {
        name = arg.slice(0, eq);
        inline = arg.slice(eq + 1);
      }

      if (name === "--help" || name === "-h") return { ok: false, help: true, message: USAGE };
      if (name === "--under-review") {
        options.underReview = true;
      } else if (name === "--new") {
        options.isNew = true;
      } else if (name === "--remove") {
        options.remove = true;
      } else if (name === "--origin") {
        options.origins.push(takeValue("--origin", inline));
      } else if (name === "--review") {
        options.review = takeValue("--review", inline);
      } else if (name === "--session") {
        options.session = takeValue("--session", inline);
      } else if (name === "--source") {
        options.source = takeValue("--source", inline);
      } else if (name === "--port") {
        var port = Number(takeValue("--port", inline));
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return { ok: false, message: "--port takes a port number" };
        }
        options.port = port;
      } else if (name === "--state-dir") {
        options.stateDir = takeValue("--state-dir", inline);
      } else if (arg.indexOf("-") === 0) {
        return { ok: false, message: "unknown option " + arg + "\n\n" + USAGE };
      } else if (options.target === null) {
        options.target = arg;
      } else {
        return {
          ok: false,
          message: "add takes one target, and it was given two: " + options.target + " and " + arg + "\n\n" + USAGE
        };
      }
    }
  } catch (err) {
    return { ok: false, message: err.message + "\n\n" + USAGE };
  }

  if (options.target === null) {
    return { ok: false, message: "add needs something to add the library to.\n\n" + USAGE };
  }
  if (options.review !== null && !protocol.isSafeId(options.review)) {
    return { ok: false, message: "--review must be a review id: " + String(protocol.SAFE_ID) + "\n\n" + USAGE };
  }
  if (options.session !== null && !protocol.isSafeId(options.session)) {
    return { ok: false, message: "--session must be an agent session id: " + String(protocol.SAFE_ID) + "\n\n" + USAGE };
  }
  if (options.review !== null && options.isNew) {
    return { ok: false, message: "--review names a review to re-attach to and --new mints a fresh one; pick one.\n\n" + USAGE };
  }
  return { ok: true, options: options };
}

// ---------------------------------------------------------------------------
// The script line, and where it goes in a file
// ---------------------------------------------------------------------------

// The script line inside the file: finding it, placing it, replacing it, taking
// it out. THE LOGIC LIVES IN src/shared/script_line.js, because the helper heals
// a page a rebuild stripped the line out of and has to write the same line in
// the same place (src/service/heal.js). These names are re-exported below so
// callers and tests keep reaching them here.
var EXISTING_TAG = scriptLine.EXISTING_TAG;
var placeScriptLine = scriptLine.placeScriptLine;
var replaceScriptLine = scriptLine.replaceScriptLine;
var removeScriptLine = scriptLine.removeScriptLine;
var reviewAlreadyInFile = scriptLine.reviewAlreadyInFile;

// ---------------------------------------------------------------------------
// Where the built library is, from the page's point of view
// ---------------------------------------------------------------------------

/**
 * The `src` every script line carries: the helper's own URL. One URL for a
 * static file and for a dev server alike, because it resolves from any folder,
 * origin and depth, which a relative path does not.
 *
 * @param {string} helperOrigin
 * @returns {string}
 */
function libraryUrl(helperOrigin) {
  return helperOrigin + protocol.route("library.get").path;
}

/**
 * The offline half: a copy of the built library beside the page, refreshed on
 * every run so it tracks dist.
 *
 * Beside the page, not in an assets directory it went hunting for. Anything
 * serving the page's own folder serves this file too, at the same relative
 * name, and a page opened straight from disk resolves it as a sibling file. It
 * is only ever reached when the primary src fails, which is the helper being
 * down.
 *
 * @param {string} pagePath the .html file the line is being written into
 * @returns {{path: string, src: string}} where the copy went, and the relative
 *          src the script line names it by
 */
function copyLibraryBeside(pagePath) {
  var copied = path.join(path.dirname(pagePath), BUNDLE_BASENAME);
  fs.copyFileSync(BUNDLE, copied);
  return { path: copied, src: BUNDLE_BASENAME };
}

// What a dev server's fallback names. `add` never writes into an application's
// own directories (the same rule that keeps it from editing a layout), so this
// is a CONVENTION printed for a human to confirm, not a fact this command
// checked: most servers publish public/ or static/ at the root.
var DEV_FALLBACK_SRC = "/" + BUNDLE_BASENAME;

function toUrlPath(value) {
  return value.split(path.sep).join("/");
}

function assetDirBeside(dir) {
  for (var i = 0; i < ASSET_DIR_NAMES.length; i += 1) {
    var candidate = path.join(dir, ASSET_DIR_NAMES[i]);
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch (err) {
      // Not there. Next.
    }
  }
  return null;
}

/**
 * CLEANUP NEEDED: assetDirBeside above, and libraryForServer and libraryFor
 * below, are no longer called. They went hunting for an assets directory to
 * copy the bundle into and wrote the src relative to whatever they found, which
 * is the resolution failure the helper URL replaces. The offline half is back,
 * but it is the plain sibling copy (copyLibraryBeside) rather than this
 * hunting, so these three stay dead. They are left in place (not deleted)
 * pending a cleanup pass, together with ASSET_DIR_NAMES, which only they read.
 *
 * The `src` to print for a dev server, when the target is a project directory.
 *
 * A URL, not a path: the browser resolves it against the server, not against the
 * filesystem. Which URL depends on which directory the copy went into, and that
 * is a CONVENTION, not a fact this command can check, so it is printed as
 * something to confirm rather than asserted.
 */
function libraryForServer(rootDir) {
  var assets = assetDirBeside(rootDir);
  if (!assets) {
    return { src: toUrlPath(BUNDLE), copiedTo: null, note: null };
  }
  var name = path.basename(assets);
  var copied = path.join(assets, BUNDLE_BASENAME);
  fs.copyFileSync(BUNDLE, copied);
  var servedAtRoot = name === "public" || name === "static";
  return {
    src: servedAtRoot ? "/" + BUNDLE_BASENAME : "/" + name + "/" + BUNDLE_BASENAME,
    copiedTo: copied,
    note:
      "Copied the built library into " +
      name +
      "/, which most servers publish at " +
      (servedAtRoot ? "/" + BUNDLE_BASENAME : "/" + name + "/" + BUNDLE_BASENAME) +
      ". Check that URL loads before you review"
  };
}

/**
 * The `src` the script line carries, for a static page.
 *
 * D1 allows either "a path" or "a copy in the page's own assets", and the choice
 * here is: A COPY WHEN THE PAGE ALREADY HAS AN ASSETS DIRECTORY, otherwise a
 * relative path back to the repo's built bundle. The reason is that a page with
 * an assets directory is usually a thing that gets moved or served as a unit,
 * and a relative path back into a clone breaks the moment it is; a lone .html
 * file on a desktop has nowhere to put a copy and does not want one.
 */
function libraryFor(pageDir) {
  var assets = assetDirBeside(pageDir);
  if (assets) {
    var copied = path.join(assets, BUNDLE_BASENAME);
    fs.copyFileSync(BUNDLE, copied);
    return {
      src: toUrlPath(path.relative(pageDir, copied)),
      note: "Copied the built library into " + toUrlPath(path.relative(pageDir, assets)) + "/",
      copiedTo: copied
    };
  }
  // A relative path back into the clone, unless the page is far enough away that
  // the path is a wall of `../`. A page opened from disk resolves a leading `/`
  // against the filesystem root, so the absolute path is correct there and is
  // the readable one; a static .html file IS a page opened from disk.
  var relative = toUrlPath(path.relative(pageDir, BUNDLE));
  var climbs = relative.split("/").filter(function (part) {
    return part === "..";
  }).length;
  return {
    src: climbs > 4 ? toUrlPath(BUNDLE) : relative,
    note: "The script line points at the built library in this clone",
    copiedTo: null
  };
}

// ---------------------------------------------------------------------------
// The helper
// ---------------------------------------------------------------------------

function readReadyFile(dir) {
  var readyPath = stateDirModule.readyPath(dir);
  if (!fs.existsSync(readyPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(readyPath, "utf8"));
  } catch (err) {
    return null;
  }
}

/** Everything meta.json holds for one review, or null. */
function readMetaOnDisk(dir, reviewId) {
  var metaPath;
  try {
    metaPath = stateDirModule.metaPath(dir, reviewId);
  } catch (err) {
    return null;
  }
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (err) {
    return null;
  }
}

/**
 * The review this page already belongs to, matched by the path it was added at.
 *
 * A REBUILD STRIPS THE SCRIPT LINE, and with it the only copy of the review's
 * identity, so the next `add` minted a fresh review and one document's history
 * ended up split across three of them. Every review now records the resolved
 * absolute target path (and the --source path) in its meta.json, and this looks
 * through them. Reviews written before that field existed carry neither and
 * simply never match, which is the intended fallback.
 *
 * The newest matching review wins, so a `--new` from last week does not
 * out-rank the one being worked on today.
 *
 * @returns {string|null} the review id
 */
function reviewMatchingPath(dir, target, agentSessionId) {
  var root;
  try {
    root = stateDirModule.reviewsRoot(dir);
  } catch (err) {
    return null;
  }
  if (!fs.existsSync(root)) return null;
  var best = null;
  fs.readdirSync(root, { withFileTypes: true }).forEach(function (entry) {
    if (!entry.isDirectory() || !protocol.isSafeId(entry.name)) return;
    var meta = readMetaOnDisk(dir, entry.name);
    if (!meta || typeof meta.token !== "string") return;
    var owner = typeof meta.agent_session_id === "string" ? meta.agent_session_id : agentSessionsModule.LEGACY_ID;
    if (agentSessionId && owner !== agentSessionId) return;
    var retainedTargets = Array.isArray(meta.target_paths) ? meta.target_paths : [];
    if (
      meta.target_path !== target &&
      meta.source_path !== target &&
      retainedTargets.indexOf(target) === -1
    ) {
      return;
    }
    var at = meta.created_at || "";
    if (!best || at > best.at) best = { id: entry.name, at: at };
  });
  return best ? best.id : null;
}

/**
 * Hand the running helper the writes for a review IT ALREADY HOLDS.
 *
 * This is the whole no-restart-for-a-held-review path. The helper is the single
 * writer of that review's events.jsonl, so `add` does not touch it: it posts
 * what needs writing and the helper applies it. Stopping the helper instead
 * would disconnect every review page using that helper mid-session.
 *
 * The origin presented here is one the review has ALREADY REGISTERED, read from
 * service.json, not one this run wants to add. The helper checks the header
 * against the review's allowlist, so presenting a brand-new `--origin` (or the
 * two defaults a bare re-run falls back to) got a 403 and forced exactly the
 * restart this route exists to avoid. The new
 * origins still travel in the body, which is what registers them.
 *
 * @param {string[]} registeredOrigins the origins the helper already holds for
 *        this review
 * @returns {Promise<boolean>} true when the helper applied the writes
 */
async function helperAppliedWrites(host, port, review, registeredOrigins, writes) {
  var target = "http://" + host + ":" + port + protocol.route("review.write").path;
  var headers = {};
  headers[protocol.HEADER.CLIENT] = protocol.CLIENT_CLI;
  headers[protocol.HEADER.TOKEN] = review.token;
  headers[protocol.HEADER.CONTENT_TYPE] = protocol.JSON_CONTENT_TYPE;
  var registered = Array.isArray(registeredOrigins) ? registeredOrigins : [];
  if (registered.length > 0) headers[protocol.HEADER.ORIGIN] = registered[0];
  var body = Object.assign({ review: review.id }, writes);
  try {
    var res = await fetch(target, { method: "POST", headers: headers, body: JSON.stringify(body) });
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

/** The token a review was minted with, straight off disk, or null. */
function readTokenOnDisk(dir, reviewId) {
  var metaPath;
  try {
    metaPath = stateDirModule.metaPath(dir, reviewId);
  } catch (err) {
    return null;
  }
  if (!fs.existsSync(metaPath)) return null;
  try {
    var parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return parsed && typeof parsed.token === "string" ? parsed.token : null;
  } catch (err) {
    return null;
  }
}

/**
 * Does the helper that is answering right now already hold this review, with
 * this token and every origin we need?
 *
 * It is read from service.json rather than asked over the wire because there is
 * no route that answers it: `health` carries no review data on purpose, and the
 * routes that do are behind the very token being checked. service.json is
 * written by the helper AFTER its listener binds and lists every review it holds
 * with that review's token and origins, so it is the helper's own account of
 * itself rather than a guess.
 */
function helperHolds(ready, reviewId, token, origins) {
  if (!ready || !ready.reviews || !token) return false;
  var held = ready.reviews[reviewId];
  if (!held || held.token !== token) return false;
  var registered = held.origins || [];
  return origins.every(function (origin) {
    return registered.indexOf(origin) !== -1;
  });
}

function delay(ms) {
  // harness-allow-timer: this is the retry interval of a condition poll, not a
  // wait-and-hope. The condition is "the port answers" / "the port stopped
  // answering", and both are read every pass.
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function pollFor(check, timeoutMs, what) {
  var deadline = Date.now() + timeoutMs;
  for (;;) {
    var value = await check();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error("gave up after " + timeoutMs + "ms waiting for " + what);
    }
    await delay(50);
  }
}

async function stopHelper(ready, host, port, live) {
  // Finding 23: signal a pid ONLY when we have confirmed it is the helper
  // service.json describes. A lahe helper writes its pid AND its start instant
  // into service.json when it binds, and returns that same instant on /health.
  // If the helper answering now was started at a different instant than
  // service.json records, service.json is stale and its pid may since have been
  // reused by an unrelated process, so we refuse to kill it.
  if (!ready || typeof ready.pid !== "number") {
    throw new Error(
      "cannot stop the helper on " + host + ":" + port + ": " + stateDirModule.readyPath(ready && ready.dir ? ready.dir : "") +
        " names no pid. Stop it yourself, then run add again."
    );
  }
  if (live && live.started_at && ready.started_at && live.started_at !== ready.started_at) {
    throw new Error(
      "refusing to signal pid " +
        ready.pid +
        ": the server answering on " +
        host +
        ":" +
        port +
        " reports it started at " +
        live.started_at +
        " but service.json records " +
        ready.started_at +
        ". service.json is stale and its pid may now belong to another process. " +
        "Stop whatever holds the port yourself, then run add again."
    );
  }
  try {
    process.kill(ready.pid, "SIGTERM");
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
  }
  await pollFor(
    async function () {
      var up = await service.probeHealth(host, port);
      return up ? null : true;
    },
    10000,
    "the running helper on " + host + ":" + port + " to stop answering"
  );
}

async function startHelper(host, port, dir) {
  var child = childProcess.spawn(
    process.execPath,
    [BIN, "serve", "--port", String(port), "--state-dir", dir],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
  return pollFor(
    function () {
      return service.probeHealth(host, port);
    },
    15000,
    "the helper to answer on " + host + ":" + port + ". Run `lahe serve` yourself to see why it did not start"
  );
}

/**
 * Confirm the server answering on this port is the helper we just started, not
 * a squatter that grabbed the port during the restart window (finding 21).
 *
 * probeHealth alone accepts any local server that answers {ok:true}, so on its
 * own it would let a squatter that binds the freed port collect the review's
 * token off the script line. A lahe helper writes its start instant into the
 * OWNER-ONLY service.json when it binds and returns the same instant on /health;
 * a bare {ok:true} squatter cannot make those two agree without reading a file
 * only the owner can read. A match is therefore good evidence the port holds our
 * helper. This is best effort, not a boundary: a same-user process that can read
 * service.json can still echo the value, which is the stated residual in D11.
 */
/**
 * Ask the running helper for a review that was just written to disk.
 *
 * This is the whole no-restart path. There is no create-review route (on
 * purpose), so the helper learns a new review by finding it on disk when it is
 * asked about one it does not hold. A 200 here is that having happened: the
 * helper answered for the review, with this review's token, which it could only
 * do by reading the meta.json `add` wrote a moment ago. Anything else means it
 * did not learn the review, and the caller falls back to a restart and says so.
 *
 * A command-line process has no origin of its own, so it presents one this
 * review just registered.
 */
async function helperLearnedReview(host, port, review, origins) {
  var target =
    "http://" + host + ":" + port + protocol.route("review.read").path + "?review=" + encodeURIComponent(review.id);
  var headers = {};
  headers[protocol.HEADER.CLIENT] = protocol.CLIENT_CLI;
  headers[protocol.HEADER.TOKEN] = review.token;
  if (origins.length > 0) headers[protocol.HEADER.ORIGIN] = origins[0];
  try {
    var res = await fetch(target, { method: "GET", headers: headers });
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

async function confirmOurHelper(host, port, dir, what) {
  return pollFor(
    async function () {
      var ready = readReadyFile(dir);
      var live = await service.probeHealth(host, port);
      if (!ready || !ready.started_at || !live || !live.started_at) return null;
      return ready.started_at === live.started_at ? live : null;
    },
    10000,
    what
  );
}

// ---------------------------------------------------------------------------
// What gets printed
// ---------------------------------------------------------------------------

function tokenWarning(where) {
  return [
    "  A per-review token is in " + where + ".",
    "  A token inside a repository can be committed and shared with everyone who reads the file.",
    "  It opens this one review's feedback and nothing else: not your machine, not another review."
  ].join("\n");
}

/**
 * What happened to the helper this run, in the words that go on the `helper`
 * line. A restart because the helper predated this clone's code reads
 * differently from a restart to teach it a review, and the reviewer whose page
 * just blinked is owed the real reason.
 *
 * @param {{started: boolean, staleRestart: boolean, restarted: boolean, learned: boolean, handedToHelper: boolean}} state
 */
function helperNote(state) {
  if (state.started) return "  (started just now)";
  if (state.staleRestart) return "  (restarted: " + sourceStamp.REASON + ")";
  if (state.restarted) return "  (restarted, so it knows this review)";
  if (state.learned) return "  (already running, and it picked this review up without a restart)";
  if (state.handedToHelper) {
    return "  (already running and holding this review, so it did the writing itself: no bounce)";
  }
  return "  (already running)";
}

function commentedSnippet(tag) {
  return [
    "<!-- lahe setup note: this comment is not a development guard.",
    "     Wrap the script in your framework's actual development-only conditional before pasting it.",
    "     It carries a per-review token. -->",
    tag
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/**
 * Where the reviews live, named if it can be resolved and described if it
 * cannot. `--remove` must work even when the state directory would be refused,
 * because taking a line out of a page has nothing to do with the helper.
 */
function reviewsRootOrPhrase(explicit) {
  try {
    var dir = explicit ? stateDirModule.stateDir({ dir: explicit }) : stateDirModule.stateDir();
    return stateDirModule.reviewsRoot(dir);
  } catch (err) {
    return "the helper's state directory";
  }
}

/** Do two files hold exactly the same bytes? */
function sameBytes(a, b) {
  try {
    return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
  } catch (err) {
    return false;
  }
}

function classify(targetPath) {
  var stat = fs.statSync(targetPath);
  if (stat.isDirectory()) return "dev-server";
  var ext = path.extname(targetPath).toLowerCase();
  return STATIC_EXTENSIONS.indexOf(ext) === -1 ? "dev-server" : "static";
}

/**
 * @param {string[]} argv the arguments after the command name
 * @returns {Promise<number>} the process exit code
 */
async function run(argv) {
  var parsed = parseArgs(argv);
  if (!parsed.ok) {
    process[parsed.help ? "stdout" : "stderr"].write(parsed.message + "\n");
    return parsed.help ? EXIT.OK : EXIT.BAD_USAGE;
  }
  var options = parsed.options;
  var out = [];
  function say(line) {
    out.push(line === undefined ? "" : line);
  }

  var target = path.resolve(options.target);
  if (!fs.existsSync(target)) {
    process.stderr.write("lahe add: there is nothing at " + target + "\n");
    return EXIT.FAILED;
  }
  // --- taking it back out ----------------------------------------------------
  //
  // Before the bundle check, deliberately: uninstalling a page must not depend
  // on the library being built. Nothing here touches the helper or the state
  // directory. The review's history is the reviewer's work, and a flag that
  // edits a page is not the thing that should delete it; the README says how.
  if (options.remove) {
    if (classify(target) !== "static") {
      process.stdout.write(
        [
          "lahe add --remove: " + target,
          "",
          "  Nothing was edited, because `add` never edited this. It printed a line for you to",
          "  paste into your layout: delete that line (the one carrying data-lahe-review) and the",
          "  lahe setup comment above it.",
          ""
        ].join("\n")
      );
      return EXIT.OK;
    }
    var current = fs.readFileSync(target, "utf8");
    var stripped = removeScriptLine(current);
    if (!stripped) {
      process.stdout.write(
        "lahe add --remove: " + target + " carries no lahe script line. Nothing to take out.\n"
      );
      return EXIT.OK;
    }
    fs.writeFileSync(target, stripped.html);

    // THE SIBLING BUNDLE GOES TOO. `--remove` is the command someone runs to
    // get this tool back out of their working tree, and leaving the bundle
    // there ("delete it whenever you like") left the more dangerous half
    // behind: the script line's onerror names it by a RELATIVE path, so a page
    // and a bundle that ship to a deployed site together bring the review rail
    // up for every visitor.
    //
    // Only a byte-identical copy of the library this clone builds is removed.
    // A file of that name that is anything else is somebody's own, and nothing
    // this command was asked to do justifies deleting it.
    var siblingLine = null;
    var sibling = path.join(path.dirname(target), BUNDLE_BASENAME);
    if (fs.existsSync(sibling)) {
      if (!fs.existsSync(BUNDLE)) {
        siblingLine =
          "  " + BUNDLE_BASENAME + " sits beside the page, and this clone has no built library to compare it" +
          "\n  against, so it was left alone.";
      } else if (!sameBytes(sibling, BUNDLE)) {
        siblingLine =
          "  " + BUNDLE_BASENAME + " sits beside the page but is not the library this clone builds, so it is" +
          "\n  somebody else's file and was left alone.";
      } else {
        try {
          fs.unlinkSync(sibling);
          siblingLine = "  Removed " + sibling + ", the fallback copy of the library, byte for byte the built one.";
        } catch (err) {
          siblingLine = "  " + BUNDLE_BASENAME + " sits beside the page and could not be removed (" + err.message + ").";
        }
      }
    }

    process.stdout.write(
      [
        "lahe add --remove: " + target,
        "",
        "  Took out the script line for review " + stripped.review + "."
      ]
        .concat(siblingLine ? [siblingLine] : [])
        .concat([
          "  That review's history is still in " + (reviewsRootOrPhrase(options.stateDir) + "."),
          "  Stop the helper and delete that directory to forget it. See `Removing it` in the README.",
          ""
        ])
        .join("\n")
    );
    return EXIT.OK;
  }

  if (!fs.existsSync(BUNDLE)) {
    process.stderr.write(
      "lahe add: the built library is missing (" +
        BUNDLE +
        ").\nBuild it once with `npm run build:layer`, then run add again.\n"
    );
    return EXIT.FAILED;
  }

  var kind = classify(target);
  var host = protocol.DEFAULT_HOST;
  var port = options.port === undefined ? protocol.DEFAULT_PORT : options.port;
  var helperOrigin = "http://" + host + ":" + port;

  var dir;
  try {
    // An explicit --state-dir runs through the SAME in-checkout refusal as the
    // env-derived default (finding 19). Without this, --state-dir bypassed the
    // guard and a token written into meta.json under a clone could be published
    // by an ordinary `git add -A`.
    dir = options.stateDir
      ? stateDirModule.stateDir({ dir: options.stateDir })
      : stateDirModule.stateDir();
  } catch (err) {
    process.stderr.write("lahe add: " + err.message + "\n");
    return EXIT.FAILED;
  }

  var agentSessionId = options.session || agentSessionsModule.LEGACY_ID;
  if (options.session) {
    try {
      agentSessionsModule.createStore({ dir: dir }).requireOpen(options.session);
    } catch (err) {
      process.stderr.write("lahe add: " + err.message + "\n");
      return EXIT.FAILED;
    }
  }

  // --- the origins this review needs -----------------------------------------
  var namedOrigins = withLoopbackTwins(options.origins);
  var origins;
  var originNote;
  if (kind === "static") {
    origins = [FILE_ORIGIN].concat(namedOrigins);
    originNote =
      origins.join(", ") +
      (options.origins.length > 0
        ? " (" + FILE_ORIGIN + " is what a page opened from disk sends; the rest were named with --origin)"
        : " (a page opened from disk sends no origin, on every browser)");
  } else if (namedOrigins.length > 0) {
    origins = namedOrigins.slice();
    originNote = origins.join(", ");
  } else {
    origins = DEFAULT_DEV_ORIGINS.slice();
    originNote =
      origins.join(", ") + " (nobody said, so these two were registered; re-run with --origin for a different one)";
  }

  // --- which review ----------------------------------------------------------
  //
  // Three ways to land on an existing review, in order: named with --review,
  // carried in the page's own script line, or matched by the target path this
  // review was added at. --new skips all three.
  var page = kind === "static" ? fs.readFileSync(target, "utf8") : null;
  var carried = page === null ? null : reviewAlreadyInFile(page);
  var reuseId = null;
  var reuseWhy = null;

  function liveOnDisk(reviewId) {
    // "A live review" means one whose state is still on disk. A script line
    // pointing at a review whose state is gone is a dead line, and reusing its
    // id would hand the page a token nothing will accept.
    return !!readMetaOnDisk(dir, reviewId);
  }

  function ownershipOf(reviewId) {
    var meta = readMetaOnDisk(dir, reviewId);
    return meta && typeof meta.agent_session_id === "string"
      ? meta.agent_session_id
      : agentSessionsModule.LEGACY_ID;
  }

  function refuseForeign(reviewId) {
    var owner = ownershipOf(reviewId);
    if (owner === agentSessionId) return false;
    process.stderr.write(
      "lahe add: review " + reviewId + " belongs to agent session " + owner +
        ", not " + agentSessionId + ". Start a new review or use the owning session.\n"
    );
    return true;
  }

  if (options.review) {
    if (!liveOnDisk(options.review)) {
      process.stderr.write(
        "lahe add: there is no review " +
          options.review +
          " in " +
          reviewsRootOrPhrase(options.stateDir) +
          ".\nRun `lahe status` to see which reviews exist, or drop --review to start one.\n"
      );
      return EXIT.FAILED;
    }
    if (refuseForeign(options.review)) return EXIT.FAILED;
    reuseId = options.review;
    reuseWhy = "reused, named with --review";
  } else if (carried && !options.isNew && liveOnDisk(carried)) {
    if (refuseForeign(carried)) return EXIT.FAILED;
    reuseId = carried;
    reuseWhy = "reused, already on this page";
  } else if (!carried && !options.isNew) {
    // The rebuild case: this page carries no line, because the build wrote it
    // out fresh. The recorded target path is the identity that survived.
    var matched = reviewMatchingPath(dir, target, agentSessionId);
    if (matched) {
      reuseId = matched;
      reuseWhy = "reused, matched by path";
    }
  }

  var ready = readReadyFile(dir);
  var alive = await service.probeHealth(host, port);

  // --- make the helper hold this review --------------------------------------
  //
  // `add` only ever writes to the state directory with NO helper running, so two
  // processes never append to one events.jsonl and hand out the same seq. When a
  // helper is up and holds the review, the writes go THROUGH it instead.

  var review = null;
  var restarted = false;
  var started = false;
  var learned = false;
  var handedToHelper = false;
  var restartReason = null;
  var staleRestart = false;

  // A helper is intentionally shared across agent types, projects, and agent
  // sessions, which also means a maintainer can keep one alive across a code
  // update. The helper re-reads the browser bundle from disk, but Node keeps
  // its service and projection modules in memory. Without this fence that
  // creates a split product: today's rail talking to yesterday's backend.
  //
  // TWO THINGS SAY THE HELPER IS BEHIND, and only one of them is a number.
  //
  //  1. The service contract. An absent contract is the pre-fence helper and is
  //     safely older. A greater contract means this CLI came from an older
  //     clone; never bounce a newer shared helper backward, because another
  //     live session may depend on it.
  //  2. The files on disk. The contract is hand-bumped, so it catches the
  //     changes somebody remembered to declare and nothing else. On 2026-08-23
  //     the contract text in review_format.js changed, the number did not, and a
  //     two-day-old helper kept writing the old contract into review.json while
  //     everything a human could see looked right. src/service/source_stamp.js
  //     compares the helper's own start instant to the newest mtime of the code
  //     it loaded, which no one has to remember to bump.
  //
  // A helper that is current is left strictly alone: the check only runs when
  // one is answering, and a restart drops every open page's connection for a
  // moment.
  if (alive) {
    var liveContract = Number.isInteger(alive.service_contract) ? alive.service_contract : 0;
    if (liveContract > protocol.SERVICE_CONTRACT) {
      process.stderr.write(
        "lahe add: the running helper uses service contract " + liveContract +
          ", but this clone supports " + protocol.SERVICE_CONTRACT +
          ". Update this clone instead of replacing a newer shared helper.\n"
      );
      return EXIT.FAILED;
    }
    if (liveContract < protocol.SERVICE_CONTRACT) {
      restartReason =
        "the verified helper uses older service contract " + liveContract +
        "; this clone requires " + protocol.SERVICE_CONTRACT;
    } else if (sourceStamp.helperPredatesSource(alive.started_at).stale) {
      restartReason = sourceStamp.REASON;
      staleRestart = true;
    }
    if (restartReason) {
      try {
        await stopHelper(Object.assign({ dir: dir }, ready || {}), host, port, alive);
        restarted = true;
        await startHelper(host, port, dir);
        alive = await confirmOurHelper(
          host,
          port,
          dir,
          "the compatible helper on " + host + ":" + port + " to identify itself"
        );
        ready = readReadyFile(dir);
      } catch (err) {
        process.stderr.write("lahe add: " + err.message + "\n");
        return EXIT.FAILED;
      }
    }
  }

  // The paths that make this review findable again after a rebuild strips the
  // script line out of the page.
  var pathWrites = {
    target_path: target,
    source_path: options.source ? path.resolve(options.source) : null
  };

  /**
   * `add` writing the review itself, which it does ONLY when no helper is
   * appending to that review: either none is running, or the one that is does
   * not hold this review. Two writers on one events.jsonl is the thing the
   * helper-side route exists to avoid.
   */
  function writeToDisk() {
    var log = logModule.createEventLog({ dir: dir });
    var reviews = reviewsModule.createReviews({ dir: dir, log: log });
    reviews.loadFromDisk();
    var spec = {
      origins: origins,
      target_path: pathWrites.target_path,
      source_path: pathWrites.source_path,
      agent_session_id: agentSessionId
    };
    if (reuseId) spec.id = reuseId;
    review = reviews.create(spec);

    // The source hint, recorded rather than only printed. It rides a
    // page.visited event, which is the one event in the closed vocabulary that
    // carries page facts, so the projector puts it on that page's group header
    // and an agent edits the template instead of the build output the next build
    // overwrites.
    if (options.source) {
      log.append(review.id, [
        protocol.newEvent({
          event: protocol.EVENT.PAGE_VISITED,
          event_id: "ev_" + crypto.randomBytes(8).toString("hex"),
          review: review.id,
          page_path: kind === "static" ? path.basename(target) : String(options.target),
          page_seq: 1,
          source_hint: options.source
        })
      ]);
    }
    return review;
  }

  var heldByHelper = !!(alive && reuseId && ready && ready.reviews && ready.reviews[reuseId]);
  var heldToken = heldByHelper ? ready.reviews[reuseId].token : null;

  // Nothing to write at all: the helper holds the review with every origin this
  // run needs, the paths are already recorded, and there is no source hint.
  var heldMeta = heldByHelper ? readMetaOnDisk(dir, reuseId) : null;
  var pathsAlreadyRecorded =
    !!heldMeta &&
    heldMeta.target_path === pathWrites.target_path &&
    (!pathWrites.source_path || heldMeta.source_path === pathWrites.source_path);
  var nothingToWrite =
    heldByHelper && !options.source && pathsAlreadyRecorded && helperHolds(ready, reuseId, heldToken, origins);

  if (nothingToWrite) {
    review = { id: reuseId, token: heldToken };
  } else if (heldByHelper) {
    // THE HELD-REVIEW WRITE. The helper is the single writer of this review's
    // log, so it applies the writes and `add` never stops it. Stopping it here
    // is what used to disconnect the live review page.
    review = { id: reuseId, token: heldToken };
    // What the helper already has registered for this review, straight off its
    // own service.json, is what the request may present as its origin.
    var heldOrigins = (ready.reviews[reuseId] && ready.reviews[reuseId].origins) || [];
    handedToHelper = await helperAppliedWrites(host, port, review, heldOrigins, {
      origins: origins,
      target_path: pathWrites.target_path,
      source_path: pathWrites.source_path,
      source_hint: options.source || null,
      page_path: kind === "static" ? path.basename(target) : String(options.target)
    });
    if (!handedToHelper) {
      // The helper is up and would not take the writes. Only now is a restart
      // on the table, and the reason travels to the output rather than a helper
      // bouncing for no stated cause.
      restartReason = "the running helper did not accept the writes for this review over " + protocol.route("review.write").path;
      try {
        await stopHelper(Object.assign({ dir: dir }, ready), host, port, alive);
      } catch (err) {
        process.stderr.write("lahe add: " + err.message + "\n");
        return EXIT.FAILED;
      }
      restarted = true;
      writeToDisk();
      try {
        await startHelper(host, port, dir);
        await confirmOurHelper(
          host,
          port,
          dir,
          "the server on " + host + ":" + port + " to identify itself as the helper this run started"
        );
      } catch (err) {
        process.stderr.write("lahe add: " + err.message + "\n");
        return EXIT.FAILED;
      }
    }
  } else {
    if (alive && !ready) {
      process.stderr.write(
        "lahe add: something is answering on " +
          helperOrigin +
          " but " +
          stateDirModule.readyPath(dir) +
          " is not there, so it is not this state directory's helper.\n" +
          "Free the port, or run add with --port <n> and put that port on the script tag.\n"
      );
      return EXIT.FAILED;
    }

    // THE RUNNING HELPER LEARNS THIS REVIEW FROM DISK. Nothing else is touching
    // this review's events.jsonl (the helper does not hold it), so writing it
    // beside a running helper cannot collide on a seq, and the helper finds it
    // on disk the first time it is asked about it. A review the helper DOES hold
    // never reaches this branch: it went through review.write above.
    var tryWithoutRestart = !!alive;

    writeToDisk();

    if (tryWithoutRestart) {
      learned = await helperLearnedReview(host, port, review, origins);
      if (!learned) {
        // The helper is up and did not pick the review up. Restarting is the
        // fallback, not the plan, so the reason is carried through to the
        // output rather than a restart happening for no stated cause.
        restartReason = "the helper that was already running did not pick this review up from disk";
        try {
          await stopHelper(Object.assign({ dir: dir }, ready), host, port, alive);
          restarted = true;
          await startHelper(host, port, dir);
          await confirmOurHelper(
            host,
            port,
            dir,
            "the server on " + host + ":" + port + " to identify itself as the helper this run started"
          );
        } catch (err) {
          process.stderr.write("lahe add: " + err.message + "\n");
          return EXIT.FAILED;
        }
      }
    } else {
      try {
        await startHelper(host, port, dir);
        // Finding 21: a plain probeHealth would accept a squatter on the freed
        // port. Confirm the port holds the helper we just started before the
        // token is ever written onto the page.
        await confirmOurHelper(
          host,
          port,
          dir,
          "the server on " + host + ":" + port + " to identify itself as the helper this run started"
        );
      } catch (err) {
        process.stderr.write("lahe add: " + err.message + "\n");
        return EXIT.FAILED;
      }
      started = !restarted;
    }
  }

  // --- the line --------------------------------------------------------------
  //
  // NOTHING IS WRITTEN INTO THE REVIEWER'S FOLDER WHEN A SERVER OF OURS IS
  // ANSWERING FOR THE PAGE. `lahe review` starts that server and sets
  // --under-review; the server puts the script line into the response and
  // serves the library from its own reserved route, so the file on disk keeps
  // no tag, no review id, no token, and no bundle sits beside it. The folder a
  // reviewed page lives in is usually a git checkout, and `git add -A` used to
  // commit both halves; the relative onerror then loaded the rail for every
  // visitor to the deployed site.
  //
  // The two cases with no server to inject for them keep both halves exactly as
  // they were: a plain `lahe add`, and any file:// review.
  var servedInjection = kind === "static" && options.underReview;
  // The copy beside the page is written BEFORE the line that names it, so a
  // page loaded the instant after `add` prints has both halves.
  var librarySrc = libraryUrl(helperOrigin);
  var beside = kind === "static" && !servedInjection ? copyLibraryBeside(target) : null;
  var fallbackSrc = beside ? beside.src : DEV_FALLBACK_SRC;
  var tag = protocol.scriptTag({
    src: librarySrc,
    review: review.id,
    token: review.token,
    helper: helperOrigin,
    fallback: fallbackSrc
  });

  say("lahe add: " + target);
  say();
  say("  review    " + review.id + (reuseId ? "  (" + reuseWhy + ")" : "  (minted just now)"));
  say("  session   " + agentSessionId);
  // The review folder, printed rather than described. Both docs promise `add`
  // names it, and an agent that only has this output has no other way to find
  // review.json: the state directory is derived from environment this command
  // resolved and the agent did not.
  say("  folder    " + stateDirModule.reviewDir(dir, review.id));
  say("  library   " + (servedInjection ? staticServersModule.LIBRARY_PATH : librarySrc));
  say(
    "  fallback  " +
      (servedInjection
        ? librarySrc + "  (the helper; the page's own server serves the library first)"
        : fallbackSrc + (beside ? "  (copied beside the page, refreshed every run)" : "  (your app serves this)"))
  );
  say(
    "  helper    " +
      helperOrigin +
      helperNote({
        started: started,
        staleRestart: staleRestart,
        restarted: restarted,
        learned: learned,
        handedToHelper: handedToHelper
      })
  );
  say("  origin    " + originNote);
  if (options.source) say("  source    " + options.source);
  say();

  if (servedInjection) {
    say("  Nothing was written into " + path.basename(target) + ". The script line goes into the response,");
    say("  put there by the server this review already owns, so no review id and no token land in your folder.");
    say("  That same server publishes the library at " + staticServersModule.LIBRARY_PATH + ", so no copy of it");
    say("  sits beside the page either, and the page still opens with the helper down.");
    if (carried) {
      say();
      say("  This page still carries a script line on disk from an earlier run. It was left exactly as it is.");
      say("  Take it out with: lahe add " + options.target + " --remove");
    }
    say();
  } else if (kind === "static") {
    var placed = reuseId || carried ? replaceScriptLine(page, tag) : placeScriptLine(page, tag);
    if (!placed) placed = placeScriptLine(page, tag);
    fs.writeFileSync(target, placed.html);

    say("  The script line is in " + path.basename(target) + ", " + placed.where + ".");
    say("  The helper serves the library at that URL, so the line works from any folder this page is served out of.");
    say("  " + BUNDLE_BASENAME + " sits beside the page as the fallback, so the page still opens with the helper down:");
    say("  you get the rail, an honest unreachable status, and your work kept in this browser until it is back.");
    say();
    say(tokenWarning(path.basename(target)));
    say();
    // HOW TO OPEN IT. Serving the page over a local http server is the ordinary
    // way to review a static file, so a registered http origin is what gets
    // printed. The URL is stated as LIKELY on purpose: this command registered
    // the origin, but whoever started the server chose its root, so `add` cannot
    // know the path under it.
    var servedOrigins = origins.filter(function (origin) {
      return origin !== FILE_ORIGIN;
    });
    if (servedOrigins.length > 0) {
      say("  Open it:  likely " + servedOrigins[0] + "/" + path.basename(target));
      say("            (whatever your local server publishes this file at)");
      say("  Fallback: file://" + target + ", which works because " + FILE_ORIGIN + " is registered too.");
    } else {
      // THE ORIGIN TRAP, said before it happens. A static file registers "null",
      // which is what a page opened from disk sends. Open the same page through
      // a local server and the browser sends that server's origin instead, the
      // helper refuses every request from it, and the page used to say the
      // helper was unreachable, which blames the wrong thing entirely.
      //
      // file:// is the FALLBACK here too, said that way on purpose: `lahe
      // review` is the ordinary path (it starts a server and prints one URL),
      // and this bare `add` run is the advanced command that skipped it.
      say("  Fallback: file://" + target + "  (works with no server at all; the ordinary path is below)");
      say();
      say("  This review is registered for " + FILE_ORIGIN + " only, which is what a page opened from disk sends.");
      say("  For the ordinary path, let this tool serve the page and print one URL to open:");
      say("    lahe review " + options.target);
      say("  Or register your own server's origin here:");
      say("    lahe add " + options.target + " --origin <origin>   (for example http://127.0.0.1:8000)");
    }
  } else {
    say("  Nothing was edited. This is a commented snippet, not a development guard.");
    say("  Wrap the script in your framework's actual development-only conditional before pasting it:");
    say();
    say(
      commentedSnippet(tag)
        .split("\n")
        .map(function (line) {
          return "    " + line;
        })
        .join("\n")
    );
    say();
    say("  The helper serves the library at that src, so your app serves nothing extra to review with it running.");
    say();
    say("  The onerror line is the fallback, and it only runs when the helper is down. For it to load,");
    say("  copy the built library to whatever your server publishes at " + fallbackSrc + ":");
    say("    cp " + BUNDLE + " <your public directory>/" + BUNDLE_BASENAME);
    say("  Point it somewhere else by editing " + protocol.SCRIPT_ATTR.FALLBACK + " on the line. Skip it and you");
    say("  lose only the helper-is-down case: the page then loads nothing at all while the helper is off.");
    say("  A strict development CSP can refuse an inline onerror (script-src without 'unsafe-inline').");
    say("  The primary src still loads there, so the fallback is what you lose, not the review.");
    say();
    say(tokenWarning("the line above, and it goes into a file in your repository"));
    say();
    say(
      origins.length === 1
        ? "  Then open your dev server on " + origins[0] + "."
        : "  Then open your dev server on one of: " + origins.join(", ")
    );
    say("  A different origin is one more add away: lahe add " + options.target + " --origin <origin>");
  }

  // A restart is never silent. It drops the connection under every review page
  // that is open, and the reviewer watching their status line change is owed the
  // reason in plain words rather than a mystery blink.
  if (restarted) {
    say();
    if (staleRestart) {
      say("  " + sourceStamp.reasonSentence(", so it was stopped and started again."));
      say("  Any review page open right now goes unreachable for a moment and reconnects on its own.");
    } else {
      if (restartReason) say("  " + restartReason.charAt(0).toUpperCase() + restartReason.slice(1) + ", so it was started again.");
      say("  The helper was already running and was started again so it holds this review.");
    }
    say("  Nothing was lost: the log is append-only, tokens survive a restart, and any page still");
    say("  open re-posts what it was holding as soon as it reconnects.");
  }

  if (options.source) {
    say();
    say("  Source hint recorded: " + options.source);
    say("  An agent edits that, not this page, when this page is build output.");
  }

  process.stdout.write(out.join("\n") + "\n");
  return EXIT.OK;
}

module.exports = {
  USAGE: USAGE,
  EXIT: EXIT,
  FILE_ORIGIN: FILE_ORIGIN,
  DEFAULT_DEV_ORIGINS: DEFAULT_DEV_ORIGINS,
  ASSET_DIR_NAMES: ASSET_DIR_NAMES,
  withLoopbackTwins: withLoopbackTwins,
  parseArgs: parseArgs,
  placeScriptLine: placeScriptLine,
  replaceScriptLine: replaceScriptLine,
  removeScriptLine: removeScriptLine,
  reviewAlreadyInFile: reviewAlreadyInFile,
  classify: classify,
  run: run
};
