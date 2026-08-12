// The wire: every byte that leaves this repo.
//
// Owner: 0A-wire. Imported by: the helper's router and per-request check block
// (1A), the sync client and reply poll loop (1B), the projection and reply
// folder (3A), the add command (3B), and the wait command (3A).
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
//     default port, and `lahe wait`'s invocation, watermark, output and exit
//     codes.
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
      response: "{ok, version, api, started_at}"
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
      why: "the library's reply poll loop. The cursor is a seq, never a timestamp and never an offset",
      request: "?review=<id>&since=<seq>",
      response: "{events: [event...], seq}"
    },
    {
      name: "window.claim",
      method: "POST",
      path: BASE + "/window",
      auth: AUTH.REVIEW_TOKEN,
      mutating: true,
      why: "D5's second-window refusal for windows that cannot see each other's storage, plus the takeover",
      request: "{review, window_id, takeover}",
      response: "{granted, holder, since, heartbeat_seconds}"
    },
    {
      name: "review.end",
      method: "POST",
      path: BASE + "/end",
      auth: AUTH.REVIEW_TOKEN,
      mutating: true,
      why: "the reviewer chooses End review on the rail; the review is archived, never truncated",
      request: "{review}",
      response: "{ended_at, outstanding_kept}"
    },
    {
      name: "wait",
      method: "GET",
      path: BASE + "/wait",
      auth: AUTH.REVIEW_TOKEN,
      mutating: false,
      why: "what `lahe wait` calls. Blocks until something new passes the watermark, or times out",
      request: "?review=<id>&since=<seq>&timeout=<seconds>",
      response: "{events: [event...], seq}"
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
    if (!registered.token || typeof presented !== "string" || presented !== registered.token) {
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
  //    "agent":"<name>","reason":"<why not>","text":"<the question>","files":["<path>"]}

  var REPLY_FIELD = {
    ITEM: "item",
    REV: "rev",
    STATUS: "status",
    AGENT: "agent",
    REASON: "reason",
    TEXT: "text",
    FILES: "files"
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
    return { ok: true, reply: reply, reason: null };
  }

  // How the helper notices appends: it polls each replies*.jsonl in the review
  // folder on this interval, tracking a byte offset per file.
  var REPLY_POLL = {
    INTERVAL_MS: 250,
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

  var SCRIPT_ATTR = {
    REVIEW: "data-lahe-review",
    TOKEN: "data-lahe-token",
    HELPER: "data-lahe-helper"
  };

  // Read via document.currentScript, falling back to this selector for the
  // deferred and re-executed cases.
  var SCRIPT_SELECTOR = "script[" + SCRIPT_ATTR.REVIEW + "]";

  function scriptTag(options) {
    var o = options || {};
    if (!o.src) throw new Error("scriptTag: src is required (the path to the built library)");
    if (!isSafeId(o.review)) throw new Error("scriptTag: review must be a safe id");
    if (!o.token) throw new Error("scriptTag: token is required; absent configuration fails closed");
    return (
      '<script src="' + o.src + '"\n' +
      '        ' + SCRIPT_ATTR.REVIEW + '="' + o.review + '"\n' +
      '        ' + SCRIPT_ATTR.TOKEN + '="' + o.token + '"\n' +
      '        ' + SCRIPT_ATTR.HELPER + '="' + (o.helper || DEFAULT_HELPER_ORIGIN) + '"\n' +
      '        defer><\/script>'
    );
  }

  // ---------------------------------------------------------------------------
  // lahe wait
  // ---------------------------------------------------------------------------
  //
  // A half-specified convenience is the thing most likely to get half-built, so
  // it is specified whole: the watermark, what counts as new, the output, the
  // five exit codes, the timeout, and the fact that it consumes nothing.

  var WAIT = {
    USAGE: "lahe wait --review <id> [--since <cursor>] [--timeout <seconds>]",
    DEFAULT_TIMEOUT_SECONDS: 300,
    // --since is a seq from the log. wait returns events with a HIGHER seq and
    // prints the highest seq it printed, which is the caller's next cursor.
    CURSOR_FIELD: EVENT_FIELD.SEQ,
    // IT STORES NOTHING AND CONSUMES NOTHING. It is a read, never an
    // acknowledgment. A killed wait, a repeated wait, and two agents waiting at
    // once are all harmless.
    CONSUMES_NOTHING: true,
    // Two waiters on one review both wake. There is no queue and no claim.
    CONCURRENT_WAITERS_BOTH_WAKE: true,
    // New ready items print as JSON LINES, one line per item, each carrying the
    // same fields the item carries in review.json, with page text in the same
    // data-named fields.
    OUTPUT: "json-lines",
    EXIT: {
      NEW_WORK: 0,
      TIMEOUT: 1,
      HELPER_UNREACHABLE: 2,
      UNKNOWN_REVIEW: 3,
      BAD_USAGE: 4
    }
  };

  // What counts as new: an item newly ready, an item reworded to a higher
  // revision, an item flagged as lost, and a reply from another agent. DRAFTS
  // NEVER COUNT.
  var WAIT_EVENT_TYPES = [EVENT.ITEM_READY, EVENT.ITEM_CONTENT, EVENT.REPLY_FOLDED];

  function countsAsNew(event) {
    if (!event || typeof event !== "object") return false;
    var type = event[EVENT_FIELD.EVENT];
    if (type === EVENT.ITEM_READY || type === EVENT.REPLY_FOLDED) return true;
    // A content event counts only when it moved a ready item to a higher
    // revision, or flagged it lost. A draft keystroke is neither.
    if (type === EVENT.ITEM_CONTENT) return event.draft !== true && (event.reworded === true || event.lost === true);
    return false;
  }

  return {
    API_VERSION: API_VERSION,
    BASE: BASE,
    DEFAULT_PORT: DEFAULT_PORT,
    DEFAULT_HOST: DEFAULT_HOST,
    DEFAULT_HELPER_ORIGIN: DEFAULT_HELPER_ORIGIN,
    ALLOWED_HOST_NAMES: ALLOWED_HOST_NAMES,

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
    scriptTag: scriptTag,

    WAIT: WAIT,
    WAIT_EVENT_TYPES: WAIT_EVENT_TYPES,
    countsAsNew: countsAsNew
  };
});
