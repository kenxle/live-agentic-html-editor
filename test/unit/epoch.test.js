// The write-epoch rule: replay's own mutations must not retrigger the observer
// that schedules replay.
//
// The subtle part is the microtask ordering, and it is the part a builder would
// otherwise get wrong by decrementing synchronously.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const epochModule = require("../../src/shared/epoch.js");
const { nextTask } = require("../helpers/poll.js");

test("the epoch is open for the duration of a tool write", () => {
  const e = epochModule.createEpoch();
  assert.equal(e.isWriting(), false);
  e.write("test", () => {
    assert.equal(e.isWriting(), true, "inside the write");
  });
});

test("the depth drops in a MICROTASK, not synchronously", async () => {
  // This is the whole rule. A MutationObserver's callback is a microtask queued
  // at the moment of the first mutation, which happens inside fn. A microtask
  // queued after that point runs after the observer callback, so the observer
  // sees depth > 0 for exactly the batch containing the tool's own writes.
  const e = epochModule.createEpoch();
  let seenByObserver = null;

  e.write("replay", () => {
    // Stands in for the mutation: it queues the observer's notify microtask
    // from inside the write, exactly as the browser does.
    queueMicrotask(() => {
      seenByObserver = e.isWriting();
    });
  });

  assert.equal(e.isWriting(), true, "still open synchronously after write returns");
  await nextTask();
  assert.equal(seenByObserver, true, "the observer must see the epoch open and skip its own batch");
  assert.equal(e.isWriting(), false, "and it must be closed by the next task");
});

test("a mutation after the epoch closes is NOT suppressed", async () => {
  const e = epochModule.createEpoch();
  e.write("replay", () => {});
  await nextTask();
  let seen = null;
  queueMicrotask(() => {
    seen = e.isWriting();
  });
  await nextTask();
  assert.equal(seen, false, "a genuine page repaint after the write must still schedule a pass");
});

test("nested writes keep the epoch open until the outermost one closes", async () => {
  const e = epochModule.createEpoch();
  let innerSeen = null;
  e.write("outer", () => {
    e.write("inner", () => {});
    innerSeen = e.isWriting();
  });
  assert.equal(innerSeen, true);
  assert.equal(e.isWriting(), true);
  await nextTask();
  assert.equal(e.isWriting(), false);
});

test("an exception inside a write does not pin the epoch open forever", async () => {
  const e = epochModule.createEpoch();
  assert.throws(() => {
    e.write("boom", () => {
      throw new Error("boom");
    });
  }, /boom/);
  await nextTask();
  assert.equal(e.isWriting(), false, "otherwise the observer is muted for the rest of the session");
});

test("the epoch number is monotonic, so replay can no-op when nothing moved", () => {
  const e = epochModule.createEpoch();
  const before = e.epoch();
  e.write("a", () => {});
  e.write("b", () => {});
  assert.equal(e.epoch(), before + 2);
});

test("an external mutation seen during a tool write is remembered, not dropped", () => {
  // The page can repaint in the same batch as a tool write. Dropping that
  // silently is how a genuine repaint goes unnoticed.
  const e = epochModule.createEpoch();
  e.noteExternalMutation();
  assert.equal(e.takePendingExternal(), true);
  assert.equal(e.takePendingExternal(), false, "taken once");
});

test("write demands a reason, because the first question every replay bug asks is who scheduled this", () => {
  const e = epochModule.createEpoch();
  assert.throws(() => e.write("", () => {}), /reason must be/);
  assert.throws(() => e.write("ok", null), /fn must be/);
});

test("the layer shares one epoch", () => {
  assert.equal(typeof epochModule.shared.write, "function");
  assert.equal(epochModule.isWriting(), false);
});
