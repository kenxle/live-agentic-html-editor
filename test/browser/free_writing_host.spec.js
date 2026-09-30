// Free writing, plan Task 2.1: the editing host and the session.
//
// The host is the anchor's parent, made editable, with a beforeinput guard.
// These are the host's promises: the layer writes every edit across a block
// edge, the caret crosses between anchor and run, nothing outside the session
// ever changes, and the session ends when the caret leaves it.

"use strict";

const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");
const fw = require("./support/free_writing_page");

const OUTSIDE = ["#title", "#h2", "#p2", "#list"];

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-host" });
});

test.afterAll(async () => {
  await server.close();
});

/** blog.html, with #p1 open and a one-paragraph run typed after it. */
async function withRun(page, runText) {
  await fw.openFixture(page, server, "blog.html");
  await fw.openEdit(page, "#p1");
  await page.keyboard.press("Enter");
  await page.keyboard.type(runText || "A new paragraph after the first.", { delay: 2 });
}

function runTexts(page) {
  return page.evaluate(() => window.__lahe.handle.editing.sessionElements().map((el) => el.textContent));
}

async function state(page) {
  return page.evaluate(() => window.__lahe.editState());
}

test.describe("free writing: the editing host", () => {
  test("Backspace at the start of the first run block merges into the anchor", async ({ page }) => {
    await withRun(page, "Joined words.");
    await fw.caretAt(page, "#p1 + p", 0);
    await page.keyboard.press("Backspace");
    expect(await runTexts(page)).toEqual(["Most weeks look busy from the outside. This one did not.Joined words."]);
    const html = await page.evaluate(() => document.getElementById("p1").innerHTML);
    expect(html, "no inline style span from a native merge").not.toMatch(/<span|style=/);
  });

  test("Delete at the anchor's end merges the first run block", async ({ page }) => {
    await withRun(page, "Pulled up.");
    const len = await page.evaluate(() => document.getElementById("p1").textContent.length);
    await fw.caretAt(page, "#p1", len);
    await page.keyboard.press("Delete");
    expect(await runTexts(page)).toEqual(["Most weeks look busy from the outside. This one did not.Pulled up."]);
  });

  test("Backspace at the anchor's start and Delete at the run's end change nothing outside", async ({ page }) => {
    await withRun(page);
    const before = await fw.outsideSnapshot(page, OUTSIDE);
    await fw.caretAt(page, "#p1", 0);
    await page.keyboard.press("Backspace");
    await fw.caretToEndOfSession(page);
    await page.keyboard.press("Delete");
    expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
    expect((await runTexts(page)).length).toBe(2);
  });

  test("arrow and Shift-arrow cross between the anchor and the run", async ({ page }) => {
    await withRun(page, "Second line.");
    await fw.caretAt(page, "#p1", 3);
    await page.keyboard.press("ArrowDown");
    expect(await state(page)).toMatchObject({ open: true });
    const inRun = await page.evaluate(() => {
      const run = window.__lahe.handle.editing.sessionElements()[1];
      return run.contains(window.getSelection().focusNode);
    });
    expect(inRun, "ArrowDown moved the caret into the run").toBe(true);
    await page.keyboard.press("Shift+ArrowUp");
    const spans = await page.evaluate(() => {
      const [a, r] = window.__lahe.handle.editing.sessionElements();
      const s = window.getSelection();
      return (a.contains(s.anchorNode) || r.contains(s.anchorNode)) && (a.contains(s.focusNode) || r.contains(s.focusNode)) && !s.isCollapsed;
    });
    expect(spans, "Shift-ArrowUp selects across the edge").toBe(true);
    expect((await state(page)).open).toBe(true);
  });

  // The layer takes Cmd-A itself and selects the session, so the native
  // select-all never runs. The precondition is that the selection covers the
  // whole session and no more; the outside blocks staying put is then the
  // layer's own doing.
  for (const how of ["Cmd-A then type", "Cmd-A then Backspace"]) {
    test("every block outside the session keeps its outerHTML: " + how, async ({ page }) => {
      await withRun(page);
      const before = await fw.outsideSnapshot(page, OUTSIDE);
      await page.keyboard.press("ControlOrMeta+KeyA");
      const sel = await page.evaluate(() => {
        const s = window.getSelection();
        const blocks = window.__lahe.handle.editing.sessionElements();
        return {
          coversSession: blocks.every((b) => s.containsNode(b, true)) && !s.isCollapsed,
          reachesOutside: ["#h2", "#p2", "#list"].some((sel) => s.containsNode(document.querySelector(sel), true))
        };
      });
      expect(sel, "Cmd-A selected the session and stopped at its edge").toEqual({ coversSession: true, reachesOutside: false });
      if (how === "Cmd-A then type") await page.keyboard.type("Replaced.", { delay: 2 });
      else await page.keyboard.press("Backspace");
      expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
      expect((await state(page)).open).toBe(true);
    });
  }

  // The guard itself, with a selection that really does reach the outside
  // blocks (set by the Selection API, the way a native select-all would).
  for (const how of ["type", "Backspace"]) {
    test("every block outside keeps its outerHTML: a selection over the whole host, then " + how, async ({ page }) => {
      await withRun(page);
      const before = await fw.outsideSnapshot(page, OUTSIDE);
      const reached = await page.evaluate(() => {
        const host = document.getElementById("p1").parentElement;
        const r = document.createRange();
        r.selectNodeContents(host);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return ["#h2", "#p2", "#list"].map((sel) => s.containsNode(document.querySelector(sel), true));
      });
      expect(reached, "the selection reaches the outside blocks").toEqual([true, true, true]);
      if (how === "type") await page.keyboard.type("Replaced.", { delay: 2 });
      else await page.keyboard.press("Backspace");
      expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
    });
  }

  test("every block outside keeps its outerHTML: ArrowDown out of the run, then type, Cmd-B, Cmd-Z", async ({ page }) => {
    await withRun(page);
    const before = await fw.outsideSnapshot(page, OUTSIDE);
    await fw.caretToEndOfSession(page);
    await page.keyboard.press("ArrowDown");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "the arrow out of the run to end the session"
    });
    await page.keyboard.type("stray", { delay: 2 });
    await page.keyboard.press("ControlOrMeta+KeyB");
    await page.keyboard.press("ControlOrMeta+KeyZ");
    expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
  });

  test("every block outside keeps its outerHTML: Cmd-B and Cmd-Z with the session open and a selection reaching into #p2", async ({ page }) => {
    await withRun(page);
    const before = await fw.outsideSnapshot(page, OUTSIDE);
    await page.evaluate(() => {
      const run = window.__lahe.handle.editing.sessionElements()[1];
      const p2 = document.getElementById("p2");
      const r = document.createRange();
      r.setStart(run.firstChild, 2);
      r.setEnd(p2.firstChild, 5);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    expect(await page.evaluate(() => window.__lahe.isEditing()), "the session is still open").toBe(true);
    expect(
      await page.evaluate(() => window.getSelection().containsNode(document.getElementById("p2"), true)),
      "the selection reaches into #p2"
    ).toBe(true);
    await page.keyboard.press("ControlOrMeta+KeyB");
    await page.keyboard.press("ControlOrMeta+KeyZ");
    expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
  });

  // A synthetic DragEvent("drop") runs no default action in any browser, so a
  // test built on one is green with the guard deleted. These three go through
  // a real drag, and through the beforeinput the engine sends for a drop.
  test("every block outside keeps its outerHTML: a trusted drop onto #p2", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "a trusted drop is driven through the Chromium DevTools protocol only; the beforeinput case below covers the guard in every lane");
    await withRun(page, "Words to drag away.");
    const before = await fw.outsideSnapshot(page, OUTSIDE);
    await page.evaluate(() => {
      window.__dragLog = { dropOnP2: 0, trusted: false, prevented: null };
      document.getElementById("p2").addEventListener(
        "drop",
        (e) => {
          window.__dragLog.dropOnP2 += 1;
          window.__dragLog.trusted = e.isTrusted;
        },
        true
      );
      // Bubble phase on window: after the layer's handler has run.
      window.addEventListener("drop", (e) => (window.__dragLog.prevented = e.defaultPrevented), false);
    });
    const at = await page.evaluate(() => {
      const b = document.getElementById("p2").getBoundingClientRect();
      return { x: Math.round(b.left + 20), y: Math.round(b.top + b.height / 2) };
    });
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [{ mimeType: "text/plain", data: "dropped words" }], dragOperationsMask: 1 };
    await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", x: at.x, y: at.y, data });
    await cdp.send("Input.dispatchDragEvent", { type: "dragOver", x: at.x, y: at.y, data });
    await cdp.send("Input.dispatchDragEvent", { type: "drop", x: at.x, y: at.y, data });
    const log = await page.evaluate(() => window.__dragLog);
    expect(log.dropOnP2, "the drop reached #p2").toBeGreaterThan(0);
    expect(log.trusted, "and it was a trusted event").toBe(true);
    expect(log.prevented, "the guard cancelled the drop's default action").toBe(true);
    expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
  });

  test("a beforeinput insertFromDrop aimed at #p2 is cancelled", async ({ page }) => {
    await withRun(page);
    const before = await fw.outsideSnapshot(page, OUTSIDE);
    const prevented = await page.evaluate(() => {
      const p2 = document.getElementById("p2");
      const r = document.createRange();
      r.setStart(p2.firstChild, 3);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      const dt = new DataTransfer();
      dt.setData("text/plain", "dropped words");
      const ev = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertFromDrop", dataTransfer: dt });
      p2.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented, "the guard cancelled the drop's beforeinput").toBe(true);
    expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
  });

  test("a rich drop into a run block arrives as plain text", async ({ page }) => {
    await withRun(page, "Drop here: ");
    // A drop event carrying rich and plain text, aimed at the end of the run
    // block. The layer takes the drop itself (onRunDrop) and inserts the plain
    // text at the point; the rich markup never arrives.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/html", "<h3 style='color:red'>Dropped <b>bold</b></h3>");
      dt.setData("text/plain", "Dropped bold");
      const run = window.__lahe.handle.editing.sessionElements()[1];
      const r = document.createRange();
      r.selectNodeContents(run);
      const rects = r.getClientRects();
      const last = rects[rects.length - 1];
      run.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: last.right - 1, clientY: last.top + last.height / 2 })
      );
    });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toHaveLength(1);
    expect(item.new_blocks[0].tag).toBe("p");
    expect(item.new_blocks[0].html.replace(/&nbsp;| /g, " ")).toBe("Drop here: Dropped bold");
  });

  test("every block outside keeps its outerHTML: a synthetic drop onto one", async ({ page }) => {
    await withRun(page);
    const before = await fw.outsideSnapshot(page, OUTSIDE);
    await page.evaluate(() => {
      const target = document.getElementById("p2");
      const r = target.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData("text/plain", "dropped words");
      target.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 4, clientY: r.top + 4 })
      );
    });
    expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
  });

  test("every block outside keeps its outerHTML: a cut across the session's edge", async ({ page }) => {
    await withRun(page);
    const before = await fw.outsideSnapshot(page, OUTSIDE);
    await page.evaluate(() => {
      const run = window.__lahe.handle.editing.sessionElements()[1];
      const h2 = document.getElementById("h2");
      const r = document.createRange();
      r.setStart(run.firstChild, 2);
      r.setEnd(h2.firstChild, 3);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    // Precondition: the selection really reaches outside the session, so the
    // cut is the risky one.
    expect(
      await page.evaluate(() => window.getSelection().containsNode(document.getElementById("h2"), true)),
      "the selection reaches #h2"
    ).toBe(true);
    const runBefore = (await runTexts(page))[1];
    await page.keyboard.press("ControlOrMeta+KeyX");
    expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
    expect((await runTexts(page))[1], "a cut that reaches outside deletes nothing in the run either").toBe(runBefore);
  });

  test("a cut wholly inside the session deletes its characters", async ({ page }) => {
    await withRun(page, "Cut these words out.");
    await page.evaluate(() => {
      const run = window.__lahe.handle.editing.sessionElements()[1];
      const r = document.createRange();
      r.setStart(run.firstChild, 4);
      r.setEnd(run.firstChild, 10);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.press("ControlOrMeta+KeyX");
    expect((await runTexts(page))[1]).toBe("Cut words out.");
  });

  test("every block outside keeps its outerHTML: a composition started outside", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "IME composition is driven through the Chromium DevTools protocol only");
    await withRun(page);
    const before = await fw.outsideSnapshot(page, OUTSIDE);
    await placeCaret(page, { selector: "#p2", offset: 3 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.insertText", { text: "仮名" });
    await pollPage(page, (sel) => document.querySelector(sel).textContent.indexOf("仮名") === -1, "#p2", {
      message: "the stray composition to be put back"
    });
    expect(await fw.outsideSnapshot(page, OUTSIDE)).toEqual(before);
  });

  test("typing over a spanning selection leaves no inline style spans", async ({ page }) => {
    await withRun(page, "Second block words.");
    await page.evaluate(() => {
      const [a, r] = window.__lahe.handle.editing.sessionElements();
      const range = document.createRange();
      range.setStart(a.firstChild, 10);
      range.setEnd(r.firstChild, 7);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    });
    await page.keyboard.type("X", { delay: 2 });
    const got = await page.evaluate(() => {
      const els = window.__lahe.handle.editing.sessionElements();
      return { count: els.length, html: els.map((e) => e.outerHTML).join("") };
    });
    expect(got.count).toBe(1);
    expect(got.html).not.toMatch(/<span|style=/);
    expect(await runTexts(page)).toEqual(["Most weeksXblock words."]);
  });

  test("a paste of formatted HTML arrives as plain paragraphs", async ({ page, browserName, context }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    const html = "<h3 style='color:red'>Pasted <b>bold</b> head</h3><p>Second <a href='https://x.test'>para</a></p>";
    const text = "Pasted bold head\n\nSecond para";
    if (browserName === "chromium") {
      // A real Meta+V: the clipboard holds rich and plain text, the way a copy
      // from another page does.
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.evaluate(
        async ([h, t]) => {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([h], { type: "text/html" }),
              "text/plain": new Blob([t], { type: "text/plain" })
            })
          ]);
        },
        [html, text]
      );
      await page.keyboard.press("ControlOrMeta+KeyV");
    } else {
      // Firefox and WebKit: Playwright cannot write a rich clipboard there.
      // See fw.pasteText for what stands in for Meta+V in each.
      await fw.pasteText(page, text, html);
    }
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([
      { tag: "p", html: "Pasted bold head" },
      { tag: "p", html: "Second para" }
    ]);
  });

  test("an IME composition inside a run block commits its text", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "IME composition is driven through the Chromium DevTools protocol only");
    await withRun(page, "Kana: ");
    await fw.caretToEndOfSession(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.insertText", { text: "仮名" });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "Kana: 仮名" }]);
  });

  test("a click into a page block outside the session ends it", async ({ page }) => {
    await withRun(page);
    await page.click("#p2");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the click to end the session" });
    expect((await fw.onlyEdit(page)).state).toBe("ready");
  });

  test("an arrow key into a page block outside the session ends it", async ({ page }) => {
    await withRun(page);
    await fw.caretAt(page, "#p1", 0);
    await page.keyboard.press("ArrowUp");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "ArrowUp out to end the session" });
  });

  test("a split with no typing gives a from_anchor tail and no Added change text", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", "Most weeks look busy from the outside.".length);
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "This one did not.", from_anchor: true }]);
    expect(item.change).not.toContain("Added");
  });

  test("an empty last list item is dropped at capture", async ({ page }) => {
    await withRun(page, "- only item");
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "ul", html: "<li>only item</li>" }]);
    const items = await page.evaluate(() => document.querySelectorAll("#p1 + ul li").length);
    expect(items, "and the empty item is gone from the page too").toBe(1);
  });

  test("Cmd-Shift-E on a run block reopens its record; once handled, a sitting there starts a new one", async ({ page }) => {
    await withRun(page, "Run words to reopen.");
    await fw.commitByEsc(page);
    const first = await fw.onlyEdit(page);

    await fw.openEdit(page, "#p1 + p");
    expect((await state(page)).itemId).toBe(first.id);
    await fw.commitByEsc(page);

    await page.evaluate((id) => {
      const h = window.__lahe.handle;
      const item = Object.assign({}, h.store.readItem(h.review, id), { state: "handled" });
      h.store.write(h.review, item);
    }, first.id);
    await fw.openEdit(page, "#p1 + p");
    const now = await state(page);
    expect(now.itemId).not.toBe(first.id);
    await page.keyboard.press("Enter");
    await page.keyboard.type("A later sitting.", { delay: 2 });
    await fw.commitByEsc(page);
    const later = await page.evaluate((id) => window.__lahe.itemById(id), now.itemId);
    expect(later.before).toBe("Run words to reopen.");
    expect(later.new_blocks).toEqual([{ tag: "p", html: "A later sitting." }]);
  });

  test("Enter at the end of a td does not start a run", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await page.evaluate(() => {
      const t = document.createElement("table");
      t.innerHTML = "<tbody><tr><td id='cell'>Cell words</td></tr></tbody>";
      document.getElementById("post").appendChild(t);
    });
    await fw.openEdit(page, "#cell");
    expect((await state(page)).mode).toBe("legacy");
    await page.keyboard.press("Enter");
    await page.keyboard.type("more", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toBeUndefined();
    const after = await page.evaluate(() => ({
      cells: document.querySelectorAll("td").length,
      tail: document.getElementById("post").lastElementChild.tagName
    }));
    expect(after).toEqual({ cells: 1, tail: "TABLE" });
  });

  test("on a page whose paragraph is a direct child of body, the rail works and takes no edits", async ({ page }) => {
    await fw.openFixture(page, server, "body_paragraph.html", { collapseRail: false });
    const railBefore = await page.evaluate(() => document.getElementById("lahe-surface-root") ? document.getElementById("lahe-surface-root").outerHTML : null);
    await fw.openEdit(page, "body > p");
    await page.keyboard.press("ControlOrMeta+KeyA");
    await page.keyboard.type("Rewritten under body.", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("And a new one.", { delay: 2 });
    const railDuring = await page.evaluate(() => document.getElementById("lahe-surface-root") ? document.getElementById("lahe-surface-root").outerHTML : null);
    expect(railDuring, "the overlay host took no edits").toBe(railBefore);
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "And a new one." }]);
    await pollPage(page, (id) => window.__lahe.cardIds().indexOf(id) !== -1, item.id, { message: "the rail to show the card" });
  });

  test("the live region says each pinned line", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("# Heading words", { delay: 2 });
    await fw.commitByEsc(page);
    const said = await page.evaluate(() => window.__lahe.handle.editing.announcements());
    expect(said).toEqual(["Writing after: Most weeks look busy from the", "Heading", "Sent to the agent"]);

    await fw.openFixture(page, server, "empty_notes.html", { notes: true });
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "the empty page to open" });
    expect(await page.evaluate(() => window.__lahe.handle.editing.liveText())).toBe("Writing at the start of the page");
  });

  test("reopening a pre-feature multi-paragraph record keeps today's behavior", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    const id = await page.evaluate(() => {
      const L = window.LAHE;
      const h = window.__lahe.handle;
      const p1 = document.getElementById("p1");
      p1.innerHTML = "Intro<p>A new line</p>";
      const range = document.createRange();
      range.selectNodeContents(p1);
      const item = L.record.newItem({
        kind: "edit",
        state: "ready",
        before: "Intro",
        before_html: "Intro",
        after: "Intro\n\nA new line",
        after_html: "Intro<p>A new line</p>",
        change: "Added a paragraph after \"Intro\": \"A new line\".",
        region: { ref: L.anchor.mint({ element: p1, range: range, root: document }), label: "Intro", lost: null },
        page_origin: location.origin,
        page_path: location.pathname,
        page_title: document.title,
        page_seq: 1
      });
      h.store.write(h.review, item);
      return item.id;
    });
    await fw.openEdit(page, "#p1");
    const s = await state(page);
    expect(s.mode).toBe("legacy");
    expect(s.itemId).toBe(id);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Third", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await page.evaluate((i) => window.__lahe.itemById(i), id);
    expect(item.new_blocks).toBeUndefined();
    expect(item.after).toBe("Intro\n\nA new line\n\nThird");
    expect(await page.evaluate(() => document.querySelectorAll("#p1 p").length), "breaks still nest, as today").toBe(2);
  });
});
