// read-when: You change the pass index in anchor.js (withPassIndex), or the
// heading, context, path or ordinal readers it stands in for.
//
// The pass index is a speed-up and nothing else. pointing.bestGuess asks every
// element on the page for its heading, its neighbours' text and its path, and
// inside anchor.withPassIndex those answers come from one shared read of the
// page instead of a fresh walk per element. If any answer differed, a lost
// comment could point somewhere else after the speed-up than before it.
//
// So every test here asks the same question twice, once of the walk and once
// of the index, for every element on the page, and requires the same answer.
// The walk runs under the text memo only, which mint has always used and which
// changes no answer, so the comparison stays quick.
//
// The pages: hand-built ones for each corner of the heading walk (its budget
// running out in a long list, inside a heading, and on the forward look from
// an empty icon; skipped and tool elements; nested and empty headings), the
// knowledge tree page the speed test uses, and seeded random pages.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchor = require("../../src/layer/anchor.js");
const pointing = require("../../src/layer/pointing.js");
const sim = require("../helpers/simulated_page.js");

// ---------------------------------------------------------------------------
// Comparing the walk with the index
// ---------------------------------------------------------------------------

const CONTEXT_REFS = [
  { prefix: "", suffix: "" },
  { prefix: "abc", suffix: "abcdefgh" },
  { prefix: "x".repeat(400), suffix: "y".repeat(400) },
  { prefix: "abcdef", suffix: "abc", context_level: 1 },
  { prefix: "abcdefghijkl", suffix: "abcdefghijkl", context_level: 3 },
  { prefix: null, suffix: undefined, context_level: 9 }
];

function allElements(scope) {
  const out = [];
  anchor.eachElement(scope, (node) => out.push(node));
  return out;
}

// The walk reads every sibling's text for every element, so on a list of two
// thousand items it is slow by design. `contextEvery` reads the context of
// every k-th element there (the first and last always), and the heading, path
// and fingerprint of all of them.
function readings(nodes, scope, contextEvery) {
  const every = contextEvery || 1;
  return nodes.map((node, i) => ({
    heading: anchor.headingOf(node, scope),
    path: anchor.pathOf(node, scope),
    fingerprint: anchor.fingerprintOf(node, scope),
    context:
      i % every === 0 || i === nodes.length - 1
        ? CONTEXT_REFS.map((ref) => anchor.foundContextFor(node, scope, ref))
        : null
  }));
}

function describe(node) {
  const id = node.getAttribute("id");
  return node.tagName.toLowerCase() + (id ? "#" + id : "") + " " + JSON.stringify(String(node.textContent).slice(0, 40));
}

/** Every element reads the same through the walk and through the index. */
function assertSameReadings(body, contextEvery) {
  const scope = anchor.scopeOf(body, null);
  const nodes = allElements(scope);
  const walked = anchor.withTextMemo(() => readings(nodes, scope, contextEvery));
  const indexed = anchor.withPassIndex(scope, () => readings(nodes, scope, contextEvery));
  for (let i = 0; i < nodes.length; i += 1) {
    assert.deepEqual(indexed[i], walked[i], "element " + i + ": " + describe(nodes[i]));
  }
  return { nodes: nodes, walked: walked };
}

/** Every element scores the same against `ref` through the walk and through the index. */
function assertSameScores(body, ref, options) {
  const scope = anchor.scopeOf(body, null);
  const nodes = allElements(scope);
  const knownPath = (options && options.knownPath) || null;
  const knownPrint = (options && options.knownPrint) || null;
  const score = () => nodes.map((node) => pointing.scoreAgainst(ref, node, scope, knownPath, knownPrint));
  const walked = anchor.withTextMemo(score);
  const indexed = anchor.withPassIndex(scope, score);
  for (let i = 0; i < nodes.length; i += 1) {
    assert.deepEqual(indexed[i], walked[i], "score of element " + i + ": " + describe(nodes[i]));
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function t(tag, text, attrs) {
  return { tag: tag, text: text, attrs: attrs };
}

function n(tag, children, attrs) {
  return { tag: tag, children: children, attrs: attrs };
}

function many(count, make) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(make(i));
  return out;
}

const OVER_BUDGET = anchor.HEADING_SCAN_CAP + 150;

// ---------------------------------------------------------------------------
// The heading walk's corners
// ---------------------------------------------------------------------------

test("a long list runs the heading budget out partway: the same elements find the heading and the same ones do not", () => {
  const body = sim.build(
    n("body", [
      t("h2", "Top of the page"),
      n("div", many(OVER_BUDGET, (i) => t("span", "item " + i)), { id: "wide" }),
      t("p", "after the list"),
      n("div", [t("p", "deeper after the list")])
    ])
  );
  const seen = assertSameReadings(body, 97);
  const headings = seen.walked.map((r) => r.heading);
  assert.ok(headings.includes("Top of the page"), "some elements reach the heading");
  assert.ok(headings.includes(null), "and some run out of budget first");
});

test("a budget that runs out INSIDE a heading still returns that heading, as the walk does", () => {
  const body = sim.build(
    n("body", [
      n("section", [n("h3", many(OVER_BUDGET, (i) => t("span", "word " + i)))]),
      t("p", "after the big heading", { id: "after" })
    ])
  );
  const seen = assertSameReadings(body, 97);
  const after = seen.nodes.findIndex((node) => node.getAttribute("id") === "after");
  // The simulated textContent runs the spans together, as the real one does.
  assert.match(String(seen.walked[after].heading), /^word 0word 1/, "the walk's own answer, budget spent");
});

test("an empty icon looks forward for its own panel heading, and that look has a budget too", () => {
  const body = sim.build(
    n("body", [
      t("h2", "Earlier panel"),
      n("div", [t("span", "", { id: "icon-a" }), t("h3", "Panel A"), t("p", "panel a words")]),
      n("div", [t("span", "", { id: "icon-b" }), t("p", "text first"), t("h3", "Panel B")]),
      n("div", [t("span", "", { id: "icon-c" }), ...many(OVER_BUDGET, () => t("i", "")), t("h3", "Panel C")]),
      n("div", [n("svg", [t("title", "a drawing")], { id: "icon-d" }), t("h3", "Panel D")]),
      n("div", [t("span", "", { id: "icon-e" }), t("h3", ""), t("h4", "Panel E")])
    ])
  );
  const seen = assertSameReadings(body, 97);
  const headingOf = (id) => seen.walked[seen.nodes.findIndex((node) => node.getAttribute("id") === id)].heading;
  assert.equal(headingOf("icon-a"), "Panel A");
  // Text after it stops the forward look, so it climbs and finds the last
  // heading in the panel before.
  assert.equal(headingOf("icon-b"), "Panel A");
  assert.equal(headingOf("icon-c"), null);
  assert.equal(headingOf("icon-d"), "Panel D");
  assert.equal(headingOf("icon-e"), "Panel E");
});

test("skipped elements, tool chrome, nested and wordless headings read the same", () => {
  const body = sim.build(
    n("body", [
      t("h1", "Title"),
      n("script", [t("h2", "inside a script")]),
      n("div", [t("h2", "inside chrome"), t("span", "chip")], { "data-lahe": "chrome" }),
      t("p", "after the skipped ones"),
      n("h2", [t("span", "Outer "), t("h3", "inner heading")]),
      t("p", "under the nested heading"),
      t("h3", "   "),
      t("p", "under a wordless heading"),
      n("div", [n("canvas", []), t("p", "beside a canvas")]),
      n("ul", many(5, (i) => n("li", [t("b", "term " + i), t("span", i % 2 ? "" : "def " + i)]))),
      n("pre", [t("code", "line one\nline two")]),
      t("p", "a\u0301ccent and \u200Bzero width and\u00A0nbsp"),
      t("p", "\u0301leading mark"),
      t("p", "e\u200B\u0301 joins only after the invisible goes")
    ])
  );
  assertSameReadings(body);
});

// ---------------------------------------------------------------------------
// The page the speed test uses, and its scores
// ---------------------------------------------------------------------------

test("every element of the 4,000-element knowledge tree reads and scores the same", () => {
  const built = sim.knowledgeTree();
  assertSameReadings(built.body);
  const ref = anchor.mint({ element: built.target, root: built.body });
  assert.equal(ref.ok, true);
  sim.setText(built.target, "Rewritten so the stored words are gone.");
  assertSameScores(built.body, ref);
  const scope = anchor.scopeOf(built.body, null);
  const known = pointing.snapshot(built.target, built.body);
  assertSameScores(built.body, ref, { knownPath: known.path, knownPrint: known.fingerprint });
  assert.equal(anchor.pathOf(built.target, scope), known.path);
});

// ---------------------------------------------------------------------------
// Seeded random pages
// ---------------------------------------------------------------------------

function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Containers hold children. Leaves include the tags the text walk skips, so a
// skipped element is a sibling the scans step over rather than an ancestor
// that hides most of the page; a few skipped containers still hold a heading.
const CONTAINERS = [
  "div", "div", "section", "p", "span", "span", "b", "ul", "li", "li", "details", "summary",
  "h2", "h3", "pre"
];
const LEAVES = [
  "p", "p", "span", "span", "b", "a", "li", "h2", "h3", "h4", "code", "img", "br",
  "script", "style", "svg", "canvas", "template"
];
const TEXTS = [
  "", "", "   ", "alpha beta", "gamma", "Results", "Results", "delta epsilon zeta", "é",
  "​", " ", "́mark first", "same words", "same words", "line\nbreak"
];

function randomSpec(rng, budget, depth) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  function attrsFor() {
    const attrs = {};
    if (rng() < 0.3) attrs.class = pick(["card", "card pill", "lahe-mark card", "row", ""]);
    if (rng() < 0.05) attrs.id = "id" + Math.floor(rng() * 1000);
    if (rng() < 0.02) attrs["data-lahe"] = "chrome";
    return attrs;
  }
  function grow(level) {
    budget.left -= 1;
    if (level < depth && rng() < 0.6) {
      const kids = [];
      // Mostly a few children, sometimes a long run of them.
      const count = 1 + Math.floor(rng() * (rng() < 0.08 ? 60 : 4));
      for (let i = 0; i < count && budget.left > 0; i += 1) kids.push(grow(level + 1));
      const tag = rng() < 0.03 ? pick(["script", "svg", "template"]) : pick(CONTAINERS);
      return { tag: tag, attrs: attrsFor(), children: kids };
    }
    return { tag: pick(LEAVES), attrs: attrsFor(), text: pick(TEXTS) };
  }
  const top = [];
  while (budget.left > 0) top.push(grow(1));
  return { tag: "body", children: top };
}

// Seeds whose page is mostly walkable (some seeds put a skipped tag at the top
// and hide nearly everything). The three big ones run the heading budget out.
const RANDOM_PAGES = [
  [1, 400], [2, 400], [3, 400], [5, 400], [6, 400],
  [8, 3000], [9, 3000], [12, 3000]
];

for (const [seed, size] of RANDOM_PAGES) {
  test("random page " + seed + ": every element reads and scores the same", () => {
    const rng = seeded(seed);
    const body = sim.build(randomSpec(rng, { left: size }, seed % 2 ? 8 : 24));
    const seen = assertSameReadings(body, size > 1000 ? 13 : 1);
    assert.ok(seen.nodes.length > size / 3, "most of the page is walkable: " + seen.nodes.length);
    for (let k = 0; k < 3; k += 1) {
      const target = seen.nodes[Math.floor(rng() * seen.nodes.length)];
      const ref = anchor.mint({ element: target, root: body });
      assertSameScores(body, ref);
      const known = pointing.snapshot(target, body);
      assertSameScores(body, ref, { knownPath: known.path, knownPrint: known.fingerprint });
    }
  });
}

test("the index is gone after the pass, and a nested pass for another scope does not borrow it", () => {
  const body = sim.build(n("body", [t("h2", "Head"), n("div", [t("p", "one"), t("p", "two")])]));
  const inner = body.children[1];
  const p = inner.children[1];
  const walked = anchor.headingOf(p, body);
  anchor.withPassIndex(body, () => {
    assert.equal(anchor.headingOf(p, body), walked);
    // A different scope inside the pass walks rather than reading the index.
    assert.equal(anchor.headingOf(p, inner), anchor.withTextMemo(() => anchor.headingOf(p, inner)));
    assert.equal(anchor.pathOf(p, inner), "div>p:2");
  });
  assert.equal(anchor.pathOf(p, body), "body>div:1>p:2");
});
