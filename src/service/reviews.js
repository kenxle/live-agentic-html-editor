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
    events.forEach(function (event) {
      var type = event[protocol.EVENT_FIELD.EVENT];
      if (type === protocol.EVENT.REVIEW_CREATED) {
        if (event.token && typeof event.token === "string") token = event.token;
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
        review: id,
        // The token rides the created event too, not only meta.json, so a
        // corrupt meta on restart can be recovered from the append-only log
        // instead of orphaning the whole review's edits (NEW-3). events.jsonl is
        // owner-only, the same class of secret as meta.json; the no-token rule is
        // about the diagnostic helper.log, not the source-of-truth log.
        payload: { token: review.token }
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
        "this review is already open in another window, which has been holding it since " +
        holder.since +
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
