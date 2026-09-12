// The probable place: where a comment goes when the words it was made on are
// gone, and what the reviewer is told about the guess.
//
// The story, end to end, on a page a build rewrites underneath the reviewer:
//
//   1. The reviewer comments on a sentence.
//   2. The agent rewords that sentence, which is what the comment asked for,
//      and rebuilds the page WITHOUT carrying the stamp into the source.
//      The comment's words are nowhere on the page now. The write ladder
//      refuses (nothing may be written on a guess) and the record stays lost
//      for the agent, and the page still shows the reviewer where their comment
//      lives: the reworded paragraph, painted weaker, with the word "probable"
//      on the card. Clicking the card goes there.
//   3. The agent rebuilds again, this time carrying `data-lahe-id` onto that
//      paragraph. Now the element is identified rather than guessed at: normal
//      paint, nothing on the card, and the lost stamp ends.
//
// The control is the other half of Ken's decision (FINGERPRINTING.md, question
// 1): an EDIT in the same situation is never pointed at a guess. It refuses and
// stays refused, with no mark on the page at all, because the next thing that
// happens to an edit is a write.
//
// A live helper and a real file on disk, because the reload is driven by the
// file's mtime and because review.json is what the agent reads.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, startStaticServer, startService, placeCaret } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "probable-place";
const PAGE_FILE = "page.html";

const SAID = "This is the sentence I want in plainer words.";
const TARGET = "Runners come back too fast after a layoff, and the third week is where it shows.";
// The same paragraph, in the plainer words the comment asked for. Same position
// under the same parent, same neighbours either side, some of the same words.
const TARGET_REWORDED = "Most runners come back too fast, and the third week is when that catches up with them.";

const TAIL = "Warm up before every session.";
const TAIL_EDITED = "Warm up before every session, even the easy ones.";
// Neither the reviewer's words nor the ones they edited: the passage moved on.
const TAIL_REWRITTEN = "Nothing in this paragraph resembles what either of us wrote about it.";

test.describe.configure({ mode: "serial" });

function docHtml(helperOrigin, token, edition, target, tail, stamp) {
  const attrs = protocol.SCRIPT_ATTR;
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Steady Pace</title></head>',
    "<body>",
    "<main>",
    '<h1 id="edition">' + edition + "</h1>",
    '<p id="lead">Coming back from a layoff is its own training block.</p>',
    // Enough page above the passage that a jump to it is a real measurement
    // rather than a paragraph that was on screen the whole time.
    '<div id="gap" style="height: 1600px"></div>',
    '<p id="target"' + (stamp ? ' data-lahe-id="' + stamp + '"' : "") + ">" + target + "</p>",
    '<p id="tail">' + tail + "</p>",
    '<div id="scroll-space" style="height: 2600px"></div>',
    "</main>",
    '<script src="' +
      helperOrigin +
      '/lahe-layer.js" ' +
      attrs.REVIEW +
      '="' +
      REVIEW +
      '" ' +
      attrs.TOKEN +
      '="' +
      token +
      '" ' +
      attrs.HELPER +
      '="' +
      helperOrigin +
      '"></script>',
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

test.describe("a comment whose words are gone points at its probable place", () => {
  let dir;
  let filePath;
  let pages;
  let service;
  let token;

  /** What a build does: rewrite the file. The mtime is the reload signal. */
  function rebuild(edition, target, tail, stamp) {
    fs.writeFileSync(filePath, docHtml(service.url, token, edition, target, tail, stamp));
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(filePath, later, later);
  }

  function reviewJson() {
    const file = path.join(service.stateDir, "reviews", REVIEW, "review.json");
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      // Read mid-write. The caller is polling.
      return null;
    }
  }

  function itemInReviewJson(id) {
    const doc = reviewJson();
    if (!doc || !Array.isArray(doc.pages)) return null;
    let found = null;
    doc.pages.forEach((page) => {
      (page.items || []).forEach((entry) => {
        if (entry.id === id) found = entry;
      });
    });
    return found;
  }

  async function booted(page) {
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag",
      timeoutMs: 20000
    });
    // The reload waits for the reviewer to be still. This spec types and clicks
    // and then expects a reload, so it shortens that window.
    await page.evaluate(() => window.__lahe.interactionBusy(50));
  }

  /** The settling window is over, and a pass has run since it closed. */
  async function afterTheWindowCloses(page) {
    await pollPage(page, () => window.LAHE.replay.isSettling() === false, undefined, {
      message: "replay's settling window to close",
      timeoutMs: 20000
    });
    await page.evaluate(() => window.__lahe.replayNow());
  }

  async function claim(page) {
    if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
      await page.evaluate(() => window.__lahe.handle.sync.takeover());
      await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "this window to take over the retained review"
      });
    }
  }

  /** The reviewer's gesture: select the passage, Cmd-Shift-C, type, Cmd-Enter. */
  async function commentOn(page, selector, text) {
    await claim(page);
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, selector);
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
      message: "the comment box to open on the passage"
    });
    await page.keyboard.type(text);
    await page.keyboard.press("ControlOrMeta+Enter");
    await pollPage(
      page,
      (note) => window.__lahe.items().some((item) => item.note === note && item.state === "ready"),
      text,
      { message: "the comment to be ready" }
    );
    await page.evaluate(() => window.__lahe.handle.comments.closeAll());
  }

  /** Cmd-Shift-E, select the block, retype it, Esc. A real hand edit. */
  async function handEdit(page, selector, text) {
    await claim(page);
    await placeCaret(page, { selector: selector, offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, {
      message: "Cmd-Shift-E to put the block into edit state"
    });
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, selector);
    await page.keyboard.type(text, { delay: 5 });
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the hand edit"
    });
  }

  /** What the page says about one record: its paint, its card, its stamp. */
  function stateOf(page, id) {
    return page.evaluate((itemId) => {
      function textsUnder(name) {
        const set = window.CSS && window.CSS.highlights ? window.CSS.highlights.get(name) : null;
        if (!set) return [];
        return Array.from(set).map((range) => String(range));
      }
      const item = window.__lahe.itemById(itemId);
      const card = window.__lahe.rail.cardNode(itemId);
      const notice = card ? card.querySelector(".card__notice") : null;
      return {
        probable: textsUnder("lahe-comment-probable"),
        comment: textsUnder("lahe-comment"),
        notice: notice ? (notice.textContent || "").trim() : "",
        lost: !!(item && item.region && item.region.lost)
      };
    }, id);
  }

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-probable-place-"));
    filePath = path.join(dir, PAGE_FILE);
    pages = await startStaticServer({ root: dir, label: "probable-place" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);

    // What `lahe add` does: tell the helper which file this review is of. The
    // recorded path is the only thing the reload's mtime can come from.
    const written = await fetch(service.url + protocol.route("review.write").path, {
      method: "POST",
      headers: {
        "Content-Type": protocol.JSON_CONTENT_TYPE,
        "x-lahe-client": protocol.CLIENT_CLI,
        "x-lahe-token": token,
        Origin: pages.origin
      },
      body: JSON.stringify({ review: REVIEW, origins: [pages.origin], target_path: filePath })
    });
    expect(written.status, "the helper recorded the reviewed file's path").toBe(200);
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("a reworded paragraph is painted probable, stays lost for the agent, and a stamp settles it", async ({
    page
  }) => {
    rebuild("First edition", TARGET, TAIL, null);
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    await commentOn(page, "#target", SAID);
    const made = await page.evaluate((note) => {
      const found = window.__lahe.items().find((item) => item.note === note);
      return { id: found.id, stamp: found.region.ref.stamp };
    }, SAID);
    expect(made.stamp, "the page stamped the element the moment the reviewer commented on it").toBeTruthy();

    // ---- the agent reworded the sentence and did NOT carry the stamp --------
    rebuild("Second edition", TARGET_REWORDED, TAIL, null);
    await pollPage(page, () => document.querySelector("#edition").textContent === "Second edition", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);
    await afterTheWindowCloses(page);

    await pollPage(
      page,
      () => {
        const set = window.CSS.highlights.get("lahe-comment-probable");
        return !!set && set.size === 1;
      },
      undefined,
      { message: "the comment to be painted at its probable place", timeoutMs: 20000 }
    );

    const guessed = await stateOf(page, made.id);
    expect(guessed.probable[0], "the guess is on the reworded paragraph").toContain("the third week");
    expect(guessed.comment, "and it is not wearing the ordinary comment paint").toEqual([]);
    expect(guessed.notice.indexOf("probable"), "the card says probable, first word").toBe(0);
    expect(guessed.lost, "the record is still lost: a guess is not a find").toBe(true);

    // The agent's own copy says the same thing. It must not write on a guess,
    // so nothing about the guess reaches it.
    // THE AGENT IS NEVER HANDED THE GUESS. review.json is the agent's whole
    // view of this review, and nothing about a probable place is in it: no
    // element, no notice, no softened wording that could read as "it is over
    // here now". That is S8, and it is what keeps a guess from turning into a
    // write.
    //
    // What is NOT asserted here, because it is not true yet: this entry's
    // `lost` field is still null. Replay stamps the record lost in the browser
    // and persists it to browser storage, and nothing posts that stamp back to
    // the helper, so the file the agent reads never learns the passage went
    // unmatched. That gap is older than this work and it lives in the sync
    // wiring, not in the point ladder. The reviewer's own card and the record
    // in the page both say lost (asserted above).
    const entry = await pollUntil(
      () => itemInReviewJson(made.id),
      { message: "the item to be in review.json at all", timeoutMs: 20000 }
    );
    expect(
      JSON.stringify(entry).indexOf("probable"),
      "the agent's copy of this item says nothing about a probable place"
    ).toBe(-1);
    expect(entry.quote, "it still carries the words the reviewer commented on").toContain("the third week");

    // Clicking the card goes to the probable place, like any other card.
    await page.evaluate(() => window.scrollTo(0, 0));
    await pollPage(page, () => window.scrollY === 0, undefined, { message: "the page to be back at the top" });
    const rect = await page.evaluate((id) => {
      const node = window.__lahe.rail.cardNode(id);
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width };
    }, made.id);
    await page.mouse.click(rect.x + rect.width / 2, rect.y + 6);
    await pollPage(
      page,
      () => {
        const r = document.querySelector("#target").getBoundingClientRect();
        return r.top > 0 && r.bottom < window.innerHeight && window.scrollY > 0;
      },
      undefined,
      { message: "the click to scroll the probable paragraph into view" }
    );

    // ---- the agent carried the stamp into the source this time -------------
    rebuild("Third edition", TARGET_REWORDED, TAIL, made.stamp);
    await pollPage(page, () => document.querySelector("#edition").textContent === "Third edition", undefined, {
      message: "the page to reload itself onto the stamped rebuild",
      timeoutMs: 20000
    });
    await booted(page);
    await afterTheWindowCloses(page);

    await pollPage(
      page,
      () => {
        const item = window.__lahe.items()[0];
        return !!item && !(item.region && item.region.lost);
      },
      undefined,
      { message: "the stamped element to be found for certain", timeoutMs: 20000 }
    );

    const certain = await stateOf(page, made.id);
    expect(certain.probable, "nothing on the page is a guess any more").toEqual([]);
    expect(certain.comment.length, "the passage is painted like any other commented passage").toBe(1);
    expect(certain.comment[0]).toContain("the third week");
    expect(certain.notice, "and the word probable is off the card").toBe("");
    expect(certain.lost, "the record is not lost").toBe(false);
  });

  test("an edit in the same situation stays lost, with nothing painted anywhere", async ({ page }) => {
    rebuild("Edit edition", TARGET, TAIL, null);
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the poll to establish the baseline mtime"
    });

    await handEdit(page, "#tail", TAIL_EDITED);
    const made = await page.evaluate((after) => {
      const found = window.__lahe.items().find((item) => item.kind === "edit" && item.after === after);
      return found ? { id: found.id } : null;
    }, TAIL_EDITED);
    expect(made, "the hand edit landed as a record").toBeTruthy();

    // The passage moved on: neither the reviewer's words nor the ones they
    // edited are on the page, and no stamp came with the rebuild.
    rebuild("Edit edition two", TARGET, TAIL_REWRITTEN, null);
    await pollPage(page, () => document.querySelector("#edition").textContent === "Edit edition two", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);
    await afterTheWindowCloses(page);

    await pollPage(
      page,
      (id) => {
        const item = window.__lahe.itemById(id);
        return !!(item && item.region && item.region.lost);
      },
      made.id,
      { message: "the edit to be reported lost", timeoutMs: 20000 }
    );

    const state = await stateOf(page, made.id);
    expect(state.probable, "an edit is never pointed at a guess: the next thing it does is write").toEqual([]);
    expect(state.notice.indexOf("probable"), "and nothing on its card says probable").toBe(-1);
    expect(
      await page.evaluate(() => document.querySelector("#tail").textContent),
      "the page was not written to"
    ).toBe(TAIL_REWRITTEN);
  });
});
