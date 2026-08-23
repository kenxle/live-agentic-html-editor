// The revert check: a handled hand edit whose change is gone from the page
// while the text it replaced is back.
//
// Owner: 3C. The browser half is test/browser/edits_tab.spec.js, which reverts a
// real source file, rebuilds, reloads, and asserts the card comes back out of
// Done. This file pins the DECISION, which is a pure function of a record and
// the page's current text, plus the sentence the reopened item carries.
//
// The two halves of the decision are the whole point, so both negatives get
// their own test: after-gone alone is a legitimate rewrite and must not reopen
// anything, and before-back only counts alongside after-gone.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const replay = require("../../src/layer/replay.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "3c-revert" });

const BEFORE = "The trainer writes the plan every week.";
const AFTER = "The trainer writes the plan each week.";

function handledEdit(overrides) {
  const item = fixtures.edit(overrides || {});
  item[record.FIELD.STATE] = record.STATE.HANDLED;
  item[record.FIELD.REPLY] = { status: "handled", agent: "claude", at: "2026-08-19T00:00:00.000Z" };
  return item;
}

function page(passage) {
  return "A heading above it. " + passage + " And a paragraph below it.";
}

test("a handled edit whose after is gone and whose before is back qualifies", () => {
  const item = handledEdit();
  assert.equal(replay.isRevertedHandledEdit(item, page(BEFORE)), true);
});

test("after gone on its own is a rewrite, not a revert, and does not qualify", () => {
  const item = handledEdit();
  const rewritten = page("The coach drafts a new plan for the athlete every Sunday night.");
  assert.equal(replay.isRevertedHandledEdit(item, rewritten), false);
});

test("the edit still standing on the page does not qualify", () => {
  const item = handledEdit();
  assert.equal(replay.isRevertedHandledEdit(item, page(AFTER)), false);
});

test("rewrapping the page is not a revert: the compare ignores whitespace", () => {
  const item = handledEdit();
  const rewrapped = "A heading above it.\n\n   The trainer\n   writes the plan\n   each week.\n";
  assert.equal(replay.isRevertedHandledEdit(item, rewrapped), false);
});

test("whitespace in the source does not hide a real revert either", () => {
  const item = handledEdit();
  const rewrapped = "A heading above it.\n\n   The trainer\n   writes the plan\n   every week.\n";
  assert.equal(replay.isRevertedHandledEdit(item, rewrapped), true);
});

test("a draft or ready edit never qualifies: only a handled one was ever decided", () => {
  const ready = fixtures.edit();
  assert.equal(ready[record.FIELD.STATE], record.STATE.READY);
  assert.equal(replay.isRevertedHandledEdit(ready, page(BEFORE)), false);

  const draft = fixtures.edit({ state: record.STATE.DRAFT });
  assert.equal(replay.isRevertedHandledEdit(draft, page(BEFORE)), false);
});

test("a comment is not a hand edit and never qualifies", () => {
  const comment = fixtures.comment({ state: record.STATE.HANDLED });
  assert.equal(replay.isRevertedHandledEdit(comment, page(BEFORE)), false);
});

test("an item with no before text has nothing to come back, so it never qualifies", () => {
  assert.equal(replay.isRevertedHandledEdit(handledEdit({ before: null }), page(BEFORE)), false);
  assert.equal(replay.isRevertedHandledEdit(handledEdit({ before: "   " }), page(BEFORE)), false);
});

test("an item whose after was never page text never qualifies", () => {
  assert.equal(replay.isRevertedHandledEdit(handledEdit({ after: null }), page(BEFORE)), false);
  assert.equal(replay.isRevertedHandledEdit(handledEdit({ after: "" }), page(BEFORE)), false);
  // A delete carries no after text at all.
  const deleted = fixtures.deletion({ state: record.STATE.HANDLED });
  assert.equal(replay.isRevertedHandledEdit(deleted, page(BEFORE)), false);
});

test("a format-only record cannot qualify: its before and after are the same text", () => {
  const formatted = fixtures.formatOnly({ state: record.STATE.HANDLED });
  assert.equal(formatted[record.FIELD.BEFORE], formatted[record.FIELD.AFTER]);
  assert.equal(replay.isRevertedHandledEdit(formatted, page(formatted[record.FIELD.BEFORE])), false);
});

test("nothing qualifies against an empty page or a missing record", () => {
  assert.equal(replay.isRevertedHandledEdit(handledEdit(), ""), false);
  assert.equal(replay.isRevertedHandledEdit(handledEdit(), null), false);
  assert.equal(replay.isRevertedHandledEdit(null, page(BEFORE)), false);
});

test("the id list picks out only the reverted items", () => {
  const reverted = handledEdit();
  const standing = handledEdit();
  const ready = fixtures.edit();
  const ids = replay.revertedHandledEditIds([reverted, standing, ready], page(BEFORE) + " " + AFTER);
  // Both handled items carry the same before and after text, so the page above
  // holds the after text once, which clears both of them.
  assert.deepEqual(ids, []);

  const onlyBefore = replay.revertedHandledEditIds([reverted, ready], page(BEFORE));
  assert.deepEqual(onlyBefore, [reverted[record.FIELD.ID]]);
});

test("a take-back is not drift: an item another record reverts is left alone", () => {
  // The page looks IDENTICAL in both cases: the reviewer's wording gone, the
  // text it replaced back. The difference is in the log, and it is the whole
  // reason this list function exists rather than the single-item check alone.
  const takenBack = handledEdit();
  const drifted = handledEdit();
  const pageText = page(BEFORE);

  // Nothing says anyone asked, so it is drift and it reopens.
  assert.deepEqual(replay.revertedHandledEditIds([drifted], pageText), [drifted[record.FIELD.ID]]);

  // The reviewer pressed Undo, which mints a record naming what it took back.
  // Reopening now would ask the agent to reapply the exact change the reviewer
  // had just withdrawn, while the revert record beside it asks for the opposite.
  const revert = record.revertOf(takenBack);
  assert.deepEqual(replay.revertedHandledEditIds([takenBack, revert], pageText), []);

  // And the check itself is untouched: it still says what it sees.
  assert.equal(replay.isRevertedHandledEdit(takenBack, pageText), true);

  // One item's take-back does not cover another's drift.
  assert.deepEqual(replay.revertedHandledEditIds([takenBack, revert, drifted], pageText), [
    drifted[record.FIELD.ID]
  ]);
});

test("the note the reopened item carries names the check and asks for the change back", () => {
  assert.equal(
    replay.REVERTED_EDIT_NOTE,
    "Reopened by the page check: this handled change is no longer on the page and the original text is back. " +
      "Reapply it, or reply not_handled saying why."
  );
  // It says whose sentence it is, because the record has no field that could.
  assert.match(replay.REVERTED_EDIT_NOTE, /^Reopened by the page check:/);
  // And it carries no page text: the item already holds the before and after.
  assert.equal(replay.REVERTED_EDIT_NOTE.indexOf(BEFORE), -1);
  assert.equal(replay.REVERTED_EDIT_NOTE.indexOf(AFTER), -1);
});

// ---------------------------------------------------------------------------
// The page text the check reads
// ---------------------------------------------------------------------------

function node(tag, children) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attrs: {},
    firstChild: null,
    nextSibling: null,
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    setAttribute: function (name, value) {
      this.attrs[name] = value;
    },
    className: "",
    append: function (list) {
      let prev = null;
      list.forEach(function (child) {
        if (prev) prev.nextSibling = child;
        prev = child;
      });
      this.firstChild = list[0] || null;
      return this;
    }
  }.append(children || []);
}

function text(value) {
  return { nodeType: 3, nodeValue: value, nextSibling: null };
}

test("the page text leaves the library's own chrome out", () => {
  const markers = require("../../src/shared/markers.js");
  const rail = node("div", [text("Reopen issue " + AFTER)]);
  markers.markChrome(rail);
  const body = node("body", [node("p", [text(BEFORE)]), rail]);

  const pageText = replay.pageTextOf(body);
  assert.equal(pageText, BEFORE);
  // Without the skip, the rail's own copy of the after text would say the edit
  // was still standing.
  const item = handledEdit();
  assert.equal(replay.isRevertedHandledEdit(item, pageText), true);
});

test("the page text joins text nodes the way textContent does", () => {
  const body = node("body", [node("p", [text("Ken"), text(" St. Clair")])]);
  assert.equal(replay.pageTextOf(body), "Ken St. Clair");
  assert.equal(replay.pageTextOf(null), "");
});
