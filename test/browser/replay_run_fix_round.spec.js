// Replay of a run record: the free-writing fix round, group F2
// (docs/features/20260928.01_free_writing/reviews_impl/FIX_ROUND.md).
//
// One describe per finding. Each test was run red against the code before its
// fix. Records are record_fixtures.js shapes, driven through runPass on a page
// that loads the layer from src/ (support/replay_run_page.js).

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

const ANCHOR = "Most weeks look busy from the outside. This one did not.";
const LONG_A = "The first new paragraph has enough words zqxcanary";
const LONG_B = "The second new paragraph also has words zqxcanary";

function fx() {
  return fixtures.createFixtures({ seed: "f2-fix" });
}

function stamp(item, s, tag) {
  item.region = { ref: { id: "ref_" + s, probe: null, stamp: s, fingerprint: { tag: tag } }, label: "anchor", lost: null };
  return item;
}

// A reference with no stamp: the anchor is found by its words alone.
function byWords(item, tag) {
  item.region = { ref: { id: "ref_words_" + tag, probe: null, fingerprint: { tag: tag } }, label: "anchor", lost: null };
  return item;
}

function blogRun(blocks, extra) {
  return stamp(
    fx().runItem(Object.assign({ before: ANCHOR, before_html: ANCHOR, anchor_after_html: ANCHOR, new_blocks: blocks }, extra || {})),
    "s-p1",
    "p"
  );
}

async function blog(page) {
  await openReplayPage(page, server, "free_writing/blog.html");
  await page.evaluate(() => document.getElementById("p1").setAttribute("data-lahe-id", "s-p1"));
}

function articleShape(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#post > *")).map((el) => el.tagName.toLowerCase() + ": " + el.textContent.replace(/\s+/g, " ").trim())
  );
}

function afterP1(page, html) {
  return page.evaluate((markup) => document.getElementById("p1").insertAdjacentHTML("afterend", markup), html);
}

function badges(page, id) {
  return page.evaluate((i) => Object.keys(window.__cards.badges[i] || {}), id);
}

function tagOnlyItalic() {
  return fx().runItem({
    kind: record.KIND.FORMAT_ONLY,
    before: "Plain words zqxcanary",
    before_html: "<em>Plain words zqxcanary</em>",
    anchor_after_html: "<em>Plain words zqxcanary</em>",
    anchor_tag_after: "h2",
    new_blocks: []
  });
}

// ---------------------------------------------------------------------------
// Code lead 8: the anchor is resolved with tagAfter, and the tag leg swaps
// only a block.
// ---------------------------------------------------------------------------

test.describe("a retagged anchor whose words are all italic", () => {
  test("placed as h2 already: bound to the h2, no conflict, nothing nests", async ({ page }) => {
    await blog(page);
    await page.evaluate(() => {
      document.getElementById("p1").outerHTML = '<h2 id="p1"><em>Plain words zqxcanary</em></h2>';
    });
    await setItems(page, [byWords(tagOnlyItalic(), "p")]);
    const r = await page.evaluate(() => window.__pass());
    // Bound to the em, the compare read the em's markup against the anchor's
    // and held a false conflict.
    expect(r[0].branch).toBe("already_applied");
    const got = await page.evaluate(() => ({
      nested: document.querySelectorAll("h2 h2, em h2, h2 em h2").length,
      html: document.getElementById("p1").outerHTML
    }));
    expect(got.nested).toBe(0);
    expect(got.html).toBe('<h2 id="p1"><em>Plain words zqxcanary</em></h2>');
  });

  test("still a p on the page: the p becomes the h2, the em stays inside it", async ({ page }) => {
    await openReplayPage(page, server, "free_writing/blog.html");
    await page.evaluate(() => {
      document.getElementById("p1").innerHTML = "<em>Plain words zqxcanary</em>";
    });
    await setItems(page, [byWords(tagOnlyItalic(), "p")]);
    await page.evaluate(() => window.__pass());
    const html = await page.evaluate(() => document.getElementById("p1").outerHTML);
    expect(html).toBe('<h2 id="p1"><em>Plain words zqxcanary</em></h2>');
  });
});

// ---------------------------------------------------------------------------
// Design call 4 (CR 3, CL 2): a take-back carries the old tag in
// anchor_tag_after, and replay's tag leg acts on it.
// ---------------------------------------------------------------------------

test.describe("the take-back of a type change", () => {
  function takeBackOf(original) {
    original.state = record.STATE.HANDLED;
    const back = record.revertOf(original, { created_at: fixtures.FIXED_AT });
    back.id = "itm_takeback_tag";
    back.anchor_tag_after = "p";
    back.region = original.region;
    return back;
  }

  test("a tag-only take-back turns the agent's h2 back into a p, stamp and words kept", async ({ page }) => {
    await blog(page);
    const original = stamp(
      fx().runItem({
        kind: record.KIND.FORMAT_ONLY,
        before: "Plain words zqxcanary",
        before_html: "Plain words zqxcanary",
        anchor_after_html: "Plain words zqxcanary",
        anchor_tag_after: "h2",
        new_blocks: []
      }),
      "s-p1",
      "p"
    );
    await page.evaluate(() => {
      document.getElementById("p1").outerHTML = '<h2 id="p1" data-lahe-id="s-p1">Plain words zqxcanary</h2>';
    });
    await setItems(page, [original, takeBackOf(original)]);
    await page.evaluate(() => window.__pass());
    const got = await page.evaluate(() => {
      const el = document.querySelector('[data-lahe-id="s-p1"]');
      return { tag: el.tagName.toLowerCase(), id: el.id, text: el.textContent };
    });
    expect(got).toEqual({ tag: "p", id: "p1", text: "Plain words zqxcanary" });
    const again = await page.evaluate(() => window.__pass());
    expect(again.every((r) => !r.wrote)).toBe(true);
  });

  test("an all-italic anchor found by its words goes back to p without nesting", async ({ page }) => {
    await blog(page);
    const original = byWords(tagOnlyItalic(), "p");
    await page.evaluate(() => {
      document.getElementById("p1").outerHTML = '<h2 id="p1"><em>Plain words zqxcanary</em></h2>';
    });
    await setItems(page, [original, takeBackOf(original)]);
    await page.evaluate(() => window.__pass());
    const html = await page.evaluate(() => document.getElementById("p1").outerHTML);
    expect(html).toBe('<p id="p1"><em>Plain words zqxcanary</em></p>');
  });

  test("the take-back of a retagged run removes its blocks and turns the anchor back", async ({ page }) => {
    await blog(page);
    const original = blogRun([{ tag: "p", html: LONG_A }], { anchor_tag_after: "h3" });
    await page.evaluate((a) => {
      const p = document.getElementById("p1");
      p.outerHTML = '<h3 id="p1" data-lahe-id="s-p1">' + p.textContent + "</h3><p>" + a + "</p>";
    }, LONG_A);
    await setItems(page, [original, takeBackOf(original)]);
    await page.evaluate(() => window.__pass());
    const shape = await articleShape(page);
    expect(shape.slice(1, 3)).toEqual(["p: " + ANCHOR, "h2: What changed"]);
    expect(await page.evaluate((t) => window.__count(t), LONG_A)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Code lead 9: a block moving into or out of a list is rebuilt, not swapped.
// ---------------------------------------------------------------------------

test.describe("a block whose tag changes to or from a list", () => {
  test("a ul block the page shows as a p becomes a ul with its li", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>" + LONG_A + "</p>");
    await setItems(page, [blogRun([{ tag: "ul", html: "<li>" + LONG_A + "</li>" }])]);
    await page.evaluate(() => window.__pass());
    const html = await page.evaluate(() => document.getElementById("p1").nextElementSibling.outerHTML);
    expect(html).toBe("<ul><li>" + LONG_A + "</li></ul>");
  });

  test("a p block the page shows as a one-item list becomes a p with no li", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<ul><li>" + LONG_A + "</li></ul>");
    await setItems(page, [blogRun([{ tag: "p", html: LONG_A }])]);
    await page.evaluate(() => window.__pass());
    const html = await page.evaluate(() => document.getElementById("p1").nextElementSibling.outerHTML);
    expect(html).toBe("<p>" + LONG_A + "</p>");
  });
});

// ---------------------------------------------------------------------------
// Code lead 10: the run notes on a card clear once the page is fixed.
// ---------------------------------------------------------------------------

test.describe("the run notes on a card", () => {
  test("a wrong tag replay sent back stays noted until the agent's page has the right tag, then clears", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>" + LONG_A + "</p>");
    const item = blogRun([{ tag: "h2", html: LONG_A }]);
    await setItems(page, [item]);
    await page.evaluate(() => window.__pass());
    expect(await badges(page, item.id)).toContain("REPLAY_RUN_WRONG_TAG");
    // A pass over replay's own fix: the source is still wrong, the note stays.
    await page.evaluate(() => window.__pass());
    expect(await badges(page, item.id)).toContain("REPLAY_RUN_WRONG_TAG");
    // The agent fixed the source: a reload brings a fresh h2.
    await page.evaluate((a) => {
      document.getElementById("p1").nextElementSibling.outerHTML = "<h2>" + a + "</h2>";
    }, LONG_A);
    await page.evaluate(() => window.__pass());
    expect(await badges(page, item.id)).not.toContain("REPLAY_RUN_WRONG_TAG");
  });

  test("placed elsewhere clears once the block is where it belongs", async ({ page }) => {
    await blog(page);
    await page.evaluate((t) => document.getElementById("list").insertAdjacentHTML("afterend", "<p>" + t + "</p>"), LONG_A);
    const item = blogRun([{ tag: "p", html: LONG_A }]);
    await setItems(page, [item]);
    await page.evaluate(() => window.__pass());
    expect(await badges(page, item.id)).toContain("REPLAY_RUN_PLACED_ELSEWHERE");
    // The agent moved it to right after the anchor.
    await page.evaluate(() => {
      const far = document.getElementById("list").nextElementSibling;
      document.getElementById("p1").after(far);
    });
    await page.evaluate(() => window.__pass());
    expect(await badges(page, item.id)).not.toContain("REPLAY_RUN_PLACED_ELSEWHERE");
  });
});

// ---------------------------------------------------------------------------
// Code lead 12: one page walk per placeRun, not two per missing block.
// ---------------------------------------------------------------------------

test("a 250-block run that is not on the page walks the page a fixed number of times, not per block", async ({ page }) => {
  await blog(page);
  const list = [];
  for (let i = 0; i < 250; i += 1) list.push({ tag: "p", html: "Paragraph number " + i + " of the long notes sitting zqxcanary" });
  await setItems(page, [blogRun(list)]);
  const got = await page.evaluate(() => {
    const blocks = window.LAHE.blocks;
    const real = blocks.leafWalk;
    let calls = 0;
    blocks.leafWalk = function () {
      calls += 1;
      return real.apply(this, arguments);
    };
    const start = performance.now();
    window.__pass();
    const ms = performance.now() - start;
    blocks.leafWalk = real;
    return { calls, ms, placed: window.__count("of the long notes sitting zqxcanary") };
  });
  console.log("250-block pass: " + got.calls + " direct page walks, " + Math.round(got.ms) + " ms");
  expect(got.placed).toBe(250);
  expect(got.calls).toBeLessThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// Code lead 18: a punctuation fix inside a run is written.
// ---------------------------------------------------------------------------

test.describe("a punctuation fix the typography fold reads past", () => {
  function fixed() {
    const first = blogRun([{ tag: "p", html: "A well--known fact about builds zqxcanary" }]);
    const blocks = [{ tag: "p", html: "A well-known fact about builds zqxcanary" }];
    const built = record.buildRunAfter(first.anchor_after_html, blocks);
    const later = record.bumpRev(first, { new_blocks: blocks, after_html: built.after_html, after: built.after });
    later.change = record.runChangeText(later);
    return later;
  }

  test("the page showing the earlier revision exactly is rewritten to the fix", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>A well--known fact about builds zqxcanary</p>");
    await setItems(page, [fixed()]);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(true);
    const text = await page.evaluate(() => document.getElementById("p1").nextElementSibling.textContent);
    expect(text).toBe("A well-known fact about builds zqxcanary");
    const again = await page.evaluate(() => window.__pass());
    expect(again[0].wrote).toBe(false);
  });

  test("a render that draws the dash its own way is left alone", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>A well‑known fact about builds zqxcanary</p>");
    await setItems(page, [fixed()]);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Security 1: the anchor's fallback write goes through cleanMarkup.
// ---------------------------------------------------------------------------

test("a stored record whose anchor markup carries a handler writes the words and the link, never the handler", async ({ page }) => {
  await blog(page);
  const item = blogRun([{ tag: "p", html: LONG_A }], {
    anchor_after_html:
      '<a href="https://example.com/" onclick="window.__pwned = 1">New</a> anchor words zqxcanary<img src="x" onerror="window.__pwned = 2">'
  });
  await setItems(page, [item]);
  await page.evaluate(() => window.__pass());
  // The image's load or error event is where a kept handler would run.
  await page.evaluate(
    () =>
      new Promise((done) => {
        const img = document.querySelector("#p1 img");
        if (!img || img.complete) return done();
        img.addEventListener("error", done);
        img.addEventListener("load", done);
      })
  );
  const got = await page.evaluate(() => ({
    handlers: document.querySelectorAll("[onerror], [onclick]").length,
    pwned: window.__pwned || null,
    link: (document.querySelector("#p1 a") || {}).href || null,
    text: document.getElementById("p1").textContent
  }));
  expect(got.handlers).toBe(0);
  expect(got.pwned).toBe(null);
  expect(got.link).toBe("https://example.com/");
  expect(got.text).toBe("New anchor words zqxcanary");
});

// ---------------------------------------------------------------------------
// ADV 2, design call 1: an anchor the reviewer never changed is never compared.
// ---------------------------------------------------------------------------

test.describe("a run after an anchor the reviewer left alone", () => {
  test("the agent rewrites that paragraph in place: the run stays, no conflict, the agent's words stand", async ({ page }) => {
    await blog(page);
    const item = blogRun([{ tag: "p", html: LONG_A }, { tag: "p", html: LONG_B }]);
    await setItems(page, [item]);
    await page.evaluate(() => window.__pass());
    await page.evaluate(() => {
      document.getElementById("p1").textContent = "The agent tightened this paragraph after another comment.";
    });
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].branch).not.toBe("content_changed");
    expect(await badges(page, item.id)).not.toContain("REPLAY_NEITHER_MATCHES");
    const shape = await articleShape(page);
    expect(shape.slice(1, 4)).toEqual(["p: The agent tightened this paragraph after another comment.", "p: " + LONG_A, "p: " + LONG_B]);
  });

  test("a reload where the agent added a sentence to it: the run is placed after it and nothing is held", async ({ page }) => {
    await blog(page);
    await page.evaluate((a) => {
      document.getElementById("p1").textContent = a + " The agent added this sentence.";
    }, ANCHOR);
    const item = blogRun([{ tag: "p", html: LONG_A }]);
    await setItems(page, [item]);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].lost).toBe(false);
    expect(await badges(page, item.id)).not.toContain("REPLAY_NEITHER_MATCHES");
    const shape = await articleShape(page);
    expect(shape.slice(1, 3)).toEqual(["p: " + ANCHOR + " The agent added this sentence.", "p: " + LONG_A]);
  });
});
