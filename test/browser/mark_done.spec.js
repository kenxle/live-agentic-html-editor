// Mark as done: the reviewer closes a card themselves.
//
// Ken, 2026-10-12: "you should always be able to move a card to done when i
// request it, or i should be able to click the "ready" or "unhandled" and
// change it to done, or something. it's annoying to have leftover comments i
// can't get rid of".
//
// Both tests are the real `lahe review file.md` walk: the session, the helper,
// the static server, the render, the reply file and `lahe status --json` are
// the real ones. The rail is a closed shadow root, so every press is a real
// mouse click or key press at the chip's own reported geometry.
//
//  1. A comment the agent answered not_handled. The reviewer clicks the chip,
//     chooses Mark as done, and the card goes to Done saying they closed it,
//     with no "1 new". The drain stops listing it, a late agent reply is
//     refused, and a reload keeps it done.
//  2. A hand edit the page check held open (handled_not_on_page). Closed from
//     the keyboard: Enter opens the menu, Escape closes it, Enter again and
//     Enter on the item closes the card.
//
// The screenshots in docs/features/20261012.01_rail_cleanup come from test 1.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil, placeCaret } = require("../helpers");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const SHOTS = path.join(REPO_ROOT, "docs", "features", "20261012.01_rail_cleanup");

test.describe.configure({ mode: "serial" });

const ORIGINAL = "Runners come back too fast after a layoff.";
const REVIEWER_WROTE = "Runners come back too fast after a layoff, and week three is where it shows.";
const COMMENT = "Say how fast is too fast.";
const INTRO_P = "main > section:first-of-type > p";

function markdownWith(paragraph) {
  return ["# Coming back", "", "## Intro", "", paragraph, "", "## Premise", "", "All those days are gone.", ""].join(
    "\n"
  );
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

test.describe("the reviewer can mark any outstanding card done", () => {
  let world = null;

  test.beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-mark-done-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const source = path.join(work, "post.md");
    fs.writeFileSync(source, markdownWith(ORIGINAL));

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    world = { root: root, stateDir: stateDir, source: source, env: env, port: await freePort() };

    const output = execFileSync(process.execPath, [CLI, "review", source, "--port", String(world.port)], {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    world.session = labelled(output, "session");
    world.review = labelled(output, "review");
    world.open = labelled(output, "open");
    expect(world.open, "`lahe review` printed the URL of the rendered page").toBeTruthy();
    world.reviewDir = path.join(stateDir, "reviews", world.review);
  });

  test.afterEach(async () => {
    if (!world || !world.session) return;
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
    await stopTempHelpers(world.stateDir);
    world = null;
  });

  // --- the agent's whole API --------------------------------------------------

  function reply(fields) {
    fs.appendFileSync(
      path.join(world.reviewDir, "replies.jsonl"),
      JSON.stringify(Object.assign({ agent: "claude" }, fields)) + "\n"
    );
  }

  function projectedItem(id) {
    const file = path.join(world.reviewDir, "review.json");
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const page of parsed.pages || []) {
        const got = (page.items || []).find((item) => item.id === id);
        if (got) return got;
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  function drain() {
    return execFileSync(process.execPath, [CLI, "status", "--session", world.session, "--json", "--quiet"], {
      cwd: REPO_ROOT,
      env: world.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  function foldedLines(id) {
    const file = path.join(world.reviewDir, "events.jsonl");
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.event === "reply.folded" && event.item === id);
  }

  // --- the reviewer's gestures ------------------------------------------------

  async function booted(page) {
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its own script tag",
      timeoutMs: 20000
    });
    await page.evaluate(() => window.__lahe.interactionBusy(50));
  }

  async function claim(page) {
    if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
      await page.evaluate(() => window.__lahe.handle.sync.takeover());
      await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "this window to take over the retained review"
      });
    }
  }

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
    await pollPage(page, (want) => window.__lahe.items().some((i) => i.note === want && i.state === "ready"), text, {
      message: "the comment to become a ready record"
    });
    const items = await page.evaluate(() => window.__lahe.items());
    return items.find((item) => item.note === text);
  }

  function selectAllWords(page) {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let node = walker.nextNode();
      while (node) {
        nodes.push(node);
        node = walker.nextNode();
      }
      const range = document.createRange();
      range.setStart(nodes[0], 0);
      const last = nodes[nodes.length - 1];
      range.setEnd(last, last.data.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, INTRO_P);
  }

  async function reviewerEdits(page, text) {
    await claim(page);
    await placeCaret(page, { selector: INTRO_P, offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, {
      message: "Cmd-Shift-E to put the intro paragraph into edit state"
    });
    await selectAllWords(page);
    await page.keyboard.type(text, { delay: 2 });
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the edit"
    });
    return page.evaluate(() => {
      const edit = window.__lahe.items().filter((item) => item.kind === "edit" && item.state !== "draft")[0];
      return edit ? { id: edit.id, rev: edit.rev, after: edit.after } : null;
    });
  }

  // --- reading the closed root back --------------------------------------------

  function chip(page, id) {
    return page.evaluate((itemId) => window.__lahe.rail.cardStateInfo(itemId), id);
  }

  function itemNow(page, id) {
    return page.evaluate((itemId) => window.__lahe.items().find((each) => each.id === itemId) || null, id);
  }

  function cardNow(page, id) {
    return page.evaluate((itemId) => {
      const card = window.__lahe.rail.getCard(itemId);
      return card ? { pane: card.pane, notice: card.notice, state: card.state } : null;
    }, id);
  }

  async function chipOnScreen(page, id) {
    await page.evaluate((itemId) => {
      window.__lahe.handle.comments.closeAll();
      window.__lahe.rail.selectTab("active");
      const node = window.__lahe.rail.cardNode(itemId);
      if (node) node.scrollIntoView({ block: "center" });
    }, id);
    return pollUntil(
      async () => {
        const info = await chip(page, id);
        return info.present && info.chipRect.width > 0 ? info : null;
      },
      { message: "the card's state chip to be on screen" }
    );
  }

  async function clickChip(page, id) {
    const info = await chipOnScreen(page, id);
    await page.mouse.click(info.chipRect.x + info.chipRect.width / 2, info.chipRect.y + info.chipRect.height / 2);
    return pollUntil(
      async () => {
        const got = await chip(page, id);
        return got.open ? got : null;
      },
      { message: "the chip's menu to open on a click" }
    );
  }

  async function expectClosedByReviewer(page, id) {
    await pollPage(
      page,
      (itemId) => {
        const item = window.__lahe.items().find((each) => each.id === itemId);
        return !!item && item.state === "handled" && item.closed_by === "reviewer";
      },
      id,
      { message: "the record to be handled and closed by the reviewer" }
    );
    await pollPage(page, (itemId) => window.__lahe.rail.getCard(itemId).pane === "done", id, {
      message: "the card to move to Done"
    });
    const card = await cardNow(page, id);
    expect(card.notice, "the Done card says who closed it").toBe("You marked this done.");
    const info = await chip(page, id);
    expect(info.label, "the chip does not say an agent handled it").toBe("Done");
    expect(info.closedBy).toBe("reviewer");
    expect(info.closeable, "a closed card has no menu").toBe(false);
    expect(info.role, "and its chip is a plain label again").toBe(null);
    const newOnDone = await page.evaluate(() => window.__lahe.rail.tabNewCount("done"));
    expect(newOnDone, "Done does not say 1 new for a card the reviewer closed").toBe(0);
  }

  async function expectOffTheDrain(id, extra) {
    const projected = await pollUntil(
      () => {
        const got = projectedItem(id);
        return got && got.state === "handled" ? got : null;
      },
      { message: "review.json to show the item handled" }
    );
    expect(projected.closed_by_reviewer, "review.json says the reviewer closed it").toBe(true);
    expect(projected.handled_not_on_page, "nothing is held").toBe(false);
    if (extra) extra(projected);
    const status = drain();
    expect(status.indexOf(id), "lahe status --json no longer lists it").toBe(-1);
  }

  async function shoot(page, id, file, dark) {
    if (dark) {
      await page.evaluate(() => {
        document.documentElement.style.background = "#14161b";
        document.body.style.background = "#14161b";
        document.body.style.color = "#e6e6e6";
        window.__lahe.rail.refreshScheme();
      });
    }
    await clickChip(page, id);
    await page.mouse.move(1, 1);
    await page.screenshot({ path: path.join(SHOTS, file) });
    await page.keyboard.press("Escape");
    await pollUntil(
      async () => {
        const got = await chip(page, id);
        return got.open ? null : got;
      },
      { message: "Escape to close the menu after the picture" }
    );
  }

  // ---------------------------------------------------------------------------

  test("a comment the agent refused is marked done from its chip, and stays done", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(world.open);
    await booted(page);

    const item = await commentOn(page, INTRO_P, COMMENT);
    expect(item, "the comment is a record").toBeTruthy();

    reply({ item: item.id, rev: item.rev, status: "not_handled", reason: "Which number do you want there?" });
    await pollPage(
      page,
      (id) => {
        const got = window.__lahe.items().find((each) => each.id === id);
        return !!got && got.state === "not_handled";
      },
      item.id,
      { message: "the refusal to fold onto the card", timeoutMs: 30000 }
    );

    // THE CHIP IS A CONTROL on an outstanding card, with the rail's tip.
    const before = await chipOnScreen(page, item.id);
    expect(before.label).toBe("Not handled");
    expect(before.closeable).toBe(true);
    expect(before.role).toBe("button");
    expect(before.tip).toBe("Mark this card as done without waiting for the agent");

    // The pictures: the menu open on an Active card, light and dark.
    fs.mkdirSync(SHOTS, { recursive: true });
    await shoot(page, item.id, "mark_done_light.png", false);
    await shoot(page, item.id, "mark_done_dark.png", true);

    // A click, and the one item.
    const open = await clickChip(page, item.id);
    expect(open.items.map((one) => one.label)).toEqual(["Mark as done"]);
    const choice = open.items[0];
    await page.mouse.click(choice.rect.x + choice.rect.width / 2, choice.rect.y + choice.rect.height / 2);

    await expectClosedByReviewer(page, item.id);
    await expectOffTheDrain(item.id, (projected) => {
      expect(projected.reply && projected.reply.status, "the agent's answer stays as history").toBe("not_handled");
    });

    // A LATE AGENT REPLY IS REFUSED, and the card does not move.
    reply({ item: item.id, rev: item.rev, status: "handled", text: "Did it anyway." });
    await pollUntil(
      () => {
        const lines = foldedLines(item.id);
        return lines.length >= 2 ? lines : null;
      },
      { message: "the late reply to be folded (and refused)", timeoutMs: 30000 }
    );
    const late = foldedLines(item.id).pop();
    expect(late.accepted, "a reply to a closed card is refused").toBe(false);
    expect(late.refusal).toContain("marked this item done");
    expect(projectedItem(item.id).closed_by_reviewer).toBe(true);
    expect((await itemNow(page, item.id)).state).toBe("handled");

    // AND A RELOAD KEEPS IT DONE.
    await page.reload();
    await booted(page);
    await expectClosedByReviewer(page, item.id);
  });

  test("a hand edit the page check held open is marked done from the keyboard", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const edit = await reviewerEdits(page, REVIEWER_WROTE);
    expect(edit, "the reviewer's retyped paragraph is a committed edit").toBeTruthy();

    // The agent says handled and the words are not on the page: held.
    reply({ item: edit.id, rev: edit.rev, status: "handled", files: ["post.md"] });
    await pollPage(
      page,
      (id) => {
        const got = window.__lahe.items().find((each) => each.id === id);
        return !!got && got.reply && got.state === "ready" && got.handled_not_on_page === true;
      },
      edit.id,
      { message: "the handled claim to be held", timeoutMs: 30000 }
    );
    expect(drain().indexOf(edit.id), "held: the drain lists it").toBeGreaterThan(-1);

    // Focus the chip, Enter opens the menu on its one item.
    await chipOnScreen(page, edit.id);
    await page.evaluate((id) => {
      window.__lahe.rail.cardNode(id).querySelector(".card__state").focus();
    }, edit.id);
    expect((await chip(page, edit.id)).focused, "the chip takes focus").toBe(true);
    await page.keyboard.press("Enter");
    let info = await chip(page, edit.id);
    expect(info.open, "Enter opens the menu").toBe(true);
    expect(info.items[0].focused, "on its item").toBe(true);

    // Escape closes it and gives focus back to the chip.
    await page.keyboard.press("Escape");
    info = await chip(page, edit.id);
    expect(info.open, "Escape closes it").toBe(false);
    expect(info.focused, "and the chip has focus again").toBe(true);

    // Space opens it too; Enter on the item closes the card.
    await page.keyboard.press("Space");
    expect((await chip(page, edit.id)).open, "Space opens it").toBe(true);
    await page.keyboard.press("Enter");

    await expectClosedByReviewer(page, edit.id);
    await expectOffTheDrain(edit.id);
    const item = await itemNow(page, edit.id);
    expect(item.handled_not_on_page, "the held claim is cleared in the browser too").toBe(false);

    await page.reload();
    await booted(page);
    await expectClosedByReviewer(page, edit.id);
  });
});
