// The failure code enum.
//
// Owner: Task 0a (shared kernel). Imported by: the sync client (1B-ii), the
// store (1B-ii), the anchor engine (1C), replay (2B), the rail's failures list
// (1B-i), the service's error shapes (1A), verification (3B), the CLI (1D).
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
// Architecture D15's table is the mapping from a failure to its surface. This
// module is that table.
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
    // --- sync and transport ------------------------------------------------
    SYNC_SERVICE_DOWN: def(
      SEVERITY.WARNING,
      true,
      SURFACE.FAILURES_LIST,
      "The local service is not reachable. Your feedback is safe in this browser and will be sent when it comes back.",
      "Start the service, or use Copy or Export to get everything out now."
    ),
    SYNC_POLICY_REFUSED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "This page's content security policy refused the connection to the local service. This is not the service being down.",
      "Add the service origin to connect-src in this app's development CSP."
    ),
    SYNC_UNAUTHORIZED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "The local service refused this page's session and would not mint a new one.",
      "Re-register this origin from your terminal, then reload."
    ),
    SYNC_SESSION_EXPIRED: def(
      SEVERITY.INFO,
      false,
      SURFACE.FAILURES_LIST,
      "The session expired and was renewed.",
      null
    ),
    SYNC_ORIGIN_NOT_ALLOWED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "This origin is not registered with the local service, so the layer cannot send anything.",
      "Register it from your terminal with the setup command."
    ),

    // --- browser storage ---------------------------------------------------
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
    SECOND_TAB_REFUSED: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "Another tab is already reviewing this page. This tab is read-only so the two cannot overwrite each other.",
      "Close the other tab, or take over from this one."
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
    ANCHOR_SUBJECT_GONE: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "The passage this comment is about is no longer on the page. The comment is kept and the agent is told.",
      null
    ),
    REPLAY_CONTENT_CHANGED: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "The content under this edit changed, so nothing was written. Your text is kept.",
      null
    ),
    REPLAY_GROUP_INCOMPLETE: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "This edit spans several regions and one of them could not be placed, so none of them were changed.",
      null
    ),

    // --- verification (D8) -------------------------------------------------
    VERIFY_NOT_FOUND: def(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "The agent reported this applied, but your wording is not in the file it named.",
      "Check the file yourself before trusting this one."
    ),
    VERIFY_NOT_VERIFIABLE: def(
      SEVERITY.INFO,
      false,
      SURFACE.CARD,
      "This region could not be checked literally, because the source builds it from a template.",
      null
    ),
    VERIFY_PATH_OUTSIDE_ROOT: def(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "An acknowledgement named a file outside this review's project root and was not read.",
      null
    ),

    // --- protocol (service replies) ----------------------------------------
    PROTO_BAD_REQUEST: def(SEVERITY.BLOCKING, false, SURFACE.CLI, "The request was malformed.", null),
    PROTO_UNAUTHORIZED: def(SEVERITY.BLOCKING, false, SURFACE.CLI, "Missing or invalid credential.", null),
    PROTO_FORBIDDEN_ORIGIN: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This origin is not on the allowlist for any review.",
      null
    ),
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
      "Mutating routes require the client header, so a simple cross-origin request cannot reach a handler.",
      null
    ),
    PROTO_STALE_REV: def(
      SEVERITY.WARNING,
      false,
      SURFACE.CLI,
      "This acknowledgement names a revision that has since been superseded. The newer revision stays outstanding.",
      null
    ),
    PROTO_UNKNOWN_ITEM: def(SEVERITY.BLOCKING, false, SURFACE.CLI, "No such item in this review.", null),
    PROTO_NOT_DELIVERED: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This item was never delivered, so it cannot be acknowledged.",
      null
    ),
    PROTO_TARGET_MISMATCH: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This credential was minted for a different target.",
      null
    ),
    PROTO_SECOND_INSTANCE: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Another service instance is already running for this state directory.",
      "Use the running one, or stop it first."
    ),

    // --- CLI and setup -----------------------------------------------------
    CLI_NO_SERVICE: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "No local service is running.",
      "Start one, or read the review files directly."
    ),
    CLI_NO_REVIEW: def(SEVERITY.INFO, false, SURFACE.CLI, "No review has anything outstanding.", null),
    CLI_REVIEW_ENDED: def(
      SEVERITY.INFO,
      false,
      SURFACE.CLI,
      "The reviewer ended this review. Stop waiting and stop asking.",
      null
    ),
    CLI_SENTINELS_MISSING: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This instruction file mentions the tool but has no sentinel block, so nothing was written.",
      "Add the sentinels by hand, or point setup at a different file."
    ),
    CLI_RUNTIME_MISSING: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Node 20 or newer is required and was not found.",
      "Install Node 20 or newer, then run setup again."
    ),
    CLI_PATH_REFUSED: def(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "A write was refused because the destination resolved outside the review root or is a symlink.",
      null
    )
  };

  var CODE_NAMES = Object.keys(CODES);

  function describe(code) {
    if (!Object.prototype.hasOwnProperty.call(CODES, code)) {
      throw new Error("unknown failure code: " + String(code) + ". Add it to src/shared/failures.js");
    }
    return CODES[code];
  }

  // The shape every failure travels in, whether it lands in the rail's
  // failures list, on a card, or in a CLI error body.
  function failure(code, detail) {
    var d = describe(code);
    return {
      code: code,
      severity: d.severity,
      persistent: d.persistent,
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
