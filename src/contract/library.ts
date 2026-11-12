/*
 * read-when: Changing a number the Library's rules use, its legacy pick-up wording or its log line, or scripts/catalog_opens.py breaks.
 */

import { EVENT } from "./events.ts";
import type { EventType } from "./events.ts";

export const CATALOG: {
  readonly REQUEST_EXPIRY_MS: 1800000;
  readonly LIBRARY_SEEN_MS: 120000;
  readonly WORKING_MS: 120000;
  readonly LIBRARY_SESSION_IDLE_MS: 1800000;
  readonly CREATED_BY_LIBRARY: "library";
  readonly QUEUE_CAP: 5;
  readonly REPROJECT_MAX_BYTES: 5242880;
  readonly POLL_MS: 15000;
  readonly ANSWER_SHOWN_MS: 86400000;
  readonly ANSWER_TEXT_MAX: 500;
  readonly DEFAULT_VIEW_DAYS: 7;
  readonly FOLD_CUTOFF: "2026-09-17T04:00:00Z";
  readonly NOT_WORK_EVENTS: readonly EventType[];
} = {
  REQUEST_EXPIRY_MS: 1800000,
  LIBRARY_SEEN_MS: 120000,
  WORKING_MS: 120000,
  LIBRARY_SESSION_IDLE_MS: 1800000,
  CREATED_BY_LIBRARY: "library",
  QUEUE_CAP: 5,
  REPROJECT_MAX_BYTES: 5242880,
  POLL_MS: 15000,
  ANSWER_SHOWN_MS: 86400000,
  ANSWER_TEXT_MAX: 500,
  DEFAULT_VIEW_DAYS: 7,
  FOLD_CUTOFF: "2026-09-17T04:00:00Z",
  NOT_WORK_EVENTS: [EVENT.ORIGIN_REGISTERED, EVENT.ORIGIN_REMOVED, EVENT.PAGE_VISITED, EVENT.REVIEW_ADOPTED, EVENT.REPLY_SEEN]
};

export function legacyPickupNote(reviewId: string): string {
  return "It belongs to no session. Serving it takes review " + reviewId + " into your session, with its old comments; drain it for any still waiting.";
}

export const CATALOG_LOG = {
  PREFIX: "catalog",
  ACTION: { OPEN: "open", STAR: "star", UNSTAR: "unstar", PICKUP: "pickup", LAUNCH: "launch" },
  FORMAT: "catalog <action> review=<id> age_days=<n>"
} as const;
export type CatalogLogAction = (typeof CATALOG_LOG.ACTION)[keyof typeof CATALOG_LOG.ACTION];

export function catalogLogLine(action: CatalogLogAction, reviewId: string, ageDays: number): string {
  return CATALOG_LOG.PREFIX + " " + action + " review=" + reviewId + " age_days=" + String(ageDays);
}
