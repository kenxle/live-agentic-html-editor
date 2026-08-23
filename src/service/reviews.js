// Reviews: creating one, minting its token, registering its origins, and
// holding the one session that owns it.
//
// Owner: 1A. `add` (3B) is a thin caller of this; the Phase 1 path is the real
// one, not a temporary fake, because 1A's own done bar and 1B's storage keying
// both need a real review and a real token a whole phase before `add` exists.
//
// Architecture D11 (the page proves itself) and D5 (the second window).
//
// THE TOKEN IS PER REVIEW. Not per machine and not per run. It is readable by
// any script on the reviewed page, which is exactly why it is scoped this way: a
// leak opens one review's feedback and never the machine. It PERSISTS across
// helper restarts, because rotating it would orphan a page mid-review and every
// sync would 401 forever, which is the never-lose-work posture broken by its own
// security control.
//
// ORIGINS ARE A SET, NOT A STRING. Browser storage is partitioned by origin and
// no key choice changes that, so `localhost` and `127.0.0.1` are physically
// separate buckets. The helper is the thing that unifies a review across them:
// one review id, several registered origins, one events.jsonl with every record
// exactly once. The file:// case registers the literal origin "null", which is
// what a browser sends from a page opened off disk (see the 1A spike in D11).
//
// ONE SESSION PER REVIEW, WITH A HEARTBEAT. A second window is refused, and the
// refusal does NOT disclose the holder's window id: a window that merely knows
// the holder's id must not be able to pass itself off as the holder's heartbeat
// (that was a live replay hole). Instead the grant hands the holder a server-
// minted SESSION SECRET, and only a request carrying that secret is recognized
// as the holder's continued possession. A holder whose heartbeat has been quiet
// for thirty seconds has lost the review, and the next window takes over rather
// than being locked out: a reviewer shut out of their own review after a crash
// is a work-losing outcome in a tool whose whole thesis is never losing work.
//
// TAKEOVER IS A SAME-TOKEN-TRUSTED ACTION, not a secret-proven one. Every
// window.claim already passes D11's per-review token check, and D11 says the
// token is the working trust factor. So any window holding the token may take
// over: automatically once the holder goes stale, or on the reviewer's explicit
// "Review here instead", which deposes even a live holder. The session secret is
// required only to be recognized as the CURRENT holder on a heartbeat; it is not
// asked of a takeover, because a taking-over window is a different window that
// never had the holder's secret. This keeps at most one live window while making
// "knows the holder's id" no longer mean "is the holder".
//
// Node-only.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var elapsed = require("../shared/elapsed.js");
var stateDir = require("./state_dir.js");
var healModule = require("./heal.js");
var staticServersModule = require("./static_servers.js");

var TOKEN_BYTES = 32;

// The holder tells the helper it is still there on this cadence, and the helper
// calls a holder lost after this silence. The gap between them is deliberate: a
// holder gets two missed beats before anyone can take its review.
var HEARTBEAT_SECONDS = 10;
var STALE_AFTER_MS = 30 * 1000;

// A REVIEW MINTED AFTER THIS HELPER STARTED IS ON DISK BUT NOT IN MEMORY, and
// there is no create-review route to tell the helper about it (on purpose). The
// helper therefore looks on disk once for a review it is asked about and does
// not hold, which is what lets `add` stop bouncing a running helper that may be
// holding somebody else's live review.
//
// The look is triggered by a request that has NOT proved anything yet: the token
// check happens after it, because an unknown review has no token to check
// against. So it is bounded on both axes rather than trusted:
//
//   - one look per unknown id per RESCAN_INTERVAL_MS, so hammering one id costs
//     one readdir every few seconds and nothing in between,
//   - at most RESCAN_TRACKED_MAX ids remembered, oldest evicted, so hammering
//     invented ids cannot grow the map. An evicted id can look again, which is
//     the ceiling: a flood of distinct ids costs one small stat per interval per
//     tracked id, never a walk of the whole directory.
//
// The path rules are state_dir's, unchanged: a safe id, resolved inside the
// state root, no symlink at any level, and the directory must be owner-only.
var RESCAN_INTERVAL_MS = 3000;
var RESCAN_TRACKED_MAX = 64;

function mintToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

// The per-session secret the holder proves possession with on every heartbeat.
// Unguessable, minted server-side on the grant, never disclosed in a refusal.
function mintSessionSecret() {
  return crypto.randomBytes(24).toString("hex");
}

// Constant-time secret compare, so "does this request carry the holder's secret"
// leaks nothing through timing. Unequal lengths are simply not equal.
function secretsMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** A fresh review id, in the safe character set, because it is a path component. */
function mintReviewId() {
  return "r" + crypto.randomBytes(6).toString("hex");
}

function nowMs() {
  return Date.now();
}

/**
 * The review registry for one state directory.
 *
 * @param {{dir: string, log: object, now?: () => number}} options
 *   `log` is the event log from log.js. `now` is injectable so the stale-holder
 *   rule can be tested without waiting thirty seconds.
 */
function createReviews(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createReviews: dir is required");
  if (!opts.log) throw new Error("createReviews: log is required");
  var dir = opts.dir;
  var log = opts.log;
  var clock = typeof opts.now === "function" ? opts.now : nowMs;

  // id -> { id, token, origins: [...], created_at }
  var reviews = Object.create(null);
  // id -> { window_id, since, last_seen }
  var sessions = Object.create(null);

  function metaFor(reviewId) {
    return stateDir.metaPath(dir, reviewId);
  }

  function persist(review) {
    stateDir.ensureReviewDir(dir, review.id);
    stateDir.writeAtomic(metaFor(review.id), JSON.stringify(review, null, 2) + "\n");
    return review;
  }

  /** Read every review already on disk, so tokens survive a restart. */
  function loadFromDisk() {
    var root = stateDir.reviewsRoot(dir);
    if (!fs.existsSync(root)) return reviews;
    fs.readdirSync(root, { withFileTypes: true }).forEach(function (entry) {
      if (!entry.isDirectory()) return;
      if (!protocol.isSafeId(entry.name)) {
        log.helperLog("ignoring a review directory whose name is not a safe id: " + JSON.stringify(entry.name));
        return;
      }
      var metaPath;
      try {
        metaPath = metaFor(entry.name);
      } catch (err) {
        log.helperLog("ignoring a review directory the path rules refuse: " + err.message);
        return;
      }
      if (!fs.existsSync(metaPath)) {
        // No meta at all, but a directory named like a review. Its log may still
        // hold everything needed to bring it back. Fail loud, then recover.
        recoverFromLog(entry.name, "its " + stateDir.FILES.meta + " is missing");
        return;
      }
      var parsed = null;
      try {
        parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      } catch (err) {
        // NEW-3: an unreadable meta.json used to silently de-register the whole
        // review, leaving its edits unreachable in events.jsonl. That is exactly
        // the silent loss this tool exists to remove. Fail LOUD (the operator
        // sees it) and recover the token and origins from the append-only log.
        loud("review " + entry.name + " has an unreadable " + stateDir.FILES.meta + " (" + err.message + ")");
        recoverFromLog(entry.name, "its " + stateDir.FILES.meta + " is corrupt");
        return;
      }
      if (parsed && typeof parsed.token === "string" && parsed.token) {
        reviews[entry.name] = {
          id: entry.name,
          token: parsed.token,
          origins: Array.isArray(parsed.origins) ? parsed.origins.slice() : [],
          // Absent in every meta.json written before path-matching existed, and
          // null is the right answer there: an old review never matches by path.
          target_path: typeof parsed.target_path === "string" ? parsed.target_path : null,
          // Every page ever added to this review, so path-matching keeps finding
          // all of them and the reload watcher does not follow only the last.
          target_paths: Array.isArray(parsed.target_paths) ? parsed.target_paths.slice() : [],
          source_path: typeof parsed.source_path === "string" ? parsed.source_path : null,
          agent_session_id: typeof parsed.agent_session_id === "string" ? parsed.agent_session_id : "legacy",
          created_at: parsed.created_at || new Date().toISOString()
        };
      } else {
        loud("review " + entry.name + " has a " + stateDir.FILES.meta + " with no usable token");
        recoverFromLog(entry.name, "its " + stateDir.FILES.meta + " carries no token");
      }
    });
    return reviews;
  }

  // A startup problem the operator must see, not a quiet diagnostic line. It goes
  // to the helper log AND to stderr, because a review that vanished on restart is
  // the kind of thing someone has to notice.
  function loud(message) {
    log.helperLog("STARTUP ERROR: " + message);
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error("[lahe] STARTUP ERROR: " + message);
    }
  }

  // Rebuild a review's registration from its append-only log when meta.json is
  // gone or corrupt. The token rides the REVIEW_CREATED event, origins ride the
  // ORIGIN_REGISTERED events. If the log has neither, the review's edits are
  // genuinely unreachable, and that is said loudly rather than swallowed.
  function recoverFromLog(reviewId, why) {
    var events;
    try {
      events = log.read(reviewId);
    } catch (err) {
      loud("review " + reviewId + " could not be recovered (" + why + "): the log is unreadable (" + err.message + ")");
      return null;
    }
    var token = null;
    var origins = [];
    var createdAt = null;
    var agentSessionId = "legacy";
    events.forEach(function (event) {
      var type = event[protocol.EVENT_FIELD.EVENT];
      if (type === protocol.EVENT.REVIEW_CREATED) {
        if (event.token && typeof event.token === "string") token = event.token;
        if (typeof event.agent_session_id === "string") agentSessionId = event.agent_session_id;
        if (!createdAt) createdAt = event[protocol.EVENT_FIELD.TS] || null;
      } else if (type === protocol.EVENT.ORIGIN_REGISTERED) {
        var origin = event.origin || (event.payload && event.payload.origin);
        if (typeof origin === "string" && origins.indexOf(origin) === -1) origins.push(origin);
      }
    });
    if (!token) {
      loud(
        "review " +
          reviewId +
          " could not be recovered (" +
          why +
          "): the log has no REVIEW_CREATED token, so its edits are unreachable"
      );
      return null;
    }
    var recovered = {
      id: reviewId,
      token: token,
      origins: origins,
      agent_session_id: agentSessionId,
      created_at: createdAt || new Date().toISOString()
    };
    reviews[reviewId] = recovered;
    // Re-persist a clean meta so the next restart is not another recovery.
    try {
      persist(recovered);
    } catch (err) {
      loud("review " + reviewId + " was recovered from its log but its " + stateDir.FILES.meta + " could not be rewritten (" + err.message + ")");
    }
    log.helperLog("review " + reviewId + " recovered from its log after " + why);
    return recovered;
  }

  function get(reviewId) {
    return Object.prototype.hasOwnProperty.call(reviews, reviewId) ? reviews[reviewId] : null;
  }

  // ---------------------------------------------------------------------------
  // Learning a review that was minted after this helper started
  // ---------------------------------------------------------------------------

  // id -> the clock reading of the last look. Insertion-ordered, so the oldest
  // entry is the first key, which is what the eviction below takes.
  var rescanAttempts = new Map();

  /**
   * Is this directory owner-only?
   *
   * The state root and every review folder under it are created 0700 by
   * state_dir.ensureDir. A folder under the root that is readable by anyone else
   * was not put there the way this helper puts things there, so it is not read.
   * POSIX only: Windows does not carry these bits and reports whatever it likes.
   */
  function ownerOnly(target) {
    if (process.platform === "win32") return true;
    try {
      return (fs.statSync(target).mode & 0o077) === 0;
    } catch (err) {
      return false;
    }
  }

  /**
   * Read ONE review off disk, by id, or return null.
   *
   * Deliberately narrower than loadFromDisk: it reads meta.json and nothing
   * else, and it does NOT run the log recovery. Recovery is a startup act with
   * loud output; an unauthenticated request must not be able to drive it.
   */
  function loadOne(reviewId) {
    var metaPath;
    var folder;
    try {
      folder = stateDir.reviewDir(dir, reviewId);
      metaPath = stateDir.metaPath(dir, reviewId);
    } catch (err) {
      // A path rule refused it: an unsafe id, an escape, or a symlink.
      log.helperLog("not learning review " + JSON.stringify(reviewId) + ": " + err.message);
      return null;
    }
    if (!fs.existsSync(metaPath)) return null;
    if (!ownerOnly(folder)) {
      log.helperLog("not learning review " + JSON.stringify(reviewId) + ": its folder is not owner-only");
      return null;
    }
    var parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch (err) {
      log.helperLog("not learning review " + JSON.stringify(reviewId) + ": its " + stateDir.FILES.meta + " is unreadable (" + err.message + ")");
      return null;
    }
    if (!parsed || typeof parsed.token !== "string" || !parsed.token) {
      log.helperLog("not learning review " + JSON.stringify(reviewId) + ": its " + stateDir.FILES.meta + " carries no token");
      return null;
    }
    reviews[reviewId] = {
      id: reviewId,
      token: parsed.token,
      origins: Array.isArray(parsed.origins) ? parsed.origins.slice() : [],
      target_path: typeof parsed.target_path === "string" ? parsed.target_path : null,
      target_paths: Array.isArray(parsed.target_paths) ? parsed.target_paths.slice() : [],
      source_path: typeof parsed.source_path === "string" ? parsed.source_path : null,
      agent_session_id: typeof parsed.agent_session_id === "string" ? parsed.agent_session_id : "legacy",
      created_at: parsed.created_at || new Date().toISOString()
    };
    log.helperLog("review " + reviewId + " learned from disk without a restart");
    // The readiness file is how every CLI command on the machine finds a
    // review's token, so it is rewritten the moment the set of reviews changes.
    // Skipping this would leave service.json quietly wrong.
    if (lastReadyDetails) writeReadyFile(lastReadyDetails);
    return reviews[reviewId];
  }

  /**
   * The review this id names, looking on disk once if it is not in memory.
   *
   * Free when the review is already held, which is every ordinary request.
   *
   * @param {string} reviewId
   * @returns {object|null} the review, or null if there is nothing to learn
   */
  function ensureKnown(reviewId) {
    if (typeof reviewId !== "string" || !reviewId) return null;
    var held = get(reviewId);
    if (held) return held;
    if (!protocol.isSafeId(reviewId)) return null;

    var at = clock();
    var last = rescanAttempts.get(reviewId);
    if (last !== undefined && at - last < RESCAN_INTERVAL_MS) return null;
    if (rescanAttempts.size >= RESCAN_TRACKED_MAX) {
      var oldest = rescanAttempts.keys().next();
      if (!oldest.done) rescanAttempts.delete(oldest.value);
    }
    rescanAttempts.set(reviewId, at);
    return loadOne(reviewId);
  }

  function list() {
    return Object.keys(reviews).sort();
  }

  /**
   * Create a review, or return the one that already exists under that id.
   *
   * Creating is idempotent on purpose: `serve` is idempotent (0A-wire's Q1) and
   * `add` calls this, so running add twice must not mint a second token for the
   * same review and silently invalidate the page already open on the first.
   *
   * @param {{id?: string, origins?: string[]}} [input]
   */
  function create(input) {
    var spec = input || {};
    var id = spec.id || mintReviewId();
    stateDir.assertSafeReviewId(id);

    var existing = get(id);
    if (existing) {
      if (
        typeof spec.agent_session_id === "string" &&
        existing.agent_session_id !== spec.agent_session_id
      ) {
        throw new Error(
          "review " + id + " belongs to agent session " + existing.agent_session_id +
            ", not " + spec.agent_session_id
        );
      }
      (spec.origins || []).forEach(function (origin) {
        registerOrigin(id, origin);
      });
      recordPaths(id, spec);
      return existing;
    }

    var review = {
      id: id,
      token: mintToken(),
      origins: [],
      // Where this review's page lives, so a rebuild that strips the script
      // line does not splinter one document into three reviews. See recordPaths.
      target_path: typeof spec.target_path === "string" ? spec.target_path : null,
      target_paths: typeof spec.target_path === "string" && spec.target_path ? [spec.target_path] : [],
      source_path: typeof spec.source_path === "string" ? spec.source_path : null,
      agent_session_id: typeof spec.agent_session_id === "string" ? spec.agent_session_id : "legacy",
      created_at: new Date().toISOString()
    };
    reviews[id] = review;
    persist(review);

    log.append(id, [
      protocol.newEvent({
        event: protocol.EVENT.REVIEW_CREATED,
        event_id: "ev_" + crypto.randomBytes(8).toString("hex"),
        review: id,
        // The token rides the created event too, not only meta.json, so a
        // corrupt meta on restart can be recovered from the append-only log
        // instead of orphaning the whole review's edits (NEW-3). events.jsonl is
        // owner-only, the same class of secret as meta.json; the no-token rule is
        // about the diagnostic helper.log, not the source-of-truth log.
        payload: { token: review.token, agent_session_id: review.agent_session_id }
      })
    ]);
    log.helperLog("review " + id + " created");

    (spec.origins || []).forEach(function (origin) {
      registerOrigin(id, origin);
    });
    return review;
  }

  /**
   * Add an origin to a review's set.
   *
   * The set is what makes one review span `localhost` and `127.0.0.1`. Adding
   * the same origin twice is a no-op and not an error, because `add` run twice
   * against one dev server is ordinary.
   */
  function registerOrigin(reviewId, origin) {
    var review = get(reviewId);
    if (!review) throw new Error("registerOrigin: no review named " + JSON.stringify(reviewId));
    var value = origin === null || origin === undefined || origin === "" ? "null" : String(origin);
    if (review.origins.indexOf(value) !== -1) return review;
    review.origins.push(value);
    persist(review);
    log.append(reviewId, [
      protocol.newEvent({
        event: protocol.EVENT.ORIGIN_REGISTERED,
        event_id: "ev_" + crypto.randomBytes(8).toString("hex"),
        review: reviewId,
        payload: { origin: value }
      })
    ]);
    log.helperLog("review " + reviewId + " registered origin " + value);
    // service.json lists each review's origins, and it is how the CLI commands
    // (`add` and `status`) know what this helper holds. An
    // origin registered while the helper is running has to reach it, or `add`
    // would keep believing the origin is missing and writing it again.
    if (lastReadyDetails) writeReadyFile(lastReadyDetails);
    return review;
  }

  /**
   * Remember which page this review is of.
   *
   * IDENTITY USED TO LIVE ONLY IN THE SCRIPT LINE INSIDE THE PAGE. Rebuild the
   * page and the line is gone, so the next `add` minted a new review and the
   * history of one document ended up split across three of them. The resolved
   * absolute target path (and the --source path, when one was given) is written
   * into meta.json here, and `add` looks through it before minting. Old meta
   * files have neither field and simply never match, which is the intended
   * fallback rather than a migration.
   *
   * ONE REVIEW IS OFTEN SEVERAL PAGES. A scalar target_path meant every `add`
   * overwrote the last one: the reload watcher then pointed at whichever page
   * was added most recently, and path-matching only ever found that one, so a
   * multi-page review splintered into new reviews as the reviewer moved around.
   * So target paths accumulate in `target_paths`, newest last and deduped.
   * `target_path` stays as the most recent one, because `add` reads that field
   * off meta.json (reviewMatchingPath) and old meta files carry only it.
   *
   * @param {string} reviewId
   * @param {{target_path?: string|null, source_path?: string|null}} paths
   */
  function recordPaths(reviewId, paths) {
    var review = get(reviewId);
    if (!review) return null;
    var p = paths || {};
    var changed = false;
    if (typeof p.target_path === "string" && p.target_path) {
      if (review.target_path !== p.target_path) {
        review.target_path = p.target_path;
        changed = true;
      }
      if (!Array.isArray(review.target_paths)) review.target_paths = [];
      if (review.target_paths.indexOf(p.target_path) === -1) {
        review.target_paths.push(p.target_path);
        changed = true;
      }
    }
    if (typeof p.source_path === "string" && p.source_path && review.source_path !== p.source_path) {
      review.source_path = p.source_path;
      changed = true;
    }
    if (changed) persist(review);
    return review;
  }

  /**
   * Every page recorded for this review, newest last.
   *
   * The source template is NOT one of them: it is what the page is built FROM,
   * so watching it fires the reload before the built page has changed.
   */
  function targetPathsOf(review) {
    var out = Array.isArray(review.target_paths) ? review.target_paths.slice() : [];
    // Reviews created before target_paths existed, and reviews whose meta was
    // written by `add` on disk, carry the scalar only.
    if (typeof review.target_path === "string" && review.target_path && out.indexOf(review.target_path) === -1) {
      out.push(review.target_path);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Has the reviewed FILE changed on disk?
  // ---------------------------------------------------------------------------
  //
  // R36 says the page updates itself as the agent lands changes, and D7 assumed
  // the serving environment supplies that refresh (a dev server hot-reloads, and
  // the agent's landed change arrives as a repaint). The dominant real case is a
  // built static page behind a plain http server, which reloads nothing ever, so
  // R36 shipped unmet there: the reviewer had to be told to press reload. This
  // is the missing TRIGGER. The survival half (replay of their outstanding work
  // over the agent's landed changes) is D7's pass and already runs on load.
  //
  // A cheap fs.stat when asked, not a watcher. The library asks once a second on
  // its reply poll, one stat per review per second is nothing, and a watcher
  // would mean fd lifetimes, rename handling, and a restart story for a fact
  // that is one syscall to recompute. The TTL is there so several requests in
  // one tick share a stat, not to make it cheap enough to do at all.
  //
  // Fail soft: a review with no recorded path, a file the build deleted, or a
  // stat that throws all answer null. This number is a convenience on top of a
  // route the reviewer's page depends on, and it may never cost them that route.
  var MTIME_TTL_MS = 500;
  var mtimeCache = Object.create(null);

  // The same stat, extended: when the file it looked at came back from a build
  // without this review's script line, the healer puts the line back before the
  // mtime is reported, so the reload the page is about to do lands on a page
  // that carries the library again. See src/service/heal.js for the rules.
  var healer = healModule.createHealer({ log: log, now: clock });

  /**
   * The origin the healed script line names the helper by.
   *
   * The port comes from what this helper bound (writeReadyFile is told it when
   * the listener is up), and falls back to the default, which is the port `add`
   * writes onto every line it has ever written. The host is the loopback one the
   * whole tool speaks on; a helper is never remote.
   */
  function helperOrigin() {
    var port = lastReadyDetails && lastReadyDetails.port ? lastReadyDetails.port : protocol.DEFAULT_PORT;
    return "http://" + protocol.DEFAULT_HOST + ":" + port;
  }

  /** The one retained filesystem target represented by a browser pathname. */
  function targetForPage(paths, pagePath) {
    if (paths.length === 1) return paths[0];
    if (typeof pagePath !== "string" || !pagePath) return null;

    var decoded = pagePath;
    try {
      decoded = decodeURIComponent(pagePath);
    } catch (error) {
      // A malformed escape is simply not a target identity. The poll still
      // heals every retained page below, but reports no cross-page mtime.
    }
    var page = decoded.replace(/\\/g, "/");
    var variants = [page];
    if (page.charAt(page.length - 1) === "/") variants.push(page + "index.html", page + "index.htm");

    var matches = paths.filter(function (target) {
      var normalized = String(target).replace(/\\/g, "/");
      return variants.some(function (variant) {
        if (!variant) return false;
        return (
          normalized === variant ||
          normalized === variant.replace(/^\//, "") ||
          normalized.slice(-variant.length) === variant
        );
      });
    });
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * The requesting page's modification time, as an ISO string, or null.
   *
   * Every retained page is still considered for script-line healing. Only the
   * value returned to the browser is page-specific, so rebuilding page A can
   * repair A without telling an open page B that B itself changed.
   *
   * @param {string} reviewId
   * @param {string|null} pagePath the requesting browser's location.pathname
   * @returns {string|null} null when the request cannot be mapped uniquely, the
   *   file is gone, or the stat failed for any reason at all
   */
  function targetMtime(reviewId, pagePath) {
    var review = get(reviewId);
    if (!review) return null;
    var paths = targetPathsOf(review);
    if (paths.length === 0) return null;
    var key = paths.join("\n");
    var cached = mtimeCache[reviewId];
    var now = clock();
    var selected = targetForPage(paths, pagePath);
    if (cached && cached.key === key && now - cached.at < MTIME_TTL_MS) {
      return selected && Object.prototype.hasOwnProperty.call(cached.byPath, selected)
        ? cached.byPath[selected]
        : null;
    }
    var byPath = Object.create(null);
    var newest = null;
    paths.forEach(function (target) {
      var at = healer.consider({
        path: target,
        review: review.id,
        token: review.token,
        helperOrigin: helperOrigin(),
        servedBy: function () {
          return servedByStaticServer(review, target);
        }
      });
      byPath[target] = at;
      if (at && (!newest || at > newest)) newest = at;
    });
    mtimeCache[reviewId] = { key: key, at: now, byPath: byPath };
    // Old callers and old pages did not send page_path. Keep the original
    // single-page contract, but fail closed for an ambiguous multi-page review
    // instead of making one page reload for another page's write.
    if (!selected) return paths.length === 1 ? newest : null;
    return byPath[selected] || null;
  }

  /**
   * Is this page's script line already going into every response?
   *
   * A review `lahe review` owns the server for gets its tag injected at serve
   * time, and the file on disk is left alone: that is what keeps a review id
   * and a per-review token out of the reviewer's working tree. The healer asks
   * this before it writes anything.
   *
   * Fails soft toward healing. A page missing its rail is a review the reviewer
   * cannot use; a redundant tag on disk is untidy. Given a doubtful answer,
   * take the untidy one.
   */
  function servedByStaticServer(review, target) {
    try {
      return staticServersModule.servesPath(dir, review.agent_session_id, target);
    } catch (error) {
      return false;
    }
  }

  /**
   * When this helper last put a stripped script line back for a review, as an
   * ISO string, or null.
   *
   * In memory only, like the liveness fact beside it: it says what happened in
   * this helper's lifetime, and a number persisted across a restart would be a
   * claim about a session nobody is in any more. `lahe status` reads it through
   * review.read.
   */
  function lastHealAt(reviewId) {
    return healer.lastHealAt(reviewId);
  }

  // ---------------------------------------------------------------------------
  // Liveness: when did this review's PAGE last say anything?
  // ---------------------------------------------------------------------------
  //
  // The question a reviewer kept asking out loud mid-session was "are you
  // getting my edits?", and neither side could answer it. This is the helper's
  // half of the answer: the instant of the last authenticated request from the
  // LIBRARY (x-lahe-client: layer) for each review. Only the layer counts, so a
  // CLI command asking about a review cannot make the page look connected.
  //
  // In memory only, on purpose. It is a fact about right now, and a number
  // persisted across a restart would be a stale claim that a page is connected.
  // `lahe status` reads it through review.read, and says "unknown" rather than
  // guessing when no helper is up.
  var lastSeen = Object.create(null);

  function touch(reviewId, client) {
    if (client !== protocol.CLIENT_LAYER) return null;
    if (!Object.prototype.hasOwnProperty.call(reviews, reviewId)) return null;
    lastSeen[reviewId] = new Date().toISOString();
    return lastSeen[reviewId];
  }

  /** The last time the page checked in, as an ISO string, or null. */
  function lastSeenAt(reviewId) {
    return Object.prototype.hasOwnProperty.call(lastSeen, reviewId) ? lastSeen[reviewId] : null;
  }

  /**
   * The config protocol.checkRequest reads.
   *
   * One shape, built here, so the check block never grows a second idea of what
   * a registered review looks like.
   */
  function config() {
    var out = { reviews: {} };
    Object.keys(reviews).forEach(function (id) {
      out.reviews[id] = { token: reviews[id].token, origins: reviews[id].origins.slice() };
    });
    return out;
  }

  /**
   * The readiness file: the port, the pid, and every review's token.
   *
   * Written beside and renamed, owner-only. This is both the "I am up" signal
   * and the way anything else on the machine learns a review's token, so it is
   * written AFTER the listener is bound, never before: a readiness file that
   * arrives before the socket is a lie a test will race.
   */
  // What the last writeReadyFile was told: the port and the start instant. Held
  // so the file can be rewritten when the set of reviews changes without the
  // caller having to hand those two facts over again.
  var lastReadyDetails = null;

  function writeReadyFile(details) {
    var d = details || {};
    lastReadyDetails = { port: d.port, started_at: d.started_at || new Date().toISOString() };
    var payload = {
      port: lastReadyDetails.port,
      pid: process.pid,
      started_at: lastReadyDetails.started_at,
      api: protocol.API_VERSION,
      service_contract: protocol.SERVICE_CONTRACT,
      reviews: {}
    };
    Object.keys(reviews).forEach(function (id) {
      payload.reviews[id] = {
        token: reviews[id].token,
        origins: reviews[id].origins.slice(),
        agent_session_id: reviews[id].agent_session_id || "legacy"
      };
    });
    stateDir.ensureDir(dir);
    stateDir.writeAtomic(stateDir.readyPath(dir), JSON.stringify(payload, null, 2) + "\n");
    return payload;
  }

  // ---------------------------------------------------------------------------
  // The one session per review
  // ---------------------------------------------------------------------------

  /**
   * How long the holder has had this review, in words a reviewer reads.
   *
   * The refusal text is shown on the rail, and a raw ISO timestamp ("holding it
   * since 2026-08-18T02:48:36.137Z") is machine output in a sentence meant for a
   * person. The wording itself lives in src/shared/elapsed.js, because the RAIL
   * says the same thing about the same holder and two spellings of one fact is
   * how the helper and the page ended up disagreeing on screen. The `since`
   * field of the refusal is untouched: that one IS for machines.
   */
  function heldForPhrase(holder) {
    var startedAt = typeof holder.since_ms === "number" ? holder.since_ms : holder.since;
    return elapsed.elapsedPhrase(startedAt, { now: clock() });
  }

  function holderIsStale(holder) {
    return clock() - holder.last_seen > STALE_AFTER_MS;
  }

  /**
   * Claim, or keep, the one session on a review.
   *
   * Identity as the CURRENT holder is possession of the session secret, never
   * the window id: a request whose secret matches the holder's is the holder's
   * heartbeat, whatever id it carries. A window with a valid review token but no
   * matching secret is either a refused second window (holder alive) or a
   * takeover (holder stale, or takeover:true asked explicitly).
   *
   * @param {string} reviewId
   * @param {{window_id: string, session_secret?: string, takeover?: boolean}} request
   * @returns {{granted: boolean, since: string, heartbeat_seconds: number,
   *            reason: string|null, took_over: boolean, session_secret?: string}}
   *   The `session_secret` is present on a grant only, and is the holder's to
   *   keep. A refusal discloses neither the holder's window id nor its secret.
   */
  function claimWindow(reviewId, request) {
    var req = request || {};
    var windowId = req.window_id;
    if (typeof windowId !== "string" || !windowId) {
      throw new Error("claimWindow: window_id is required");
    }
    var holder = sessions[reviewId] || null;
    var at = clock();

    if (holder && secretsMatch(holder.session_secret, req.session_secret)) {
      // The holder proving it is still there, with the secret only it was given.
      // This is the heartbeat, and it is the ONLY thing recognized as the holder.
      holder.last_seen = at;
      holder.window_id = windowId;
      return granted(holder, false, null);
    }

    var wantsTakeover = req.takeover === true;

    if (holder && !holderIsStale(holder) && !wantsTakeover) {
      // A window that is not the holder and did not ask to take over, while the
      // holder is alive. Refused, and the refusal names NOTHING about the holder:
      // no window id (which a rival used to replay as a heartbeat) and no secret.
      var reason =
        "this review is already open in another window, which has been holding it " +
        heldForPhrase(holder) +
        ". Close that window, or wait " +
        Math.ceil(STALE_AFTER_MS / 1000) +
        " seconds after it stops responding and this one takes over.";
      log.helperLog("review " + reviewId + ": refused window " + windowId + " (holder still alive)");
      return {
        granted: false,
        since: holder.since,
        heartbeat_seconds: HEARTBEAT_SECONDS,
        reason: reason,
        took_over: false
      };
    }

    // Granted: either there was no holder, the holder went stale, or a token-
    // bearing window explicitly took over. A fresh secret is minted every time,
    // so a deposed holder's old secret can never re-assert possession.
    var tookOver = !!holder;
    if (tookOver) {
      log.helperLog(
        "review " +
          reviewId +
          ": window " +
          windowId +
          (holderIsStale(holder)
            ? " took over from a holder whose heartbeat had been quiet for more than " +
              Math.ceil(STALE_AFTER_MS / 1000) +
              " seconds"
            : " took over on an explicit Review-here-instead")
      );
    }
    sessions[reviewId] = {
      window_id: windowId,
      session_secret: mintSessionSecret(),
      since: new Date().toISOString(),
      // The same instant on the injectable clock, which is what the refusal
      // measures elapsed time against. `since` is the wire field and stays ISO.
      since_ms: at,
      last_seen: at
    };
    return granted(sessions[reviewId], tookOver, null);
  }

  function granted(holder, tookOver, reason) {
    return {
      granted: true,
      since: holder.since,
      heartbeat_seconds: HEARTBEAT_SECONDS,
      reason: reason,
      took_over: !!tookOver,
      // The holder's own secret, handed back to the holder only. The heartbeat
      // carries it; a refusal never sees it.
      session_secret: holder.session_secret
    };
  }

  /** Who holds a review right now, or null. Read-only; changes nothing. */
  function holderOf(reviewId) {
    var holder = sessions[reviewId];
    if (!holder) return null;
    return {
      window_id: holder.window_id,
      since: holder.since,
      stale: holderIsStale(holder)
    };
  }

  /** The reviewer closed the review. Nothing is truncated; the log is archived. */
  function endReview(reviewId) {
    var review = get(reviewId);
    if (!review) throw new Error("endReview: no review named " + JSON.stringify(reviewId));
    var endedAt = new Date().toISOString();
    log.append(reviewId, [
      protocol.newEvent({
        event: protocol.EVENT.REVIEW_ARCHIVED,
        event_id: "ev_" + crypto.randomBytes(8).toString("hex"),
        review: reviewId,
        ts: endedAt
      })
    ]);
    delete sessions[reviewId];
    log.helperLog("review " + reviewId + " archived");
    return { ended_at: endedAt };
  }

  return {
    HEARTBEAT_SECONDS: HEARTBEAT_SECONDS,
    STALE_AFTER_MS: STALE_AFTER_MS,
    RESCAN_INTERVAL_MS: RESCAN_INTERVAL_MS,
    RESCAN_TRACKED_MAX: RESCAN_TRACKED_MAX,
    loadFromDisk: loadFromDisk,
    create: create,
    get: get,
    ensureKnown: ensureKnown,
    list: list,
    registerOrigin: registerOrigin,
    recordPaths: recordPaths,
    touch: touch,
    lastSeenAt: lastSeenAt,
    targetMtime: targetMtime,
    lastHealAt: lastHealAt,
    config: config,
    writeReadyFile: writeReadyFile,
    claimWindow: claimWindow,
    holderOf: holderOf,
    endReview: endReview
  };
}

module.exports = {
  TOKEN_BYTES: TOKEN_BYTES,
  HEARTBEAT_SECONDS: HEARTBEAT_SECONDS,
  STALE_AFTER_MS: STALE_AFTER_MS,
  RESCAN_INTERVAL_MS: RESCAN_INTERVAL_MS,
  RESCAN_TRACKED_MAX: RESCAN_TRACKED_MAX,
  mintToken: mintToken,
  mintReviewId: mintReviewId,
  createReviews: createReviews
};
