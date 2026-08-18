// The remount contract's rules, unit level.
//
// Owner: 2D (living in the page).
//
// What is HERE and what is NOT. The behaviour that matters (a hundred morphs, a
// root that really goes away, a real bfcache signal, a real CSP header) is in
// the browser specs, because none of it is provable without a browser and this
// project's harness rule says so out loud. What is here is the part that is a
// pure decision and would otherwise only ever be checked by inference:
//
//   - the ORDER a remount runs in, and the fact that de-registration comes
//     first. A test that watches a real registry through a fake document can
//     assert "cleared, then re-registered" without a browser, and that is the
//     one line the whole contract rests on.
//   - the group list, which is data. A group missing from it is a group that
//     leaks, and the comments surface registers under a name of its own.
//   - reading the script tag's config, which is a pure function of attributes.
//
// The fake document below is four methods on an object literal. It is NOT a DOM
// stand-in and nothing behavioural is asserted through it: no jsdom, per the
// repo's lint rule, and no pretending a fake page proves a real one.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const inject = require("../../src/layer/inject.js");
const layer = require("../../src/layer/index.js");
const listeners = require("../../src/layer/listeners.js");
const markers = require("../../src/shared/markers.js");
const protocol = require("../../src/shared/protocol.js");
const failures = require("../../src/shared/failures.js");
const protect = require("../../src/layer/protect.js");

function fakeTarget(name) {
  return {
    name: name,
    bound: [],
    addEventListener: function (type, handler, options) {
      this.bound.push({ type: type, handler: handler, options: options });
    },
    removeEventListener: function (type, handler) {
      this.bound = this.bound.filter(function (entry) {
        return !(entry.type === type && entry.handler === handler);
      });
    }
  };
}

function fakeDocument(options) {
  const doc = fakeTarget("document");
  const opts = options || {};
  doc.rootPresent = opts.rootPresent !== false;
  doc.documentElement = fakeTarget("documentElement");
  doc.body = fakeTarget("body");
  doc.getElementById = function (id) {
    if (id !== markers.OVERLAY_ROOT_ID) return null;
    return doc.rootPresent ? { id: id } : null;
  };
  return doc;
}

test("the trigger list names all five paths, bfcache included", () => {
  const events = inject.REMOUNT_TRIGGERS.map((t) => t.event);
  // One morph event per framework protect.js knows about, then the four paths
  // that are not a morph at all.
  assert.deepEqual(events, protect.MORPH_EVENTS.concat(["turbo:load", "popstate", "pageshow", "mutation-fallback"]));
  assert.equal(events.includes("turbo:morph"), true);
  const pageshow = inject.REMOUNT_TRIGGERS.filter((t) => t.event === "pageshow")[0];
  assert.match(pageshow.why, /back\/forward cache/);
});

test("the morph events are protect.js's framework vocabulary, not a second list", () => {
  assert.deepEqual(inject.MORPH_EVENTS, protect.MORPH_EVENTS);
  // One page-level morph event for every framework whose per-element pre-morph
  // event the protection layers already listen for.
  assert.equal(inject.MORPH_EVENTS.length, protect.FRAMEWORKS.length);
  assert.equal(
    protect.FRAMEWORKS.every((f) => typeof f.morphEvent === "string" && f.morphEvent.length > 0),
    true,
    "a framework with a before-morph event and no morph event is a morph the remount never hears"
  );
});

test("de-registration is the first step in the order, and replay is the last", () => {
  assert.match(inject.REMOUNT_ORDER[0], /offGroup/);
  assert.match(inject.REMOUNT_ORDER[inject.REMOUNT_ORDER.length - 1], /replay\.schedule/);
});

test("the cleared groups include the comment surface's own group", () => {
  assert.equal(inject.CLEARED_GROUPS.includes(listeners.GROUP.DOCUMENT), true);
  assert.equal(inject.CLEARED_GROUPS.includes(listeners.GROUP.NAVIGATION), true);
  assert.equal(
    inject.CLEARED_GROUPS.includes(listeners.GROUP.COMMENTS),
    true,
    "comments.js registers under listeners.GROUP.COMMENTS; leaving it out is a leak the registry count would not see"
  );
  assert.equal(
    inject.CLEARED_GROUPS.includes(listeners.GROUP.EDITING),
    true,
    "editing.js registers under listeners.GROUP.EDITING, and an open block's input handlers are in that group"
  );
  // The two surfaces read the same constant this list reads, so a rename cannot
  // leave the remount clearing a group nobody registers under.
  assert.equal(listeners.GROUP.COMMENTS, "comments");
  assert.equal(listeners.GROUP.EDITING, "editing");
});

test("a remount de-registers BEFORE it re-registers, and the count comes back flat", () => {
  const registry = listeners.createRegistry();
  // The root is missing throughout, so every step of the order runs on every
  // remount and the sequence is the whole sequence.
  const doc = fakeDocument({ rootPresent: false });
  const win = fakeTarget("window");
  const order = [];

  const injector = inject.install({
    document: doc,
    window: win,
    registry: registry,
    ensureRoot: function () {
      order.push("ensureRoot");
      return false;
    },
    rebind: function () {
      order.push("rebind");
      registry.on(doc, "keydown", function () {}, true, listeners.GROUP.COMMENTS);
      registry.on(doc, "click", function () {}, true, listeners.GROUP.COMMENTS);
    },
    merge: function () {
      order.push("merge");
    }
  });

  injector.start();
  injector.remount("boot-equivalent");
  const settled = registry.count();
  const settledGroups = registry.groups();

  for (let i = 0; i < 100; i += 1) injector.remount("turbo:morph");

  assert.equal(registry.count(), settled, "one hundred remounts, and the registry is where it started");
  assert.deepEqual(registry.groups(), settledGroups);
  assert.equal(injector.counters.remounts, 101);
  assert.equal(injector.counters.handlersCleared > 0, true, "it really did clear something each time");
  assert.deepEqual(order.slice(0, 3), ["ensureRoot", "rebind", "merge"]);
});

test("the root is only re-created when it is actually gone", () => {
  const registry = listeners.createRegistry();
  const doc = fakeDocument({ rootPresent: true });
  let asked = 0;
  const injector = inject.install({
    document: doc,
    window: fakeTarget("window"),
    registry: registry,
    ensureRoot: function () {
      asked += 1;
      doc.rootPresent = true;
      return true;
    }
  });
  injector.start();

  injector.remount("turbo:morph");
  assert.equal(asked, 0, "the root was there, so nothing was rebuilt");
  assert.equal(injector.counters.rootsRecreated, 0);

  doc.rootPresent = false;
  injector.remount("turbo:morph");
  assert.equal(asked, 1);
  assert.equal(injector.counters.rootsRecreated, 1);
});

test("fresh-load pageshow is ignored, while persisted pageshow remounts once", () => {
  const registry = listeners.createRegistry();
  const doc = fakeDocument({ rootPresent: true });
  const win = fakeTarget("window");
  let merges = 0;
  const injector = inject.install({
    document: doc,
    window: win,
    registry: registry,
    merge: function () {
      merges += 1;
    }
  });
  injector.start();
  const pageshow = win.bound.filter((entry) => entry.type === "pageshow")[0].handler;

  pageshow({ persisted: false });
  assert.equal(injector.counters.remounts, 0, "boot already handled the fresh document");
  assert.equal(merges, 0);

  pageshow({ persisted: true });
  assert.equal(injector.counters.remounts, 1);
  assert.equal(injector.counters.bfcacheRestores, 1);
  assert.equal(merges, 1);
  assert.equal(injector.last().reason, "pageshow-persisted");
});

test("a policy refusal is a different failure from a helper that is down", () => {
  const refused = inject.cspFailure("connect-src blocked http://127.0.0.1:7817");
  const down = failures.failure("HELPER_UNREACHABLE", null);
  assert.equal(refused.code, "CSP_REFUSED");
  assert.notEqual(refused.message, down.message);
  assert.match(refused.message, /content security policy/i);
  assert.match(refused.remedy, /connect-src/);
});

test("boot reads its config from the script tag, and options win over it", () => {
  const attrs = {
    [protocol.SCRIPT_ATTR.REVIEW]: "rev-abc",
    [protocol.SCRIPT_ATTR.TOKEN]: "tok-1",
    [protocol.SCRIPT_ATTR.HELPER]: "http://127.0.0.1:9999"
  };
  const tag = {
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    }
  };
  const doc = { querySelector: () => null };

  const fromTag = layer.readScriptConfig(doc, tag);
  assert.deepEqual(fromTag, {
    review: "rev-abc",
    token: "tok-1",
    helper: "http://127.0.0.1:9999",
    from: "currentScript"
  });

  const merged = layer.resolveConfig(doc, { review: "rev-other" }, tag);
  assert.equal(merged.review, "rev-other");
  assert.equal(merged.token, "tok-1");
});

test("no script tag and no options means no configuration, and the helper default fills in", () => {
  const doc = { querySelector: () => null };
  const empty = layer.readScriptConfig(doc, null);
  assert.deepEqual(empty, { review: null, token: null, helper: null, from: null });
  assert.equal(layer.resolveConfig(doc, {}, null).helper, protocol.DEFAULT_HELPER_ORIGIN);
});

test("the layer no longer refuses a non-loopback origin", () => {
  // The refusal that used to live in index.js broke the file:// case, which is
  // a supported primary one. It is gone, and this is the guard against it
  // coming back in a rewrite.
  assert.equal(typeof layer.isLoopbackOrigin, "undefined");
  const source = require("node:fs").readFileSync(require.resolve("../../src/layer/index.js"), "utf8");
  assert.equal(
    /return \{ booted: false, reason: "the layer refuses to initialize on a non-loopback origin/.test(source),
    false
  );
});
