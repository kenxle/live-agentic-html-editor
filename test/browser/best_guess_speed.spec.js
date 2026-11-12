// read-when: The best-guess pass for a lost comment is slow in a real browser,
// or you change the pass index in anchor.js.
//
// test/unit/best_guess_speed.test.js and test/unit/pass_index.test.js prove
// the speed and the sameness over a simulated DOM. This file proves both on a
// real one: Chromium's text nodes, live child collections and the whitespace
// a real page carries.
//
// The page is the generated knowledge tree (4,000 elements, 26 deep, few
// headings), the shape of the Seneschal page that froze for 26 seconds on
// every load because of one lost comment. The layer bundle is built in memory
// from source, as in anchor_engine.spec.js, so dist/ is not needed.

"use strict";

const { test, expect } = require("../helpers");
const sim = require("../helpers/simulated_page.js");
const { layerBundle } = require("./support/bundles");

// Generous: the pass took tens of seconds before the fix and well under a
// second after it, so a slow machine does not flake this.
const BUDGET_MS = 1500;

// The page is answered by Playwright at an http address rather than set on
// about:blank: the whole layer loads, and its store reads localStorage as it
// loads, which about:blank refuses.
const PAGE_URL = "http://knowledge-tree.test/";

async function loadKnowledgeTree(page) {
  // Whitespace between the tags, as a hand-written page has, so the real
  // text nodes the simulated DOM lacks are on this page.
  const html = sim.toHtml(sim.knowledgeTreeSpec()).replace(/></g, ">\n  <");
  await page.route(PAGE_URL, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><head><title>Knowledge tree</title></head>" + html + "</html>"
    })
  );
  await page.goto(PAGE_URL);
  await page.addScriptTag({ content: await layerBundle() });
  expect(await page.evaluate(() => typeof window.LAHE.pointing.bestGuess)).toBe("function");
}

test("the best guess for a lost comment on a 4,000-element page stays under budget", async ({ page }) => {
  await loadKnowledgeTree(page);
  const result = await page.evaluate((targetPath) => {
    const anchor = window.LAHE.anchor;
    const pointing = window.LAHE.pointing;
    let target = document.body;
    targetPath.forEach((i) => (target = target.children[i]));
    const ref = anchor.mint({ element: target, root: document });
    target.textContent = "Rewritten by the agent so nothing matches the stored words.";
    const lost = anchor.resolve(ref, document).element === null;
    const started = performance.now();
    const guess = pointing.bestGuess(ref, document);
    const ms = performance.now() - started;
    return {
      count: document.body.querySelectorAll("*").length,
      minted: ref.ok,
      lost: lost,
      found: guess.element === target,
      ms: ms
    };
  }, sim.TARGET_PATH);
  expect(result.count).toBeGreaterThan(3800);
  expect(result.minted).toBe(true);
  expect(result.lost).toBe(true);
  expect(result.found).toBe(true);
  expect(result.ms).toBeLessThan(BUDGET_MS);
});

test("on a real page, every element's heading, path and context read the same through the pass index", async ({ page }) => {
  await loadKnowledgeTree(page);
  const result = await page.evaluate(() => {
    const anchor = window.LAHE.anchor;
    const scope = anchor.scopeOf(document, null);
    const nodes = [];
    anchor.eachElement(scope, (node) => nodes.push(node));
    const refs = [
      { prefix: "", suffix: "" },
      { prefix: "abcdefghijkl", suffix: "abcdefghijklmnop" },
      { prefix: "x".repeat(300), suffix: "y".repeat(300), context_level: 2 }
    ];
    const read = () =>
      nodes.map((node) => ({
        heading: anchor.headingOf(node, scope),
        path: anchor.pathOf(node, scope),
        fingerprint: anchor.fingerprintOf(node, scope),
        context: refs.map((ref) => anchor.foundContextFor(node, scope, ref))
      }));
    const walked = anchor.withTextMemo(read);
    const indexed = anchor.withPassIndex(scope, read);
    const differ = [];
    for (let i = 0; i < nodes.length && differ.length < 5; i += 1) {
      if (JSON.stringify(walked[i]) !== JSON.stringify(indexed[i])) {
        differ.push({ i: i, walked: walked[i], indexed: indexed[i] });
      }
    }
    return {
      count: nodes.length,
      headings: new Set(walked.map((r) => r.heading)).size,
      differ: differ
    };
  });
  expect(result.count).toBeGreaterThan(3800);
  expect(result.headings).toBeGreaterThan(2);
  expect(result.differ).toEqual([]);
});
