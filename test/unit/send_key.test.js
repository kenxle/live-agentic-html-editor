// read-when: Changing which key sends a comment, or where that setting is kept.
//
// The send key is a setting of the reviewer's, not of a review: one key in
// browser storage, shared by every review on the page's address.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const storeModule = require("../../src/layer/store.js");

function memoryBacking() {
  const values = Object.create(null);
  return {
    values,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null),
    setItem: (k, v) => {
      values[k] = String(v);
    },
    removeItem: (k) => {
      delete values[k];
    }
  };
}

test("the send key is Enter until the reviewer chooses otherwise", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  assert.equal(store.readSendKey(), "enter");
});

test("choosing Cmd-Enter is remembered, and choosing Enter again puts it back", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing });
  assert.equal(store.writeSendKey("mod_enter"), "mod_enter");
  assert.equal(storeModule.createStore({ backing }).readSendKey(), "mod_enter", "a new page load reads it back");
  assert.equal(store.writeSendKey("enter"), "enter");
  assert.equal(store.readSendKey(), "enter");
});

test("the setting is one key for every review, not one per review", () => {
  const backing = memoryBacking();
  storeModule.createStore({ backing }).writeSendKey("mod_enter");
  const keys = Object.keys(backing.values);
  assert.deepEqual(keys, ["lahe.sendkey.v1"]);
});

test("a stored value it does not know reads as Enter, and so does storage that throws", () => {
  const backing = memoryBacking();
  backing.setItem("lahe.sendkey.v1", "shift_enter");
  assert.equal(storeModule.createStore({ backing }).readSendKey(), "enter");
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {}
  };
  const store = storeModule.createStore({ backing: broken });
  assert.equal(store.readSendKey(), "enter");
  assert.equal(store.writeSendKey("mod_enter"), "mod_enter", "a refused write still answers with the choice");
});
