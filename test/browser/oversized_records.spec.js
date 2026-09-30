// The three oversized records, against a real browser and a real page.
//
// The unit half is test/unit/oversized_records.test.js, over the simulated
// DOM. The story and the measurements are in
// docs/features/20260928.03_oversized_records/NOTES.md.
//
//   1. A comment the words cannot find again kept the text of the rest of the
//      page as its "text after".
//   2. An embedded image was stored three times over.
//   3. A triple-click made the region the whole container, and a region that
//      is the whole page was painted end to end.

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "oversized-records.html";
const REVIEW = "rev_oversized";

// The bundle from source, in the manifest's order. Builders never commit dist/.
const BUNDLE = manifest
  .builtFiles()
  .map(function (entry) {
    return "/* ---- " + entry.path + " ---- */\n" + fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8");
  })
  .join("\n");

async function bootLayer(page) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(function (reviewId) {
    var LAHE = window.LAHE;
    var pageFields = LAHE.record.pageFrom({
      origin: location.origin,
      pathname: location.pathname,
      href: location.href,
      title: document.title
    });
    var comments = LAHE.comments.createComments({ reviewId: reviewId, page: pageFields });
    comments.bind();
    window.__lahe = { comments: comments, reviewId: reviewId };
  }, REVIEW);
}

function itemsIn(page) {
  return page.evaluate(function () {
    return window.LAHE.store.shared.read(window.__lahe.reviewId);
  });
}

/** Characters of page text a painted range covers, or -1 when nothing is painted. */
function paintedLength(page, id) {
  return page.evaluate(function (itemId) {
    var range = window.__lahe.comments.highlights.rangeFor(itemId);
    return range ? range.toString().length : -1;
  }, id);
}

test.describe("oversized records", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "oversized-records" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("1: a comment on a diagram label keeps its nearest neighbours, not the appendices", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await page.evaluate(function () {
      var label = document.getElementById("label");
      var range = document.createRange();
      range.selectNodeContents(label);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      var handle = window.__lahe.comments.commentOnSelection({});
      handle.input.value = "Name this step.";
    });

    const item = (await itemsIn(page))[0];
    const ref = item.region.ref;
    expect(ref.text_unique).toBe(false);
    expect(ref.suffix).not.toContain("Appendix");
    expect(ref.prefix).not.toContain("Appendix");
    expect(ref.context_level).toBe(0);
    expect(ref.prefix).toContain("The paragraph before the diagram.");
    expect(ref.suffix).toBe("The paragraph after the diagram.");
    expect(item.context.suffix).toBe(ref.suffix);
    console.log("[sizes] diagram label record: " + JSON.stringify(item).length + " bytes");
  });

  test("2: an embedded image is stored once, whole, and still found and projected", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // A real picture as a data: URL, the size the recorded one was.
    //
    // The generator multiplies with Math.imul and reads its HIGH bits. A plain
    // `*` overflows a double's 53 bits and loses the low ones, which left the
    // noise with a pattern: Firefox's PNG encoder compressed it to about 70KB,
    // under the size this test needs, while Chromium and WebKit did not. Noise
    // with no pattern compresses to about the same size in every browser.
    const src = await page.evaluate(function () {
      var canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 120;
      var ctx = canvas.getContext("2d");
      var data = ctx.createImageData(240, 120);
      var seed = 7;
      for (var i = 0; i < data.data.length; i += 1) {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        data.data[i] = i % 4 === 3 ? 255 : (seed >>> 16) & 0xff;
      }
      ctx.putImageData(data, 0, 0);
      var url = canvas.toDataURL("image/png");
      document.getElementById("embedded").setAttribute("src", url);
      return url;
    });
    expect(src.length).toBeGreaterThan(100000);

    await page.evaluate(function () {
      window.__lahe.comments.commentOnElement(document.getElementById("embedded"));
    });
    const item = (await itemsIn(page))[0];
    const json = JSON.stringify(item);
    const tail = src.slice(-64);
    expect(json.split(tail).length - 1).toBe(1);
    expect(item.context.subject.src).toBe(src);
    expect(json.length).toBeLessThan(src.length + 8000);
    console.log("[sizes] embedded image record: " + json.length + " bytes, image " + src.length + " bytes");

    const found = await page.evaluate(function () {
      var stored = window.LAHE.store.shared.read(window.__lahe.reviewId)[0];
      var verdict = window.LAHE.anchor.resolve(stored.region.ref, document);
      return verdict.bound ? verdict.element.id : null;
    });
    expect(found).toBe("embedded");

    const html = await page.evaluate(function () {
      var stored = window.LAHE.store.shared.read(window.__lahe.reviewId);
      var json = window.LAHE.review_format.projectReview({
        id: window.__lahe.reviewId,
        generated_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        ended_at: null,
        items: stored
      });
      return json.pages[0].items[0].subject.html;
    });
    expect(html.startsWith('<img id="embedded" src="data:image/png;base64,')).toBe(true);
    expect(html).not.toContain("lahe:subject.src");
  });

  test("3: a triple-clicked heading is the heading, and its paint is the heading", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await page.locator("#open").click({ clickCount: 3 });
    const shape = await page.evaluate(function () {
      var range = window.getSelection().getRangeAt(0);
      return { end: range.endContainer.nodeType === 1 ? range.endContainer.id || range.endContainer.tagName : "#text" };
    });
    // What makes this case: the selection ends outside the heading.
    expect(shape.end).not.toBe("#text");

    await page.evaluate(function () {
      var handle = window.__lahe.comments.commentOnSelection({});
      handle.input.value = "Is this still open?";
    });
    const item = (await itemsIn(page))[0];
    expect(item.region.ref.path).toBe("body>main:1>section:1>h2:1");
    expect(item.region.ref.probe).toBe("Still open");
    console.log("[sizes] triple-clicked heading record: " + JSON.stringify(item).length + " bytes");

    // After the box goes and the page is painted from the record alone.
    await page.evaluate(function (id) {
      window.__lahe.comments.unpaint(id);
      window.__lahe.comments.repaint(id);
    }, item.id);
    expect(await paintedLength(page, item.id)).toBe("Still open".length);
  });

  test("3: a selection over several blocks is anchored on its first block, and painted over all of them", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await page.evaluate(function () {
      var first = document.getElementById("p1").firstChild;
      var last = document.getElementById("p2").firstChild;
      var range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.data.length);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      var handle = window.__lahe.comments.commentOnSelection({});
      handle.input.value = "Merge these two.";
    });
    const item = (await itemsIn(page))[0];
    const p1 = "This paragraph says Still open again, so the heading's words are on the page twice.";
    const p2 = "The paragraph before the diagram.";

    // Identity is the first block. The reviewer's quote is theirs, whole.
    expect(item.region.ref.path).toBe("body>main:1>section:1>p:1");
    expect(item.region.ref.probe).toBe(p1);
    expect(item.context.quote).toContain(p1);
    expect(item.context.quote).toContain(p2);
    expect(item.region.lost).toBe(null);

    // Replay places it: the reference binds the first block.
    const bound = await page.evaluate(function () {
      var stored = window.LAHE.store.shared.read(window.__lahe.reviewId)[0];
      var verdict = window.LAHE.anchor.resolve(stored.region.ref, document);
      return verdict.bound ? verdict.element.id : null;
    });
    expect(bound).toBe("p1");

    // And the paint from the record alone covers the whole quote, both blocks.
    const painted = await page.evaluate(function (id) {
      window.__lahe.comments.unpaint(id);
      var ok = window.__lahe.comments.repaint(id);
      var range = window.__lahe.comments.highlights.rangeFor(id);
      return { ok: ok, text: range ? range.toString().replace(/\s+/g, " ").trim() : null };
    }, item.id);
    expect(painted.ok).toBe(true);
    expect(painted.text).toBe(p1 + " " + p2);
    console.log("[sizes] multi-block selection record: " + JSON.stringify(item).length + " bytes");
  });

  test("3: a whole-element paint far bigger than the reviewer's words is refused, and clears the old paint", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // The header has words, so <main> is not the whole page. A record stored
    // before the fix, anchored on <main> with a one-line quote, must still
    // never wash every paragraph.
    await page.evaluate(function () {
      var header = document.createElement("header");
      header.textContent = "Site header";
      document.body.insertBefore(header, document.body.firstChild);
    });

    const result = await page.evaluate(function () {
      var comments = window.__lahe.comments;
      var main = document.querySelector("main");
      var mainRange = document.createRange();
      mainRange.selectNodeContents(main);
      var blockRange = document.createRange();
      blockRange.selectNodeContents(document.getElementById("p2"));

      // Fix 4: an earlier paint for the item is cleared by a refusal.
      var first = !!comments.highlights.paint("probe-item", blockRange, undefined, "The paragraph before the diagram.");
      var refused = comments.highlights.paint("probe-item", mainRange, undefined, "Still open");
      var left = comments.highlights.rangeFor("probe-item");

      // The same element, painted for the words it holds, is not refused.
      var whole = !!comments.highlights.paint("probe-whole", mainRange, undefined, main.textContent);
      // A single block far bigger than a short quote is still one passage.
      var block = !!comments.highlights.paint("probe-block", blockRange, undefined, "the");
      return { first: first, refused: refused, left: !!left, whole: whole, block: block };
    });
    expect(result.first).toBe(true);
    expect(result.refused).toBe(null);
    expect(result.left).toBe(false);
    expect(result.whole).toBe(true);
    expect(result.block).toBe(true);

    // Through the rail's own repaint: an old record on <main> with a short quote.
    const repainted = await page.evaluate(function (reviewId) {
      var LAHE = window.LAHE;
      var main = document.querySelector("main");
      var item = LAHE.record.newItem({
        kind: LAHE.record.KIND.COMMENT,
        state: LAHE.record.STATE.READY,
        note: "Is this still open?",
        page_origin: location.origin,
        page_path: location.pathname
      });
      var region = LAHE.record.emptyRegion();
      region.ref = LAHE.anchor.mint({ element: main, root: document });
      item[LAHE.record.FIELD.REGION] = region;
      var context = LAHE.record.emptyContext();
      context.quote = "Still open";
      item[LAHE.record.FIELD.CONTEXT] = context;
      LAHE.store.shared.write(reviewId, item);
      var ok = window.__lahe.comments.repaint(item.id);
      var range = window.__lahe.comments.highlights.rangeFor(item.id);
      return { ok: ok, length: range ? range.toString().length : -1 };
    }, REVIEW);
    // The quote is on the page twice, so it cannot be narrowed to; the whole
    // of <main> is refused. Nothing is painted, and the caller is told so.
    expect(repainted.ok).toBe(false);
    expect(repainted.length).toBe(-1);
  });

  test("3: a comment on a whole card is still painted after the agent triples the card's text", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    const outcome = await page.evaluate(function () {
      var LAHE = window.LAHE;
      var comments = window.__lahe.comments;
      var card = document.getElementById("card");
      comments.commentOnElement(card);
      var item = LAHE.store.shared.read(window.__lahe.reviewId)[0];
      // Sent: replay leaves a draft alone.
      item[LAHE.record.FIELD.STATE] = LAHE.record.STATE.READY;
      item.note = "Add detail here.";
      LAHE.store.shared.write(window.__lahe.reviewId, item);
      var before = card.textContent.length;

      // The agent adds the detail asked for and keeps the stamp on the card.
      document.getElementById("card-body").textContent =
        "Short text, now with the detail the reviewer asked for, spelled out at length.";
      var after = card.textContent.length;
      comments.unpaint(item.id);

      LAHE.replay.noteSettling(0);
      var result = LAHE.replay.runPass(LAHE.replay.REASON.MUTATION, {
        root: document,
        items: LAHE.store.shared.read(window.__lahe.reviewId),
        document: document,
        highlights: comments.highlights,
        cards: { setCardNotice: function () {}, setCardBadge: function () {}, clearCardBadge: function () {} },
        pointing: { bestGuess: function () { return { element: null }; } }
      }).results[0];
      var range = comments.highlights.rangeFor(item.id);
      return {
        grew: after / before,
        found: result.element === card,
        painted: !!range && range.startContainer === card
      };
    });
    expect(outcome.grew).toBeGreaterThan(3);
    expect(outcome.found).toBe(true);
    expect(outcome.painted).toBe(true);
  });
});
