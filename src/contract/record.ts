/*
 * read-when: Adding or renaming a record field, kind or state, or reading what a stored record holds.
 */

import type { ChoicePress } from "./choice.ts";
import { isJsonObject } from "./json-object.ts";
import { REPLY_STATUS, REPLY_STATUSES } from "./replies.ts";
import type { ReplyStatus, Suggestion } from "./replies.ts";

export { REPLY_STATUS, REPLY_STATUSES };
export type { ReplyStatus };

export const FIELD = {
  ID: "id",
  REV: "rev",
  KIND: "kind",
  STATE: "state",
  NOTE: "note",
  CHANGE: "change",
  BEFORE: "before",
  AFTER: "after",
  BEFORE_HTML: "before_html",
  AFTER_HTML: "after_html",
  AFTER_HISTORY: "after_history",
  REGION: "region",
  CONTEXT: "context",
  PAGE_ORIGIN: "page_origin",
  PAGE_PATH: "page_path",
  PAGE_TITLE: "page_title",
  PAGE_SEQ: "page_seq",
  SOURCE_HINT: "source_hint",
  REVERTS: "reverts",
  REPLY: "reply",
  HANDLED_NOT_ON_PAGE: "handled_not_on_page",
  CLOSED_BY: "closed_by",
  CLOSED_AT: "closed_at",
  RECEIVED_AT: "received_at",
  REPLY_SEEN: "reply_seen",
  THREAD: "thread",
  NEW_BLOCKS: "new_blocks",
  ANCHOR_AFTER_HTML: "anchor_after_html",
  ANCHOR_TAG_AFTER: "anchor_tag_after",
  PLACEMENT: "placement",
  REMOVE_BLOCKS: "remove_blocks",
  CHOICE: "choice",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at"
} as const;
export type FieldName = (typeof FIELD)[keyof typeof FIELD];

export const KIND = {
  COMMENT: "comment",
  EDIT: "edit",
  DELETE: "delete",
  FORMAT_ONLY: "format_only",
  NOTE: "note",
  CHOICE: "choice"
} as const;
export type Kind = (typeof KIND)[keyof typeof KIND];
export const KINDS: readonly Kind[] = Object.values(KIND);

export const STATE = { DRAFT: "draft", READY: "ready", HANDLED: "handled", NOT_HANDLED: "not_handled" } as const;
export type ItemState = (typeof STATE)[keyof typeof STATE];
export const STATES: readonly ItemState[] = Object.values(STATE);

export const FILE_ORIGIN = "file";
export const CLOSED_BY_REVIEWER = "reviewer";
export const SUBJECT_SRC_REF = "lahe:subject.src";
export const REPLY_STAMP_MAX = 64;

export const TOOL_ROUND = { PAGE_CHECK_STAMP: "page_check_stamp" } as const;
export type ToolRoundName = (typeof TOOL_ROUND)[keyof typeof TOOL_ROUND];

export const PLACEMENT = { AFTER_ANCHOR: "after_anchor", START_OF_CONTAINER: "start_of_container" } as const;
export type Placement = (typeof PLACEMENT)[keyof typeof PLACEMENT];
export const PLACEMENTS: readonly [typeof PLACEMENT.AFTER_ANCHOR, typeof PLACEMENT.START_OF_CONTAINER] = [
  PLACEMENT.AFTER_ANCHOR,
  PLACEMENT.START_OF_CONTAINER
];

export const RUN_FIELDS: readonly ["new_blocks", "anchor_after_html", "anchor_tag_after", "placement", "remove_blocks"] = [
  FIELD.NEW_BLOCKS,
  FIELD.ANCHOR_AFTER_HTML,
  FIELD.ANCHOR_TAG_AFTER,
  FIELD.PLACEMENT,
  FIELD.REMOVE_BLOCKS
];
export type RunField = (typeof RUN_FIELDS)[number];

export interface RunBlock {
  readonly tag: string;
  readonly html: string;
  readonly from_anchor?: boolean;
}

export interface RegionRef {
  readonly stamp?: string | null;
  readonly fingerprint?: { readonly tag?: string | null } | null;
  readonly kind?: string;
  readonly group?: string;
}
export interface LostAnchor {
  readonly code: string;
  readonly reason: string | null;
  readonly at: string;
}
export interface CheckReopen {
  readonly rev: number;
  readonly at: string;
  readonly stamp: string | null;
  readonly tool: ToolRoundName | null;
}
export interface Region {
  readonly ref: RegionRef | null;
  readonly label: string | null;
  readonly lost: LostAnchor | null;
  readonly accepted_page_texts: readonly string[];
  readonly check_reopen: CheckReopen | null;
}

export interface Subject {
  readonly tag?: string | null;
  readonly src?: string | null;
  readonly alt?: string | null;
  readonly html?: string | null;
  readonly near?: string | null;
}
export interface SlideContext {
  readonly index: number | null;
  readonly total: number | null;
  readonly uncounted: boolean;
  readonly id: string | null;
  readonly heading: string | null;
  readonly text: string | null;
}
export interface Context {
  readonly quote: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly heading: string | null;
  readonly element: string | null;
  readonly subject: Subject | null;
  readonly slide?: SlideContext | null;
}

export type SourceHint = string | { readonly path?: string | null; readonly known?: boolean };

export interface HistoryEntry {
  readonly rev: number;
  readonly after: string | null;
  readonly after_html: string | null;
  readonly at: string;
  readonly new_blocks?: readonly RunBlock[];
  readonly anchor_after_html?: string | null;
  readonly anchor_tag_after?: string | null;
  readonly placement?: Placement;
}

export interface ArchivedReply {
  readonly status: ReplyStatus | null;
  readonly agent: string | null;
  readonly reason: string | null;
  readonly text: string | null;
  readonly files: readonly unknown[];
  readonly at: string | null;
  readonly proofread?: true;
  readonly suggestions?: readonly Suggestion[];
  readonly previous?: readonly ArchivedReply[];
}
export interface FoldedReply {
  readonly status: ReplyStatus;
  readonly agent: string | null;
  readonly reason: string | null;
  readonly text: string | null;
  readonly files: readonly unknown[];
  readonly at: string | null;
  readonly user_needs_to_see_reply?: boolean;
  readonly proofread?: true;
  readonly suggestions?: readonly Suggestion[];
  readonly previous?: readonly ArchivedReply[];
}
export interface ThreadRound {
  readonly rev: number;
  readonly reviewer: { readonly note: string | null; readonly change: string | null; readonly at: string | null };
  readonly agent: ArchivedReply;
  readonly tool?: ToolRoundName;
}

export interface Item {
  id: string;
  rev: number;
  kind: Kind;
  state: ItemState;
  note: string | null;
  change: string | null;
  before: string | null;
  after: string | null;
  before_html: string | null;
  after_html: string | null;
  after_history: HistoryEntry[];
  region: Region;
  context: Context;
  page_origin: string;
  page_path: string;
  page_title: string | null;
  page_seq: number | null;
  source_hint: SourceHint | null;
  reverts: string | null;
  reply: FoldedReply | null;
  handled_not_on_page: boolean;
  thread: ThreadRound[];
  created_at: string;
  updated_at: string;
  closed_by?: typeof CLOSED_BY_REVIEWER;
  closed_at?: string;
  received_at?: string | null;
  reply_seen?: string;
  new_blocks?: RunBlock[];
  anchor_after_html?: string | null;
  anchor_tag_after?: string | null;
  placement?: Placement;
  remove_blocks?: RunBlock[];
  choice?: ChoicePress;
}

const TOOL_ROUND_NAMES: readonly ToolRoundName[] = Object.values(TOOL_ROUND);
const HAND_EDIT_KINDS = [KIND.EDIT, KIND.DELETE, KIND.FORMAT_ONLY] as const;

export function isKind(value: unknown): value is Kind {
  return KINDS.some((kind) => kind === value);
}
export function isItemState(value: unknown): value is ItemState {
  return STATES.some((state) => state === value);
}
export function isToolRoundName(value: unknown): value is ToolRoundName {
  return TOOL_ROUND_NAMES.some((name) => name === value);
}
export function isPlacement(value: unknown): value is Placement {
  return PLACEMENTS.some((placement) => placement === value);
}

export function emptyRegion(): Region {
  return { ref: null, label: null, lost: null, accepted_page_texts: [], check_reopen: null };
}
export function emptyContext(): Context {
  return { quote: null, prefix: null, suffix: null, heading: null, element: null, subject: null };
}
export function emptySlideContext(): SlideContext {
  return { index: null, total: null, uncounted: false, id: null, heading: null, text: null };
}

export function isHandEdit(item: Pick<Item, "kind"> | null | undefined): boolean {
  return item !== null && item !== undefined && HAND_EDIT_KINDS.some((kind) => kind === item.kind);
}
export function isChoice(item: Pick<Item, "kind"> | null | undefined): boolean {
  return item?.kind === KIND.CHOICE;
}
export function isRevert(item: Pick<Item, "reverts"> | null | undefined): boolean {
  return typeof item?.reverts === "string" && item.reverts !== "";
}
export function isRunRecord(item: Pick<Item, "new_blocks"> | null | undefined): boolean {
  return Array.isArray(item?.new_blocks) && item.new_blocks.length > 0;
}
export function hasRunFields(item: object | null | undefined): boolean {
  if (!isJsonObject(item)) return false;
  return RUN_FIELDS.some((field) => {
    const value = item[field];
    return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
  });
}
