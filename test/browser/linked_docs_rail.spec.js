// Following a link keeps the editor.
//
// Spec: docs/features/20260922.02_linked_docs_rail/01_spec_linked_docs_rail.md.
// A reviewed Markdown hub links to documents in another folder. Before this,
// clicking one landed on a read-only copy with no rail. Now:
//
//  - a linked document with no review of its own carries the hub's rail, and a
//    comment there lands in the hub's review naming the linked file on disk
//  - a linked document with its own review in this session opens that review's
//    own page, where its earlier comments live
//  - nothing is created by the click
//
// Nothing is simulated: the real `lahe review` walk, the real helper, the real
// static server, and real clicks on the rendered links.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil } = require("../helpers");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const SPEC_FOLDER = path.join(REPO_ROOT, "docs", "features", "20260922.02_linked_docs_rail");

const SAID_ON_DRAFT = "The write-cost numbers need a source.";

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

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag",
    timeoutMs: 20000
  });
}

test.describe("a link out of a reviewed Markdown page keeps the rail", () => {
  test.describe.configure({ mode: "serial" });
  let world = null;

  test.beforeAll(async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-linked-rail-")));
    const stateDir = path.join(root, "state");
    const home = path.join(root, "home");
    fs.mkdirSync(path.join(home, "audit"), { recursive: true });
    fs.mkdirSync(path.join(home, "specs"), { recursive: true });
    const hub = path.join(home, "audit", "hub.md");
    const draft = path.join(home, "specs", "write-cost.md");
    const owned = path.join(home, "specs", "owned.md");
    fs.writeFileSync(hub, [
      "# Memory audit hub",
      "",
      "- [Draft write-cost spec](../specs/write-cost.md)",
      "- [A spec with its own review](../specs/owned.md)",
      ""
    ].join("\n"));
    fs.writeFileSync(draft, [
      "# Draft write-cost spec",
      "",
      "Every write costs one fsync, measured on the reviewer's own machine.",
      ""
    ].join("\n"));
    fs.writeFileSync(owned, "# Owned spec\n\nThis document already has a review.\n");

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir, LAHE_HOME_DIR: home });
    delete env.XDG_STATE_HOME;
    const port = await freePort();
    const run = (args) => execFileSync(process.execPath, [CLI].concat(args), {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const ownedOut = run(["review", owned, "--port", String(port)]);
    const session = labelled(ownedOut, "session");
    const ownedReview = labelled(ownedOut, "review");
    const hubOut = run(["review", hub, "--session", session, "--port", String(port)]);
    const hubReview = labelled(hubOut, "review");
    const open = labelled(hubOut, "open");
    const folder = labelled(hubOut, "folder");
    expect(session).toBeTruthy();
    expect(hubReview).toBeTruthy();
    expect(ownedReview).toBeTruthy();
    expect(hubReview).not.toBe(ownedReview);
    world = { root, stateDir, env, session, hubReview, ownedReview, open, folder, draft, run };
  });

  test.afterAll(async () => {
    if (!world) return;
    try {
      world.run(["session", "close", world.session]);
    } catch (err) {
      // A session that already went down is not a test failure.
    }
    // The close leaves the helper up while the page is open. Stop it.
    await stopTempHelpers(world.stateDir);
  });

  test("a linked document with no review rides the hub's review, and a comment there names its file", async ({ page }) => {
    const reviewsBefore = fs.readdirSync(path.join(world.stateDir, "reviews")).sort();
    await page.goto(world.open);
    await booted(page);
    expect(await page.evaluate(() => window.__lahe.review)).toBe(world.hubReview);

    await page.click("text=Draft write-cost spec");
    await page.waitForURL(/\/\.lahe-source\/[a-f0-9]+\/write-cost\.md$/);
    await booted(page);
    expect(await page.evaluate(() => window.__lahe.review), "the linked page carries the hub's rail").toBe(world.hubReview);
    await expect(page.locator(".lahe-readonly-note")).toHaveCount(0);

    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("main p")).find((p) => /one fsync/.test(p.textContent));
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
      message: "the comment box to open on the passage"
    });
    await page.keyboard.type(SAID_ON_DRAFT);
    await page.keyboard.press("ControlOrMeta+Enter");
    await pollPage(
      page,
      (note) => window.__lahe.items().some((item) => item.note === note && item.state === "ready"),
      SAID_ON_DRAFT,
      { message: "the comment to be ready" }
    );

    const reviewJson = path.join(world.folder, "review.json");
    let group = null;
    await pollUntil(
      () => {
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(reviewJson, "utf8"));
        } catch (err) {
          return false;
        }
        group = (parsed.pages || []).find((p) => (p.items || []).some((item) => item.note === SAID_ON_DRAFT)) || null;
        return !!group;
      },
      { timeoutMs: 20000, message: "the comment to reach the hub's review.json" }
    );
    expect(group.linked_file, "the helper named the linked file on disk").toBe(world.draft);
    expect(group.source_hint.path).toBe(world.draft);
    expect(fs.readdirSync(path.join(world.stateDir, "reviews")).sort(), "no review was created by the click").toEqual(reviewsBefore);

    await page.screenshot({ path: path.join(SPEC_FOLDER, "linked_page_rail.png") });
  });

  test("a linked document with its own review opens that review's page", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);
    await page.click("text=A spec with its own review");
    await page.waitForURL(/owned-[a-f0-9]+\.html$/);
    await booted(page);
    expect(await page.evaluate(() => window.__lahe.review), "its own review, not the hub's").toBe(world.ownedReview);
  });
});
