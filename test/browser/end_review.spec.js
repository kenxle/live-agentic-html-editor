// End review: the door on the rail, and what pressing it actually does.
//
// D10 has said since the architecture was written that a review ends when the
// reviewer chooses End review on the rail, and that ending is not just
// archiving: it surfaces the session's hand-edit list (R39) as the closing
// step. The route, the event and the projection have all existed since
// 0A-wire. Nothing in the browser ever called them, so none of it had ever
// happened to a reviewer.
//
// This runs the real `lahe review` walk, like undo_reaches_helper.spec.js does,
// because the three claims worth making are all about bytes on disk:
//
//   THE ORDER          a keystroke still sitting in the outbox reaches the
//                      helper BEFORE the archive event. Ending over unflushed
//                      typing archives the review on top of the last thing the
//                      reviewer wrote, and browser storage keeping a copy is
//                      not the same as the agent ever seeing it.
//   THE EVENT          review.archived lands, and ended_at appears in the
//                      review.json an agent reads.
//   THE CLOSING STEP   the hand-edit list is in front of the reviewer when the
//                      review ends, which is the whole reason the list is kept.
//
// Plus the two things about the control itself: it is in the FOOTER beside the
// hints, not in the head's menu, and the menu still holds exactly Copy and
// Export (rail_menu.spec.js asserts that too, and it must keep passing
// untouched).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

test.describe.configure({ mode: "serial" });

const ORIGINAL = "Runners come back too fast after a layoff.";
const ADDED = " They know it while they are doing it.";
const EDITED = ORIGINAL + ADDED;
const LAST_TYPED = "the last thing the reviewer typed before reaching for the door";

function docHtml() {
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Steady Pace</title></head>',
    "<body>",
    "<main>",
    '<p id="p">' + ORIGINAL + "</p>",
    '<p id="other">The first two weeks feel easy and the third week hurts.</p>',
    "</main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      server.close(function () {
        resolve(port);
      });
    });
  });
}

function labelled(output, label) {
  const match = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return match ? match[1] : null;
}

test.describe("the reviewer ends the review from the rail", () => {
  let world = null;

  test.beforeEach(async () => {
    // A review per test: ending one is a one-way act, so a shared world would
    // make every test after the first one run against an ended review.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-end-review-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const pagePath = path.join(work, "doc.html");
    fs.writeFileSync(pagePath, docHtml());

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    const port = await freePort();

    const output = execFileSync(process.execPath, [CLI, "review", pagePath, "--port", String(port)], {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const session = labelled(output, "session");
    const review = labelled(output, "review");
    const open = labelled(output, "open");
    expect(session, "`lahe review` printed the agent session id").toBeTruthy();
    expect(review, "`lahe review` printed the review id").toBeTruthy();
    expect(open, "`lahe review` printed the URL its own server publishes the page at").toBeTruthy();

    world = {
      root: root,
      stateDir: stateDir,
      pagePath: pagePath,
      env: env,
      session: session,
      review: review,
      open: open,
      reviewDir: path.join(stateDir, "reviews", review)
    };
  });

  test.afterEach(async () => {
    if (!world) return;
    try {
      execFileSync(process.execPath, [CLI, "session", "close", world.session], {
        cwd: REPO_ROOT,
        env: world.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      // A session that already went down is not a test failure.
    }
    world = null;
  });

  /** The event log as the helper wrote it: one parsed object per line. */
  function events() {
    const file = path.join(world.reviewDir, "events.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  function projection() {
    const file = path.join(world.reviewDir, "review.json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  async function booted(page) {
    await page.goto(world.open);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its own script tag",
      timeoutMs: 20000
    });
    if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
      await page.evaluate(() => window.__lahe.handle.sync.takeover());
      await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "this window to take over the retained review"
      });
    }
  }

  function endInfo(page) {
    return page.evaluate(() => window.__lahe.rail.endInfo());
  }

  function centerOf(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  /** A real mouse click on the door, at its on-screen geometry. */
  async function pressTheDoor(page) {
    const info = await endInfo(page);
    expect(info.present, "the footer carries the way out").toBe(true);
    const at = centerOf(info.rect);
    await page.mouse.click(at.x, at.y);
    return pollUntil(
      async () => {
        const got = await endInfo(page);
        return got.panel.open ? got : null;
      },
      { message: "the confirm to open on a click" }
    );
  }

  /** Comment on a passage and mark it ready. The reviewer's own path. */
  async function commentOn(page, selector, text) {
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
    await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready"), undefined, {
      message: "the comment to be ready"
    });
  }

  /** A comment box left half typed: a draft, which no agent will ever see. */
  async function draftOn(page, selector, text) {
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
      message: "the second comment box to open"
    });
    await page.keyboard.type(text);
    await pollPage(page, () => window.__lahe.items().some((i) => i.state === "draft"), undefined, {
      message: "the draft to be written to browser storage"
    });
  }

  /** Cmd-Shift-E, type at the end of the block, Esc. One hand edit. */
  async function editAndCommit(page) {
    await placeCaret(page, { selector: "#p", offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, {
      message: "Cmd-Shift-E to put #p into edit state"
    });
    await placeCaret(page, { selector: "#p", offset: ORIGINAL.length });
    await page.keyboard.type(ADDED, { delay: 10 });
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the edit"
    });
  }

  // -------------------------------------------------------------------------

  test("the way out is in the footer beside the hints, and the menu is untouched", async ({ page }) => {
    await booted(page);

    const info = await endInfo(page);
    expect(info.present, "the footer carries the way out").toBe(true);
    expect(info.label, "one sentence, and a screen reader gets all of it").toBe("End this review and perform cleanup");
    expect(info.title, "the same sentence on hover").toBe("End this review and perform cleanup");
    expect(info.icon, "door iconography, drawn, not an emoji").toBe(true);
    expect(info.text, "no label beside the icon: it is a narrow strip, not a submit button").toBe("");
    expect(info.rect.width, "it is really on screen").toBeGreaterThan(0);

    // Beside the hints, not under them, and spanning both hint rows.
    expect(info.rect.x, "it sits to the right of the hints").toBeGreaterThanOrEqual(info.hintsRect.right - 1);
    expect(info.rect.height, "a narrow vertical strip as tall as the hints it stands beside").toBeGreaterThanOrEqual(
      info.hintsRect.height - 1
    );
    expect(info.rect.width, "narrow").toBeLessThan(info.hintsRect.width);

    // It is NOT a menu item, and the menu is exactly what it was.
    expect(info.inMenu, "the way out is standing UI, not a menu item").toBe(false);
    const menu = await page.evaluate(() => {
      window.__lahe.rail.openMenu(0);
      return window.__lahe.rail.menuInfo();
    });
    expect(menu.items.map((one) => one.label)).toEqual(["Copy review", "Export review to file"]);
    await page.evaluate(() => window.__lahe.rail.closeMenu(false));

    // Nothing has ended, because nothing was pressed.
    expect(events().filter((event) => event.event === "review.archived")).toHaveLength(0);
  });

  test("the confirm says what is unfinished, and Keep reviewing leaves the review open", async ({ page }) => {
    await booted(page);
    await commentOn(page, "#p", "Say which number this is.");
    await draftOn(page, "#other", "half a thought about");

    const info = await pressTheDoor(page);
    expect(info.panel.title).toBe("End this review?");
    // Four unanswered items must not be silent, and neither must one: the
    // sentence carries both counts, and a draft is called out for the reason it
    // matters, which is that no agent will ever see it.
    expect(info.panel.what).toBe(
      "1 item is still waiting on an agent, and 1 draft has not been marked ready, so no agent has seen it."
    );
    expect(info.panel.kept, "and what ending costs, which is the reviewer's real question").toContain(
      "Your work is kept either way"
    );
    expect(info.panel.confirm.label).toBe("End review");
    expect(info.panel.cancel.label).toBe("Keep reviewing");

    // The way back, really clicked.
    await page.mouse.click(centerOf(info.panel.cancel.rect).x, centerOf(info.panel.cancel.rect).y);
    const after = await pollUntil(
      async () => {
        const got = await endInfo(page);
        return got.panel.open === false ? got : null;
      },
      { message: "Keep reviewing to put the panel away" }
    );
    expect(after.panel.open).toBe(false);
    expect(events().filter((event) => event.event === "review.archived"), "nothing was ended").toHaveLength(0);
  });

  test("the last keystroke reaches the helper before the archive, and the hand edits are surfaced", async ({ page }) => {
    const downloads = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));

    await booted(page);
    await editAndCommit(page);
    expect(await page.evaluate(() => document.getElementById("p").textContent)).toBe(EDITED);
    await pollUntil(() => (projection() ? true : null), { message: "the edit to reach review.json", timeoutMs: 20000 });

    // THE RACE, MADE CERTAIN. A post to the helper is debounced at 750ms of
    // typing idle (protocol.FLUSH), so at the moment a reviewer reaches for the
    // door their last keystrokes are ordinarily still in the outbox. Queueing
    // the event and pressing the door in ONE synchronous block is that moment,
    // with no timing left to luck: nothing can have flushed in between.
    const pressed = await page.evaluate((note) => {
      const handle = window.__lahe.handle;
      const item = window.LAHE.record.newItem({
        kind: "comment",
        state: "ready",
        note: note,
        page_origin: window.location.origin,
        page_path: window.location.pathname,
        page_title: document.title,
        page_seq: 1
      });
      handle.sync.recordItem(item);
      const root = window.__lahe.rail.tabBody("active").getRootNode();
      root.querySelector(".endbtn").click();
      const queued = handle.sync.status().queued;
      root.querySelector(".endpanel__go").click();
      return { queued: queued, item: item.id };
    }, LAST_TYPED);
    expect(pressed.queued, "the keystroke really was unsent when End review was pressed").toBeGreaterThan(0);

    const ended = await pollUntil(
      async () => {
        const got = await endInfo(page);
        return got.panel.title === "Review ended" ? got : null;
      },
      { message: "the review to end", timeoutMs: 20000 }
    );
    expect(ended.panel.what, "the closing step is named, not left to be discovered").toContain("hand edits");

    // THE ORDER, in the helper's own bytes. The keystroke is on the log, and it
    // is on it BEFORE the archive: a review archived over unsent typing is the
    // reviewer's last words lost.
    const log = await pollUntil(
      () => {
        const lines = events();
        return lines.some((event) => event.event === "review.archived") ? lines : null;
      },
      { message: "review.archived to reach the log", timeoutMs: 20000 }
    );
    const typed = log.findIndex((event) => JSON.stringify(event).indexOf(LAST_TYPED) !== -1);
    const archived = log.findIndex((event) => event.event === "review.archived");
    expect(typed, "the queued keystroke reached the helper at all").toBeGreaterThan(-1);
    expect(typed, "and it reached it before the review was archived").toBeLessThan(archived);
    expect(log.filter((event) => event.event === "review.archived"), "archived once").toHaveLength(1);

    // THE EVENT, as an agent reads it.
    const parsed = await pollUntil(
      () => {
        const got = projection();
        return got && got.review.ended_at ? got : null;
      },
      { message: "ended_at to reach review.json", timeoutMs: 20000 }
    );
    expect(typeof parsed.review.ended_at).toBe("string");
    // Archived, never truncated: the outstanding work is still in the file.
    const items = parsed.pages.reduce((out, pg) => out.concat(pg.items), []);
    expect(items.length, "the review's items are kept").toBeGreaterThan(0);

    // THE CLOSING STEP. The hand-edit list is what the reviewer is looking at,
    // and it left as a file they keep.
    expect(await page.evaluate(() => window.__lahe.rail.currentTab()), "the Edits tab is in front of them").toBe("edits");
    const exported = await pollUntil(
      async () => {
        const got = await page.evaluate(() => {
          const last = window.__lahe.handle.editsTab().lastExport();
          return last ? { ok: last.ok, count: last.count, text: last.text, filename: last.filename } : null;
        });
        return got && got.ok ? got : null;
      },
      { message: "the hand-edit list to be exported at the close" }
    );
    expect(exported.count, "the session's hand edits, listed").toBe(1);
    expect(exported.text, "with the wording the reviewer actually typed").toContain(ADDED.trim());
    expect(exported.filename, "saved under a name that says what it is").toContain("hand-edits");
    await pollUntil(() => (downloads.length > 0 ? downloads : null), {
      message: "the file to really leave the browser"
    });
  });
});
