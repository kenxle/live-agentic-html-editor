// Two tabs, and the Active pane's filter, headless.
//
// The rail had three tabs (Active, Edits, Done). Hand edits now sit in Active
// as cards beside the comments, and a filter (All, Comments, Edits) at the top
// of the pane narrows what is shown. These are the pure rules: where a card
// goes, what the filter remembers, and when a jump to a card puts the filter
// back. What the filter LOOKS like, and that it hides the right cards, is a
// browser test: test/browser/active_filter.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const storeModule = require("../../src/layer/store.js");
const overlay = require("../../src/layer/overlay.js");
const record = require("../../src/shared/record.js");

const REVIEW = "filter-review";

function memoryBacking() {
  const values = Object.create(null);
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

function handEdit(kind, overrides) {
  return itemOf(Object.assign({ kind: kind, before: "Our Mission", after: "Our mission" }, overrides || {}));
}

test("the rail has two tabs, Active and Done", () => {
  assert.deepEqual(overlay.TABS, ["active", "done"]);
  assert.equal(overlay.TAB.EDITS, undefined, "nothing names the removed tab");
});

test("a hand edit that is not handled is an Active card; a handled one is Done", () => {
  [record.KIND.EDIT, record.KIND.DELETE, record.KIND.FORMAT_ONLY].forEach((kind) => {
    assert.equal(overlay.paneForItem(handEdit(kind)), overlay.TAB.ACTIVE, kind + " ready");
    assert.equal(overlay.paneForItem(handEdit(kind, { state: record.STATE.DRAFT })), overlay.TAB.ACTIVE, kind + " draft");
    assert.equal(overlay.paneForItem(handEdit(kind, { state: record.STATE.HANDLED })), overlay.TAB.DONE, kind + " handled");
  });
  assert.equal(overlay.paneForItem(itemOf()), overlay.TAB.ACTIVE);
});

test("the filter's Edits are exactly the hand-edit kinds", () => {
  assert.equal(overlay.isHandEditKind(handEdit(record.KIND.EDIT)), true);
  assert.equal(overlay.isHandEditKind(handEdit(record.KIND.DELETE)), true);
  assert.equal(overlay.isHandEditKind(handEdit(record.KIND.FORMAT_ONLY)), true);
  assert.equal(overlay.isHandEditKind(itemOf()), false);
  assert.equal(overlay.isHandEditKind(itemOf({ kind: record.KIND.NOTE })), false);
});

test("an old caller asking for the Edits tab lands on Active instead of throwing", () => {
  const rail = overlay.createRail({ document: null, store: null, reviewId: null });
  rail.selectTab(overlay.TAB.DONE);
  assert.equal(rail.selectTab("edits"), overlay.TAB.ACTIVE);
  assert.equal(rail.currentTab(), overlay.TAB.ACTIVE);
  assert.throws(() => rail.selectTab("nowhere"), /unknown tab/);
});

test("the filter starts on All, is remembered per review, and refuses a name it does not know", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });
  const first = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  assert.equal(first.currentFilter(), overlay.FILTER.ALL);

  assert.equal(first.setActiveFilter(overlay.FILTER.EDITS), "edits");
  assert.equal(store.readUiPreferences(REVIEW).filter, "edits");
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: REVIEW }).currentFilter(),
    "edits",
    "a reload finds the list the reviewer was reading"
  );
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: "another-review" }).currentFilter(),
    "all",
    "another review keeps the default"
  );
  assert.throws(() => first.setActiveFilter("bogus"), /unknown filter/);
  assert.equal(first.currentFilter(), "edits");
});

test("the filter is written with the rest of the bucket, so other preferences survive a pick", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  rail.collapse(true);
  rail.setActiveFilter(overlay.FILTER.COMMENTS);
  const kept = store.readUiPreferences(REVIEW);
  assert.equal(kept.collapsed, true, "picking a filter does not forget the collapse");
  assert.equal(kept.filter, "comments");
  rail.collapse(false);
  assert.equal(store.readUiPreferences(REVIEW).filter, "comments", "and collapsing does not forget the filter");
});

test("a stored filter that is not one of the three reads as All", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });
  backing.setItem(storeModule.UI_PREFIX + REVIEW, JSON.stringify({ filter: "<script>" }));
  assert.equal(store.readUiPreferences(REVIEW).filter, "all");
  assert.equal(store.writeUiPreferences(REVIEW, { filter: 7 }).filter, "all");
});

test("a jump to a card the filter hides puts the filter back to All, and only then", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  const comment = itemOf();
  const edit = handEdit(record.KIND.EDIT);
  const handled = itemOf({ state: record.STATE.HANDLED });
  rail.upsertCard(comment);
  rail.upsertCard(edit);
  rail.upsertCard(handled);

  rail.setActiveFilter(overlay.FILTER.COMMENTS);
  assert.equal(rail.revealCard(comment.id), "comments", "a comment is already shown");
  assert.equal(rail.revealCard(handled.id), "comments", "a Done card is not the filter's business");
  assert.equal(rail.revealCard(edit.id), "all", "the hidden hand edit brings everything back");

  rail.setActiveFilter(overlay.FILTER.EDITS);
  assert.equal(rail.revealCard(edit.id), "edits");
  assert.equal(rail.revealCard(comment.id), "all");
  assert.equal(rail.revealCard("no-such-card"), "all");
});
