// read-when: Changing which page mutations schedule a replay pass, or when a live chart or a page's own style tags make the layer re-run replay too often.

// The page observer's gate (board row LAHE-mousemove-rereads-page-text).
//
// A Plotly chart rewrites its svg on every hover. Each rewrite used to schedule
// a whole replay pass, and a pass re-resolves every saved record against the
// page, so a long page with a few records hung while the reviewer moved the
// mouse. The anchor engine never reads inside an svg, a canvas, a script or a
// style tag (anchor.SKIP_TAGS), so a mutation there changes nothing a text
// anchor can see. It can change one thing: the drawing an element comment on
// that svg was minted from. So such a batch does not schedule a pass now; it
// arms one quiet pass, which runs once the page has stopped changing there,
// and never later than a maximum wait after the first held mutation.
//
// The timing half is the gate on its own with a fake clock. The wiring half is
// replay's own gate, with real timers and condition polls.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const replay = require("../../src/layer/replay.js");
const { pollUntil } = require("../helpers/poll.js");

// --- a few nodes, as a MutationRecord's target sees them ----------------------

function element(tag, parent) {
  return { nodeType: 1, tagName: tag, parentNode: parent || null, parentElement: parent || null };
}

function text(parent) {
  return { nodeType: 3, parentNode: parent, parentElement: parent };
}

function page() {
  const html = element("HTML", null);
  const body = element("BODY", html);
  const main = element("MAIN", body);
  const p = element("P", main);
  const chartWrap = element("DIV", main);
  // An svg's tagName is lowercase in a real browser (it is not an HTML element).
  const svg = element("svg", chartWrap);
  const g = element("g", svg);
  const path = element("path", g);
  const foreign = element("foreignObject", svg);
  const foreignDiv = element("DIV", foreign);
  const canvas = element("CANVAS", main);
  const style = element("STYLE", body);
  const script = element("SCRIPT", body);
  return { html, body, main, p, chartWrap, svg, g, path, foreign, foreignDiv, canvas, style, script };
}

function childList(target) {
  return { type: "childList", target: target };
}

function characterData(target) {
  return { type: "characterData", target: target };
}

// --- which mutations a pass has no use for right away -------------------------

test("a mutation inside an svg, a canvas, a script or a style tag is inert", () => {
  const n = page();
  assert.equal(replay.isInertMutation(childList(n.g)), true, "the hover layer's children inside the svg");
  assert.equal(replay.isInertMutation(childList(n.svg)), true, "the svg's own children");
  assert.equal(replay.isInertMutation(characterData(text(n.path))), true, "a text node inside the svg");
  assert.equal(replay.isInertMutation(childList(n.foreignDiv)), true, "html inside a foreignObject is still inside the svg");
  assert.equal(replay.isInertMutation(childList(n.canvas)), true, "a canvas's fallback content");
  assert.equal(replay.isInertMutation(characterData(text(n.style))), true, "a CSS-in-JS rule written into a style tag");
  assert.equal(replay.isInertMutation(childList(n.script)), true, "a framework's data script");
});

test("a mutation outside every skipped tag is not inert, including the one that adds or removes the svg", () => {
  const n = page();
  assert.equal(replay.isInertMutation(characterData(text(n.p))), false, "a paragraph's text");
  assert.equal(replay.isInertMutation(childList(n.p)), false, "a paragraph's children");
  assert.equal(
    replay.isInertMutation(childList(n.chartWrap)),
    false,
    "the svg itself added or replaced: its parent is the target, and the region an element comment is bound to may be gone"
  );
  assert.equal(replay.isInertMutation(childList(n.body)), false, "the body");
  assert.equal(replay.isInertMutation(null), false, "no record");
  assert.equal(replay.isInertMutation({ type: "childList", target: null }), false, "no target");
});

test("a batch is inert only when every record in it is", () => {
  const n = page();
  assert.equal(replay.isInertBatch([childList(n.g), characterData(text(n.path))]), true);
  assert.equal(replay.isInertBatch([childList(n.g), characterData(text(n.p))]), false, "one real text change outside");
  assert.equal(replay.isInertBatch([]), false, "an empty batch keeps the old behaviour: a pass");
  assert.equal(replay.isInertBatch(undefined), false, "an observer that hands over nothing keeps the old behaviour");
});

// --- the gate's timing, on a fake clock ---------------------------------------

function fakeClock() {
  const clock = { now: 0, timers: [], nextId: 1 };
  clock.setTimeout = function (fn, ms) {
    const id = clock.nextId++;
    clock.timers.push({ id: id, at: clock.now + ms, fn: fn });
    return id;
  };
  clock.clearTimeout = function (id) {
    clock.timers = clock.timers.filter((t) => t.id !== id);
  };
  clock.advance = function (ms) {
    const until = clock.now + ms;
    for (;;) {
      clock.timers.sort((a, b) => a.at - b.at);
      const due = clock.timers[0];
      if (!due || due.at > until) break;
      clock.timers.shift();
      clock.now = due.at;
      due.fn();
    }
    clock.now = until;
  };
  return clock;
}

function gateOn(clock, scheduled) {
  return replay.createMutationGate({
    schedule: function () {
      scheduled.push(clock.now);
      return true;
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: function () {
      return clock.now;
    },
    quietMs: 250,
    maxWaitMs: 2000
  });
}

test("a burst of redraws inside the svg schedules one pass, after the svg goes quiet", () => {
  const n = page();
  const clock = fakeClock();
  const scheduled = [];
  const gate = gateOn(clock, scheduled);

  // Thirty hover frames, about one every 16 ms.
  for (let i = 0; i < 30; i += 1) {
    assert.equal(gate.note([childList(n.g)]), false, "an inert batch does not schedule now");
    clock.advance(16);
  }
  assert.deepEqual(scheduled, [], "no pass while the hovering goes on");
  assert.equal(gate.pending(), true, "one quiet pass is armed");

  clock.advance(250);
  assert.equal(scheduled.length, 1, "exactly one pass once the svg went quiet");
  assert.equal(gate.pending(), false);
});

test("a mutation outside the svg schedules at once, even in the middle of a burst", () => {
  const n = page();
  const clock = fakeClock();
  const scheduled = [];
  const gate = gateOn(clock, scheduled);

  gate.note([childList(n.g)]);
  clock.advance(16);
  assert.equal(gate.note([childList(n.g), characterData(text(n.p))]), true, "a mixed batch is scheduled");
  assert.deepEqual(scheduled, [16], "at once, not after the quiet window");
});

test("a chart that never stops redrawing still gets a pass by the maximum wait", () => {
  const n = page();
  const clock = fakeClock();
  const scheduled = [];
  const gate = gateOn(clock, scheduled);

  for (let i = 0; i < 300; i += 1) {
    gate.note([childList(n.g)]);
    clock.advance(20);
  }
  // 300 batches over six seconds of continuous redrawing: a pass every two
  // seconds of it, never one per redraw.
  assert.deepEqual(scheduled, [2000, 4000, 6000]);
});

test("cancel drops the armed pass: a pass that ran read the page after those mutations", () => {
  const n = page();
  const clock = fakeClock();
  const scheduled = [];
  const gate = gateOn(clock, scheduled);

  gate.note([childList(n.g)]);
  gate.cancel();
  assert.equal(gate.pending(), false);
  clock.advance(5000);
  assert.deepEqual(scheduled, [], "nothing ran for a mutation the pass already covered");

  // And the maximum wait starts again from the next held mutation.
  clock.advance(1000);
  gate.note([childList(n.g)]);
  clock.advance(249);
  assert.deepEqual(scheduled, []);
  clock.advance(1);
  assert.deepEqual(scheduled, [6250]);
});

// --- replay's own gate --------------------------------------------------------

function withPasses(run) {
  const reasons = [];
  replay.configure({
    root: null,
    items: [],
    cards: null,
    document: null,
    hooks: {
      update_rail: function (ctx, summary) {
        reasons.push(summary.reason);
      }
    }
  });
  return Promise.resolve()
    .then(() => run(reasons))
    .finally(() => replay.configure({ items: null, hooks: null }));
}

test("replay.noteMutations: an inert batch runs one quiet pass later, a real change runs one now", async () => {
  const n = page();
  await withPasses(async (reasons) => {
    assert.equal(replay.noteMutations([childList(n.g)]), false, "held, not scheduled");
    assert.equal(replay.quietPassPending(), true);
    await pollUntil(() => reasons.length === 1, { message: "the quiet pass" });
    assert.deepEqual(reasons, [replay.REASON.MUTATION], "it runs as an ordinary mutation pass");
    assert.equal(replay.quietPassPending(), false);

    assert.equal(replay.noteMutations([characterData(text(n.p))]), true, "a real text change is scheduled");
    await pollUntil(() => reasons.length === 2, { message: "the mutation pass" });
  });
});

test("replay.noteMutations: any pass that runs first takes the held quiet pass with it", async () => {
  const n = page();
  await withPasses(async (reasons) => {
    replay.noteMutations([childList(n.g)]);
    assert.equal(replay.quietPassPending(), true);
    replay.runPass(replay.REASON.MANUAL);
    assert.equal(replay.quietPassPending(), false, "the pass read the page after the held mutation");
    assert.deepEqual(reasons, [replay.REASON.MANUAL]);
  });
});
