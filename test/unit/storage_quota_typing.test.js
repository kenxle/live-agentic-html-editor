// A full browser storage stops being a thrown exception in a keystroke handler.
//
// The 2026-09-16 memory audit, finding 1: with the helper down the outbox grows
// one entry per keystroke until browser storage hits its quota, and store.js's
// writeJson then throws out of the input handler. Whatever the reviewer was
// typing into stops taking keystrokes, and the only sign is a console error.
//
// The rule now: a quota failure during typing keeps the words on screen, raises
// the failure through the rail's own failure list, and does not come back out
// of the handler. EVERY OTHER ERROR IS STILL LOUD.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const failures = require("../../src/shared/failures.js");
const storeModule = require("../../src/layer/store.js");
const commentsModule = require("../../src/layer/comments.js");
const record = require("../../src/shared/record.js");

const PAGE = { origin: "http://127.0.0.1:4000", path: "/plan", title: "Plan", seq: 1, source_hint: null };

// A backing that accepts writes until it is told to be full. Every read still
// works, which is what a real quota does: the bytes already stored are fine.
function fullBacking() {
  const values = Object.create(null);
  const state = { full: false };
  return {
    state: state,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
    setItem: (key, value) => {
      if (state.full) {
        const err = new Error("The quota has been exceeded.");
        err.name = "QuotaExceededError";
        throw err;
      }
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

function quotaError() {
  const backing = fullBacking();
  backing.state.full = true;
  const store = storeModule.createStore({ backing: backing });
  try {
    store.writeChips("review-x", { chips: [], dismissed: [] });
  } catch (err) {
    return err;
  }
  throw new Error("the store did not refuse a write into a full backing");
}

// ---------------------------------------------------------------------------
// The one question, and the one wrapper
// ---------------------------------------------------------------------------

test("a store write refused for want of room is recognisable as exactly that", () => {
  const err = quotaError();
  assert.equal(failures.isStorageQuota(err), true);
  assert.equal(err.failure.code, "STORAGE_QUOTA");

  assert.equal(failures.isStorageQuota(new Error("something else")), false);
  assert.equal(failures.isStorageQuota(null), false);
  // A failure object that is not a quota failure is not one either.
  const other = new Error("refused");
  other.failure = failures.failure("SYNC_UNAUTHORIZED", null);
  assert.equal(failures.isStorageQuota(other), false);
});

test("a quota failure is reported and not rethrown; anything else is still loud", () => {
  const raised = [];
  const err = quotaError();

  const got = failures.tolerateStorageQuota(
    () => {
      throw err;
    },
    (failure) => raised.push(failure)
  );
  assert.equal(got.code, "STORAGE_QUOTA");
  assert.equal(raised.length, 1);
  assert.equal(raised[0].code, "STORAGE_QUOTA");

  // The success path reports nothing and returns nothing.
  let ran = 0;
  assert.equal(
    failures.tolerateStorageQuota(
      () => {
        ran += 1;
      },
      () => raised.push("never")
    ),
    null
  );
  assert.equal(ran, 1);
  assert.equal(raised.length, 1);

  // Not a quota failure: straight back out. Swallowing these is how a real bug
  // becomes a silent one.
  assert.throws(
    () =>
      failures.tolerateStorageQuota(
        () => {
          throw new Error("a genuine bug");
        },
        () => raised.push("never")
      ),
    /a genuine bug/
  );
});

test("reporting a full storage into a full storage does not take the keystroke down", () => {
  // The rail writes its chip list to the SAME browser storage that just refused
  // the write being reported. Without this the report throws where the write
  // used to, and nothing has been gained.
  const err = quotaError();
  const got = failures.tolerateStorageQuota(
    () => {
      throw err;
    },
    () => {
      throw quotaError();
    }
  );
  assert.equal(got.code, "STORAGE_QUOTA");

  // A report that fails for any OTHER reason is still a bug and still loud.
  assert.throws(
    () =>
      failures.tolerateStorageQuota(
        () => {
          throw err;
        },
        () => {
          throw new Error("the rail is broken");
        }
      ),
    /the rail is broken/
  );
});

// ---------------------------------------------------------------------------
// The comment keystroke path, end to end
// ---------------------------------------------------------------------------

test("typing into a comment when storage is full keeps the words and raises one failure", () => {
  const backing = fullBacking();
  const store = storeModule.createStore({ backing: backing });
  const raised = [];
  const comments = commentsModule.createComments({
    store: store,
    reviewId: "review-quota",
    document: null,
    page: PAGE,
    onFailure: (failure) => raised.push(failure)
  });

  const box = comments.openBox({ quote: "Warm up for ten minutes." });
  box.type("make this fif");
  assert.equal(raised.length, 0, "nothing is wrong yet");

  backing.state.full = true;
  // THE KEYSTROKE DOES NOT THROW. This is the whole fix: the reviewer keeps
  // typing, and the tool says what it could not do instead of stopping.
  const next = box.type("make this fifteen");
  assert.equal(next.note, "make this fifteen", "the record the box is holding carries the keystroke");
  assert.equal(raised.length, 1);
  assert.equal(raised[0].code, "STORAGE_QUOTA");
  assert.equal(raised[0].surface, failures.SURFACE.FAILURES_LIST, "the rail's failure list is where it lands");

  // Storage still holds the last wording it had room for, so nothing that WAS
  // durable has been lost.
  assert.equal(store.readItem("review-quota", next.id).note, "make this fif");

  // Every refused keystroke says so. The rail dedupes by code (overlay.js
  // failures.add), so this only has to be honest, not quiet.
  box.type("make this fifteen minutes");
  assert.equal(raised.length, 2);
  assert.equal(raised[1].code, "STORAGE_QUOTA");

  // AND THE REVIEWER HAS NOT LOST THE WORDS. Room comes back, the next
  // keystroke writes, and what lands is everything they typed while it was
  // full, because the box has been typing into its own record throughout.
  backing.state.full = false;
  box.type("make this fifteen minutes.");
  assert.equal(store.readItem("review-quota", next.id).note, "make this fifteen minutes.");
});

test("a comment surface with nowhere to report a failure still does not throw", () => {
  // onFailure is optional: boot wires it, and the browser tests that build a
  // surface by hand do not.
  const backing = fullBacking();
  const store = storeModule.createStore({ backing: backing });
  const comments = commentsModule.createComments({
    store: store,
    reviewId: "review-quiet",
    document: null,
    page: PAGE
  });
  const box = comments.openBox({ quote: "q" });
  box.type("one");
  backing.state.full = true;
  assert.equal(box.type("one more").note, "one more");
});

test("a comment write that fails for any other reason is still loud", () => {
  const store = storeModule.createStore();
  const comments = commentsModule.createComments({
    store: store,
    reviewId: "review-loud",
    document: null,
    page: PAGE
  });
  const box = comments.openBox({ quote: "q" });
  box.type("one");
  store.write = () => {
    throw new Error("the store is broken");
  };
  assert.throws(() => box.type("two"), /the store is broken/);
});

// ---------------------------------------------------------------------------
// The rail's own chip list
// ---------------------------------------------------------------------------

test("the rail can still paint a chip when the storage it remembers chips in is full", () => {
  const overlay = require("../../src/layer/overlay.js");
  const backing = fullBacking();
  const store = storeModule.createStore({ backing: backing });
  const rail = overlay.createRail({ document: null, store: store, reviewId: "review-chips" });

  backing.state.full = true;
  const chip = rail.failures.add(failures.failure("STORAGE_QUOTA", "no room"));
  assert.ok(chip, "the chip is added");
  assert.deepEqual(
    rail.failures.list().map((entry) => entry.code),
    ["STORAGE_QUOTA"],
    "and it is on the rail, even though it could not be written down for the next reload"
  );
});

// A record shape sanity check, so the harness above cannot drift from the real
// one without the suite saying so.
test("the comment records this drives are real records", () => {
  const store = storeModule.createStore({ backing: fullBacking() });
  const comments = commentsModule.createComments({
    store: store,
    reviewId: "review-shape",
    document: null,
    page: PAGE
  });
  const item = comments.openBox({ quote: "q" }).type("a note");
  assert.doesNotThrow(() => record.validateItem(item));
});
