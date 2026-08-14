// The failure code enum.
//
// Owner: 0A-wire. Imported by: the sync client and the rail's failures list
// (1B), the anchor engine (1C), replay (2C), protection (2B), the helper's
// error shapes and per-request checks (1A), the reply folder (3A), and the CLI.
//
// One code list, because R9 (failures are loud and they persist) is only
// checkable if there is one vocabulary for what failed. Every code carries:
//
//   severity   blocking | warning | info
//   persistent true when it belongs in the rail's failures list until the
//              reviewer dismisses it, false when it is a passing message
//   surface    where it shows: "failures_list", "card", or "cli"
//   message    the reviewer-facing sentence, written once here so two builders
//              cannot write two wordings for the same failure
//   remedy     what to do about it, or null when there is nothing to do
//
// This table is the architecture's Failure modes section as code.
//
// REWORKED for the current architecture. Gone: the send codes, the
// acknowledgement codes, the session codes, and the verification codes, all of
// which belonged to the archived send model (there is no send button, no ack
// command, no session exchange, and verification is a stated v1 cut). Added:
// the lost anchor, the neither-matches collision, the second window refusal,
// the CSP refusal told apart from a helper that is down, the malformed reply
// line, and the helper being unreachable.
//
// A few old names survive as ALIASES, not as second definitions: code in files
// other tasks own still spells them, and a rename landing in four branches at
// once is a merge conflict for no gain. Each alias resolves to its canonical
// code, and the alias list is on the Phase 4B cleanup batch.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;

  var SEVERITY = { BLOCKING: "blocking", WARNING: "warning", INFO: "info" };
  var SURFACE = { FAILURES_LIST: "failures_list", CARD: "card", CLI: "cli" };

  function def(severity, persistent, surface, message, remedy) {
    return {
      severity: severity,
      persistent: persistent,
      surface: surface,
      message: message,
      remedy: remedy || null
    };
  }

  var CODES = {
    // --- the helper, and getting to it -------------------------------------
    HELPER_UNREACHABLE: def(
      SEVERITY.WARNING,
      true,
      SURFACE.FAILURES_LIST,
      "The local helper is not reachable. Your feedback is safe in this browser and goes to the helper when it comes back.",
      "Start the helper, or use Copy or Export to get everything out now."
    ),
    // Told apart from the helper being down ON PURPOSE. They look identical to
    // a fetch and they need opposite fixes: one is "start the helper", the
    // other is "this page's own policy refuses the connection".
    CSP_REFUSED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "This page's content security policy refused the connection to the local helper. This is not the helper being down.",
      "Add the helper's origin to connect-src in this app's development CSP."
    ),
    SYNC_UNAUTHORIZED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "The local helper refused this page's token.",
      "Run the add step again for this review, then reload the page."
    ),
    SYNC_ORIGIN_NOT_ALLOWED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "This page's origin is not registered with this review, so the helper refuses its events.",
      "Run the add step from this page's origin."
    ),

    // --- browser storage and windows ---------------------------------------
    STORAGE_QUOTA: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "Browser storage is full, so the last change could not be saved locally.",
      "Export what you have, then clear storage for this origin."
    ),
    STORAGE_UNAVAILABLE: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "Browser storage is unavailable on this page, so nothing can be saved locally.",
      "Serve the page over http rather than opening it from Finder."
    ),
    // D5: two windows sharing one draft bucket means the last keystroke wins
    // and the other window's work disappears without saying so. Refusal costs
    // the reviewer nothing, and the takeover is one button.
    SECOND_WINDOW_REFUSED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "Another window is already reviewing this page. This one is read-only so the two cannot overwrite each other.",
      "Use Review here instead to move the review to this window."
    ),

    // --- anchoring and replay ----------------------------------------------
    ANCHOR_NO_TEXT_MATCH: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "This edit could not be placed on this version of the page. Your text is kept exactly as you typed it.",
      null
    ),
    ANCHOR_AMBIGUOUS: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "More than one place on this page matches this edit, so nothing was written. Your text is kept.",
      null
    ),
    ANCHOR_STRUCTURE_ONLY: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "Only the page structure matched, not the text, so nothing was written. Your text is kept.",
      null
    ),
    // The lost anchor: the subject this item is about is not on the page any
    // more. The item is kept, the card says so, and the projection tells the
    // agent rather than sending it looking blind.
    ANCHOR_LOST: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "The passage this item is about is no longer on the page. The item is kept and the agent is told.",
      null
    ),
    REPLAY_CONTENT_CHANGED: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "The content under this edit changed, so nothing was written. Your text is kept.",
      null
    ),
    // Neither the before nor the after matches what is on the page now: two
    // people, or a rebuild, changed the same region. Writing either one would
    // clobber a change nobody asked to lose.
    REPLAY_NEITHER_MATCHES: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "This region is neither what you edited nor what you changed it to, so nothing was written. Your text is kept.",
      "Look at the region and reapply your change if it still makes sense."
    ),
    REPLAY_GROUP_INCOMPLETE: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "This edit spans several regions and one of them could not be placed, so none of them were changed.",
      null
    ),

    // --- replies from agents (D6) ------------------------------------------
    //
    // The helper SKIPS a bad line and never dies: exiting on one agent's typo
    // takes the reviewer's session with it, which is a worse failure than the
    // one it reports.
    REPLY_LINE_MALFORMED: def(
      SEVERITY.WARNING,
      true,
      SURFACE.FAILURES_LIST,
      "An agent wrote a reply line this tool could not read, so that line was skipped. Everything else was folded in.",
      "The chip names the file and the line number; the agent that wrote it can fix and append again."
    ),

    // --- the helper's refusals (D11) ---------------------------------------
    //
    // Every one of these is logged by the helper NAMING THE CHECK THAT FAILED,
    // which is what makes "outside cannot get in" observable rather than a
    // claim. src/shared/protocol.js CHECKS is the ordered list.
    PROTO_BAD_REQUEST: def(SEVERITY.BLOCKING, false, SURFACE.CLI, "The request was malformed.", null),
    PROTO_BAD_HOST: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "The Host header does not name the helper, so the request was refused.",
      null
    ),
    PROTO_UNAUTHORIZED: def(SEVERITY.BLOCKING, false, SURFACE.CLI, "Missing or invalid per-review token.", null),
    PROTO_FORBIDDEN_ORIGIN: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This origin is not registered for this review.",
      null
    ),
    PROTO_UNKNOWN_REVIEW: def(SEVERITY.BLOCKING, false, SURFACE.CLI, "No such review.", null),
    PROTO_UNSUPPORTED_MEDIA_TYPE: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Mutating routes require a JSON content type.",
      null
    ),
    PROTO_MISSING_CUSTOM_HEADER: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Every route but health requires the client header, so a simple cross-origin request cannot reach a handler.",
      null
    ),
    PROTO_STALE_REV: def(
      SEVERITY.WARNING,
      false,
      SURFACE.CLI,
      "This reply names a revision that has since been superseded. The newer revision stays outstanding.",
      null
    ),
    PROTO_UNKNOWN_ITEM: def(SEVERITY.BLOCKING, false, SURFACE.CLI, "No such item in this review.", null),
    PROTO_SECOND_WINDOW: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Another window already holds this review.",
      "Take over from the window you are in."
    ),
    PROTO_SECOND_INSTANCE: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Another helper is already running for this data directory.",
      "Use the running one, or stop it first."
    ),

    // --- the CLI -----------------------------------------------------------
    CLI_NO_REVIEW: def(SEVERITY.INFO, false, SURFACE.CLI, "No review has anything ready.", null),
    CLI_REVIEW_ENDED: def(
      SEVERITY.INFO,
      false,
      SURFACE.CLI,
      "The reviewer ended this review. Stop waiting and stop asking.",
      null
    ),
    CLI_RUNTIME_MISSING: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Node 20 or newer is required and was not found.",
      "Install Node 20 or newer, then run the add step again."
    ),
    CLI_PATH_REFUSED: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "A write was refused because the destination resolved outside the review folder or is a symlink.",
      null
    ),

    // --- copy and export (3C, R10 and R11) ---------------------------------
    //
    // Copy and Export are always visible and always meant to work, so the case
    // that needs a code is the one where they did not: a clipboard the browser
    // refused, or a file the page could not save. A control that looked like it
    // worked and did not is the failure this tool exists to remove, and the
    // reviewer only finds out at the moment they paste.
    COPY_FAILED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "The review was not copied to the clipboard, so there is nothing to paste.",
      "Use Export to save it as a file instead."
    ),
    EXPORT_FAILED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "The review could not be saved as a file.",
      "Use Copy to put it on the clipboard instead."
    )
  };

  // ---------------------------------------------------------------------------
  // Aliases
  // ---------------------------------------------------------------------------
  //
  // Old spellings still typed in files other tasks own. They resolve to the
  // canonical code and keep their own spelling in the failure they return, so a
  // rail entry and a dismissal still match. ON THE PHASE 4B CLEANUP BATCH: when
  // 1B, 1C and 2C rename their call sites, this map goes.
  var ALIASES = {
    SYNC_SERVICE_DOWN: "HELPER_UNREACHABLE",
    CLI_NO_SERVICE: "HELPER_UNREACHABLE",
    SYNC_POLICY_REFUSED: "CSP_REFUSED",
    SECOND_TAB_REFUSED: "SECOND_WINDOW_REFUSED",
    ANCHOR_SUBJECT_GONE: "ANCHOR_LOST",
    ANCHOR_NOT_FOUND: "ANCHOR_LOST"
  };

  var CODE_NAMES = Object.keys(CODES);
  var ALIAS_NAMES = Object.keys(ALIASES);

  function canonical(code) {
    return Object.prototype.hasOwnProperty.call(ALIASES, code) ? ALIASES[code] : code;
  }

  function describe(code) {
    var name = canonical(code);
    if (!Object.prototype.hasOwnProperty.call(CODES, name)) {
      throw new Error("unknown failure code: " + String(code) + ". Add it to src/shared/failures.js");
    }
    return CODES[name];
  }

  // The shape every failure travels in, whether it lands in the rail's failures
  // list, on a card, or in a helper error body.
  // Codes that describe a STANDING STATE rather than an occurrence. Raising one
  // again means "still true", not "happened again", so the chip must not grow a
  // ×N counter: a reviewer whose window was refused across four Turbo
  // navigations read ×4 as four other windows (first-real-use finding,
  // 2026-08-14).
  //
  // The helper being unreachable is the same shape: the page retries forever on
  // a backoff, so "×7" counted the retries rather than telling the reviewer
  // anything. It is one condition, it stands while it is true, and the thing
  // that ends it (the helper answering again) clears the chip.
  var STANDING = {
    SECOND_WINDOW_REFUSED: true,
    HELPER_UNREACHABLE: true
  };

  function failure(code, detail) {
    var d = describe(code);
    return {
      code: code,
      canonical_code: canonical(code),
      severity: d.severity,
      persistent: d.persistent,
      standing: STANDING[canonical(code)] === true,
      surface: d.surface,
      message: d.message,
      remedy: d.remedy,
      detail: detail === undefined ? null : detail,
      at: new Date().toISOString()
    };
  }

  function isPersistent(code) {
    return describe(code).persistent;
  }

  var api = {
    SEVERITY: SEVERITY,
    SURFACE: SURFACE,
    CODES: CODES,
    CODE_NAMES: CODE_NAMES,
    ALIASES: ALIASES,
    ALIAS_NAMES: ALIAS_NAMES,
    canonical: canonical,
    describe: describe,
    failure: failure,
    isPersistent: isPersistent
  };

  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.failures = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
