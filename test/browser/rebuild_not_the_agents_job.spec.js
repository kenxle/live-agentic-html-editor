// The rebuild is not the agent's job, and a handled claim is checked.
//
// The report, 2026-09-23: "i just had a really annoying set of edits where i
// made the same edit like 3 times and every refresh reverted it, and when i
// asked about it the ai said the browser had some kind of cache issue because
// they did a source edit. but i think they're just not doing the rebuild. this
// needs to not be a failure mode at all. we cannot rely on the llm to remember
// to rebuild."
//
// Two tests, one for each half, both on the real `lahe review file.md` walk:
// the session, the helper, the static server, the Markdown render, the injected
// script line and the reply file are all the real ones.
//
//  1. The agent edits the .md and reruns NOTHING. The page reloads onto the new
//     render by itself, and the reviewer's own edit is still there afterwards.
//     Before this, the artifact never moved, so the page never reloaded.
//  2. The agent replies handled without touching the file at all. The item does
//     not retire, and the card says the change is not on the page.
//
// The screenshot in docs/features/20260923.01_rebuild_not_the_agents_job comes
// from this spec's second test.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const SHOTS = path.join(REPO_ROOT, "docs", "features", "20260923.01_rebuild_not_the_agents_job");

test.describe.configure({ mode: "serial" });

const ORIGINAL = "Runners come back too fast after a layoff.";
const REVIEWER_WROTE = "Runners come back too fast after a layoff, and week three is where it shows.";
const AGENT_WROTE = "The agent rewrote this paragraph in the Markdown and reran nothing.";
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

test.describe("LAHE rebuilds the page, and a handled claim is checked", () => {
  let world = null;

  test.beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-rebuild-walk-"));
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
    world = null;
  });

  /** The agent's whole contribution: write the .md. No review command, no build. */
  function editTheMarkdownOnly(paragraph) {
    fs.writeFileSync(world.source, markdownWith(paragraph));
    // A filesystem with coarse timestamps can give two quick writes the same
    // one, and the mtime is the signal. Stamping it forward makes the change
    // unambiguous rather than probable.
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(world.source, later, later);
  }

  function reply(itemId, rev) {
    fs.appendFileSync(
      path.join(world.reviewDir, "replies.jsonl"),
      JSON.stringify({ item: itemId, rev: rev, status: "handled", agent: "tester", files: ["post.md"] }) + "\n"
    );
  }

  function itemsFromReviewJson() {
    const file = path.join(world.reviewDir, "review.json");
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return (parsed.pages || []).reduce(function (all, page) {
      return all.concat(page.items || []);
    }, []);
  }

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

  /** Select every word of the intro paragraph, the way a triple-click does. */
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

  /** The reviewer's own hand edit: open the paragraph, retype it, commit. */
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

  test("the agent edits the Markdown and reruns nothing, and the page follows", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);
    await expect(page.locator(INTRO_P)).toContainText(ORIGINAL);

    const edit = await reviewerEdits(page, REVIEWER_WROTE);
    expect(edit, "the reviewer's retyped paragraph is a committed edit").toBeTruthy();

    // THE WHOLE POINT. The .md changes and nothing else happens: no review
    // command is rerun, no build, and nobody touches the browser.
    editTheMarkdownOnly(AGENT_WROTE);

    await pollPage(page, (text) => document.body.innerText.indexOf(text) !== -1, AGENT_WROTE, {
      message: "the page to re-render and reload itself onto the agent's Markdown edit",
      timeoutMs: 30000
    });
    await booted(page);

    // The reload is only safe because the reviewer's work comes back with it.
    await pollPage(
      page,
      (text) => window.__lahe.items().some((item) => item.after === text),
      REVIEWER_WROTE,
      { message: "the reviewer's edit to survive the reload", timeoutMs: 30000 }
    );
    expect(
      fs.readFileSync(world.source, "utf8").indexOf(AGENT_WROTE),
      "and the Markdown on disk is untouched by any of this except the agent's own write"
    ).toBeGreaterThan(-1);
  });

  test("a handled reply the page does not bear out leaves the item open, and says so", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const edit = await reviewerEdits(page, REVIEWER_WROTE);
    expect(edit, "the reviewer's retyped paragraph is a committed edit").toBeTruthy();

    // The agent answers without touching the file. This is the exact shape of
    // the reported failure, minus the part where the item quietly retires.
    reply(edit.id, edit.rev);

    await pollPage(
      page,
      (id) => {
        const item = window.__lahe.items().filter((each) => each.id === id)[0];
        return !!item && item.reply && item.state === "ready";
      },
      edit.id,
      { message: "the reply to fold without retiring the item", timeoutMs: 30000 }
    );

    // The reviewer's sentence, on the card, in their terms. The rail lives in a
    // closed shadow root, so the card's own model is what a test can read.
    await pollPage(page, (id) => window.__lahe.rail.getCard(id).notice !== null, edit.id, {
      message: "the card to say the change has not reached the page",
      timeoutMs: 20000
    });
    const notice = await page.evaluate((id) => window.__lahe.rail.getCard(id).notice, edit.id);
    expect(notice).toContain("the change is not on your page");
    expect(notice, "and it does not explain the tool to them").not.toContain("render");
    expect(notice, "or the build").not.toContain("rebuild");

    // And the same fact where the agent reads it.
    const projected = itemsFromReviewJson().filter((item) => item.id === edit.id)[0];
    expect(projected, "the item is in review.json").toBeTruthy();
    expect(projected.state, "it is still ready").toBe("ready");
    expect(projected.handled_not_on_page, "and it carries the finding").toBe(true);

    const status = execFileSync(
      process.execPath,
      [CLI, "status", "--session", world.session, "--json", "--quiet"],
      { cwd: REPO_ROOT, env: world.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    expect(status.indexOf(edit.id), "the drain lists it again").toBeGreaterThan(-1);
    expect(status.indexOf("handled_not_on_page"), "and says why").toBeGreaterThan(-1);

    // The picture, light and dark, of the one thing this change draws. A hand
    // edit's card lives on the Edits tab, so that is the tab the screenshot is
    // of, and the note composer the edit gesture left open is closed first so
    // the picture is of the card rather than of an empty box beside it.
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => {
      window.__lahe.handle.comments.closeAll();
      window.__lahe.rail.selectTab("edits");
    });
    // Taller than the default, because the notice is drawn at the foot of the
    // card and the default viewport cuts the card off above it. A screenshot
    // that does not show the sentence is not a screenshot of this change.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.mouse.move(1100, 500);
    await page.mouse.wheel(0, 600);
    // One picture, not two. The rail and the document style have no dark
    // variant: there is no prefers-color-scheme rule in either, so a dark
    // screenshot would be the light one under a different filename.
    await page.screenshot({ path: path.join(SHOTS, "card_not_on_page.png") });
  });
});
