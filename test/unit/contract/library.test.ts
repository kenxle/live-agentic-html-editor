/*
 * read-when: Changing src/contract/library.ts, a number the Library's rules use or its log line, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EVENT } from "../../../src/contract/events.ts";
import { CATALOG, CATALOG_LOG, catalogLogLine, legacyPickupNote } from "../../../src/contract/library.ts";

test("the Library's constants are exactly these", () => {
  assert.deepEqual(CATALOG, {
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
    NOT_WORK_EVENTS: ["origin.registered", "origin.removed", "page.visited", "review.adopted", "reply.seen"]
  });
});

test("the events that are not work on a document are spelled the way the event vocabulary spells them", () => {
  assert.deepEqual(CATALOG.NOT_WORK_EVENTS, [EVENT.ORIGIN_REGISTERED, EVENT.ORIGIN_REMOVED, EVENT.PAGE_VISITED, EVENT.REVIEW_ADOPTED, EVENT.REPLY_SEEN]);
});

test("a legacy pick-up says it belongs to no session and names the review", () => {
  assert.equal(
    legacyPickupNote("r_old"),
    "It belongs to no session. Serving it takes review r_old into your session, with its old comments; drain it for any still waiting."
  );
});

test("the log line is the prefix, the action, the review and the age in whole days", () => {
  assert.deepEqual(CATALOG_LOG, {
    PREFIX: "catalog",
    ACTION: { OPEN: "open", STAR: "star", UNSTAR: "unstar", PICKUP: "pickup", LAUNCH: "launch" },
    FORMAT: "catalog <action> review=<id> age_days=<n>"
  });
  assert.equal(catalogLogLine("open", "r_1", 3), "catalog open review=r_1 age_days=3");
  assert.equal(catalogLogLine("unstar", "r_2", 0), "catalog unstar review=r_2 age_days=0");
  assert.equal(catalogLogLine("launch", "r_3", 12), "catalog launch review=r_3 age_days=12");
});

test("the file spells the log prefix, the Open action and the default view days the way scripts/catalog_opens.py reads them", () => {
  const source = readFileSync(new URL("../../../src/contract/library.ts", import.meta.url), "utf8");
  assert.match(source, /CATALOG_LOG\s*=\s*\{\s*PREFIX:\s*"catalog"/);
  assert.match(source, /ACTION:\s*\{[^}]*OPEN:\s*"open"/);
  assert.match(source, /DEFAULT_VIEW_DAYS:\s*7\b/);
});
