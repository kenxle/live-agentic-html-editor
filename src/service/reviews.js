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
// ONE SESSION PER REVIEW, WITH A HEARTBEAT. A second window is refused with a
// reason naming the first. A holder whose heartbeat has been quiet for thirty
// seconds has lost the review, and the next window takes over rather than being
// locked out: a reviewer shut out of their own review after a crash is a
// work-losing outcome in a tool whose whole thesis is never losing work.
//
// Node-only.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");

var TOKEN_BYTES = 32;

// The holder tells the helper it is still there on this cadence, and the helper
// calls a holder lost after this silence. The gap between them is deliberate: a
// holder gets two missed beats before anyone can take its review.
var HEARTBEAT_SECONDS = 10;
var STALE_AFTER_MS = 30 * 1000;

function mintToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
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
      if (!fs.existsSync(metaPath)) return;
      try {
        var parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (parsed && typeof parsed.token === "string" && parsed.token) {
          reviews[entry.name] = {
            id: entry.name,
            token: parsed.token,
            origins: Array.isArray(parsed.origins) ? parsed.origins.slice() : [],
            created_at: parsed.created_at || new Date().toISOString()
          };
        }
      } catch (err) {
        log.helperLog("review " + entry.name + " has an unreadable " + stateDir.FILES.meta + ": " + err.message);
      }
    });
    return reviews;
  }

  function get(reviewId) {
    return Object.prototype.hasOwnProperty.call(reviews, reviewId) ? reviews[reviewId] : null;
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
      (spec.origins || []).forEach(function (origin) {
        registerOrigin(id, origin);
      });
      return existing;
    }

    var review = {
      id: id,
      token: mintToken(),
      origins: [],
      created_at: new Date().toISOString()
    };
    reviews[id] = review;
    persist(review);

    log.append(id, [
      protocol.newEvent({
        event: protocol.EVENT.REVIEW_CREATED,
        event_id: "ev_" + crypto.randomBytes(8).toString("hex"),
        review: id
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
    return review;
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
  function writeReadyFile(details) {
    var d = details || {};
    var payload = {
      port: d.port,
      pid: process.pid,
      started_at: d.started_at || new Date().toISOString(),
      api: protocol.API_VERSION,
      reviews: {}
    };
    Object.keys(reviews).forEach(function (id) {
      payload.reviews[id] = { token: reviews[id].token, origins: reviews[id].origins.slice() };
    });
    stateDir.ensureDir(dir);
    stateDir.writeAtomic(stateDir.readyPath(dir), JSON.stringify(payload, null, 2) + "\n");
    return payload;
  }

  // ---------------------------------------------------------------------------
  // The one session per review
  // ---------------------------------------------------------------------------

  function holderIsStale(holder) {
    return clock() - holder.last_seen > STALE_AFTER_MS;
  }

  /**
   * Claim, or keep, the one session on a review.
   *
   * @param {string} reviewId
   * @param {{window_id: string, takeover?: boolean}} request
   * @returns {{granted: boolean, holder: string, since: string,
   *            heartbeat_seconds: number, reason: string|null, took_over: boolean}}
   */
  function claimWindow(reviewId, request) {
    var req = request || {};
    var windowId = req.window_id;
    if (typeof windowId !== "string" || !windowId) {
      throw new Error("claimWindow: window_id is required");
    }
    var holder = sessions[reviewId] || null;
    var at = clock();

    if (holder && holder.window_id === windowId) {
      // The holder saying it is still there. This is the heartbeat.
      holder.last_seen = at;
      return granted(holder, false, null);
    }

    if (holder && !holderIsStale(holder)) {
      var reason =
        "this review is already open in another window (" +
        holder.window_id +
        "), which has been holding it since " +
        holder.since +
        ". Close that window, or wait " +
        Math.ceil(STALE_AFTER_MS / 1000) +
        " seconds after it stops responding and this one takes over.";
      log.helperLog(
        "review " + reviewId + ": refused window " + windowId + ", held by " + holder.window_id
      );
      return {
        granted: false,
        holder: holder.window_id,
        since: holder.since,
        heartbeat_seconds: HEARTBEAT_SECONDS,
        reason: reason,
        took_over: false
      };
    }

    var tookOver = !!holder;
    if (tookOver) {
      log.helperLog(
        "review " +
          reviewId +
          ": window " +
          windowId +
          " took over from " +
          holder.window_id +
          ", whose heartbeat had been quiet for more than " +
          Math.ceil(STALE_AFTER_MS / 1000) +
          " seconds"
      );
    }
    sessions[reviewId] = {
      window_id: windowId,
      since: new Date().toISOString(),
      last_seen: at
    };
    return granted(sessions[reviewId], tookOver, null);
  }

  function granted(holder, tookOver, reason) {
    return {
      granted: true,
      holder: holder.window_id,
      since: holder.since,
      heartbeat_seconds: HEARTBEAT_SECONDS,
      reason: reason,
      took_over: !!tookOver
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
    loadFromDisk: loadFromDisk,
    create: create,
    get: get,
    list: list,
    registerOrigin: registerOrigin,
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
  mintToken: mintToken,
  mintReviewId: mintReviewId,
  createReviews: createReviews
};
