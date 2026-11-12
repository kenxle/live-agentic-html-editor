/*
 * read-when: Adding or changing a failure code, its words or its chip, or finding what a failure in the rail, on a card or in the CLI means.
 */

export const SEVERITY = { BLOCKING: "blocking", WARNING: "warning", INFO: "info" } as const;
export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];

export const SURFACE = { FAILURES_LIST: "failures_list", CARD: "card", CLI: "cli" } as const;
export type Surface = (typeof SURFACE)[keyof typeof SURFACE];

export const CODE_NAMES = [
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
] as const;
export type FailureCode = (typeof CODE_NAMES)[number];

export type FailureAlias =
  | "SYNC_SERVICE_DOWN"
  | "CLI_NO_SERVICE"
  | "SYNC_POLICY_REFUSED"
  | "SECOND_TAB_REFUSED"
  | "ANCHOR_SUBJECT_GONE"
  | "ANCHOR_NOT_FOUND";
export const ALIASES: Readonly<Record<FailureAlias, FailureCode>> = {
  SYNC_SERVICE_DOWN: "HELPER_UNREACHABLE",
  CLI_NO_SERVICE: "HELPER_UNREACHABLE",
  SYNC_POLICY_REFUSED: "CSP_REFUSED",
  SECOND_TAB_REFUSED: "SECOND_WINDOW_REFUSED",
  ANCHOR_SUBJECT_GONE: "ANCHOR_LOST",
  ANCHOR_NOT_FOUND: "ANCHOR_LOST"
};
export type FailureName = FailureCode | FailureAlias;

export type ChipActionName = "takeover";
export interface ChipAction {
  readonly label: string;
  readonly action: ChipActionName;
}
export type ChipOffer =
  | { readonly kind: "none" }
  | { readonly kind: "copy" }
  | ({ readonly kind: "action" } & ChipAction);

export interface FailureDefinition {
  readonly severity: Severity;
  readonly persistent: boolean;
  readonly surface: Surface;
  readonly message: string;
  readonly remedy: string | null;
  readonly standing: boolean;
  readonly offer: ChipOffer;
}

export type FailureDetail =
  | string
  | number
  | boolean
  | null
  | readonly FailureDetail[]
  | { readonly [key: string]: FailureDetail };

export interface Failure {
  readonly code: FailureName;
  readonly canonical_code: FailureCode;
  readonly severity: Severity;
  readonly persistent: boolean;
  readonly standing: boolean;
  readonly surface: Surface;
  readonly message: string;
  readonly remedy: string | null;
  readonly detail: FailureDetail;
  readonly at: string;
}

export interface StorageQuotaError {
  readonly failure: Failure;
}

interface RowOptions {
  readonly standing?: true;
  readonly offer?: ChipOffer;
}

const NO_OFFER: ChipOffer = { kind: "none" };
const COPY_OFFER: ChipOffer = { kind: "copy" };
const TAKEOVER_OFFER: ChipOffer = { kind: "action", label: "Review here", action: "takeover" };

function row(
  severity: Severity,
  persistent: boolean,
  surface: Surface,
  message: string,
  remedy: string | null,
  options: RowOptions = {}
): FailureDefinition {
  return {
    severity,
    persistent,
    surface,
    message,
    remedy,
    standing: options.standing === true,
    offer: options.offer ?? NO_OFFER
  };
}

export const CODES: { readonly [Code in FailureCode]: FailureDefinition } = {
  HELPER_UNREACHABLE: row(
    SEVERITY.WARNING,
    true,
    SURFACE.FAILURES_LIST,
    "The local helper is not reachable. Your feedback is safe in this browser and goes to the helper when it comes back.",
    "Start the helper, or use Copy or Export to get everything out now.",
    { standing: true }
  ),
  CSP_REFUSED: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.FAILURES_LIST,
    "This page's content security policy refused the connection to the local helper. This is not the helper being down.",
    "Add the helper's origin to connect-src in this app's development CSP.",
    { offer: COPY_OFFER }
  ),
  SYNC_UNAUTHORIZED: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.FAILURES_LIST,
    "The local helper refused this page's token.",
    "Run the add step again for this review, then reload the page.",
    { offer: COPY_OFFER }
  ),
  SYNC_ORIGIN_NOT_ALLOWED: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.FAILURES_LIST,
    "This page's address is not registered for this review. The helper is fine; it refuses addresses it does not know.",
    "Have your agent re-run the add step with this page's address, then reload.",
    { offer: COPY_OFFER }
  ),
  STORAGE_QUOTA: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.FAILURES_LIST,
    "Browser storage is full, so the last change could not be saved locally.",
    "Export what you have, then clear storage for this origin."
  ),
  SECOND_WINDOW_REFUSED: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.FAILURES_LIST,
    "Another window is already reviewing this page. This one is read-only so the two cannot overwrite each other.",
    "Use Review here instead to move the review to this window.",
    { standing: true, offer: TAKEOVER_OFFER }
  ),
  ANCHOR_NO_TEXT_MATCH: row(
    SEVERITY.WARNING,
    true,
    SURFACE.CARD,
    "This feedback could not be safely matched to this version of the page. Nothing was moved or changed, and your feedback is kept.",
    null
  ),
  ANCHOR_AMBIGUOUS: row(
    SEVERITY.WARNING,
    true,
    SURFACE.CARD,
    "More than one place on this page matches this feedback, so nothing was moved or changed. Your feedback is kept.",
    null
  ),
  ANCHOR_STRUCTURE_ONLY: row(
    SEVERITY.WARNING,
    true,
    SURFACE.CARD,
    "A structurally similar place is still present, but its text does not match this feedback. Nothing was moved or changed, and your feedback is kept.",
    null
  ),
  ANCHOR_LOST: row(
    SEVERITY.WARNING,
    true,
    SURFACE.CARD,
    "This feedback could not be safely matched to this version of the page. Nothing was moved or changed, and your feedback is kept.",
    null
  ),
  REPLAY_NEITHER_MATCHES: row(
    SEVERITY.WARNING,
    true,
    SURFACE.CARD,
    "This region is neither what you edited nor what you changed it to, so nothing was written. Your text is kept.",
    "Look at the region and reapply your change if it still makes sense."
  ),
  RUN_BLOCK_REFUSED: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "A new block in this edit is not a paragraph, heading or list the tool can store, or holds markup outside bold and italic.",
    null
  ),
  RUN_OVER_CEILING: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "This edit is larger than the helper stores in one record.",
    null
  ),
  RUN_PLACEMENT_REFUSED: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "This edit's placement is not after_anchor or start_of_container.",
    null
  ),
  RUN_TAKEBACK_CARRIES_RUN: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "A take-back names blocks to remove and never carries new blocks.",
    null
  ),
  REPLAY_RUN_WRONG_TAG: row(
    SEVERITY.WARNING,
    true,
    SURFACE.CARD,
    "The agent placed '{first words}' as a {type}. You wrote a {type}, so Lahe sent it back.",
    null
  ),
  REPLAY_RUN_PLACED_ELSEWHERE: row(
    SEVERITY.INFO,
    true,
    SURFACE.CARD,
    "'{first words}' is already further down the page, so Lahe did not add it again.",
    null
  ),
  HELPER_CONTRACT_OLDER: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.FAILURES_LIST,
    "The local helper is an older version than this page, so nothing you write here is sent to it. Your work is safe in this browser.",
    "Ask your agent to restart the helper (lahe session list restarts an old one), then reload this page."
  ),
  RUN_EVENT_REFUSED: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.CARD,
    "The helper refused this edit, so the agent has not seen it. Your words are still on this page.",
    null
  ),
  SUGGESTION_NOT_FOUND: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "A proofreading suggestion's from text is not in its block exactly once, so it cannot be applied.",
    null
  ),
  CHOICE_REFUSED: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "A choice record names its group and answer with short ids and carries nothing else, so this one was not stored.",
    null
  ),
  CHOICE_GROUP_INERT: row(
    SEVERITY.WARNING,
    true,
    SURFACE.FAILURES_LIST,
    "Some choices on this page cannot be pressed, so they show as plain text.",
    "Ask your agent to fix them. Each one and the reason:",
    { standing: true, offer: COPY_OFFER }
  ),
  CHOICE_GROUP_GONE: row(
    SEVERITY.WARNING,
    true,
    SURFACE.CARD,
    "This choice is no longer on the page. Your answer is kept and is still with the agent.",
    null
  ),
  CHOICE_GROUP_TWICE: row(
    SEVERITY.WARNING,
    true,
    SURFACE.CARD,
    "Two choices on this page now share this one's name, so Lahe marked neither. Your answer is kept.",
    null
  ),
  REPLY_LINE_MALFORMED: row(
    SEVERITY.WARNING,
    true,
    SURFACE.FAILURES_LIST,
    "An agent wrote a reply line this tool could not read, so that line was skipped. Everything else was folded in.",
    "The chip names the file and the line number; the agent that wrote it can fix and append again.",
    { offer: COPY_OFFER }
  ),
  PROTO_BAD_REQUEST: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "The request was malformed.",
    null
  ),
  PROTO_BAD_HOST: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "The Host header does not name the helper, so the request was refused.",
    null
  ),
  PROTO_UNAUTHORIZED: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "Missing or invalid per-review token.",
    null
  ),
  PROTO_FORBIDDEN_ORIGIN: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "This origin is not registered for this review.",
    null
  ),
  PROTO_UNKNOWN_REVIEW: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "No such review.",
    null
  ),
  PROTO_UNSUPPORTED_MEDIA_TYPE: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "Mutating routes require a JSON content type.",
    null
  ),
  PROTO_MISSING_CUSTOM_HEADER: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "Every route but health requires the client header, so a simple cross-origin request cannot reach a handler.",
    null
  ),
  PROTO_STALE_REV: row(
    SEVERITY.WARNING,
    false,
    SURFACE.CLI,
    "This reply names a revision that has since been superseded. The newer revision stays outstanding.",
    null
  ),
  PROTO_UNKNOWN_ITEM: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "No such item in this review.",
    null
  ),
  PROTO_REVIEW_RETIRED: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "This review was retired, so it takes no more comments.",
    "Reload the page: it now answers with the file's current review, if it has one."
  ),
  PROTO_NOT_OWNER: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "This review belongs to another agent session, so this session cannot retire it.",
    "Ask your human. A handoff is lahe session takeover, which they ask for."
  ),
  PROTO_SECOND_WINDOW: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "Another window already holds this review.",
    "Take over from the window you are in."
  ),
  PROTO_SECOND_INSTANCE: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "Another helper is already running for this data directory.",
    "Use the running one, or stop it first."
  ),
  PROTO_CROSS_SITE: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "This request did not come from the Library page itself, so it was refused.",
    "Use the Library page at the helper's own address, /catalog."
  ),
  PROTO_NOT_OPENABLE: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "This document cannot be opened from the Library: its files are missing, or it has no recorded server.",
    "Ask your agent to serve it again with lahe review."
  ),
  PROTO_REQUEST_PENDING: row(
    SEVERITY.INFO,
    false,
    SURFACE.CLI,
    "This document already has a request waiting for an agent.",
    "Wait for the agent to answer. Its answer shows on the row."
  ),
  PROTO_QUEUE_FULL: row(
    SEVERITY.WARNING,
    false,
    SURFACE.CLI,
    "Too many requests are already waiting for an agent.",
    "Wait for the agent to answer some of them, then try again."
  ),
  PROTO_NO_AGENT: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "No agent is attached to the Library, or the attached agent has stopped watching.",
    "Ask an agent to run lahe library with its own session, or copy the hand-off message into a new agent."
  ),
  PROTO_CONFIRM_NEEDED: row(
    SEVERITY.INFO,
    false,
    SURFACE.CLI,
    "Another agent is watching this document's session, so moving it needs your say-so.",
    "Choose Move the session to confirm, or open it just to read."
  ),
  PROTO_NO_LAUNCH: row(
    SEVERITY.INFO,
    false,
    SURFACE.CLI,
    "A new agent can only be launched on a document with a session to take over and a file to serve. This one is from before sessions, or its worktree is gone and no main-repo copy passes the checks.",
    "Choose Pick this up instead. The attached agent serves it in its own session."
  ),
  PROTO_CATALOG_UNREADABLE: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "The Library's saved stars file cannot be read, so stars cannot change. Lahe leaves the file as it is.",
    "Fix or move aside catalog.json in the Lahe state folder, then try again."
  ),
  CLI_PATH_REFUSED: row(
    SEVERITY.BLOCKING,
    false,
    SURFACE.CLI,
    "A write was refused because the destination resolved outside the review folder or is a symlink.",
    null
  ),
  COPY_FAILED: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.FAILURES_LIST,
    "The review was not copied to the clipboard, so there is nothing to paste.",
    "Use Export to save it as a file instead."
  ),
  EXPORT_FAILED: row(
    SEVERITY.BLOCKING,
    true,
    SURFACE.FAILURES_LIST,
    "The review could not be saved as a file.",
    "Use Copy to put it on the clipboard instead."
  )
};

export const ANCHOR_FAILURE_CODES: readonly FailureCode[] = [
  "ANCHOR_NO_TEXT_MATCH",
  "ANCHOR_AMBIGUOUS",
  "ANCHOR_STRUCTURE_ONLY",
  "ANCHOR_LOST",
  "CHOICE_GROUP_GONE",
  "CHOICE_GROUP_TWICE"
];

function isAlias(name: FailureName): name is FailureAlias {
  return Object.hasOwn(ALIASES, name);
}

function unknownName(name: unknown): Error {
  return new Error("unknown failure code: " + String(name) + ". Add it to src/contract/failures.ts");
}

export function isFailureName(value: unknown): value is FailureName {
  return typeof value === "string" && (Object.hasOwn(CODES, value) || Object.hasOwn(ALIASES, value));
}

export function canonical(name: FailureName): FailureCode {
  return isAlias(name) ? ALIASES[name] : name;
}

export function describe(name: FailureName): FailureDefinition {
  const code = canonical(name);
  if (!Object.hasOwn(CODES, code)) throw unknownName(name);
  return CODES[code];
}

export function failure(name: FailureName, detail?: FailureDetail): Failure {
  const definition = describe(name);
  return {
    code: name,
    canonical_code: canonical(name),
    severity: definition.severity,
    persistent: definition.persistent,
    standing: definition.standing,
    surface: definition.surface,
    message: definition.message,
    remedy: definition.remedy,
    detail: detail ?? null,
    at: new Date().toISOString()
  };
}

export function chipAction(code: string): ChipAction | null {
  if (!isFailureName(code)) return null;
  const offer = CODES[canonical(code)].offer;
  return offer.kind === "action" ? { label: offer.label, action: offer.action } : null;
}

export function isCopyable(code: string): boolean {
  return isFailureName(code) && CODES[canonical(code)].offer.kind === "copy";
}

export function isStorageQuota(err: unknown): err is StorageQuotaError {
  if (typeof err !== "object" || err === null || !("failure" in err)) return false;
  const inner = err.failure;
  return typeof inner === "object" && inner !== null && "code" in inner && inner.code === "STORAGE_QUOTA";
}

export function tolerateStorageQuota(
  run: () => void,
  report?: ((reported: Failure) => void) | null
): Failure | null {
  try {
    run();
    return null;
  } catch (err: unknown) {
    if (!isStorageQuota(err)) throw err;
    if (typeof report === "function") {
      try {
        report(err.failure);
      } catch (reportErr: unknown) {
        if (!isStorageQuota(reportErr)) throw reportErr;
      }
    }
    return err.failure;
  }
}
