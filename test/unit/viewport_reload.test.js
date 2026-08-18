// LAHE's own reload keeps the reviewer's viewport without taking over native
// anchor or back/forward restoration.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const sync = require("../../src/layer/sync.js");

function memoryStorage(initial) {
  const values = Object.assign(Object.create(null), initial || {});
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
  const timeline = [];
  const storage = opts.storage || memoryStorage();
  const pageShowHandlers = [];
  let restoration = opts.restoration || "auto";
  const history = {};
  Object.defineProperty(history, "scrollRestoration", {
    enumerable: true,
    get: () => restoration,
    set: (value) => {
      restoration = value;
      timeline.push("restoration:" + value);
    }
  });
  const win = {
    location: {
      href: opts.href || "http://127.0.0.1:8000/report.html",
      hash: opts.hash || ""
    },
    scrollX: opts.x === undefined ? 31 : opts.x,
    scrollY: opts.y === undefined ? 907 : opts.y,
    sessionStorage: storage,
    history: history,
    document: { readyState: opts.readyState || "loading" },
    performance: {
      getEntriesByType: () => [{ type: opts.navigationType || "reload" }]
    },
    addEventListener: (name, handler) => {
      if (name === "pageshow") pageShowHandlers.push(handler);
    },
    scrollTo: (options) => {
      timeline.push("scroll:" + options.left + "," + options.top + ":" + options.behavior);
      win.scrollX = options.left;
      win.scrollY = options.top;
    }
  };
  return {
    window: win,
    storage: storage,
    timeline: timeline,
    pageShow: () => pageShowHandlers.splice(0).forEach((handler) => handler({ persisted: false }))
  };
}

test("the outgoing marker is versioned, exact to href and review, and switches native restoration off", () => {
  const h = fakeWindow();

  assert.equal(sync.saveViewportForReload(h.window, "review-1"), true);
  assert.deepEqual(JSON.parse(h.storage.getItem(sync.VIEWPORT_MARKER_KEY)), {
    version: sync.VIEWPORT_MARKER_VERSION,
    exactHref: "http://127.0.0.1:8000/report.html",
    review: "review-1",
    x: 31,
    y: 907
  });
  assert.deepEqual(h.timeline, ["restoration:manual"]);
});

test("the incoming reload consumes once, scrolls while manual, then returns to auto", () => {
  const h = fakeWindow();
  sync.saveViewportForReload(h.window, "review-1");
  h.timeline.length = 0;
  h.window.scrollX = 0;
  h.window.scrollY = 0;

  assert.equal(sync.restoreViewportAfterReload(h.window, "review-1"), true);
  assert.deepEqual(h.timeline, ["restoration:manual", "scroll:31,907:instant"]);
  h.pageShow();
  assert.deepEqual(h.timeline, ["restoration:manual", "scroll:31,907:instant", "restoration:auto"]);
  assert.equal(h.storage.getItem(sync.VIEWPORT_MARKER_KEY), null, "the marker was consumed");
  assert.equal(sync.restoreViewportAfterReload(h.window, "review-1"), false, "it cannot restore twice");
});

test("a fragment discards the numeric marker and leaves anchor navigation to the browser", () => {
  const h = fakeWindow();
  sync.saveViewportForReload(h.window, "review-1");
  h.timeline.length = 0;
  h.window.location.href += "#details";
  h.window.location.hash = "#details";

  assert.equal(sync.restoreViewportAfterReload(h.window, "review-1"), false);
  assert.deepEqual(h.timeline, ["restoration:auto"]);
  assert.equal(h.storage.getItem(sync.VIEWPORT_MARKER_KEY), null);
});

test("wrong href, wrong review, and back-forward navigation consume without scrolling", () => {
  [
    { mutate: (h) => (h.window.location.href += "?new=1"), review: "review-1" },
    { mutate: () => {}, review: "review-2" },
    { mutate: () => {}, review: "review-1", navigationType: "back_forward" }
  ].forEach((example) => {
    const h = fakeWindow({ navigationType: example.navigationType });
    sync.saveViewportForReload(h.window, "review-1");
    h.timeline.length = 0;
    example.mutate(h);

    assert.equal(sync.restoreViewportAfterReload(h.window, example.review), false);
    assert.equal(h.timeline.includes("scroll:31,907:instant"), false);
    assert.equal(h.storage.getItem(sync.VIEWPORT_MARKER_KEY), null);
  });
});

test("denied sessionStorage degrades to the browser's native reload", () => {
  const h = fakeWindow({
    storage: {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      }
    }
  });

  assert.doesNotThrow(() => sync.saveViewportForReload(h.window, "review-1"));
  assert.equal(sync.saveViewportForReload(h.window, "review-1"), false);
  assert.equal(sync.restoreViewportAfterReload(h.window, "review-1"), false);
  assert.deepEqual(h.timeline, [], "manual restoration was never enabled without a durable marker");
});
