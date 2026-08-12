// Protection's vocabulary and its two predicates, without a browser.
//
// Owner: 2B. The browser spec (test/browser/protection_layers.spec.js) is the
// bar for the three layers; this is the cheap guard on the two things that are
// pure logic and expensive to diagnose from a caret failure:
//
//   1. The veto checks BOTH directions. isProtected answers "is el the block or
//      inside it"; a frame-level morph fires its cancelable event on an element
//      that CONTAINS the block. A veto written against isProtected alone never
//      fires there, layer two silently does nothing, and the only symptom is a
//      lost caret three fixtures away.
//   2. The attribute and event vocabulary is in one table, and it covers every
//      engine the tests run against. A skip attribute the page's framework has
//      never heard of is inert, which is why marking with all of them is safe
//      and guessing which one to use is not.
//
// No jsdom (the project bans it, and rightly). The elements here are the two
// methods the predicates actually call.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protect = require("../../src/layer/protect.js");
const markers = require("../../src/shared/markers.js");

/** The smallest thing that answers contains() and carries attributes. */
function fakeElement(attributes) {
  const attrs = Object.assign({}, attributes || {});
  const el = {
    children: [],
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    removeAttribute: (name) => {
      delete attrs[name];
    },
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
    attributes: attrs,
    contains(other) {
      if (other === el) return true;
      return el.children.some((child) => child.contains(other));
    }
  };
  return el;
}

test.afterEach(() => {
  protect.release(protect.protectedElement());
  protect.resetCounters();
});

test("the veto fires on an element that CONTAINS the protected block", () => {
  const block = fakeElement({ "data-region": "live-note" });
  const frame = fakeElement({ id: "live-frame" });
  frame.children.push(block);

  protect.mark(block, { reason: "edit_block" });

  assert.equal(protect.isProtected(frame), false, "the frame is not inside the block, so isProtected says no");
  assert.equal(protect.touches(frame), true, "and the veto still has to fire, because morphing the frame destroys the block");

  const event = { preventDefault: () => (event.defaultPrevented = true), defaultPrevented: false };
  assert.equal(protect.veto(frame, event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(protect.counters.vetoes, 1);
});

test("the veto fires on the block itself and on a node inside it", () => {
  const inner = fakeElement({});
  const block = fakeElement({ "data-region": "live-note" });
  block.children.push(inner);
  protect.mark(block, { reason: "edit_block" });

  assert.equal(protect.veto(block, null), true);
  assert.equal(protect.veto(inner, null), true);
  assert.equal(protect.counters.vetoes, 2);
});

test("the veto does not fire on an unrelated element", () => {
  const block = fakeElement({ "data-region": "live-note" });
  const elsewhere = fakeElement({ "data-region": "sidebar-note" });
  protect.mark(block, { reason: "edit_block" });

  assert.equal(protect.touches(elsewhere), false);
  assert.equal(protect.veto(elsewhere, null), false);
  assert.equal(protect.counters.vetoes, 0);
});

test("region identity prefers an attribute the page's own markup carries", () => {
  const authored = fakeElement({ [markers.AUTHOR_REGION_ATTR]: "intro" });
  assert.deepEqual(protect.regionKeyFor(authored), {
    attribute: markers.AUTHOR_REGION_ATTR,
    value: "intro",
    selector: "[" + markers.AUTHOR_REGION_ATTR + '="intro"]',
    minted: false
  });

  const byId = fakeElement({ id: "feed-coach-note" });
  assert.equal(protect.regionKeyFor(byId).attribute, "id");
  assert.equal(protect.regionKeyFor(byId).selector, '[id="feed-coach-note"]');

  // Nothing stable to hold: minted, and it SAYS it is minted, because a minted
  // attribute does not come back when a repaint rebuilds the element from the
  // server's HTML and layer three has to report that honestly.
  const anonymous = fakeElement({});
  const minted = protect.regionKeyFor(anonymous);
  assert.equal(minted.minted, true);
  assert.equal(minted.attribute, protect.MINTED_REGION_ATTRIBUTE);
  assert.equal(anonymous.getAttribute(protect.MINTED_REGION_ATTRIBUTE), minted.value);
});

test("marking writes every framework's skip attribute, plus the library's own marker", () => {
  const block = fakeElement({ "data-region": "live-note" });
  protect.mark(block, { reason: "edit_block" });

  protect.SKIP_ATTRIBUTES.forEach((name) => {
    assert.equal(block.getAttribute(name), "", "layer one should have written " + name);
  });
  assert.equal(block.hasAttribute(protect.PROTECTED_ATTRIBUTE), true);
  assert.equal(protect.counters.marked, 1);

  protect.release(block);
  protect.SKIP_ATTRIBUTES.forEach((name) => {
    assert.equal(block.hasAttribute(name), false, "release should have taken " + name + " back off");
  });
  assert.equal(block.hasAttribute(protect.PROTECTED_ATTRIBUTE), false);
  assert.equal(protect.isProtected(block), false);
});

test("release runs a replay pass immediately, which is the commit seam", () => {
  const replay = require("../../src/layer/replay.js");
  const block = fakeElement({ "data-region": "live-note" });
  protect.mark(block, { reason: "edit_block" });

  const before = replay.counters.passes;
  protect.release(block);
  assert.equal(
    replay.counters.passes,
    before + 1,
    "protection lifting without the pass that follows it is the silent swallow the seam exists to prevent"
  );
});

test("the vocabulary covers both fixture engines and Turbo, from one table", () => {
  const names = protect.FRAMEWORKS.map((f) => f.name);
  assert.deepEqual(names.sort(), ["app_fixture_morph_engine", "harness_repaint_engine", "turbo"]);

  // Read out of the engines rather than repeated here, so a fixture that renames
  // its attribute or its event fails this test instead of a caret assertion.
  const harness = fs.readFileSync(
    path.join(__dirname, "..", "fixtures", "assets", "repaint-engine.js"),
    "utf8"
  );
  const app = fs.readFileSync(
    path.join(__dirname, "..", "fixtures", "app", "assets", "morph-engine.js"),
    "utf8"
  );

  function pin(source, constName) {
    const match = new RegExp("const " + constName + ' = "([^"]+)"').exec(source);
    assert.ok(match, "expected " + constName + " in the engine source");
    return match[1];
  }

  assert.ok(protect.BEFORE_MORPH_EVENTS.includes(pin(harness, "BEFORE_MORPH_ELEMENT")));
  assert.ok(protect.SKIP_ATTRIBUTES.includes(pin(harness, "SKIP_ATTRIBUTE")));
  assert.ok(protect.BEFORE_MORPH_EVENTS.includes(pin(app, "BEFORE_MORPH_EVENT")));
  assert.ok(protect.SKIP_ATTRIBUTES.includes(pin(app, "PERMANENT_ATTRIBUTE")));

  // Turbo's two, which no fixture can pin.
  assert.ok(protect.SKIP_ATTRIBUTES.includes(markers.TURBO_PERMANENT_ATTR));
  assert.ok(protect.BEFORE_MORPH_EVENTS.includes("turbo:before-morph-element"));
});

test("install refuses a layer name it does not know", () => {
  assert.throws(
    () => protect.install({ document: null, layers: ["cooperative_skip", "restore_after"] }),
    /unknown layer/
  );
});
