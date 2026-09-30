// Free writing, plan Task 2.4: a repaint mid-sitting.
//
// The run's blocks are new elements the page's server never sent, so a
// repaint of their parent drops every one of them. Protection snapshots the
// anchor plus the run and puts it all back after the re-found anchor, with the
// caret at the same block and character offset, and the editing surface moves
// onto what it rebuilt. The repaints here are the no-hook kind: the server's
// markup written back wholesale, which is the case only layer three can save.

"use strict";

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-repaint" });
});

test.afterAll(async () => {
  await server.close();
});

const PAGES = [
  { file: "test/fixtures/repainting.html", frame: "#live-frame", anchor: "#live-note" },
  { file: "md_render.html", frame: "section:first-of-type", anchor: "section:first-of-type > p:first-of-type" }
];

/** The server's copy of the frame, taken before anything is typed. */
async function keepServerCopy(page, frame) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    window.__serverCopy = { inner: el.innerHTML, outer: el.outerHTML };
  }, frame);
}

function restores(page) {
  return page.evaluate(() => window.LAHE.protect.counters.restores);
}

async function repaint(page, frame, how) {
  const before = await restores(page);
  await page.evaluate(
    ([sel, mode]) => {
      const el = document.querySelector(sel);
      if (mode === "inner") el.innerHTML = window.__serverCopy.inner;
      else el.outerHTML = window.__serverCopy.outer;
    },
    [frame, how]
  );
  await pollPage(page, (was) => window.LAHE.protect.counters.restores > was, before, {
    message: "layer three to restore the run after the repaint"
  });
}

function sessionTexts(page) {
  return page.evaluate(() => window.__lahe.handle.editing.sessionElements().map((el) => el.textContent));
}

function caretSpot(page) {
  return page.evaluate(() => {
    const els = window.__lahe.handle.editing.sessionElements();
    const s = window.getSelection();
    const i = els.findIndex((el) => el.contains(s.focusNode));
    if (i === -1) return null;
    const r = document.createRange();
    r.selectNodeContents(els[i]);
    r.setEnd(s.focusNode, s.focusOffset);
    return { block: i, offset: r.toString().length };
  });
}

for (const where of PAGES) {
  test.describe("free writing: a repaint mid-sitting on " + where.file, () => {
    test("keeps every run block, and the caret's block and offset", async ({ page }) => {
      await fw.openFixture(page, server, where.file);
      await keepServerCopy(page, where.frame);
      await fw.openEdit(page, where.anchor);
      await page.keyboard.press("Enter");
      await page.keyboard.type("Run one.", { delay: 2 });
      await page.keyboard.press("Enter");
      await page.keyboard.type("Run two here.", { delay: 2 });
      // Move the caret the way a reviewer does, with keys: from the end of
      // "Run two here." (13) back to offset 3. Each keyup snapshots the live
      // caret synchronously (protect.js onTyping), so the layer has the new
      // spot before the repaint below. A programmatic addRange has no keyup;
      // it waits on selectionchange, a task that under full-suite load arrived
      // AFTER the repaint in 2 of 160 runs, and by then the run block holding
      // the live caret was gone, so the snapshot's end-of-block caret was all
      // there was (phase7_fix_h1.md).
      for (let i = 0; i < "Run two here.".length - 3; i += 1) await page.keyboard.press("ArrowLeft");
      expect(await caretSpot(page), "the caret is where the arrows put it").toEqual({ block: 2, offset: 3 });
      const before = await sessionTexts(page);

      await repaint(page, where.frame, "inner");

      expect(await sessionTexts(page)).toEqual(before);
      expect(await caretSpot(page)).toEqual({ block: 2, offset: 3 });
      const onPage = await page.evaluate(() => {
        const text = document.body.textContent;
        return [text.split("Run one.").length - 1, text.split("Run two here.").length - 1];
      });
      expect(onPage, "each run block is on the page exactly once").toEqual([1, 1]);
      await page.keyboard.type("X", { delay: 2 });
      expect((await sessionTexts(page))[2]).toBe("RunX two here.");
    });

    test("a repaint that replaces the parent keeps typing working", async ({ page }) => {
      await fw.openFixture(page, server, where.file);
      await keepServerCopy(page, where.frame);
      await fw.openEdit(page, where.anchor);
      await page.keyboard.press("Enter");
      await page.keyboard.type("Before the repaint.", { delay: 2 });

      await repaint(page, where.frame, "outer");

      await page.keyboard.type(" After it.", { delay: 2 });
      await page.keyboard.press("Enter");
      await page.keyboard.type("A new block after the repaint.", { delay: 2 });
      const host = await page.evaluate(() => {
        const el = document.querySelector("[data-lahe-edit-host]");
        return el ? el.isContentEditable : false;
      });
      expect(host, "the new parent is the editing host").toBe(true);
      await fw.commitByEsc(page);
      const item = await fw.onlyEdit(page);
      expect(item.new_blocks).toEqual([
        { tag: "p", html: "Before the repaint. After it." },
        { tag: "p", html: "A new block after the repaint." }
      ]);
    });
  });
}
