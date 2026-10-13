// Folding a card, and folding a round of a thread, headless.
//
// Ken, 2026-09-15: "I'm scrolling through comments a lot now. We should make
// individual comments in a thread collapsible, so I can close them down to a
// single line when I'm doing a lot of chatting across lots of different things."
//
// Three rules live here because all three are pure, and a rule that can be
// argued about without a browser should be:
//
//   THE FOLDED LINE   what a one-line card says it is about, per kind, cut at a
//                     word
//   THE ROUND RULE    which rounds of a thread start open
//   THE PREFERENCE    a fold survives a reload, per review and per card id
//
// What folding LOOKS like, and the reading rule it changes, are asserted in a
// real browser: test/browser/card_collapse.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const storeModule = require("../../src/layer/store.js");
const overlay = require("../../src/layer/overlay.js");
const tabDone = require("../../src/layer/tab_done.js");
const record = require("../../src/shared/record.js");

const REVIEW = "fold-review";

function memoryBacking(seed) {
  const values = Object.assign(Object.create(null), seed || {});
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
    removeItem: (key) => {
      delete values[key];
    },
    key: (index) => Object.keys(values)[index] || null,
    get length() {
      return Object.keys(values).length;
    }
  };
}

function itemOf(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "shorten this heading",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/"
      },
      overrides || {}
    )
  );
}

// --- the folded line ---------------------------------------------------------

test("a folded card says what it is about, and which words those are depends on the kind", () => {
  // A COMMENT points at a passage, so the passage is what the reviewer is
  // scanning for. Their own note is what they already know they wrote.
  assert.equal(
    overlay.collapsedLineText(
      itemOf({ kind: record.KIND.COMMENT, note: "cut this", context: { quote: "The lede runs long" } })
    ),
    "The lede runs long"
  );

  // AN EDIT is the change said in words. The before-and-after is the detail,
  // and detail is exactly what folding puts away.
  assert.equal(
    overlay.collapsedLineText(
      itemOf({
        kind: record.KIND.EDIT,
        change: "made the heading sentence case",
        context: { quote: "Our Mission Statement" },
        before: "Our Mission Statement",
        after: "Our mission statement"
      })
    ),
    "made the heading sentence case"
  );

  // A PAGE NOTE is tethered to nothing, so there is no quote to stand in for it.
  assert.equal(
    overlay.collapsedLineText(itemOf({ kind: record.KIND.NOTE, note: "the whole page needs a pass" })),
    "the whole page needs a pass"
  );
});

test("a card with nothing in its usual place falls through rather than showing a blank line", () => {
  // A blank line is a card the reviewer cannot tell from the one above it.
  assert.equal(
    overlay.collapsedLineText(itemOf({ kind: record.KIND.COMMENT, note: "no quote came with this one" })),
    "no quote came with this one"
  );
  assert.equal(
    overlay.collapsedLineText(
      itemOf({ kind: record.KIND.EDIT, change: "", context: { quote: "the passage that was edited" } })
    ),
    "the passage that was edited"
  );
});

test("the folded line is cut at a word, never mid-word", () => {
  // "cut this to one senten" reads as something having gone wrong, and the
  // reviewer stops to work out what.
  const long = "The quick brown fox jumps over the lazy dog and then keeps running";
  const cut = overlay.collapsedLineText(itemOf({ context: { quote: long } }));

  assert.ok(cut.endsWith("…"), "it says there is more: " + cut);
  assert.ok(cut.length <= overlay.COLLAPSED_LINE_MAX + 1, "it fits the line: " + cut);
  const words = cut.slice(0, -1).split(" ");
  assert.ok(long.split(" ").includes(words[words.length - 1]), "the last word is a whole word: " + cut);

  // Nothing is cut that already fits, and no ellipsis is added to it.
  assert.equal(overlay.collapsedLineText(itemOf({ context: { quote: "short enough" } })), "short enough");

  // Newlines and runs of spaces collapse: a folded card is one row.
  assert.equal(
    overlay.collapsedLineText(itemOf({ context: { quote: "two\n\nlines   and   spaces" } })),
    "two lines and spaces"
  );

  // One word longer than the whole line still has to end somewhere.
  const oneWord = "x".repeat(120);
  const cutWord = overlay.collapsedLineText(itemOf({ context: { quote: oneWord } }));
  assert.equal(cutWord, "x".repeat(overlay.COLLAPSED_LINE_MAX) + "…");
});

// --- which rounds of a thread start open -------------------------------------

test("the newest round is open, older ones fold once a thread is worth scrolling", () => {
  const round = (status) => ({ reviewer: { note: "a note" }, agent: { status: status || "handled" } });

  // Two rounds is not a scroll, so folding one of them hides a turn to save a
  // line. Both stay open.
  assert.equal(tabDone.roundStartsExpanded(round(), 0, 2), true);
  assert.equal(tabDone.roundStartsExpanded(round(), 1, 2), true);

  // Three is. The newest is what the reviewer came back for; the rest fold.
  assert.equal(tabDone.roundStartsExpanded(round(), 0, 3), false);
  assert.equal(tabDone.roundStartsExpanded(round(), 1, 3), false);
  assert.equal(tabDone.roundStartsExpanded(round(), 2, 3), true);

  // A single round is the newest round.
  assert.equal(tabDone.roundStartsExpanded(round(), 0, 1), true);
});

test("a round that needs an answer is never folded away by a rule about length", () => {
  // A question needs answering and a refusal needs its reason read. Neither is
  // something a count of rounds gets to hide.
  const asking = { reviewer: { note: "a note" }, agent: { status: record.REPLY_STATUS.QUESTION } };
  const refused = { reviewer: { note: "a note" }, agent: { status: record.REPLY_STATUS.NOT_HANDLED } };

  assert.equal(tabDone.roundStartsExpanded(asking, 0, 6), true);
  assert.equal(tabDone.roundStartsExpanded(refused, 0, 6), true);
  assert.equal(tabDone.roundStartsExpanded({ reviewer: { note: "a note" }, agent: {} }, 0, 6), false);
});

test("a long thread folds its older rounds behind one line, and only a leading run of them", () => {
  const round = (status) => ({ reviewer: { note: "a note" }, agent: { status: status || "handled" } });

  // Nothing to fold on a short thread.
  assert.equal(tabDone.foldedRoundCount([]), 0);
  assert.equal(tabDone.foldedRoundCount([round()]), 0);
  assert.equal(tabDone.foldedRoundCount([round(), round()]), 0);

  // Three or more: everything but the newest goes behind the one line.
  assert.equal(tabDone.foldedRoundCount([round(), round(), round()]), 2);
  assert.equal(tabDone.foldedRoundCount([round(), round(), round(), round(), round()]), 4);

  // A round that needs an answer stays on the card, and so does everything
  // after it, so the line holds one unbroken stretch of the oldest past.
  const asking = round(record.REPLY_STATUS.QUESTION);
  assert.equal(tabDone.foldedRoundCount([round(), asking, round(), round()]), 1);
  assert.equal(tabDone.foldedRoundCount([asking, round(), round()]), 0);
});

test("a turn's caption says just the time for today and the date as well for older days", () => {
  const now = new Date(2026, 9, 12, 15, 0, 0);
  const today = new Date(2026, 9, 12, 11, 38, 0).toISOString();
  const older = new Date(2026, 9, 10, 11, 38, 0).toISOString();
  const short = overlay.captionTimeLabel(today, now);
  assert.ok(short.length > 0);
  assert.ok(!/Oct/.test(short), "no date on today's caption: " + short);
  assert.equal(overlay.captionTimeLabel(older, now), overlay.timestampLabel(older));
  assert.equal(overlay.captionTimeLabel(null, now), "");
  assert.equal(overlay.captionTimeLabel("not a time", now), "");
});

// --- the preference ----------------------------------------------------------

test("a folded card is remembered per review and per card id, and only the folded ones are written", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });

  const first = itemOf();
  const second = itemOf({ note: "and this one" });
  rail.upsertCard(first);
  rail.upsertCard(second);

  assert.equal(rail.isCardCollapsed(first.id), false, "a card starts open");
  rail.setCardCollapsed(first.id, true);

  // Only the folded one is in the bucket: an open card is the default, so
  // writing `false` for it would grow this map by one per card ever opened.
  const written = JSON.parse(backing.getItem(storeModule.UI_PREFIX + REVIEW));
  assert.deepEqual(written.cards, { [first.id]: true });
  assert.equal(written.collapsed, false, "the RAIL's own collapse is a different fact");

  const reloaded = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  assert.equal(reloaded.isCardCollapsed(first.id), true, "the fold survives a reload");
  assert.equal(reloaded.isCardCollapsed(second.id), false, "and the card beside it is still open");

  // Another review keeps its own list.
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: "other-review" }).isCardCollapsed(first.id),
    false
  );

  rail.setCardCollapsed(first.id, false);
  assert.deepEqual(JSON.parse(backing.getItem(storeModule.UI_PREFIX + REVIEW)).cards, {});
});

test("folding a card does not forget the rail's width, its corner, or that it was collapsed", () => {
  // The bucket is written whole. Writing one field and omitting the others is
  // how a reviewer folds one card and finds the rail back at its default width.
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });

  rail.setWidth(520);
  rail.collapse(true);
  const item = itemOf();
  rail.upsertCard(item);
  rail.setCardCollapsed(item.id, true);

  const kept = store.readUiPreferences(REVIEW);
  assert.equal(kept.width, 520);
  assert.equal(kept.collapsed, true);
  assert.deepEqual(kept.cards, { [item.id]: true });
});

test("a cards map that is not a map is no map at all", () => {
  // Browser storage is editable by anyone with devtools open, and by an earlier
  // version of this file. A shape that cannot be trusted leaves every card open,
  // which is the safe direction to fail in.
  const store = storeModule.createStore({ backing: memoryBacking() });

  [["c_1"], "c_1", 7, null, { c_1: "yes" }, { c_1: false }].forEach((cards, index) => {
    store.writeUiPreferences("review-junk", { collapsed: false, cards: cards });
    assert.deepEqual(store.readUiPreferences("review-junk").cards, {}, "rejected " + index);
  });
});

test("Collapse all and Expand all act on one tab, not on the whole rail", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });

  const comment = itemOf();
  const edit = itemOf({
    kind: record.KIND.EDIT,
    change: "sentence case",
    before: "Our Mission",
    after: "Our mission"
  });
  const handled = itemOf({ state: record.STATE.HANDLED, note: "already done" });
  rail.upsertCard(comment);
  rail.upsertCard(edit);
  rail.upsertCard(handled);
  assert.equal(rail.paneForItem(comment), overlay.TAB.ACTIVE);
  assert.equal(rail.paneForItem(edit), overlay.TAB.ACTIVE, "a hand edit is a card in Active");
  assert.equal(rail.paneForItem(handled), overlay.TAB.DONE);

  rail.setCardsCollapsed(overlay.TAB.ACTIVE, true);
  assert.equal(rail.isCardCollapsed(comment.id), true);
  assert.equal(rail.isCardCollapsed(edit.id), true, "the hand edit folds with its tab");
  assert.equal(rail.isCardCollapsed(handled.id), false, "the other tab is left alone");

  rail.setCardsCollapsed(overlay.TAB.DONE, true);
  assert.deepEqual(rail.collapsedCardIds().sort(), [comment.id, edit.id, handled.id].sort());

  rail.setCardsCollapsed(overlay.TAB.ACTIVE, false);
  assert.deepEqual(rail.collapsedCardIds(), [handled.id]);
});

test("a folded card is not a card anyone has read", () => {
  // The one thing folding changes about reading state. Arriving on the tab a
  // folded card sits in says nothing about the words on it, because they are off
  // the screen. Opening it is what marks it read.
  const store = storeModule.createStore({ backing: memoryBacking() });
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  const done = tabDone.createDoneTab({ store: store, reviewId: REVIEW, overlay: rail, document: null });
  done.mount();

  const item = itemOf();
  item[record.FIELD.REPLY] = {
    status: record.REPLY_STATUS.HANDLED,
    agent: "claude",
    text: "done, and here is the caveat",
    user_needs_to_see_reply: true,
    at: "2026-09-15T10:00:00.000Z",
    answering_rev: item[record.FIELD.REV]
  };
  store.write(REVIEW, item);
  rail.upsertCard(item);
  rail.setCardCollapsed(item.id, true);
  done.refresh();

  assert.deepEqual(done.unseenIds(), [item.id], "the reply is unread");

  done.markRepliesSeen(rail.paneForItem(item));
  assert.deepEqual(done.unseenIds(), [item.id], "a visit to the tab does not read a folded card");

  rail.setCardCollapsed(item.id, false);
  assert.deepEqual(done.unseenIds(), [], "opening it does");
});
