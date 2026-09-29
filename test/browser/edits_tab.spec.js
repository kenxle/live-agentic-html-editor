// 3D's done bar: after a session with six hand edits including one
// formatting-only change, the Edits tab lists six before-and-after rows, none of
// them appear in the Active thread, and the list exports through 3C's pinned
// exportRecords seam.
//
// It is a REAL session on a real page: six hand edits through the real editing
// surface (four typed edits, one delete, one bold), plus a real comment through
// the real comment surface, because "kept apart from the comment thread" cannot
// be measured against a thread with nothing in it.
//
// The export half runs against a one-file stub of 3C's pinned API
// (test/browser/support/export_stub.js), which calls the real frozen formatter.
// The stub is REPLACED AT THE PHASE 3 STITCH, and the second test here is the
// one that proves the button is honest when the module is genuinely absent.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/edits-tab-doc.html";
const REVIEW = "review-3d";

// The four typed edits. Each one appends a sentence, so before and after differ
// in text and the record is kind `edit`.
const TYPED = [
  { block: "one", add: " Nobody has ever asked her to." },
  { block: "two", add: " Two of them read it on Monday." },
  { block: "three", add: " They read it at the gym instead." },
  { block: "four", add: " One page would do." }
];

function fixtureUrl(server) {
  return server.urlFor(FIXTURE) + "?review=" + REVIEW;
}

async function typeEdit(page, blockId, text) {
  await placeCaret(page, { selector: "#" + blockId, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(
    page,
    (id) => {
      const state = window.__lahe.editState();
      return state.open && state.blockId === id;
    },
    blockId,
    { message: "Cmd-Shift-E to put #" + blockId + " into edit state" }
  );

  const length = await page.evaluate((id) => document.getElementById(id).textContent.length, blockId);
  await placeCaret(page, { selector: "#" + blockId, offset: length });
  await page.keyboard.type(text, { delay: 10 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdits.isEditing() === false, undefined, {
    message: "Esc to commit the edit on #" + blockId
  });
}

// The formatting-only change: same words, one of them emphasized. It is made
// through the real edit session and the real format command, because a record
// hand-built as kind format_only would prove nothing about the row.
async function boldAWord(page, blockId, word) {
  await placeCaret(page, { selector: "#" + blockId, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(
    page,
    (id) => {
      const state = window.__lahe.editState();
      return state.open && state.blockId === id;
    },
    blockId,
    { message: "Cmd-Shift-E to put #" + blockId + " into edit state" }
  );
  const selected = await page.evaluate(
    ([id, w]) => window.__laheEdits.selectWordIn(id, w),
    [blockId, word]
  );
  expect(selected, "the word to select inside #" + blockId).toBe(true);
  await page.evaluate(() => window.__laheEdits.format("bold"));
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdits.isEditing() === false, undefined, {
    message: "Esc to commit the formatting-only change on #" + blockId
  });
}

// The whole session: six hand edits and one comment.
async function runSession(page) {
  for (const one of TYPED) await typeEdit(page, one.block, one.add);
  await page.evaluate(() => window.__laheEdits.deleteBlock("gone"));
  await boldAWord(page, "format", "ten");
  const commentId = await page.evaluate(() =>
    window.__laheEdits.commentOn("say", "opposite", "This contradicts the paragraph under it.")
  );
  expect(commentId, "the comment to be made through the real comment surface").toBeTruthy();
  return commentId;
}

test.describe("3D: the Edits tab", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "edits-tab" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("six hand edits become six before-and-after rows, apart from the thread, and they export", async ({
    page
  }) => {
    await page.goto(fixtureUrl(pages));
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, {
      message: "the real boot to put the library and the fixture's readers on the page"
    });

    const commentId = await runSession(page);

    // Six records, and the kinds the row rendering has to tell apart.
    const kinds = await page.evaluate(() =>
      window.__laheEdits
        .items()
        .filter((i) => i.kind === "edit" || i.kind === "delete" || i.kind === "format_only")
        .map((i) => i.kind)
    );
    expect(kinds.length, "six hand edits in the store").toBe(6);
    expect(kinds.filter((k) => k === "format_only").length, "one formatting-only change").toBe(1);
    expect(kinds.filter((k) => k === "delete").length, "one deletion").toBe(1);

    // Six rows in the tab.
    expect(await page.evaluate(() => window.__laheEdits.rowCount()), "six rows in the Edits tab").toBe(6);

    const rows = await page.evaluate(() => window.__laheEdits.rows());
    expect(rows.length).toBe(6);
    // Newest first: the last hand edit made is the first row.
    expect(rows[0].kind, "the newest hand edit is the formatting-only one, at the top").toBe("format_only");

    for (const row of rows) {
      expect(typeof row.before, "every row carries a before: " + row.id).toBe("string");
      expect(row.before.length, "the before is not empty: " + row.id).toBeGreaterThan(0);
    }

    const deletion = rows.find((r) => r.kind === "delete");
    expect(deletion.after, "a delete row reads as a deletion rather than as an empty edit").toMatch(/deleted/i);

    const formatOnly = rows.find((r) => r.kind === "format_only");
    expect(formatOnly.before, "the formatting-only row's words are unchanged").toBe(formatOnly.after);
    expect(
      formatOnly.structure,
      "the formatting-only row says what changed structurally"
    ).toMatch(/strong|bold|b>/i);

    const typedRow = rows.find((r) => r.kind === "edit");
    expect(typedRow.after, "an edit row's after is the reviewer's text").not.toBe(typedRow.before);

    // None of them are in the Active thread. Two readings of the same claim: the
    // rail's own count for the Active tab, and the rows really in that pane.
    expect(await page.evaluate(() => window.__laheEdits.rowsInPane("active")), "no edit row in the Active pane").toEqual([]);
    expect(await page.evaluate(() => window.__laheEdits.countFor("active")), "the Active tab holds the comment and nothing else").toBe(1);
    expect(await page.evaluate(() => window.__laheEdits.countFor("edits")), "the Edits tab holds the six hand edits").toBe(6);
    expect(
      await page.evaluate(() => window.__laheEdits.pillCount()),
      "all six unimplemented direct edits count as incomplete alongside the comment"
    ).toBe("7 (7)");

    const inEditsPane = await page.evaluate(() => window.__laheEdits.rowsInPane("edits"));
    expect(inEditsPane.length, "all six rows are in the Edits pane").toBe(6);
    expect(inEditsPane.map((r) => r.id)).not.toContain(commentId);

    // The list exports through 3C's real seam: the click delivers the file and
    // hands back the formatter's text, labeled as a slice (the edit list is a
    // subset of the review, never the whole).
    expect(await page.evaluate(() => window.__laheEdits.exportEnabled()), "the export button is live").toBe(true);
    const [download, exported] = await Promise.all([
      page.waitForEvent("download"),
      page.evaluate(() => window.__laheEdits.clickExport())
    ]);
    expect(exported.ok, "the export succeeded").toBe(true);
    expect(typeof exported.text, "the button returns the formatter's text").toBe("string");
    expect(exported.count, "the six hand edits went through the seam").toBe(6);
    expect(exported.text).toContain(TYPED[0].add.trim());
    expect(download.suggestedFilename(), "the click really delivered a file").toMatch(/\.txt$/);
  });

  // THE RULE THAT SAYS WHICH ROW IS THE REVIEWER'S OWN NEW TEXT.
  //
  // Every before-and-after pair carries a left rule, and a `data-kind='edit'`
  // row's is the accent. That is not decoration: it is how the tab says what is
  // new. Scanning a column of rows, the accent is the only thing separating the
  // reviewer's typed edits from a deletion or a formatting-only change, which
  // otherwise draw the same box. Delete either half of it (the rule, or the
  // accent override) and this goes red.
  test("an edit row's pair wears the accent rule, and the other kinds wear the neutral one", async ({
    page
  }) => {
    await page.goto(fixtureUrl(pages));
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, {
      message: "the real boot to put the library and the fixture's readers on the page"
    });
    await runSession(page);

    const drawn = await page.evaluate(() => {
      const pane = window.__lahe.handle.rail.tabBody("edits");
      const pairFor = (kind) => {
        const row = pane.querySelector('.lahe-edits[data-kind="' + kind + '"]');
        return row ? row.querySelector(".lahe-edits__pair") : null;
      };
      const edit = pairFor("edit");
      const other = pairFor("delete") || pairFor("format_only");
      if (!edit || !other) return null;
      const cs = (el) => window.getComputedStyle(el);
      const probe = document.createElement("div");
      probe.style.borderLeft = "2px solid var(--accent)";
      edit.appendChild(probe);
      const accent = cs(probe).borderLeftColor;
      probe.remove();
      return {
        editColor: cs(edit).borderLeftColor,
        editWidth: parseFloat(cs(edit).borderLeftWidth),
        otherColor: cs(other).borderLeftColor,
        otherWidth: parseFloat(cs(other).borderLeftWidth),
        accent: accent
      };
    });

    expect(drawn, "both an edit row and another kind are on screen to compare").not.toBe(null);
    expect(drawn.editWidth, "the edit row's rule is really drawn").toBeGreaterThanOrEqual(2);
    expect(drawn.otherWidth, "and so is the other kind's").toBeGreaterThanOrEqual(2);
    expect(drawn.editColor, "the edit row's rule is the rail's accent").toBe(drawn.accent);
    expect(drawn.editColor, "which is not what the other kinds wear").not.toBe(drawn.otherColor);
  });

  // A CROSS-TASK DEFECT 3D found and cannot fix in its own file.
  //
  // comments.outstanding() returns every record that is not handled, hand edits
  // included, so 1D's Active tab builds a comment row for each hand edit and
  // attaches it INTO the edit's card. The card then carries "Empty draft" and a
  // Reword and Delete pair under the before-and-after row: the comment thread's
  // machinery rendered onto a hand edit, which is half of R32 broken.
  //
  // The fix is one filter in src/layer/tab_active.js (1D's file, not 3D's):
  // outstanding items of kind comment or note. The test is written here so the
  // stitch has something to fix against; it is fixme so it reports rather than
  // failing a branch that cannot land the fix.
  test("a hand edit's card carries no comment-thread row (1D's tab_active.js)", async ({ page }) => {
    await page.goto(fixtureUrl(pages));
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, { message: "the real boot" });
    await typeEdit(page, "one", " One line is enough to make a row.");

    const cardText = await page.evaluate(() => {
      const pane = window.__lahe.handle.rail.tabBody("edits");
      return pane.querySelector(".card").textContent;
    });
    expect(cardText, "no draft label and no Reword/Delete pair on a hand edit").not.toMatch(/Empty draft|Reword/);
  });

  // A REGRESSION, fixed in ce02c19.
  //
  // The Edits pane orders its cards with inline flex `order`. A card that got
  // answered migrated to Done and TOOK THE INLINE STYLE WITH IT, and one stale
  // negative order beats every DOM position the rail chooses: the old edit sat
  // pinned at the top of Done while the reply that had just arrived sank below
  // it. The reviewer's newest answer was the hardest one to find.
  //
  // Asserted on painted geometry, not DOM order, because flex `order` moves what
  // is on screen without moving anything in the tree.
  test("a hand edit answered out of the Edits pane drops its inline order, and the newest reply is first in Done", async ({
    page
  }) => {
    await page.goto(fixtureUrl(pages));
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, { message: "the real boot" });
    await typeEdit(page, "one", TYPED[0].add);
    await typeEdit(page, "two", TYPED[1].add);

    const ids = await page.evaluate(() => window.__lahe.items().map((item) => item.id));
    expect(ids, "two hand edits, each with its own card").toHaveLength(2);

    // Both cards are in Edits, and the pane really does stamp an inline order.
    const stampedInEdits = await page.evaluate(
      (all) => all.some((id) => !!window.__lahe.rail.cardNode(id).style.order),
      ids
    );
    expect(stampedInEdits, "the Edits pane orders its rows with inline flex order").toBe(true);

    // The agent answers the FIRST edit, then the second a minute later. Nothing
    // test-only about the path: it is the real fold the poll loop calls.
    await page.evaluate(
      ({ all, review }) => {
        const P = window.LAHE.protocol;
        const events = all.map((id, index) =>
          P.newEvent({
            event: P.EVENT.REPLY_FOLDED,
            event_id: window.LAHE.record.randomId("evt"),
            review: review,
            item: id,
            rev: window.__lahe.itemById(id).rev,
            ts: new Date(Date.UTC(2026, 7, 19, 12, index)).toISOString(),
            payload: {
              accepted: true,
              state: "handled",
              file: "replies-claude.jsonl",
              reply: { status: "handled", agent: "claude", reason: null, text: null, files: [] }
            }
          })
        );
        events.forEach((event) => window.__lahe.handle.doneTab().applyReplies([event]));
      },
      { all: ids, review: await page.evaluate(() => window.__lahe.handle.review) }
    );

    await pollPage(page, (all) => all.every((id) => window.__lahe.rail.getCard(id).pane === "done"), ids, {
      message: "both answered edits to migrate into the Done pane"
    });

    const laidOut = await page.evaluate((all) => {
      window.__lahe.rail.collapse(false);
      window.__lahe.rail.selectTab("done");
      return all.map((id) => {
        const node = window.__lahe.rail.cardNode(id);
        return { id: id, order: node.style.order, top: node.getBoundingClientRect().top };
      });
    }, ids);

    laidOut.forEach((card) => {
      expect(card.order, "no card in Done carries the Edits pane's inline order any more").toBe("");
    });
    const [older, newer] = laidOut;
    expect(newer.top, "the card whose reply is newest sits above the one answered a minute earlier").toBeLessThan(
      older.top
    );
  });

  // The export module ships in the bundle now, so "absent" can only mean the
  // namespace was lost at runtime. The guard's promise is unchanged: the button
  // says so instead of failing quietly.
  test("with the export namespace gone, the button says so instead of failing quietly", async ({ page }) => {
    await page.goto(fixtureUrl(pages));
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, {
      message: "the real boot to put the library and the fixture's readers on the page"
    });
    await page.evaluate(() => {
      delete window.LAHE.exporter;
      delete window.LAHE.export;
    });
    await typeEdit(page, "one", " One line is enough to make a row.");

    expect(await page.evaluate(() => window.__laheEdits.rowCount())).toBe(1);
    const result = await page.evaluate(() => window.__laheEdits.clickExport());
    expect(result.ok, "the export reports failure rather than pretending").toBe(false);
    expect(result.reason).toMatch(/export/i);
    expect(await page.evaluate(() => window.__laheEdits.exportTitle())).toMatch(/export/i);
  });
});

// ---------------------------------------------------------------------------
// Free writing: the edits row and the card show new blocks (plan Task 3.2)
// ---------------------------------------------------------------------------
//
// Every run here is TYPED through the real editing surface on a free-writing
// fixture, with the helper down. What the card and the row say is read off the
// rail's own nodes, which a spec can reach through the rail's API even though
// the root is closed.

const fw = require("./support/free_writing_page");
const refusingHelper = require("./support/refusing_helper");

const ANCHOR_WORDS = "Then I tried asking for one paragraph at a time, which kept the chat short.";

/** The worked example after #p1 on blog.html: a heading, two paragraphs, a three-item list. */
async function typeWorkedRun(page) {
  await page.evaluate((t) => {
    document.getElementById("p1").textContent = t;
  }, ANCHOR_WORDS);
  await fw.openEdit(page, "#p1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("# What the chat window cost me", { delay: 2 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Every draft came back as a wall of text in a scrolling pane.", { delay: 1 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("The draft also lost its shape, and I could not see it whole.", { delay: 1 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Twenty minutes to find the sentence", { delay: 1 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("A second round trip for every fix", { delay: 1 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("No record of what I had asked for", { delay: 1 });
  await fw.commitByEsc(page);
  return fw.onlyEdit(page);
}

/** What the run's row and card say, read off the rail's own nodes. */
function runCard(page, id) {
  return page.evaluate((itemId) => {
    const rail = window.__lahe.rail;
    const card = rail.cardNode(itemId);
    if (!card) return null;
    const row = card.querySelector("[data-lahe-edit-row]");
    const text = (sel) => {
      const n = row && row.querySelector(sel);
      return n ? n.textContent : null;
    };
    const shown = (n) => !!n && n.getClientRects().length > 0;
    const blocks = row ? Array.from(row.querySelectorAll("[data-lahe-run-block]")) : [];
    return {
      first: text("[data-lahe-run-first]"),
      second: text("[data-lahe-run-second]"),
      blocks: blocks.map((b) => ({
        label: b.querySelector("[data-lahe-run-label]").textContent,
        words: b.querySelector("[data-lahe-run-words]").textContent,
        moved: b.getAttribute("data-lahe-run-block") === "moved"
      })),
      listShown: blocks.length ? shown(blocks[0]) : false,
      pairShown: shown(row && row.querySelector(".lahe-edits__pair")),
      folded: card.getAttribute("data-lahe-collapsed") === "true",
      line: (card.querySelector(".card__linetext") || {}).textContent || null,
      state: (card.querySelector(".card__state") || {}).textContent || null,
      stateAttr: (card.querySelector(".card__state") || { getAttribute: () => null }).getAttribute("data-state"),
      badges: Array.from(card.querySelectorAll(".card__badges .badge")).map((b) => b.textContent)
    };
  }, id);
}

/** pollPage, then the value the page function answered with. */
async function pollValue(page, fn, arg, options) {
  await pollPage(page, fn, arg, options);
  return page.evaluate(fn, arg);
}

async function openRail(page, tab) {
  await page.evaluate((t) => {
    window.__lahe.rail.collapse(false);
    window.__lahe.rail.selectTab(t);
  }, tab || "edits");
}

test.describe("free writing: the edits row and the card show new blocks", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ root: REPO_ROOT, label: "rail-run" });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("a run leads with the two-line summary, and lists each block's type under the disclosure", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    const item = await typeWorkedRun(page);
    await openRail(page);

    const card = await runCard(page, item.id);
    expect(card.first).toBe("New text after 'Then I tried asking for one...'");
    expect(card.second).toBe("A heading, 'What the chat window cost me', then 2 paragraphs and a 3-item list.");
    expect(card.blocks.map((b) => b.label)).toEqual(["Heading", "Paragraph", "Paragraph", "Bulleted list"]);
    expect(card.blocks[1].words).toBe("Every draft came back as a wall of text in a scrolling pane.");
    expect(card.blocks.some((b) => b.moved), "nothing in this run was moved").toBe(false);
    expect(card.listShown, "the block list is shown on an open card").toBe(true);
    expect(card.pairShown, "an unchanged anchor draws no before-and-after pair").toBe(false);

    // The row as data says the same.
    const row = await page.evaluate((id) => window.__lahe.handle.editsTab().rows().find((r) => r.id === id), item.id);
    expect(row.run.first).toBe(card.first);
    expect(row.run.second).toBe(card.second);

    // Folded, the card is one line, and it is the first line of the summary.
    await page.evaluate((id) => window.__lahe.rail.setCardCollapsed(id, true), item.id);
    const folded = await runCard(page, item.id);
    expect(folded.folded).toBe(true);
    expect(folded.line).toBe(card.first);
    expect(folded.listShown, "the block list sits under the disclosure").toBe(false);
  });

  test("a split tail is labelled as moved, not added", async ({ page }) => {
    const words = "First half of the thought. Second half of the thought.";
    await fw.openFixture(page, server, "blog.html");
    await page.evaluate((t) => {
      document.getElementById("p1").textContent = t;
    }, words);
    await fw.openEdit(page, "#p1", words.indexOf("Second"));
    await page.keyboard.press("Enter");
    await fw.caretToEndOfSession(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("A line typed after the split.", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    await openRail(page);

    const card = await runCard(page, item.id);
    expect(card.first).toBe("Edit of 'First half of the thought. Second...' plus new text");
    expect(card.second).toBe("A paragraph moved out of it, then a paragraph.");
    expect(card.blocks.map((b) => [b.label, b.moved])).toEqual([
      ["Paragraph, moved", true],
      ["Paragraph", false]
    ]);
    expect(card.pairShown, "the anchor changed, so its before-and-after is drawn").toBe(true);
  });

  test("a committed run's new text wears the changed-text wash", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    const item = await typeWorkedRun(page);
    const keys = await pollValue(
      page,
      (id) => {
        const got = window.__lahe.handle.changedBlocks().filter((k) => k.indexOf("run:" + id + ":") === 0);
        return got.length ? got : null;
      },
      item.id,
      { message: "the commit to wash the run's new blocks" }
    );
    expect(keys.sort()).toEqual([0, 1, 2, 3].map((i) => "run:" + item.id + ":" + i));
  });

  test("both replay notes show on the card", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    const item = await typeWorkedRun(page);

    // The agent placed the heading as a paragraph, and put the first paragraph
    // at the end of the post instead of after the heading.
    await page.evaluate(() => {
      const h = document.querySelector("#p1 + h2");
      const p = document.createElement("p");
      p.textContent = h.textContent;
      h.replaceWith(p);
      const moved = Array.from(document.querySelectorAll("#post p")).find((el) =>
        el.textContent.startsWith("Every draft came back")
      );
      document.getElementById("post").appendChild(moved);
    });
    await page.evaluate(() => window.__lahe.replayNow());
    await openRail(page);

    const card = await pollValue(
      page,
      (id) => {
        const codes = window.__lahe.rail.cardBadges(id).map((b) => b.code);
        return codes.indexOf("REPLAY_RUN_WRONG_TAG") !== -1 && codes.indexOf("REPLAY_RUN_PLACED_ELSEWHERE") !== -1
          ? codes
          : null;
      },
      item.id,
      { message: "replay to put both notes on the card" }
    );
    expect(card.length).toBeGreaterThanOrEqual(2);
    const drawn = await runCard(page, item.id);
    expect(drawn.badges).toContain(
      "The agent placed 'What the chat window cost me' as a paragraph. You wrote a heading, so Lahe sent it back."
    );
    expect(drawn.badges).toContain(
      "'Every draft came back as a...' is already further down the page, so Lahe did not add it again."
    );
  });

  test("a run the helper refused says so on the card, and is never shown as sent", async ({ page }) => {
    await refusingHelper.install(page, "http://127.0.0.1:1");
    await fw.openFixture(page, server, "blog.html");
    const item = await typeWorkedRun(page);
    await openRail(page);

    const card = await pollValue(
      page,
      (id) => {
        const got = window.__lahe.rail.cardBadges(id).find((b) => b.code === "RUN_EVENT_REFUSED");
        return got || null;
      },
      item.id,
      { message: "the helper's refusal to reach the card" }
    );
    expect(card.detail.helper_code).toBe("RUN_BLOCK_REFUSED");
    const drawn = await runCard(page, item.id);
    expect(drawn.badges).toContain(
      "The helper refused this edit, so the agent has not seen it. Your words are still on this page."
    );
    expect(drawn.state, "the state chip never says the edit was sent").toBe("Not sent");
    expect(drawn.stateAttr).toBe("refused");
  });

  test("an empty notes page shows the pinned lines on both tabs, with the file name", async ({ page }) => {
    await fw.openFixture(page, server, "empty_notes.html");
    for (const tab of ["active", "edits"]) {
      await openRail(page, tab);
      const lines = await pollValue(
        page,
        (t) => {
          const pane = window.__lahe.rail.tabBody(t);
          const empty = pane.querySelector(".empty");
          if (!empty || empty.getClientRects().length === 0) return null;
          return Array.from(empty.querySelectorAll("[data-lahe-empty-line]")).map((n) => n.textContent);
        },
        tab,
        { message: "the empty-page lines to show on the " + tab + " tab" }
      );
      expect(lines).toEqual([
        "Nothing written yet",
        "Start typing. Your notes go to empty_notes.md.",
        "Each time you stop writing, everything you wrote in that sitting becomes one card here, and the agent places it in the file.",
        "The agent only places your words. It organizes the notes when you ask it to."
      ]);
    }
    const count = await page.evaluate(
      () => window.__lahe.rail.tabBody("edits").querySelector(".lahe-edits-bar__count").textContent
    );
    expect(count, "the empty draft the page opens with is not counted").toBe("0 hand edits");
  });

  test("an empty HTML page shows the lines without a file name", async ({ page }) => {
    await fw.openFixture(page, server, "test/fixtures/rail-empty-page.html");
    await openRail(page, "active");
    const lines = await pollValue(
      page,
      () => {
        const empty = window.__lahe.rail.tabBody("active").querySelector(".empty");
        const got = empty ? Array.from(empty.querySelectorAll("[data-lahe-empty-line]")).map((n) => n.textContent) : [];
        return got.length ? got : null;
      },
      undefined,
      { message: "the empty-page lines on an HTML page" }
    );
    expect(lines[1]).toBe("Start typing.");
  });

  // A REPLAY DEFECT the rail found and cannot fix in its own files.
  //
  // After "Use the fixes" rewords block 1 of a run, replay's branch three
  // rewrites that block in place, which is right. But the block AFTER it (the
  // list here) then reads as missing from its place, and the card gets
  // REPLAY_RUN_PLACED_ELSEWHERE ("... is already further down the page") while
  // the page is exactly right. The fix is in src/layer/replay.js placeRun (the
  // presence table after a reworded middle block), which this workstream does
  // not own. fixme so it reports rather than failing a branch that cannot land
  // the fix; the orchestrator hands it to the replay fix builder.
  test("after Use the fixes, the blocks after the fixed one raise no placed-elsewhere note", async ({ page }, testInfo) => {
    await fw.openFixture(page, server, "blog.html");
    const item = await typeWorkedRun(page);
    await page.evaluate((id) => {
      const P = window.LAHE.protocol;
      const ev = P.newEvent({
        event: P.EVENT.REPLY_FOLDED,
        event_id: window.LAHE.record.randomId("evt"),
        review: window.__lahe.handle.review,
        item: id,
        rev: window.__lahe.itemById(id).rev,
        payload: {
          accepted: true,
          state: "ready",
          file: "replies-claude.jsonl",
          reply: {
            status: "question",
            agent: "claude",
            text: "One fix.",
            files: [],
            proofread: true,
            suggestions: [{ block: 1, from: "wall", to: "sheet" }]
          }
        }
      });
      window.__lahe.handle.doneTab().applyReplies([ev]);
      window.__lahe.rail.cardNode(id).querySelector("[data-lahe-act='use-fixes']").click();
    }, item.id);
    await pollPage(
      page,
      () => Array.from(document.querySelectorAll("#post p")).some((p) => p.textContent.indexOf("a sheet of text") !== -1),
      undefined,
      { message: "replay to write the fixed words" }
    );
    await page.evaluate(() => window.__lahe.replayNow());
    const codes = await page.evaluate((id) => window.__lahe.rail.cardBadges(id).map((b) => b.code), item.id);
    expect(codes).not.toContain("REPLAY_RUN_PLACED_ELSEWHERE");
    await page.evaluate(() => window.__lahe.rail.collapse(false));
    await page.screenshot({ path: testInfo.outputPath("after-use-fixes-no-note.png") });
  });

  test("a page with content keeps the ordinary empty lines", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    const text = await page.evaluate(() => window.__lahe.rail.tabBody("edits").querySelector(".empty").textContent);
    expect(text).toBe("No hand edits yet.");
  });
});
