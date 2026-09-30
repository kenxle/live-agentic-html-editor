// Free writing, plan Task 2.3: starting in empty space, and the empty page.
//
// While any edit is open, a gap between blocks shows "+ Write here". Clicking
// it commits the open session and starts a new one after the block above. With
// the caret in no block, Cmd-Shift-E enters edit state with no block open. An
// empty page opens ready to type (PQ1).

"use strict";

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-empty" });
});

test.afterAll(async () => {
  await server.close();
});

function line(page) {
  return page.evaluate(() => window.__lahe.handle.editing.lineInfo());
}

function bar(page) {
  return page.evaluate(() => window.__lahe.handle.editing.barInfo());
}

async function hoverGap(page, above, below) {
  const pt = await page.evaluate(
    ([a, b]) => {
      const ra = document.querySelector(a).getBoundingClientRect();
      const y = b ? (ra.bottom + document.querySelector(b).getBoundingClientRect().top) / 2 : ra.bottom + 12;
      return { x: ra.left + 40, y: y };
    },
    [above, below]
  );
  await page.mouse.move(pt.x, pt.y);
  await pollPage(page, () => !!window.__lahe.handle.editing.lineInfo(), undefined, { message: "the line to show" });
}

test.describe("free writing: empty space and the empty page", () => {
  test("hovering a gap shows the line, stopped at the rail's edge; clicking it commits and starts after the right block", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await fw.openFixture(page, server, "blog.html", { collapseRail: false });
    await page.evaluate(() => window.__lahe.rail.collapse(false));
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" Typed in the first sitting.", { delay: 2 });
    await hoverGap(page, "#p2", "#list");
    const info = await line(page);
    expect(info.label).toBe("+ Write here");
    expect(info.after).toBe("We stopped measuring motion and started measuring outcomes.");
    const edge = await page.evaluate(() => {
      const host = document.getElementById("lahe-surface-root");
      const allowance = parseFloat(getComputedStyle(host).getPropertyValue("--lahe-rail-allowance")) || 0;
      return { allowance: allowance, width: window.innerWidth };
    });
    expect(edge.allowance, "the rail is open and publishes its berth").toBeGreaterThan(0);
    expect(info.rect.x + info.rect.width).toBeLessThanOrEqual(edge.width - edge.allowance);

    await page.mouse.click(info.rect.cx, info.rect.cy);
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "a new session after the click" });
    const records = await fw.items(page);
    const first = records.find((it) => it.before && it.before.indexOf("Most weeks") === 0);
    expect(first.state, "the first session committed").toBe("ready");
    const s = await page.evaluate(() => window.__lahe.editState());
    expect(s.itemId).not.toBe(first.id);
    await page.keyboard.type("Written in the gap.", { delay: 2 });
    await fw.commitByEsc(page);
    const second = await page.evaluate((id) => window.__lahe.itemById(id), s.itemId);
    expect(second.before).toBe("We stopped measuring motion and started measuring outcomes.");
    expect(second.placement).toBe("after_anchor");
    expect(second.new_blocks).toEqual([{ tag: "p", html: "Written in the gap." }]);
    expect(await page.evaluate(() => document.getElementById("p2").nextElementSibling.textContent)).toBe("Written in the gap.");
  });

  test("the line shows at once under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await hoverGap(page, "#list");
    const info = await line(page);
    expect(info.transition).toBe("0s");
    expect(info.opacity).toBe("1");
  });

  test("Cmd-Shift-E with the caret in no block shows the bar and its hint; a click opens a block; Esc leaves", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.handle.editing.isInEditState() === true, undefined, { message: "edit state" });
    const b = await bar(page);
    expect(b.label).toBe("Editing");
    expect(b.hint).toBe("Click + Write here to add text. Esc to finish.");
    expect({ type: b.typeVisible, format: b.formatVisible, del: b.deleteVisible }).toEqual({ type: false, format: false, del: false });
    expect(b.rect.y).toBeLessThan(40);
    expect(await page.evaluate(() => window.__lahe.isEditing())).toBe(false);

    await hoverGap(page, "#p1", "#h2");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.__lahe.handle.editing.isInEditState())).toBe(false);
    expect(await bar(page)).toBeNull();
    expect(await line(page)).toBeNull();

    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await page.click("#p2");
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "a click to open the block" });
    expect(await page.evaluate(() => window.__lahe.handle.editing.sessionElements()[0].id)).toBe("p2");
  });

  test("the placeholder is never in the page's DOM or in the record", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await hoverGap(page, "#p2", "#list");
    const info = await line(page);
    await page.mouse.click(info.rect.cx, info.rect.cy);
    await pollPage(page, () => !!window.__lahe.handle.editing.placeholderInfo(), undefined, { message: "the placeholder" });
    expect((await page.evaluate(() => window.__lahe.handle.editing.placeholderInfo())).text).toBe("Start writing");
    expect(await page.evaluate(() => document.documentElement.outerHTML.indexOf("Start writing"))).toBe(-1);
    await page.keyboard.type("R", { delay: 2 });
    expect(await page.evaluate(() => window.__lahe.handle.editing.placeholderInfo())).toBeNull();
    await page.keyboard.type("eal words.", { delay: 2 });
    await fw.commitByEsc(page);
    const all = JSON.stringify(await fw.items(page));
    expect(all.indexOf("Start writing")).toBe(-1);
  });

  test("the empty notes page opens ready, and the first sitting is start_of_container on main, not the title", async ({ page }) => {
    await fw.openFixture(page, server, "empty_notes.html", { notes: true });
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "the empty page to open ready" });
    expect(await page.evaluate(() => window.__lahe.editState().placement)).toBe("start_of_container");
    await page.keyboard.type("First notes line.", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.placement).toBe("start_of_container");
    expect(item.region.ref.fingerprint.tag).toBe("main");
    expect(item.context.element).toBe("MAIN");
    expect(item.new_blocks).toEqual([{ tag: "p", html: "First notes line." }]);
    const where = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("main p")).find((el) => el.textContent === "First notes line.");
      const title = document.querySelector("[data-lahe-file-title]");
      return { afterTitle: !!(title.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING), inTitle: title.contains(p) };
    });
    expect(where).toEqual({ afterTitle: true, inTitle: false });
  });

  test("a second sitting before the agent places the first continues the record; after it is handled the next is after_anchor on the last block", async ({ page }) => {
    await fw.openFixture(page, server, "empty_notes.html", { notes: true });
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "the empty page to open ready" });
    await page.keyboard.type("Line one.", { delay: 2 });
    await fw.commitByEsc(page);
    const first = await fw.onlyEdit(page);

    const lineOne = "main p:last-of-type";
    await fw.openEdit(page, lineOne);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Line two.", { delay: 2 });
    await fw.commitByEsc(page);
    const again = await fw.onlyEdit(page);
    expect(again.id).toBe(first.id);
    expect(again.rev).toBe(2);
    expect(again.new_blocks).toEqual([
      { tag: "p", html: "Line one." },
      { tag: "p", html: "Line two." }
    ]);

    await page.evaluate((id) => {
      const h = window.__lahe.handle;
      h.store.write(h.review, Object.assign({}, h.store.readItem(h.review, id), { state: "handled" }));
    }, first.id);
    await fw.openEdit(page, "main p:last-of-type");
    await hoverGap(page, "main p:last-of-type");
    const info = await line(page);
    await page.mouse.click(info.rect.cx, info.rect.cy);
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "a sitting below the last block" });
    await page.keyboard.type("Line three.", { delay: 2 });
    await fw.commitByEsc(page);
    const next = (await fw.items(page)).find((it) => it.id !== first.id && it.new_blocks && it.new_blocks.length);
    expect(next.placement).toBe("after_anchor");
    expect(next.before).toBe("Line two.");
    expect(next.new_blocks).toEqual([{ tag: "p", html: "Line three." }]);
  });
});
