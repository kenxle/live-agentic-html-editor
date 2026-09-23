// The reviewer's words are on the page exactly once.
//
// The report, 2026-09-22: "multiple agents have now duplicated my written
// text. i highlight and write what i want, and they just write it again above
// or below." No source file on disk had a duplicated paragraph, so the second
// copy was drawn in the page by the layer, not written by the agent.
//
// This walk is the reviewer's sequence on the real `lahe review file.md` path:
// the session, the helper, the Markdown render, the injected script line and
// the reply file are all real, and a "rebuild" is the agent rewriting the .md
// and rerunning `lahe review`, which is what the skill tells it to do.
//
// Three shapes, because the duplicate needs the after to be more than one
// paragraph and the page to carry those paragraphs as separate blocks:
//   (a) a single paragraph replacement (the control: nothing to split)
//   (b) a multi-paragraph replacement the source carries as separate <p>
//   (c) the same, where the rendered text differs from the record's by a curly
//       quote and an em dash, so the exact compare misses

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

test.describe.configure({ mode: "serial" });

const ORIGINAL = "Runners come back too fast after a layoff.";
const INTRO_P = "main > section:first-of-type > p";

// The reviewer's paragraphs. The second and third are what a duplicate shows
// up in: replay would write all three into the first block while the rebuilt
// page still carries them as blocks of their own.
const ONE = "It is becoming a common experience to have the following conversation.";
const TWO = "Human: Claude, it looks like you did not do X.";
const THREE = "Claude: You are right. Let us do that.";

// The same paragraphs as a Markdown source would come back with typographic
// punctuation: a curly apostrophe and an em dash where the reviewer typed a
// straight one and a hyphen.
const CURLY_ONE = "The builder's day is not over - it is just starting.";
const CURLY_ONE_RENDERED = "The builder’s day is not over — it is just starting.";

function markdownWith(paragraphs) {
  return ["# Debugging hell", "", "## Intro", ""]
    .concat(paragraphs.join("\n\n"))
    .concat(["", "## Premise", "", "All those days are gone.", ""])
    .join("\n");
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

test.describe("the reviewer's words land on the page once", () => {
  let world = null;

  function runReview() {
    return execFileSync(process.execPath, [CLI, "review", world.source, "--port", String(world.port)], {
      cwd: REPO_ROOT,
      env: world.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  test.beforeEach(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-no-duplicate-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const source = path.join(work, "post.md");
    fs.writeFileSync(source, markdownWith([ORIGINAL]));

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    world = { root: root, stateDir: stateDir, source: source, env: env, port: await freePort() };

    const output = runReview();
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

  function reply(itemId, rev) {
    fs.appendFileSync(
      path.join(world.reviewDir, "replies.jsonl"),
      JSON.stringify({ item: itemId, rev: rev, status: "handled", agent: "tester", files: ["post.md"] }) + "\n"
    );
  }

  /** The agent's side of a change: rewrite the .md, rerun `lahe review`. */
  function rebuild(paragraphs) {
    fs.writeFileSync(world.source, markdownWith(paragraphs));
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(world.source, later, later);
    runReview();
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

  async function openEdit(page) {
    await claim(page);
    await placeCaret(page, { selector: INTRO_P, offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, {
      message: "Cmd-Shift-E to put the Intro paragraph into edit state"
    });
  }

  async function commitEdit(page) {
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the edit"
    });
  }

  /** Select every word of the paragraph, the way a triple-click does. */
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

  /** Reload, then wait out the settling window so replay has run. */
  async function reloadAndSettle(page) {
    await page.reload();
    await booted(page);
    await pollPage(page, () => window.__lahe.counters.revertChecks >= 1, undefined, {
      message: "the page check to run once the settling window closes",
      timeoutMs: 20000
    });
    await page.evaluate(() => window.__lahe.replayNow());
  }

  /** How many times this sentence is drawn in the reviewed page. */
  function timesOnPage(page, sentence) {
    return page.evaluate((text) => {
      const words = document.querySelector("main").innerText.replace(/\s+/g, " ");
      let count = 0;
      let at = words.indexOf(text);
      while (at !== -1) {
        count += 1;
        at = words.indexOf(text, at + 1);
      }
      return count;
    }, sentence.replace(/\s+/g, " "));
  }

  /** Replace the Intro paragraph with these paragraphs, commit, return the record. */
  async function typeParagraphs(page, paragraphs) {
    await openEdit(page);
    await selectAllWords(page);
    for (let i = 0; i < paragraphs.length; i += 1) {
      if (i > 0) await page.keyboard.press("Enter");
      await page.keyboard.type(paragraphs[i], { delay: 2 });
    }
    await commitEdit(page);
    return page.evaluate(() => {
      const edit = window.__lahe.items().filter((item) => item.kind === "edit" && item.state !== "draft")[0];
      return edit ? { id: edit.id, rev: edit.rev, after: edit.after } : null;
    });
  }


  /** Keep the paragraph and add paragraphs under it, the way a reviewer appends. */
  async function appendParagraphs(page, paragraphs) {
    await openEdit(page);
    await placeCaret(page, { selector: INTRO_P, offset: ORIGINAL.length });
    for (let i = 0; i < paragraphs.length; i += 1) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(paragraphs[i], { delay: 2 });
    }
    await commitEdit(page);
    return page.evaluate(() => {
      const edit = window.__lahe.items().filter((item) => item.kind === "edit" && item.state !== "draft")[0];
      return edit ? { id: edit.id, rev: edit.rev, after: edit.after } : null;
    });
  }

  function flagged(page, id) {
    return page.evaluate((itemId) => window.__lahe.flaggedIds().indexOf(itemId) !== -1, id);
  }

  test("a single paragraph replacement lands once", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const edit = await typeParagraphs(page, [ONE]);
    expect(edit, "the replacement is a committed edit record").toBeTruthy();

    rebuild([ONE]);
    reply(edit.id, edit.rev);
    await reloadAndSettle(page);
    await reloadAndSettle(page);

    expect(await timesOnPage(page, ONE), "the reviewer's paragraph is on the page once").toBe(1);
  });

  test("a multi-paragraph replacement the source carries as separate paragraphs lands once", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const edit = await typeParagraphs(page, [ONE, TWO, THREE]);
    expect(edit.after, "the edit carries three paragraphs").toBe([ONE, TWO, THREE].join("\n\n"));

    rebuild([ONE, TWO, THREE]);
    reply(edit.id, edit.rev);
    await reloadAndSettle(page);
    await reloadAndSettle(page);

    expect(await timesOnPage(page, ONE), "the first paragraph is on the page once").toBe(1);
    expect(await timesOnPage(page, TWO), "the second paragraph is on the page once").toBe(1);
    expect(await timesOnPage(page, THREE), "the third paragraph is on the page once").toBe(1);
  });

  test("a rebuild that curls a quote and lengthens a dash still lands once", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const edit = await typeParagraphs(page, [CURLY_ONE, TWO, THREE]);
    expect(edit.after, "the edit carries three paragraphs").toBe([CURLY_ONE, TWO, THREE].join("\n\n"));

    // The agent's Markdown comes back with typographic punctuation, which is
    // the same sentence to a reader and a different string to the compare.
    rebuild([CURLY_ONE_RENDERED, TWO, THREE]);
    reply(edit.id, edit.rev);
    await reloadAndSettle(page);
    await reloadAndSettle(page);

    expect(await timesOnPage(page, TWO), "the second paragraph is on the page once").toBe(1);
    expect(await timesOnPage(page, THREE), "the third paragraph is on the page once").toBe(1);
  });

  test("paragraphs appended under an unchanged one land once", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const edit = await appendParagraphs(page, [TWO, THREE]);
    expect(edit.after, "the edit keeps the paragraph and adds two under it").toBe(
      [ORIGINAL, TWO, THREE].join("\n\n")
    );

    rebuild([ORIGINAL, TWO, THREE]);
    reply(edit.id, edit.rev);
    await reloadAndSettle(page);
    await reloadAndSettle(page);

    expect(await timesOnPage(page, TWO), "the appended paragraph is on the page once").toBe(1);
    expect(await timesOnPage(page, THREE), "the last paragraph is on the page once").toBe(1);
  });

  test("a rebuild that curls a quote and lengthens a dash lands once, and says nothing clashed", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    // The duplicate shape from the report: the first block still says what the
    // reviewer started from, so the compare reads branch two, and the write
    // puts every appended paragraph into that one block while the page still
    // carries them below.
    const edit = await appendParagraphs(page, [TWO, CURLY_ONE]);

    // The agent's Markdown comes back with typographic punctuation, which is
    // the same paragraph to a reader and a different string to the compare.
    rebuild([ORIGINAL, TWO, CURLY_ONE_RENDERED]);
    reply(edit.id, edit.rev);
    await reloadAndSettle(page);
    await reloadAndSettle(page);

    expect(await timesOnPage(page, ORIGINAL), "the unchanged paragraph is on the page once").toBe(1);
    expect(await timesOnPage(page, TWO), "the appended paragraph is on the page once").toBe(1);
    expect(await timesOnPage(page, CURLY_ONE_RENDERED), "the last paragraph is on the page once").toBe(1);
    expect(await flagged(page, edit.id), "punctuation alone is not a clash").toBe(false);
  });

  test("a rebuild that reworded the last paragraph doubles nothing", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const edit = await appendParagraphs(page, [TWO, THREE]);

    // The agent polished the reviewer's last sentence. That is a real
    // difference, and the page check reopens the item for it. What must never
    // happen is the write: all three paragraphs into the first block, leaving
    // the page saying the middle one twice.
    rebuild([ORIGINAL, TWO, THREE + " Right away."]);
    reply(edit.id, edit.rev);
    await reloadAndSettle(page);
    await reloadAndSettle(page);

    expect(await timesOnPage(page, TWO), "the appended paragraph is on the page once").toBe(1);
    expect(await timesOnPage(page, ORIGINAL), "the unchanged paragraph is on the page once").toBe(1);
  });
});
