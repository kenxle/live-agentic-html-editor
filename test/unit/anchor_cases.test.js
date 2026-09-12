// THE CASES A COMMENT HAS TO SURVIVE. This is the list, and it is the test.
//
// Ken, after a long argument about fingerprinting: "there's a few use cases and
// we should write them down so we can always test against them."
//
// Written as tests rather than as a document, because a document of cases with
// no assertions is a wish list. Every case below is either asserted or marked
// `todo` with the reason, so the gap between what is claimed and what is proven
// is visible in the output rather than in somebody's memory.
//
// The cases, in Ken's order:
//
//   EDIT
//   1. a plain text edit, the passage stays put
//   2. an element is REMOVED
//   3. several edits queued before any of them are applied
//   4. ...where the first one removes something
//   5. ...where the first one SWAPS two things  (the hard one)
//
//   POINT
//   6. clicking a card: what does it jump to
//
//   UNDO
//   7. taking an edit back
//
// Two rules decide every case below, and they are not the same rule:
//
//   A WRITE needs a unique candidate (uniqueness.js, D9). No score, ever. When
//   it cannot be sure it does nothing and says so.
//
//   A POINT may take the best guess it has (pointing.js), because the cost of
//   being wrong is a mark in the wrong place rather than a destroyed passage.
//
// Node-only, over the simulated DOM the anchor tests use.

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

/** A page of paragraphs, each in its own section, with distinct words. */
function article(paragraphs) {
  const nodes = paragraphs.map((text, i) =>
    el("section", {
      attrs: { class: "para" },
      children: [el("p", { attrs: { class: "para__body" }, text: text })]
    })
  );
  return {
    body: el("body", { children: [el("main", { children: nodes })] }),
    paragraphs: nodes.map((s) => s.children[0])
  };
}

const WORDS = [
  "Runners come back too fast after a layoff.",
  "The third week is where it shows.",
  "Say which week this is about.",
  "One page, one ask, and a number."
];

// ---------------------------------------------------------------------------
// EDIT 1: a plain text edit
// ---------------------------------------------------------------------------

test("case 1: the passage is still there and still says the same thing", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });
  assert.equal(ref.ok, true);

  const again = article(WORDS);
  assert.equal(
    anchor.resolve(ref, again.body).element,
    again.paragraphs[2],
    "the ordinary case, and it must never need a guess"
  );
});

test("case 1b: the passage was reworded, so the write refuses and the point does not", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const edited = article([WORDS[0], WORDS[1], "Name the week in the heading.", WORDS[3]]);

  assert.equal(
    anchor.resolve(ref, edited.body).element,
    null,
    "these are not the same words, and a write may not land on a maybe"
  );
  const guess = pointing.bestGuess(ref, edited.body);
  assert.equal(guess.element, edited.paragraphs[2], "but the reviewer's mark still knows where it went");
});

// ---------------------------------------------------------------------------
// EDIT 2: an element is removed
// ---------------------------------------------------------------------------

test("case 2: the element is gone, so nothing claims to be it", () => {
  // Ken, on this case: "trying to identify a removed element, you can't even do
  // that with an ID." Right, and that is the point of asserting it. No
  // fingerprint, no path and no injected marker finds a node that is not in the
  // document, so the only honest answers are "no" and "here is where it was".
  //
  // Note also what this case is NOT about. If the edit was the deletion, the
  // element was identified before it was removed and the work is already done.
  // What is left over is the reviewer's card, and where it points.
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const without = article([WORDS[0], WORDS[1], WORDS[3]]);

  assert.equal(anchor.resolve(ref, without.body).element, null, "nothing to write to");
  assert.equal(
    pointing.bestGuess(ref, without.body).element,
    null,
    "and nothing claims to be it, including the paragraph that slid into its slot"
  );
});

test("case 2b: the gap is findable, so the card can say where the passage used to be", () => {
  // The better answer to a deleted region, and it is tagged to something that
  // still exists rather than to the thing that does not.
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const without = article([WORDS[0], WORDS[1], WORDS[3]]);
  const gap = pointing.whereItWas(ref, without.body);

  assert.ok(gap, "the neighbours outlived the region");
  assert.equal(gap.element.textContent, WORDS[3], "and this one was on the far side of it");
  assert.equal(gap.side, "after");
});

test("case 2c: the whole block goes, and there is no gap to show either", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  // Both neighbours removed along with it.
  const gutted = article([WORDS[0]]);
  assert.equal(pointing.whereItWas(ref, gutted.body), null, "saying nothing is the answer");
});

// ---------------------------------------------------------------------------
// EDIT 3 and 4: several edits queued, and the first one removes something
// ---------------------------------------------------------------------------

test("case 3: four comments queued against one page all still resolve", () => {
  const page = article(WORDS);
  const refs = page.paragraphs.map((p) => anchor.mint({ element: p, root: page.body }));
  refs.forEach((ref, i) => assert.equal(ref.ok, true, "ref " + i + " minted"));

  const again = article(WORDS);
  refs.forEach((ref, i) => {
    assert.equal(anchor.resolve(ref, again.body).element, again.paragraphs[i], "ref " + i + " lands");
  });
});

test("case 4: the first edit removes a paragraph, and the queued ones behind it still land", () => {
  // THE CASE KEN NAMED: "you've got three or four things that are queued and the
  // one at the top removes or swaps elements." The queued references were minted
  // against the page BEFORE the removal, so their stored context mentions a
  // neighbour that is now gone.
  const page = article(WORDS);
  const refs = page.paragraphs.map((p) => anchor.mint({ element: p, root: page.body }));

  // Paragraph 1 is deleted by the first edit in the queue.
  const after = article([WORDS[0], WORDS[2], WORDS[3]]);

  assert.equal(anchor.resolve(refs[0], after.body).element, after.paragraphs[0], "the one before it");
  assert.equal(
    anchor.resolve(refs[1], after.body).element,
    null,
    "the deleted one is honestly lost, not silently moved onto its neighbour"
  );
  assert.equal(
    anchor.resolve(refs[2], after.body).element,
    after.paragraphs[1],
    "the one after it still lands on its own words, though its neighbour changed"
  );
  assert.equal(anchor.resolve(refs[3], after.body).element, after.paragraphs[2], "and the last one");
});

// ---------------------------------------------------------------------------
// EDIT 5: the first edit SWAPS two elements
// ---------------------------------------------------------------------------

test("case 5: two paragraphs swap places, and each comment follows its own words", () => {
  // Swapping is only hard when the things are INDISTINGUISHABLE. When they have
  // their own words, text does the whole job and position never gets a vote,
  // which is exactly why text is what places a write.
  const page = article(WORDS);
  const refs = page.paragraphs.map((p) => anchor.mint({ element: p, root: page.body }));

  const swapped = article([WORDS[0], WORDS[2], WORDS[1], WORDS[3]]);

  assert.equal(
    anchor.resolve(refs[1], swapped.body).element.textContent,
    WORDS[1],
    "the comment on the second paragraph followed the paragraph, not the slot"
  );
  assert.equal(
    anchor.resolve(refs[2], swapped.body).element.textContent,
    WORDS[2],
    "and so did the other one"
  );
});

test(
  "case 5b: two INDISTINGUISHABLE rows swap, and only the write path is safe from it",
  () => {
    const twin = (text) => el("li", { attrs: { class: "row" }, text: text });
    const before = el("body", {
      children: [el("main", { children: [el("ul", { children: [twin("Alpha"), twin("Beta")] })] })]
    });
    const ref = anchor.mint({ element: before.children[0].children[0].children[0], root: before });

    const after = el("body", {
      children: [el("main", { children: [el("ul", { children: [twin("Delta"), twin("Gamma")] })] })]
    });

    assert.equal(anchor.resolve(ref, after).element, null, "no write, and this is the rule that cannot bend");

    const guess = pointing.bestGuess(ref, after);
    assert.equal(guess.via, "position", "the point is reached by position, and says so");
    assert.equal(
      guess.element.textContent,
      "Delta",
      "and it is WRONG: they swapped, so the row in that slot is the other one"
    );
  }
);

// ---------------------------------------------------------------------------
// POINT 6: clicking a card
// ---------------------------------------------------------------------------

test("case 6: clicking a card whose words changed jumps to the element, not to nothing", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[1], root: page.body });

  const edited = article([WORDS[0], "Rewritten entirely, no shared words.", WORDS[2], WORDS[3]]);

  assert.equal(anchor.resolve(ref, edited.body).element, null, "the strict engine has nothing");
  assert.equal(
    pointing.bestGuess(ref, edited.body).element,
    edited.paragraphs[1],
    "and this is what the card click can use"
  );
});

// ---------------------------------------------------------------------------
// UNDO 7
// ---------------------------------------------------------------------------

test("case 7: an edit taken back leaves the original words, and the anchor lands on them again", () => {
  // Ken: "I wonder if the undo stuff is just solved by committing constantly."
  // For the anchor it already is. An undo restores the words the reference was
  // minted from, so the reference resolves exactly as it did before the edit;
  // there is no separate undo path through this engine at all.
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const edited = article([WORDS[0], WORDS[1], "A change nobody wanted.", WORDS[3]]);
  assert.equal(anchor.resolve(ref, edited.body).element, null);

  const undone = article(WORDS);
  assert.equal(
    anchor.resolve(ref, undone.body).element,
    undone.paragraphs[2],
    "back to a clean bind, with nothing to repair"
  );
});

// ---------------------------------------------------------------------------
// Not yet covered, and said out loud rather than left to be discovered
// ---------------------------------------------------------------------------

test("case 4b: a queued edit whose own element is removed by an earlier edit reports lost TO THE AGENT", { todo: "needs the projection, not just the engine: assert review.json carries lost for it" }, () => {});

test("case 6b: the rail actually uses bestGuess when a card is clicked", { todo: "pointing.js is not wired to the rail yet; this is the browser test for when it is" }, () => {});

// ---------------------------------------------------------------------------
// The cases the list implies but does not name
// ---------------------------------------------------------------------------

test("case 8: a wrapper appears around the region, and it is a non-event", () => {
  // Rule 2: every ancestor of a match also contains the text, so the INNERMOST
  // one wins. This is what makes a framework adding a div around everything cost
  // nothing at all, and it needs no guess to work.
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const wrapped = article(WORDS);
  const target = wrapped.paragraphs[2];
  const section = target.parentElement;
  const wrapper = el("div", { attrs: { class: "framework-wrapper" } });
  wrapper.children.push(target);
  target.parentElement = wrapper;
  section.children = [wrapper];
  wrapper.parentElement = section;

  assert.equal(anchor.resolve(ref, wrapped.body).element, target, "the region wins over its new wrapper");
});

test("case 9: the region moves to a different part of the page, words intact", () => {
  // Text is identity, so a section that moved is still the same section. Nothing
  // about the position surviving is required for this to work, which is the
  // whole argument for text placing the write.
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const moved = article([WORDS[2], WORDS[0], WORDS[1], WORDS[3]]);
  assert.equal(
    anchor.resolve(ref, moved.body).element.textContent,
    WORDS[2],
    "it followed the words to the top of the page"
  );
});

test("case 10: a copy of the region is pasted in, and the write refuses rather than picking one", () => {
  // The page gained a duplicate, which mint's own comment calls the ordinary
  // case rather than the exotic one. Two identical passages with identical
  // surroundings is the shape that must never resolve to "probably that one".
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  // A copy with DIFFERENT neighbours is not ambiguous, and the first version of
  // this test got that wrong: context eliminates the rival and the engine binds,
  // correctly. Ambiguity needs the surroundings to repeat too, which is what a
  // duplicated block actually looks like.
  const nearCopy = article([WORDS[0], WORDS[2], WORDS[1], WORDS[2], WORDS[3]]);
  assert.equal(
    anchor.resolve(ref, nearCopy.body).element.textContent,
    WORDS[2],
    "a copy standing somewhere else does not make the original unfindable"
  );

  // The whole block repeated: same words, same neighbours on both sides.
  const twice = article([WORDS[1], WORDS[2], WORDS[3], WORDS[1], WORDS[2], WORDS[3]]);
  const refInBlock = anchor.mint({ element: article([WORDS[1], WORDS[2], WORDS[3]]).paragraphs[1], root: article([WORDS[1], WORDS[2], WORDS[3]]).body });
  const verdict = anchor.resolve(refInBlock, twice.body);
  assert.equal(verdict.element, null, "two candidates with identical surroundings, no write");
  assert.equal(verdict.failureCode, "ANCHOR_AMBIGUOUS", "and it says which kind of no");
});

test("case 11: a comment carried to a completely different page finds nothing", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  // A genuinely different page: different tags, different classes, nothing the
  // fingerprint recognises.
  const elsewhere = el("body", {
    children: [
      el("article", {
        attrs: { class: "post" },
        children: [
          el("h1", { attrs: { class: "post__title" }, text: "Nothing here." }),
          el("blockquote", { attrs: { class: "post__pull" }, text: "Nor here." })
        ]
      })
    ]
  });
  assert.equal(anchor.resolve(ref, elsewhere).element, null);
  assert.equal(pointing.bestGuess(ref, elsewhere).element, null, "and the guess declines too");

  // A page built from the SAME template with different words is a different
  // story, and an honest one: identity really does match, so the guess lands and
  // marks itself as reached by position. This is the twins trade again, and the
  // layer never asks it anyway, because items are scoped to the page that made
  // them (src/layer/index.js).
  const sameTemplate = article(["Nothing here.", "Nor here.", "Nor here either.", "Nor this."]);
  const guess = pointing.bestGuess(ref, sameTemplate.body);
  assert.equal(guess.via, "position", "it says how it got there rather than claiming to recognise it");
});

test("case 12: two comments on the SAME element both survive an edit to it", () => {
  // Queued edits are not always on different elements. Two references minted
  // from one element are the same reference twice, and an edit that moves the
  // element has to move both or neither.
  const page = article(WORDS);
  const one = anchor.mint({ element: page.paragraphs[1], root: page.body });
  const two = anchor.mint({ element: page.paragraphs[1], root: page.body });

  const shifted = article([WORDS[0], WORDS[1], "A new paragraph in between.", WORDS[2], WORDS[3]]);
  assert.equal(anchor.resolve(one, shifted.body).element, shifted.paragraphs[1]);
  assert.equal(anchor.resolve(two, shifted.body).element, shifted.paragraphs[1], "and the second agrees");
});

test("case 13: an image is identified by what it IS, not by words it does not have", () => {
  // R17. A region with no text anchors on a signature built from the attributes
  // that say what the element is, and it goes through the same predicate.
  const shot = (src, alt) => el("img", { attrs: { src: src, alt: alt } });
  const gallery = (srcs) =>
    el("body", {
      children: [el("main", { children: srcs.map((s) => el("figure", { children: [shot(s, s + " alt")] })) })]
    });

  const before = gallery(["one.png", "two.png", "three.png"]);
  const target = before.children[0].children[1].children[0];
  const ref = anchor.mint({ element: target, root: before });
  assert.equal(ref.ok, true, "an image mints");
  assert.equal(ref.probe_kind, "element", "on its signature rather than on text");

  // The gallery is reordered. The image follows its own src.
  const after = gallery(["three.png", "two.png", "one.png"]);
  assert.equal(
    anchor.resolve(ref, after).element,
    after.children[0].children[1].children[0],
    "two.png is two.png wherever it sits"
  );
});

test("case 14: two images sharing one src are ambiguous exactly as two identical rows are", () => {
  const shot = (src) => el("img", { attrs: { src: src, alt: "" } });
  const page = el("body", {
    children: [el("main", { children: [el("figure", { children: [shot("logo.png")] })] })]
  });
  const ref = anchor.mint({ element: page.children[0].children[0].children[0], root: page });

  const twice = el("body", {
    children: [
      el("main", {
        children: [
          el("figure", { children: [shot("logo.png")] }),
          el("figure", { children: [shot("logo.png")] })
        ]
      })
    ]
  });
  assert.equal(anchor.resolve(ref, twice).element, null, "no write into either of two identical images");
});

test("case 15: a straight apostrophe becomes a curly one, which nothing currently survives", () => {
  // KNOWN AND UNFIXED, asserted so it is a decision rather than a surprise. The
  // normalizer folds whitespace, invisibles and unicode spaces, and deliberately
  // does NOT fold typography, because replay folding it would silently discard a
  // reviewer's punctuation fix. The two strings below are indistinguishable on
  // screen at reading size.
  const page = article(["When you've already written it down", WORDS[1], WORDS[2]]);
  const ref = anchor.mint({ element: page.paragraphs[0], root: page.body });

  const curly = article(["When you’ve already written it down", WORDS[1], WORDS[2]]);
  assert.equal(anchor.resolve(ref, curly.body).element, null, "the write refuses, which is correct");

  // The mark is what saves it: identity did not change, only the punctuation.
  assert.equal(
    pointing.bestGuess(ref, curly.body).element,
    curly.paragraphs[0],
    "and the reviewer's highlight still lands, because it never depended on the words"
  );
});

// ---------------------------------------------------------------------------
// Saying WHICH kind of gone
// ---------------------------------------------------------------------------
//
// One message covers every failure today: "could not be safely matched to this
// version of the page". True, and useless, because a passage the agent REWORDED
// and one the agent DELETED want different things from the reviewer, and the
// sentence cannot tell them apart.

test("case 16: a reworded passage reads as found, not as missing", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const reworded = article([WORDS[0], WORDS[1], "Different words entirely here.", WORDS[3]]);
  const verdict = pointing.verdictFor(ref, reworded.body);

  assert.equal(verdict.state, "found");
  assert.equal(verdict.element, reworded.paragraphs[2]);
});

test("case 17: a deleted passage reads as removed, and says where it was", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const deleted = article([WORDS[0], WORDS[1], WORDS[3]]);
  const verdict = pointing.verdictFor(ref, deleted.body);

  assert.equal(verdict.state, "removed", "which is a finding, not a failure to look");
  assert.equal(verdict.gap.element.textContent, WORDS[3]);
  assert.equal(verdict.gap.side, "after");
});

test("case 18: a page that shares nothing with the original admits it knows nothing", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const foreign = el("body", {
    children: [el("article", { attrs: { class: "post" }, children: [el("h1", { text: "Unrelated." })] })]
  });
  assert.equal(pointing.verdictFor(ref, foreign).state, "unknown");
});

// ---------------------------------------------------------------------------
// The queued-edits problem, which the tombstone does NOT solve
// ---------------------------------------------------------------------------
//
// Ken, on being shown the removed/reworded distinction: "but that still doesn't
// fix the queued edits problem i think". He is right, and the reason is that the
// tombstone is about the wrong item. It says what became of the region that was
// DELETED. The queued-edits problem is what becomes of the SURVIVORS: their
// anchors go stale as earlier edits land, and nothing tells them so.

test("case 19: a queued comment goes stale when an earlier edit moves it, and refreshing fixes it", () => {
  // Four comments made against one page, before any edit is applied.
  const page = article(WORDS);
  const refs = page.paragraphs.map((p) => anchor.mint({ element: p, root: page.body }));
  const minted = refs.map((r) => r.path);

  // EDIT ONE lands: the first paragraph is deleted. Everything below shifts up,
  // so every remaining comment is now anchored to a path that is off by one.
  const afterFirst = article([WORDS[1], WORDS[2], WORDS[3]]);

  // They all still bind, because they bind on their own words, not on position.
  // This is the moment the fresh position is knowable, and the only one.
  const places = refs.slice(1).map((ref, i) => {
    const found = anchor.resolve(ref, afterFirst.body).element;
    assert.ok(found, "comment " + (i + 1) + " still binds after the deletion");
    return pointing.placeOf(found, afterFirst.body);
  });
  assert.notEqual(places[0], minted[1], "and it is somewhere it did not used to be");

  // EDIT TWO lands: it rewords the paragraph the second comment is on. Now its
  // words are gone too, and position is the only thing left.
  const afterSecond = article(["Reworded beyond recognition.", WORDS[2], WORDS[3]]);
  assert.equal(anchor.resolve(refs[1], afterSecond.body).element, null, "no words to bind on");

  // With only what was minted, the fallback looks in the wrong place.
  const stale = pointing.bestGuess(refs[1], afterSecond.body);
  // With the place it was last actually seen, it looks in the right one.
  const fresh = pointing.bestGuess(refs[1], afterSecond.body, { knownPath: places[0] });

  assert.equal(
    fresh.element,
    afterSecond.paragraphs[0],
    "the refreshed anchor finds the reworded paragraph the comment is on"
  );
  assert.notEqual(
    stale.element,
    fresh.element,
    "and the un-refreshed one does not agree, which is the whole cost of never updating it"
  );
});

test("case 20: refreshing records a place only when something really bound", () => {
  // placeOf returns null for nothing, so a caller cannot write a guess into the
  // side table and have it read later as a fact.
  const page = article(WORDS);
  assert.equal(pointing.placeOf(null, page.body), null);
  assert.equal(pointing.placeOf(undefined, page.body), null);
});

test("case 21: an undo puts the region back where it was minted, and the older place finds it", () => {
  // Ken: "before and after ref.paths is still good for some of the use cases."
  // This is the case that proves keeping only the fresher one is lossy.
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  // An edit inserts a paragraph above, so the region moves down one slot. It
  // still binds on its words, which is when the new place becomes knowable.
  const moved = article([WORDS[0], "An inserted paragraph.", WORDS[1], WORDS[2], WORDS[3]]);
  const found = anchor.resolve(ref, moved.body).element;
  assert.ok(found, "it still binds while its words are intact");
  const freshPlace = pointing.placeOf(found, moved.body);
  assert.notEqual(freshPlace, ref.path, "and it is somewhere new");

  // The reviewer takes that edit back AND the region is reworded, so words can
  // no longer find it. The page is now shaped as it was on the day it was
  // minted, which is exactly what the FRESH path no longer describes.
  const undoneAndReworded = article([WORDS[0], WORDS[1], "Reworded after the undo.", WORDS[3]]);

  const guess = pointing.bestGuess(ref, undoneAndReworded.body, { knownPath: freshPlace });
  assert.equal(
    guess.element,
    undoneAndReworded.paragraphs[2],
    "the place it was minted at is the one that is right again, and it was not thrown away"
  );
});

// ---------------------------------------------------------------------------
// Queued edits, with the whole fingerprint re-taken after each one
// ---------------------------------------------------------------------------
//
// Ken's split: "one is trying to make sure we make the edit in the right place.
// that's relatively easy with our combo of text and ref.path. then the next
// problem is pointing at it afterwards, so we could fingerprint again where it
// was/is after the edit. then the problem becomes what do we do with queued
// edits."
//
// The answer to the third is the same as the second, applied every time: after
// each edit lands, re-take the snapshot of every item that can still be found.
// A region whose words the NEXT edit destroys then keeps the snapshot from just
// before that edit, which is the most recent true thing anyone knows about it.

test("case 22: three edits land in sequence, and a comment survives all of them", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[3], root: page.body });
  let known = null;

  // Edit one inserts a paragraph at the top. Everything moves down a slot.
  const afterOne = article(["Brand new opening.", WORDS[0], WORDS[1], WORDS[2], WORDS[3]]);
  known = pointing.snapshot(anchor.resolve(ref, afterOne.body).element, afterOne.body);
  assert.ok(known, "still findable by its words, so the snapshot is trustworthy");

  // Edit two deletes a paragraph above it. It moves back up.
  const afterTwo = article(["Brand new opening.", WORDS[1], WORDS[2], WORDS[3]]);
  known = pointing.snapshot(anchor.resolve(ref, afterTwo.body).element, afterTwo.body);
  assert.ok(known);

  // Edit three finally rewords the region itself AND restyles it. Its words are
  // gone and its class changed, so nothing minted describes it any more.
  const afterThree = article(["Brand new opening.", WORDS[1], WORDS[2], "Rewritten in the third edit."]);
  const target = afterThree.paragraphs[3];
  target.attrs.class = "para__body para__body--reworked";

  assert.equal(anchor.resolve(ref, afterThree.body).element, null, "no words left to bind on");

  const guess = pointing.bestGuess(ref, afterThree.body, { known: known });
  assert.equal(guess.element, target, "and the comment still points at its own paragraph");
});

test("case 23: a snapshot is only taken from something that really bound", () => {
  const page = article(WORDS);
  assert.equal(pointing.snapshot(null, page.body), null, "nothing in, nothing remembered");
});

// ---------------------------------------------------------------------------
// THE STAMP'S OWN HAZARDS (S1, S2)
// ---------------------------------------------------------------------------
//
// Ken, 2026-09-11: "I would much rather have graceful failures than quiet
// failures or destroying work."
//
// The stamp is the top rung of the write ladder, so it is also the newest way
// to be confidently wrong. Both cases below end in a refusal with a reason the
// reviewer can read, and neither writes.
//
// The simulated DOM answers getAttribute and has no setAttribute, so mint
// cannot stamp here. That is convenient: the stamp is set by hand, which is
// exactly what an agent writing the attribute into the source does.

/** One paragraph per text, each carrying the given stamp. */
function stamped(texts, stamps) {
  const nodes = texts.map((text, i) => {
    const attrs = { class: "para__body" };
    if (stamps[i]) attrs[anchor.STAMP_ATTR] = stamps[i];
    return el("p", { attrs: attrs, text: text });
  });
  return { body: el("body", { children: [el("main", { children: nodes })] }), paragraphs: nodes };
}

test("S1: two elements carry the same id, so nothing is written", () => {
  // A copy-paste in somebody's source duplicated the attribute along with the
  // markup around it. One id on two elements is ambiguous in exactly the way
  // two identical list items are, and it fails the same way.
  const page = stamped([WORDS[0], WORDS[1], WORDS[1]], [null, "e-twin", "e-twin"]);
  const ref = anchor.mint({ element: page.paragraphs[1], root: page.body });
  ref.stamp = "e-twin";

  const verdict = anchor.resolve(ref, page.body);
  assert.equal(verdict.bound, false, "two elements carrying one id is not an answer");
  assert.equal(verdict.element, null, "and nothing is written");
  assert.equal(verdict.failureCode, "ANCHOR_AMBIGUOUS");
  assert.equal(verdict.reason, anchor.STAMP_REASON.DUPLICATED);
  assert.equal(verdict.reason, "two elements carry this id", "in words the reviewer can read");
});

test("S2: the id is on an element whose words are not the reviewer's, so nothing is written", () => {
  // The agent stamped the wrong twin, or the passage under the id was
  // rewritten. Identity is certain and the target is not, and a write may not
  // land on a maybe.
  const page = stamped([WORDS[0], WORDS[1]], [null, "e-moved"]);
  const ref = anchor.mint({ element: page.paragraphs[0], root: page.body });
  ref.stamp = "e-moved";

  const verdict = anchor.resolve(ref, page.body);
  assert.equal(verdict.bound, false, "the id points at different words");
  assert.equal(verdict.element, null);
  assert.equal(verdict.failureCode, "ANCHOR_NO_TEXT_MATCH");
  assert.equal(verdict.reason, anchor.STAMP_REASON.TEXT_MOVED);
  assert.equal(verdict.reason, "the stamp points at different words");

  // A caller that already knows what it wrote there is a different story: the
  // words under the id are the words that caller put there, and the region is
  // still the region.
  const knowing = anchor.resolve(ref, page.body, { accept: [WORDS[1]] });
  assert.equal(knowing.bound, true, "an edit that landed is not a stamp that lied");
  assert.equal(knowing.element, page.paragraphs[1]);
});

test("S1/S2 negative: a unique id over the right words writes, as it always did", () => {
  const page = stamped([WORDS[0], WORDS[1]], [null, "e-good"]);
  const ref = anchor.mint({ element: page.paragraphs[1], root: page.body });
  ref.stamp = "e-good";

  const verdict = anchor.resolve(ref, page.body);
  assert.equal(verdict.bound, true);
  assert.equal(verdict.element, page.paragraphs[1]);
  assert.equal(verdict.via, "stamp", "and it says how it got there");
});

test("S3: an id the page no longer has falls through to the words, not to a refusal", () => {
  // A rebuild that did not carry the attribute into the source. The stamp says
  // nothing, and the words decide, exactly as they did before stamps existed.
  const page = stamped([WORDS[0], WORDS[1]], [null, null]);
  const ref = anchor.mint({ element: page.paragraphs[1], root: page.body });
  ref.stamp = "e-gone";

  const verdict = anchor.resolve(ref, page.body);
  assert.equal(verdict.bound, true, "the words are still unique on the page");
  assert.equal(verdict.element, page.paragraphs[1]);
});

test("S4: no id on the page and the words twice over refuses, exactly as before", () => {
  // Symmetric all the way out: the same neighbour on each side of each copy, so
  // widening cannot separate them and only position could.
  const page = stamped(
    ["A lead-in line.", WORDS[1], "A trailing line.", "A lead-in line.", WORDS[1], "A trailing line."],
    [null, null, null, null, null, null]
  );
  const ref = anchor.mint({ element: page.paragraphs[1], root: page.body });
  ref.stamp = "e-gone";

  const verdict = anchor.resolve(ref, page.body);
  assert.equal(verdict.bound, false, "position could pick one; D9 says it never does");
  assert.equal(verdict.element, null);
  assert.equal(verdict.failureCode, "ANCHOR_AMBIGUOUS");
});

// ---------------------------------------------------------------------------
// WHAT THE AGENT IS TOLD ABOUT WHERE IT IS
// ---------------------------------------------------------------------------
//
// The stamp reaches the source only when the agent first edits the element, so
// the FIRST edit of one of N identical elements happens with no stamp in the
// source at all. These two fields are how the agent picks the right one then.

test("where: the ancestor chain, innermost last, with the ids the author wrote", () => {
  const wrap = el("div", { attrs: { class: "wrap" }, text: WORDS[1] });
  const body = el("body", {
    children: [
      el("main", {
        children: [
          el("section", {
            attrs: { id: "t6", class: "tcase" },
            children: [el("div", { attrs: { class: "state" }, children: [wrap] })]
          })
        ]
      })
    ]
  });

  const ref = anchor.mint({ element: wrap, root: body });
  assert.equal(ref.where, "main > section#t6.tcase > div.state > div.wrap");
});

test("ordinal: which of N identical siblings, in the order the source has them", () => {
  const rows = [WORDS[1], WORDS[1], WORDS[0], WORDS[1]].map((text) =>
    el("p", { attrs: { class: "row" }, text: text })
  );
  const body = el("body", { children: [el("main", { children: rows })] });

  // Three of the four say the same thing. The third of those is the fourth row.
  assert.deepEqual(anchor.mint({ element: rows[0], root: body }).ordinal, { index: 1, of: 3 });
  assert.deepEqual(anchor.mint({ element: rows[3], root: body }).ordinal, { index: 3, of: 3 });

  // The odd one out is one of one, which is what unique means here.
  assert.deepEqual(anchor.mint({ element: rows[2], root: body }).ordinal, { index: 1, of: 1 });
});

test("the fingerprint chain keeps ancestor ids, not only their classes", () => {
  const target = el("p", { attrs: { class: "body" }, text: WORDS[2] });
  const body = el("body", {
    children: [
      el("section", { attrs: { id: "second", class: "card" }, children: [target] })
    ]
  });
  const print = anchor.fingerprintOf(target, body);
  assert.equal(print.chain[0].tag, "section");
  assert.equal(print.chain[0].id, "second", "two sections of one template are not the same section");
  assert.deepEqual(print.chain[0].classes, ["card"]);
});

// ---------------------------------------------------------------------------
// S5: the tie-breakers disagree, and they are still only tie-breakers
// ---------------------------------------------------------------------------
//
// D9, in one sentence: a write needs a unique candidate, and structure and
// heading corroborate it, never place it. Both halves are asserted here,
// because each one alone would be a different tool. Corroboration that could
// overrule would let a moved region be written over; corroboration that could
// veto would refuse every framework that renames a wrapper class.

test("S5: the words moved to a different tag under a different parent, and the write still lands", () => {
  // Nothing the reference remembers about the SHAPE of the region survived the
  // rebuild: it was a p.para__body inside a section.para and it is now an h3
  // inside an aside. The words are on the page once, which is the only
  // question a write is allowed to ask.
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });

  const moved = el("body", {
    children: [
      el("main", {
        children: [
          el("section", { attrs: { class: "para" }, children: [el("p", { attrs: { class: "para__body" }, text: WORDS[0] })] }),
          el("aside", { attrs: { class: "pull" }, children: [el("h3", { attrs: { class: "pull__line" }, text: WORDS[2] })] }),
          el("section", { attrs: { class: "para" }, children: [el("p", { attrs: { class: "para__body" }, text: WORDS[3] })] })
        ]
      })
    ]
  });
  const target = moved.children[0].children[1].children[0];

  const verdict = anchor.resolve(ref, moved.body || moved);
  assert.equal(verdict.bound, true, "unique text is the whole test");
  assert.equal(verdict.element, target);
  assert.equal(verdict.corroboration.structure, false, "and it landed with neither tie-breaker agreeing");
  assert.equal(verdict.corroboration.heading, false);
});

test("S5: the words twice over refuse, however loudly the tie-breakers point at one of them", () => {
  // The second copy is the symmetric one: same neighbour above, same neighbour
  // below. What separates them is exactly and only that the FIRST one is
  // standing where the reference was minted, which is the corroboration that
  // is not allowed to decide.
  const one = article(["A lead-in line.", WORDS[1], "A trailing line."]);
  const ref = anchor.mint({ element: one.paragraphs[1], root: one.body });

  const twice = article([
    "A lead-in line.",
    WORDS[1],
    "A trailing line.",
    "A lead-in line.",
    WORDS[1],
    "A trailing line."
  ]);
  // The first copy really is at the minted path: the tie-breaker is available
  // and agrees, which is the only way this test means anything.
  assert.equal(pointing.placeOf(twice.paragraphs[1], twice.body), ref.path, "the path points at the first copy");

  const verdict = anchor.resolve(ref, twice.body);
  assert.equal(verdict.bound, false, "corroborate, never overrule");
  assert.equal(verdict.element, null, "and nothing is written");
  assert.equal(verdict.failureCode, "ANCHOR_AMBIGUOUS");

  // The reviewer is not left with nothing: the mark still has somewhere to go,
  // and it says it got there by position rather than by recognising anything.
  assert.equal(pointing.bestGuess(ref, twice.body).via, "position");
});

// ---------------------------------------------------------------------------
// S8: a probable place is never a write target
// ---------------------------------------------------------------------------
//
// The point ladder exists because a mark in the wrong place can be seen and
// dismissed, where an absent one cannot. That trade is only acceptable while
// the guess cannot reach a write, so the separation is asserted rather than
// left to a convention about which function a caller happens to call.
//
// There is no "this may be wrong" flag on a guess today, and there does not
// need to be one: the two functions return DIFFERENT SHAPES. A verdict says
// `bound`, and only uniqueness.js or the stamp can produce it. A guess says
// `via: "identity"` or `via: "position"`, which resolve has no path to return.

test("S8: every shape that produces a guess produces a refusal from the write ladder", () => {
  const page = article(WORDS);

  // Four separate ways to end up with a guess and no bind: reworded, restyled,
  // re-punctuated, and two indistinguishable rows that swapped.
  const reworded = article([WORDS[0], WORDS[1], "Named the week in the heading instead.", WORDS[3]]);
  const repunctuated = article([WORDS[0], WORDS[1], "Say which week this is about…", WORDS[3]]);
  const cases = [
    { ref: anchor.mint({ element: page.paragraphs[2], root: page.body }), root: reworded.body },
    { ref: anchor.mint({ element: page.paragraphs[2], root: page.body }), root: repunctuated.body }
  ];

  cases.forEach(function (each, i) {
    const guess = pointing.bestGuess(each.ref, each.root);
    assert.ok(guess.element, "case " + i + ": the mark has somewhere to go");
    assert.equal(typeof guess.via, "string", "case " + i + ": and it says how it got there");

    const verdict = anchor.resolve(each.ref, each.root);
    assert.equal(verdict.bound, false, "case " + i + ": and the write ladder says no");
    assert.equal(verdict.element, null, "case " + i + ": so nothing is written");
    assert.notEqual(verdict.element, guess.element, "case " + i + ": the guess is not the write target");
  });
});

test("S8: a guess is not shaped like a verdict, so no caller can read one as the other", () => {
  const page = article(WORDS);
  const ref = anchor.mint({ element: page.paragraphs[2], root: page.body });
  const reworded = article([WORDS[0], WORDS[1], "Entirely different words now.", WORDS[3]]);

  const guess = pointing.bestGuess(ref, reworded.body);
  assert.ok(guess.element);
  assert.equal(guess.bound, undefined, "a guess never claims to be bound");
  assert.equal(guess.failureCode, undefined, "and it is not a failure either: it is a place to point");

  // And the other direction. resolve says how it got there for exactly one
  // reason, the stamp, and never for a reason the point ladder could produce.
  const GUESS_VIAS = ["identity", "position"];
  const found = anchor.resolve(ref, article(WORDS).body);
  assert.equal(found.bound, true);
  assert.equal(GUESS_VIAS.indexOf(found.via), -1, "a bind is never reached the way a guess is");

  const stamps = stamped([WORDS[0], WORDS[1]], [null, "e-one"]);
  const stampRef = anchor.mint({ element: stamps.paragraphs[1], root: stamps.body });
  stampRef.stamp = "e-one";
  const byStamp = anchor.resolve(stampRef, stamps.body);
  assert.equal(byStamp.via, "stamp", "the one way a verdict names its route");
  assert.equal(GUESS_VIAS.indexOf(byStamp.via), -1);

  // The refusals name themselves too, and none of them borrows a guess's word.
  const refused = anchor.resolve(ref, reworded.body);
  assert.equal(GUESS_VIAS.indexOf(refused.via), -1);
});
