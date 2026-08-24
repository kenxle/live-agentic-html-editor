// The wire: every byte that leaves this repo.
//
// Owner: 0A-wire. Imported by: the helper's router and per-request check block
// (1A), the sync client and reply poll loop (1B), the projection and reply
// folder (3A), and the CLI commands.
//
// Four things live here, and they are here because something OUTSIDE this repo
// reads or writes them: an agent, a browser, or a person typing a script tag.
//
//  1. THE EVENT LOG LINE (D5). One JSON object per line of events.jsonl, with a
//     closed event-type vocabulary. Idempotence is by `event_id`, never by
//     (item, rev).
//  2. THE REPLY LINE (D6). The tool's public API to every agent on earth: one
//     appended JSON line, its required fields per status, and what the helper
//     does with a malformed one (skips it, never dies).
//  3. THE REQUEST CHECKS (D11). Loopback is not a boundary, so the page proves
//     itself on every request: a per-review token, a custom header, a JSON
//     content type, a Host naming the helper, and an origin read from the
//     request's own header. Absent configuration fails closed, and every
//     refusal names the check that failed.
//  4. THE THINGS A PERSON TYPES: the script tag's attributes with the fixed
//     default port, plus the CLI exit codes shared by the dispatcher and status.
//
// The record's own field names are NOT here. Import them from record.js.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.protocol = factory(root.LAHE.failures);
  } else {
    module.exports = factory(require("./failures.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (failures) {
  "use strict";

  var API_VERSION = "v1";
  // The URL API can remain v1 while the long-running helper gains projection,
  // session, or persistence behavior that a newly built rail depends on. A
  // helper process keeps its required modules in memory even though it serves
  // a freshly rebuilt browser bundle from disk, so API_VERSION alone cannot
  // prevent a new rail from talking to yesterday's backend. Bump this integer
  // whenever an old helper cannot safely back a newly built CLI/layer.
  // 9: older helpers omit reply.at, so they cannot back the timestamped rail
  // and must be restarted before a new page connects.
  // 10: older helpers never append wake-feed lines and omit agent_liveness, so
  // a tail-armed agent would sleep through work and the rail could not tell
  // whether an agent is watching. They must be restarted.
  // 11: older helpers drop user_needs_to_see_reply during the reply fold, so a
  // flagged reply would silently lose its flag and never badge the reviewer.
  // They must be restarted.
  // 12: older static servers hand back raw Markdown bytes from a source mount
  // and have no on-request renderer, so a reviewed document's links to other
  // local documents download or 404 behind them. They must be restarted.
  var SERVICE_CONTRACT = 12;
  var BASE = "/lahe/" + API_VERSION;

  // ---------------------------------------------------------------------------
  // Where the helper lives
  // ---------------------------------------------------------------------------
  //
  // 7817 is FIXED by default, configurable with --port. An ephemeral port makes
  // the reconnect-and-re-post promise false the first time the helper restarts:
  // the page has a port baked into its script tag and no way to learn a new one.

  var DEFAULT_PORT = 7817;
  var DEFAULT_HOST = "127.0.0.1";
  var DEFAULT_HELPER_ORIGIN = "http://" + DEFAULT_HOST + ":" + DEFAULT_PORT;

  // The helper binds loopback only. The Host check below allows exactly these
  // names, which is what stops a DNS rebinding attack from reaching a handler
  // with a browser's own cooperation.
  var ALLOWED_HOST_NAMES = ["127.0.0.1", "localhost", "[::1]", "::1"];

  // ---------------------------------------------------------------------------
  // What may be added to a review's origin allowlist OVER THE WIRE
  // ---------------------------------------------------------------------------
  //
  // The security model is two factors: the per-review token AND the origin
  // allowlist. `review.write` takes origins in its BODY, so without this a
  // script running on an already-allowed page could read the token off the
  // script tag and add any origin it liked, which leaves the token as the only
  // factor. So the route accepts only what `add` legitimately sends: the literal
  // "null" (a page opened from a file), and http/https on a loopback host. `add`
  // writing to disk is deliberately wider, because that path is a person at a
  // terminal typing --origin, not a page.
  var LOOPBACK_ORIGIN_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

  // Enough for the ordinary spread (127.0.0.1 and localhost, a couple of ports,
  // http and https) with room to spare, and low enough that a caller quietly
  // accumulating origins is refused rather than growing the list forever.
  var ORIGIN_LIMIT = 16;

  /**
   * May this origin be registered through `review.write`?
   *
   * @param {*} origin
   * @returns {boolean}
   */
  function isRegisterableOrigin(origin) {
    if (typeof origin !== "string" || !origin) return false;
    if (origin === "null") return true;
    var parsed;
    try {
      parsed = new URL(origin);
    } catch (err) {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    // An origin carries scheme, host and port and nothing else. A value with a
    // path, a query, credentials or a fragment is not one, whatever it parses to.
    if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) return false;
    if (origin !== parsed.origin) return false;
    return LOOPBACK_ORIGIN_HOSTS.indexOf(parsed.hostname) !== -1;
  }

  // ---------------------------------------------------------------------------
  // Headers
  // ---------------------------------------------------------------------------

  var HEADER = {
    // The required custom header. Its only job is to be non-simple: a form or
    // an img tag on a hostile page cannot set it, so a CORS-simple request can
    // never reach a handler. Value is CLIENT_LAYER or CLIENT_CLI.
    CLIENT: "x-lahe-client",
    // The per-review token (D11). Minted by the add step, embedded on the
    // script tag, and readable by anything running on the reviewed page, which
    // is exactly why it is scoped to one review and never to the machine.
    TOKEN: "x-lahe-token",
    // Echoed on every response so a chip in the rail can be matched to a line
    // in the helper log.
    REQUEST_ID: "x-lahe-request-id",
    CONTENT_TYPE: "content-type",
    ORIGIN: "origin",
    HOST: "host"
  };

  var CLIENT_LAYER = "layer";
  var CLIENT_CLI = "cli";
  var CLIENTS = [CLIENT_LAYER, CLIENT_CLI];

  var JSON_CONTENT_TYPE = "application/json";

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  //
  // Two modes, and that is the whole model. There is no session exchange and no
  // machine-wide run token: both belonged to the archived send model.

  var AUTH = {
    // Liveness only. Carries no review data, so it needs no credential.
    NONE: "none",
    // A valid token for the review named in the request.
    REVIEW_TOKEN: "review_token"
  };

  // Review ids and agent names are path components, so they are constrained to
  // a plain safe set. One regex, used for both.
  var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

  function isSafeId(value) {
    return typeof value === "string" && SAFE_ID.test(value);
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------
  //
  // mutating: true means the route additionally requires the JSON content type.
  // The custom header, the Host check, the origin read, and the token are
  // required on EVERY route except health.

  var ROUTES = [
    {
      name: "health",
      method: "GET",
      path: BASE + "/health",
      auth: AUTH.NONE,
      mutating: false,
      why: "liveness and version only, so `add` can tell a helper that is up from one that is not",
      response: "{ok, version, api, service_contract, started_at}"
    },
    {
      name: "events.append",
      method: "POST",
      path: BASE + "/events",
      auth: AUTH.REVIEW_TOKEN,
      mutating: true,
      why: "the library posts each event as it happens and re-posts anything unacknowledged on reconnect",
      request: "{review, events: [event...]}",
      response: "{accepted: [event_id...], seq}"
    },
    {
      name: "library.get",
      method: "GET",
      path: "/lahe-layer.js",
      auth: AUTH.NONE,
      mutating: false,
      why:
        "the helper serves the built library, so the script line can be an absolute URL that works from any folder. " +
        "Unauthenticated on purpose: these are the tool's own public bytes, the same file that ships in the repo, " +
        "with no review data and no token in them. It is exempt the same visible way health is, through AUTH.NONE",
      response: "the built library, as application/javascript"
    },
    {
      name: "review.write",
      method: "POST",
      path: BASE + "/review",
      auth: AUTH.REVIEW_TOKEN,
      mutating: true,
      why:
        "what `add` calls for a review the helper already holds: the helper applies the writes itself, so `add` " +
        "never has to stop a helper that is holding somebody's live review. " +
        "Its origins are DELIBERATELY NARROWER than what `add` may write to disk: only \"null\" and loopback " +
        "http/https pass (isRegisterableOrigin), capped at ORIGIN_LIMIT per review. A body-supplied origin is the " +
        "one way a script on an allowed page could widen the allowlist with a token it read off the script tag, " +
        "which would leave the token as the only factor guarding the review",
      request: "{review, origins: [origin...], target_path?, source_path?, source_hint?, page_path?}",
      response: "{origins, recorded_source, recorded_paths, seq}"
    },
    {
      name: "review.read",
      method: "GET",
      path: BASE + "/review",
      auth: AUTH.REVIEW_TOKEN,
      mutating: false,
      why: "the projection the library reconciles against on load and on every reconnect",
      request: "?review=<id>",
      response: "the review.json projection, plus {seq}"
    },
    {
      name: "replies.poll",
      method: "GET",
      path: BASE + "/replies",
      auth: AUTH.REVIEW_TOKEN,
      mutating: false,
      why:
        "the library's reply poll loop. The cursor is a seq, never a timestamp and never an offset. It also carries " +
        "the reviewed file's mtime, which is R36's refresh trigger for a static page: a changed value means the " +
        "agent rebuilt the page and the library reloads it",
      request: "?review=<id>&since=<seq>&page_path=<location.pathname>",
      response:
        "{events: [event...], seq, target_mtime, agent_liveness}; target_mtime is the requesting page's ISO mtime, " +
        "or null when its retained target cannot be identified or the file is missing. agent_liveness is " +
        "{state, unanswered, oldest_unanswered_at, last_reply_at, listening, monitor_at, activity_at}: how long it " +
        "has been since the agent answered, read off the review's own replies and the owning session's files rather " +
        "than taken from anything the agent said"
    },
    {
      name: "window.claim",
      method: "POST",
      path: BASE + "/window",
      auth: AUTH.REVIEW_TOKEN,
      mutating: true,
      why: "D5's second-window refusal for windows that cannot see each other's storage, plus the takeover",
      request: "{review, window_id, session_secret?, takeover?}",
      response: "grant {granted:true, since, heartbeat_seconds, took_over, session_secret}; refusal {granted:false, since, heartbeat_seconds, reason} (no holder id, no secret)"
    },
    {
      name: "review.end",
      method: "POST",
      path: BASE + "/end",
      auth: AUTH.REVIEW_TOKEN,
      mutating: true,
      why: "the reviewer chooses End review on the rail; the review is archived, never truncated",
      request: "{review}",
      // outstanding_kept is how many items are still READY, counted through the
      // projection. It used to be the length of the event log, which made a
      // ten-comment review report hundreds.
      response: "{ended_at, outstanding_kept}"
    }
  ];

  function route(name) {
    for (var i = 0; i < ROUTES.length; i += 1) {
      if (ROUTES[i].name === name) return ROUTES[i];
    }
    throw new Error("unknown route: " + String(name) + ". Routes are listed in src/shared/protocol.js");
  }

  // Header requirements as data, so the helper's checks and the library's
  // request builder read from one list rather than two.
  function requiredHeaders(routeName) {
    var r = route(routeName);
    var out = [];
    if (r.auth === AUTH.NONE) return out;
    out.push({ header: HEADER.CLIENT, value: "layer or cli", why: "a custom header cannot ride on a CORS-simple request" });
    out.push({ header: HEADER.TOKEN, value: "<per-review token>", why: "the per-review credential (D11)" });
    if (r.mutating) {
      out.push({ header: HEADER.CONTENT_TYPE, value: JSON_CONTENT_TYPE, why: "a JSON content type forces a preflight" });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // The per-request checks (D11)
  // ---------------------------------------------------------------------------
  //
  // Ordered, named, and each with the failure code it refuses under. The helper
  // logs the NAME of the check that failed on every refusal, which is what makes
  // AC8 (outside cannot get in) judgeable by an evaluator rather than a claim.

  var CHECK = {
    HOST: "host",
    CUSTOM_HEADER: "custom_header",
    CONTENT_TYPE: "content_type",
    REVIEW_KNOWN: "review_known",
    TOKEN: "token",
    ORIGIN: "origin"
  };

  var CHECKS = [
    {
      name: CHECK.HOST,
      code: "PROTO_BAD_HOST",
      why: "the Host header must name the helper itself, or a rebound DNS name reaches a handler with the browser's help"
    },
    {
      name: CHECK.CUSTOM_HEADER,
      code: "PROTO_MISSING_CUSTOM_HEADER",
      why: "a form post or an img tag cannot set a custom header, so requiring one refuses every CORS-simple write"
    },
    {
      name: CHECK.CONTENT_TYPE,
      code: "PROTO_UNSUPPORTED_MEDIA_TYPE",
      why: "mutating routes take JSON only, which is not a content type a simple request can send"
    },
    {
      name: CHECK.REVIEW_KNOWN,
      code: "PROTO_UNKNOWN_REVIEW",
      why: "an unknown review id has no token to check against, so it is refused rather than defaulted"
    },
    {
      name: CHECK.TOKEN,
      code: "PROTO_UNAUTHORIZED",
      why: "the per-review token, compared in full. Absent configuration fails closed"
    },
    {
      name: CHECK.ORIGIN,
      code: "PROTO_FORBIDDEN_ORIGIN",
      why: "the origin comes from the request's own header, never from its body, and must be one the add step registered"
    }
  ];

  function checkNamed(name) {
    for (var i = 0; i < CHECKS.length; i += 1) {
      if (CHECKS[i].name === name) return CHECKS[i];
    }
    throw new Error("unknown check: " + String(name));
  }

  // Constant-time token comparison. A plain !== returns at the first differing
  // character, and response timing then leaks how much of a guessed token
  // matched. Pure JS (no node:crypto) because this module also loads in the
  // browser. Length is not hidden: tokens are fixed-length mints, so length
  // carries nothing.
  function tokensEqual(a, b) {
    var max = Math.max(a.length, b.length);
    var diff = a.length === b.length ? 0 : 1;
    for (var i = 0; i < max; i += 1) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
  }

  function headerOf(headers, name) {
    if (!headers) return null;
    if (Object.prototype.hasOwnProperty.call(headers, name)) return headers[name];
    var lower = String(name).toLowerCase();
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].toLowerCase() === lower) return headers[keys[i]];
    }
    return null;
  }

  function hostAllowed(hostHeader) {
    if (typeof hostHeader !== "string" || !hostHeader) return false;
    var name = hostHeader.replace(/:\d+$/, "");
    return ALLOWED_HOST_NAMES.indexOf(name) !== -1;
  }

  // The whole check block as one pure function, so the helper cannot implement
  // five checks and forget the sixth, and so a unit test can prove each refusal
  // without a socket.
  //
  // @param request {routeName, headers, review}
  // @param config  {reviews: {<id>: {token, origins: [...]}}}
  // @returns {ok:true, review, origin} or
  //          {ok:false, check, code, log} where log NAMES the failed check
  function checkRequest(request, config) {
    var req = request || {};
    var r = route(req.routeName);
    var headers = req.headers || {};

    function refuse(name, detail) {
      var c = checkNamed(name);
      return {
        ok: false,
        check: name,
        code: c.code,
        log: "refused " + r.name + ": check " + name + " failed" + (detail ? " (" + detail + ")" : "")
      };
    }

    if (!hostAllowed(headerOf(headers, HEADER.HOST))) {
      return refuse(CHECK.HOST, String(headerOf(headers, HEADER.HOST)));
    }
    if (r.auth === AUTH.NONE) {
      return { ok: true, review: null, origin: headerOf(headers, HEADER.ORIGIN) || null };
    }
    if (CLIENTS.indexOf(headerOf(headers, HEADER.CLIENT)) === -1) {
      return refuse(CHECK.CUSTOM_HEADER, null);
    }
    if (r.mutating) {
      var ct = String(headerOf(headers, HEADER.CONTENT_TYPE) || "").split(";")[0].trim().toLowerCase();
      if (ct !== JSON_CONTENT_TYPE) return refuse(CHECK.CONTENT_TYPE, ct || "none");
    }

    // Fails closed: no configuration at all, or a review nobody registered, is a
    // refusal rather than a default-allow.
    var reviews = (config && config.reviews) || null;
    var reviewId = req.review;
    if (!reviews || !isSafeId(reviewId) || !Object.prototype.hasOwnProperty.call(reviews, reviewId)) {
      return refuse(CHECK.REVIEW_KNOWN, String(reviewId));
    }
    var registered = reviews[reviewId];
    var presented = headerOf(headers, HEADER.TOKEN);
    if (!registered.token || typeof presented !== "string" || !tokensEqual(presented, registered.token)) {
      return refuse(CHECK.TOKEN, null);
    }

    // The origin is read from the header. A page cannot forge it, which is what
    // makes the allowlist the real control. A page opened from a file sends
    // "null" (or nothing), which is allowed only when the add step registered
    // the file origin for this review, per D11's stated residual risk.
    var origin = headerOf(headers, HEADER.ORIGIN);
    var allowed = registered.origins || [];
    var effective = origin === null || origin === undefined || origin === "" ? "null" : String(origin);
    if (allowed.indexOf(effective) === -1) return refuse(CHECK.ORIGIN, effective);

    return { ok: true, review: reviewId, origin: effective };
  }

  // ---------------------------------------------------------------------------
  // Error shape
  // ---------------------------------------------------------------------------
  //
  // One shape for every non-2xx response, so the sync client has one parser and
  // the rail can put any of them in the failures list without a special case:
  //
  //   { "error": { "code", "message", "remedy", "detail", "check", "request_id" } }

  var STATUS_FOR_CODE = {
    PROTO_BAD_REQUEST: 400,
    PROTO_BAD_HOST: 400,
    PROTO_MISSING_CUSTOM_HEADER: 400,
    PROTO_UNSUPPORTED_MEDIA_TYPE: 415,
    PROTO_UNAUTHORIZED: 401,
    PROTO_FORBIDDEN_ORIGIN: 403,
    PROTO_UNKNOWN_REVIEW: 404,
    PROTO_UNKNOWN_ITEM: 404,
    PROTO_STALE_REV: 409,
    PROTO_SECOND_WINDOW: 409,
    PROTO_SECOND_INSTANCE: 409
  };

  function statusFor(code) {
    return Object.prototype.hasOwnProperty.call(STATUS_FOR_CODE, code) ? STATUS_FOR_CODE[code] : 500;
  }

  function errorBody(code, detail, requestId, check) {
    var f = failures.failure(code, detail);
    return {
      error: {
        code: f.code,
        message: f.message,
        remedy: f.remedy,
        detail: f.detail,
        check: check || null,
        request_id: requestId || null
      }
    };
  }

  // ---------------------------------------------------------------------------
  // The events.jsonl line (D5)
  // ---------------------------------------------------------------------------
  //
  // One JSON object per line. An interrupted write corrupts at most the last
  // line, never history.

  var EVENT = {
    REVIEW_CREATED: "review.created",
    ORIGIN_REGISTERED: "origin.registered",
    PAGE_VISITED: "page.visited",
    ITEM_CREATED: "item.created",
    // Every content change, INCLUDING every draft keystroke batch. This is the
    // event the flush policy below governs.
    ITEM_CONTENT: "item.content",
    ITEM_READY: "item.ready",
    ITEM_DELETED: "item.deleted",
    ITEM_REOPENED: "item.reopened",
    REPLY_FOLDED: "reply.folded",
    REPLY_REJECTED: "reply.rejected",
    REVIEW_ARCHIVED: "review.archived"
  };

  // Closed. The projector, the merge rule, and reply folding all switch on this
  // list, and it is the thing a builder invents first if it is not written down.
  var EVENT_TYPES = Object.keys(EVENT).map(function (k) {
    return EVENT[k];
  });

  var EVENT_FIELD = {
    EVENT: "event",
    EVENT_ID: "event_id",
    TS: "ts",
    SEQ: "seq",
    REVIEW: "review",
    ITEM: "item",
    REV: "rev",
    PAGE_PATH: "page_path",
    PAGE_TITLE: "page_title",
    PAGE_SEQ: "page_seq",
    SOURCE_HINT: "source_hint"
  };

  // IDEMPOTENCE IS BY event_id, NEVER BY (item, rev). Drafts do not bump rev and
  // drafts flow to the helper, so the log legitimately holds many events sharing
  // an item and a revision with different content. An idempotency rule keyed on
  // (item, rev) would either drop the later draft or make a reconnect re-post
  // ambiguous. (item, rev) is reserved for lifecycle.
  var IDEMPOTENCE_KEY = EVENT_FIELD.EVENT_ID;

  // The client mints event_id and ts. The helper assigns seq, monotonic per
  // review, which is the cursor every reader uses.
  function newEvent(input) {
    var src = input || {};
    if (EVENT_TYPES.indexOf(src.event) === -1) {
      throw new Error("newEvent: event must be one of " + EVENT_TYPES.join(", ") + ", got " + String(src.event));
    }
    if (typeof src.event_id !== "string" || !src.event_id) {
      throw new Error("newEvent: event_id is required and is client-minted; idempotence is by event_id");
    }
    if (!isSafeId(src.review)) {
      throw new Error("newEvent: review must be a safe id, got " + String(src.review));
    }
    var e = {};
    e[EVENT_FIELD.EVENT] = src.event;
    e[EVENT_FIELD.EVENT_ID] = src.event_id;
    e[EVENT_FIELD.TS] = src.ts || new Date().toISOString();
    e[EVENT_FIELD.SEQ] = typeof src.seq === "number" ? src.seq : null;
    e[EVENT_FIELD.REVIEW] = src.review;
    e[EVENT_FIELD.ITEM] = src.item || null;
    e[EVENT_FIELD.REV] = typeof src.rev === "number" ? src.rev : null;
    e[EVENT_FIELD.PAGE_PATH] = src.page_path || null;
    e[EVENT_FIELD.PAGE_TITLE] = src.page_title || null;
    e[EVENT_FIELD.PAGE_SEQ] = typeof src.page_seq === "number" ? src.page_seq : null;
    e[EVENT_FIELD.SOURCE_HINT] = src.source_hint || null;
    if (src.payload && typeof src.payload === "object") {
      Object.keys(src.payload).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(e, k)) e[k] = src.payload[k];
      });
    }
    return e;
  }

  // One line, newline terminated. JSON.stringify escapes every newline and
  // control character inside a string value, which is what keeps one event on
  // one line however strange the page's text is.
  function encodeEventLine(event) {
    return JSON.stringify(event) + "\n";
  }

  function parseEventLine(line) {
    var parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      return { ok: false, reason: "not JSON: " + err.message };
    }
    if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not an object" };
    if (EVENT_TYPES.indexOf(parsed[EVENT_FIELD.EVENT]) === -1) {
      return { ok: false, reason: "unknown event type " + String(parsed[EVENT_FIELD.EVENT]) };
    }
    if (typeof parsed[EVENT_FIELD.EVENT_ID] !== "string" || !parsed[EVENT_FIELD.EVENT_ID]) {
      return { ok: false, reason: "missing event_id, which is the idempotence key" };
    }
    return { ok: true, event: parsed };
  }

  // ---------------------------------------------------------------------------
  // The draft flush policy (D5)
  // ---------------------------------------------------------------------------
  //
  // Stated once, here, so 1B does not invent it. This is what decides how fast
  // the log grows, the shape of the draft durability test, and how much of a
  // sentence a kill -9 mid-draft can cost.

  var FLUSH = {
    // Synchronous, every keystroke, no debounce. A reload, a crash, or a sleep
    // costs nothing.
    TO_BROWSER_STORAGE: "every keystroke, synchronously",
    // Debounced to the helper at 750ms of typing idle.
    HELPER_DEBOUNCE_MS: 750,
    // Plus an immediate flush on each of these, with no debounce.
    IMMEDIATE_ON: ["blur", "ready", "navigation", "unload"],
    // THE UNLOAD POST USES fetch(..., {keepalive: true}), NEVER sendBeacon.
    // sendBeacon cannot set the custom header D11 requires and cannot set the
    // JSON content type, so the obvious tool either drops the header (silently
    // breaking "no exceptions") or watches the post get refused during unload,
    // when nothing is watching.
    TRANSPORT_ON_UNLOAD: "fetch keepalive",
    SEND_BEACON_IS_FORBIDDEN: true,
    // Keepalive carries headers at the cost of a body limit of roughly 64KB
    // across all in-flight keepalive requests.
    KEEPALIVE_MAX_BYTES: 64 * 1024,
    // An edit too large for that is already safe in browser storage and goes to
    // the helper on the next load, so the cap costs latency, never work.
    OVERSIZE_FALLBACK: "leave it in browser storage; post it on the next load"
  };

  function byteLength(text) {
    var s = String(text === null || text === undefined ? "" : text);
    if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
    return Buffer.byteLength(s, "utf8");
  }

  // True when this body may go out on the unload path. False means the oversize
  // fallback, which is a delay and never a loss.
  function fitsKeepalive(body) {
    return byteLength(typeof body === "string" ? body : JSON.stringify(body)) <= FLUSH.KEEPALIVE_MAX_BYTES;
  }

  // ---------------------------------------------------------------------------
  // The reply line (D6)
  // ---------------------------------------------------------------------------
  //
  // The tool's public API to every agent on earth. Field names spelled here and
  // nowhere else:
  //
  //   {"item":"<item-id>","rev":<n>,"status":"handled|not_handled|question",
  //    "agent":"<name>","reason":"<why not>","text":"<the question>","files":["<path>"],
  //    "user_needs_to_see_reply":true}
  //
  // `user_needs_to_see_reply` is how an agent says this answer is worth the
  // reviewer's attention: an answer to them, a caveat, a judgment call, a change
  // made differently than asked. It is what the unread badge counts, so a
  // routine "carried this into the source" no longer interrupts anyone. A
  // `question` or `not_handled` reply counts with or without it.

  var REPLY_FIELD = {
    ITEM: "item",
    REV: "rev",
    STATUS: "status",
    AGENT: "agent",
    REASON: "reason",
    TEXT: "text",
    FILES: "files",
    NEEDS_SEE: "user_needs_to_see_reply"
  };

  var REPLY_STATUS = { HANDLED: "handled", NOT_HANDLED: "not_handled", QUESTION: "question" };
  var REPLY_STATUSES = [REPLY_STATUS.HANDLED, REPLY_STATUS.NOT_HANDLED, REPLY_STATUS.QUESTION];

  // Required per status. `agent` and `files` are optional everywhere.
  var REPLY_REQUIRED = {
    handled: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS],
    not_handled: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS, REPLY_FIELD.REASON],
    question: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS, REPLY_FIELD.TEXT]
  };

  // replies.jsonl for the single-agent case, replies-<agent>.jsonl when several
  // agents work at once. The agent segment is a PATH COMPONENT, so it is
  // constrained to the same safe set as review ids; a file whose agent segment
  // fails the filter is ignored and reported.
  var REPLY_FILE = {
    SINGLE: "replies.jsonl",
    PATTERN: /^replies(?:-([A-Za-z0-9][A-Za-z0-9._-]{0,63}))?\.jsonl$/,
    prefix: "replies-",
    suffix: ".jsonl"
  };

  function agentFromFilename(filename) {
    var m = REPLY_FILE.PATTERN.exec(String(filename || ""));
    if (!m) return { ok: false, agent: null, reason: "reply file name is not replies.jsonl or replies-<agent>.jsonl" };
    return { ok: true, agent: m[1] || null, reason: null };
  }

  // Parses one line. Never throws: a helper that fails loud by exiting on one
  // agent's typo takes the reviewer's session with it, which is a worse failure
  // than the one it reports. A bad line is skipped, a reply.rejected event is
  // appended naming the file, the line number and the reason, and a dismissible
  // chip goes on the rail.
  //
  // @param line the raw line, without its newline
  // @param options {filenameAgent} the agent from the filename, if any
  function parseReplyLine(line, options) {
    var opts = options || {};
    var parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      return { ok: false, code: "REPLY_LINE_MALFORMED", reason: "not JSON: " + err.message };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, code: "REPLY_LINE_MALFORMED", reason: "a reply line must be a JSON object" };
    }
    var status = parsed[REPLY_FIELD.STATUS];
    if (REPLY_STATUSES.indexOf(status) === -1) {
      return {
        ok: false,
        code: "REPLY_LINE_MALFORMED",
        reason: "status must be one of " + REPLY_STATUSES.join(", ") + ", got " + JSON.stringify(status)
      };
    }
    var missing = [];
    REPLY_REQUIRED[status].forEach(function (field) {
      var v = parsed[field];
      if (v === null || v === undefined || v === "") missing.push(field);
    });
    if (typeof parsed[REPLY_FIELD.ITEM] !== "string") missing.push(REPLY_FIELD.ITEM);
    if (typeof parsed[REPLY_FIELD.REV] !== "number") missing.push(REPLY_FIELD.REV);
    if (missing.length) {
      return {
        ok: false,
        code: "REPLY_LINE_MALFORMED",
        reason: "status " + status + " needs " + REPLY_REQUIRED[status].join(", ") + "; missing or wrong type: " + missing.join(", ")
      };
    }

    // WHEN THE FILENAME'S AGENT AND THE LINE'S AGENT DISAGREE, THE LINE WINS,
    // because the line is what the reviewer sees on the card.
    var agent = typeof parsed[REPLY_FIELD.AGENT] === "string" && parsed[REPLY_FIELD.AGENT] ? parsed[REPLY_FIELD.AGENT] : opts.filenameAgent || null;

    var reply = {};
    reply[REPLY_FIELD.ITEM] = parsed[REPLY_FIELD.ITEM];
    reply[REPLY_FIELD.REV] = parsed[REPLY_FIELD.REV];
    reply[REPLY_FIELD.STATUS] = status;
    reply[REPLY_FIELD.AGENT] = agent;
    reply[REPLY_FIELD.REASON] = typeof parsed[REPLY_FIELD.REASON] === "string" ? parsed[REPLY_FIELD.REASON] : null;
    reply[REPLY_FIELD.TEXT] = typeof parsed[REPLY_FIELD.TEXT] === "string" ? parsed[REPLY_FIELD.TEXT] : null;
    reply[REPLY_FIELD.FILES] = Array.isArray(parsed[REPLY_FIELD.FILES]) ? parsed[REPLY_FIELD.FILES].slice() : [];
    // Optional, and lenient like every other optional field above: only the
    // literal boolean true sets it, and anything else ("true", 1, an object)
    // drops to false rather than costing the agent the whole line. Losing a
    // badge is a smaller failure than losing the answer, and question and
    // not_handled replies reach the reviewer without this field anyway.
    reply[REPLY_FIELD.NEEDS_SEE] = parsed[REPLY_FIELD.NEEDS_SEE] === true;
    return { ok: true, reply: reply, reason: null };
  }

  // How the helper notices appends: it polls each replies*.jsonl in the review
  // folder on this background safety interval, tracking a byte offset per
  // file. Active pages and CLI reads also trigger a fold directly, so this is
  // for inactive reviews and external file writes, not interaction latency.
  var REPLY_POLL = {
    INTERVAL_MS: 5000,
    // A file SHORTER than its recorded offset was truncated or rewritten rather
    // than appended to, so the offset resets to zero and the file is re-folded.
    // Safe, because folding is idempotent.
    RESET_ON_SHRINK: true,
    // A final line with no trailing newline is HELD until it completes, so a
    // torn write is never half-parsed.
    HOLD_TORN_FINAL_LINE: true
  };

  // The library's own poll of the helper for folded replies. The cursor is a
  // seq from the log, never a timestamp: two events in one millisecond are
  // ordinary, and a clock that steps backwards would silently skip work.
  var REPLY_CURSOR_FIELD = EVENT_FIELD.SEQ;

  function nextReadOffset(recordedOffset, fileSize) {
    if (typeof fileSize !== "number" || fileSize < 0) throw new Error("nextReadOffset: fileSize must be a number");
    var offset = typeof recordedOffset === "number" && recordedOffset > 0 ? recordedOffset : 0;
    if (fileSize < offset) return { offset: 0, refold: true };
    return { offset: offset, refold: false };
  }

  // Splits a freshly read chunk into whole lines plus the remainder to hold.
  function splitCompleteLines(chunk) {
    var text = String(chunk || "");
    var lines = text.split("\n");
    var remainder = lines.pop();
    return { lines: lines, remainder: remainder };
  }

  // ---------------------------------------------------------------------------
  // The script tag (D1)
  // ---------------------------------------------------------------------------
  //
  // Public API, because this is the one line a person or an agent types by hand.
  //
  // THE LINE CARRIES BOTH HALVES, and needs both.
  //
  // The PRIMARY src is the helper's own URL
  // (http://127.0.0.1:<port>/lahe-layer.js). One URL resolves from any folder,
  // any origin and any depth, which is what a bare relative path could not do:
  // a relative path resolves against wherever the page is SERVED from, so the
  // first time that is another folder the library 404s.
  //
  // The FALLBACK is a copy of the built library beside the page, named by a
  // RELATIVE path in data-lahe-fallback and injected by an inline onerror when
  // the primary src fails to load. It restores D1's offline half, which the
  // helper-URL-only form cut: a page opened while the helper is down loaded no
  // library at all, so there was no rail, no honest "helper is unreachable"
  // chip, no local capture and no export. That is R10 (there is always a way to
  // take the work elsewhere, with nothing running), and the claim that "a
  // review with no helper cannot record anything anyway" was simply false: the
  // library alone records into browser storage, says out loud that the helper
  // is unreachable, and posts everything it held when the helper comes back.
  //
  // The injected fallback script carries no data attributes on purpose. Its
  // document.currentScript has none, so boot falls through to SCRIPT_SELECTOR
  // and reads the config off the original tag, which is still in the document.
  //
  // The one place the fallback cannot run is under a strict CSP that refuses
  // inline event handlers. The primary src still loads there, which is the
  // ordinary dev-server case; `lahe add` prints that caveat with the snippet.

  var SCRIPT_ATTR = {
    REVIEW: "data-lahe-review",
    TOKEN: "data-lahe-token",
    HELPER: "data-lahe-helper",
    FALLBACK: "data-lahe-fallback"
  };

  // The inline onerror, kept to one statement-per-clause line so the attribute
  // stays readable in a page's source. Single quotes only: the attribute is
  // written inside double quotes. No ">" anywhere in it either, so add.js's
  // EXISTING_TAG (which scans a negated character class up to the first ">")
  // still matches, replaces and removes the whole line.
  var SCRIPT_FALLBACK_ONERROR =
    "var s=document.createElement('script');" +
    "s.src=this.getAttribute('" +
    SCRIPT_ATTR.FALLBACK +
    "');" +
    "document.head.appendChild(s)";

  // Read via document.currentScript, falling back to this selector for the
  // deferred and re-executed cases.
  var SCRIPT_SELECTOR = "script[" + SCRIPT_ATTR.REVIEW + "]";

  function scriptTag(options) {
    var o = options || {};
    if (!o.src) throw new Error("scriptTag: src is required (the path to the built library)");
    if (!isSafeId(o.review)) throw new Error("scriptTag: review must be a safe id");
    if (!o.token) throw new Error("scriptTag: token is required; absent configuration fails closed");
    // The fallback half is optional so a caller with nothing beside the page
    // (a test harness serving the bundle itself) writes the plain line.
    var fallback = o.fallback
      ? '        ' + SCRIPT_ATTR.FALLBACK + '="' + o.fallback + '"\n' +
        '        onerror="' + SCRIPT_FALLBACK_ONERROR + '"\n'
      : "";
    return (
      '<script src="' + o.src + '"\n' +
      '        ' + SCRIPT_ATTR.REVIEW + '="' + o.review + '"\n' +
      '        ' + SCRIPT_ATTR.TOKEN + '="' + o.token + '"\n' +
      '        ' + SCRIPT_ATTR.HELPER + '="' + (o.helper || DEFAULT_HELPER_ORIGIN) + '"\n' +
      fallback +
      '        defer><\/script>'
    );
  }

  // Shared process exits for the command dispatcher and status.
  //
  // The first four are the caller-error set every command shares: status uses
  // all four, and the others reach for BAD_USAGE rather than inventing a
  // different number for the same caller error.
  //
  // The last two exist because a HOST reads a monitor's exit code and decides
  // whether to relaunch it. "Your session was closed, stop relaunching" and
  // "another agent took this session over" are different instructions, and both
  // are different from "you typed the command wrong". Collapsing them into
  // BAD_USAGE is what let a closed session poll forever: nothing in the number
  // told the host to stop.
  var CLI_EXIT = {
    OK: 0,
    HELPER_UNREACHABLE: 2,
    UNKNOWN_REVIEW: 3,
    BAD_USAGE: 4,
    // The agent session is closed. Monitoring has ended; do not relaunch.
    SESSION_CLOSED: 5,
    // Another agent ran `lahe session takeover`. This monitor is fenced and the
    // work it was about to print belongs to the new owner.
    SESSION_TAKEN_OVER: 6
  };

  // ---------------------------------------------------------------------------
  // The wake feed
  // ---------------------------------------------------------------------------
  //
  // One append-only JSONL file per agent session, at
  // <state>/agent-sessions/<id>/wake.log. It exists so a host with no push
  // channel of its own can get one: `tail -n 0 -f wake.log` wakes on a line and
  // costs nothing while it is quiet.
  //
  // APPEND-ONLY, NEVER REWRITTEN AND NEVER ROTATED. `tail -f` follows an inode.
  // An atomic replace (which is how review.json is written) leaves a tail
  // watching a deleted file forever, silently. That is the bug this file was
  // designed around, so the file is only ever appended to.
  //
  // THE LINES ARE POINTERS, NOT PAYLOADS. A line says "there is work; run the
  // drain command". It never carries a note, a change, or page text. Intent
  // reaches an agent through review.json alone, which is where the trust classes
  // and the fencing live (D12). A wake line that carried reviewer text would be
  // a second, unfenced instruction channel.
  var WAKE = {
    FILE: "wake.log",
    KIND: {
      // A ready item landed for a review this session owns.
      WORK: "work",
      // Another agent ran `lahe session takeover` on this session.
      TAKEOVER: "takeover",
      // The session was closed. Nothing more will be appended.
      CLOSED: "closed"
    },
    FIELD: {
      AT: "at",
      KIND: "kind",
      REVIEW: "review",
      ITEM: "item",
      REV: "rev",
      DRAIN: "drain"
    }
  };

  /**
   * A path as a shell word: quoted only when it needs to be.
   *
   * The state directory is a path a person chose, so it can hold a space. An
   * unquoted one turns the printed command into two arguments and the agent
   * that copies it gets a usage error.
   */
  function shellWord(value) {
    var text = String(value);
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
    return "'" + text.replace(/'/g, "'\\''") + "'";
  }

  function stateDirFlag(stateDirPath) {
    if (typeof stateDirPath !== "string" || !stateDirPath) return "";
    return " --state-dir " + shellWord(stateDirPath);
  }

  /**
   * The one spelling of the drain command.
   *
   * It is printed by `lahe review`, by `lahe session takeover`, by the monitor's
   * own output, and it rides every wake line. Four spellings of one command is
   * how an agent ends up running a fifth.
   *
   * PASS THE STATE DIRECTORY WHEN IT IS NOT THE DEFAULT ONE. A command copied
   * out of a review that lives in a custom state directory resolves the DEFAULT
   * directory when it is run, so it reports no work while items sit unanswered
   * a few paths away. Callers decide with state_dir.flagFor, which returns null
   * when the default already resolves to the same place: printing the flag then
   * would be noise on every command every agent runs.
   *
   * @param {string} sessionId
   * @param {string|null} [stateDirPath] omit or pass null for the default
   */
  function drainCommand(sessionId, stateDirPath) {
    return "lahe status --session " + String(sessionId) + " --json --quiet" + stateDirFlag(stateDirPath);
  }

  /** The one spelling of the monitor command. Same state-directory rule. */
  function monitorCommand(sessionId, stateDirPath) {
    return "lahe monitor --session " + String(sessionId) + stateDirFlag(stateDirPath);
  }

  // ---------------------------------------------------------------------------
  // Monitor liveness: what the rail is allowed to claim about an agent
  // ---------------------------------------------------------------------------
  //
  // The rail used to show what the AGENT said about itself, which is how a chat
  // claiming "monitoring is active" sat over seven unanswered items. These
  // fields come from files the helper and the monitor write, never from a claim.
  var MONITOR = {
    // The heartbeat and the activity stamp are separate files on purpose:
    // session.json is rewritten by takeover, and a heartbeat sharing that file
    // would race it.
    HEARTBEAT_FILE: "monitor.json",
    ACTIVITY_FILE: "activity.json",
    // The monitor's default local poll interval, in seconds. The heartbeat is
    // written once per loop, so a heartbeat older than a few intervals means the
    // process is gone rather than slow.
    INTERVAL_SECONDS: 15,
    // How many intervals a heartbeat may be behind and still count as watching.
    FRESH_INTERVALS: 3,
    HEARTBEAT_FIELD: { PID: "pid", HANDOFF_REV: "handoff_rev", AT: "at" },
    ACTIVITY_FIELD: { AT: "at" }
  };

  // 45 seconds: three of the monitor's 15-second loops.
  MONITOR.HEARTBEAT_FRESH_MS = MONITOR.INTERVAL_SECONDS * MONITOR.FRESH_INTERVALS * 1000;
  // Three minutes. An agent mid-batch is editing files and rebuilding, not
  // running lahe commands, so the working window is much wider than the
  // heartbeat window.
  MONITOR.ACTIVITY_FRESH_MS = 180000;

  // ---------------------------------------------------------------------------
  // What the rail is allowed to say about an agent
  // ---------------------------------------------------------------------------
  //
  // SILENCE ONLY MATTERS WHEN SOMETHING IS WAITING. That is the whole rule, and
  // getting it wrong in either direction is what this section is for.
  //
  // A review with every item answered and an agent sitting quietly on it is the
  // NORMAL, HEALTHY, MOST COMMON state of a review. The reviewer opens one
  // document, works it, and leaves three others answered and idle for a day. A
  // rail that says anything at all about the agent there is crying wolf on
  // nearly every session they have open, and a rail that cries wolf is a rail
  // nobody reads by the third comment. So: nothing unanswered, nothing said.
  // Not "watching", not "idle", not "ok".
  //
  // The states below therefore only exist while an item is waiting, and what
  // they report is HOW LONG IT HAS BEEN WAITING. That number is always
  // knowable, it is about the reviewer's own work, and nothing can fake it.
  //
  // The old states (watching / working / unattended) described our plumbing
  // instead: they told a reviewer whether a monitor process had checked in,
  // which is not something they can act on and not something they asked. A
  // reviewer was told "monitoring is active" in a chat while seven items sat
  // unanswered, and the rail's own answer to that was another sentence about
  // monitors.
  var AGENT_LIVENESS = {
    STATE: {
      // Items are waiting, and the agent has run a lahe command or landed a
      // reply in the last few minutes. It is mid-task, which is not alarming
      // however long the item has been in the queue behind it.
      WORKING: "working",
      // Items are waiting and nothing has come back for a while.
      WAITING: "waiting",
      // Items are waiting, nothing has come back, and the machine can see that
      // nothing is listening: no process holds this session's wake feed open, no
      // live monitor, no lahe command in minutes. A different next move for the
      // reviewer, so a different state.
      NO_AGENT: "no_agent",
      // NOTHING IS WAITING. Says nothing at all, and this is the state a healthy
      // review spends most of its life in.
      NONE: "none"
    },
    FIELD: {
      STATE: "state",
      UNANSWERED: "unanswered",
      OLDEST_UNANSWERED_AT: "oldest_unanswered_at",
      // When the newest reply on this review landed, or null if none ever has.
      // It is evidence of an agent doing something recently, and it is what
      // `lahe session list` shows a human. It is never on the reviewer's line by
      // itself: an old reply on a fully answered review is not news.
      LAST_REPLY_AT: "last_reply_at",
      // true, false, or NULL FOR CANNOT TELL. Null is a real answer and it is
      // the answer on any host where the machine cannot be asked. It never
      // produces a claim in either direction; the line falls back to the wait.
      LISTENING: "listening",
      MONITOR_AT: "monitor_at",
      ACTIVITY_AT: "activity_at"
    },
    // THE WORDS, SPELLED ONCE, HERE. They used to be hand-copied into the layer,
    // which is two spellings of one wire value: rename a state and the rail
    // silently stopped recognising it, which looks exactly like a healthy rail
    // with nothing to say. `{age}` is how long the oldest unanswered item has
    // waited, filled in by whoever draws the line off its own clock, so a helper
    // repeating an unchanged payload cannot freeze a number that is growing.
    //
    // They are in a reviewer's words, not ours. No monitors, no heartbeats, no
    // wake feeds: none of that is the reviewer's problem, and naming it in front
    // of them asks them to care about our plumbing.
    //
    // `none` is deliberately absent: a state with no words draws nothing.
    TEXT: {
      working: "agent is working, {age}",
      waiting: "nothing back yet, {age}",
      no_agent: "nobody has picked this up, {age}"
    },
    // THE QUIET INDICATOR, which is what the line wears the rest of the time.
    //
    // It is a convenience rather than an alarm, and it exists because there are
    // two moments a reviewer actually looks: at the start ("will my comments
    // reach the agent, did this set up correctly?") and after a break ("did
    // anything die while I was away?"). Both are the same question, is the chain
    // intact, and both deserve a glanceable answer rather than a blank space.
    //
    // Two words, no punctuation, no verb: it must never look like it wants
    // reading. `null` when the machine cannot be asked, because a shrug is not a
    // status and inventing either answer would be worse than silence.
    CONNECTION: {
      connected: "agent listening",
      absent: "no agent listening"
    },
    // THE HOVER TEXT, assembled from these in order by whoever draws the line.
    //
    // This is where everything the tool actually knows about the connection
    // goes: whether the helper is answering, whether an agent has this review
    // open, when it last replied, and where the work is being kept. The line
    // itself stays short; a reviewer who is curious, or worried, hovers.
    //
    // Still no monitors, no heartbeats and no wake feeds. "Has this review open"
    // is what the machine can actually see (a process holding this session's
    // feed open) said in words that mean something to the person reading them.
    DETAIL: {
      helper_up: "The helper is answering this page, so comments and edits reach it as you make them.",
      helper_down: "The helper is not answering right now, so your work is being kept in this browser until it is.",
      agent_connected: "An agent has this review open.",
      agent_absent: "No agent has this review open.",
      agent_unknown: "Whether an agent has this review open cannot be checked on this computer.",
      replied: "The agent last replied {reply} ago.",
      never_replied: "The agent has not replied on this review yet.",
      waiting: "Your oldest unanswered item has been waiting {age}.",
      stored: "Your comments and edits are stored in this browser and in the helper's log on disk.",
      save: "You can get your own copy any time: use Copy review or Export review to file in the menu."
    },
    // WHEN THE LINE STARTS SPEAKING, counted from the moment the reviewer
    // submitted, not from anything about a process.
    //
    // Thirty seconds, because that is where a person who has just typed
    // something starts wondering whether it went anywhere. Not minutes: they are
    // sitting there. Not instant either, because an agent that has had a comment
    // for five seconds is reading it and a stopwatch started that fast is noise
    // on every single comment.
    //
    // THE CLOCK STARTS ON SUBMITTED WORK ONLY. A draft the reviewer is still
    // typing is waiting on nobody: drafts are invisible to agents everywhere
    // else in this design (`record.isUnansweredReady` requires READY), and they
    // are invisible to this clock for the same reason.
    QUIET_MS: 30000,
    // A lahe command or a landed reply this recent is an agent mid-task. It is
    // the difference the reviewer actually asked for: "waiting 10m and nothing
    // has happened" is worth knowing, "waiting 10m while the agent works" is
    // not alarming.
    ACTIVE_MS: 180000,
    // Past this, a wait with nothing happening is loud. Nothing the machine can
    // see about listeners buys quiet here: a file tail can be armed all
    // afternoon over an agent that stopped reading.
    STALE_MS: 600000,
    // How recently a lahe command must have run for the machine to count as
    // having somebody on it. Wider than ACTIVE_MS on purpose, and only ever used
    // to WITHHOLD the "no agent listening" wording: an exit-on-work monitor is
    // gone the moment work arrives, so an agent can be mid-edit with nothing
    // holding the feed open and no heartbeat.
    RECENT_COMMAND_MS: 600000
  };

  return {
    API_VERSION: API_VERSION,
    SERVICE_CONTRACT: SERVICE_CONTRACT,
    BASE: BASE,
    DEFAULT_PORT: DEFAULT_PORT,
    DEFAULT_HOST: DEFAULT_HOST,
    DEFAULT_HELPER_ORIGIN: DEFAULT_HELPER_ORIGIN,
    ALLOWED_HOST_NAMES: ALLOWED_HOST_NAMES,
    LOOPBACK_ORIGIN_HOSTS: LOOPBACK_ORIGIN_HOSTS,
    ORIGIN_LIMIT: ORIGIN_LIMIT,
    isRegisterableOrigin: isRegisterableOrigin,

    HEADER: HEADER,
    CLIENT_LAYER: CLIENT_LAYER,
    CLIENT_CLI: CLIENT_CLI,
    CLIENTS: CLIENTS,
    JSON_CONTENT_TYPE: JSON_CONTENT_TYPE,
    AUTH: AUTH,
    SAFE_ID: SAFE_ID,
    isSafeId: isSafeId,

    ROUTES: ROUTES,
    route: route,
    requiredHeaders: requiredHeaders,

    CHECK: CHECK,
    CHECKS: CHECKS,
    checkNamed: checkNamed,
    checkRequest: checkRequest,
    hostAllowed: hostAllowed,

    STATUS_FOR_CODE: STATUS_FOR_CODE,
    statusFor: statusFor,
    errorBody: errorBody,

    EVENT: EVENT,
    EVENT_TYPES: EVENT_TYPES,
    EVENT_FIELD: EVENT_FIELD,
    IDEMPOTENCE_KEY: IDEMPOTENCE_KEY,
    newEvent: newEvent,
    encodeEventLine: encodeEventLine,
    parseEventLine: parseEventLine,

    FLUSH: FLUSH,
    byteLength: byteLength,
    fitsKeepalive: fitsKeepalive,

    REPLY_FIELD: REPLY_FIELD,
    REPLY_STATUS: REPLY_STATUS,
    REPLY_STATUSES: REPLY_STATUSES,
    REPLY_REQUIRED: REPLY_REQUIRED,
    REPLY_FILE: REPLY_FILE,
    agentFromFilename: agentFromFilename,
    parseReplyLine: parseReplyLine,
    REPLY_POLL: REPLY_POLL,
    REPLY_CURSOR_FIELD: REPLY_CURSOR_FIELD,
    nextReadOffset: nextReadOffset,
    splitCompleteLines: splitCompleteLines,

    SCRIPT_ATTR: SCRIPT_ATTR,
    SCRIPT_SELECTOR: SCRIPT_SELECTOR,
    SCRIPT_FALLBACK_ONERROR: SCRIPT_FALLBACK_ONERROR,
    scriptTag: scriptTag,

    CLI_EXIT: CLI_EXIT,

    WAKE: WAKE,
    stateDirFlag: stateDirFlag,
    drainCommand: drainCommand,
    monitorCommand: monitorCommand,

    MONITOR: MONITOR,
    AGENT_LIVENESS: AGENT_LIVENESS
  };
});
