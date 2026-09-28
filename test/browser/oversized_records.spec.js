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
  });

  test("2: an embedded image is stored once, whole, and still found and projected", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // A real picture as a data: URL, the size the recorded one was.
    const src = await page.evaluate(function () {
      var canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 240;
      var ctx = canvas.getContext("2d");
      var data = ctx.createImageData(480, 240);
      var seed = 7;
      for (var i = 0; i < data.data.length; i += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data.data[i] = i % 4 === 3 ? 255 : seed & 0xff;
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

    // After the box goes and the page is painted from the record alone.
    await page.evaluate(function (id) {
      window.__lahe.comments.unpaint(id);
      window.__lahe.comments.repaint(id);
    }, item.id);
    expect(await paintedLength(page, item.id)).toBe("Still open".length);
  });

  test("3: a region that holds the whole page is never painted end to end", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // A pick on the page's own wrapper, which holds every word on the page.
    await page.evaluate(function () {
      window.__lahe.comments.commentOnElement(document.querySelector("main"));
    });
    const item = (await itemsIn(page))[0];
    expect(await paintedLength(page, item.id)).toBe(-1);

    const repainted = await page.evaluate(function (id) {
      window.__lahe.comments.repaint(id);
      return !!window.__lahe.comments.highlights.rangeFor(id);
    }, item.id);
    expect(repainted).toBe(false);

    // And the body itself, however it is reached.
    const bodyPainted = await page.evaluate(function () {
      var range = document.createRange();
      range.selectNodeContents(document.body);
      return window.__lahe.comments.highlights.paint("probe-body", range);
    });
    expect(bodyPainted).toBe(null);

    // An ordinary block is still painted whole when it has to be.
    const blockPainted = await page.evaluate(function () {
      var range = document.createRange();
      range.selectNodeContents(document.getElementById("p2"));
      return !!window.__lahe.comments.highlights.paint("probe-block", range);
    });
    expect(blockPainted).toBe(true);
  });
});
