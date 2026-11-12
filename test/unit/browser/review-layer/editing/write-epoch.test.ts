/*
 * read-when: Changing src/browser/review-layer/editing/write-epoch.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  createEpoch,
  epoch,
  isWriting,
  noteExternalMutation,
  onIdle,
  takePendingExternal,
  write
} from "../../../../../src/browser/review-layer/editing/write-epoch.ts";

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function counter(): { calls: () => number; listener: (...args: readonly unknown[]) => void; args: () => readonly unknown[][] } {
  const seen: unknown[][] = [];
  return {
    calls: () => seen.length,
    listener: (...args: readonly unknown[]) => {
      seen.push([...args]);
    },
    args: () => seen
  };
}

test("a new epoch is not writing, and its number is zero", () => {
  const e = createEpoch();
  assert.equal(e.isWriting(), false);
  assert.equal(e.epoch(), 0);
});

test("the epoch is open for the duration of a tool write", () => {
  const e = createEpoch();
  assert.equal(e.isWriting(), false);
  e.write("test", () => {
    assert.equal(e.isWriting(), true, "inside the write");
  });
});

test("a write runs its function once, synchronously, and returns what it returns", () => {
  const e = createEpoch();
  let runs = 0;
  const got = e.write("test", () => {
    runs += 1;
    return { answer: 42 };
  });
  assert.equal(runs, 1);
  assert.deepEqual(got, { answer: 42 });
});

test("the depth drops in a MICROTASK, not synchronously", async () => {
  const e = createEpoch();
  let seenByObserver: boolean | null = null;

  e.write("replay", () => {
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
  const e = createEpoch();
  e.write("replay", () => {});
  await nextTask();
  let seen: boolean | null = null;
  queueMicrotask(() => {
    seen = e.isWriting();
  });
  await nextTask();
  assert.equal(seen, false, "a genuine page repaint after the write must still schedule a pass");
});

test("nested writes keep the epoch open until the outermost one closes", async () => {
  const e = createEpoch();
  let innerSeen: boolean | null = null;
  e.write("outer", () => {
    e.write("inner", () => {});
    innerSeen = e.isWriting();
  });
  assert.equal(innerSeen, true);
  assert.equal(e.isWriting(), true);
  await nextTask();
  assert.equal(e.isWriting(), false);
});

test("an exception inside a write propagates, and does not pin the epoch open forever", async () => {
  const e = createEpoch();
  const boom = new Error("boom");
  const before = e.epoch();
  assert.throws(
    () => {
      e.write("boom", () => {
        throw boom;
      });
    },
    (err: unknown) => err === boom
  );
  await nextTask();
  assert.equal(e.isWriting(), false, "otherwise the observer is muted for the rest of the session");
  assert.equal(e.epoch(), before + 1, "the failed write still counts");
});

test("the epoch number advances by exactly one per write, so replay can no-op when nothing moved", () => {
  const e = createEpoch();
  const before = e.epoch();
  e.write("a", () => {});
  assert.equal(e.epoch(), before + 1);
  e.write("b", () => {});
  assert.equal(e.epoch(), before + 2);
  assert.equal(e.epoch(), before + 2, "reading it does not move it");
});

test("an external mutation seen during a tool write is remembered once, not dropped", () => {
  const e = createEpoch();
  assert.equal(e.takePendingExternal(), false);
  e.noteExternalMutation();
  assert.equal(e.takePendingExternal(), true);
  assert.equal(e.takePendingExternal(), false, "taken once");
});

test("when a write closes with a mutation owed, every listener is called once, with no arguments", async () => {
  const e = createEpoch();
  const first = counter();
  const second = counter();
  e.onIdle(first.listener);
  e.onIdle(second.listener);

  e.write("replay", () => {
    e.noteExternalMutation();
  });
  assert.equal(first.calls(), 0, "not while the epoch is still open");
  await nextTask();
  assert.equal(first.calls(), 1);
  assert.equal(second.calls(), 1);
  assert.deepEqual(first.args(), [[]]);
});

test("no listener is called when nothing is owed", async () => {
  const e = createEpoch();
  const seen = counter();
  e.onIdle(seen.listener);
  e.write("replay", () => {});
  await nextTask();
  assert.equal(seen.calls(), 0);
});

test("the listener is called when the outermost write closes, whichever caller opened the epoch", async () => {
  const e = createEpoch();
  const seen = counter();
  e.onIdle(seen.listener);
  e.write("editing.enter", () => {
    e.write("replay.inner", () => {
      e.noteExternalMutation();
    });
  });
  await nextTask();
  assert.equal(seen.calls(), 1, "once for the whole nest");
});

test("the owed flag stays set until it is taken", async () => {
  const e = createEpoch();
  e.onIdle(() => {});
  e.write("replay", () => {
    e.noteExternalMutation();
  });
  await nextTask();
  assert.equal(e.takePendingExternal(), true);
  assert.equal(e.takePendingExternal(), false);
});

test("a listener that takes the flag leaves nothing owed, and a later write with nothing owed stays quiet", async () => {
  const e = createEpoch();
  let taken = 0;
  e.onIdle(() => {
    if (e.takePendingExternal()) taken += 1;
  });
  e.write("replay", () => {
    e.noteExternalMutation();
  });
  await nextTask();
  e.write("replay", () => {});
  await nextTask();
  assert.equal(taken, 1);
});

test("a removed listener is not called, and removing it twice is harmless", async () => {
  const e = createEpoch();
  const kept = counter();
  const dropped = counter();
  e.onIdle(kept.listener);
  const remove = e.onIdle(dropped.listener);
  remove();
  remove();
  e.write("replay", () => {
    e.noteExternalMutation();
  });
  await nextTask();
  assert.equal(kept.calls(), 1);
  assert.equal(dropped.calls(), 0);
});

test("write demands a reason, because the first question every replay bug asks is who scheduled this", () => {
  const e = createEpoch();
  let ran = false;
  assert.throws(
    () => {
      e.write("", () => {
        ran = true;
      });
    },
    (err: unknown) => err instanceof TypeError && /reason must be/.test(err.message)
  );
  assert.equal(ran, false, "the function never ran");
  assert.equal(e.isWriting(), false, "and the epoch never opened");
  assert.equal(e.epoch(), 0);
});

test("an epoch made with createEpoch is independent of the page's", async () => {
  const mine = createEpoch();
  const pageBefore = epoch();
  mine.write("test", () => {
    assert.equal(mine.isWriting(), true);
    assert.equal(isWriting(), false, "the page's epoch stays closed");
  });
  await nextTask();
  assert.equal(epoch(), pageBefore);
});

test("the module's functions are one epoch, shared by everyone who imports them", async () => {
  const idle = counter();
  const remove = onIdle(idle.listener);
  const before = epoch();

  const got = write("test", () => {
    assert.equal(isWriting(), true);
    noteExternalMutation();
    return "done";
  });
  assert.equal(got, "done");
  assert.equal(epoch(), before + 1);
  assert.equal(isWriting(), true, "still open until the microtask");
  await nextTask();
  assert.equal(isWriting(), false);
  assert.equal(idle.calls(), 1);
  assert.equal(takePendingExternal(), true);
  assert.equal(takePendingExternal(), false);
  remove();
});

test("the old path hands out the same functions, so old code and the module share the one page epoch", async () => {
  const load = createRequire(import.meta.url);
  const old: unknown = load("../../../../../src/shared/epoch.js");
  assert.ok(typeof old === "object" && old !== null && "write" in old);
  assert.equal(old.write, write);
  assert.equal(Reflect.get(old, "isWriting"), isWriting);
  assert.equal(Reflect.get(old, "onIdle"), onIdle);
  assert.equal(Reflect.get(old, "noteExternalMutation"), noteExternalMutation);
  assert.equal(Reflect.get(old, "takePendingExternal"), takePendingExternal);
  assert.equal(Reflect.has(old, "shared"), false, "the old second surface is gone");
  await nextTask();
});
