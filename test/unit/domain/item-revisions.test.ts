/*
 * read-when: Changing src/domain/item-revisions.ts, what a new record holds, how a rewording bumps the revision, or the applied-after history, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { choiceRef } from "../../../src/contract/choice.ts";
import { FIELD, KIND, STATE, emptyContext, emptyRegion } from "../../../src/contract/record.ts";
import type { HistoryEntry, RunBlock } from "../../../src/contract/record.ts";
import { RUN_HISTORY_KEEP } from "../../../src/contract/run-limits.ts";
import { bumpRev, comparisonFields, comparisonMode, historyEntry, newItem, priorAfters } from "../../../src/domain/item-revisions.ts";
import { isDraft } from "../../../src/domain/item-status.ts";
import { validateItem } from "../../../src/contract/item-check.ts";
import { PAGE, aChoice, anItem, choicePress, folded } from "./support/items.ts";
import { callUntyped } from "../contract/support/untyped.ts";

const COMMON_KEYS = [
  "id",
  "rev",
  "kind",
  "state",
  "note",
  "change",
  "before",
  "after",
  "before_html",
  "after_html",
  "after_history",
  "region",
  "context",
  "page_origin",
  "page_path",
  "page_title",
  "page_seq",
  "source_hint",
  "reverts",
  "reply",
  "handled_not_on_page",
  "thread",
  "created_at",
  "updated_at"
];

const BLOCKS: readonly RunBlock[] = [
  { tag: "p", html: "One" },
  { tag: "h2", html: "Two", from_anchor: true }
];

test("a new record refuses an unknown kind and names the closed list", () => {
  assert.throws(() => callUntyped(newItem, { kind: "nonsense", ...PAGE }), {
    message: "newItem: kind must be one of comment, edit, delete, format_only, note, choice, got nonsense"
  });
  assert.throws(() => callUntyped(newItem, { ...PAGE }), /got undefined/);
});

test("a new record refuses a missing page origin or path, and says why", () => {
  assert.throws(() => newItem({ kind: KIND.NOTE, page_path: "/x" }), {
    message: "newItem: page_origin is required; review.json is grouped by origin plus path"
  });
  assert.throws(() => newItem({ kind: KIND.NOTE, page_origin: "http://x" }), {
    message: "newItem: page_path is required; review.json is grouped by origin plus path"
  });
  assert.throws(() => newItem({ kind: KIND.NOTE, page_origin: "", page_path: "/x" }), /page_origin is required/);
  assert.throws(() => newItem({ kind: KIND.NOTE, page: { origin: "http://x", path: "" } }), /page_path is required/);
});

test("a record starts as a draft unless it is told otherwise, and a draft with nothing typed is still valid", () => {
  const drafted = newItem({ kind: KIND.COMMENT, ...PAGE });
  assert.equal(drafted.state, STATE.DRAFT);
  assert.equal(isDraft(drafted), true);
  assert.doesNotThrow(() => {
    validateItem(drafted);
  });
});

test("a new record carries every field, null where empty, in this key order", () => {
  const item = newItem({ kind: KIND.COMMENT, ...PAGE });
  assert.deepEqual(Object.keys(item), COMMON_KEYS);
  assert.equal(Object.keys(item).length, 24);
  assert.equal(item.rev, 1);
  assert.deepEqual([item.note, item.change, item.before, item.after, item.before_html, item.after_html], [null, null, null, null, null, null]);
  assert.deepEqual(item.after_history, []);
  assert.deepEqual(item.region, emptyRegion());
  assert.deepEqual(item.context, emptyContext());
  assert.deepEqual([item.reverts, item.reply], [null, null]);
  assert.equal(item.handled_not_on_page, false);
  assert.deepEqual(item.thread, []);
  assert.equal(item.created_at, item.updated_at);
  assert.match(item.id, /^itm_[0-9a-f]{24}$/);
});

test("the input's own values win, and the page fields also read from a page object", () => {
  const item = newItem({
    kind: KIND.EDIT,
    id: "itm_given",
    rev: 4,
    state: STATE.HANDLED,
    note: "n",
    change: "c",
    before: "b",
    after: "a",
    before_html: "<b>",
    after_html: "<a>",
    page_origin: "http://given",
    page: { origin: "http://page", path: "/page", title: "From the page", seq: 9, source_hint: "a.html" },
    page_path: "/given",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-02-02T00:00:00.000Z"
  });
  assert.deepEqual(
    [item.id, item.rev, item.state, item.note, item.change, item.before, item.after, item.before_html, item.after_html],
    ["itm_given", 4, "handled", "n", "c", "b", "a", "<b>", "<a>"]
  );
  assert.deepEqual([item.page_origin, item.page_path], ["http://given", "/given"]);
  assert.deepEqual([item.page_title, item.page_seq, item.source_hint], ["From the page", 9, "a.html"]);
  assert.deepEqual([item.created_at, item.updated_at], ["2026-01-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z"]);
  const fromPage = newItem({ kind: KIND.NOTE, page: { origin: "http://page", path: "/page" } });
  assert.deepEqual([fromPage.page_origin, fromPage.page_path, fromPage.page_title, fromPage.page_seq, fromPage.source_hint], ["http://page", "/page", null, null, null]);
  const own = newItem({ kind: KIND.NOTE, page_title: "Own", page_seq: 2, source_hint: "own.html", page: { origin: "o", path: "/p", title: "T", seq: 5, source_hint: "x" } });
  assert.deepEqual([own.page_title, own.page_seq, own.source_hint], ["Own", 2, "own.html"]);
});

test("the first-visit order and the source hint ride on the record, because the projection groups by them", () => {
  const item = anItem({ page_seq: 3, source_hint: "app/views/clients/index.html.erb" });
  assert.equal(item.page_seq, 3);
  assert.equal(item.source_hint, "app/views/clients/index.html.erb");
});

test("a revert is carried only as a non-empty string, a reply as given, and handled_not_on_page only when true", () => {
  assert.equal(anItem({ reverts: "itm_x" }).reverts, "itm_x");
  assert.equal(anItem({ reverts: "" }).reverts, null);
  const reply = folded({ status: "question", text: "Which?" });
  assert.deepEqual(anItem({ reply }).reply, reply);
  assert.equal(anItem({ handled_not_on_page: true }).handled_not_on_page, true);
  assert.equal(anItem({ handled_not_on_page: false }).handled_not_on_page, false);
  const loose = callUntyped(newItem, { kind: KIND.NOTE, ...PAGE, handled_not_on_page: "yes" });
  assert.ok(typeof loose === "object" && loose !== null);
  assert.equal("handled_not_on_page" in loose && loose.handled_not_on_page, false, "only the boolean true counts");
});

test("a record carries each free-writing field its input carries, after the common ones, in the run field order", () => {
  const item = newItem({
    kind: KIND.EDIT,
    ...PAGE,
    placement: "after_anchor",
    remove_blocks: [{ tag: "p", html: "gone" }],
    anchor_tag_after: "h2",
    anchor_after_html: "Anchor",
    new_blocks: BLOCKS
  });
  assert.deepEqual(Object.keys(item).slice(24), ["new_blocks", "anchor_after_html", "anchor_tag_after", "placement", "remove_blocks"]);
  const noRun = callUntyped(newItem, { kind: KIND.EDIT, ...PAGE, new_blocks: undefined, placement: undefined });
  assert.ok(typeof noRun === "object" && noRun !== null);
  assert.equal(Object.keys(noRun).length, 24, "a field the input names as undefined is not carried");
  const choice = aChoice();
  assert.deepEqual(Object.keys(choice).slice(24), ["choice"]);
  assert.deepEqual(choice.choice, { group: "lesson-css-counter", answer: "promote" });
  assert.equal(Object.keys(anItem()).length, 24, "every record with neither run fields nor a choice has exactly the common keys");
});

test("a record shares nothing mutable with its input", () => {
  const history: HistoryEntry[] = [{ rev: 1, after: "a", after_html: null, at: "t" }];
  const input = {
    kind: KIND.EDIT,
    ...PAGE,
    after: "a",
    after_history: history,
    thread: [],
    new_blocks: [{ tag: "p", html: "One" }],
    remove_blocks: [{ tag: "p", html: "Two" }],
    choice: choicePress("g", "a")
  };
  const item = newItem(input);
  assert.notEqual(item.after_history, history);
  assert.notEqual(item.after_history[0], history[0]);
  assert.notEqual(item.thread, input.thread);
  assert.notEqual(item.new_blocks, input.new_blocks);
  assert.notEqual(item.new_blocks?.[0], input.new_blocks[0]);
  assert.notEqual(item.remove_blocks, input.remove_blocks);
  assert.notEqual(item.remove_blocks?.[0], input.remove_blocks[0]);
  assert.notEqual(item.choice, input.choice);
  assert.deepEqual(item.choice, input.choice);
  history.push({ rev: 2, after: "b", after_html: null, at: "u" });
  assert.equal(item.after_history.length, 1);
});

test("received_at is never copied from the input", () => {
  const item = callUntyped(newItem, { kind: KIND.EDIT, ...PAGE, received_at: "2026-01-01T00:00:00.000Z", closed_by: "reviewer" });
  assert.ok(typeof item === "object" && item !== null);
  assert.equal("received_at" in item, false);
  assert.equal("closed_by" in item, false);
});

test("a record whose after is a string starts its history with one entry for itself", () => {
  const item = anItem({ rev: 3, after: "first wording", after_html: "<p>first wording</p>", created_at: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(item.after_history, [{ rev: 3, after: "first wording", after_html: "<p>first wording</p>", at: "2026-01-01T00:00:00.000Z" }]);
  assert.deepEqual(anItem({ after: null }).after_history, []);
  const given: HistoryEntry = { rev: 1, after: "kept", after_html: null, at: "t" };
  assert.deepEqual(anItem({ after_history: [given] }).after_history, [given], "a history the input carries is kept as it is");
});

test("a history entry is the record's own revision, words and markup, at a time, plus the run fields it carries", () => {
  const item = anItem({ rev: 2, after: "x", after_html: "<b>x</b>" });
  assert.deepEqual(historyEntry(item, "T"), { rev: 2, after: "x", after_html: "<b>x</b>", at: "T" });
  const plain = anItem({ after: null, after_html: null });
  assert.deepEqual(historyEntry(plain, "T"), { rev: 1, after: null, after_html: null, at: "T" });
  const run = anItem({ new_blocks: BLOCKS, anchor_after_html: "A", anchor_tag_after: "h2", placement: "after_anchor", remove_blocks: [{ tag: "p", html: "r" }] });
  const entry = historyEntry(run, "T");
  assert.deepEqual(Object.keys(entry), ["rev", "after", "after_html", "at", "new_blocks", "anchor_after_html", "anchor_tag_after", "placement"]);
  assert.deepEqual(entry.new_blocks, BLOCKS);
  assert.notEqual(entry.new_blocks, run.new_blocks, "the blocks are copied");
  assert.equal("remove_blocks" in entry, false, "a take-back's blocks never ride in history");
  const tagOnly = anItem({ anchor_tag_after: "h2" });
  assert.deepEqual(historyEntry(tagOnly, "T"), { rev: 1, after: "new wording", after_html: null, at: "T", anchor_tag_after: "h2" });
});

test("bumpRev returns a new record one revision on, and leaves the old one untouched", () => {
  const first = anItem();
  const before = JSON.stringify(first);
  const second = bumpRev(first, { after: "reworded" });
  assert.equal(second.rev, first.rev + 1);
  assert.equal(second.after, "reworded");
  assert.equal(second.id, first.id);
  assert.equal(second.before, first.before);
  assert.ok(Date.parse(second.updated_at) >= Date.parse(first.updated_at));
  assert.equal(JSON.stringify(first), before, "the record passed in is not changed");
  assert.notEqual(second, first);
});

test("bumpRev drops the reviewer's close, even when the changes set it", () => {
  const closed = { ...anItem({ state: STATE.HANDLED }), closed_by: "reviewer" as const, closed_at: "2026-01-01T00:00:00.000Z" };
  const next = bumpRev(closed, {});
  assert.equal("closed_by" in next, false);
  assert.equal("closed_at" in next, false);
  const forced = bumpRev(anItem(), { closed_by: "reviewer", closed_at: "2026-01-01T00:00:00.000Z" });
  assert.equal("closed_by" in forced, false);
  assert.equal("closed_at" in forced, false);
});

test("a record keeps every after it has had, in order, with the revision each was made at", () => {
  const v1 = anItem({ after: "first wording" });
  const v2 = bumpRev(v1, { after: "second wording" });
  const v3 = bumpRev(v2, { after: "third wording" });
  assert.deepEqual(v3.after_history.map((entry) => entry.after), ["first wording", "second wording", "third wording"]);
  assert.deepEqual(v3.after_history.map((entry) => entry.rev), [1, 2, 3]);
  assert.equal(v3.after_history[2]?.at, v3.updated_at);
});

test("a rewording that lands on the same text and markup does not grow the history", () => {
  const v1 = anItem({ after: "same" });
  assert.equal(bumpRev(v1, { after: "same" }).after_history.length, 1);
  const html = anItem({ after: "same", after_html: "<p>same</p>" });
  assert.equal(bumpRev(html, { after: "same", after_html: "<p>same</p>" }).after_history.length, 1);
});

test("two format-only rewordings with the same text and different markup each add an entry", () => {
  const v1 = anItem({ kind: KIND.FORMAT_ONLY, before: "Warm up", after: "Warm up", before_html: "Warm up", after_html: "Warm <strong>up</strong>" });
  const v2 = bumpRev(v1, { after_html: "<strong>Warm</strong> up" });
  const v3 = bumpRev(v2, { after_html: "Warm <em>up</em>" });
  assert.deepEqual(v3.after_history.map((entry) => entry.after_html), ["Warm <strong>up</strong>", "<strong>Warm</strong> up", "Warm <em>up</em>"]);
});

test("a tag-only change of a run, which moves neither words nor markup, still adds an entry", () => {
  const run = anItem({ new_blocks: BLOCKS, anchor_after_html: "A", placement: "after_anchor", after: "A", after_html: "A" });
  const retagged = bumpRev(run, { anchor_tag_after: "h2" });
  assert.equal(retagged.after_history.length, 2);
  assert.equal(retagged.after_history[1]?.anchor_tag_after, "h2");
  assert.equal(bumpRev(retagged, {}).after_history.length, 2, "and the same tag again adds none");
});

test("on a run record every history entry before the last few drops its blocks and markup and keeps its words", () => {
  let item = anItem({ new_blocks: [{ tag: "p", html: "First" }], anchor_after_html: "Anchor", placement: "after_anchor", after: "Anchor", after_html: "Anchor" });
  for (let i = 0; i < 5; i += 1) {
    const blocks = [...(item.new_blocks ?? []), { tag: "p", html: "More words " + String(i) }];
    item = bumpRev(item, { new_blocks: blocks, after_html: "Anchor<p>x" + String(i) + "</p>", after: "Anchor\n\nx" + String(i) });
  }
  const history = item.after_history;
  assert.equal(history.length, 6);
  for (const entry of history.slice(0, history.length - RUN_HISTORY_KEEP)) {
    assert.equal("new_blocks" in entry, false, "rev " + String(entry.rev));
    assert.equal(entry.after_html, null, "rev " + String(entry.rev));
    assert.equal(typeof entry.after, "string");
  }
  for (const entry of history.slice(history.length - RUN_HISTORY_KEEP)) {
    assert.ok(Array.isArray(entry.new_blocks), "rev " + String(entry.rev));
    assert.equal(typeof entry.after_html, "string");
  }
});

test("a record that is not a run record keeps its history whole", () => {
  let item = anItem();
  for (let i = 0; i < 5; i += 1) item = bumpRev(item, { after: "Wording " + String(i), after_html: "Wording " + String(i) });
  assert.equal(item.after_history.length, 6);
  assert.equal(item.after_history[1]?.after_html, "Wording 0");
});

test("priorAfters is what branch three compares against: not the current after, not the before", () => {
  const v1 = anItem({ before: "the original", after: "first wording" });
  const v3 = bumpRev(bumpRev(v1, { after: "second wording" }), { after: "third wording" });
  const priors = priorAfters(v3);
  assert.deepEqual(priors, ["first wording", "second wording"]);
  assert.equal(priors.includes(v3.after ?? ""), false);
  assert.equal(priors.includes(v3.before ?? ""), false);
});

test("priorAfters lists each earlier value once, in history order, and can read the markup instead", () => {
  const history: HistoryEntry[] = [
    { rev: 1, after: "a", after_html: "<p>a</p>", at: "1" },
    { rev: 2, after: "b", after_html: "<p>b</p>", at: "2" },
    { rev: 3, after: "a", after_html: null, at: "3" },
    { rev: 4, after: "c", after_html: "<p>c</p>", at: "4" }
  ];
  const item = anItem({ after: "c", after_html: "<p>c</p>", after_history: history });
  assert.deepEqual(priorAfters(item), ["a", "b"]);
  assert.deepEqual(priorAfters(item, FIELD.AFTER), ["a", "b"]);
  assert.deepEqual(priorAfters(item, FIELD.AFTER_HTML), ["<p>a</p>", "<p>b</p>"]);
});

test("a format-only record compares on structure and every other kind on text", () => {
  assert.equal(comparisonMode(anItem({ kind: KIND.FORMAT_ONLY })), "structure");
  for (const kind of [KIND.EDIT, KIND.COMMENT, KIND.DELETE, KIND.NOTE, KIND.CHOICE]) assert.equal(comparisonMode({ kind }), "text", kind);
});

test("a format-only record's before and after are its markup, and every other kind's are its text", () => {
  assert.deepEqual(comparisonFields({ kind: KIND.FORMAT_ONLY }), { before: "before_html", after: "after_html" });
  assert.deepEqual(comparisonFields({ kind: KIND.EDIT }), { before: "before", after: "after" });
  assert.deepEqual(comparisonFields({ kind: KIND.DELETE }), { before: "before", after: "after" });
});

test("a choice record built with a region reference and nothing else keeps its press through a reword", () => {
  const item = aChoice({ region: { ...emptyRegion(), ref: choiceRef("lesson-css-counter") } });
  assert.equal(bumpRev(item, { choice: choicePress("lesson-css-counter", "defer") }).rev, 2);
});
