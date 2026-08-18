// `lahe wait`: block until a review has new work, print it, print the cursor.
//
// Owner: 3A. Built whole to protocol.js's specification (protocol.WAIT), which
// is where the usage line, the watermark field, the output form, the default
// timeout and the five exit codes live. Nothing about the contract is restated
// here; this file is the command that obeys it.
//
// THE FOUR PROMISES, each of which is a line below rather than a paragraph:
//
//  1. IT CONSUMES NOTHING AND ACKNOWLEDGES NOTHING. It writes no file, moves no
//     cursor of its own, and changes no item. A killed wait, a repeated wait,
//     and two agents waiting at once are all harmless, and two waiters on one
//     review both wake. The only way to say an item is handled is to append a
//     reply line.
//
//  2. THE CURSOR IS A `seq` FROM THE LOG. Never a timestamp: two events in one
//     millisecond are ordinary, and a clock that steps backwards would silently
//     skip work. `--since` takes the cursor the last run printed.
//
//  3. THE OUTPUT IS JSON LINES. One line per item that is new, carrying the
//     same fields the item carries in review.json, page text in the same
//     data-named fields, followed by one line holding the next cursor. A shell
//     pipeline and an agent read the same bytes.
//
//  4. DRAFTS NEVER COUNT AS NEW. That rule is protocol.countsAsNew's and the
//     helper's `wait` route applies it; this file never second-guesses it.
//
// WHERE THE CREDENTIAL COMES FROM. The helper writes its port and every
// review's token into the readiness file in its own state directory, owner-only
// (D11). An agent running on the same machine as the reviewer reads it there,
// which is why `wait` needs no flag in the ordinary case. `--helper` and
// `--token` are there for the case where the state directory is somewhere this
// process cannot guess.
//
// Node-only.

"use strict";

var fs = require("node:fs");

var protocol = require("../../shared/protocol.js");
var stateDirModule = require("../../service/state_dir.js");

var EXIT = protocol.WAIT.EXIT;

var USAGE = [
  "usage: " + protocol.WAIT.USAGE,
  "",
  "  --review <id>        the review to wait on. Required",
  "  --since <cursor>     the cursor the last run printed. Default 0, the whole review",
  "  --timeout <seconds>  how long to block. Default " + protocol.WAIT.DEFAULT_TIMEOUT_SECONDS,
  "  --helper <origin>    the helper's origin. Default: read from the helper's state directory",
  "  --token <token>      the review's token. Default: read from the helper's state directory",
  "  --state-dir <path>   where the helper keeps its data, the same flag `add` and `serve` take.",
  "                       Default $LAHE_STATE_DIR, then $XDG_STATE_HOME/lahe, then ~/.local/state/lahe.",
  "",
  "It prints one JSON line per new item, then one line holding the next cursor.",
  "It consumes nothing and acknowledges nothing: to say you handled an item,",
  "append a reply line to your reply file.",
  "",
  "Exit codes: " +
    EXIT.NEW_WORK +
    " new work, " +
    EXIT.TIMEOUT +
    " timed out with nothing new, " +
    EXIT.HELPER_UNREACHABLE +
    " no helper, " +
    EXIT.UNKNOWN_REVIEW +
    " unknown review, " +
    EXIT.BAD_USAGE +
    " bad usage."
].join("\n");

/**
 * Parse the flags. Unknown flags are a usage error rather than a shrug: an
 * agent that mistyped a flag and got a silent default would wait on the wrong
 * cursor and believe there was nothing to do.
 */
function parseArgs(argv) {
  var out = {
    review: null,
    since: 0,
    timeout: protocol.WAIT.DEFAULT_TIMEOUT_SECONDS,
    helper: null,
    token: null,
    stateDir: null,
    help: false,
    error: null
  };
  var list = argv || [];

  function needsValue(flag, value) {
    if (value === undefined) {
      out.error = flag + " needs a value";
      return false;
    }
    return true;
  }

  for (var i = 0; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--review") {
      if (!needsValue(arg, list[i + 1])) break;
      out.review = list[(i += 1)];
    } else if (arg === "--since") {
      if (!needsValue(arg, list[i + 1])) break;
      out.since = Number(list[(i += 1)]);
    } else if (arg === "--timeout") {
      if (!needsValue(arg, list[i + 1])) break;
      out.timeout = Number(list[(i += 1)]);
    } else if (arg === "--helper") {
      if (!needsValue(arg, list[i + 1])) break;
      out.helper = list[(i += 1)];
    } else if (arg === "--token") {
      if (!needsValue(arg, list[i + 1])) break;
      out.token = list[(i += 1)];
    } else if (arg === "--state-dir") {
      if (!needsValue(arg, list[i + 1])) break;
      out.stateDir = list[(i += 1)];
    } else {
      out.error = "unknown option " + JSON.stringify(arg);
      break;
    }
  }

  if (out.help || out.error) return out;
  if (!out.review) out.error = "--review is required";
  else if (!protocol.isSafeId(out.review)) out.error = "--review must be a safe id: " + String(protocol.SAFE_ID);
  else if (!Number.isFinite(out.since) || out.since < 0) out.error = "--since must be a cursor from a previous run";
  else if (!Number.isFinite(out.timeout) || out.timeout < 0) out.error = "--timeout must be a number of seconds";
  return out;
}

/** The helper's readiness file: its port, and every review's token (D11). */
function readReadyFile(stateDir) {
  var readyPath = stateDirModule.readyPath(stateDir);
  if (!fs.existsSync(readyPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(readyPath, "utf8"));
  } catch (err) {
    return null;
  }
}

function resolveHelper(args, options) {
  var opts = options || {};
  // A typed --state-dir wins, and runs through the SAME in-checkout refusal as
  // the env-derived default, exactly as `add` and `serve` do with the flag. The
  // caller-supplied `opts.stateDir` behind it is the test harness's, which
  // serves from a directory it controls.
  var dir = args.stateDir
    ? stateDirModule.stateDir({ dir: args.stateDir })
    : opts.stateDir || stateDirModule.stateDir();
  var ready = readReadyFile(dir);
  var origin = args.helper || (ready && ready.port ? "http://" + protocol.DEFAULT_HOST + ":" + ready.port : null);
  var token = args.token;
  var known = null;
  // The origin this request presents. D11's origin check allows only origins the
  // add step registered for this review, and a command-line process has no
  // origin of its own, so it presents one the review already registered, read
  // out of the same owner-only file the token came from. Nothing is widened by
  // this: reaching that file already means holding the review's credential.
  var reviewOrigin = null;
  if (ready && ready.reviews) {
    known = Object.keys(ready.reviews);
    var entry = ready.reviews[args.review];
    if (entry && typeof entry !== "string") {
      if (!token) token = entry.token;
      if (Array.isArray(entry.origins) && entry.origins.length) reviewOrigin = entry.origins[0];
    } else if (!token && entry) {
      token = entry;
    }
  }
  return { origin: origin, token: token, reviewOrigin: reviewOrigin, dir: dir, ready: ready, knownReviews: known };
}

function url(origin, args) {
  return (
    origin +
    protocol.route("wait").path +
    "?review=" +
    encodeURIComponent(args.review) +
    "&since=" +
    encodeURIComponent(String(args.since)) +
    "&timeout=" +
    encodeURIComponent(String(args.timeout))
  );
}

function headers(helper) {
  var out = {};
  out[protocol.HEADER.CLIENT] = protocol.CLIENT_CLI;
  out[protocol.HEADER.TOKEN] = helper.token || "";
  // See resolveHelper: a command-line process has no origin of its own, so it
  // presents one this review registered. The Host header is fetch's own, and it
  // already names the helper.
  if (helper.reviewOrigin) out[protocol.HEADER.ORIGIN] = helper.reviewOrigin;
  return out;
}

// ---------------------------------------------------------------------------
// Surviving a helper that goes away mid-wait
// ---------------------------------------------------------------------------
//
// A blocked `wait` holds one long-poll open for minutes. Anything that bounces
// the helper (a crash, a `lahe serve` restart, an `add` that had to fall back to
// one) drops that connection, and `wait` used to exit HELPER_UNREACHABLE at
// once: the agent watching the review Ken was reviewing simply died, in the
// middle of the session, and he found out by nothing happening.
//
// So a dropped connection is retried rather than reported. THE SAME `--since`
// GOES BACK OUT, which is what makes this safe: `wait` consumes nothing and the
// cursor is a seq, so re-asking from the same watermark skips nothing and
// double-counts nothing.
//
// THE GRACE CLOCK STARTS AT THE FIRST FAILURE, not at the start of the wait. A
// long poll can sit open for minutes, so measuring the window from the start
// gave a helper bounce five minutes in zero retries: the whole grace was spent
// before anything went wrong, which is the exact case this exists for. It is
// still capped by whatever is left of --timeout, because outliving the caller's
// own deadline would be a different bug, and a reconnect resets it so a second
// bounce later in the same wait gets its own window.

var RECONNECT_GRACE_MS = 30 * 1000;
var RECONNECT_BACKOFF_MS = [250, 500, 1000, 2000];

function delay(ms) {
  // harness-allow-timer: the retry interval of a reconnect, not a wait-and-hope.
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * The blocking request, retried across a helper bounce.
 *
 * @returns {Promise<object>} the fetch response
 * @throws the last error, once the grace window is spent
 */
async function blockingRequest(fetchImpl, helper, args, err) {
  var startedAt = Date.now();
  var timeoutDeadline = startedAt + Math.max(0, args.timeout) * 1000;
  var attempt = 0;
  var announced = false;
  // When the connection actually dropped, set on the first failure. Null means
  // nothing has dropped yet. A request that gets through returns, so the next
  // long poll starts this over with a fresh window.
  var droppedAt = null;
  for (;;) {
    try {
      var response = await fetchImpl(url(helper.origin, args), { method: "GET", headers: headers(helper) });
      // One line on stderr when a reconnect actually happened, so the behavior
      // is visible rather than a silent gap in the agent's log.
      if (announced) err("lahe wait: reconnected to the helper at " + helper.origin + "; still waiting from --since " + args.since + "\n");
      return response;
    } catch (error) {
      var now = Date.now();
      if (droppedAt === null) droppedAt = now;
      var graceLeft = droppedAt + RECONNECT_GRACE_MS - now;
      var timeoutLeft = timeoutDeadline - now;
      if (graceLeft <= 0 || timeoutLeft <= 0) throw error;
      if (!announced) {
        announced = true;
        err(
          "lahe wait: lost the connection to the helper at " +
            helper.origin +
            " (" +
            (error && error.message) +
            "). Retrying from the same --since for up to " +
            Math.ceil(Math.min(graceLeft, timeoutLeft) / 1000) +
            "s.\n"
        );
      }
      var backoff = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
      attempt += 1;
      await delay(Math.max(0, Math.min(backoff, graceLeft, timeoutLeft)));
    }
  }
}

/**
 * The items the new events point at, as they appear in review.json.
 *
 * `wait` prints ITEMS, not events: an agent wants the thing to work on, in the
 * shape the contract file already taught it to read. The projection is read
 * once, after the wait returns, so the items are current rather than a snapshot
 * of whatever they looked like when the event was appended.
 */
function itemsFor(projection, events) {
  var wanted = [];
  var seen = Object.create(null);
  (events || []).forEach(function (event) {
    var id = event[protocol.EVENT_FIELD.ITEM];
    if (!id || seen[id]) return;
    seen[id] = true;
    wanted.push(id);
  });

  var byId = Object.create(null);
  ((projection && projection.pages) || []).forEach(function (page) {
    (page.items || []).forEach(function (item) {
      byId[item.id] = Object.assign({ page: { path: page.path, origin: page.origin, title: page.title } }, item);
    });
  });

  return wanted
    .map(function (id) {
      return byId[id] || null;
    })
    .filter(Boolean);
}

/**
 * @param {string[]} argv everything after `wait`
 * @param {{stateDir?: string, fetch?: function, stdout?: function, stderr?: function}} [options]
 * @returns {Promise<number>} the exit code, from protocol.WAIT.EXIT
 */
async function run(argv, options) {
  var opts = options || {};
  var out = opts.stdout || function (text) {
    process.stdout.write(text);
  };
  var err = opts.stderr || function (text) {
    process.stderr.write(text);
  };
  var fetchImpl = opts.fetch || fetch;

  var args = parseArgs(argv);
  if (args.help) {
    out(USAGE + "\n");
    return EXIT.NEW_WORK;
  }
  if (args.error) {
    err("lahe wait: " + args.error + "\n\n" + USAGE + "\n");
    return EXIT.BAD_USAGE;
  }

  var helper;
  try {
    helper = resolveHelper(args, opts);
  } catch (error) {
    err("lahe wait: " + error.message + "\n");
    return EXIT.HELPER_UNREACHABLE;
  }

  if (!helper.origin) {
    err(
      "lahe wait: no helper. Nothing is listening and " +
        stateDirModule.readyPath(helper.dir) +
        " is not there. Start one with `lahe serve`.\n"
    );
    return EXIT.HELPER_UNREACHABLE;
  }
  if (!helper.token) {
    // A review the helper has never heard of has no token to present, which is
    // the same answer the helper would give, reached without a round trip.
    err(
      "lahe wait: no token for review " +
        JSON.stringify(args.review) +
        (helper.knownReviews ? ". The helper is holding: " + (helper.knownReviews.join(", ") || "none") : "") +
        "\n"
    );
    return EXIT.UNKNOWN_REVIEW;
  }

  var response;
  try {
    response = await blockingRequest(fetchImpl, helper, args, err);
  } catch (error) {
    err("lahe wait: the helper at " + helper.origin + " did not answer: " + (error && error.message) + "\n");
    return EXIT.HELPER_UNREACHABLE;
  }

  var body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    var code = (body && body.error && body.error.code) || null;
    var message = (body && body.error && body.error.message) || "HTTP " + response.status;
    err("lahe wait: " + message + "\n");
    if (code === "PROTO_UNKNOWN_REVIEW") return EXIT.UNKNOWN_REVIEW;
    if (code === "PROTO_UNAUTHORIZED" || code === "PROTO_FORBIDDEN_ORIGIN") return EXIT.BAD_USAGE;
    return EXIT.HELPER_UNREACHABLE;
  }

  var events = (body && body.events) || [];
  var cursor = typeof (body && body.seq) === "number" ? body.seq : args.since;

  if (!events.length) {
    // Timed out with nothing new. The cursor is still printed, because the
    // caller's next run should not re-read the whole review.
    out(JSON.stringify({ cursor: cursor, items: 0 }) + "\n");
    return EXIT.TIMEOUT;
  }

  // The wait route already said this review has new work, so there ARE items
  // behind these events. The follow-up read resolves them to their current
  // shape. If that read fails or comes back unreadable, projection is null and
  // itemsFor returns nothing: printing the cursor anyway and exiting NEW_WORK
  // would advance the caller's watermark past work it never saw, a silent and
  // permanent skip. So the read is retried, and if it still resolves no items
  // the cursor is NOT printed and the exit is HELPER_UNREACHABLE: the next run
  // re-reads from the same --since and the ready work comes back.
  var readUrl =
    helper.origin + protocol.route("review.read").path + "?review=" + encodeURIComponent(args.review);
  var items = [];
  for (var attempt = 0; attempt < 3; attempt += 1) {
    var projection = null;
    try {
      var read = await fetchImpl(readUrl, { method: "GET", headers: headers(helper) });
      projection = read && read.ok ? await read.json() : null;
    } catch (error) {
      projection = null;
    }
    items = itemsFor(projection, events);
    if (items.length > 0) break;
  }

  if (items.length === 0) {
    err(
      "lahe wait: " +
        events.length +
        " new event(s) at " +
        helper.origin +
        ", but the projection resolved no items: the helper's review.read did not answer with them. " +
        "Not advancing the cursor, so the work is not skipped; re-run to retry.\n"
    );
    return EXIT.HELPER_UNREACHABLE;
  }

  items.forEach(function (item) {
    out(JSON.stringify(item) + "\n");
  });
  out(JSON.stringify({ cursor: cursor, items: items.length }) + "\n");
  return EXIT.NEW_WORK;
}

module.exports = {
  USAGE: USAGE,
  EXIT: EXIT,
  RECONNECT_GRACE_MS: RECONNECT_GRACE_MS,
  RECONNECT_BACKOFF_MS: RECONNECT_BACKOFF_MS,
  blockingRequest: blockingRequest,
  parseArgs: parseArgs,
  resolveHelper: resolveHelper,
  itemsFor: itemsFor,
  run: run
};
