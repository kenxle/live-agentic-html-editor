// `lahe status`: what is open right now, and is the page still connected?
//
// Owner: 3A, beside `wait`, because it answers with the same watermark
// semantics `wait` does and shares its exit codes.
//
// WHY THIS COMMAND EXISTS. `wait` blocks, and it was the only read path, so
// every agent hand-rolled a recursive walk of review.json to answer "what is
// open right now" and each one invented its own idea of which items counted.
// One command, one definition, read from the same projection the reviewer's
// page reconciles against.
//
// WHAT COUNTS AS SOMETHING TO ACT ON. An item is UNANSWERED READY when its
// state is `ready` and it carries no reply. That is the protocol's own
// vocabulary, not a parallel one: `ready` is the state the contract field tells
// an agent it may act on (drafts are the reviewer mid-sentence and never reach
// the projection at all), and the reply is what the item carries once an agent
// has answered it. `not_handled` and `question` items are still in front of the
// REVIEWER, which is why they are counted and named but not listed as work.
//
// LIVENESS, because the reviewer kept asking out loud "are you getting my
// edits?" and neither side could answer:
//
//   - PAGE LAST SEEN is the helper's own record of the last request from the
//     library for this review (reviews.touch, reported by review.read as
//     page_last_seen_at). With no helper up it is UNKNOWN, and it is printed as
//     unknown rather than as a stale number.
//   - LAST ITEM is the newest item timestamp in the projection, which is the
//     reviewer's side of the same question.
//
// A review that exists with nothing ever connected says so in those words: that
// sentence plus the origin diagnosis on the page is the whole of tonight's
// failure mode.
//
// WHERE IT READS FROM. The helper when one is up (review.read, the same
// projection the page uses, plus liveness). No helper, straight off disk
// through the same projector module; a projection is a pure function of the
// log, so both paths agree and neither reimplements the other.
//
// Node-only.

"use strict";

var fs = require("node:fs");

var protocol = require("../../shared/protocol.js");
var record = require("../../shared/record.js");
var stateDirModule = require("../../service/state_dir.js");
var logModule = require("../../service/log.js");
var projectionModule = require("../../service/projection.js");

// Status borrows `wait`'s codes rather than minting a second set: an agent
// scripting the two reads one table. NEW_WORK is 0 and means "it printed",
// whether or not there was anything to print.
var EXIT = protocol.WAIT.EXIT;

var USAGE = [
  "usage: lahe status [--review <id>] [--json] [--state-dir <path>]",
  "",
  "  --review <id>        just this review. Default: every review the helper holds",
  "  --json               one JSON line per unanswered ready item, then one summary line",
  "  --state-dir <path>   where the helper keeps its data, the same flag every command takes.",
  "                       Default $LAHE_STATE_DIR, then $XDG_STATE_HOME/lahe, then ~/.local/state/lahe.",
  "",
  "It lists the items an agent should act on: state ready, with no reply yet.",
  "It consumes nothing and acknowledges nothing.",
  "",
  "Exit codes: " + EXIT.NEW_WORK + " it printed, " + EXIT.HELPER_UNREACHABLE + " no helper and nothing on disk, " + EXIT.UNKNOWN_REVIEW + " unknown review, " + EXIT.BAD_USAGE + " bad usage."
].join("\n");

function parseArgs(argv) {
  var out = { review: null, json: false, stateDir: null, help: false, error: null };
  var list = argv || [];

  for (var i = 0; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--review") {
      if (list[i + 1] === undefined) {
        out.error = "--review needs a value";
        break;
      }
      out.review = list[(i += 1)];
    } else if (arg === "--state-dir") {
      if (list[i + 1] === undefined) {
        out.error = "--state-dir needs a value";
        break;
      }
      out.stateDir = list[(i += 1)];
    } else {
      out.error = "unknown option " + JSON.stringify(arg);
      break;
    }
  }

  if (out.help || out.error) return out;
  if (out.review !== null && !protocol.isSafeId(out.review)) {
    out.error = "--review must be a safe id: " + String(protocol.SAFE_ID);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The one definition of what an agent should act on
// ---------------------------------------------------------------------------

/**
 * Is this item ready and unanswered?
 *
 * Ready is record.STATE.READY, the state the review.json contract names as the
 * one an agent may act on. No reply means no agent has answered this revision;
 * a reworded item drops its reply in the projection, so it comes back here on
 * its own, which is the same rule `wait` wakes on.
 */
function isUnansweredReady(item) {
  return !!item && item.state === record.STATE.READY && !item.reply;
}

/** Every item in a projection, each carrying the page it came from. */
function itemsOf(projection) {
  var out = [];
  ((projection && projection.pages) || []).forEach(function (page) {
    (page.items || []).forEach(function (item) {
      out.push(Object.assign({ page: { path: page.path, origin: page.origin, title: page.title } }, item));
    });
  });
  return out;
}

/** Counts by state, plus how many of the ready ones nobody has answered. */
function countsOf(items) {
  var counts = { total: items.length, unanswered_ready: 0 };
  record.STATES.forEach(function (state) {
    counts[state] = 0;
  });
  items.forEach(function (item) {
    if (Object.prototype.hasOwnProperty.call(counts, item.state)) counts[item.state] += 1;
    if (isUnansweredReady(item)) counts.unanswered_ready += 1;
  });
  return counts;
}

/** The newest thing the reviewer did, as an ISO string, or null. */
function lastItemAt(items) {
  var newest = null;
  items.forEach(function (item) {
    [item.updated_at, item.created_at].forEach(function (at) {
      if (typeof at === "string" && at && (!newest || at > newest)) newest = at;
    });
  });
  return newest;
}

// ---------------------------------------------------------------------------
// Saying a timestamp the way a person reads one
// ---------------------------------------------------------------------------

function ago(iso, nowMs) {
  if (!iso) return null;
  var then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  var seconds = Math.max(0, Math.round(((typeof nowMs === "number" ? nowMs : Date.now()) - then) / 1000));
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.round(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.round(seconds / 3600) + "h ago";
  return Math.round(seconds / 86400) + "d ago";
}

/**
 * The liveness sentence, in the three states it actually has.
 *
 * UNKNOWN is a real answer and is said as one: with no helper running, nobody
 * recorded whether a page ever connected, and printing a confident "never" from
 * an absence would be an invention.
 */
function livenessLine(liveness, nowMs) {
  if (!liveness.helper_up) return "page last seen unknown (no helper is running, so nothing is tracking it)";
  if (!liveness.page_last_seen_at) {
    return "no page has connected yet (check the link you opened, and that this page's origin is registered)";
  }
  return "page last seen " + ago(liveness.page_last_seen_at, nowMs);
}

/** One line of the item's own words, for a human scanning the list. */
function excerpt(item, max) {
  var limit = typeof max === "number" ? max : 100;
  var text = item.note || item.change || item.quote || "";
  var flat = String(text).replace(/\s+/g, " ").trim();
  if (!flat) return "(no text)";
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + "…";
}

// ---------------------------------------------------------------------------
// Reading a review, with a helper and without one
// ---------------------------------------------------------------------------

/** Every review with state on disk, whether or not a helper holds it. */
function reviewsOnDisk(dir) {
  var root;
  try {
    root = stateDirModule.reviewsRoot(dir);
  } catch (err) {
    return [];
  }
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(function (entry) {
      return entry.isDirectory() && protocol.isSafeId(entry.name);
    })
    .map(function (entry) {
      return entry.name;
    })
    .sort();
}

async function readThroughHelper(fetchImpl, origin, reviewId, credentials) {
  var target = origin + protocol.route("review.read").path + "?review=" + encodeURIComponent(reviewId);
  var headers = {};
  headers[protocol.HEADER.CLIENT] = protocol.CLIENT_CLI;
  headers[protocol.HEADER.TOKEN] = credentials.token || "";
  if (credentials.origin) headers[protocol.HEADER.ORIGIN] = credentials.origin;
  var response = await fetchImpl(target, { method: "GET", headers: headers });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, projection: await response.json() };
}

/**
 * The projection off disk, for when no helper is up.
 *
 * The projector module, not a second reader: review.json on disk can be older
 * than the log (the helper rewrites it on a tick it is not running to serve),
 * and the log is the source of truth.
 */
function readFromDisk(dir, reviewId) {
  var log = logModule.createEventLog({ dir: dir });
  var events = log.read(reviewId);
  if (!events.length) return null;
  return projectionModule.project(reviewId, events);
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/**
 * @param {string[]} argv everything after `status`
 * @param {{stateDir?: string, fetch?: function, stdout?: function, stderr?: function, now?: number}} [options]
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
  var nowMs = typeof opts.now === "number" ? opts.now : Date.now();

  var args = parseArgs(argv);
  if (args.help) {
    out(USAGE + "\n");
    return EXIT.NEW_WORK;
  }
  if (args.error) {
    err("lahe status: " + args.error + "\n\n" + USAGE + "\n");
    return EXIT.BAD_USAGE;
  }

  var dir;
  try {
    dir = args.stateDir
      ? stateDirModule.stateDir({ dir: args.stateDir })
      : opts.stateDir || stateDirModule.stateDir();
  } catch (error) {
    err("lahe status: " + error.message + "\n");
    return EXIT.HELPER_UNREACHABLE;
  }

  var ready = null;
  var readyPath = stateDirModule.readyPath(dir);
  if (fs.existsSync(readyPath)) {
    try {
      ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    } catch (error) {
      ready = null;
    }
  }
  var helperOrigin = ready && ready.port ? "http://" + protocol.DEFAULT_HOST + ":" + ready.port : null;

  // Which reviews. The helper's own list first, because that is what is live,
  // then anything else with state on disk so a review the helper has not been
  // asked about yet is still visible.
  var ids = [];
  if (args.review) {
    ids = [args.review];
  } else {
    if (ready && ready.reviews) ids = Object.keys(ready.reviews);
    reviewsOnDisk(dir).forEach(function (id) {
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    ids.sort();
  }

  if (ids.length === 0) {
    if (args.json) {
      out(JSON.stringify({ reviews: 0, unanswered_ready: 0, state_dir: dir }) + "\n");
    } else {
      out("lahe status: no reviews in " + stateDirModule.reviewsRoot(dir) + ". Start one with `lahe add <page>`.\n");
    }
    return EXIT.NEW_WORK;
  }

  var lines = [];
  var jsonItems = [];
  var totalUnanswered = 0;
  var seenAny = false;

  for (var i = 0; i < ids.length; i += 1) {
    var id = ids[i];
    var held = ready && ready.reviews ? ready.reviews[id] : null;
    var projection = null;
    var pageLastSeen = null;
    var helperUp = false;

    if (helperOrigin && held) {
      try {
        var answer = await readThroughHelper(fetchImpl, helperOrigin, id, {
          token: held.token,
          // A command-line process has no origin of its own, so it presents one
          // this review registered, exactly as `wait` does.
          origin: Array.isArray(held.origins) && held.origins.length ? held.origins[0] : null
        });
        if (answer.ok) {
          projection = answer.projection;
          pageLastSeen = projection && projection.page_last_seen_at ? projection.page_last_seen_at : null;
          helperUp = true;
        }
      } catch (error) {
        projection = null;
      }
    }

    if (!projection) {
      try {
        projection = readFromDisk(dir, id);
      } catch (error) {
        projection = null;
      }
    }

    if (!projection) {
      if (args.review) {
        err("lahe status: no review " + JSON.stringify(id) + " in " + stateDirModule.reviewsRoot(dir) + "\n");
        return EXIT.UNKNOWN_REVIEW;
      }
      continue;
    }

    seenAny = true;
    var items = itemsOf(projection);
    var counts = countsOf(items);
    var open = items.filter(isUnansweredReady);
    totalUnanswered += open.length;

    var liveness = { helper_up: helperUp, page_last_seen_at: pageLastSeen, last_item_at: lastItemAt(items) };

    if (args.json) {
      open.forEach(function (item) {
        jsonItems.push(Object.assign({ review: id }, item));
      });
    }

    var pages = ((projection.pages || []).map(function (page) {
      return page.path || page.key;
    }));
    lines.push("review " + id + (helperUp ? "" : "  (helper not answering for this review)"));
    lines.push("  page      " + (pages.join(", ") || "none yet"));
    lines.push(
      "  items     " +
        counts.total +
        " total: " +
        counts.unanswered_ready +
        " ready for you, " +
        counts[record.STATE.HANDLED] +
        " handled, " +
        counts[record.STATE.NOT_HANDLED] +
        " not handled"
    );
    lines.push("  live      " + livenessLine(liveness, nowMs));
    lines.push(
      "            " +
        (liveness.last_item_at ? "last comment " + ago(liveness.last_item_at, nowMs) : "no comments yet")
    );
    if (open.length === 0) {
      lines.push("  nothing is waiting on you.");
    } else {
      open.forEach(function (item) {
        lines.push(
          "  " +
            item.id +
            "  " +
            item.kind +
            "  " +
            (item.page && item.page.path ? item.page.path : "?") +
            "  " +
            excerpt(item)
        );
      });
    }
    lines.push("");
  }

  if (!seenAny) {
    err("lahe status: nothing readable in " + stateDirModule.reviewsRoot(dir) + "\n");
    return EXIT.HELPER_UNREACHABLE;
  }

  if (args.json) {
    jsonItems.forEach(function (item) {
      out(JSON.stringify(item) + "\n");
    });
    out(
      JSON.stringify({
        reviews: ids.length,
        unanswered_ready: totalUnanswered,
        helper: helperOrigin,
        state_dir: dir
      }) + "\n"
    );
    return EXIT.NEW_WORK;
  }

  out(lines.join("\n") + "\n");
  return EXIT.NEW_WORK;
}

module.exports = {
  USAGE: USAGE,
  EXIT: EXIT,
  parseArgs: parseArgs,
  isUnansweredReady: isUnansweredReady,
  itemsOf: itemsOf,
  countsOf: countsOf,
  lastItemAt: lastItemAt,
  ago: ago,
  livenessLine: livenessLine,
  excerpt: excerpt,
  run: run
};
