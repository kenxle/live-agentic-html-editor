// The rail comes back from a reload LAHE started, exactly as it was.
//
// Ken clicked a toast, the rail opened on the card, and two seconds later a
// rebuild for a different review reloaded the page. The rail came back in its
// default state and the card he was reading "disappeared out from in front of
// me". The viewport marker already carried the PAGE; this carries the TOOL.
//
// Two files meet here, and each is tested for its own half: sync.js writes and
// consumes the marker, overlay.js says what the rail was showing and puts it
// back.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const sync = require("../../src/layer/sync.js");
const overlay = require("../../src/layer/overlay.js");
const storeModule = require("../../src/layer/store.js");

const HREF = "http://127.0.0.1:8000/report.html";

function memoryStorage() {
  const values = Object.create(null);
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
    removeItem: (key) => {
      delete values[key];
    }
  };
}

function fakeWindow(options) {
  const opts = options || {};
  return {
    location: { href: opts.href || HREF, hash: "" },
    sessionStorage: opts.storage || memoryStorage(),
    performance: { getEntriesByType: () => [{ type: opts.navigationType || "reload" }] }
  };
}

const STATE = { collapsed: false, tab: "done", scroll: 240, focused: "c_7fa2" };

// --- the marker ---------------------------------------------------------------

test("the rail marker is its own key, beside the viewport one and never inside it", () => {
  const win = fakeWindow();
  assert.equal(sync.saveRailForReload(win, "review-1", STATE), true);

  assert.notEqual(sync.RAIL_MARKER_KEY, sync.VIEWPORT_MARKER_KEY);
  assert.equal(win.sessionStorage.getItem(sync.VIEWPORT_MARKER_KEY), null, "the viewport marker is untouched");
  assert.deepEqual(JSON.parse(win.sessionStorage.getItem(sync.RAIL_MARKER_KEY)), {
    version: sync.RAIL_MARKER_VERSION,
    exactHref: HREF,
    review: "review-1",
    collapsed: false,
    tab: "done",
    scroll: 240,
    focused: "c_7fa2"
  });
});

test("the marker is consumed once, and the second boot gets nothing", () => {
  const win = fakeWindow();
  sync.saveRailForReload(win, "review-1", STATE);

  assert.deepEqual(sync.restoreRailAfterReload(win, "review-1"), STATE);
  assert.equal(win.sessionStorage.getItem(sync.RAIL_MARKER_KEY), null, "read is removal");
  assert.equal(sync.restoreRailAfterReload(win, "review-1"), null);
});

test("a marker from another page, another review, or a back/forward is not applied", () => {
  const other = fakeWindow();
  sync.saveRailForReload(other, "review-1", STATE);
  assert.equal(
    sync.restoreRailAfterReload(fakeWindow({ storage: other.sessionStorage, href: HREF + "?x=1" }), "review-1"),
    null,
    "a different page is a different rail"
  );

  const wrongReview = fakeWindow();
  sync.saveRailForReload(wrongReview, "review-1", STATE);
  assert.equal(sync.restoreRailAfterReload(wrongReview, "review-2"), null);

  const back = fakeWindow();
  sync.saveRailForReload(back, "review-1", STATE);
  const backNav = fakeWindow({ storage: back.sessionStorage, navigationType: "back_forward" });
  assert.equal(sync.restoreRailAfterReload(backNav, "review-1"), null, "the browser owns back and forward");
});

test("nothing to say and nowhere to say it are both quiet failures, never thrown", () => {
  assert.equal(sync.saveRailForReload(fakeWindow(), "review-1", null), false);
  assert.equal(sync.saveRailForReload(null, "review-1", STATE), false);
  assert.equal(sync.restoreRailAfterReload(fakeWindow(), "review-1"), null, "no marker, no opinion");

  const broken = fakeWindow();
  broken.sessionStorage.setItem(sync.RAIL_MARKER_KEY, "{not json");
  assert.equal(sync.restoreRailAfterReload(broken, "review-1"), null);
});

// --- what the rail says about itself ------------------------------------------

test("a headless rail still reports its own state, and takes it back", () => {
  const store = storeModule.createStore({ storage: null });
  const rail = overlay.createRail({ store: store, reviewId: "review-1" });

  rail.collapse(true);
  assert.deepEqual(rail.railState(), { collapsed: true, tab: "active", scroll: 0, focused: null });

  // The state a toast leaves behind: open, on Done.
  rail.applyRailState({ collapsed: false, tab: "done", scroll: 0, focused: null });
  assert.equal(rail.isCollapsed(), false);
  assert.equal(rail.currentTab(), "done");
});

test("restoring is not a new preference: what the reviewer chose is left alone", () => {
  const store = storeModule.createStore({ storage: null });
  const rail = overlay.createRail({ store: store, reviewId: "review-1" });

  // The reviewer's own choice: keep the rail closed.
  rail.collapse(true);
  const chosen = store.readUiPreferences("review-1").collapsed;
  assert.equal(chosen, true);

  // A toast opened it, and the reload puts it back open. That is restoring what
  // was on screen, not the reviewer deciding they now like the rail open.
  rail.applyRailState({ collapsed: false, tab: "active", scroll: 0, focused: null });
  assert.equal(rail.isCollapsed(), false, "on screen, it is open");
  assert.equal(store.readUiPreferences("review-1").collapsed, true, "and their standing choice is untouched");
});

test("an unknown tab or a card that is gone is ignored rather than obeyed", () => {
  const store = storeModule.createStore({ storage: null });
  const rail = overlay.createRail({ store: store, reviewId: "review-1" });

  const applied = rail.applyRailState({ collapsed: false, tab: "nonsense", scroll: -5, focused: "c_gone" });
  assert.equal(applied.tab, null);
  assert.equal(applied.focused, null);
  assert.equal(rail.currentTab(), "active", "the rail is still on a tab that exists");
});
