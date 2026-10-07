// Flow walk fail 1 (docs/features/20260928.01_free_writing/reviews_impl/
// flow_walk.md): undo after a page reload never reached the helper.
//
// The walker committed a run, the page reloaded, and Undo on the card took the
// words off the page. No item.deleted reached the helper, so the item stayed
// ready on the agent's drain, and an agent following the contract put back
// words the writer had taken out. The cause was sync's `seenItems`: it is
// in-memory, so after a reload every item the helper held looked never-sent,
// and the delete was skipped as "a line that means nothing".
//
// This runs the real `lahe review` walk, like undo_reaches_helper.spec.js,
// with a reload between the commit and the undo, and a second reload after
// it, so the removal is shown to survive.

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

test.describe.configure({ mode: "serial" });

const ORIGINAL = "Runners come back too fast after a layoff.";
const NEW_BLOCK = "A new paragraph the reviewer wrote and then took back.";

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

test.describe("free writing: undo after a reload reaches the helper", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-undo-reload-"));
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
    world = {
      stateDir: stateDir,
      env: env,
      session: labelled(output, "session"),
      review: labelled(output, "review"),
      open: labelled(output, "open")
    };
    world.reviewDir = path.join(stateDir, "reviews", world.review);
    expect(world.open).toBeTruthy();
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
      // Already down is not a failure.
    }
    // The close leaves the helper up while the page is open. Stop it.
    await stopTempHelpers(world.stateDir);
  });

  function projected(id) {
    const file = path.join(world.reviewDir, "review.json");
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    let found = null;
    parsed.pages.forEach((pg) => {
      pg.items.forEach((it) => {
        if (it.id === id) found = it;
      });
    });
    return found;
  }

  async function booted(page) {
    await page.goto(world.open);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot",
      timeoutMs: 20000
    });
    if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
      await page.evaluate(() => window.__lahe.handle.sync.takeover());
      await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "this window to take over the review"
      });
    }
  }

  test("a run committed, reloaded, then undone leaves review.json and stays gone", async ({ page }) => {
    await booted(page);
    await placeCaret(page, { selector: "#p", offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "Cmd-Shift-E" });
    await placeCaret(page, { selector: "#p", offset: ORIGINAL.length });
    await page.keyboard.press("Enter");
    await page.keyboard.type(NEW_BLOCK, { delay: 5 });
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "Esc to commit" });
    const list = await page.evaluate(() => window.__lahe.items());
    expect(list).toHaveLength(1);
    const item = list[0];
    await pollUntil(() => projected(item.id), { message: "the run to reach review.json", timeoutMs: 20000 });

    // The reload the walker saw: this page's in-memory sync state is gone.
    await booted(page);
    await pollPage(page, (id) => !!window.__lahe.itemById(id), item.id, { message: "the record back after reload" });
    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), item.id);
    expect(res.reverted, res.reason || "undo reverted").toBe(true);
    expect(await page.evaluate(() => document.body.textContent.indexOf("took back") === -1)).toBe(true);

    await pollUntil(() => (projected(item.id) ? null : true), {
      message: "the undone run to leave review.json after a reload",
      timeoutMs: 20000
    });

    // And it stays gone: another reload re-posts nothing that brings it back.
    await booted(page);
    await page.evaluate(() => window.__lahe.handle.sync.flush({ force: true }));
    expect(projected(item.id), "the agent is not asked to place words the writer took back").toBe(null);
    expect(await page.evaluate(() => document.body.textContent.indexOf("took back") === -1)).toBe(true);
  });
});
