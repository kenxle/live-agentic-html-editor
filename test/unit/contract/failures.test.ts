/*
 * read-when: Changing src/contract/failures.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  ALIASES,
  ANCHOR_FAILURE_CODES,
  CODES,
  CODE_NAMES,
  SEVERITY,
  SURFACE,
  canonical,
  chipAction,
  describe,
  failure,
  isCopyable,
  isFailureName,
  isStorageQuota,
  tolerateStorageQuota
} from "../../../src/contract/failures.ts";
import type { Failure, FailureAlias, FailureCode, FailureName } from "../../../src/contract/failures.ts";

interface Words {
  readonly severity: string;
  readonly persistent: boolean;
  readonly surface: string;
  readonly message: string;
  readonly remedy: string | null;
}

const ORDER: readonly string[] = [
  "HELPER_UNREACHABLE",
  "CSP_REFUSED",
  "SYNC_UNAUTHORIZED",
  "SYNC_ORIGIN_NOT_ALLOWED",
  "STORAGE_QUOTA",
  "SECOND_WINDOW_REFUSED",
  "ANCHOR_NO_TEXT_MATCH",
  "ANCHOR_AMBIGUOUS",
  "ANCHOR_STRUCTURE_ONLY",
  "ANCHOR_LOST",
  "REPLAY_NEITHER_MATCHES",
  "RUN_BLOCK_REFUSED",
  "RUN_OVER_CEILING",
  "RUN_PLACEMENT_REFUSED",
  "RUN_TAKEBACK_CARRIES_RUN",
  "REPLAY_RUN_WRONG_TAG",
  "REPLAY_RUN_PLACED_ELSEWHERE",
  "HELPER_CONTRACT_OLDER",
  "RUN_EVENT_REFUSED",
  "SUGGESTION_NOT_FOUND",
  "CHOICE_REFUSED",
  "CHOICE_GROUP_INERT",
  "CHOICE_GROUP_GONE",
  "CHOICE_GROUP_TWICE",
  "REPLY_LINE_MALFORMED",
  "PROTO_BAD_REQUEST",
  "PROTO_BAD_HOST",
  "PROTO_UNAUTHORIZED",
  "PROTO_FORBIDDEN_ORIGIN",
  "PROTO_UNKNOWN_REVIEW",
  "PROTO_UNSUPPORTED_MEDIA_TYPE",
  "PROTO_MISSING_CUSTOM_HEADER",
  "PROTO_STALE_REV",
  "PROTO_UNKNOWN_ITEM",
  "PROTO_REVIEW_RETIRED",
  "PROTO_NOT_OWNER",
  "PROTO_SECOND_WINDOW",
  "PROTO_SECOND_INSTANCE",
  "PROTO_CROSS_SITE",
  "PROTO_NOT_OPENABLE",
  "PROTO_REQUEST_PENDING",
  "PROTO_QUEUE_FULL",
  "PROTO_NO_AGENT",
  "PROTO_CONFIRM_NEEDED",
  "PROTO_NO_LAUNCH",
  "PROTO_CATALOG_UNREADABLE",
  "CLI_PATH_REFUSED",
  "COPY_FAILED",
  "EXPORT_FAILED"
];

const WORDS: Readonly<Record<FailureCode, Words>> = {
  HELPER_UNREACHABLE: {
    severity: "warning",
    persistent: true,
    surface: "failures_list",
    message: "The local helper is not reachable. Your feedback is safe in this browser and goes to the helper when it comes back.",
    remedy: "Start the helper, or use Copy or Export to get everything out now."
  },
  CSP_REFUSED: {
    severity: "blocking",
    persistent: true,
    surface: "failures_list",
    message: "This page's content security policy refused the connection to the local helper. This is not the helper being down.",
    remedy: "Add the helper's origin to connect-src in this app's development CSP."
  },
  SYNC_UNAUTHORIZED: {
    severity: "blocking",
    persistent: true,
    surface: "failures_list",
    message: "The local helper refused this page's token.",
    remedy: "Run the add step again for this review, then reload the page."
  },
  SYNC_ORIGIN_NOT_ALLOWED: {
    severity: "blocking",
    persistent: true,
    surface: "failures_list",
    message: "This page's address is not registered for this review. The helper is fine; it refuses addresses it does not know.",
    remedy: "Have your agent re-run the add step with this page's address, then reload."
  },
  STORAGE_QUOTA: {
    severity: "blocking",
    persistent: true,
    surface: "failures_list",
    message: "Browser storage is full, so the last change could not be saved locally.",
    remedy: "Export what you have, then clear storage for this origin."
  },
  SECOND_WINDOW_REFUSED: {
    severity: "blocking",
    persistent: true,
    surface: "failures_list",
    message: "Another window is already reviewing this page. This one is read-only so the two cannot overwrite each other.",
    remedy: "Use Review here instead to move the review to this window."
  },
  ANCHOR_NO_TEXT_MATCH: {
    severity: "warning",
    persistent: true,
    surface: "card",
    message: "This feedback could not be safely matched to this version of the page. Nothing was moved or changed, and your feedback is kept.",
    remedy: null
  },
  ANCHOR_AMBIGUOUS: {
    severity: "warning",
    persistent: true,
    surface: "card",
    message: "More than one place on this page matches this feedback, so nothing was moved or changed. Your feedback is kept.",
    remedy: null
  },
  ANCHOR_STRUCTURE_ONLY: {
    severity: "warning",
    persistent: true,
    surface: "card",
    message: "A structurally similar place is still present, but its text does not match this feedback. Nothing was moved or changed, and your feedback is kept.",
    remedy: null
  },
  ANCHOR_LOST: {
    severity: "warning",
    persistent: true,
    surface: "card",
    message: "This feedback could not be safely matched to this version of the page. Nothing was moved or changed, and your feedback is kept.",
    remedy: null
  },
  REPLAY_NEITHER_MATCHES: {
    severity: "warning",
    persistent: true,
    surface: "card",
    message: "This region is neither what you edited nor what you changed it to, so nothing was written. Your text is kept.",
    remedy: "Look at the region and reapply your change if it still makes sense."
  },
  RUN_BLOCK_REFUSED: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "A new block in this edit is not a paragraph, heading or list the tool can store, or holds markup outside bold and italic.",
    remedy: null
  },
  RUN_OVER_CEILING: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "This edit is larger than the helper stores in one record.",
    remedy: null
  },
  RUN_PLACEMENT_REFUSED: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "This edit's placement is not after_anchor or start_of_container.",
    remedy: null
  },
  RUN_TAKEBACK_CARRIES_RUN: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "A take-back names blocks to remove and never carries new blocks.",
    remedy: null
  },
  REPLAY_RUN_WRONG_TAG: {
    severity: "warning",
    persistent: true,
    surface: "card",
    message: "The agent placed '{first words}' as a {type}. You wrote a {type}, so Lahe sent it back.",
    remedy: null
  },
  REPLAY_RUN_PLACED_ELSEWHERE: {
    severity: "info",
    persistent: true,
    surface: "card",
    message: "'{first words}' is already further down the page, so Lahe did not add it again.",
    remedy: null
  },
  HELPER_CONTRACT_OLDER: {
    severity: "blocking",
    persistent: true,
    surface: "failures_list",
    message: "The local helper is an older version than this page, so nothing you write here is sent to it. Your work is safe in this browser.",
    remedy: "Ask your agent to restart the helper (lahe session list restarts an old one), then reload this page."
  },
  RUN_EVENT_REFUSED: {
    severity: "blocking",
    persistent: true,
    surface: "card",
    message: "The helper refused this edit, so the agent has not seen it. Your words are still on this page.",
    remedy: null
  },
  SUGGESTION_NOT_FOUND: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "A proofreading suggestion's from text is not in its block exactly once, so it cannot be applied.",
    remedy: null
  },
  CHOICE_REFUSED: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "A choice record names its group and answer with short ids and carries nothing else, so this one was not stored.",
    remedy: null
  },
  CHOICE_GROUP_INERT: {
    severity: "warning",
    persistent: true,
    surface: "failures_list",
    message: "Some choices on this page cannot be pressed, so they show as plain text.",
    remedy: "Ask your agent to fix them. Each one and the reason:"
  },
  CHOICE_GROUP_GONE: {
    severity: "warning",
    persistent: true,
    surface: "card",
    message: "This choice is no longer on the page. Your answer is kept and is still with the agent.",
    remedy: null
  },
  CHOICE_GROUP_TWICE: {
    severity: "warning",
    persistent: true,
    surface: "card",
    message: "Two choices on this page now share this one's name, so Lahe marked neither. Your answer is kept.",
    remedy: null
  },
  REPLY_LINE_MALFORMED: {
    severity: "warning",
    persistent: true,
    surface: "failures_list",
    message: "An agent wrote a reply line this tool could not read, so that line was skipped. Everything else was folded in.",
    remedy: "The chip names the file and the line number; the agent that wrote it can fix and append again."
  },
  PROTO_BAD_REQUEST: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "The request was malformed.",
    remedy: null
  },
  PROTO_BAD_HOST: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "The Host header does not name the helper, so the request was refused.",
    remedy: null
  },
  PROTO_UNAUTHORIZED: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "Missing or invalid per-review token.",
    remedy: null
  },
  PROTO_FORBIDDEN_ORIGIN: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "This origin is not registered for this review.",
    remedy: null
  },
  PROTO_UNKNOWN_REVIEW: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "No such review.",
    remedy: null
  },
  PROTO_UNSUPPORTED_MEDIA_TYPE: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "Mutating routes require a JSON content type.",
    remedy: null
  },
  PROTO_MISSING_CUSTOM_HEADER: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "Every route but health requires the client header, so a simple cross-origin request cannot reach a handler.",
    remedy: null
  },
  PROTO_STALE_REV: {
    severity: "warning",
    persistent: false,
    surface: "cli",
    message: "This reply names a revision that has since been superseded. The newer revision stays outstanding.",
    remedy: null
  },
  PROTO_UNKNOWN_ITEM: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "No such item in this review.",
    remedy: null
  },
  PROTO_REVIEW_RETIRED: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "This review was retired, so it takes no more comments.",
    remedy: "Reload the page: it now answers with the file's current review, if it has one."
  },
  PROTO_NOT_OWNER: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "This review belongs to another agent session, so this session cannot retire it.",
    remedy: "Ask your human. A handoff is lahe session takeover, which they ask for."
  },
  PROTO_SECOND_WINDOW: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "Another window already holds this review.",
    remedy: "Take over from the window you are in."
  },
  PROTO_SECOND_INSTANCE: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "Another helper is already running for this data directory.",
    remedy: "Use the running one, or stop it first."
  },
  PROTO_CROSS_SITE: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "This request did not come from the Library page itself, so it was refused.",
    remedy: "Use the Library page at the helper's own address, /catalog."
  },
  PROTO_NOT_OPENABLE: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "This document cannot be opened from the Library: its files are missing, or it has no recorded server.",
    remedy: "Ask your agent to serve it again with lahe review."
  },
  PROTO_REQUEST_PENDING: {
    severity: "info",
    persistent: false,
    surface: "cli",
    message: "This document already has a request waiting for an agent.",
    remedy: "Wait for the agent to answer. Its answer shows on the row."
  },
  PROTO_QUEUE_FULL: {
    severity: "warning",
    persistent: false,
    surface: "cli",
    message: "Too many requests are already waiting for an agent.",
    remedy: "Wait for the agent to answer some of them, then try again."
  },
  PROTO_NO_AGENT: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "No agent is attached to the Library, or the attached agent has stopped watching.",
    remedy: "Ask an agent to run lahe library with its own session, or copy the hand-off message into a new agent."
  },
  PROTO_CONFIRM_NEEDED: {
    severity: "info",
    persistent: false,
    surface: "cli",
    message: "Another agent is watching this document's session, so moving it needs your say-so.",
    remedy: "Choose Move the session to confirm, or open it just to read."
  },
  PROTO_NO_LAUNCH: {
    severity: "info",
    persistent: false,
    surface: "cli",
    message: "A new agent can only be launched on a document with a session to take over and a file to serve. This one is from before sessions, or its worktree is gone and no main-repo copy passes the checks.",
    remedy: "Choose Pick this up instead. The attached agent serves it in its own session."
  },
  PROTO_CATALOG_UNREADABLE: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "The Library's saved stars file cannot be read, so stars cannot change. Lahe leaves the file as it is.",
    remedy: "Fix or move aside catalog.json in the Lahe state folder, then try again."
  },
  CLI_PATH_REFUSED: {
    severity: "blocking",
    persistent: false,
    surface: "cli",
    message: "A write was refused because the destination resolved outside the review folder or is a symlink.",
    remedy: null
  },
  COPY_FAILED: {
    severity: "blocking",
    persistent: true,
    surface: "failures_list",
    message: "The review was not copied to the clipboard, so there is nothing to paste.",
    remedy: "Use Export to save it as a file instead."
  },
  EXPORT_FAILED: {
    severity: "blocking",
    persistent: true,
    surface: "failures_list",
    message: "The review could not be saved as a file.",
    remedy: "Use Copy to put it on the clipboard instead."
  }
};

const ALIAS_TARGETS: Readonly<Record<FailureAlias, FailureCode>> = {
  SYNC_SERVICE_DOWN: "HELPER_UNREACHABLE",
  CLI_NO_SERVICE: "HELPER_UNREACHABLE",
  SYNC_POLICY_REFUSED: "CSP_REFUSED",
  SECOND_TAB_REFUSED: "SECOND_WINDOW_REFUSED",
  ANCHOR_SUBJECT_GONE: "ANCHOR_LOST",
  ANCHOR_NOT_FOUND: "ANCHOR_LOST"
};

const ALIAS_NAMES: readonly FailureAlias[] = [
  "SYNC_SERVICE_DOWN",
  "CLI_NO_SERVICE",
  "SYNC_POLICY_REFUSED",
  "SECOND_TAB_REFUSED",
  "ANCHOR_SUBJECT_GONE",
  "ANCHOR_NOT_FOUND"
];

const STANDING_CODES: readonly string[] = ["HELPER_UNREACHABLE", "SECOND_WINDOW_REFUSED", "CHOICE_GROUP_INERT"];

const COPYABLE_CODES: readonly string[] = [
  "SYNC_ORIGIN_NOT_ALLOWED",
  "CSP_REFUSED",
  "REPLY_LINE_MALFORMED",
  "SYNC_UNAUTHORIZED",
  "CHOICE_GROUP_INERT"
];

const ALL_NAMES: readonly FailureName[] = [...CODE_NAMES, ...ALIAS_NAMES];

function targetOf(name: FailureName): string {
  for (const alias of ALIAS_NAMES) {
    if (alias === name) return ALIAS_TARGETS[alias];
  }
  return name;
}

function wordsOf(code: FailureCode): Words {
  const got = describe(code);
  return {
    severity: got.severity,
    persistent: got.persistent,
    surface: got.surface,
    message: got.message,
    remedy: got.remedy
  };
}

function untyped(call: (name: never) => unknown, value: unknown): () => void {
  return () => {
    Reflect.apply(call, undefined, [value]);
  };
}

function quotaError(): Error & { readonly failure: Failure } {
  return Object.assign(new Error("browser storage is full"), { failure: failure("STORAGE_QUOTA", "writeChips") });
}

test("the code list is exactly these 49 codes, in this order", () => {
  assert.equal(ORDER.length, 49);
  assert.deepEqual([...CODE_NAMES], ORDER);
});

test("the pruned codes are gone: six nothing raises, and the send-era four", () => {
  const gone = [
    "STORAGE_UNAVAILABLE",
    "REPLAY_CONTENT_CHANGED",
    "REPLAY_GROUP_INCOMPLETE",
    "CLI_NO_REVIEW",
    "CLI_REVIEW_ENDED",
    "CLI_RUNTIME_MISSING",
    "VERIFY_NOT_FOUND",
    "VERIFY_NOT_VERIFIABLE",
    "PROTO_NOT_DELIVERED",
    "PROTO_TARGET_MISMATCH"
  ];
  for (const code of gone) {
    assert.equal(CODE_NAMES.some((name) => name === code), false, code);
    assert.equal(isFailureName(code), false, code);
  }
});

test("the table has a row for every code and for nothing else", () => {
  assert.deepEqual(Object.keys(CODES), ORDER);
});

test("every code's words are the old words, byte for byte", () => {
  for (const code of CODE_NAMES) {
    assert.deepEqual(wordsOf(code), WORDS[code], code);
  }
});

test("a CSP refusal and a helper that is down are two codes with two messages", () => {
  const csp = describe("CSP_REFUSED").message;
  assert.notEqual(csp, describe("HELPER_UNREACHABLE").message);
  assert.ok(csp.includes("This is not the helper being down."));
});

test("the card notes keep their placeholders, and a refused edit keeps its sentence", () => {
  assert.equal(
    describe("REPLAY_RUN_WRONG_TAG").message,
    "The agent placed '{first words}' as a {type}. You wrote a {type}, so Lahe sent it back."
  );
  assert.equal(
    describe("REPLAY_RUN_PLACED_ELSEWHERE").message,
    "'{first words}' is already further down the page, so Lahe did not add it again."
  );
  assert.equal(
    describe("RUN_EVENT_REFUSED").message,
    "The helper refused this edit, so the agent has not seen it. Your words are still on this page."
  );
});

test("Copy failing stays in the failures list, and a malformed reply line stays until dismissed", () => {
  assert.equal(describe("COPY_FAILED").persistent, true);
  assert.equal(describe("COPY_FAILED").surface, "failures_list");
  assert.equal(describe("EXPORT_FAILED").persistent, true);
  assert.equal(describe("REPLY_LINE_MALFORMED").persistent, true);
});

test("the two small vocabularies are closed, and every row speaks them", () => {
  assert.deepEqual({ ...SEVERITY }, { BLOCKING: "blocking", WARNING: "warning", INFO: "info" });
  assert.deepEqual({ ...SURFACE }, { FAILURES_LIST: "failures_list", CARD: "card", CLI: "cli" });
  const severities: readonly string[] = Object.values(SEVERITY);
  const surfaces: readonly string[] = Object.values(SURFACE);
  for (const code of CODE_NAMES) {
    const got = describe(code);
    assert.ok(severities.includes(got.severity), code);
    assert.ok(surfaces.includes(got.surface), code);
    assert.ok(got.remedy === null || typeof got.remedy === "string", code);
  }
});

test("an old spelling resolves to its canonical code and keeps its own name", () => {
  assert.deepEqual({ ...ALIASES }, ALIAS_TARGETS);
  const f = failure("SYNC_SERVICE_DOWN", null);
  assert.equal(f.code, "SYNC_SERVICE_DOWN");
  assert.equal(f.canonical_code, "HELPER_UNREACHABLE");
  assert.equal(canonical("SECOND_TAB_REFUSED"), "SECOND_WINDOW_REFUSED");
  assert.equal(canonical("ANCHOR_NOT_FOUND"), "ANCHOR_LOST");
  for (const alias of ALIAS_NAMES) assert.equal(canonical(alias), ALIAS_TARGETS[alias], alias);
});

test("a code is its own canonical code", () => {
  for (const code of CODE_NAMES) assert.equal(canonical(code), code);
});

test("every code and every alias is a failure name, and nothing else is", () => {
  for (const name of ALL_NAMES) assert.equal(isFailureName(name), true, name);
  const others: readonly unknown[] = ["toString", "__proto__", "constructor", "", "helper_unreachable", "NOT_A_CODE", 42, null, undefined, {}];
  for (const other of others) assert.equal(isFailureName(other), false, String(other));
});

test("describing an alias gives its target's words", () => {
  for (const alias of ALIAS_NAMES) {
    assert.deepEqual(describe(alias), describe(ALIAS_TARGETS[alias]), alias);
  }
});

test("describing a name that is neither a code nor an alias throws, naming the value and the file", () => {
  for (const bad of ["NOT_A_CODE", "toString", "__proto__"]) {
    assert.throws(untyped(describe, bad), (err: unknown) => {
      return err instanceof Error && err.message.includes(bad) && err.message.includes("src/contract/failures.ts");
    });
  }
});

test("a failure carries exactly these fields, with the code spelled as given", () => {
  const before = Date.now();
  const got = failure("SYNC_POLICY_REFUSED", { verdict: "refused", candidates: 2 });
  const after = Date.now();
  assert.deepEqual(Object.keys(got).sort(), [
    "at",
    "canonical_code",
    "code",
    "detail",
    "message",
    "persistent",
    "remedy",
    "severity",
    "standing",
    "surface"
  ]);
  assert.equal(got.code, "SYNC_POLICY_REFUSED");
  assert.equal(got.canonical_code, "CSP_REFUSED");
  assert.deepEqual(wordsOf("CSP_REFUSED"), {
    severity: got.severity,
    persistent: got.persistent,
    surface: got.surface,
    message: got.message,
    remedy: got.remedy
  });
  assert.deepEqual(got.detail, { verdict: "refused", candidates: 2 });
  const at = Date.parse(got.at);
  assert.equal(new Date(at).toISOString(), got.at);
  assert.ok(before <= at && at <= after, "the time is the call's own");
});

test("a failure with no detail carries null", () => {
  assert.equal(failure("COPY_FAILED").detail, null);
  assert.equal(failure("COPY_FAILED", null).detail, null);
});

test("building a failure for a name that is not one throws as describe does", () => {
  assert.throws(untyped(failure, "NOT_A_CODE"), /NOT_A_CODE.*src\/contract\/failures\.ts/);
});

test("exactly three codes are standing, and an alias of one stands too", () => {
  for (const name of ALL_NAMES) {
    assert.equal(failure(name).standing, STANDING_CODES.includes(targetOf(name)), name);
  }
  assert.equal(failure("SYNC_SERVICE_DOWN").standing, true);
  assert.equal(failure("SECOND_TAB_REFUSED").standing, true);
  assert.equal(failure("CSP_REFUSED").standing, false);
});

test("only a refused second window offers a button, under either spelling", () => {
  assert.deepEqual(chipAction("SECOND_WINDOW_REFUSED"), { label: "Review here", action: "takeover" });
  assert.deepEqual(chipAction("SECOND_TAB_REFUSED"), { label: "Review here", action: "takeover" });
  for (const name of ALL_NAMES) {
    if (targetOf(name) === "SECOND_WINDOW_REFUSED") continue;
    assert.equal(chipAction(name), null, name);
  }
  assert.equal(chipAction("NOT_A_CODE"), null);
  assert.equal(chipAction("toString"), null);
  assert.equal(chipAction("__proto__"), null);
  assert.equal(chipAction(""), null);
});

test("the codes whose remedy is an agent handoff can hand the line over, and no others", () => {
  for (const name of ALL_NAMES) {
    assert.equal(isCopyable(name), COPYABLE_CODES.includes(targetOf(name)), name);
  }
  assert.equal(isCopyable("REPLY_LINE_MALFORMED"), true);
  assert.equal(isCopyable("SYNC_UNAUTHORIZED"), true);
  assert.equal(isCopyable("SYNC_ORIGIN_NOT_ALLOWED"), true);
  assert.equal(isCopyable("CSP_REFUSED"), true);
  assert.equal(isCopyable("SYNC_POLICY_REFUSED"), true);
  assert.equal(isCopyable("NOT_A_CODE"), false);
  assert.equal(isCopyable("toString"), false);
});

test("a chip with its own button never also gets a Copy button", () => {
  assert.equal(chipAction("SECOND_WINDOW_REFUSED")?.action, "takeover");
  assert.equal(isCopyable("SECOND_WINDOW_REFUSED"), false);
  assert.equal(chipAction("HELPER_UNREACHABLE"), null);
  assert.equal(isCopyable("HELPER_UNREACHABLE"), false);
  for (const name of ALL_NAMES) {
    assert.equal(isCopyable(name) && chipAction(name) !== null, false, name);
  }
});

test("the anchor failure codes are these six, in this order", () => {
  assert.deepEqual([...ANCHOR_FAILURE_CODES], [
    "ANCHOR_NO_TEXT_MATCH",
    "ANCHOR_AMBIGUOUS",
    "ANCHOR_STRUCTURE_ONLY",
    "ANCHOR_LOST",
    "CHOICE_GROUP_GONE",
    "CHOICE_GROUP_TWICE"
  ]);
});

test("a store write refused for want of room is recognisable as exactly that", () => {
  const err = quotaError();
  assert.equal(isStorageQuota(err), true);
  assert.equal(err.failure.code, "STORAGE_QUOTA");
  assert.equal(isStorageQuota({ failure: failure("STORAGE_QUOTA") }), true);
});

test("anything else is not a storage quota error", () => {
  assert.equal(isStorageQuota(new Error("something else")), false);
  assert.equal(isStorageQuota(null), false);
  assert.equal(isStorageQuota(undefined), false);
  assert.equal(isStorageQuota("STORAGE_QUOTA"), false);
  assert.equal(isStorageQuota({ failure: null }), false);
  assert.equal(isStorageQuota({ failure: "STORAGE_QUOTA" }), false);
  const other = Object.assign(new Error("refused"), { failure: failure("SYNC_UNAUTHORIZED", null) });
  assert.equal(isStorageQuota(other), false);
});

test("a write that goes through reports nothing and returns nothing", () => {
  const raised: Failure[] = [];
  let ran = 0;
  const got = tolerateStorageQuota(
    () => {
      ran += 1;
    },
    (reported) => raised.push(reported)
  );
  assert.equal(got, null);
  assert.equal(ran, 1);
  assert.deepEqual(raised, []);
});

test("a quota failure is reported once and not rethrown", () => {
  const raised: Failure[] = [];
  const err = quotaError();
  const got = tolerateStorageQuota(
    () => {
      throw err;
    },
    (reported) => raised.push(reported)
  );
  assert.equal(got, err.failure);
  assert.equal(raised.length, 1);
  assert.equal(raised[0], err.failure);
});

test("with no report, a quota failure still comes back as the result", () => {
  const err = quotaError();
  const got = tolerateStorageQuota(() => {
    throw err;
  });
  assert.equal(got, err.failure);
});

test("any other error is rethrown as it was, and nothing is reported", () => {
  const raised: Failure[] = [];
  const bug = new Error("a genuine bug");
  assert.throws(
    () =>
      tolerateStorageQuota(
        () => {
          throw bug;
        },
        (reported) => raised.push(reported)
      ),
    (err: unknown) => err === bug
  );
  assert.deepEqual(raised, []);
});

test("reporting a full storage into a full storage does not take the keystroke down", () => {
  const err = quotaError();
  const got = tolerateStorageQuota(
    () => {
      throw err;
    },
    () => {
      throw quotaError();
    }
  );
  assert.equal(got, err.failure);
});

test("a report that fails for any other reason is still loud", () => {
  const err = quotaError();
  const broken = new Error("the rail is broken");
  assert.throws(
    () =>
      tolerateStorageQuota(
        () => {
          throw err;
        },
        () => {
          throw broken;
        }
      ),
    (thrown: unknown) => thrown === broken
  );
});

test("the old path loads the same functions, in an ordinary object old code can write to", () => {
  const load = createRequire(import.meta.url);
  const old: unknown = load("../../../src/shared/failures.js");
  assert.ok(typeof old === "object" && old !== null && "failure" in old);
  assert.equal(old.failure, failure);
  assert.equal(Reflect.get(old, "CODES"), CODES);
  const replacement = (): null => null;
  Reflect.set(old, "failure", replacement);
  assert.equal(Reflect.get(old, "failure"), replacement);
  Reflect.set(old, "failure", failure);
});
