// A break the reviewer types survives: the record keeps it, the page keeps it,
// and a rebuild that applies it does not lose the item.
//
// Reported live on 2026-08-20: "when I edit a paragraph and just insert a line
// break somewhere that I want it, it looks like it keeps it and then some edit
// later reverts it."
//
// Both halves of that sentence were real, and they were two different bugs.
//
//   it keeps it        Chromium writes Enter inside a contenteditable <p> as
//                      "Hello<p>&nbsp;world.</p>". The block LOOKS split. Read
//                      through textContent it says "Hello world.", exactly what
//                      it said before, so the commit compared equal to its own
//                      before text and the whole edit was thrown away as a
//                      no-op. Nothing was ever recorded.
//   then it reverts    replay wrote an edit back with element.textContent,
//                      which flattens the block to one line on the next pass.
//
// Nothing here is simulated: it is the real `lahe review` walk, so the session,
// the helper, the static server, the injected script line and the reply file
// are the real ones, and the "agent" splits the source file the way an agent
// would.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil, placeCaret } = require("../helpers");
const record = require("../../src/shared/record.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

test.describe.configure({ mode: "serial" });

const FIRST = "Runners come back too fast after a layoff.";
const SECOND = "Most of them know it while they are doing it.";
const ONE_PARAGRAPH = FIRST + " " + SECOND;
// What the reviewer means by pressing Enter in front of "Most": two paragraphs.
const SPLIT = FIRST + "\n\n" + SECOND;
const TAIL = "A second thought, typed after the break.";

function docHtml(body, scriptLine) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Steady Pace</title></head>',
    "<body>",
    "<main>",
    '<section id="split">' + body + "</section>",
    '<p id="other">The first two weeks feel easy and the third week hurts.</p>',
    "</main>",
    scriptLine,
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

function onePara(text) {
  return '<p id="p">' + text + "</p>";
}

function twoParas(first, second) {
  return '<p id="p">' + first + '</p>\n<p id="p2">' + second + "</p>";
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

test.describe("a paragraph break the reviewer types is kept", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-paragraph-break-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const pagePath = path.join(work, "doc.html");
    fs.writeFileSync(pagePath, docHtml(onePara(ONE_PARAGRAPH), ""));

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
    expect(open, "`lahe review` printed the URL its own server publishes the page at").toBeTruthy();

    // The WHOLE tag, not its first line: the walk writes it across several
    // lines, and a rebuild that puts half of it back leaves a page that never
    // boots the layer.
    const injected = fs.readFileSync(pagePath, "utf8");
    const scriptLine = /<script[^>]*lahe-layer\.js[\s\S]*?<\/script>/.exec(injected);
    expect(scriptLine, "the walk wrote the library's script line into the page").toBeTruthy();

    world = {
      root: root,
      stateDir: stateDir,
      pagePath: pagePath,
      env: env,
      session: session,
      review: review,
      open: open,
      scriptLine: scriptLine[0],
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

  /** A build: the source is rewritten and the page reloads itself off it. */
  function rebuild(body) {
    fs.writeFileSync(world.pagePath, docHtml(body, world.scriptLine));
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(world.pagePath, later, later);
  }

  function reset() {
    rebuild(onePara(ONE_PARAGRAPH));
  }

  async function booted(page) {
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its own script tag",
      timeoutMs: 20000
    });
  }

  async function claim(page) {
    if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
      await page.evaluate(() => window.__lahe.handle.sync.takeover());
      await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "this window to take over the retained review"
      });
    }
  }

  /** Cmd-Shift-E, caret where the reviewer put it, Enter, Esc. */
  async function breakAt(page, offset, typed) {
    await claim(page);
    await placeCaret(page, { selector: "#p", offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, {
      message: "Cmd-Shift-E to put #p into edit state"
    });
    await placeCaret(page, { selector: "#p", offset: offset });
    await page.keyboard.press("Enter");
    if (typed) await page.keyboard.type(typed, { delay: 5 });
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the edit"
    });
  }

  function items(page) {
    return page.evaluate(() => window.__lahe.items());
  }

  /** The break as the page itself reads it, through the one normalizer. */
  function pageBlockText(page, selector) {
    return page.evaluate((sel) => window.LAHE.normalize.blockTextFromNode(document.querySelector(sel)), selector);
  }

  test("Enter in the middle of a paragraph is recorded as a paragraph break", async ({ page }) => {
    reset();
    await page.goto(world.open);
    await booted(page);

    await breakAt(page, ONE_PARAGRAPH.indexOf(SECOND), null);

    const list = await items(page);
    expect(list, "the split is one record, not a discarded no-op").toHaveLength(1);
    const item = list[0];
    expect(item.kind).toBe("edit");
    expect(item.state).toBe("ready");
    // The record says there are two paragraphs, in the shape the agent reads.
    expect(item.after).toBe(SPLIT);
    expect(item.after.includes("\n\n"), "a paragraph break is a blank line").toBe(true);
    expect(item.before).toBe(ONE_PARAGRAPH);
    // And the intent field says what the reviewer did, in words.
    expect(item.change).toBe(record.BREAK_ADDED_PARAGRAPH);

    // Through the projection the agent actually reads. It is written when the
    // record reaches the helper, so it is waited for rather than assumed.
    const reviewJson = await pollUntil(
      () => {
        const file = path.join(world.reviewDir, "review.json");
        if (!fs.existsSync(file)) return null;
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        const has = parsed.pages.some((pg) => pg.items.some((it) => it.id === item.id));
        return has ? parsed : null;
      },
      { message: "the split to reach review.json", timeoutMs: 20000 }
    );
    const projected = reviewJson.pages[0].items.find((it) => it.id === item.id);
    expect(projected, "the item reached review.json").toBeTruthy();
    expect(projected.after_full).toBe(SPLIT);
    // The contract tells the agent what a blank line means in a Markdown source.
    expect(reviewJson.contract.join("\n")).toContain("A break the reviewer typed is part of the edit");
  });

  test("the break is still there after the passes that used to flatten it", async ({ page }) => {
    reset();
    await page.goto(world.open);
    await booted(page);

    await breakAt(page, ONE_PARAGRAPH.indexOf(SECOND), null);
    const item = (await items(page))[0];

    // The page moves under the tool, which is what makes replay run: this is
    // the "some edit later" in the report. Five passes, and the block still
    // reads as two paragraphs.
    const before = await page.evaluate(() => window.__lahe.counters.replayPasses);
    await page.evaluate(() => {
      const other = document.querySelector("#other");
      for (let i = 0; i < 5; i += 1) other.textContent = "The first two weeks feel easy. " + i;
    });
    await pollPage(page, (was) => window.__lahe.counters.replayPasses > was, before, {
      message: "a replay pass to run over the committed edit",
      timeoutMs: 20000
    });

    expect(await pageBlockText(page, "#split"), "the block still reads as two paragraphs").toBe(SPLIT);
    const after = (await items(page)).find((it) => it.id === item.id);
    expect(after.after, "and the record still says so").toBe(SPLIT);
    expect(after.region.lost, "the item is not lost on a page it is looking straight at").toBeNull();
    expect(await page.evaluate(() => window.__lahe.flaggedIds()), "and nothing is flagged as a collision").toEqual(
      []
    );
  });

  test("Enter at the end and a typed sentence is recorded as a second paragraph", async ({ page }) => {
    reset();
    await page.goto(world.open);
    await booted(page);

    await breakAt(page, ONE_PARAGRAPH.length, TAIL);

    const item = (await items(page))[0];
    expect(item.after).toBe(ONE_PARAGRAPH + "\n\n" + TAIL);
    expect(item.change, "the change line names the break and the words").toContain(record.BREAK_ADDED_PARAGRAPH);
    expect(item.change).toContain(TAIL);
    expect(await pageBlockText(page, "#split")).toBe(ONE_PARAGRAPH + "\n\n" + TAIL);
  });

  test("Enter at the end with nothing after it changes nothing, and is not recorded", async ({ page }) => {
    reset();
    await page.goto(world.open);
    await booted(page);

    // A trailing empty paragraph is not a change to the document: there is no
    // second paragraph, only an empty one. Recording it would put a row in the
    // rail and a line in the agent's queue for a change that does not exist.
    await breakAt(page, ONE_PARAGRAPH.length, null);
    expect(await items(page), "an empty trailing break is not an edit").toHaveLength(0);
  });

  test("the item survives the rebuild that applies the split", async ({ page }) => {
    reset();
    await page.goto(world.open);
    await booted(page);

    // The reload is driven off the file's mtime, so the baseline poll has to
    // have happened before the rebuild, or the rebuild IS the baseline.
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime",
      timeoutMs: 20000
    });

    await breakAt(page, ONE_PARAGRAPH.indexOf(SECOND), null);
    const item = (await items(page))[0];

    // What a correct agent does with that record: a blank line in the source,
    // which rebuilds as two paragraphs. The page reloads itself onto it.
    rebuild(twoParas(FIRST, SECOND));
    await pollPage(page, (text) => document.querySelector("#p2") && document.querySelector("#p2").textContent === text, SECOND, {
      message: "the page to reload itself onto the split source",
      timeoutMs: 20000
    });
    await booted(page);

    // The break is on the page, in the source's own shape.
    expect(await pageBlockText(page, "#split")).toBe(SPLIT);

    // And the item is not lost: the passage it points at still exists, it is
    // just spelled as two blocks now.
    await pollPage(page, () => window.__lahe.counters.replayPasses > 0, undefined, {
      message: "a replay pass over the rebuilt page",
      timeoutMs: 20000
    });
    const settled = (await items(page)).find((it) => it.id === item.id);
    expect(settled, "the record survived the reload").toBeTruthy();
    expect(settled.region.lost, "the split passage is not reported lost after the rebuild").toBeNull();
    expect(await page.evaluate(() => window.__lahe.flaggedIds())).toEqual([]);
    // Nothing wrote the paragraph back together.
    expect(await pageBlockText(page, "#split")).toBe(SPLIT);
  });
});
