// Verification: does the reviewer's wording actually appear in the file the
// agent said it changed?
//
// Owner: Task 3B. STUB: verify() is a real signature and a working no-op that
// returns NOT_VERIFIABLE with a reason saying it is not implemented. Its call
// site is already written in src/service/routes.js, so 3A writes the ack path
// against it and 3B's swap is one function body.
//
// The shape 3B must keep, from architecture D8:
//
//   THREE VERDICTS, NOT TWO: found, not_found, and not_verifiable.
//
// Normalizing whitespace does not make a rendered string match its template.
// "Welcome back, Sarah" and "Welcome back, <%= @client.first_name %>" do not
// match and no normalization makes them, so any region carrying interpolation,
// a loop, a helper, or a translation key is a permanent miss. A warning that
// fires on most items on a Rails app trains the reviewer to ignore all of them,
// which is worse than having no check.
//
// And: A MISS WARNS LOUDLY AND DOES NOT REOPEN THE ITEM. Auto-reopening turns a
// false positive into an infinite re-ship loop.
//
// A deletion gets the inverse check: the `before` text should be gone.
//
// Node-only.

"use strict";

var normalize = require("../shared/normalize.js");
var record = require("../shared/record.js");
var failures = require("../shared/failures.js");

var VERDICT = {
  FOUND: "found",
  NOT_FOUND: "not_found",
  NOT_VERIFIABLE: "not_verifiable"
};

// Signals that a region is built from a template and can never match literally.
// 3B extends this list; it is here so the list has one home from the start.
var TEMPLATE_SIGNALS = [
  { pattern: /<%=?[\s\S]*?%>/, why: "ERB interpolation" },
  { pattern: /\{\{[\s\S]*?\}\}/, why: "a moustache or Vue interpolation" },
  { pattern: /\$\{[\s\S]*?\}/, why: "a JavaScript template literal" },
  { pattern: /\{%[\s\S]*?%\}/, why: "a Liquid or Jinja tag" },
  { pattern: /\bt\(["'][\w.]+["']\)/, why: "a translation key" }
];

function looksTemplated(sourceText) {
  for (var i = 0; i < TEMPLATE_SIGNALS.length; i += 1) {
    if (TEMPLATE_SIGNALS[i].pattern.test(sourceText)) return TEMPLATE_SIGNALS[i].why;
  }
  return null;
}

function result(verdict, reason, detail) {
  var code = null;
  if (verdict === VERDICT.NOT_FOUND) code = "VERIFY_NOT_FOUND";
  if (verdict === VERDICT.NOT_VERIFIABLE) code = "VERIFY_NOT_VERIFIABLE";
  return {
    verdict: verdict,
    code: code,
    failure: code ? failures.failure(code, detail || null) : null,
    reason: reason || null,
    reopens_item: false, // never. Stated as a field so it cannot drift
    at: new Date().toISOString()
  };
}

/**
 * NO-OP STUB. Task 3B replaces the body.
 *
 * @param {Object} item the item the agent acked applied
 * @param {Array<string>} files absolute paths the ack named, already
 *        constrained to the review's project root by the caller
 * @param {Object} options {projectRoot, authoritative}
 * @returns {Object} {verdict, code, failure, reason, reopens_item, at}
 */
function verify(item, files, options) {
  void item;
  void files;
  void options;
  return result(
    VERDICT.NOT_VERIFIABLE,
    "verification is not implemented yet: Task 3B owns src/service/verification.js"
  );
}

module.exports = {
  VERDICT: VERDICT,
  TEMPLATE_SIGNALS: TEMPLATE_SIGNALS,
  looksTemplated: looksTemplated,
  verify: verify,
  normalize: normalize,
  record: record,
  isStub: true
};
