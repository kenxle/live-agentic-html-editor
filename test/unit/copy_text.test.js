// The shared copy function (stable addresses, Task 4.2, the unit half of V44).
//
// The browser half is library_address.spec.js, which removes the clipboard API
// from a real page and clicks the Library's Copy button. Here a stand-in
// document records what the function does, including that the field fallback
// runs inside the click and not in a later turn.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const copyText = require("../../src/layer/copy_text.js");

function fakeDocument(options) {
  const opts = options || {};
  const log = [];
  const doc = {
    log,
    body: {
      children: [],
      appendChild(el) { this.children.push(el); log.push("append"); el.parentNode = this; },
      removeChild(el) { this.children = this.children.filter((c) => c !== el); log.push("remove"); el.parentNode = null; }
    },
    activeElement: { focus() { log.push("refocus"); } },
    createElement(tag) {
      assert.equal(tag, "textarea");
      const attrs = {};
      return {
        value: "",
        style: {},
        parentNode: null,
        setAttribute(k, v) { attrs[k] = v; },
        attrs,
        focus() { log.push("focus"); },
        select() { log.push("select"); },
        setSelectionRange(a, b) { log.push("range " + a + "-" + b); }
      };
    },
    execCommand(name) {
      log.push("exec " + name + " of " + JSON.stringify(doc.body.children.map((c) => c.value)));
      if (opts.throws) throw new Error("not allowed");
      return opts.result === undefined ? true : opts.result;
    }
  };
  return doc;
}

test("with the clipboard API, the text goes through it and no field is made", async () => {
  const written = [];
  const doc = fakeDocument();
  const ok = await copyText("hello", { navigator: { clipboard: { writeText: (t) => { written.push(t); return Promise.resolve(); } } }, document: doc });
  assert.equal(ok, true);
  assert.deepEqual(written, ["hello"]);
  assert.deepEqual(doc.log, []);
});

test("without the clipboard API, the text is copied through a hidden field, and the field is gone after", async () => {
  const doc = fakeDocument();
  const pending = copyText("the hand-off message", { navigator: {}, document: doc });
  // Synchronously: Safari runs the copy command only inside the click.
  assert.ok(doc.log.some((l) => l.indexOf("exec copy") === 0), "the copy command ran before any await");
  assert.equal(await pending, true);
  assert.deepEqual(doc.log, [
    "append", "focus", "select", "range 0-20",
    'exec copy of ["the hand-off message"]',
    "remove", "refocus"
  ]);
  assert.equal(doc.body.children.length, 0);
});

test("the hidden field is out of the way: read-only, off screen, not announced", async () => {
  const doc = fakeDocument();
  let made = null;
  const create = doc.createElement;
  doc.createElement = (tag) => { made = create(tag); return made; };
  await copyText("x", { navigator: undefined, document: doc });
  assert.equal(made.attrs.readonly, "");
  assert.equal(made.attrs["aria-hidden"], "true");
  assert.equal(made.style.position, "fixed");
  assert.equal(made.style.opacity, "0");
});

test("when the API refuses, the field still tries", async () => {
  const doc = fakeDocument();
  const ok = await copyText("again", {
    navigator: { clipboard: { writeText: () => Promise.reject(new Error("denied")) } },
    document: doc
  });
  assert.equal(ok, true);
  assert.ok(doc.log.some((l) => l.indexOf("exec copy") === 0));
});

test("when the API throws at once, the field still tries", async () => {
  const doc = fakeDocument();
  const ok = await copyText("again", {
    navigator: { clipboard: { writeText: () => { throw new Error("no"); } } },
    document: doc
  });
  assert.equal(ok, true);
});

test("when the copy command says no or throws, the answer is false and the field is still removed", async () => {
  for (const options of [{ result: false }, { throws: true }]) {
    const doc = fakeDocument(options);
    assert.equal(await copyText("nope", { navigator: {}, document: doc }), false, JSON.stringify(options));
    assert.equal(doc.body.children.length, 0);
  }
});

test("with no document and no API there is nothing to copy with, and the answer is false", async () => {
  assert.equal(await copyText("x", { navigator: {}, document: null }), false);
});
