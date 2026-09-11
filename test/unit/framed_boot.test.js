// The framed decision: a document inside an iframe does not boot.
//
// The bug it stands for is reveal.js's speaker-notes window, which embeds the
// same deck in an iframe. Both copies carried the script tag, both booted, and
// the two fought over the review's window claim. See the frame decision in
// src/layer/index.js.
//
// Pure over a window-shaped object, so the rule is checked here with no
// browser; test/browser/framed_boot.spec.js checks the wiring against a real
// page that frames a real child.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const layer = require("../../src/layer/index.js");
const protocol = require("../../src/shared/protocol.js");

test("a top-level window is not framed and boots", () => {
  const win = {};
  win.top = win;
  assert.deepEqual(layer.frameDecision(win, null), { framed: false, skip: false, reason: null });
  assert.equal(layer.isFramed(win), false);
});

test("a window whose top is another window is framed, and does not boot", () => {
  const decision = layer.frameDecision({ top: { name: "the notes window" } }, null);
  assert.equal(decision.framed, true);
  assert.equal(decision.skip, true);
  assert.equal(decision.reason, layer.SKIPPED_FRAMED);
});

test("a top nobody is allowed to read is itself the answer: we are framed", () => {
  // Reading window.top across origins throws, and only a framed document has a
  // top it cannot read.
  const win = {
    get top() {
      throw new Error("Blocked a frame with origin ... from accessing a cross-origin frame.");
    }
  };
  assert.equal(layer.isFramed(win), true);
  assert.equal(layer.frameDecision(win, null).skip, true);
});

test("a window with no top at all is not treated as framed", () => {
  // Nothing in a browser looks like this. A caller handing boot a stub is what
  // does, and a stub with no answer must not read as "framed".
  assert.equal(layer.isFramed({}), false);
  assert.equal(layer.isFramed(null), false);
});

test("data-lahe-frames=\"allow\" opts a framed document back in", () => {
  const framed = { top: {} };
  assert.deepEqual(layer.frameDecision(framed, protocol.FRAMES_ALLOW), {
    framed: true,
    skip: false,
    reason: null
  });
  assert.equal(layer.frameDecision(framed, "ALLOW").skip, false, "the value is read case-insensitively");
  assert.equal(layer.frameDecision(framed, "yes").skip, true, "and anything else fails to the safe default");
});

test("boot in a frame returns the reason and mounts nothing", () => {
  const win = { top: {} };
  const doc = {
    querySelector: () => null,
    body: {}
  };
  const result = layer.boot({ window: win, document: doc, review: "rev-framed", token: "t" });
  assert.equal(result.booted, false);
  assert.equal(result.skipped, layer.SKIPPED_FRAMED);
  assert.match(result.reason, /inside a frame/);
  assert.match(result.reason, new RegExp(protocol.SCRIPT_ATTR.FRAMES));
  assert.equal(layer.booted(), null, "nothing was wired, so there is no handle");
  assert.equal(layer.skipped, layer.SKIPPED_FRAMED, "and the module says why");
});

test("the frames attribute is read off the script tag", () => {
  const attrs = {
    [protocol.SCRIPT_ATTR.REVIEW]: "rev-abc",
    [protocol.SCRIPT_ATTR.TOKEN]: "tok-1",
    [protocol.SCRIPT_ATTR.FRAMES]: protocol.FRAMES_ALLOW
  };
  const tag = {
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null)
  };
  const config = layer.readScriptConfig({ querySelector: () => null }, tag);
  assert.equal(config.frames, protocol.FRAMES_ALLOW);
  assert.equal(layer.resolveConfig({ querySelector: () => null }, {}, tag).frames, protocol.FRAMES_ALLOW);
});
