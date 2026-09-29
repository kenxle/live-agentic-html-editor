// Replay of a run record's anchor (free-writing plan Task 2.5).
//
// The anchor compare reads the anchor view: anchor_after_html in place of the
// whole sitting's after_html. So a repaint that brings the old anchor back
// gets the anchor's own words, never the run's. The tag leg swaps a block
// whose words are right and whose tag is not, through blocks.swapTag.
//
// Records come from record_fixtures.js, found on the page by their stamp.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer } = require("../helpers");
const { openReplayPage, setItems } = require("./support/replay_run_page");
const fixtures = require("../../src/shared/record_fixtures.js");

const FIXTURES = path.join(__dirname, "..", "fixtures");

let server = null;
test.beforeAll(async () => {
  server = await startStaticServer({ root: FIXTURES });
});
test.afterAll(async () => {
  if (server) await server.close();
});

function fx() {
  return fixtures.createFixtures({ seed: "2b-anchor" });
}

function byName(name) {
  return fx().runFixtures().find((f) => f.name === name).item;
}

function stamped(item, stamp, tag) {
  item.region = { ref: { id: "ref_" + stamp, probe: null, stamp: stamp, fingerprint: { tag: tag } }, label: "anchor", lost: null };
  return item;
}

function stampOn(page, selector, stamp) {
  return page.evaluate(([sel, s]) => document.querySelector(sel).setAttribute("data-lahe-id", s), [selector, stamp]);
}

test("after the agent placed the run, a repaint that brings the old anchor back gets the anchor's own words only", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/md_render.html");
  const f = fx();
  const item = stamped(
    f.runItem({
      before: "What changed",
      before_html: "What changed",
      anchor_after_html: "What changed this spring",
      new_blocks: [
        { tag: "p", html: "The run's first paragraph zqxcanary" },
        { tag: "p", html: "And <strong>its</strong> second one zqxcanary" }
      ],
      region: undefined
    }),
    "s-anchor",
    "h2"
  );
  await stampOn(page, "section h2", "s-anchor");
  // The agent's rebuild: the anchor reworded and the run placed after the sheet-head.
  await page.evaluate(() => {
    const h2 = document.querySelector("section h2");
    h2.textContent = "What changed this spring";
    const head = h2.parentNode;
    const a = document.createElement("p");
    a.textContent = "The run's first paragraph zqxcanary";
    const b = document.createElement("p");
    b.innerHTML = "And <strong>its</strong> second one zqxcanary";
    head.after(a, b);
  });
  await setItems(page, [item]);
  await page.evaluate(() => window.__pass());
  // A repaint brings the old anchor back.
  await page.evaluate(() => {
    document.querySelector("section h2").textContent = "What changed";
  });
  const results = await page.evaluate(() => window.__pass());
  expect(results[0].wrote).toBe(true);
  const got = await page.evaluate(() => ({
    anchor: document.querySelector("section h2").innerHTML,
    first: window.__count("The run's first paragraph zqxcanary"),
    second: window.__count("And its second one zqxcanary")
  }));
  expect(got.anchor).toBe("What changed this spring");
  expect(got.anchor).not.toContain("zqxcanary");
  expect(got.first).toBe(1);
  expect(got.second).toBe(1);
  // And a pass with nothing changed writes nothing.
  const again = await page.evaluate(() => window.__pass());
  expect(again[0].wrote).toBe(false);
});

test("a tag-only record on a page still showing p swaps the anchor to h2, stamp and words kept", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/blog.html");
  const item = stamped(
    byName("tag-only change"),
    "s-tag",
    "p"
  );
  await page.evaluate(() => {
    document.getElementById("p1").textContent = "Plain words zqxcanary";
  });
  await stampOn(page, "#p1", "s-tag");
  await setItems(page, [item]);
  const first = await page.evaluate(() => window.__pass());
  expect(first[0].wrote).toBe(true);
  const got = await page.evaluate(() => {
    const el = document.querySelector('[data-lahe-id="s-tag"]');
    return { tag: el.tagName.toLowerCase(), id: el.id, text: el.textContent, prev: el.previousElementSibling.id };
  });
  expect(got).toEqual({ tag: "h2", id: "p1", text: "Plain words zqxcanary", prev: "title" });
  const second = await page.evaluate(() => window.__pass());
  expect(second[0].wrote).toBe(false);
});

test("a tag change with new words rewrites the anchor and swaps it to h3", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/blog.html");
  const item = stamped(byName("tag change with new words"), "s-tag3", "p");
  await page.evaluate(() => {
    document.getElementById("p1").textContent = "Old words zqxcanary";
  });
  await stampOn(page, "#p1", "s-tag3");
  await setItems(page, [item]);
  await page.evaluate(() => window.__pass());
  const got = await page.evaluate(() => {
    const el = document.querySelector('[data-lahe-id="s-tag3"]');
    return { tag: el.tagName.toLowerCase(), html: el.innerHTML };
  });
  expect(got).toEqual({ tag: "h3", html: "New words zqxcanary" });
});

test("a paragraph turned into a list becomes one ul with one li", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/blog.html");
  const item = stamped(byName("paragraph turned into a list"), "s-list", "p");
  await page.evaluate(() => {
    document.getElementById("p1").textContent = "Item words zqxcanary";
  });
  await stampOn(page, "#p1", "s-list");
  await setItems(page, [item]);
  await page.evaluate(() => window.__pass());
  const got = await page.evaluate(() => {
    const el = document.querySelector('[data-lahe-id="s-list"]');
    return { tag: el.tagName.toLowerCase(), html: el.innerHTML };
  });
  expect(got).toEqual({ tag: "ul", html: "<li>Item words zqxcanary</li>" });
});

test("a record without new_blocks keeps today's path: Enter after a heading writes the nested paragraph", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/blog.html");
  const item = stamped(fx().oldShapeNested(), "s-old", "h2");
  await page.evaluate(() => {
    document.getElementById("h2").textContent = "Intro";
  });
  await stampOn(page, "#h2", "s-old");
  await setItems(page, [item]);
  await page.evaluate(() => window.__pass());
  const html = await page.evaluate(() => document.getElementById("h2").innerHTML);
  expect(html).toBe("Intro<p>A new line</p>");
});
