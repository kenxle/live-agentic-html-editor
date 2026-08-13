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
    var result = protocol.checkRequest(
      { routeName: req.routeName, headers: req.headers, review: req.review },
      reviews.config()
    );

    if (result.ok) return result;

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

module.exports = { createAuth: createAuth };
