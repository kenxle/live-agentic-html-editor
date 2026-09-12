// The L8 case, as a test: which treatment was the comment on?
//
// Ken clicked a blog block on a tearsheet that shows the same block once per
// treatment, each one a bare `<div class="wrap">` whose text is identical in
// every treatment. The agent had to ask which one he meant. The one line in
// review.json that could have answered, `context.heading`, was null: each
// treatment's title sits INSIDE a sibling `<div class="thead">`, and the heading
// walk only ever looked AT earlier siblings, never into them. See the "L8 case"
// section of docs/ongoing/FINGERPRINTING.md.
//
// The unit half is test/unit/comments_surface.test.js ("the heading walk"),
// which holds the wrapped, deep, sectioning-ancestor, capped, and no-heading
// cases over a hand-built DOM. This file is the same walk against a real
// browser, a real page, and a real click.

const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "treatments.html";

// The bundle from source, in the manifest's order. Builders never commit dist/,
// so reading dist/ here would test whoever last ran the build script.
const BUNDLE = manifest
  .builtFiles()
  .map(function (entry) {
    return "/* ---- " + entry.path + " ---- */\n" + fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8");
  })
  .join("\n");

async function bootLayer(page) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(function () {
    var LAHE = window.LAHE;
    var pageFields = LAHE.record.pageFrom({
      origin: location.origin,
      pathname: location.pathname,
      href: location.href,
      title: document.title
    });
    var comments = LAHE.comments.createComments({ reviewId: "rev_heading", page: pageFields });
    comments.bind();
    var tab = LAHE.tabActive.createActiveTab({ comments: comments });
    tab.mount();
    window.__lahe = { comments: comments, tab: tab, reviewId: "rev_heading" };
  });
}

function itemsIn(page) {
  return page.evaluate(function () {
    return window.LAHE.store.shared.read(window.__lahe.reviewId);
  });
}

// The items as an agent receives them: through the real projection, not through
// the layer's own bookkeeping.
function projectedItems(page) {
  return page.evaluate(function () {
    var items = window.LAHE.store.shared.read(window.__lahe.reviewId);
    var json = window.LAHE.review_format.projectReview({
      id: "rev_heading",
      generated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      ended_at: null,
      items: items
    });
    return json.pages[0].items;
  });
}

test.describe("the heading above a wrapped block", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "treatments" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("a comment on the second treatment's wrapper names that treatment", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // The wrapper itself, not the paragraph inside it: the click goes to the
    // wrapper's own padding, which is what a reviewer aiming at the whole block
    // hits.
    await page.evaluate(function () {
      window.getSelection().removeAllRanges();
    });
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    const box = await page.locator("#t2 .wrap").boundingBox();
    await page.mouse.move(box.x + 3, box.y + 3);
    await page.mouse.click(box.x + 3, box.y + 3);

    await page.keyboard.type("this one is the treatment I want");
    await page.keyboard.press("ControlOrMeta+Enter");

    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    expect(items[0].context.element).toBe("DIV");
    expect(items[0].context.heading).toBe("2. Mark icon");

    // And it is the line the agent actually reads, through the projection.
    const projected = await projectedItems(page);
    expect(projected[0].context.heading).toBe("2. Mark icon");
  });

  test("the first treatment's wrapper names the first treatment", async ({ page }) => {
    // Two treatments with identical text, so the heading is the only thing that
    // tells them apart. If the walk were finding a page-level heading rather
    // than the nearest one, both clicks would read the same.
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await page.evaluate(function () {
      window.getSelection().removeAllRanges();
    });
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    const box = await page.locator("#t1 .wrap").boundingBox();
    await page.mouse.move(box.x + 3, box.y + 3);
    await page.mouse.click(box.x + 3, box.y + 3);

    await page.keyboard.type("and this is the other one");
    await page.keyboard.press("ControlOrMeta+Enter");

    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    expect(items[0].context.heading).toBe("1. Ink on white");
  });
});
