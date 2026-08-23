// The anchor engine (task 1C), judged against the SAME corpus as the shared
// uniqueness predicate (test/fixtures/uniqueness_corpus.js), plus the
// transformation set the plan names.
//
// Why a fake DOM and not jsdom: jsdom is banned repo-wide (scripts/lint.js
// enforces it), and it is not needed. The engine only ever asks a node five
// questions: its tag, its text, an attribute, its element children, and its
// parent. Those five are written out in `el()` below, which is the whole
// simulated DOM. The real-DOM half of this task is
// test/browser/anchor_engine.spec.js, running the same assertions against
// Chromium on real fixture pages.
//
// The bar this file encodes, straight from the plan:
//   - the three binding corpus cases bind to the right node
//   - the three non-binding corpus cases write nothing
//   - occurrence four of five survives the deletion of occurrence two
//   - every named transformation either resolves to the SAME node or fails
//     honestly, and none resolves to a DIFFERENT node

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchor = require("../../src/layer/anchor.js");
const uniqueness = require("../../src/shared/uniqueness.js");
const corpus = require("../fixtures/uniqueness_corpus.js");

// ---------------------------------------------------------------------------
// The simulated DOM: the five questions the engine asks a node.
// ---------------------------------------------------------------------------

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
  // Concatenated like the real thing, so a parent's text contains its
  // children's and the innermost-match rule is exercised the same way.
  Object.defineProperty(node, "textContent", {
    get: function () {
      if (!this.children.length) return this.ownText;
      return this.children
        .map(function (c) {
          return c.textContent;
        })
        .join("");
    }
  });
  simulateNodeInterface(node);
  (options.children || []).forEach(function (child) {
    append(node, child);
  });
  return node;
}

// The three properties a DOM walker needs on top of the five questions above.
// The engine reads a node's text through normalize.blockTextFromNode now, so
// that a <br> or a nested block puts a space between the words on either side
// of it instead of running them into one made-up word.
function simulateNodeInterface(node) {
  Object.defineProperty(node, "nodeType", { value: 1 });
  Object.defineProperty(node, "firstChild", {
    get: function () {
      if (this.children.length) return this.children[0];
      const own = typeof this.ownTextFromHtml === "string" ? this.ownTextFromHtml : this.ownText;
      return own ? { nodeType: 3, data: own, nextSibling: null } : null;
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
  return node;
}

function append(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

function insertAt(parent, child, index) {
  child.parentElement = parent;
  parent.children.splice(index, 0, child);
  return child;
}

function remove(child) {
  const parent = child.parentElement;
  if (!parent) return child;
  parent.children.splice(parent.children.indexOf(child), 1);
  child.parentElement = null;
  return child;
}

/** A body of one <p> per block text. Returns {root, blocks}. */
function pageOf(blocks) {
  const root = el("body");
  const nodes = blocks.map(function (text) {
    return append(root, el("p", { text: text }));
  });
  return { root: root, blocks: nodes };
}

/** Wrap a node in a new element, in place. */
function wrap(node, tag) {
  const parent = node.parentElement;
  const index = parent.children.indexOf(node);
  parent.children.splice(index, 1);
  const wrapper = el(tag);
  append(wrapper, node);
  insertAt(parent, wrapper, index);
  return wrapper;
}

/** Mint against block `index` of `blocks`, failing loud if the mint failed. */
function mintBlock(page, index) {
  const ref = anchor.mint({ element: page.blocks[index], root: page.root });
  assert.equal(ref.ok, true, "mint should have succeeded: " + JSON.stringify(ref.failure));
  return ref;
}

// ---------------------------------------------------------------------------
// The corpus, the same one the predicate is judged against
// ---------------------------------------------------------------------------

test("mint stores the region's text plus one whole sibling on each side", () => {
  const page = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(page, 1);
  assert.equal(ref.probe, corpus.REFERENCE.probe);
  assert.equal(ref.prefix, corpus.REFERENCE.prefix, "the whole preceding sibling, normalized");
  assert.equal(ref.suffix, corpus.REFERENCE.suffix, "the whole following sibling, normalized");
});

test("the fixture corpus: the real DOM engine lands where the predicate lands", () => {
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  for (const c of corpus.CASES) {
    const page = pageOf(c.blocks);
    const got = anchor.resolve(ref, page.root);
    assert.equal(got.bound, c.expect.bound, `${c.name}: expected bound=${c.expect.bound}, got ${got.bound} (${got.reason})`);
    assert.equal(got.reason, c.expect.reason, `${c.name}: expected reason=${c.expect.reason}, got ${got.reason}`);
    if (c.expect.bound) {
      // The right node is the copy that still has the stored neighbour above
      // it, which is the only thing that makes "the right node" well defined in
      // the duplicated case.
      const flat = (n) => n.textContent.replace(/\s+/g, " ").trim();
      const matches = page.blocks.filter((b) => flat(b) === corpus.REFERENCE.probe);
      const wanted =
        matches.find((b) => {
          const at = page.blocks.indexOf(b);
          return at > 0 && flat(page.blocks[at - 1]) === corpus.REFERENCE.prefix;
        }) || matches[0];
      assert.equal(got.element, wanted, `${c.name}: bound to the wrong node`);
    } else {
      assert.equal(got.element, null, `${c.name}: a non-binding verdict writes nothing`);
      assert.equal(typeof got.failureCode, "string", `${c.name}: an honest failure names its code`);
    }
  }
});

test("a non-binding verdict carries the same failure codes the predicate assigns", () => {
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  const deleted = corpus.CASES.find((c) => c.name === "region_deleted");
  assert.equal(anchor.resolve(ref, pageOf(deleted.blocks).root).failureCode, "ANCHOR_NO_TEXT_MATCH");

  const dup = corpus.CASES.find((c) => c.name === "same_paragraph_duplicated");
  assert.equal(anchor.resolve(ref, pageOf(dup.blocks).root).failureCode, "ANCHOR_AMBIGUOUS");
});

// ---------------------------------------------------------------------------
// Occurrence four of five
// ---------------------------------------------------------------------------

const REPEATED = "Warm up for ten minutes";

/** Five identical regions, each with its own neighbours. Returns page + the five. */
function fiveOccurrences() {
  const root = el("body");
  const occurrences = [];
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].forEach(function (day, i) {
    append(root, el("p", { text: "Session " + (i + 1) + " is on " + day + "." }));
    occurrences.push(append(root, el("p", { text: REPEATED })));
    append(root, el("p", { text: "Then cool down and log the " + day + " session." }));
  });
  return { root: root, occurrences: occurrences };
}

test("targeting occurrence four of five survives the deletion of occurrence two", () => {
  const page = fiveOccurrences();
  const target = page.occurrences[3];
  const ref = anchor.mint({ element: target, root: page.root });
  assert.equal(ref.ok, true, "context makes occurrence four unique: " + JSON.stringify(ref.failure));

  const before = anchor.resolve(ref, page.root);
  assert.equal(before.bound, true);
  assert.equal(before.element, target);

  remove(page.occurrences[1]);

  const after = anchor.resolve(ref, page.root);
  assert.equal(after.bound, true, "occurrence four is still there and still unique: " + after.reason);
  assert.equal(after.element, target, "bound to occurrence four, not to a neighbour that shifted into its place");
});

// ---------------------------------------------------------------------------
// The transformation set
// ---------------------------------------------------------------------------
//
// The bar: same node, or an honest failure. Never a different node.

function assertSameNodeOrHonestFailure(verdict, wanted, label) {
  if (verdict.bound) {
    assert.equal(verdict.element, wanted, label + ": bound to a DIFFERENT node, which is the one forbidden outcome");
    return "bound";
  }
  assert.equal(verdict.element, null, label + ": a failure writes nothing");
  assert.equal(typeof verdict.failureCode, "string", label + ": a failure names its code");
  assert.notEqual(verdict.reason, undefined, label + ": a failure names its reason");
  return "failed honestly";
}

test("transformation: whitespace expansion and collapse both resolve to the same node", () => {
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  const expanded = pageOf(
    corpus.ORIGINAL.map(function (t) {
      return "\n   " + t.replace(/ /g, "  ") + "\t\n";
    })
  );
  const collapsed = pageOf(
    corpus.ORIGINAL.map(function (t) {
      return t.replace(/\s+/g, " ").trim();
    })
  );

  const a = anchor.resolve(ref, expanded.root);
  assert.equal(a.bound, true, "whitespace expansion is not a move: " + a.reason);
  assert.equal(a.element, expanded.blocks[1]);

  const b = anchor.resolve(ref, collapsed.root);
  assert.equal(b.bound, true);
  assert.equal(b.element, collapsed.blocks[1]);
});

test("transformation: sibling blocks reordered", () => {
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  const page = pageOf(corpus.ORIGINAL);
  const target = page.blocks[1];
  // Move the region to the end, and shuffle what is left.
  remove(target);
  const first = remove(page.blocks[0]);
  append(page.root, target);
  append(page.root, first);

  const verdict = anchor.resolve(ref, page.root);
  assertSameNodeOrHonestFailure(verdict, target, "reordered siblings");
  assert.equal(verdict.bound, true, "the text is still unique on the page, so it still binds");
  assert.equal(verdict.element, target);
});

test("transformation: a duplicate paragraph inserted elsewhere", () => {
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  const page = pageOf(corpus.ORIGINAL);
  const target = page.blocks[1];
  append(page.root, el("p", { text: "An unrelated heading for the appendix." }));
  append(page.root, el("p", { text: corpus.REFERENCE.probe }));
  append(page.root, el("p", { text: "An unrelated closing for the appendix." }));

  const verdict = anchor.resolve(ref, page.root);
  assertSameNodeOrHonestFailure(verdict, target, "duplicate appended after the region");
});

test("transformation: a duplicate paragraph inserted BEFORE the region", () => {
  // The same transformation from the other side, which is the half that catches
  // an engine taking the first match: here the first match is the copy.
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  const page = pageOf(corpus.ORIGINAL);
  const target = page.blocks[1];
  insertAt(page.root, el("p", { text: "An unrelated opening for the summary." }), 0);
  insertAt(page.root, el("p", { text: corpus.REFERENCE.probe }), 1);
  insertAt(page.root, el("p", { text: "An unrelated closing for the summary." }), 2);

  const verdict = anchor.resolve(ref, page.root);
  assertSameNodeOrHonestFailure(verdict, target, "duplicate inserted before the region");
  assert.equal(verdict.bound, true, "the stored context still names only the original: " + verdict.reason);
  assert.equal(verdict.element, target);
});

test("transformation: a neighbouring block deleted", () => {
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  const page = pageOf(corpus.ORIGINAL);
  const target = page.blocks[1];
  remove(page.blocks[0]);

  const verdict = anchor.resolve(ref, page.root);
  assertSameNodeOrHonestFailure(verdict, target, "neighbour deleted");
  assert.equal(verdict.bound, true, "losing a neighbour is not losing the region: " + verdict.reason);
});

test("transformation: a wrapper element added around the region", () => {
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  const page = pageOf(corpus.ORIGINAL);
  const target = page.blocks[1];
  wrap(target, "div");

  const verdict = anchor.resolve(ref, page.root);
  assertSameNodeOrHonestFailure(verdict, target, "wrapper added");
  assert.equal(verdict.bound, true, "a wrapper is not a move: " + verdict.reason);
  assert.equal(verdict.element, target, "the innermost element holding the text, never the new wrapper");
});

test("transformation: a wrapper added around a region that is ALSO duplicated", () => {
  // The wrapper empties the region's own sibling list. If the engine read
  // context from the wrapper's inside, the true node would be eliminated and a
  // duplicate elsewhere could win, which is the forbidden outcome.
  const origin = pageOf(corpus.ORIGINAL);
  const ref = mintBlock(origin, 1);

  const page = pageOf(corpus.ORIGINAL);
  const target = page.blocks[1];
  wrap(target, "div");
  append(page.root, el("p", { text: "An unrelated heading for the appendix." }));
  append(page.root, el("p", { text: corpus.REFERENCE.probe }));

  const verdict = anchor.resolve(ref, page.root);
  assertSameNodeOrHonestFailure(verdict, target, "wrapper plus duplicate");
});

// ---------------------------------------------------------------------------
// Widening: the unit and the stopping rule
// ---------------------------------------------------------------------------

test("widening happens by whole sibling elements, outward from the region", () => {
  // One sibling on each side is not enough here: the block above and below the
  // region are the same in both copies. Two siblings out, they differ.
  const page = pageOf([
    "Opening note for the first copy.",
    "Shared line above.",
    "The repeated region.",
    "Shared line below.",
    "Opening note for the second copy.",
    "Shared line above.",
    "The repeated region.",
    "Shared line below."
  ]);
  const ref = anchor.mint({ element: page.blocks[2], root: page.root });
  assert.equal(ref.ok, true, "widening should have found a unique context: " + JSON.stringify(ref.failure));
  assert.equal(
    ref.prefix,
    "Opening note for the first copy. Shared line above.",
    "two whole siblings, nearest last, and nothing smaller than a sibling"
  );

  const verdict = anchor.resolve(ref, page.root);
  assert.equal(verdict.bound, true);
  assert.equal(verdict.element, page.blocks[2]);
  assert.equal(verdict.reason, uniqueness.REASON.CONTEXT_ELIMINATED_RIVALS);
});

test("widening stops at the containing block, and mint then fails honestly", () => {
  // Three identical items in one list with nothing around them to tell the
  // first from the second. Position could pick one; D9 says position never
  // places a write, so mint refuses rather than widening to the document.
  const root = el("body");
  const list = append(root, el("ul"));
  const items = [1, 2, 3].map(function () {
    return append(list, el("li", { text: REPEATED }));
  });
  append(root, el("p", { text: "A paragraph outside the list that would make item one unique." }));

  const ref = anchor.mint({ element: items[0], root: root });
  assert.equal(ref.ok, false, "the containing block is exhausted and the region is still not unique");
  assert.equal(ref.failure.reason, anchor.MINT_FAILURE.NOT_UNIQUE_IN_BLOCK);
  assert.equal(ref.failure.failureCode, "ANCHOR_AMBIGUOUS");
});

test("mint fails honestly on a region with no text at all", () => {
  const root = el("body");
  const empty = append(root, el("p", { text: "   " }));
  append(root, el("p", { text: "Something else." }));
  const ref = anchor.mint({ element: empty, root: root });
  assert.equal(ref.ok, false);
  assert.equal(ref.failure.reason, anchor.MINT_FAILURE.EMPTY_PROBE);
});

// ---------------------------------------------------------------------------
// The rules that must not erode
// ---------------------------------------------------------------------------

test("the engine defers the whole write decision to the shared predicate", () => {
  const source = require("node:fs").readFileSync(require.resolve("../../src/layer/anchor.js"), "utf8");
  assert.match(source, /uniqueness\.selectUnique/, "the verdict comes from the shared predicate");
  assert.equal(
    /threshold|confidence|\bscore\b/i.test(source.replace(/^\s*\/\/.*$/gm, "")),
    false,
    "no scalar may creep into the engine's code"
  );
});

test("a structure-only match corroborates and can never place a write", () => {
  // The author named the region, and then its text was rewritten entirely. The
  // attribute is enough to say where it used to be and never enough to write.
  const root = el("body");
  append(root, el("p", { text: "Something before.", attrs: {} }));
  const named = append(root, el("p", { text: "The original sentence.", attrs: { "data-review-region": "pitch" } }));
  append(root, el("p", { text: "Something after." }));

  const ref = anchor.mint({ element: named, root: root });
  assert.equal(ref.ok, true);
  assert.equal(ref.attr, "pitch");

  named.ownText = "A completely different sentence with none of the old words in it.";
  const verdict = anchor.resolve(ref, root);
  assert.equal(verdict.bound, false);
  assert.equal(verdict.reason, uniqueness.REASON.STRUCTURE_ONLY);
  assert.equal(verdict.failureCode, "ANCHOR_STRUCTURE_ONLY");
  assert.equal(verdict.element, null);
});

test("resolve survives a caller with no document at all", () => {
  // 0A-kernel's throwaway consumer calls resolve(ref, null). It must answer
  // honestly rather than throwing at the boot of a page that has no root yet.
  const ref = anchor.mint({ element: { textContent: "a paragraph" } });
  const verdict = anchor.resolve(ref, null);
  assert.equal(verdict.bound, false);
  assert.equal(verdict.element, null);
});

// ---------------------------------------------------------------------------
// The element anchor: a region with no text (D9, RF19)
// ---------------------------------------------------------------------------
//
// The reviewer's bug, as a fixture. Three images in a row, each in its own
// wrapper, under one heading. Every one of them minted an empty probe, stored
// the failure as though it were a reference, and labelled itself "img 1".

const regions = require("../../src/shared/regions.js");

/** A heading, then a row of images, each in its own wrapper. Returns {root, images}. */
function imageRow(specs) {
  const root = el("body");
  append(root, el("h2", { text: "1. Wordmark on its ink rectangle" }));
  const row = append(root, el("div"));
  const images = specs.map(function (spec) {
    const wrapper = append(row, el("div"));
    return append(wrapper, el("img", { attrs: spec }));
  });
  return { root: root, images: images };
}

function labelOf(element, root) {
  return regions.labelFor(anchor.descriptorFor(element, root)).label;
}

test("an image mints from its src, because the src is what the image IS", () => {
  const page = imageRow([{ src: "logo-square-b@2x.png", alt: "Square badge, 70% fill" }]);
  const ref = anchor.mint({ element: page.images[0], root: page.root });

  assert.equal(ref.ok, true, "an image is anchorable: " + JSON.stringify(ref.failure));
  assert.equal(ref.probe_kind, anchor.PROBE.ELEMENT, "no text, so the probe is the element signature");
  assert.match(ref.probe, /logo-square-b@2x\.png/, "the signature carries the src the author wrote");
  assert.equal(regions.lostFromMint(ref), null, "a reference that minted is not lost");

  const verdict = anchor.resolve(ref, page.root);
  assert.equal(verdict.bound, true, "and it finds the same image again: " + verdict.reason);
  assert.equal(verdict.element, page.images[0]);
});

test("three sibling images mint three distinct references and three distinct labels", () => {
  const page = imageRow([
    { src: "logo-square-a@2x.png", alt: "Square badge, 40% fill" },
    { src: "logo-square-b@2x.png", alt: "Square badge, 70% fill" },
    { src: "logo-square-c@2x.png", alt: "Square badge, full" }
  ]);

  const refs = page.images.map(function (img) {
    return anchor.mint({ element: img, root: page.root });
  });
  refs.forEach(function (ref, i) {
    assert.equal(ref.ok, true, "image " + i + " should mint: " + JSON.stringify(ref.failure));
  });

  // Each one resolves to ITS OWN image. This is the reviewer's failure: he
  // pointed at the middle one and his agent could not tell which he meant.
  page.images.forEach(function (img, i) {
    const verdict = anchor.resolve(refs[i], page.root);
    assert.equal(verdict.bound, true, "image " + i + " resolves: " + verdict.reason);
    assert.equal(verdict.element, img, "image " + i + " resolved to a DIFFERENT image");
  });

  const labels = page.images.map(function (img) {
    return labelOf(img, page.root);
  });
  assert.deepEqual(labels, [
    "img logo-square-a@2x.png",
    "img logo-square-b@2x.png",
    "img logo-square-c@2x.png"
  ]);
  assert.equal(new Set(labels).size, 3, "three cards in the rail must not read identically");
});

test("wrapped images are still counted 1, 2, 3 through the heading's section", () => {
  const page = imageRow([{ src: "a.png" }, { src: "b.png" }, { src: "c.png" }]);
  const ordinals = page.images.map(function (img) {
    return anchor.ordinalInSection(img, page.root);
  });
  // Counted among immediate siblings, which is what both callers used to do,
  // every one of these is 1: each image is an only child of its own wrapper.
  assert.deepEqual(ordinals, [1, 2, 3]);
});

test("two images sharing one src are ambiguous, exactly like two identical list items", () => {
  const page = imageRow([
    { src: "logo-square-b@2x.png", alt: "Square badge" },
    { src: "logo-square-b@2x.png", alt: "Square badge" }
  ]);
  const ref = anchor.mint({ element: page.images[1], root: page.root });

  assert.equal(ref.ok, false, "a page cannot tell these two apart, and neither may we");
  assert.equal(ref.failure.failureCode, "ANCHOR_AMBIGUOUS");
  const lost = regions.lostFromMint(ref);
  assert.equal(lost.code, "ANCHOR_AMBIGUOUS", "and the failure is stamped, not swallowed");
});

test("a failed mint is stamped lost, so no item can read as healthy with a dead anchor", () => {
  // An image with nothing identifying about it: no src, no alt, no srcset.
  const root = el("body");
  append(root, el("p", { text: "Some words before." }));
  const orphan = append(root, el("img", { attrs: {} }));

  const ref = anchor.mint({ element: orphan, root: root });
  assert.equal(ref.ok, false);
  assert.equal(ref.failure.reason, anchor.MINT_FAILURE.EMPTY_PROBE);

  const lost = regions.lostFromMint(ref);
  assert.equal(lost.code, "ANCHOR_NO_TEXT_MATCH");
  assert.equal(typeof lost.at, "string", "the stamp says when the anchor died");
  // The exact shape the record stores, so a reader of review.json sees it.
  const region = { ref: ref, label: null, lost: regions.lostFromMint(ref) };
  assert.notEqual(region.lost, null, "the record that started this bug said lost: null here");
});

test("an svg is reachable by its own title, and its text still never joins the page's prose", () => {
  const root = el("body");
  const para = append(root, el("p", { text: "Read the chart." }));
  const graphic = append(root, el("svg", { attrs: { "aria-label": null } }));
  append(graphic, el("title", { text: "Revenue by quarter" }));
  append(graphic, el("text", { text: "Q1" }));

  const ref = anchor.mint({ element: graphic, root: root });
  assert.equal(ref.ok, true, "pick mode hands these over, so the engine has to reach them: " + JSON.stringify(ref.failure));
  assert.equal(ref.probe_kind, anchor.PROBE.ELEMENT);
  assert.match(ref.probe, /Revenue by quarter/);

  const verdict = anchor.resolve(ref, root);
  assert.equal(verdict.bound, true);
  assert.equal(verdict.element, graphic);

  // And the text walk still refuses to enter it: a probe minted on the
  // paragraph must not pick up "Q1" or the chart's title.
  const textRef = anchor.mint({ element: para, root: root });
  assert.equal(textRef.probe_kind, anchor.PROBE.TEXT);
  assert.equal(textRef.probe, "Read the chart.");
  assert.equal(textRef.suffix.indexOf("Revenue"), -1, "an svg's title is not the page's prose");
});

test("the subject carries what the element is: the raw src, the alt, and the opening tag", () => {
  const root = el("body");
  const figure = append(root, el("figure"));
  const image = append(figure, el("img", { attrs: { src: "logo-square-b@2x.png", alt: "Square badge, 70% fill", width: "400" } }));
  append(figure, el("figcaption", { text: "B, 70% fill" }));

  const subject = anchor.subjectFor(image, root);
  assert.equal(subject.tag, "img");
  assert.equal(subject.src, "logo-square-b@2x.png", "the attribute as the author wrote it, not a resolved URL");
  assert.equal(subject.alt, "Square badge, 70% fill");
  assert.match(subject.html, /^<img /, "the opening tag only");
  assert.equal(subject.html.indexOf("</"), -1, "never the subtree");
  assert.match(subject.html, /src="logo-square-b@2x\.png"/);
  assert.equal(subject.near, "B, 70% fill", "the caption is what a person would say to point at it");
});

test("the opening tag never carries the library's own attributes", () => {
  const root = el("body");
  const image = append(root, el("img", { attrs: { src: "a.png", "data-lahe": "chrome", "data-lahe-protected": "1" } }));
  const html = anchor.openingTagOf(image);
  assert.equal(html.indexOf("data-lahe"), -1, "nothing the library added reaches a record (R23, R33)");
  assert.match(html, /src="a\.png"/);
});

test("an attribute value cannot break out of the opening tag it is quoted in", () => {
  const root = el("body");
  const image = append(root, el("img", { attrs: { src: "a.png", alt: '"><script>alert(1)</script>' } }));
  const html = anchor.openingTagOf(image);
  assert.equal(html.indexOf("<script"), -1, "the value is escaped, so it stays a value");
  assert.match(html, /&quot;/);
});
