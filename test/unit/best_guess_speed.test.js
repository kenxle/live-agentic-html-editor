// read-when: The best-guess pass for a lost comment is slow, or you change how
// pointing.js or anchor.js read headings, context or paths for every element.
//
// A lost comment freezes a big page. Seneschal's knowledge tree preview has
// about 4,200 elements nested about 24 deep, and one comment whose words were
// rewritten. Every load ran pointing.bestGuess over every element, and each
// element re-read its heading and its neighbours' text from scratch: the tab
// froze for about 26 seconds.
//
// This builds a page of that size and shape over a simulated DOM (jsdom is
// banned; see test/helpers/README.md) and times one best-guess pass. The
// budget is generous on purpose: before the fix this pass took many seconds
// here, after it a small fraction of one, so the line between them is wide
// enough not to flake on a slow machine.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchor = require("../../src/layer/anchor.js");
const pointing = require("../../src/layer/pointing.js");
const page = require("../helpers/simulated_page.js");

const BUDGET_MS = 1500;

test("the best guess for a lost comment on a 4,000-element page stays under budget", () => {
  const built = page.knowledgeTree();
  assert.ok(built.count >= 3800 && built.count <= 4600, "page size: " + built.count);
  assert.ok(built.depth >= 22, "page depth: " + built.depth);

  const ref = anchor.mint({ element: built.target, root: built.body });
  assert.equal(ref.ok, true, "mint should succeed: " + JSON.stringify(ref.failure));

  // The agent rewrote the passage, so its words no longer find it.
  page.setText(built.target, "Rewritten by the agent so nothing matches the stored words.");
  assert.equal(anchor.resolve(ref, built.body).element, null, "the comment is lost");

  const started = process.hrtime.bigint();
  const guess = pointing.bestGuess(ref, built.body);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(guess.element, built.target, "and the guess still points at the rewritten passage");
  assert.ok(ms < BUDGET_MS, "best guess took " + ms.toFixed(0) + " ms, budget " + BUDGET_MS + " ms");
});

// A comment on the first item of a long list is minted with an empty prefix,
// and on the last with an empty suffix. Every candidate's context on that side
// is then every sibling's text joined, and it must not be normalized only to be
// compared with nothing.
for (const which of ["first", "last"]) {
  test("the best guess for a lost comment on the " + which + " item of a 4,000-item list stays under budget", () => {
    const rows = [];
    for (let i = 0; i < 4000; i += 1) {
      rows.push({ tag: "li", attrs: { class: "row" }, text: "row number " + i + " with some words in it" });
    }
    const body = page.build({ tag: "body", children: [{ tag: "h2", text: "List" }, { tag: "ul", children: rows }] });
    const list = body.children[1].children;
    const target = which === "first" ? list[0] : list[list.length - 1];
    const ref = anchor.mint({ element: target, root: body });
    assert.equal(ref.ok, true, "mint should succeed: " + JSON.stringify(ref.failure));
    assert.equal(which === "first" ? ref.prefix : ref.suffix, "", "the outer side has no context");
    page.setText(target, "Rewritten by the agent so nothing matches the stored words.");

    const started = process.hrtime.bigint();
    pointing.bestGuess(ref, body);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;

    assert.ok(ms < BUDGET_MS, "best guess took " + ms.toFixed(0) + " ms, budget " + BUDGET_MS + " ms");
  });
}
