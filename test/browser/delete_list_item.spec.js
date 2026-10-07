// Delete block on a bullet takes out that bullet, not the whole list.
//
// A list is one block to the editor: the <ul> is the session's block and each
// <li> is a unit inside it. Delete block used to act on the block, so a
// reviewer with the caret in one bullet lost every bullet in the list.

"use strict";

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "delete-list-item" });
});

test.afterAll(async () => {
  await server.close();
});

async function clickDelete(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const button = await page.evaluate(() => {
    const el = window.__lahe.handle.editing.buttonNode("delete");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  expect(button, "the bar offers Delete block").toBeTruthy();
  await page.mouse.click(button.cx, button.cy);
}

function listItems(page) {
  return page.evaluate(() => {
    const list = document.getElementById("list");
    return list ? Array.from(list.querySelectorAll("li")).map((li) => li.textContent) : null;
  });
}

test.describe("Delete block on a bullet", () => {
  test("removes only the bullet the caret is in, and the edit records the list without it", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#list li:nth-child(2)", 3);

    await clickDelete(page);

    expect(await listItems(page), "the other bullet stays").toEqual(["Fewer meetings"]);
    expect(await page.evaluate(() => window.__lahe.isEditing()), "still editing the list").toBe(true);

    await fw.commitByEsc(page);
    expect(await listItems(page), "the commit keeps the list without that bullet").toEqual(["Fewer meetings"]);
    const items = await page.evaluate(() => window.__lahe.handle.editing.items());
    expect(items, "one record").toHaveLength(1);
    expect(items[0].kind, "an edit to the list, not a deletion of it").not.toBe("delete");
    expect(items[0].after).toContain("Fewer meetings");
    expect(items[0].after).not.toContain("Longer blocks");
  });

  test("the first bullet goes too, with the caret moving to the next one", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#list li:nth-child(1)", 2);

    await clickDelete(page);

    expect(await listItems(page)).toEqual(["Longer blocks"]);
    const caretIn = await page.evaluate(() => {
      const s = window.getSelection();
      const n = s.rangeCount ? s.getRangeAt(0).startContainer : null;
      const el = n && (n.nodeType === 1 ? n : n.parentElement);
      return el ? el.closest("li") && el.closest("li").textContent : null;
    });
    expect(caretIn, "the caret lands in the bullet that is left").toBe("Longer blocks");
  });

  test("the last bullet left takes the whole list with it, as before", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#list li:nth-child(1)", 2);
    await clickDelete(page);
    await clickDelete(page);

    await pollPage(page, () => !document.getElementById("list"), undefined, {
      message: "the list to leave the page"
    });
    const items = await page.evaluate(() => window.__lahe.handle.editing.items());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("delete");
  });

  test("the button says Delete item in a bullet and Delete block in a paragraph", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    const label = () => page.evaluate(() => window.__lahe.handle.editing.buttonNode("delete").textContent);

    await fw.openEdit(page, "#list li:nth-child(1)", 2);
    await pollPage(page, () => window.__lahe.handle.editing.buttonNode("delete").textContent === "Delete item", undefined, {
      message: "the bar to say Delete item in a bullet"
    });
    await fw.commitByEsc(page);

    await fw.openEdit(page, "#p2", 2);
    expect(await label(), "a paragraph keeps Delete block").toBe("Delete block");
  });

  test("undo brings the bullet back", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#list li:nth-child(2)", 3);
    await clickDelete(page);
    expect(await listItems(page)).toEqual(["Fewer meetings"]);

    await page.keyboard.press("ControlOrMeta+KeyZ");
    await pollPage(page, () => document.querySelectorAll("#list li").length === 2, undefined, {
      message: "undo to put the bullet back"
    });
    expect(await listItems(page)).toEqual(["Fewer meetings", "Longer blocks"]);
  });
});
