// The conflict toast: telling a reviewer their edit is safe on a card.
//
// Ken asked the agent for a new module in his article and kept writing in the
// same spot while it worked. When he committed, the page reloaded onto the
// agent's version, replay's fourth branch flagged a collision and wrote nothing,
// and his paragraphs vanished from the page. They were safe on the conflict card,
// but nothing said so. This file asserts the decision layer: when a toast goes
// up, what it says, that it goes up once per conflict (not once per replay pass,
// and not again after a reload), that several collisions share one toast, and
// that it waits while the tool is hidden for presenting.
//
// The rail is a real overlay with no document, the same shape reply_toast.test.js
// uses: every call is real and nothing is drawn.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const storeModule = require("../../src/layer/store.js");
const overlay = require("../../src/layer/overlay.js");
const conflictToast = require("../../src/layer/conflict_toast.js");

const REVIEW = "conflict-toast-review";

/** Plain sessionStorage stand-in. One per browser tab; a reload keeps it. */
function memoryStorage() {
  const data = Object.create(null);
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    }
  };
}

/**
 * One page life: a rail, and the conflict toasts wired to a fake replay.
 * `world` is what replay would say: which records are flagged, and each
 * record's current rev.
 */
function page(world, storage, options) {
  const opts = options || {};
  const store = storeModule.createStore({ storage: null });
  const rail = overlay.createRail({ store: store, reviewId: REVIEW });
  rail.collapse(true);
  const toasts = conflictToast.createConflictToasts({
    rail: rail,
    reviewId: REVIEW,
    storage: storage,
    conflictIds: () => world.flagged.slice(),
    itemById: (id) => (id in world.revs ? { id: id, kind: "edit", rev: world.revs[id] } : null),
    isHidden: () => world.hidden === true
  });
  if (opts.silent !== true) toasts.sync();
  return { rail, toasts };
}

function shown(rail) {
  return rail.toastInfo().toasts;
}

test("one new conflict raises one sticky toast with the agreed words", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const { rail } = page(world, memoryStorage());
  const list = shown(rail);
  assert.equal(list.length, 1);
  assert.equal(list[0].text, "Your edit clashed with a change to the page");
  assert.equal(list[0].about, "Nothing is lost. Both versions are on the card. Click to choose which to keep.");
  assert.equal(list[0].sticky, true, "it does not time out: this is when a reviewer thinks their work is gone");
  assert.equal(list[0].armed, false);
});

test("no conflicts, no toast", () => {
  const { rail } = page({ flagged: [], revs: {} }, memoryStorage());
  assert.equal(shown(rail).length, 0);
});

test("a repaint that re-finds the same conflict does not raise a second toast", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const { rail, toasts } = page(world, memoryStorage());
  toasts.sync();
  toasts.sync();
  assert.equal(shown(rail).length, 1);
});

test("swiping it away is final for that conflict, however many passes follow", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const { rail, toasts } = page(world, memoryStorage());
  rail.dismissToast(shown(rail)[0].id, overlay.TOAST_GONE.USER);
  toasts.sync();
  assert.equal(shown(rail).length, 0);
});

test("a reload with the conflict open and the toast untouched raises it again, once", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const storage = memoryStorage();
  const first = page(world, storage);
  assert.equal(shown(first.rail).length, 1);
  // The agent may still be writing, so a second reload is likely too.
  const second = page(world, storage);
  second.toasts.sync();
  assert.equal(shown(second.rail).length, 1, "raised but never dealt with: it comes back");
  const third = page(world, storage);
  third.toasts.sync();
  third.toasts.sync();
  assert.equal(shown(third.rail).length, 1, "one toast, not one per reload or pass");
});

test("a reload after the toast was swiped raises nothing", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const storage = memoryStorage();
  const first = page(world, storage);
  first.rail.dismissToast(shown(first.rail)[0].id, overlay.TOAST_GONE.USER);
  const second = page(world, storage);
  assert.equal(shown(second.rail).length, 0, "the reviewer dealt with it");
});

test("a reload after the toast was pressed raises nothing", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const storage = memoryStorage();
  const first = page(world, storage);
  first.rail.openToast(shown(first.rail)[0].id);
  const second = page(world, storage);
  assert.equal(shown(second.rail).length, 0);
});

test("after a reload, two open conflicts not dealt with come back as one count toast", () => {
  const world = { flagged: ["a", "b"], revs: { a: 1, b: 1 } };
  const storage = memoryStorage();
  page(world, storage);
  const second = page(world, storage);
  const list = shown(second.rail);
  assert.equal(list.length, 1);
  assert.equal(list[0].text, "2 of your edits clashed with changes to the page");
});

test("a count toast replaced by a newer count is not dealt with: a reload still shows it", () => {
  const world = { flagged: ["a"], revs: { a: 1, b: 1 } };
  const storage = memoryStorage();
  const first = page(world, storage);
  world.flagged = ["a", "b"];
  first.toasts.sync();
  const second = page(world, storage);
  assert.equal(shown(second.rail).length, 1);
});

test("the same record conflicting at a NEW rev is a new conflict", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const storage = memoryStorage();
  page(world, storage);
  world.revs.a = 2;
  const later = page(world, storage);
  assert.equal(shown(later.rail).length, 1);
});

test("two conflicts at once are one toast that names the count", () => {
  const world = { flagged: ["a", "b"], revs: { a: 1, b: 3 } };
  const { rail } = page(world, memoryStorage());
  const list = shown(rail);
  assert.equal(list.length, 1);
  assert.equal(list[0].text, "2 of your edits clashed with changes to the page");
});

test("a second conflict arriving while the first stands becomes one count toast", () => {
  const world = { flagged: ["a"], revs: { a: 1, b: 1 } };
  const { rail, toasts } = page(world, memoryStorage());
  world.flagged = ["a", "b"];
  toasts.sync();
  const list = shown(rail);
  assert.equal(list.length, 1, "replaced, not stacked");
  assert.equal(list[0].text, "2 of your edits clashed with changes to the page");
});

test("the count wording", () => {
  assert.equal(conflictToast.titleFor(1), "Your edit clashed with a change to the page");
  assert.equal(conflictToast.titleFor(3), "3 of your edits clashed with changes to the page");
});

test("resolving the conflict takes the toast away", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const { rail, toasts } = page(world, memoryStorage());
  world.flagged = [];
  toasts.resolved("a");
  assert.equal(shown(rail).length, 0);
});

test("with two standing, resolving one keeps the toast; resolving both removes it", () => {
  const world = { flagged: ["a", "b"], revs: { a: 1, b: 1 } };
  const { rail, toasts } = page(world, memoryStorage());
  world.flagged = ["b"];
  toasts.resolved("a");
  assert.equal(shown(rail).length, 1);
  world.flagged = [];
  toasts.resolved("b");
  assert.equal(shown(rail).length, 0);
});

test("a conflict that was resolved and comes back at the same rev is told again", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const storage = memoryStorage();
  const { rail, toasts } = page(world, storage);
  world.flagged = [];
  toasts.resolved("a");
  world.flagged = ["a"];
  toasts.sync();
  assert.equal(shown(rail).length, 1);
});

test("hidden for presenting: held, not spent, and shown on return", () => {
  const world = { flagged: ["a"], revs: { a: 1 }, hidden: true };
  const { rail, toasts } = page(world, memoryStorage());
  assert.equal(shown(rail).length, 0, "nothing over the slides");
  world.hidden = false;
  toasts.sync();
  assert.equal(shown(rail).length, 1, "waiting for them when they come back");
});

test("pressing it opens the rail on the Edits tab", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const { rail } = page(world, memoryStorage());
  rail.selectTab("active");
  rail.openToast(shown(rail)[0].id);
  assert.equal(rail.isCollapsed(), false);
  assert.equal(rail.currentTab(), "edits");
  assert.equal(shown(rail).length, 0, "the toast has done its job");
});

test("no storage still stops repeats within the page", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const { rail, toasts } = page(world, null);
  rail.dismissToast(shown(rail)[0].id, overlay.TOAST_GONE.USER);
  toasts.sync();
  assert.equal(shown(rail).length, 0);
});

test("a standing conflict that replay clears by itself is forgotten, so the same clash is told again", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const { rail, toasts } = page(world, memoryStorage());
  assert.equal(shown(rail).length, 1);
  // Replay cleared it (or another tab resolved it): no resolve call here.
  world.flagged = [];
  toasts.sync();
  assert.equal(shown(rail).length, 0);
  world.flagged = ["a"];
  toasts.sync();
  assert.equal(shown(rail).length, 1, "the same record and rev clashing later is news");
});

test("a swiped conflict that another tab resolves is forgotten too", () => {
  const world = { flagged: ["a"], revs: { a: 1 } };
  const storage = memoryStorage();
  const { rail, toasts } = page(world, storage);
  rail.dismissToast(shown(rail)[0].id, overlay.TOAST_GONE.USER);
  world.flagged = [];
  toasts.sync();
  world.flagged = ["a"];
  toasts.sync();
  assert.equal(shown(rail).length, 1);
  assert.deepEqual(toasts.info().dealt, [], "nothing left marked dealt with");
});
