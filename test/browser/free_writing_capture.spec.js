// Free writing, plan Task 2.1: typing produces the agreed record shapes.
//
// record_fixtures.runFixtures() is the shape the replay (2B) and helper (2C)
// workstreams build against. Every fixture typing can produce is typed here,
// on a real page with the real layer, and its fields, tags and markup must
// deep-equal the fixture's, ids and times aside. The take-back fixture is
// typed in free_writing_undo.spec.js, because it needs an undo.

"use strict";

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures().runFixtures();
const fw = require("./support/free_writing_page");

function fixture(name) {
  const got = fixtures.find((f) => f.name === name);
  if (!got) throw new Error("no run fixture named " + name);
  return got;
}

function expected(name) {
  return fw.runShape(fixture(name).item);
}

const MAC = process.platform === "darwin";
const CHORD = {
  h2: MAC ? "Meta+Alt+Digit2" : "Control+Shift+Digit2",
  h3: MAC ? "Meta+Alt+Digit3" : "Control+Shift+Digit3",
  ul: MAC ? "Meta+Shift+Digit8" : "Control+Shift+Digit8"
};

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-capture" });
});

test.afterAll(async () => {
  await server.close();
});

async function blog(page, p1Text) {
  await fw.openFixture(page, server, "blog.html");
  if (p1Text !== undefined) {
    await page.evaluate((t) => {
      document.getElementById("p1").textContent = t;
    }, p1Text);
  }
}

test.describe("free writing: typing produces every run fixture", () => {
  test("the worked example, after a paragraph on blog.html", async ({ page }) => {
    await blog(page, "What changed");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("# What the chat window cost me zqxcanary", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("I lost my place every time zqxcanary", { delay: 2 });
    expect(await fw.formatPhrase(page, "#p1 ~ p", "every", "bold")).toBe(true);
    await fw.caretToEndOfSession(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("- scrolling", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("re-asking zqxcanary", { delay: 2 });
    await fw.commitByEsc(page);

    const item = await fw.onlyEdit(page);
    expect(fw.runShape(item)).toEqual(expected("worked example"));
    expect(item.state).toBe("ready");
    expect(item.after).toBe(fixture("worked example").after);
    expect(item.change).toBe(fixture("worked example").change);
    // The blocks are siblings of the anchor, in the page's own article.
    const tags = await page.evaluate(() =>
      Array.from(document.getElementById("post").children).map((el) => el.tagName.toLowerCase())
    );
    expect(tags).toEqual(["h1", "p", "h2", "p", "ul", "h2", "p", "ul"]);
  });

  test("a split tail with no typing", async ({ page }) => {
    const words = "First half zqxcanary. Second half zqxcanary.";
    await blog(page, words);
    await fw.openEdit(page, "#p1", words.indexOf("Second"));
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(fw.runShape(item)).toEqual(expected("split tail, no typing"));
    expect(item.change).not.toContain("Added");
  });

  test("a split tail with typing after it", async ({ page }) => {
    const words = "First half zqxcanary. Second half zqxcanary.";
    await blog(page, words);
    await fw.openEdit(page, "#p1", words.indexOf("Second"));
    await page.keyboard.press("Enter");
    await fw.caretToEndOfSession(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Typed after the split zqxcanary", { delay: 2 });
    await fw.commitByEsc(page);
    expect(fw.runShape(await fw.onlyEdit(page))).toEqual(expected("split tail, with typing"));
  });

  test("a tag-only change", async ({ page }) => {
    await blog(page, "Plain words zqxcanary");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press(CHORD.h2);
    await fw.commitByEsc(page);
    expect(fw.runShape(await fw.onlyEdit(page))).toEqual(expected("tag-only change"));
  });

  test("a tag change with new words", async ({ page }) => {
    await blog(page, "Old words zqxcanary");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("ControlOrMeta+KeyA");
    await page.keyboard.type("New words zqxcanary", { delay: 2 });
    await page.keyboard.press(CHORD.h3);
    await fw.commitByEsc(page);
    expect(fw.runShape(await fw.onlyEdit(page))).toEqual(expected("tag change with new words"));
  });

  test("a paragraph turned into a list", async ({ page }) => {
    await blog(page, "Item words zqxcanary");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press(CHORD.ul);
    await fw.commitByEsc(page);
    expect(fw.runShape(await fw.onlyEdit(page))).toEqual(expected("paragraph turned into a list"));
  });

  test("an item added to an existing list", async ({ page }) => {
    await blog(page);
    await page.evaluate(() => {
      document.getElementById("list").innerHTML = "<li>one zqxcanary</li>";
    });
    await fw.openEdit(page, "#list li");
    await page.keyboard.press("Enter");
    await page.keyboard.type("two zqxcanary", { delay: 2 });
    await fw.commitByEsc(page);
    expect(fw.runShape(await fw.onlyEdit(page))).toEqual(expected("item added to an existing list"));
  });

  test("start_of_container, on the empty notes page", async ({ page }) => {
    await fw.openFixture(page, server, "empty_notes.html");
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, {
      message: "the empty page to open ready to type"
    });
    await page.keyboard.type("# Notes zqxcanary", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("First thought zqxcanary", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(fw.runShape(item)).toEqual(expected("start of container"));
    expect(item.region.ref.fingerprint.tag).toBe("main");
  });

  test("special characters stay as typed", async ({ page }) => {
    await blog(page, "What changed");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type(
      "Use <b> & *stars* _under_ `code` # not a heading 1. not a list \"straight\" 'quotes' -- dashes zqxcanary",
      { delay: 1 }
    );
    await fw.commitByEsc(page);
    expect(fw.runShape(await fw.onlyEdit(page))).toEqual(expected("special characters"));
  });

  test("a second sitting on the run continues the same record", async ({ page }) => {
    await blog(page, "What changed");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("An earlier run zqxcanary", { delay: 2 });
    await fw.commitByEsc(page);
    const first = await fw.onlyEdit(page);

    await fw.openEdit(page, "#p1 + p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("And a second sitting zqxcanary", { delay: 2 });
    await fw.commitByEsc(page);
    const later = await fw.onlyEdit(page);
    expect(later.id).toBe(first.id);
    expect(later.rev).toBe(2);
    expect(fw.runShape(later)).toEqual(expected("with an earlier run in history"));
  });
});
