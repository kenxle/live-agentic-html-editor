// Fix round F3, projection side (free writing, reviews_impl/FIX_ROUND.md):
// a block's text is its words, the anchor's own change is not cut mid-tag,
// "Use the fixes" ends proofreading and review.json carries the fixes, and the
// export reads the menu's names from gestures.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const format = require("../../src/shared/review_format.js");
const record = require("../../src/shared/record.js");
const gestures = require("../../src/shared/gestures.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const fx = () => createFixtures({ seed: "f3p" });

function project(items, extra) {
  const json = format.projectReview(Object.assign({ id: "rev_f3", items: items }, extra || {}));
  const out = [];
  json.pages.forEach((p) => p.items.forEach((it) => out.push(it)));
  return out;
}

function longRun() {
  const words = [];
  for (let i = 0; i < 200; i += 1) words.push("w" + i);
  return fx().runItem({ new_blocks: [{ tag: "p", html: words.join(" ") + " teh end" }, { tag: "p", html: "A second block" }] });
}

function asked(item, suggestions) {
  const q = Object.assign({}, item);
  q.reply = {
    status: record.REPLY_STATUS.QUESTION,
    agent: "agent",
    reason: null,
    text: "I placed your words as written. One fix you may want.",
    files: [],
    at: "2026-09-29T10:00:00.000Z",
    proofread: true,
    suggestions: suggestions
  };
  return q;
}

// What tab_done's answerOnto builds from the fixed revision.
function useFixes(q) {
  const fixed = record.applySuggestions(q, q.reply.suggestions);
  const next = Object.assign({}, fixed);
  next.thread = record.chronologicalThread(q).concat([record.completedRound(q)]);
  next.note = "Use the fixes you listed. Change nothing else.";
  next.state = record.STATE.READY;
  next.reply = null;
  return next;
}

// --- CL 7: text is the words ------------------------------------------------

test("a projected block's text resolves entities, so it holds the words as typed", () => {
  const item = fx().runItem({ new_blocks: [{ tag: "p", html: "a &lt; b &amp; c" }] });
  const it = project([item])[0];
  assert.equal(it.new_blocks[0].html, "a &lt; b &amp; c");
  assert.equal(it.new_blocks[0].text, "a < b & c");
});

test("a proofread fix quoting the words as text shows them applies", () => {
  const item = fx().runItem({ new_blocks: [{ tag: "p", html: "fish &amp; chips tonight" }] });
  const text = project([item])[0].new_blocks[0].text;
  const from = text.slice(0, text.indexOf(" tonight"));
  const got = record.applySuggestions(item, [{ block: 0, from: from, to: "fish and chips" }]);
  assert.equal(got.code, undefined);
  assert.equal(got.new_blocks[0].html, "fish and chips tonight");
});

// --- CL 17: anchor_after_html is not cut -----------------------------------

test("a run's anchor_after_html over 2000 characters is projected whole", () => {
  const items = [];
  for (let i = 0; i < 200; i += 1) items.push("<li>item number " + i + "</li>");
  const html = items.join("");
  assert.ok(html.length > format.BEFORE_MAX);
  const run = fx().runItem({ before: "x", before_html: "<li>x</li>", anchor_after_html: html, new_blocks: [{ tag: "p", html: "After the list" }] });
  const it = project([run])[0];
  assert.equal(it.anchor_after_html, html);
});

// --- ADV 4 / design call 6: proofreading ends, and the fixes are carried ----

test("a long run proofreads at its first rev", () => {
  assert.equal(project([longRun()])[0].proofread, true);
});

test("the revision Use the fixes makes is not proofread again", () => {
  const q = asked(longRun(), [{ block: 0, from: "teh", to: "the" }]);
  const next = useFixes(q);
  assert.equal(next.rev, q.rev + 1);
  const it = project([next])[0];
  assert.equal(it.proofread, false);
  assert.equal(it.change, record.USE_FIXES_CHANGE.replace("{n}", "1"));
});

test("review.json carries the fixes in the thread's last agent turn", () => {
  const q = asked(longRun(), [{ block: 0, from: "teh", to: "the" }]);
  const it = project([useFixes(q)])[0];
  const last = it.thread[it.thread.length - 1].agent;
  assert.equal(last.proofread, true);
  assert.deepEqual(last.suggestions, [{ block: 0, from: "teh", to: "the" }]);
});

test("a plain question in the thread carries no proofread fields", () => {
  const item = fx().edit();
  item.reply = { status: "question", agent: "a", reason: null, text: "Which one?", files: [], at: "2026-09-29T10:00:00.000Z" };
  const next = record.followUp(item, "The first one.");
  const agent = project([next])[0].thread[0].agent;
  assert.equal(Object.prototype.hasOwnProperty.call(agent, "proofread"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(agent, "suggestions"), false);
});

test("Keep mine also ends proofreading", () => {
  const q = asked(longRun(), [{ block: 0, from: "teh", to: "the" }]);
  const next = record.followUp(q, "Keep mine as written. No changes.");
  assert.equal(project([next])[0].proofread, false);
});

// --- CL 20: one table of block type names -----------------------------------

test("the export names block types with the menu's labels from gestures", () => {
  gestures.BLOCK_TYPES.forEach((t) => assert.equal(gestures.blockTypeLabel(t.tag), t.label));
  assert.equal(gestures.blockTypeLabel("blockquote"), null);
  const item = fx().runItem({ new_blocks: [{ tag: "h3", html: "Sub zqxcanary" }] });
  const text = format.renderText({ id: "rev_f3", items: [item] });
  assert.ok(text.indexOf(gestures.blockTypeLabel("h3") + ": Sub zqxcanary") !== -1, text);
});
