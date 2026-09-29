// Free writing, plan Task 2.4: undo inside a session, and undo of a committed
// run record.
//
// The layer writes block changes itself, so the browser's own undo stack no
// longer reflects them. The session keeps its own history: a step per block
// change and per typing burst, and a Markdown shortcut is its own step, so
// Cmd-Z right after "1. " gives the typed characters back (brief R6).

"use strict";

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures().runFixtures();
const fw = require("./support/free_writing_page");

const MAC = process.platform === "darwin";
const H2 = MAC ? "Meta+Alt+Digit2" : "Control+Shift+Digit2";
const UNDO = "ControlOrMeta+KeyZ";
const REDO = "ControlOrMeta+Shift+KeyZ";

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-undo" });
});

test.afterAll(async () => {
  await server.close();
});

function session(page) {
  return page.evaluate(() =>
    window.__lahe.handle.editing.sessionElements().map((el) => el.tagName.toLowerCase() + ":" + el.textContent)
  );
}

async function markHandled(page, id) {
  await page.evaluate((itemId) => {
    const h = window.__lahe.handle;
    h.store.write(h.review, Object.assign({}, h.store.readItem(h.review, itemId), { state: "handled" }));
  }, id);
}

test.describe("free writing: undo", () => {
  test("Cmd-Z right after 1. gives back the typed characters", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("1. ", { delay: 2 });
    expect((await session(page))[1]).toBe("ol:");
    await page.keyboard.press(UNDO);
    const back = await session(page);
    expect(back[1].replace(/ /g, " ")).toBe("p:1. ");
  });

  test("Cmd-Z walks block changes in order and redo walks them back", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    const start = await session(page);
    await page.keyboard.press("Enter");
    const s1 = await session(page);
    await page.keyboard.type("words", { delay: 2 });
    const s2 = await session(page);
    await page.keyboard.press(H2);
    const s3 = await session(page);
    expect(s3[1]).toBe("h2:words");

    await page.keyboard.press(UNDO);
    expect(await session(page)).toEqual(s2);
    await page.keyboard.press(UNDO);
    expect(await session(page)).toEqual(s1);
    await page.keyboard.press(UNDO);
    expect(await session(page)).toEqual(start);
    await page.keyboard.press(REDO);
    expect(await session(page)).toEqual(s1);
    await page.keyboard.press(REDO);
    expect(await session(page)).toEqual(s2);
    await page.keyboard.press(REDO);
    expect(await session(page)).toEqual(s3);
  });

  test("step 101 drops the oldest", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    for (let i = 0; i < 101; i += 1) await page.keyboard.press("Enter");
    expect((await session(page)).length).toBe(102);
    expect(await page.evaluate(() => window.__lahe.editState().historyDepth)).toBe(100);
    for (let i = 0; i < 101; i += 1) await page.keyboard.press(UNDO);
    expect((await session(page)).length, "the first Enter can no longer be undone").toBe(2);
    for (let i = 0; i < 100; i += 1) await page.keyboard.press(REDO);
    expect((await session(page)).length).toBe(102);
  });

  test("undo of a committed run the agent has not handled removes it, and it stays gone after two reloads", async ({ page }) => {
    const review = await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" Anchor words added.", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("A run block to take back.", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), item.id);
    expect(res.reverted).toBe(true);
    expect(res.revert).toBeNull();
    const now = await page.evaluate(() => ({
      p1: document.getElementById("p1").textContent,
      next: document.getElementById("p1").nextElementSibling.id,
      has: document.body.textContent.indexOf("A run block to take back.") !== -1
    }));
    expect(now).toEqual({ p1: "Most weeks look busy from the outside. This one did not.", next: "h2", has: false });
    expect(await fw.items(page)).toEqual([]);
    for (let i = 0; i < 2; i += 1) {
      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, { message: "boot after reload" });
      await page.evaluate(() => window.__lahe.replayNow());
      expect(await page.evaluate(() => document.body.textContent.indexOf("A run block to take back.") === -1)).toBe(true);
      expect(await fw.items(page)).toEqual([]);
    }
    void review;
  });

  test("undo of a tag change restores the paragraph", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press(H2);
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(await page.evaluate(() => document.getElementById("p1").tagName)).toBe("H2");
    await page.evaluate((id) => window.__lahe.handle.editing.undo(id), item.id);
    const back = await page.evaluate(() => ({
      tag: document.getElementById("p1").tagName,
      text: document.getElementById("p1").textContent
    }));
    expect(back).toEqual({ tag: "P", text: "Most weeks look busy from the outside. This one did not." });
  });

  test("undo of a handled run raises a take-back with remove_blocks and no new_blocks", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await page.evaluate(() => {
      document.getElementById("p1").textContent = "What changed";
    });
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("# What the chat window cost me zqxcanary", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("I lost my place every time zqxcanary", { delay: 2 });
    await fw.formatPhrase(page, "#p1 ~ p", "every", "bold");
    await fw.caretToEndOfSession(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("- scrolling", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("re-asking zqxcanary", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    await markHandled(page, item.id);

    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), item.id);
    expect(res.reverted).toBe(true);
    const back = await page.evaluate((id) => window.__lahe.itemById(id), res.revert);
    const want = fixtures.find((f) => f.name === "take-back").item;
    expect(back.new_blocks).toBeUndefined();
    expect(back.remove_blocks).toEqual(want.remove_blocks);
    expect(back.reverts).toBe(item.id);
    expect(fw.runShape(back)).toEqual(fw.runShape(want));
    expect(await page.evaluate(() => document.body.textContent.indexOf("zqxcanary") === -1), "the run is off the page").toBe(true);
  });
});
