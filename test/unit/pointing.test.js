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

// ---------------------------------------------------------------------------
// The page of identical decision lines
// ---------------------------------------------------------------------------
//
// A review of 73 lesson cards, each ending in the same three words: Approve /
// Deny / Discuss. The reviewer comments on one Approve, and the anchor's own
// siblings are byte for byte identical on all 73 cards, so mint widened through
// them, ran out, and failed as not_unique_in_containing_block. The item reached
// the agent stamped lost, which was honest, and the agent had to resolve it by
// counting span ordinals and then ask the reviewer to confirm.
//
// What tells those cards apart is one level up, inside the card: the filename.

function decisionCard(filename) {
  const approve = el("span", { attrs: { class: "decide" }, text: "Approve" });
  const card = el("article", {
    attrs: { class: "lesson-card" },
    children: [
      el("h3", { attrs: { class: "lesson-card__name" }, text: filename }),
      el("div", {
        attrs: { class: "lesson-card__decide" },
        children: [
          approve,
          el("span", { text: " / " }),
          el("span", { attrs: { class: "decide" }, text: "Deny" }),
          el("span", { text: " / " }),
          el("span", { attrs: { class: "decide" }, text: "Discuss" })
        ]
      })
    ]
  });
  return { card, approve };
}

function cardWall(names) {
  const built = names.map(decisionCard);
  const body = el("body", {
    children: [el("main", { children: [el("section", { children: built.map((b) => b.card) })] })]
  });
  return { body, approves: built.map((b) => b.approve) };
}

test("a comment on one of 73 identical Approve buttons knows which card it was on", () => {
  const names = [];
  for (let i = 0; i < 73; i += 1) names.push("lesson-" + i + ".md");
  const wall = cardWall(names);

  // The reviewer clicks the Approve on the fortieth card.
  const target = wall.approves[39];
  const ref = anchor.mint({ element: target, root: wall.body });

  assert.equal(ref.ok, true, "mint no longer gives up on the first ring of context");
  assert.ok(ref.context_level > 0, "it had to climb to find anything that told the cards apart");
  assert.ok(
    ref.prefix.indexOf("lesson-39.md") !== -1 || ref.suffix.indexOf("lesson-39.md") !== -1,
    "and what it climbed to is the filename: " + JSON.stringify({ prefix: ref.prefix, suffix: ref.suffix })
  );

  // The whole point: it comes back to the same button, not to card one.
  const again = cardWall(names);
  const verdict = anchor.resolve(ref, again.body);
  assert.equal(verdict.element, again.approves[39], "and it resolves to the card the reviewer was on");
});

test("identical cards with nothing to tell them apart still fail, rather than guessing", () => {
  // The climb is not a licence to bind to something. When the cards really are
  // indistinguishable, every ring is identical too, and the honest answer is the
  // same one it always was.
  const names = [];
  for (let i = 0; i < 6; i += 1) names.push("the same name.md");
  const wall = cardWall(names);

  const ref = anchor.mint({ element: wall.approves[2], root: wall.body });

  assert.equal(ref.ok, false, "no ring separates them, so nothing is minted");
  assert.equal(ref.failure.failureCode, "ANCHOR_AMBIGUOUS");
});

// ---------------------------------------------------------------------------
// The climb is unbounded, and it has to stay cheap
// ---------------------------------------------------------------------------
//
// Widening now climbs to the top of the document, because any fixed number of
// rings is a guess about somebody else's markup that fails on the page with one
// more level than the guess (Ken: "hit dot parent until the parents are out,
// until you make it all the way up to the body tag").
//
// Climbing is cheap. Sweeping sideways at every level was not: the first version
// of this took thirty seconds on a wall of identical rows, and on a wider one it
// did not finish at all. Three things fixed it, and each is easy to undo by
// accident, so this guards the outcome rather than the mechanism.
//
// The bound is deliberately loose. It is here to catch a return to quadratic,
// not to police milliseconds on somebody's laptop.

function identicalWall(depth, breadth) {
  if (depth === 0) {
    const target = el("span", { attrs: { class: "decide" }, text: "Approve" });
    return {
      node: el("div", {
        attrs: { class: "row" },
        children: [target, el("span", { text: " / " }), el("span", { text: "Deny" })]
      }),
      targets: [target]
    };
  }
  const kids = [];
  let targets = [];
  for (let i = 0; i < breadth; i += 1) {
    const built = identicalWall(depth - 1, breadth);
    kids.push(
      el("section", {
        attrs: { class: "group" },
        children: [el("h3", { text: "the same label" }), built.node]
      })
    );
    targets = targets.concat(built.targets);
  }
  return { node: el("div", { attrs: { class: "wrap" }, children: kids }), targets };
}

test("a page where nothing is distinguishable fails fast rather than never", () => {
  // 625 identical leaves, four levels deep, and no text anywhere that tells any
  // of them apart. Every ring is identical too, so no amount of widening can
  // succeed and the only question is how long it takes to say so.
  const wall = identicalWall(4, 5);
  const body = el("body", { children: [el("main", { children: [wall.node] })] });
  assert.equal(wall.targets.length, 625);

  const started = Date.now();
  const ref = anchor.mint({ element: wall.targets[312], root: body });
  const spent = Date.now() - started;

  assert.equal(ref.ok, false, "nothing distinguishes them, so nothing is minted");
  assert.equal(ref.failure.failureCode, "ANCHOR_AMBIGUOUS");
  assert.ok(spent < 8000, "and it reached that answer in " + spent + "ms, not in a quarter of a minute");
});

test("a page where something IS distinguishable stays fast, and climbs only as far as it must", () => {
  const names = [];
  for (let i = 0; i < 73; i += 1) names.push("lesson-" + i + ".md");
  const wall = cardWall(names);

  const started = Date.now();
  const ref = anchor.mint({ element: wall.approves[39], root: wall.body });
  const spent = Date.now() - started;

  assert.equal(ref.ok, true);
  assert.ok(spent < 2000, "the ordinary case is not slowed down by the pathological one (" + spent + "ms)");
});
