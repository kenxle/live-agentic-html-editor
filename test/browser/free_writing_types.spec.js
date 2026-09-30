// Free writing, plan Task 2.2: block types, the bar's menu, hotkeys, lists,
// and the ceiling.
//
// Every block type has three ways in (the menu, a hotkey, and for all but
// Paragraph a Markdown shortcut), and all three land in one function per
// type. New blocks take the page's own styling: they are real siblings, so
// the page's selectors match them as they match its own blocks.

"use strict";

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");

const MAC = process.platform === "darwin";
const CHORD = {
  p: MAC ? "Meta+Alt+Digit0" : "Control+Shift+Digit0",
  h2: MAC ? "Meta+Alt+Digit2" : "Control+Shift+Digit2",
  h3: MAC ? "Meta+Alt+Digit3" : "Control+Shift+Digit3",
  h4: MAC ? "Meta+Alt+Digit4" : "Control+Shift+Digit4",
  ul: MAC ? "Meta+Shift+Digit8" : "Control+Shift+Digit8",
  ol: MAC ? "Meta+Shift+Digit7" : "Control+Shift+Digit7"
};
const SHORTCUT = { h2: "## ", h3: "### ", h4: "#### ", ul: "- ", ol: "1. " };
const LABEL = {
  p: "Paragraph",
  h2: "Heading",
  h3: "Subheading",
  h4: "Small heading",
  ul: "Bulleted list",
  ol: "Numbered list"
};

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-types" });
});

test.afterAll(async () => {
  await server.close();
});

function bar(page) {
  return page.evaluate(() => window.__lahe.handle.editing.barInfo());
}

function sessionTags(page) {
  return page.evaluate(() => window.__lahe.handle.editing.sessionElements().map((el) => el.tagName.toLowerCase()));
}

async function pickFromMenu(page, tag) {
  // The bar follows its frame on every animation frame; aim at it once it has
  // settled where the frame is now, not where it was a frame ago.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = await bar(page);
  await page.mouse.click(b.typeRect.cx, b.typeRect.cy);
  const open = await bar(page);
  expect(open.menuOpen, "the menu opens on a click").toBe(true);
  const row = open.rows.find((r) => r.tag === tag);
  await page.mouse.click(row.rect.x + row.rect.width / 2, row.rect.y + row.rect.height / 2);
}

async function byRoute(page, route, tag) {
  if (route === "menu") await pickFromMenu(page, tag);
  else if (route === "hotkey") await page.keyboard.press(CHORD[tag]);
  else await page.keyboard.type(SHORTCUT[tag], { delay: 2 });
}

const ROUTES = {
  p: ["menu", "hotkey"],
  h2: ["menu", "hotkey", "markdown"],
  h3: ["menu", "hotkey", "markdown"],
  h4: ["menu", "hotkey", "markdown"],
  ul: ["menu", "hotkey", "markdown"],
  ol: ["menu", "hotkey", "markdown"]
};

test.describe("free writing: block types", () => {
  for (const tag of Object.keys(ROUTES)) {
    for (const route of ROUTES[tag]) {
      test("new text: " + LABEL[tag] + " by " + route, async ({ page }) => {
        await fw.openFixture(page, server, "blog.html");
        await fw.openEdit(page, "#p1");
        await page.keyboard.press("Enter");
        if (tag === "p") {
          // A new block is a paragraph already; make it a heading first, then
          // take it back to Paragraph by this route.
          await page.keyboard.press(CHORD.h2);
          expect((await sessionTags(page))[1]).toBe("h2");
        }
        await byRoute(page, route, tag);
        await page.keyboard.type("Words " + tag, { delay: 2 });
        expect((await sessionTags(page))[1]).toBe(tag);
        expect((await bar(page)).typeLabel).toBe(LABEL[tag]);
        await fw.commitByEsc(page);
        const item = await fw.onlyEdit(page);
        const html = tag === "ul" || tag === "ol" ? "<li>Words " + tag + "</li>" : "Words " + tag;
        expect(item.new_blocks).toEqual([{ tag: tag, html: html }]);
      });

      test("an existing block: " + LABEL[tag] + " by " + route, async ({ page }) => {
        await fw.openFixture(page, server, "blog.html");
        if (tag === "p") {
          await page.evaluate(() => {
            const h = document.createElement("h3");
            h.id = "p1";
            h.textContent = "Most weeks look busy from the outside. This one did not.";
            document.getElementById("p1").replaceWith(h);
          });
        }
        await fw.openEdit(page, "#p1", route === "markdown" ? 0 : undefined);
        await byRoute(page, route, tag);
        expect((await sessionTags(page))[0]).toBe(tag);
        await fw.commitByEsc(page);
        const item = await fw.onlyEdit(page);
        expect(item.anchor_tag_after).toBe(tag);
        expect(item.new_blocks).toEqual([]);
      });
    }
  }

  test("the menu names the caret's block, and in a blockquote reads Other block, disabled, with the hotkeys off", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#h2");
    expect((await bar(page)).typeLabel).toBe("Heading");
    await fw.commitByEsc(page);

    await page.evaluate(() => {
      const q = document.createElement("blockquote");
      q.id = "bq";
      q.textContent = "Quoted words stay a quote.";
      document.getElementById("post").appendChild(q);
    });
    await fw.openEdit(page, "#bq");
    const b = await bar(page);
    expect(b.typeLabel).toBe("Other block");
    expect(b.typeDisabled).toBe(true);
    for (const tag of Object.keys(CHORD)) await page.keyboard.press(CHORD[tag]);
    expect(await sessionTags(page)).toEqual(["blockquote"]);
    await page.keyboard.type("# ", { delay: 2 });
    expect(await sessionTags(page)).toEqual(["blockquote"]);
  });

  test("from the keyboard: rows show chord and shortcut, arrows move, Esc closes only the menu with focus back at the caret", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", 4);
    await page.keyboard.press("Tab");
    expect((await bar(page)).focused).toBe("type");
    await page.keyboard.press("ArrowDown");
    let b = await bar(page);
    expect(b.menuOpen).toBe(true);
    expect(b.focused).toBe("row:p");
    expect(b.rows.map((r) => [r.label, r.chord, r.markdown])).toEqual([
      ["Paragraph", MAC ? "Cmd-Option-0" : "Ctrl-Shift-0", ""],
      ["Heading", MAC ? "Cmd-Option-2" : "Ctrl-Shift-2", "##"],
      ["Subheading", MAC ? "Cmd-Option-3" : "Ctrl-Shift-3", "###"],
      ["Small heading", MAC ? "Cmd-Option-4" : "Ctrl-Shift-4", "####"],
      ["Bulleted list", MAC ? "Cmd-Shift-8" : "Ctrl-Shift-8", "-"],
      ["Numbered list", MAC ? "Cmd-Shift-7" : "Ctrl-Shift-7", "1."]
    ]);
    await page.keyboard.press("ArrowDown");
    expect((await bar(page)).focused).toBe("row:h2");
    await page.keyboard.press("ArrowUp");
    expect((await bar(page)).focused).toBe("row:p");
    await page.keyboard.press("Escape");
    b = await bar(page);
    expect(b.menuOpen).toBe(false);
    expect(await page.evaluate(() => window.__lahe.isEditing()), "Esc closed only the menu").toBe(true);
    await page.keyboard.type("X", { delay: 2 });
    expect(await page.evaluate(() => document.getElementById("p1").textContent.slice(0, 6))).toBe("MostX ");

    // Enter on a row applies it, and focus goes back to the caret.
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(await sessionTags(page)).toEqual(["h2"]);
    await page.keyboard.type("Y", { delay: 2 });
    expect(await page.evaluate(() => document.getElementById("p1").textContent.slice(0, 7))).toBe("MostXY ");
  });

  test("the menu opens upward when there is no room below", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 420 });
    await fw.openFixture(page, server, "blog.html");
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "2000px";
      document.getElementById("post").prepend(spacer);
    });
    await page.evaluate(() => document.getElementById("list").scrollIntoView({ block: "end" }));
    await fw.openEdit(page, "#list li:last-child");
    const b = await bar(page);
    await page.mouse.click(b.typeRect.cx, b.typeRect.cy);
    const open = await bar(page);
    expect(open.menuUp).toBe(true);
    expect(open.menuRect.y + open.menuRect.height).toBeLessThanOrEqual(open.typeRect.y);
  });

  test("# typed mid-paragraph stays text", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" # not a heading", { delay: 2 });
    expect(await sessionTags(page)).toEqual(["p"]);
    await fw.commitByEsc(page);
    expect((await fw.onlyEdit(page)).after).toBe("Most weeks look busy from the outside. This one did not. # not a heading");
  });

  test("a paragraph turned into a header commits as format_only with anchor_tag_after h2", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press(CHORD.h2);
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.kind).toBe("format_only");
    expect(item.anchor_tag_after).toBe("h2");
  });

  test("Enter at the end of an existing bullet adds an li to anchor_after_html", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#list li:last-child");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A third bullet", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([]);
    expect(item.anchor_after_html.replace(/\s+</g, "<").replace(/>\s+/g, ">")).toBe(
      "<li>Fewer meetings</li><li>Longer blocks</li><li>A third bullet</li>"
    );
  });

  test("on an existing list: Numbered swaps the whole list, Paragraph on the last item ends it, Heading is off on a middle item", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await page.evaluate(() => {
      document.getElementById("list").innerHTML = "<li>one</li><li>two</li><li>three</li>";
    });
    await fw.openEdit(page, "#list li:nth-child(2)");
    let b = await bar(page);
    expect(b.rows.find((r) => r.tag === "h2").disabled).toBe(true);
    expect(b.rows.find((r) => r.tag === "p").disabled).toBe(true);
    await page.keyboard.press(CHORD.h2);
    expect(await sessionTags(page)).toEqual(["ul"]);
    await page.keyboard.press(CHORD.ol);
    expect(await sessionTags(page)).toEqual(["ol"]);
    expect(await page.evaluate(() => document.querySelectorAll("#list li").length)).toBe(3);

    await fw.caretAt(page, "#list li:last-child", 5);
    // The bar follows the caret on the next frame after selectionchange.
    await pollPage(
      page,
      () => !window.__lahe.handle.editing.barInfo().rows.find((r) => r.tag === "p").disabled,
      undefined,
      { message: "Paragraph to be on for the last item" }
    );
    await page.keyboard.press(CHORD.p);
    expect(await sessionTags(page)).toEqual(["ol", "p"]);
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.anchor_tag_after).toBe("ol");
    expect(item.anchor_after_html).toBe("<li>one</li><li>two</li>");
    expect(item.new_blocks).toEqual([{ tag: "p", html: "three", from_anchor: true }]);
  });

  test("at 90 percent the bar warns; at the ceiling one more block is refused and the record is never over it", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    const paste = (n) => fw.pasteText(page, Array.from({ length: n }, (_, i) => "Block " + i).join("\n\n"));
    await page.keyboard.press("Enter");
    await paste(360);
    let b = await bar(page);
    expect(b.notice).toBe(true);
    expect(b.hint).toBe("This edit is getting long. Press Esc to send it. Once the agent places it, you can keep writing.");
    await paste(41);
    expect((await sessionTags(page)).length - 1).toBe(400);
    await fw.caretToEndOfSession(page);
    await page.keyboard.press("Enter");
    expect((await sessionTags(page)).length - 1, "the 401st block is refused").toBe(400);
    b = await bar(page);
    expect(b.hint).toBe("This edit is full. Press Esc to send it. Once the agent places it, you can keep writing.");
    await fw.commitByEsc(page);
    const verdict = await page.evaluate(() => {
      const item = window.__lahe.items().find((it) => it.kind === "edit");
      return { blocks: item.new_blocks.length, refusal: window.LAHE.record.validateRun(item) };
    });
    expect(verdict).toEqual({ blocks: 400, refusal: null });
  });

  // The count ceiling is tested above. The byte ceiling is the other half of
  // validateRun's check (NEW_BLOCKS_MAX_BYTES), and the layer's own estimate
  // must stop the input before the helper would refuse the record. Three-byte
  // characters make the bytes reach the ceiling long before the count does.
  test("multibyte text past the byte ceiling: the bar refuses before validateRun would, and the record is never over it", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    const wanted = 100;
    const block = "\u65e5".repeat(700); // 2100 bytes in UTF-8
    await fw.pasteText(page, Array.from({ length: wanted }, () => block).join("\n\n"));
    const made = (await sessionTags(page)).length - 1;
    expect(made, "some blocks were refused").toBeLessThan(wanted);
    expect(made, "and some were taken").toBeGreaterThan(10);
    const b = await bar(page);
    expect(b.hint).toBe("This edit is full. Press Esc to send it. Once the agent places it, you can keep writing.");
    await fw.commitByEsc(page);
    const verdict = await page.evaluate(() => {
      const item = window.__lahe.items().find((it) => it.kind === "edit");
      return {
        blocks: item.new_blocks.length,
        bytes: item.new_blocks.reduce((n, x) => n + new TextEncoder().encode(x.html).length, 0),
        max: window.LAHE.record.NEW_BLOCKS_MAX_BYTES,
        refusal: window.LAHE.record.validateRun(item)
      };
    });
    expect(verdict.refusal, "validateRun accepts what the bar let through").toBeNull();
    expect(verdict.bytes).toBeLessThanOrEqual(verdict.max);
  });

  for (const file of ["blog.html", "md_render.html"]) {
    test("new blocks match the page's own computed spacing and type on " + file, async ({ page }) => {
      await fw.openFixture(page, server, file);
      // Each new block is made where the page has its own twin in the same
      // context, so the page's sibling selectors are asked the same question.
      const md = file === "md_render.html";
      const cases = md
        ? [
            { anchor: "section:first-of-type .sheet-head h2", tag: "p", own: "section:first-of-type > p:first-of-type" },
            { anchor: "section:first-of-type > p:last-of-type", tag: "h2", own: "section:first-of-type h2" },
            { anchor: "section:first-of-type > p:first-of-type", tag: "p", own: "section:first-of-type > p:last-of-type" },
            { anchor: "section:last-of-type .sheet-head h2", tag: "ul", own: "section:last-of-type ul" }
          ]
        : [
            { anchor: "#h2", tag: "p", own: "#p2" },
            { anchor: "#p1", tag: "h2", own: "#h2" },
            { anchor: "#p2", tag: "ul", own: "#list" }
          ];
      const pickOwn = (sel) =>
        page.evaluate((ownSel) => {
          const cs = getComputedStyle(document.querySelector(ownSel));
          return { mt: cs.marginTop, mb: cs.marginBottom, fs: cs.fontSize, lh: cs.lineHeight, fw: cs.fontWeight };
        }, sel);
      for (const c of cases) {
        // The twin is measured before the new block goes in, since the new
        // block becomes its previous sibling and changes what its own
        // sibling selectors say.
        const own = await pickOwn(c.own);
        await fw.openEdit(page, c.anchor);
        await page.keyboard.press("Enter");
        if (c.tag !== "p") await page.keyboard.press(CHORD[c.tag]);
        await page.keyboard.type(c.tag === "ul" ? "Fewer meetings" : "Measured words here", { delay: 1 });
        const got = await page.evaluate(([ownSel, tag]) => {
          const pick = (el) => {
            const cs = getComputedStyle(el);
            return { mt: cs.marginTop, mb: cs.marginBottom, fs: cs.fontSize, lh: cs.lineHeight, fw: cs.fontWeight };
          };
          const els = window.__lahe.handle.editing.sessionElements();
          const made = els[1];
          return { tag: made.tagName.toLowerCase(), made: pick(made) };
        }, [c.own, c.tag]);
        got.own = own;
        expect(got.tag).toBe(c.tag);
        if (md && c.tag === "h2") {
          // A new h2 has the page's h2 type but no section rule or number
          // until the rebuild; its margins belong to the sheet-head it lacks.
          expect({ fs: got.made.fs, lh: got.made.lh, fw: got.made.fw }).toEqual({ fs: got.own.fs, lh: got.own.lh, fw: got.own.fw });
        } else {
          expect(got.made, c.tag + " after " + c.anchor).toEqual(got.own);
        }
        // After commit the host's contenteditable and the frame come off; the
        // block must still look like the page's own.
        await page.evaluate(() => {
          document.querySelectorAll("[data-fw-probe]").forEach((n) => n.removeAttribute("data-fw-probe"));
          window.__lahe.handle.editing.sessionElements()[1].setAttribute("data-fw-probe", "1");
        });
        await page.keyboard.press("Escape");
        await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "commit" });
        const kept = await page.evaluate((mark) => {
          const el = document.querySelector("[" + mark + "]");
          if (!el) return null;
          const cs = getComputedStyle(el);
          return { mt: cs.marginTop, mb: cs.marginBottom, fs: cs.fontSize, lh: cs.lineHeight, fw: cs.fontWeight };
        }, "data-fw-probe");
        expect(kept, c.tag + " after commit is still on the page").toBeTruthy();
        if (md && c.tag === "h2") {
          expect({ fs: kept.fs, lh: kept.lh, fw: kept.fw }).toEqual({ fs: got.own.fs, lh: got.own.lh, fw: got.own.fw });
        } else {
          expect(kept, c.tag + " after commit matches the page's own").toEqual(got.own);
        }
      }
    });
  }

  // Brief R4 names new, split and retyped blocks, "while writing and after
  // commit", and the gap to the next block is part of what a reader sees (the
  // spike's 53px to 31px regression was a gap). The twin is a real block the
  // test puts where the new one will be, so the page's own selectors answer:
  // "after" is a paragraph that follows the anchor (the split tail), "replace"
  // is the anchor made a heading (a retype). It is measured, then removed.
  const FILES = [
    { file: "blog.html", anchor: "#p2", offset: 12 },
    { file: "md_render.html", anchor: "section:first-of-type > p:first-of-type", offset: 10 }
  ];
  const RETYPES = [
    { tag: "h2", shortcut: "## " },
    { tag: "h3", shortcut: "### " },
    { tag: "h4", shortcut: "#### " }
  ];

  /** Computed type and spacing of an element, and the gap from its bottom to the next block's top. */
  function measure(page, marker) {
    return page.evaluate((mark) => {
      const el = document.querySelector("[" + mark + "]");
      if (!el) return null;
      const cs = getComputedStyle(el);
      const next = el.nextElementSibling;
      const gap = next ? Math.round((next.getBoundingClientRect().top - el.getBoundingClientRect().bottom) * 100) / 100 : null;
      return { tag: el.tagName.toLowerCase(), mt: cs.marginTop, mb: cs.marginBottom, fs: cs.fontSize, lh: cs.lineHeight, fw: cs.fontWeight, gap: gap };
    }, marker);
  }

  /** Put the page's own twin in, measure it, take it out again. */
  async function measureTwin(page, anchorSel, mode, tag) {
    await page.evaluate(
      ([sel, how, t]) => {
        const a = document.querySelector(sel);
        if (how === "after") {
          const twin = a.cloneNode(true);
          twin.removeAttribute("id");
          twin.setAttribute("data-fw-twin", "1");
          a.after(twin);
        } else {
          const twin = document.createElement(t);
          twin.textContent = a.textContent;
          twin.setAttribute("data-fw-twin", "1");
          a.after(twin);
          a.setAttribute("data-fw-hidden", "1");
          a.style.display = "none";
        }
      },
      [anchorSel, mode, tag]
    );
    const got = await measure(page, "data-fw-twin");
    await page.evaluate(() => {
      document.querySelector("[data-fw-twin]").remove();
      const h = document.querySelector("[data-fw-hidden]");
      if (h) {
        h.style.display = "";
        h.removeAttribute("data-fw-hidden");
      }
    });
    return got;
  }

  function sameStyle(got, twin, note) {
    // A heading's margins come from rules that name the sheet-head it lacks
    // until the rebuild (see the loop above), so type is compared for those.
    const keys = ["tag", "fs", "lh", "fw"].concat(note.marginsToo ? ["mt", "mb", "gap"] : []);
    const pick = (o) => keys.reduce((acc, k) => Object.assign(acc, { [k]: o[k] }), {});
    expect(pick(got), note.label).toEqual(pick(twin));
  }

  for (const f of FILES) {
    test("a split tail matches the page's own next block, while writing and after commit, on " + f.file, async ({ page }) => {
      await fw.openFixture(page, server, f.file);
      const twin = await measureTwin(page, f.anchor, "after");
      await fw.openEdit(page, f.anchor, f.offset);
      await page.keyboard.press("Enter");
      await page.evaluate(() => window.__lahe.handle.editing.sessionElements()[1].setAttribute("data-fw-probe", "1"));
      const during = await measure(page, "data-fw-probe");
      sameStyle(during, twin, { label: "the split tail while writing", marginsToo: true });
      await page.keyboard.press("Escape");
      await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "commit" });
      const after = await measure(page, "data-fw-probe");
      expect(after, "the tail is still on the page after commit").toBeTruthy();
      sameStyle(after, twin, { label: "the split tail after commit", marginsToo: true });
    });

    for (const r of RETYPES) {
      test("a paragraph retyped to " + r.tag + " matches the page's own " + r.tag + ", while writing and after commit, on " + f.file, async ({
        page
      }) => {
        await fw.openFixture(page, server, f.file);
        const twin = await measureTwin(page, f.anchor, "replace", r.tag);
        await fw.openEdit(page, f.anchor, 0);
        await page.keyboard.type(r.shortcut, { delay: 2 });
        expect(await sessionTags(page), "the shortcut retyped the block").toContain(r.tag);
        await page.evaluate((t) => {
          const els = window.__lahe.handle.editing.sessionElements();
          els.find((e) => e.tagName.toLowerCase() === t).setAttribute("data-fw-probe", "1");
        }, r.tag);
        const during = await measure(page, "data-fw-probe");
        // The gap is the twin's own: the next block is the same element.
        sameStyle(during, twin, { label: r.tag + " retype while writing", marginsToo: true });
        await page.keyboard.press("Escape");
        await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "commit" });
        const after = await measure(page, "data-fw-probe");
        expect(after, "the retyped block is still on the page after commit").toBeTruthy();
        sameStyle(after, twin, { label: r.tag + " retype after commit", marginsToo: true });
      });
    }
  }
});
