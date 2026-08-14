// `lahe add`: put the library on a page, mint that review's token, and make
// sure a helper is up. This is the install.
//
// Owner: 3B. Architecture D1 (one file in the page, one process beside it) and
// D11's add-step half: the add step mints the per-review token, embeds it on the
// script line, and registers the page's origin, so the allowlist is built by the
// same deliberate act that adds the library and the reviewer does nothing extra.
//
//   lahe add <file-or-directory> [--new] [--origin <origin>] [--source <path>]
//            [--port <n>] [--state-dir <path>]
//
// FOUR THINGS HAPPEN, IN THIS ORDER, AND THE ORDER MATTERS.
//
//  1. The target is read and classified. An .html file is a static page and gets
//     the line written into it. Anything else (a directory, a layout template)
//     is a dev server, and the line is PRINTED for a human to paste into a
//     layout behind a development-only guard. `add` never edits application
//     code: a token committed inside a layout is worse than a paste.
//  2. The review is settled. A static file that already carries a script line
//     for a review the helper still knows REUSES that review; nothing is minted
//     and the token on the page keeps working. `--new` mints a second review and
//     replaces the line.
//  3. The helper is made to know about it. `serve` is idempotent, so `add`
//     starts one when none is answering, which is what makes the install one
//     command (AC6). A helper that IS answering but was started before this
//     review existed cannot learn about it over the wire (there is no
//     create-review route, on purpose), so it is stopped and started again. That
//     is safe and it is said out loud: the log is append-only, tokens persist
//     across restarts, and the library re-posts anything unacknowledged.
//  4. Only then is the script line written, so a page loaded the instant after
//     `add` prints has a helper that will accept it.
//
// THE SCRIPT LINE POINTS AT THE BUILT LIBRARY, NEVER AT THE HELPER (D1). If the
// helper served the library, "the library works alone" would be false the first
// time the helper was down.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");
var childProcess = require("node:child_process");

var protocol = require("../../shared/protocol.js");
var manifest = require("../../shared/manifest.js");
var stateDirModule = require("../../service/state_dir.js");
var logModule = require("../../service/log.js");
var reviewsModule = require("../../service/reviews.js");
var service = require("../../service/index.js");

var REPO_ROOT = path.join(__dirname, "..", "..", "..");
var BIN = path.join(REPO_ROOT, "bin", "lahe.js");
var BUNDLE = path.join(REPO_ROOT, manifest.BUNDLE_OUTPUT);
var BUNDLE_BASENAME = path.basename(manifest.BUNDLE_OUTPUT);

// Exit codes. `add` is not `wait`, so it does not borrow `wait`'s five; it uses
// the two ordinary ones plus the shared "you typed it wrong".
var EXIT = {
  OK: 0,
  FAILED: 1,
  BAD_USAGE: protocol.WAIT.EXIT.BAD_USAGE
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
  "                       line is printed for you to paste, inside a development-only guard.",
  "",
  "  --new                mint a second review even though the file already carries one.",
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
  var options = { target: null, isNew: false, origins: [], source: null };
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

      if (name === "--help" || name === "-h") return { ok: false, message: USAGE };
      if (name === "--new") {
        options.isNew = true;
      } else if (name === "--origin") {
        options.origins.push(takeValue("--origin", inline));
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
  return { ok: true, options: options };
}

// ---------------------------------------------------------------------------
// The script line, and where it goes in a file
// ---------------------------------------------------------------------------

// Every script tag `add` has ever written, found by the attribute that only it
// writes. The attribute list cannot contain a `>`, so a negated class is enough
// and it spans the newlines the pinned form has in it.
var EXISTING_TAG = /<script\b[^>]*data-lahe-review="([^"]*)"[^>]*>\s*<\/script>/i;

function indentBlock(text, indent) {
  if (!indent) return text;
  return text
    .split("\n")
    .map(function (line, i) {
      return i === 0 ? line : indent + line;
    })
    .join("\n");
}

/** The whitespace at the start of the line `index` falls on. */
function indentAt(html, index) {
  var lineStart = html.lastIndexOf("\n", index - 1) + 1;
  var match = /^[ \t]*/.exec(html.slice(lineStart, index));
  return match ? match[0] : "";
}

/**
 * Where a new script line goes, and what the file looks like with it there.
 *
 * THE POSITION RULE, in order:
 *   1. Immediately before the LAST `</body>`, on its own line, at that tag's
 *      indentation. Last, not first, because a page that quotes `</body>` in
 *      prose or in a nested template still ends at the real one.
 *   2. Failing that, before the last `</html>`, same rule. A fragment with no
 *      body still has a document end.
 *   3. Failing both, appended, with a trailing newline. A fragment included by
 *      something else is a real thing to review and the line still runs.
 *
 * `defer` is on the tag, so the position is about being unmissable to a human
 * reading the file, not about execution order.
 */
function placeScriptLine(html, tag) {
  var closers = [/<\/body\s*>/gi, /<\/html\s*>/gi];
  for (var i = 0; i < closers.length; i += 1) {
    var last = null;
    var regex = closers[i];
    var found;
    regex.lastIndex = 0;
    while ((found = regex.exec(html)) !== null) last = found;
    if (last) {
      var at = last.index;
      var indent = indentAt(html, at);
      var lineStart = html.lastIndexOf("\n", at - 1) + 1;
      var block = indent + indentBlock(tag, indent) + "\n";
      return {
        html: html.slice(0, lineStart) + block + html.slice(lineStart),
        where: i === 0 ? "just before </body>" : "just before </html>",
        indent: indent
      };
    }
  }
  var tail = html.length === 0 || html.slice(-1) === "\n" ? "" : "\n";
  return { html: html + tail + tag + "\n", where: "at the end of the file", indent: "" };
}

/** Replace the tag already in the file, keeping its position and indentation. */
function replaceScriptLine(html, tag) {
  var found = EXISTING_TAG.exec(html);
  if (!found) return null;
  var indent = indentAt(html, found.index);
  return {
    html: html.slice(0, found.index) + indentBlock(tag, indent) + html.slice(found.index + found[0].length),
    where: "in the place it already had",
    indent: indent
  };
}

function reviewAlreadyInFile(html) {
  var found = EXISTING_TAG.exec(html);
  return found ? found[1] : null;
}

// ---------------------------------------------------------------------------
// Where the built library is, from the page's point of view
// ---------------------------------------------------------------------------

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

function guardedSnippet(tag) {
  return [
    "<!-- lahe: development only. Remove this before you ship, or wrap it in your framework's",
    "     development-only conditional. It carries a per-review token. -->",
    tag
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

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
    process.stderr.write(parsed.message + "\n");
    return EXIT.BAD_USAGE;
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

  // --- the origins this review needs -----------------------------------------
  var origins;
  var originNote;
  if (kind === "static") {
    origins = [FILE_ORIGIN].concat(options.origins);
    originNote = FILE_ORIGIN + " (a page opened from disk sends no origin, on every browser)";
  } else if (options.origins.length > 0) {
    origins = options.origins.slice();
    originNote = origins.join(", ");
  } else {
    origins = DEFAULT_DEV_ORIGINS.slice();
    originNote =
      origins.join(", ") + " (nobody said, so these two were registered; re-run with --origin for a different one)";
  }

  // --- which review ----------------------------------------------------------
  var page = kind === "static" ? fs.readFileSync(target, "utf8") : null;
  var carried = page === null ? null : reviewAlreadyInFile(page);
  var reuseId = null;
  if (carried && !options.isNew) {
    // "A live review" means one the helper still has on disk. A script line
    // pointing at a review whose state is gone is a dead line, and reusing its
    // id would hand the page a token nothing will accept.
    var metaPath = null;
    try {
      metaPath = stateDirModule.metaPath(dir, carried);
    } catch (err) {
      metaPath = null;
    }
    if (metaPath && fs.existsSync(metaPath)) reuseId = carried;
  }

  var ready = readReadyFile(dir);
  var alive = await service.probeHealth(host, port);

  // --- make the helper hold this review --------------------------------------
  //
  // Everything that writes to the state directory happens with NO helper
  // running, so two processes never append to one events.jsonl and hand out the
  // same seq.

  var review = null;
  var restarted = false;
  var started = false;

  // The one case where nothing has to be written and nothing has to be
  // restarted: the page already carries a live review, the helper is up, and it
  // already holds that review with every origin this run needs. A source hint is
  // a write, so it takes the long path with everything else.
  var nothingToWrite =
    reuseId &&
    alive &&
    !options.source &&
    helperHolds(ready, reuseId, readTokenOnDisk(dir, reuseId), origins);

  if (nothingToWrite) {
    review = { id: reuseId, token: ready.reviews[reuseId].token };
  } else {
    if (alive) {
      if (!ready) {
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
      try {
        await stopHelper(Object.assign({ dir: dir }, ready), host, port, alive);
      } catch (err) {
        process.stderr.write("lahe add: " + err.message + "\n");
        return EXIT.FAILED;
      }
      restarted = true;
    }

    var log = logModule.createEventLog({ dir: dir });
    var reviews = reviewsModule.createReviews({ dir: dir, log: log });
    reviews.loadFromDisk();
    review = reviews.create(reuseId ? { id: reuseId, origins: origins } : { origins: origins });

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

  // --- the line --------------------------------------------------------------
  var library =
    kind === "static"
      ? libraryFor(path.dirname(target))
      : fs.statSync(target).isDirectory()
        ? libraryForServer(target)
        : { src: toUrlPath(BUNDLE), copiedTo: null, note: null };
  var tag = protocol.scriptTag({
    src: library.src,
    review: review.id,
    token: review.token,
    helper: helperOrigin
  });

  say("lahe add: " + target);
  say();
  say("  review    " + review.id + (reuseId ? "  (reused, already on this page)" : "  (minted just now)"));
  // The review folder, printed rather than described. Both docs promise `add`
  // names it, and an agent that only has this output has no other way to find
  // review.json: the state directory is derived from environment this command
  // resolved and the agent did not.
  say("  folder    " + stateDirModule.reviewDir(dir, review.id));
  say("  library   " + library.src);
  say(
    "  helper    " +
      helperOrigin +
      (started ? "  (started just now)" : restarted ? "  (restarted, so it knows this review)" : "  (already running)")
  );
  say("  origin    " + originNote);
  if (options.source) say("  source    " + options.source);
  say();

  if (kind === "static") {
    var placed = reuseId || carried ? replaceScriptLine(page, tag) : placeScriptLine(page, tag);
    if (!placed) placed = placeScriptLine(page, tag);
    fs.writeFileSync(target, placed.html);

    say("  The script line is in " + path.basename(target) + ", " + placed.where + ".");
    say("  " + library.note + ".");
    say();
    say(tokenWarning(path.basename(target)));
    say();
    say("  Open it:  file://" + target);
  } else {
    say("  Nothing was edited. Paste this into your layout, inside a development-only guard:");
    say();
    say(
      guardedSnippet(tag)
        .split("\n")
        .map(function (line) {
          return "    " + line;
        })
        .join("\n")
    );
    say();
    if (library.copiedTo) {
      say("  " + library.note + ".");
    } else {
      say("  Your app has to serve the built library. It is at:");
      say("    " + BUNDLE);
      say("  Copy it into whatever directory your app serves static files from, and change src to");
      say("  the URL it is served at.");
    }
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

  if (restarted) {
    say();
    say("  The helper was already running and was started again so it holds this review.");
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
  parseArgs: parseArgs,
  placeScriptLine: placeScriptLine,
  replaceScriptLine: replaceScriptLine,
  reviewAlreadyInFile: reviewAlreadyInFile,
  classify: classify,
  run: run
};
