// The per-request check block, and the named refusal in the helper log.
//
// Owner: 1A. Architecture D11: loopback is not a boundary, so the page proves
// itself on EVERY request, with no exceptions. Any page the browser has open can
// talk to a local port, and a preflight is a convention only browsers follow, so
// none of it is checked in the browser.
//
// THE CHECKS ARE NOT IMPLEMENTED HERE. They are one pure function in
// src/shared/protocol.js (checkRequest), which is where the wire is pinned. This
// module does the two things the helper adds on top:
//
//   1. It calls that function for every request, on every route, with no branch
//      that skips it. A helper that implements five checks and forgets the sixth
//      is the failure this arrangement exists to make impossible: there is one
//      call site and it either ran or it did not.
//   2. It appends a line to the helper log NAMING THE CHECK THAT FAILED. That
//      line is the whole reason AC8 (outside cannot get in) is judgeable by
//      someone reading a file rather than being asked to trust the code.
//
// Absent configuration fails closed: a review nobody registered has no token to
// check against, so it is refused rather than defaulted.
//
// Node-only.

"use strict";

var crypto = require("node:crypto");

var protocol = require("../shared/protocol.js");

/**
 * The check block for one helper.
 *
 * @param {{log: object, reviews: object}} options
 *   `log` is log.js's event log (for helperLog), `reviews` is reviews.js's
 *   registry (for the token and origin configuration).
 */
function createAuth(options) {
  var opts = options || {};
  if (!opts.log) throw new Error("createAuth: log is required");
  if (!opts.reviews) throw new Error("createAuth: reviews is required");
  var log = opts.log;
  var reviews = opts.reviews;

  /**
   * Check one request.
   *
   * @param {{routeName: string, headers: object, review: string|null,
   *          method: string, requestId: string}} request
   * @returns {{ok: true, review: string|null, origin: string|null}} or
   *          {{ok: false, check: string, code: string, log: string, status: number}}
   */
  function check(request) {
    var req = request || {};

    // The Library's routes run their own check block (the D11 amendment): a
    // different credential, and the per-route table in protocol.CATALOG_ROUTES.
    // Still this one call site, so no route reaches a handler unchecked.
    if (protocol.route(req.routeName).auth === protocol.AUTH.CATALOG_TOKEN) {
      var catalogResult = checkCatalogRequest(req, opts.catalog || null);
      if (catalogResult.ok) return catalogResult;
      return refused(req, catalogResult);
    }

    // A review this helper does not hold may still be one `add` minted on disk a
    // moment ago, after the helper started. Look for it once before the check
    // block refuses it, so a second review does not cost a restart of a helper
    // that may be holding someone else's live review. The look is free when the
    // review is already held, and reviews.js bounds it for every other case.
    // Nothing is widened by it: the token and origin checks below are unchanged
    // and still decide the request.
    reviews.ensureKnown(req.review);

    var result = protocol.checkRequest(
      { routeName: req.routeName, headers: req.headers, review: req.review },
      reviews.config()
    );

    if (result.ok) return result;
    return refused(req, result);
  }

  function refused(req, result) {
    // THE NAMED REFUSAL. protocol.checkRequest builds the sentence, because the
    // check names belong to the wire and not to the helper; this adds who asked.
    //
    // The request-supplied values (path, method, request id, origin) are
    // attacker-controlled, so each is JSON.stringify'd and capped before it joins
    // the line (finding 8). helperLog neutralizes control characters as a second
    // layer, including in result.log, which carries the review id built upstream.
    log.helperLog(
      result.log +
        " [request " +
        field(req.requestId) +
        ", " +
        field(String(req.method || "-") + " " + String(req.path || req.routeName || "-")) +
        ", origin " +
        field(headerOrNone(req.headers, protocol.HEADER.ORIGIN)) +
        "]"
    );

    return {
      ok: false,
      check: result.check,
      code: result.code,
      log: result.log,
      status: protocol.statusFor(result.code)
    };
  }

  function headerOrNone(headers, name) {
    if (!headers) return "none";
    var value = headers[name];
    if (value === undefined || value === null || value === "") return "none";
    return value;
  }

  // One attacker-controlled value, delimited and capped for the helper log
  // (finding 8). JSON.stringify quotes and escapes it; the cap keeps a runaway
  // value from flooding the line even before helperLog's own cap.
  var FIELD_MAX = 200;
  function field(value) {
    return JSON.stringify(String(value === undefined || value === null ? "-" : value).slice(0, FIELD_MAX));
  }

  /** Anything the helper refuses for a reason that is not a wire check. */
  function refuse(request, code, detail) {
    var req = request || {};
    log.helperLog(
      "refused " +
        field(req.routeName || req.path || "-") +
        ": " +
        code +
        (detail ? " (" + field(detail) + ")" : "") +
        " [request " +
        field(req.requestId) +
        "]"
    );
    return { ok: false, check: null, code: code, status: protocol.statusFor(code), log: null };
  }

  return { check: check, refuse: refuse };
}

// ---------------------------------------------------------------------------
// The Library token (the D11 amendment)
// ---------------------------------------------------------------------------

/**
 * The helper's Library state: the token, the port it answers on, and the last
 * authenticated catalog.list.
 *
 * The token is minted here, in memory, once per helper start. It is never
 * written to disk: the served page is the only place it exists, so a helper
 * restart refuses the old page's token and the page asks for a reload.
 *
 * `port` is set by serve() once the listener is bound; until then every catalog
 * request fails the Host check, which is the closed default.
 */
function createCatalogState() {
  var seenAt = null;
  return {
    token: crypto.randomBytes(32).toString("hex"),
    port: null,
    /** Task 2.1's list handler calls this on an authenticated list. */
    markSeen: function (now) {
      seenAt = (now instanceof Date ? now : new Date(now)).toISOString();
    },
    seenAt: function () {
      return seenAt;
    }
  };
}

// Node lowercases incoming header names; a test or caller passing an object
// with other casing still gets the same answer.
function headerOf(headers, name) {
  if (!headers) return null;
  var lower = String(name).toLowerCase();
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === lower) return headers[keys[i]];
  }
  return null;
}

// Constant-time comparison. Lengths differ only for a wrong token, and the
// token is a fixed-length mint, so length carries nothing.
function sameToken(presented, expected) {
  var a = Buffer.from(presented, "utf8");
  var b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function refusal(name, detail, routeName) {
  var c = protocol.CHECKS.filter(function (entry) {
    return entry.name === name;
  })[0];
  return {
    ok: false,
    check: name,
    code: c.code,
    log: "refused " + routeName + ": check " + name + " failed" + (detail ? " (" + detail + ")" : "")
  };
}

/**
 * The Library's check block, one pure function, per the route's `checks`.
 *
 * Order: Host, Sec-Fetch-Site, client header, content type, token, Origin.
 *
 * - Host is exactly 127.0.0.1:<port> or localhost:<port> at the helper's actual
 *   port, on every catalog route. The page carries the token, so a DNS-rebound
 *   name must not be able to load it.
 * - Sec-Fetch-Site is set by the browser, never by a script. The API routes take
 *   exactly same-origin: a document under review on another loopback port sends
 *   same-site and is refused. A missing value is refused.
 * - The client header must be CLIENT_CATALOG, which the per-review routes do not
 *   accept, and the token is compared in full.
 * - Origin on a POST must equal "http://" + the request's own Host.
 *
 * The token never enters a log line or a detail.
 *
 * @param {{routeName: string, headers: object}} request
 * @param {{token: string, port: number}|null} catalog
 */
function checkCatalogRequest(request, catalog) {
  var req = request || {};
  var r = protocol.route(req.routeName);
  var checks = r.checks || {};
  var headers = req.headers || {};

  var host = headerOf(headers, protocol.HEADER.HOST);
  var hostLower = typeof host === "string" ? host.toLowerCase() : "";
  var port = catalog && typeof catalog.port === "number" ? catalog.port : null;
  if (port === null || (hostLower !== "127.0.0.1:" + port && hostLower !== "localhost:" + port)) {
    return refusal(protocol.CHECK.HOST, String(host), r.name);
  }

  var site = headerOf(headers, protocol.HEADER.SEC_FETCH_SITE);
  if (typeof site !== "string" || (checks.sec_fetch_site || []).indexOf(site) === -1) {
    return refusal(protocol.CHECK.SEC_FETCH_SITE, site ? String(site) : "none", r.name);
  }

  if (checks.token) {
    if (headerOf(headers, protocol.HEADER.CLIENT) !== protocol.CLIENT_CATALOG) {
      return refusal(protocol.CHECK.CUSTOM_HEADER, null, r.name);
    }
  }
  if (checks.json_body) {
    var ct = String(headerOf(headers, protocol.HEADER.CONTENT_TYPE) || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (ct !== protocol.JSON_CONTENT_TYPE) return refusal(protocol.CHECK.CONTENT_TYPE, ct || "none", r.name);
  }
  if (checks.token) {
    var presented = headerOf(headers, protocol.HEADER.TOKEN);
    if (
      !catalog ||
      typeof catalog.token !== "string" ||
      !catalog.token ||
      typeof presented !== "string" ||
      !sameToken(presented, catalog.token)
    ) {
      return refusal(protocol.CHECK.TOKEN, null, r.name);
    }
  }
  if (checks.origin === "exact") {
    var origin = headerOf(headers, protocol.HEADER.ORIGIN);
    if (typeof origin !== "string" || origin !== "http://" + host) {
      return refusal(protocol.CHECK.ORIGIN, origin ? String(origin) : "none", r.name);
    }
  }

  // No origin is handed back: nothing on a catalog route echoes one, so no
  // response can grow a CORS header from it.
  return { ok: true, review: null, origin: null };
}

module.exports = {
  createAuth: createAuth,
  createCatalogState: createCatalogState,
  checkCatalogRequest: checkCatalogRequest
};
