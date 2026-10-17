// The anchor engine's choice rung (choice buttons, plan Task 2.2, V20).
//
// A press is anchored on its group's name. Exactly one `.choice` group with
// that name binds; none or two refuse, each with its own reason and code, and
// the rung never falls through to the text search. The empty-container rung
// keeps working, and the whole existing anchor suite runs unchanged beside
// this file (test/unit/anchor_engine.test.js, anchor_cases.test.js).
//
// The fake DOM is the anchor suite's five questions and nothing more. It has
// no querySelectorAll on purpose: the rung walks the tree the way every other
// rung does.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchor = require("../../src/layer/anchor.js");
const record = require("../../src/shared/record.js");

function el(tag, opts) {
  const options = opts || {};
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: options.attrs || {},
    children: [],
    parentElement: null,
    ownText: typeof options.text === "string" ? options.text : "",
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    }
  };
  Object.defineProperty(node, "textContent", {
    get: function () {
      if (!this.children.length) return this.ownText;
      return this.children.map((c) => c.textContent).join("");
    }
  });
  Object.defineProperty(node, "nodeType", { value: 1 });
  Object.defineProperty(node, "firstChild", {
    get: function () {
      if (this.children.length) return this.children[0];
      return this.ownText ? { nodeType: 3, data: this.ownText, nextSibling: null } : null;
    }
  });
  Object.defineProperty(node, "nextSibling", {
    get: function () {
      const parent = this.parentElement;
      if (!parent) return null;
      const at = parent.children.indexOf(this);
      return at === -1 ? null : parent.children[at + 1] || null;
    }
  });
  (options.children || []).forEach((child) => append(node, child));
  return node;
}

function append(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

function remove(child) {
  const parent = child.parentElement;
  parent.children.splice(parent.children.indexOf(child), 1);
  child.parentElement = null;
  return child;
}

function group(name, question, values, extraClass) {
  const attrs = { class: "choice" + (extraClass ? " " + extraClass : "") };
  if (name !== null) attrs["data-choice"] = name;
  return el("div", {
    attrs: attrs,
    children: [el("p", { attrs: { class: "choice-q" }, text: question })].concat(
      values.map((v) => el("button", { attrs: { type: "button", value: v }, text: v }))
    )
  });
}

function page(children) {
  return el("body", { children: [el("main", { children: children })] });
}

const REF = record.choiceRef("lesson-css-counter");

test("the fake DOM has no querySelectorAll, so the rung walks the tree", () => {
  const root = page([]);
  assert.equal(typeof root.querySelectorAll, "undefined");
});

test("one group with the name binds, wherever it sits on the page", () => {
  const target = group("lesson-css-counter", "Promote this lesson?", ["promote", "discard"]);
  const root = page([el("h2", { text: "A lesson" }), el("section", { children: [el("div", { children: [target] })] })]);
  const verdict = anchor.resolve(REF, root);
  assert.equal(verdict.bound, true);
  assert.equal(verdict.element, target);
  assert.equal(verdict.via, "choice");
  assert.equal(verdict.failureCode, null);
});

test("a moved group is found in its new place", () => {
  const target = group("lesson-css-counter", "Promote this lesson?", ["promote", "discard"]);
  const top = el("section", { children: [target] });
  const bottom = el("section");
  const root = page([top, el("p", { text: "between" }), bottom]);
  assert.equal(anchor.resolve(REF, root).element, target);
  append(bottom, remove(target));
  assert.equal(anchor.resolve(REF, root).element, target);
});

test("the group's class can sit among others", () => {
  const target = group("lesson-css-counter", "Q?", ["a", "b"], "wide");
  assert.equal(anchor.resolve(REF, page([target])).element, target);
});

test("zero groups refuse with their own reason, and the text search never runs", () => {
  // The question's words ARE on the page, in a paragraph and in another group:
  // a text rung would have bound one of them.
  const root = page([
    el("p", { text: "Promote this lesson?" }),
    group("lesson-other", "Promote this lesson?", ["promote", "discard"])
  ]);
  const ref = Object.assign({}, REF, { probe: "Promote this lesson?" });
  const verdict = anchor.resolve(ref, root);
  assert.equal(verdict.bound, false);
  assert.equal(verdict.element, null);
  assert.equal(verdict.via, "choice");
  assert.equal(verdict.failureCode, "CHOICE_GROUP_GONE");
  assert.equal(verdict.reason, "no group named lesson-css-counter is on this page");
  assert.equal(verdict.considered, 0);
});

test("two groups with the name refuse with their own reason, and neither binds", () => {
  const a = group("lesson-css-counter", "First?", ["a", "b"]);
  const b = group("lesson-css-counter", "Second?", ["a", "b"]);
  const verdict = anchor.resolve(REF, page([a, b]));
  assert.equal(verdict.bound, false);
  assert.equal(verdict.element, null);
  assert.equal(verdict.failureCode, "CHOICE_GROUP_TWICE");
  assert.equal(verdict.reason, "two groups on this page are named lesson-css-counter");
  assert.equal(verdict.considered, 2);
});

test("a record never binds to a group with another name, nor to a name without the class", () => {
  const renamed = group("lesson-css-counter-2", "Promote this lesson?", ["promote", "discard"]);
  const notAGroup = el("div", { attrs: { "data-choice": "lesson-css-counter" }, children: [el("p", { text: "x" })] });
  const verdict = anchor.resolve(REF, page([renamed, notAGroup]));
  assert.equal(verdict.bound, false);
  assert.equal(verdict.failureCode, "CHOICE_GROUP_GONE");
});

test("a ref with a name off the grammar binds nothing, even if a group carries it", () => {
  const odd = group("Has Caps", "Q?", ["a", "b"]);
  const verdict = anchor.resolve(record.choiceRef("Has Caps"), page([odd]));
  assert.equal(verdict.bound, false);
});

test("the empty-container rung is unchanged: a start_of_container ref still binds the page's one main", () => {
  const main = el("main");
  const root = el("body", { children: [main] });
  const ref = { fingerprint: { tag: "main" }, probe: "" };
  const verdict = anchor.resolve(ref, root, { placement: record.PLACEMENT.START_OF_CONTAINER });
  assert.equal(verdict.bound, true);
  assert.equal(verdict.via, "container");
  assert.equal(verdict.element, main);
});

test("an ordinary text ref never meets the choice rung", () => {
  const p = el("p", { text: "A sentence that appears exactly once on this page." });
  const root = page([p, group("lesson-css-counter", "Q?", ["a", "b"])]);
  const ref = anchor.mint({ element: p, root: root });
  const verdict = anchor.resolve(ref, root);
  assert.equal(verdict.bound, true);
  assert.notEqual(verdict.via, "choice");
  assert.equal(verdict.element, p);
});
