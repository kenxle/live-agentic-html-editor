// Two tabs, and the Active pane's filter, in a real browser.
//
// The rail had three tabs (Active, Edits, Done). A hand edit that is still work
// is now its own card in Active, beside the comments, and a small filter at the
// top of the pane (All, Comments, Edits) narrows what is shown. This proves the
// three things a reviewer sees:
//
//   the tab strip has exactly Active and Done
//   a hand edit's card is in Active, next to a comment's
//   the filter shows only edits, only comments, or both, and the tab count
//   stays the total whichever is picked
//
// The filter is pressed at its on-screen geometry: the rail is in a closed
// shadow root, so hit-testing is what a hand does and the only honest way in.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/edits-tab-doc.html";
const REVIEW = "review-filter";

async function booted(page, server) {
  await page.goto(server.urlFor(FIXTURE) + "?review=" + REVIEW);
  await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, {
    message: "the real boot to put the library and the fixture's readers on the page"
  });
}

// One hand edit (a delete, which has no keystroke, so the fixture's own
// gesture) and one comment through the real comment surface.
async function oneOfEach(page) {
  const editId = await page.evaluate(() => window.__laheEdits.deleteBlock("gone"));
  const commentId = await page.evaluate(() =>
    window.__laheEdits.commentOn("say", "opposite", "This contradicts the paragraph under it.")
  );
  expect(editId, "the hand edit is made").toBeTruthy();
  expect(commentId, "the comment is made").toBeTruthy();
  await page.evaluate(() => {
    window.__lahe.handle.comments.closeAll();
    window.__lahe.rail.collapse(false);
    window.__lahe.rail.selectTab("active");
  });
  return { editId, commentId };
}

// What the rail shows right now, read off its own nodes.
function railView(page, ids) {
  return page.evaluate(({ editId, commentId }) => {
    const rail = window.__lahe.rail;
    const pane = rail.tabBody("active");
    const root = pane.getRootNode();
    const shown = (node) => !!node && node.getClientRects().length > 0;
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
    const options = Array.from(pane.querySelectorAll("[data-lahe-filter-option]"));
    const filterEmpty = pane.querySelector("[data-lahe-filter-empty]");
    return {
      tabs: tabs.map((t) => t.getAttribute("data-tab")),
      tabLabels: tabs.map((t) => t.firstChild.textContent),
      activeCount: tabs.find((t) => t.getAttribute("data-tab") === "active").querySelector(".count").textContent,
      options: options.map((o) => ({ label: o.textContent, pressed: o.getAttribute("aria-pressed") })),
      filterShown: shown(pane.querySelector("[data-lahe-filter-bar]")),
      editPane: rail.getCard(editId).pane,
      commentPane: rail.getCard(commentId).pane,
      editShown: shown(rail.cardNode(editId)),
      commentShown: shown(rail.cardNode(commentId)),
      editHasRow: !!rail.cardNode(editId).querySelector("[data-lahe-edit-row]"),
      filterEmpty: shown(filterEmpty) ? filterEmpty.textContent : null
    };
  }, ids);
}

async function pressFilter(page, name) {
  const rect = await page.evaluate((want) => {
    const pane = window.__lahe.rail.tabBody("active");
    const button = pane.querySelector('[data-lahe-filter-option="' + want + '"]');
    const r = button.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width };
  }, name);
  expect(rect.width, "the " + name + " option is on screen").toBeGreaterThan(0);
  await page.mouse.click(rect.x, rect.y);
  await pollPage(page, (want) => window.__lahe.rail.currentFilter() === want, name, {
    message: "the press to pick " + name
  });
}

test.describe("the Active pane's filter", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "active-filter" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("two tabs; a hand edit's card is in Active; the filter shows edits, comments, or both", async ({ page }, testInfo) => {
    await booted(page, pages);
    const ids = await oneOfEach(page);

    const all = await railView(page, ids);
    expect(all.tabs, "the tab strip has exactly Active and Done").toEqual(["active", "done"]);
    expect(all.tabLabels).toEqual(["Active", "Done"]);
    expect(all.editPane, "the hand edit is an Active card").toBe("active");
    expect(all.commentPane).toBe("active");
    expect(all.editHasRow, "with the before-and-after row drawn in it").toBe(true);
    expect(all.filterShown, "the filter sits at the top of a pane with cards").toBe(true);
    expect(all.options).toEqual([
      { label: "All", pressed: "true" },
      { label: "Comments", pressed: "false" },
      { label: "Edits", pressed: "false" }
    ]);
    expect([all.editShown, all.commentShown], "All shows both").toEqual([true, true]);
    expect(all.activeCount).toBe("2");

    // The pictures are of the rail, so the helper-down chip that would cover
    // the foot of it is waved away first, the way a reviewer would.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      const failures = window.__lahe.handle.rail.failures;
      failures.list().forEach((chip) => failures.dismiss(chip.code));
    });
    const allShot = testInfo.outputPath("active-filter-all-light.png");
    await page.screenshot({ path: allShot });
    await testInfo.attach("active-filter-all-light", { path: allShot, contentType: "image/png" });

    await pressFilter(page, "edits");
    const edits = await railView(page, ids);
    expect([edits.editShown, edits.commentShown], "Edits shows only the hand edit").toEqual([true, false]);
    expect(edits.activeCount, "the tab count stays the total").toBe("2");
    expect(edits.options.map((o) => o.pressed)).toEqual(["false", "false", "true"]);
    expect(edits.filterEmpty, "a pick that shows something says nothing").toBe(null);

    for (const scheme of ["light", "dark"]) {
      await page.evaluate((want) => {
        const bg = want === "dark" ? "#12151a" : "";
        document.documentElement.style.background = bg;
        document.body.style.background = bg;
        document.body.style.color = want === "dark" ? "#e9ebf0" : "";
        window.__lahe.rail.refreshScheme();
      }, scheme);
      const file = testInfo.outputPath("active-filter-edits-" + scheme + ".png");
      await page.screenshot({ path: file });
      await testInfo.attach("active-filter-edits-" + scheme, { path: file, contentType: "image/png" });
    }

    await pressFilter(page, "comments");
    const comments = await railView(page, ids);
    expect([comments.editShown, comments.commentShown], "Comments shows only the comment").toEqual([false, true]);
    expect(comments.activeCount, "the tab count stays the total").toBe("2");

    await pressFilter(page, "all");
    const back = await railView(page, ids);
    expect([back.editShown, back.commentShown], "All shows both again").toEqual([true, true]);
  });

  test("a pick that hides every card says so, and the pick survives a reload", async ({ page }) => {
    await booted(page, pages);
    const editId = await page.evaluate(() => window.__laheEdits.deleteBlock("gone"));
    await page.evaluate(() => {
      window.__lahe.rail.collapse(false);
      window.__lahe.rail.selectTab("active");
    });

    await pressFilter(page, "comments");
    const hidden = await page.evaluate((id) => {
      const pane = window.__lahe.rail.tabBody("active");
      const said = pane.querySelector("[data-lahe-filter-empty]");
      return {
        cardShown: window.__lahe.rail.cardNode(id).getClientRects().length > 0,
        said: said.getClientRects().length > 0 ? said.textContent : null
      };
    }, editId);
    expect(hidden.cardShown, "the only card is a hand edit, and it is hidden").toBe(false);
    expect(hidden.said, "the pane says why it is blank").toBe("No comments here. Pick All to see your hand edits too.");

    await pressFilter(page, "edits");
    await page.reload();
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, { message: "the reload to boot" });
    const after = await page.evaluate(() => {
      const pane = window.__lahe.rail.tabBody("active");
      return {
        filter: window.__lahe.rail.currentFilter(),
        pressed: pane.querySelector('[data-lahe-filter-option="edits"]').getAttribute("aria-pressed"),
        paneAttr: pane.getAttribute("data-lahe-filter")
      };
    });
    expect(after, "a reload finds the list the reviewer was reading").toEqual({
      filter: "edits",
      pressed: "true",
      paneAttr: "edits"
    });
  });

  // THE SEARCH BOX. Typed with the real keyboard into the box at its on-screen
  // place, on Active and on Done, and combined with the kind filter.
  test("the search box narrows the open tab to cards containing the words, and combines with the filter", async ({
    page
  }, testInfo) => {
    await booted(page, pages);
    const ids = await oneOfEach(page);
    // A second comment, answered, so Done has a card to search.
    const answeredId = await page.evaluate(() => window.__laheEdits.commentOn("one", "trainer", "Name the trainer here."));
    await page.evaluate((id) => {
      const P = window.LAHE.protocol;
      window.__lahe.handle.doneTab().applyReplies([
        P.newEvent({
          event: P.EVENT.REPLY_FOLDED,
          event_id: window.LAHE.record.randomId("evt"),
          review: window.__lahe.handle.review,
          item: id,
          rev: window.__lahe.itemById(id).rev,
          payload: {
            accepted: true,
            state: "handled",
            file: "replies-claude.jsonl",
            reply: { status: "handled", agent: "claude", reason: null, text: "Named her.", files: [] }
          }
        })
      ]);
      window.__lahe.handle.comments.closeAll();
      const failures = window.__lahe.handle.rail.failures;
      failures.list().forEach((chip) => failures.dismiss(chip.code));
      window.__lahe.rail.selectTab("active");
    }, answeredId);
    await pollPage(page, (id) => window.__lahe.rail.getCard(id).pane === "done", answeredId, {
      message: "the answered comment to move to Done"
    });

    const typeInto = async (tab, text) => {
      const rect = await page.evaluate((t) => {
        const box = window.__lahe.rail.tabBody(t).querySelector('[data-lahe-search="' + t + '"]');
        const r = box.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width };
      }, tab);
      expect(rect.width, "the " + tab + " search box is on screen").toBeGreaterThan(0);
      await page.mouse.click(rect.x, rect.y);
      await page.keyboard.press("ControlOrMeta+KeyA");
      await page.keyboard.press("Backspace");
      if (text) await page.keyboard.type(text, { delay: 5 });
      await pollPage(page, ([t, want]) => window.__lahe.rail.searchFor(t) === want, [tab, text], {
        message: "the " + tab + " search to read '" + text + "'"
      });
    };
    const seen = (tab) =>
      page.evaluate(
        ({ t, all }) => {
          const rail = window.__lahe.rail;
          const shown = (node) => !!node && node.getClientRects().length > 0;
          const said = rail.tabBody(t).querySelector('[data-lahe-search-empty="' + t + '"]');
          const out = { said: shown(said) ? said.textContent : null, count: null };
          Object.keys(all).forEach((name) => {
            out[name] = shown(rail.cardNode(all[name]));
          });
          const tabNode = rail.tabBody(t).getRootNode().querySelector('[role="tab"][data-tab="' + t + '"] .count');
          out.count = tabNode.textContent;
          return out;
        },
        { t: tab, all: { edit: ids.editId, comment: ids.commentId, answered: answeredId } }
      );

    await typeInto("active", "CONTRADICTS");
    expect(await seen("active"), "only the comment holds the word, whatever its case").toMatchObject({
      comment: true,
      edit: false,
      said: null,
      count: "2"
    });

    await typeInto("active", "paragraph");
    expect(await seen("active"), "both cards hold 'paragraph'").toMatchObject({ comment: true, edit: true });
    await pressFilter(page, "edits");
    expect(await seen("active"), "the search and the Edits filter together").toMatchObject({ comment: false, edit: true });
    const shot = testInfo.outputPath("active-search-and-filter-light.png");
    await page.screenshot({ path: shot });
    await testInfo.attach("active-search-and-filter-light", { path: shot, contentType: "image/png" });
    await pressFilter(page, "comments");
    expect(await seen("active"), "and with the Comments filter").toMatchObject({ comment: true, edit: false });

    await pressFilter(page, "all");
    await typeInto("active", "nothing says this");
    expect(await seen("active"), "a search that matches nothing says so").toMatchObject({
      comment: false,
      edit: false,
      said: "Nothing here matches “nothing says this”."
    });

    await typeInto("active", "");
    expect(await seen("active"), "an empty box shows everything").toMatchObject({ comment: true, edit: true, said: null });

    await page.evaluate(() => window.__lahe.rail.selectTab("done"));
    await typeInto("done", "trainer");
    expect(await seen("done"), "Done has its own box").toMatchObject({ answered: true, said: null, count: "1" });
    await typeInto("done", "lede");
    expect(await seen("done"), "and it narrows Done").toMatchObject({
      answered: false,
      said: "Nothing here matches “lede”."
    });
    expect(await page.evaluate(() => window.__lahe.rail.searchFor("active")), "Active's box is untouched").toBe("");
  });
});
