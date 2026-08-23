// An undo the reviewer presses has to reach the helper, and a handled edit has
// to refuse to be undone at all.
//
// The bug this file exists for, found on 2026-08-23: undo reverted the region,
// dropped the record from browser storage, and told nobody. review.json still
// listed the item as ready work, so the agent applied an edit the reviewer had
// taken back and replied handled to a change that no longer existed anywhere
// except in the source file it had just been written into.
//
// The old specs could not see it. test/browser/editing_undo.spec.js and
// test/browser/edits_undo_rows.spec.js both assert the page and the rows, on a
// static fixture with no helper in the room, so "the rail forgot it" read as
// success. This one runs the real `lahe review` walk: a real helper, a real
// per-review token, a real projection on disk, and the agent's whole API (one
// appended JSONL line).
//
// Two claims, and they are opposite halves of the same rule:
//
//   an unhandled edit    undo reverts the page, drops the record, and the item
//                        leaves review.json. Nobody is asked to do it.
//   a handled edit       undo refuses. The agent already changed the SOURCE, so
//                        reverting the block here would change this page and
//                        nothing else, the next rebuild would bring the change
//                        back, and the record that says a fix landed would be
//                        gone (R38). lifecycle.canDelete says the same thing,
//                        and this is the first production code to ask it.

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

test.describe("an undo reaches the helper, and a handled edit is not undone", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-undo-helper-"));
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

  test.afterAll(async () => {
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
  });

  /** The page as the source stands: every test starts from the same document. */
  function reset() {
    fs.writeFileSync(world.pagePath, docHtml());
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(world.pagePath, later, later);
  }

  /** The projection the agent reads, or null while it has not been written yet. */
  function projection() {
    const file = path.join(world.reviewDir, "review.json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  function projectedItem(parsed, id) {
    if (!parsed) return null;
    let found = null;
    parsed.pages.forEach((pg) => {
      pg.items.forEach((it) => {
        if (it.id === id) found = it;
      });
    });
    return found;
  }

  /** One appended JSON line, which is everything an agent is allowed to do. */
  function appendReply(fields) {
    fs.appendFileSync(path.join(world.reviewDir, "replies-claude.jsonl"), JSON.stringify(fields) + "\n");
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

  /** Cmd-Shift-E, type at the end of the block, Esc. The reviewer's own path. */
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
    const list = await page.evaluate(() => window.__lahe.items());
    expect(list, "the edit is one record").toHaveLength(1);
    expect(list[0].state).toBe("ready");
    return list[0];
  }

  /** The item as it stands in the projection, waited for rather than assumed. */
  async function inReviewJson(id) {
    return pollUntil(() => projectedItem(projection(), id), {
      message: "the edit to reach review.json",
      timeoutMs: 20000
    });
  }

  function blockText(page) {
    return page.evaluate(() => document.getElementById("p").textContent);
  }

  test("an undone edit leaves review.json, not just the rail", async ({ page }) => {
    reset();
    await booted(page);

    const item = await editAndCommit(page);
    expect(await blockText(page)).toBe(EDITED);

    // It is the agent's work now: ready, in the file the agent reads.
    const projected = await inReviewJson(item.id);
    expect(projected.state).toBe("ready");

    // The reviewer changes their mind. This is the call the Edits row's Undo
    // button makes (test/browser/edits_undo_rows.spec.js presses the button
    // itself); what is under test here is what happens after it.
    const result = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), item.id);
    expect(result.reverted, result.reason || "undo reverted the record").toBe(true);

    // The page is back, and so is the rail.
    expect(await blockText(page)).toBe(ORIGINAL);
    expect(await page.evaluate(() => window.__lahe.items())).toHaveLength(0);
    expect(await page.evaluate(() => window.__lahe.cardIds())).toHaveLength(0);

    // And the helper heard, which is the whole bug. An item left in review.json
    // after the browser dropped it is work the agent would do that nobody is
    // asking for.
    await pollUntil(() => (projectedItem(projection(), item.id) ? null : true), {
      message: "the undone edit to leave review.json",
      timeoutMs: 20000
    });
    const after = projection();
    expect(projectedItem(after, item.id), "the agent is not asked to apply an edit that was taken back").toBe(null);
  });

  test("a handled edit is not undone here: the agent already changed the source", async ({ page }) => {
    reset();
    await booted(page);

    const item = await editAndCommit(page);
    await inReviewJson(item.id);

    // The agent's whole API: one appended line saying it made the change.
    appendReply({ item: item.id, rev: item.rev, status: "handled", agent: "claude" });
    await pollPage(
      page,
      (id) => {
        const found = window.__lahe.itemById(id);
        return !!found && found.state === "handled";
      },
      item.id,
      { message: "the reply to fold onto the card through the poll loop", timeoutMs: 20000 }
    );

    // The row still lists the edit, and its Undo now says why it cannot run.
    // The rail lives in a closed shadow root, so the card node is the way in.
    const undoButton = (id) => {
      const node = window.__lahe.rail.cardNode(id);
      const root = node ? node.getRootNode() : null;
      const found =
        root && root.querySelector
          ? root.querySelector('[data-lahe-edit-row="' + id + '"] [data-lahe-act="undo"]')
          : null;
      return found ? { disabled: !!found.disabled, title: found.title } : null;
    };
    await pollPage(
      page,
      (id) => {
        const node = window.__lahe.rail.cardNode(id);
        const root = node ? node.getRootNode() : null;
        const found =
          root && root.querySelector
            ? root.querySelector('[data-lahe-edit-row="' + id + '"] [data-lahe-act="undo"]')
            : null;
        return !!found && found.disabled === true;
      },
      item.id,
      { message: "the Undo button on the handled row to go quiet", timeoutMs: 20000 }
    );
    const button = await page.evaluate(undoButton, item.id);
    expect(button.title, "the button says why, rather than offering a press that only ever fails").toMatch(
      /already handled/
    );

    // Pressed anyway (the console is a reviewer's path too), it refuses without
    // touching the page.
    const result = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), item.id);
    expect(result.reverted).toBe(false);
    expect(result.reason).toMatch(/already handled/);
    expect(await blockText(page), "the block still reads as the agent left it").toBe(EDITED);

    // And the record that says a fix landed is still in both stores (R38).
    expect(await page.evaluate((id) => !!window.__lahe.itemById(id), item.id)).toBe(true);
    const projected = projectedItem(projection(), item.id);
    expect(projected, "a handled item is kept, not deleted").toBeTruthy();
    expect(projected.state).toBe("handled");
  });
});
