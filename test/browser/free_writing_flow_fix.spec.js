// Free writing, the editing-side fixes from the flow walk
// (docs/features/20260928.01_free_writing/reviews_impl/flow_walk.md).
//
// Each describe block is one finding. The helper is down (the shared
// free-writing page set-up), so every decision checked here is the browser's.

"use strict";

const { test, expect, startStaticServer } = require("../helpers");
const fw = require("./support/free_writing_page");

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-flow-fix" });
});

test.afterAll(async () => {
  await server.close();
});

const HEAD = "Most weeks look busy from the outside.";
const TAIL = "This one did not.";

// The flow walk's record 62: Enter in the middle of a paragraph, then new text,
// marked every new block from_anchor. The contract tells the agent not to add
// from_anchor words again, so a literal agent dropped the reviewer's sentence.
test.describe("from_anchor marks only the page's own words", () => {
  test("new lines typed into a split tail are new blocks; only the page's words are moved", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Brand new words here.", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("A second new line.", { delay: 2 });
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([
      { tag: "p", html: "Brand new words here." },
      { tag: "p", html: "A second new line." },
      { tag: "p", html: TAIL, from_anchor: true }
    ]);
    expect(item.anchor_after_html).toBe(HEAD);
    expect(item.change).toContain("Added 2 blocks");
  });

  test("words typed at the start of a split tail split off as a new block before the moved words", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Fresh words first. ", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([
      { tag: "p", html: "Fresh words first." },
      { tag: "p", html: TAIL, from_anchor: true }
    ]);
  });

  test("words typed at the end of a split tail split off as a new block after the moved words", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await fw.caretToEndOfSession(page);
    await page.keyboard.type(" And then <b>some</b> more.", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([
      { tag: "p", html: TAIL, from_anchor: true },
      { tag: "p", html: "And then &lt;b&gt;some&lt;/b&gt; more." }
    ]);
  });

  test("words typed into the middle of the moved words make the whole tail new, never moved", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await fw.caretAt(page, "#p1 + p", "This one".length);
    await page.keyboard.type(" really", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "This one really did not." }]);
    expect(item.anchor_after_html, "the anchor gives up the moved words, so nothing is added twice").toBe(HEAD);
  });

  test("a tail made of words the reviewer typed into the anchor before splitting is new", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" Typed here first.", { delay: 2 });
    await fw.caretAt(page, "#p1", (HEAD + " " + TAIL + " ").length);
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "Typed here first." }]);
  });

  test("a split with no typing keeps one from_anchor tail", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: TAIL, from_anchor: true }]);
  });
});

// Flow walk fail 2, capture side: adding an item to a list the agent had
// already placed reopened the placed run record. Architecture "Two sittings in
// the same place": once the agent placed a run, its blocks are the page's own,
// so a sitting there is an ordinary edit of that block. Only an unplaced run
// reopens its record.
test.describe("a sitting on a placed block is an ordinary edit", () => {
  const LIST = "- first item";

  async function commitRunWithList(page) {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type(LIST, { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("second item", { delay: 2 });
    await fw.commitByEsc(page);
    return fw.onlyEdit(page);
  }

  async function setState(page, id, patch) {
    await page.evaluate(
      ([itemId, fields]) => {
        const h = window.__lahe.handle;
        h.store.write(h.review, Object.assign({}, h.store.readItem(h.review, itemId), fields));
      },
      [id, patch]
    );
  }

  async function addThirdItem(page) {
    await fw.openEdit(page, "#p1 + ul li:last-child");
    await page.keyboard.press("Enter");
    await page.keyboard.type("third item", { delay: 2 });
    await fw.commitByEsc(page);
  }

  test("a handled run: the list edit is a new record whose before is the placed list", async ({ page }) => {
    const run = await commitRunWithList(page);
    await setState(page, run.id, { state: "handled" });
    await addThirdItem(page);
    const all = await fw.items(page);
    const same = all.find((it) => it.id === run.id);
    expect(same.rev, "the placed record is not reopened").toBe(run.rev);
    expect(same.state).toBe("handled");
    const fresh = all.filter((it) => it.id !== run.id);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].before.replace(/\s+/g, " ").trim()).toBe("first item second item");
    expect(fresh[0].state).toBe("ready");
  });

  test("a run the agent placed and then asked a proofreading question on: same, a new record", async ({ page }) => {
    const run = await commitRunWithList(page);
    await setState(page, run.id, {
      reply: {
        status: "question",
        agent: "claude",
        text: "Two fixes?",
        at: new Date().toISOString(),
        proofread: true,
        suggestions: [{ block: 0, from: "first", to: "First" }]
      }
    });
    await addThirdItem(page);
    const all = await fw.items(page);
    const same = all.find((it) => it.id === run.id);
    expect(same.rev, "the placed record is not reopened").toBe(run.rev);
    expect(same.state).toBe("ready");
    const fresh = all.filter((it) => it.id !== run.id);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].before.replace(/\s+/g, " ").trim()).toBe("first item second item");
  });

  test("an unplaced run still reopens its own record", async ({ page }) => {
    const run = await commitRunWithList(page);
    await addThirdItem(page);
    const edits = (await fw.items(page)).filter((it) => it.kind === "edit");
    expect(edits).toHaveLength(1);
    expect(edits[0].id).toBe(run.id);
    expect(edits[0].rev).toBe(run.rev + 1);
  });
});
