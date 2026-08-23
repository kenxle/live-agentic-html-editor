// The reviewer's exact failure, as a test: three images in a row, each in its
// own wrapper, and a comment on the middle one.
//
// What went wrong, in the record he actually produced:
//
//   - the mint failed with empty_probe, because an <img> has no text
//   - `lost` was null anyway, so the item read as perfectly healthy
//   - the label read "1. Wordmark on its ink rectangle, img 1" for all three,
//     because the ordinal counted immediate siblings and each image is an only
//     child of its own wrapper
//   - the agent was handed the bare tag name IMG: no src, no alt, no HTML
//
// So he said "I like this one", his agent could not tell which one he meant,
// guessed, and guessed wrong. Every assertion below is one half of that.
//
// The unit half is test/unit/anchor_engine.test.js, over the simulated DOM.
// This file is the same bar against a real browser and a real page.

const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "image-row.html";

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
    var comments = LAHE.comments.createComments({ reviewId: "rev_subject", page: pageFields });
    comments.bind();
    var tab = LAHE.tabActive.createActiveTab({ comments: comments });
    tab.mount();
    window.__lahe = { comments: comments, tab: tab, reviewId: "rev_subject" };
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
      id: "rev_subject",
      generated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      ended_at: null,
      items: items
    });
    return { field_classes: json.field_classes, items: json.pages[0].items };
  });
}

async function pickElement(page, selector) {
  await page.evaluate(function () {
    window.getSelection().removeAllRanges();
  });
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("the element anchor: which image did he mean", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "image-row" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("a comment on the middle of three wrapped images names the middle image", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await pickElement(page, '#mark-row img[src$="logo-square-b@2x.svg"]');
    await page.keyboard.type("I like this one");
    await page.keyboard.press("ControlOrMeta+Enter");

    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.note).toBe("I like this one");
    expect(item.context.element).toBe("IMG");

    // The anchor minted, from the src rather than from a position.
    expect(item.region.ref.ok).toBe(true);
    expect(item.region.ref.probe_kind).toBe("element");
    expect(item.region.ref.probe).toContain("logo-square-b@2x.svg");
    expect(item.region.lost).toBe(null);

    // And it finds the same image again, not one of its neighbours.
    const resolvedSrc = await page.evaluate(function () {
      var stored = window.LAHE.store.shared.read("rev_subject")[0];
      var verdict = window.LAHE.anchor.resolve(stored.region.ref, document);
      return verdict.bound ? verdict.element.getAttribute("src") : null;
    });
    expect(resolvedSrc).toBe("assets/logo-square-b@2x.svg");

    // What the agent is handed. This is the whole point of the fix: the src is
    // the raw attribute the page author wrote, not the resolved absolute URL,
    // because the source file is what the agent has to edit.
    const projected = await projectedItems(page);
    const subject = projected.items[0].subject;
    expect(subject.tag).toBe("img");
    expect(subject.src).toBe("assets/logo-square-b@2x.svg");
    expect(subject.alt).toBe("Square badge, 70% fill");
    expect(subject.html).toContain('src="assets/logo-square-b@2x.svg"');
    expect(subject.html.indexOf("</")).toBe(-1);
    expect(subject.html.indexOf("data-lahe")).toBe(-1);
    expect(subject.near).toBe("B, 70% fill");

    // Page text, so it travels as data (D6, D12).
    expect(projected.field_classes.subject).toBe("data");

    // The locating fields that no writer ever filled: null in every item of
    // every review on this machine, and now the anchor's own context ring. The
    // prefix is legitimately empty here, because nothing precedes the image
    // inside its wrapper, and an honest empty string is not a null.
    expect(projected.items[0].context.suffix).toBe("B, 70% fill");
    expect(typeof projected.items[0].context.prefix).toBe("string");
    expect(projected.items[0].lost).toBe(null);
  });

  test("three images in three wrappers get three names, not three copies of img 1", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    for (const name of ["a", "b", "c"]) {
      await pickElement(page, `#mark-row img[src$="logo-square-${name}@2x.svg"]`);
      await page.keyboard.type(`note about ${name}`);
      await page.keyboard.press("ControlOrMeta+Enter");
    }

    const items = await itemsIn(page);
    expect(items).toHaveLength(3);

    const labels = items.map((i) => i.region.label);
    expect(new Set(labels).size).toBe(3);
    expect(labels.sort()).toEqual([
      "img logo-square-a@2x.svg",
      "img logo-square-b@2x.svg",
      "img logo-square-c@2x.svg"
    ]);

    // Identity is the reference, and three references are three references.
    const refIds = items.map((i) => i.region.ref.id);
    expect(new Set(refIds).size).toBe(3);

    const projected = await projectedItems(page);
    const srcs = projected.items.map((i) => i.subject.src).sort();
    expect(srcs).toEqual([
      "assets/logo-square-a@2x.svg",
      "assets/logo-square-b@2x.svg",
      "assets/logo-square-c@2x.svg"
    ]);
  });

  test("a canvas with nothing identifying about it is stamped lost, not stored as healthy", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await pickElement(page, "#chart-holder canvas");
    await page.keyboard.type("this chart needs a legend");
    await page.keyboard.press("ControlOrMeta+Enter");

    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    const item = items[0];

    // The reviewer's words are kept, always. What is refused is the pretence
    // that the tool knows where they point.
    expect(item.note).toBe("this chart needs a legend");
    expect(item.region.ref.ok).toBe(false);
    expect(item.region.ref.failure.reason).toBe("empty_probe");
    expect(item.region.lost).toBeTruthy();
    expect(item.region.lost.code).toBe("ANCHOR_NO_TEXT_MATCH");

    // And review.json says it out loud, with the sentence the agent reads.
    const projected = await projectedItems(page);
    expect(projected.items[0].lost).toBeTruthy();
    expect(projected.items[0].lost.code).toBe("ANCHOR_NO_TEXT_MATCH");
    expect(typeof projected.items[0].lost.hint).toBe("string");
  });

  test("picking inside an svg records the whole graphic, and it anchors", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // The click lands on a <text> node inside the svg, which is what a reviewer
    // aiming at a diagram actually hits.
    await pickElement(page, "#flow svg text >> nth=1");
    await page.keyboard.type("this stage should read Assess first");
    await page.keyboard.press("ControlOrMeta+Enter");

    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    const item = items[0];

    expect(item.context.element).toBe("svg");
    expect(item.region.ref.ok).toBe(true);
    expect(item.region.lost).toBe(null);
    expect(item.region.ref.probe).toContain("Three stage flow");

    const resolvedTag = await page.evaluate(function () {
      var stored = window.LAHE.store.shared.read("rev_subject")[0];
      var verdict = window.LAHE.anchor.resolve(stored.region.ref, document);
      return verdict.bound ? verdict.element.tagName : null;
    });
    expect(resolvedTag).toBe("svg");

    const projected = await projectedItems(page);
    expect(projected.items[0].subject.tag).toBe("svg");
    expect(projected.items[0].subject.html).toContain('aria-label="Three stage flow"');
  });
});
