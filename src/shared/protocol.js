// The wire protocol: routes, methods, required headers, error shapes, and the
// session-minting exchange.
//
// Owner: Task 0a (shared kernel). Imported by: the service's router (1A), the
// sync client (1B-ii), the CLI (1D).
//
// Architecture D9 sets the three controls this encodes: a per-run token, a
// server-side origin allowlist, and a required JSON content type plus a custom
// header on every mutating route so a CORS-simple request can never reach a
// handler.
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
  // Headers
  // ---------------------------------------------------------------------------

  var HEADER = {
    // The custom header. Its only job is to be non-simple, so every
    // cross-origin mutating request is forced through a preflight the origin
    // allowlist answers. Value is "layer" or "cli".
    CLIENT: "x-lahe-client",
    // The short-lived session token an attached layer holds (D9). Never the run
    // token: a token in a development layout is readable by anything in the
    // app's origin.
    SESSION: "x-lahe-session",
    // The per-run token, from the owner-only token file. Shell-side callers
    // only: the CLI and anything else the reviewer runs themselves.
    AUTHORIZATION: "authorization",
    // Echoed back on every response so a failure in the rail can be matched to
    // a line in the service log.
    REQUEST_ID: "x-lahe-request-id",
    CONTENT_TYPE: "content-type",
    ORIGIN: "origin"
  };

  var CLIENT_LAYER = "layer";
  var CLIENT_CLI = "cli";

  var JSON_CONTENT_TYPE = "application/json";

  // In served mode the credential is an HttpOnly, SameSite=Strict cookie scoped
  // to that target's served path, so a script inside a served document can
  // never read it and never forge an ack for a different target (D9).
  var SERVED_COOKIE_NAME = "lahe_served";
  function servedCookiePath(targetKey) {
    return "/served/" + targetKey;
  }

  // ---------------------------------------------------------------------------
  // Auth modes
  // ---------------------------------------------------------------------------

  var AUTH = {
    // No credential. Origin is still checked where the route says so.
    NONE: "none",
    // Origin must be on the allowlist. Used by the session mint, which is the
    // one exchange that happens before any credential exists.
    ORIGIN_ONLY: "origin_only",
    // A session token in the session header, or the served-mode cookie.
    SESSION: "session",
    // The per-run token in an Authorization: Bearer header. Shell-side only.
    RUN_TOKEN: "run_token",
    // Either credential is acceptable.
    SESSION_OR_RUN_TOKEN: "session_or_run_token"
  };

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------
  //
  // mutating: true means the route requires the JSON content type AND the
  // client header, and is subject to the origin allowlist including on its
  // preflight.

  var ROUTES = [
    {
      name: "health",
      method: "GET",
      path: BASE + "/health",
      auth: AUTH.NONE,
      mutating: false,
      why: "liveness and version only. Carries no review data, so it needs no credential",
      response: "{ok, version, api, started_at}"
    },
    {
      name: "session.mint",
      method: "POST",
      path: BASE + "/session",
      auth: AUTH.ORIGIN_ONLY,
      mutating: true,
      why: "an attached layer exchanges its origin for a short-lived session token",
      request: "{target, layer_version, title}",
      response: "{session, expires_at, review, review_root_label, target_key, source_hint, heartbeat_seconds}"
    },
    {
      name: "review.read",
      method: "GET",
      path: BASE + "/review",
      auth: AUTH.SESSION_OR_RUN_TOKEN,
      mutating: false,
      why: "the projection the layer reconciles against on load and on every reconnect",
      response: "{review, items, targets, seq}"
    },
    {
      name: "items.upsert",
      method: "POST",
      path: BASE + "/items",
      auth: AUTH.SESSION,
      mutating: true,
      why: "the sync client ships full item snapshots, idempotent by event id",
      request: "{events: [event...]}",
      response: "{accepted: [event_id...], seq}"
    },
    {
      name: "review.send",
      method: "POST",
      path: BASE + "/send",
      auth: AUTH.SESSION,
      mutating: true,
      why: "marks everything outstanding delivered and writes both review files",
      request: "{item_revs: [{id, rev}...]}",
      response: "{send_id, delivered: [{id, rev}...], files: {md, json}}"
    },
    {
      name: "review.ack",
      method: "POST",
      path: BASE + "/ack",
      auth: AUTH.RUN_TOKEN,
      mutating: true,
      why: "per-item applied or declined, from the agent's shell. Never from a page",
      request: "{review, items: [{id, rev, outcome, reason, files, reply}...]}",
      response: "{applied: [...], declined: [...], refused: [{id, code}...], verification: [...]}"
    },
    {
      name: "review.next",
      method: "GET",
      path: BASE + "/next",
      auth: AUTH.RUN_TOKEN,
      mutating: false,
      why: "the outstanding batch for an agent. The CLI's next command wraps it",
      response: "see cli_contract.js NEXT_PAYLOADS"
    },
    {
      name: "review.end",
      method: "POST",
      path: BASE + "/end",
      auth: AUTH.SESSION_OR_RUN_TOKEN,
      mutating: true,
      why: "R55: the reviewer ends the review, releasing any waiting agent",
      request: "{review}",
      response: "{ended_at, outstanding_kept}"
    },
    {
      name: "review.stream",
      method: "GET",
      path: BASE + "/stream",
      auth: AUTH.SESSION,
      mutating: false,
      why: "server-sent lifecycle updates so the burn-down moves without a reload (R56)",
      response: "text/event-stream of lifecycle events"
    },
    {
      name: "served.document",
      method: "GET",
      path: "/served/:target_key/*",
      auth: AUTH.SESSION,
      mutating: false,
      why: "served mode: a local HTML file with the layer injected, plus its sibling assets",
      response: "the document, or a sibling asset resolved against its directory"
    }
  ];

  function route(name) {
    for (var i = 0; i < ROUTES.length; i += 1) {
      if (ROUTES[i].name === name) return ROUTES[i];
    }
    throw new Error("unknown route: " + String(name) + ". Routes are listed in src/shared/protocol.js");
  }

  // ---------------------------------------------------------------------------
  // Error shape
  // ---------------------------------------------------------------------------
  //
  // One shape for every non-2xx response, so the sync client has one parser and
  // the rail can put any of them in the failures list without a special case.
  //
  //   { "error": { "code", "message", "remedy", "detail", "request_id" } }

  var STATUS_FOR_CODE = {
    PROTO_BAD_REQUEST: 400,
    PROTO_UNAUTHORIZED: 401,
    PROTO_FORBIDDEN_ORIGIN: 403,
    PROTO_TARGET_MISMATCH: 403,
    PROTO_UNKNOWN_ITEM: 404,
    PROTO_NOT_DELIVERED: 409,
    PROTO_STALE_REV: 409,
    PROTO_SECOND_INSTANCE: 409,
    PROTO_UNSUPPORTED_MEDIA_TYPE: 415,
    PROTO_MISSING_CUSTOM_HEADER: 400,
    VERIFY_PATH_OUTSIDE_ROOT: 400,
    CLI_PATH_REFUSED: 400
  };

  function statusFor(code) {
    return Object.prototype.hasOwnProperty.call(STATUS_FOR_CODE, code) ? STATUS_FOR_CODE[code] : 500;
  }

  function errorBody(code, detail, requestId) {
    var f = failures.failure(code, detail);
    return {
      error: {
        code: f.code,
        message: f.message,
        remedy: f.remedy,
        detail: f.detail,
        request_id: requestId || null
      }
    };
  }

  // ---------------------------------------------------------------------------
  // The session exchange (D9)
  // ---------------------------------------------------------------------------
  //
  // What it is bound to, and why each binding is there:
  //
  //   origin      Taken from the request's Origin header, NEVER from the body.
  //               A page cannot forge its Origin, which is what makes the
  //               allowlist the real control in attached mode.
  //   review root Server-side configuration recorded when the reviewer attached
  //               the project (D11). Never accepted from a request body.
  //   target      The canonical target the layer reported. A session may only
  //               touch items for its own target, so a compromised page in one
  //               served document cannot forge an ack for another.
  //
  // The reviewer registering an origin at their terminal is the authorization.
  // That act is the one thing a hostile page cannot perform.

  var SESSION = {
    TTL_SECONDS: 8 * 60 * 60,
    HEARTBEAT_SECONDS: 60,
    BOUND_TO: ["origin", "review_root", "target"],
    // What the layer does on a 401 in the middle of a session. Written here
    // because "retry" is the obvious wrong answer: a token the service will
    // never accept turns into an infinite retry loop that looks like the
    // service being slow.
    ON_401: {
      remint_attempts: 1,
      then: "record SYNC_UNAUTHORIZED in the persistent failures list and stop",
      keeps_working: "the layer keeps writing every change to browser storage, and Copy and Export still produce everything",
      retry_trigger: "a reviewer-initiated action only: pressing Send, or the retry control on the failures-list entry"
    }
  };

  // Header requirements as data, so the service's checks and the client's
  // request builder read from the same list.
  function requiredHeaders(routeName) {
    var r = route(routeName);
    var out = [];
    if (r.mutating) {
      out.push({ header: HEADER.CONTENT_TYPE, value: JSON_CONTENT_TYPE, why: "forces a preflight and refuses a CORS-simple write" });
      out.push({ header: HEADER.CLIENT, value: "layer or cli", why: "a custom header cannot ride on a simple request" });
    }
    if (r.auth === AUTH.SESSION || r.auth === AUTH.SESSION_OR_RUN_TOKEN) {
      out.push({ header: HEADER.SESSION, value: "<session token>", why: "attached-mode credential, or the served-mode cookie instead" });
    }
    if (r.auth === AUTH.RUN_TOKEN || r.auth === AUTH.SESSION_OR_RUN_TOKEN) {
      out.push({ header: HEADER.AUTHORIZATION, value: "Bearer <run token>", why: "shell-side credential, from the owner-only token file" });
    }
    return out;
  }

  return {
    API_VERSION: API_VERSION,
    BASE: BASE,
    HEADER: HEADER,
    CLIENT_LAYER: CLIENT_LAYER,
    CLIENT_CLI: CLIENT_CLI,
    JSON_CONTENT_TYPE: JSON_CONTENT_TYPE,
    SERVED_COOKIE_NAME: SERVED_COOKIE_NAME,
    servedCookiePath: servedCookiePath,
    AUTH: AUTH,
    ROUTES: ROUTES,
    route: route,
    STATUS_FOR_CODE: STATUS_FOR_CODE,
    statusFor: statusFor,
    errorBody: errorBody,
    SESSION: SESSION,
    requiredHeaders: requiredHeaders
  };
});
