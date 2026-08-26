// Where a comment points when its words are gone.
//
// Two claims, and the second one is the one that keeps this honest.
//
//   1. A comment on something the agent then REWROTE still finds its element,
//      because the element's identity was never the words.
//   2. Two candidates that look equally like the target produce NO answer. That
//      is the swapped-identical-list-items case uniqueness.js refuses, and a
//      score does not get to answer it just because it can produce a number.
//
// Node-only, over the same simulated DOM the anchor engine's unit tests use:
// the five questions, and nothing a browser has to provide.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchor = require("../../src/layer/anchor.js");
const pointing = require("../../src/layer/pointing.js");

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
  (options.children || []).forEach((child) => {
    child.parentElement = node;
    node.children.push(child);
  });
  return node;
}

/** The page Ken was reviewing, in the shape that matters: cards of pills. */
function doorPage(pillText) {
  const pill = el("span", { attrs: { class: "st-door-card__pill" }, text: pillText });
  const body = el("body", {
    children: [
      el("main", {
        children: [
          el("div", {
            attrs: { class: "st-door-grid" },
            children: [
              el("a", {
                attrs: { class: "st-door-card", href: "/upload" },
                children: [
                  el("span", { attrs: { class: "st-door-card__types" }, text: "(.TXT, .MD, .PDF)" }),
                  pill
                ]
              })
            ]
          })
        ]
      })
    ]
  });
  return { body, pill };
}

test("a comment survives the agent rewriting the very words it was made of", () => {
  // Mint against the page as the reviewer saw it.
  const before = doorPage("When you've already written it down");
  const ref = anchor.mint({ element: before.pill, root: before.body });
  assert.equal(ref.ok, true, "the reference minted cleanly");
  assert.ok(ref.fingerprint, "and it carries a fingerprint");
  assert.equal(ref.fingerprint.tag, "span");
  assert.deepEqual(ref.fingerprint.classes, ["st-door-card__pill"]);

  // The agent rewrites the pill. Every word the anchor was made of is gone.
  const after = doorPage("Upload what you already wrote");
  assert.equal(
    anchor.resolve(ref, after.body).element,
    null,
    "the strict engine says no, correctly: these are not the same words"
  );

  // The element is still identifiable, because its identity was never the words.
  const guess = pointing.bestGuess(ref, after.body);
  assert.equal(guess.element, after.pill, "and the comment still knows which element it meant");
  assert.ok(guess.score >= pointing.FLOOR);
  assert.ok(guess.reasons.indexOf("classes") !== -1, "on what the author wrote, not on the text");
});

test("two elements that look equally like the target produce no answer at all", () => {
  // THE CASE THAT KILLED THE EARLIER SCORED DRAFT, from uniqueness.js: two
  // identical items that swapped places. Any scalar ranks them both high, and
  // "highest wins" picks one with total confidence and no reason.
  const twin = (text) => el("li", { attrs: { class: "row" }, text: text });
  const first = twin("Alpha");
  const second = twin("Beta");
  const list = el("ul", { children: [first, second] });
  const body = el("body", { children: [el("main", { children: [list] })] });

  const ref = anchor.mint({ element: first, root: body });
  assert.equal(ref.ok, true);

  // They swap, and both texts change, so the strict engine finds nothing.
  const swappedFirst = twin("Gamma");
  const swappedSecond = twin("Delta");
  const swappedBody = el("body", {
    children: [el("main", { children: [el("ul", { children: [swappedSecond, swappedFirst] })] })]
  });

  const guess = pointing.bestGuess(ref, swappedBody);
  assert.equal(guess.element, null, "a near tie is refused, not resolved to the higher number");
});

test("a name the author wrote wins on its own, and is the reason it wins", () => {
  // data-review-region is the sanctioned version of "inject a class so we can
  // find it later": the author puts it in their own template, so it survives
  // every rebuild, and nothing is ever written into their source by this tool.
  const named = el("div", { attrs: { "data-review-region": "the upload door" }, text: "anything at all" });
  const body = el("body", {
    children: [el("main", { children: [named, el("div", { text: "something else entirely" })] })]
  });
  const ref = anchor.mint({ element: named, root: body });

  const moved = el("div", { attrs: { "data-review-region": "the upload door" }, text: "completely different words" });
  const rebuilt = el("body", {
    children: [
      el("header", { text: "a new banner" }),
      el("section", { children: [el("p", { text: "unrelated" }), moved] })
    ]
  });

  const guess = pointing.bestGuess(ref, rebuilt.body || rebuilt);
  assert.equal(guess.element, moved, "the author's own name for the region finds it anywhere");
  assert.ok(guess.reasons.indexOf("author region name") !== -1);
});

test("nothing that looks like the target produces nothing, rather than the least bad thing", () => {
  const before = doorPage("When you've already written it down");
  const ref = anchor.mint({ element: before.pill, root: before.body });

  const unrelated = el("body", {
    children: [el("article", { children: [el("p", { text: "a completely different page" })] })]
  });

  const guess = pointing.bestGuess(ref, unrelated);
  assert.equal(guess.element, null, "an empty answer is a real answer");
});
