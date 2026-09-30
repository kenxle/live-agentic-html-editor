// Free writing, fix round F1 (editing): one test per finding, each written red
// against the code before its fix.
//
// docs/features/20260928.01_free_writing/reviews_impl/FIX_ROUND.md, group F1.
// The pure halves (the undo rule, the size estimate) are in
// test/unit/free_writing_f1_fixes.test.js.

"use strict";

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");

const MAC = process.platform === "darwin";
const H2 = MAC ? "Meta+Alt+Digit2" : "Control+Shift+Digit2";
const P = MAC ? "Meta+Alt+Digit0" : "Control+Shift+Digit0";
const UNDO = "ControlOrMeta+KeyZ";

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-f1" });
});

test.afterAll(async () => {
  await server.close();
});

function count(page, words) {
  return page.evaluate((w) => document.body.textContent.split(w).length - 1, words);
}

async function reloadAndReplay(page) {
  await page.reload();
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, { message: "boot after reload" });
  await page.evaluate(() => window.__lahe.replayNow());
}

function runFieldsOf(item) {
  return {
    new_blocks: item.new_blocks && item.new_blocks.length ? item.new_blocks : null,
    anchor_after_html: item.anchor_after_html === undefined ? null : item.anchor_after_html,
    anchor_tag_after: item.anchor_tag_after === undefined ? null : item.anchor_tag_after,
    placement: item.placement === undefined ? null : item.placement
  };
}

const CLEARED = { new_blocks: null, anchor_after_html: null, anchor_tag_after: null, placement: null };

test.describe("F1: an empty page opens ready only on a notes review (CR 1, design call 2)", () => {
  test("an empty page that is not a notes review stays in reading state; the notes flag opens it", async ({ page }) => {
    await fw.openFixture(page, server, "empty_notes.html");
    // Asked directly, so the check does not depend on the boot's zero timer.
    const opened = await page.evaluate(() => window.__lahe.handle.editing.openEmptyPage());
    expect(opened, "no notes flag: the empty page does not open").toBeNull();
    expect(await page.evaluate(() => window.__lahe.isEditing()), "no notes flag: reading state").toBe(false);

    await page.evaluate(() => window.__lahe.handle.editing.setNotes(true));
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "the notes flag to open the empty page" });
    const s = await page.evaluate(() => window.__lahe.editState());
    expect(s.placement).toBe("start_of_container");
  });
});

test.describe("F1: a sitting that ends with no new blocks clears the run fields (CR 2, CL 1, design call 3)", () => {
  test("Enter, type, Cmd-Z back to no blocks: the record has no run fields and the word shows once after a reload", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" Anchor added.", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Block gone zqxf1", { delay: 2 });
    await pollPage(page, () => {
      const it = window.__lahe.items().find((i) => i.kind === "edit");
      return !!(it && it.new_blocks && it.new_blocks.length);
    }, undefined, { message: "the draft to carry the new block" });
    await page.keyboard.press(UNDO);
    await page.keyboard.press(UNDO);
    expect(await page.evaluate(() => window.__lahe.handle.editing.sessionElements().length)).toBe(1);
    await fw.commitByEsc(page);

    const item = await fw.onlyEdit(page);
    expect(runFieldsOf(item)).toEqual(CLEARED);
    expect(item.after).toBe("Most weeks look busy from the outside. This one did not. Anchor added.");
    expect(item.after_html.indexOf("zqxf1")).toBe(-1);

    await reloadAndReplay(page);
    expect(await count(page, "Anchor added.")).toBe(1);
    expect(await count(page, "zqxf1")).toBe(0);
  });

  test("a tag changed and changed back: the committed reword carries no anchor_tag_after", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" Reworded.", { delay: 2 });
    await page.keyboard.press(H2);
    await pollPage(page, () => {
      const it = window.__lahe.items().find((i) => i.kind === "edit");
      return !!(it && it.anchor_tag_after === "h2");
    }, undefined, { message: "the draft to carry the tag" });
    await page.keyboard.press(P);
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(runFieldsOf(item)).toEqual(CLEARED);
    expect(item.kind).toBe("edit");
    expect(await page.evaluate(() => document.getElementById("p1").tagName)).toBe("P");
  });
});

test.describe("F1: a long run's draft is not rewritten on every keystroke (CR 5)", () => {
  test("typing into a long run writes the record a few times, and the words are all there after a pause and at Esc", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    const para = Array.from({ length: 80 }, (_, i) => "filler" + i).join(" ");
    await fw.pasteText(page, Array.from({ length: 40 }, () => para).join("\n\n"));
    await pollPage(page, () => window.__lahe.handle.editing.sessionElements().length >= 40, undefined, { message: "the paste" });
    await fw.caretToEndOfSession(page);
    await page.evaluate(() => {
      window.__f1writes = 0;
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).indexOf("lahe.item.") === 0) window.__f1writes += 1;
        return real.call(this, k, v);
      };
    });
    const typed = " and these thirty typed chars";
    await page.keyboard.type(typed, { delay: 5 });
    const writes = await page.evaluate(() => window.__f1writes);
    expect(writes, "record writes while typing " + typed.length + " characters").toBeLessThanOrEqual(5);
    await pollPage(page, (t) => {
      const it = window.__lahe.items().find((i) => i.kind === "edit");
      return !!(it && it.after.slice(-t.length) === t);
    }, typed, { message: "the pause to write the typed words" });

    await page.keyboard.type(" last", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.state).toBe("ready");
    expect(item.after.slice(-(typed.length + 5))).toBe(typed + " last");
  });
});

test.describe("F1: undo after the agent acted raises a take-back (ADV 1, design call 5)", () => {
  test("a ready run with a proofread question: undo raises a take-back with remove_blocks, and the original leaves", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Placed then taken back zqxadv1", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    await page.evaluate((id) => {
      const h = window.__lahe.handle;
      const it = h.store.readItem(h.review, id);
      h.store.write(h.review, Object.assign({}, it, {
        reply: { status: "question", agent: "test", text: "Proofread these?", files: [], at: new Date().toISOString() }
      }));
    }, item.id);

    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), item.id);
    expect(res.reverted).toBe(true);
    expect(res.revert, "a take-back, not a silent drop").toBeTruthy();
    const back = await page.evaluate((id) => window.__lahe.itemById(id), res.revert);
    expect(back.reverts).toBe(item.id);
    expect(back.remove_blocks).toEqual(item.new_blocks);
    expect(back.state).toBe("ready");
    const left = (await fw.items(page)).map((i) => i.id);
    expect(left).toEqual([res.revert]);
    expect(await count(page, "zqxadv1")).toBe(0);
  });
});

test.describe("F1: crash recovery commits a tag-only sitting as format_only (CL 14)", () => {
  test("a tag-only draft left by a dead page is recovered as format_only", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press(H2);
    const find = () => {
      const it = window.__lahe.items().find((i) => i.anchor_tag_after === "h2");
      return it && it.state === "draft" ? it : null;
    };
    await pollPage(page, find, undefined, { message: "the tag-only draft" });
    const draft = await page.evaluate(find);
    await fw.commitByEsc(page);
    const out = await page.evaluate((d) => {
      const h = window.__lahe.handle;
      h.store.write(h.review, d);
      return h.editing.recoverWithdrawn();
    }, draft);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("format_only");
    expect(out[0].state).toBe("ready");
  });
});

test.describe("F1: undo removes only the reviewer's own blocks (CL 15)", () => {
  test("the run's first block is gone: a page block with a later block's words stays", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Unique first block zqxcl15", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("What changed", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks.map((b) => b.html)).toEqual(["Unique first block zqxcl15", "What changed"]);
    const res = await page.evaluate((id) => {
      // The page lost both run blocks (a repaint from the server's markup, say).
      const p1 = document.getElementById("p1");
      p1.nextElementSibling.remove();
      p1.nextElementSibling.remove();
      const out = window.__lahe.handle.editing.undo(id);
      return { out: out, h2: !!document.getElementById("h2") };
    }, item.id);
    expect(res.out.reverted).toBe(true);
    expect(res.h2, "the page's own h2 with the same words is not the reviewer's").toBe(true);
  });
});

test.describe("F1: undo writes the anchor's before_html through cleanMarkup (SR 1, from F2)", () => {
  test("a before_html the run allowlist refuses is cleaned, not written raw", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A run block zqxsr1", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    const out = await page.evaluate((id) => {
      const h = window.__lahe.handle;
      const it = h.store.readItem(h.review, id);
      // A link makes blocks.writeBlock refuse, so undo takes the fallback.
      h.store.write(h.review, Object.assign({}, it, {
        before_html: 'Read <a href="#x" onmouseover="window.__bad=1">this</a> <img src="x" onerror="window.__bad=2">now.'
      }));
      const res = h.editing.undo(id);
      const p1 = document.getElementById("p1");
      return {
        reverted: res.reverted,
        handlers: p1.querySelectorAll("[onmouseover], [onerror]").length,
        link: !!p1.querySelector("a"),
        text: p1.textContent
      };
    }, item.id);
    expect(out.reverted).toBe(true);
    expect(out.handlers).toBe(0);
    expect(out.link, "the page's own link survives the clean").toBe(true);
    expect(out.text).toBe("Read this now.");
  });
});

test.describe("F1: session undo keeps only what each step changed (CL 11)", () => {
  test("fifty steps over a long run hold about one copy of the run, not fifty", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    const para = Array.from({ length: 60 }, (_, i) => "long" + i).join(" ");
    await fw.pasteText(page, Array.from({ length: 30 }, () => para).join("\n\n"));
    await pollPage(page, () => window.__lahe.handle.editing.sessionElements().length >= 30, undefined, { message: "the paste" });
    await fw.caretToEndOfSession(page);
    for (let i = 0; i < 50; i += 1) {
      await page.keyboard.press("Enter");
    }
    const info = await page.evaluate(() => {
      const els = window.__lahe.handle.editing.sessionElements();
      const run = els.reduce((n, el) => n + el.innerHTML.length, 0);
      return { run: run, held: window.__lahe.editState().historyChars, depth: window.__lahe.editState().historyDepth };
    });
    expect(info.depth).toBeGreaterThanOrEqual(50);
    expect(typeof info.held).toBe("number");
    expect(info.held, "characters held by the history against one run of " + info.run).toBeLessThan(info.run * 3);
  });
});

test.describe("F1: the protect restore of a run (CX P2, SR 7)", () => {
  async function openRepaint(page) {
    await fw.openFixture(page, server, "test/fixtures/repainting.html");
    await page.evaluate(() => {
      window.__serverCopy = document.getElementById("live-frame").innerHTML;
    });
    await fw.openEdit(page, "#live-note");
    await page.keyboard.press("Enter");
  }

  function restores(page) {
    return page.evaluate(() => window.LAHE.protect.counters.restores);
  }

  test("a repaint that keeps the words but strips the bold is restored with the bold", async ({ page }) => {
    await openRepaint(page);
    await page.keyboard.type("Run words bold here", { delay: 2 });
    const bolded = await page.evaluate(() => {
      const el = window.__lahe.handle.editing.sessionElements()[1];
      const t = el.firstChild;
      const r = document.createRange();
      r.setStart(t, 10);
      r.setEnd(t, 14);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
      return window.__lahe.handle.editing.format("bold").applied;
    });
    expect(bolded).toBe(true);
    expect(await page.evaluate(() => window.__lahe.handle.editing.sessionElements()[1].innerHTML)).toContain("bold</");
    const before = await restores(page);
    await page.evaluate(() => {
      const el = window.__lahe.handle.editing.sessionElements()[1];
      el.innerHTML = el.textContent;
    });
    await pollPage(page, (was) => window.LAHE.protect.counters.restores > was, before, {
      message: "the stripped bold to count as damage"
    });
    const html = await page.evaluate(() => window.__lahe.handle.editing.sessionElements()[1].innerHTML);
    expect(html).toMatch(/<(strong|b)>bold<\/(strong|b)>/);
  });

  test("the restore rebuilds run blocks through the allowlist, not raw markup", async ({ page }) => {
    await openRepaint(page);
    await page.keyboard.type("Clean run block", { delay: 2 });
    await page.evaluate(() => {
      const el = window.__lahe.handle.editing.sessionElements()[1];
      el.innerHTML = 'Clean run <span onclick="window.__bad=1">block</span>';
      // The next keystroke's snapshot takes whatever the page put there.
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    const before = await restores(page);
    await page.evaluate(() => {
      document.getElementById("live-frame").innerHTML = window.__serverCopy;
    });
    await pollPage(page, (was) => window.LAHE.protect.counters.restores > was, before, { message: "the repaint restore" });
    const out = await page.evaluate(() => ({
      handlers: document.querySelectorAll("#live-frame [onclick]").length,
      texts: window.__lahe.handle.editing.sessionElements().map((el) => el.textContent)
    }));
    expect(out.handlers).toBe(0);
    expect(out.texts[1]).toBe("Clean run block");
  });
});
