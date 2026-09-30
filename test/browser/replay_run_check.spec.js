// The page check on a run, and the first two R14 cases as run records
// (free-writing plan Task 2.7).
//
// The check reads a handled run block by block off the real page, with the
// string twin of replay's walk. The R14 cases: a line written after a header
// shows once, below the sheet-head; and the lone paragraph whose bold the
// agent left out comes back once, with its bold, whether it is the first new
// paragraph or a later one.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer } = require("../helpers");
const { openReplayPage, setItems } = require("./support/replay_run_page");
const fixtures = require("../../src/shared/record_fixtures.js");
const record = require("../../src/shared/record.js");

const FIXTURES = path.join(__dirname, "..", "fixtures");

let server = null;
test.beforeAll(async () => {
  server = await startStaticServer({ root: FIXTURES });
});
test.afterAll(async () => {
  if (server) await server.close();
});

const LEDE = "A short lede that sits in the hero.";

function fx() {
  return fixtures.createFixtures({ seed: "2b-check" });
}

function stamp(item, s, tag) {
  item.region = { ref: { id: "ref_" + s, probe: null, stamp: s, fingerprint: { tag: tag } }, label: "anchor", lost: null };
  return item;
}

// A run after the first section's h2 on the Markdown render.
function headerRun(blocks) {
  return stamp(fx().runItem({ new_blocks: blocks }), "s-h2", "h2");
}

async function mdPage(page) {
  await openReplayPage(page, server, "free_writing/md_render.html");
  await page.evaluate(() => document.querySelector("section h2").setAttribute("data-lahe-id", "s-h2"));
}

// The agent's rebuild: markup placed after the first sheet-head.
function placeAfterHead(page, html) {
  return page.evaluate((markup) => document.querySelector("section .sheet-head").insertAdjacentHTML("afterend", markup), html);
}

function handled(item) {
  item.state = record.STATE.HANDLED;
  return item;
}

test("a handled run with an h2 on the Markdown render is not reopened", async ({ page }) => {
  await mdPage(page);
  const item = handled(
    headerRun([
      { tag: "h2", html: "A new section zqxcanary" },
      { tag: "p", html: "Its <strong>first</strong> line zqxcanary" }
    ])
  );
  // As the renderer draws a new h2: in its own sheet-head, with a label.
  await placeAfterHead(
    page,
    '<div class="sheet-head"><h2>A new section zqxcanary</h2><span class="n">Section 2</span></div><p>Its <strong>first</strong> line zqxcanary</p>'
  );
  expect(await page.evaluate((i) => window.__check(i), item)).toBe(null);
});

test("a handled run whose paragraph lost its bold is reopened with the formatting note", async ({ page }) => {
  await mdPage(page);
  const item = handled(headerRun([{ tag: "p", html: "Its <strong>first</strong> line zqxcanary" }]));
  await placeAfterHead(page, "<p>Its first line zqxcanary</p>");
  expect(await page.evaluate((i) => window.__check(i), item)).toBe("formatting");
  const note = await page.evaluate(
    (i) => window.LAHE.replay.pageCheckNoteFor(i, window.LAHE.replay.pageTextOf(document.body), window.LAHE.replay.pageCheckOptions(document.body, {})),
    item
  );
  expect(note).toBe(record.PAGE_CHECK_FORMAT_NOTE);
});

test("a header placed as a paragraph is reopened with the tag note, not the formatting note", async ({ page }) => {
  await mdPage(page);
  const item = handled(
    headerRun([
      { tag: "h2", html: "A new section zqxcanary" },
      { tag: "p", html: "Its <strong>first</strong> line zqxcanary" }
    ])
  );
  await placeAfterHead(page, "<p>A new section zqxcanary</p><p>Its first line zqxcanary</p>");
  expect(await page.evaluate((i) => window.__check(i), item)).toBe("tag");
  const note = await page.evaluate(
    (i) => window.LAHE.replay.pageCheckNoteFor(i, window.LAHE.replay.pageTextOf(document.body), window.LAHE.replay.pageCheckOptions(document.body, {})),
    item
  );
  expect(note).toBe(record.PAGE_CHECK_TAG_NOTE);
});

test("a missing block is reopened as missing, never as undone", async ({ page }) => {
  await mdPage(page);
  const item = handled(
    headerRun([
      { tag: "p", html: "The placed one zqxcanary" },
      { tag: "p", html: "The one left out zqxcanary" }
    ])
  );
  await placeAfterHead(page, "<p>The placed one zqxcanary</p>");
  expect(await page.evaluate((i) => window.__check(i), item)).toBe("missing");
});

test.describe("R14, as run records", () => {
  test("the header case: a line written after a heading shows once, below the sheet-head", async ({ page }) => {
    await mdPage(page);
    const LINE = "A line written under the heading zqxcanary";
    const item = headerRun([{ tag: "p", html: LINE }]);
    await setItems(page, [item]);
    // Before the agent: replay places it.
    await page.evaluate(() => window.__pass());
    // The agent's rebuild carries it, and the page reloads with it.
    await mdPage(page);
    await placeAfterHead(page, "<p>" + LINE + "</p>");
    await setItems(page, [item]);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(false);
    const got = await page.evaluate((t) => {
      const head = document.querySelector("section .sheet-head");
      return { count: window.__count(t), next: head.nextElementSibling.textContent, h2: head.querySelector("h2").textContent };
    }, LINE);
    expect(got).toEqual({ count: 1, next: LINE, h2: "What changed" });
    expect(await page.evaluate((i) => window.__check(i), handled(Object.assign({}, item)))).toBe(null);
  });

  for (const which of ["first", "second"]) {
    test("the lone paragraph: the agent left out the bold one when it was the " + which + "; it reopens and comes back once, bold", async ({ page }) => {
      await openReplayPage(page, server, "free_writing/md_render.html");
      await page.evaluate(() => document.querySelector(".hero p").setAttribute("data-lahe-id", "s-lede"));
      const ONE = "One paragraph with <strong>bold</strong> words zqxcanary";
      const TWO = "Two paragraph with <em>slanted</em> words zqxcanary";
      const blocks = [
        { tag: "p", html: ONE },
        { tag: "p", html: TWO }
      ];
      const item = handled(stamp(fx().runItem({ before: LEDE, before_html: LEDE, anchor_after_html: LEDE, new_blocks: blocks }), "s-lede", "p"));
      // The agent carried the other paragraph and left this one out.
      const kept = which === "first" ? TWO : ONE;
      const left = which === "first" ? ONE : TWO;
      await page.evaluate((markup) => document.querySelector(".hero p").insertAdjacentHTML("afterend", "<p>" + markup + "</p>"), kept);
      expect(await page.evaluate((i) => window.__check(i), item)).toBe("missing");
      // Reopened, so it is outstanding again, and replay puts it back.
      item.state = record.STATE.READY;
      await setItems(page, [item]);
      await page.evaluate(() => window.__pass());
      const plain = left.replace(/<[^>]+>/g, "");
      const got = await page.evaluate((t) => {
        const hit = Array.from(document.querySelectorAll(".hero p")).filter((p) => p.textContent === t);
        return { count: window.__count(t), html: hit.length ? hit[0].innerHTML : null, order: Array.from(document.querySelectorAll(".hero p")).map((p) => p.textContent) };
      }, plain);
      expect(got.count).toBe(1);
      expect(got.html).toBe(left);
      expect(got.order).toEqual([LEDE, ONE.replace(/<[^>]+>/g, ""), TWO.replace(/<[^>]+>/g, "")]);
    });
  }
});
