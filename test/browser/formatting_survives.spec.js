// The reviewer's bold and italic survive a rebuild that dropped them.
//
// The incident, review r198259e39417 on 2026-09-11. Ken rewrote a paragraph and,
// in the same revision, made one word italic and a closing clause bold. The
// record carried both: `after` held the plain words and `after_html` held the
// <em> and the <strong>. The agent's source was Markdown; it applied the words
// alone and replied handled three times, saying so itself at the fourth
// revision: "they came through in the HTML form of the edit and I applied only
// the text." The rebuilt page came back with the right words in plain type.
//
// Nothing caught it. Replay compared the record's after TEXT to the block,
// found it equal, called the block idempotent and wrote nothing. The page check
// compares text too, so it did not reopen. The italics and the bold were gone
// from the page and from the source and nothing anywhere said so; Ken had to
// notice and complain.
//
// Both halves are asserted here, and so is the negative:
//
//   dropped    the words land without the <em>: replay writes the markup back,
//              and the page check reopens the item ONCE with its own sentence
//   carried    the rebuild keeps the <em>: nothing is written and the item
//              stays handled
//
// Nothing is simulated. This is the real `lahe review` walk, so the session,
// the helper, its server, the injected script line, the reply file and the wake
// feed are all real, and a "rebuild" is a rewrite of the source file, which is
// what a rebuild actually is.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

// One walk, one helper, one session. Serial because the file is one story.
test.describe.configure({ mode: "serial" });

// The check's formatting sentence, restated so the browser test asserts the
// reviewer's own copy of it rather than importing the layer.
const FORMAT_SENTENCE =
  "Reopened by the page check: the words landed but the bold or italic in this edit did not. " +
  "Carry the formatting into the source, or reply not_handled saying why.";

const P_BEFORE = "The trainer writes the plan every week.";
// What the reviewer retypes, then italicizes one word of.
const P_AFTER = "The coach drafts the plan each week.";
const ITALIC_WORD = "drafts";
const P_AFTER_PLAIN_HTML = P_AFTER;
const P_AFTER_ITALIC_HTML = "The coach <em>drafts</em> the plan each week.";

// `stamp` is the data-lahe-id the reviewer's page wrote onto the paragraph. An
// agent that edits the source is asked to carry it across, so a rebuild that
// stands in for a well-behaved agent writes it back (S7).
function docHtml(p, stamp) {
  const id = stamp ? ' data-lahe-id="' + stamp + '"' : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Steady Pace</title></head>',
    "<body>",
    "<main>",
    '<p id="p"' + id + ">" + p + "</p>",
    '<p id="q">Runners come back too fast after a layoff.</p>',
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

test.describe("an edit's bold and italic survive the rebuild that dropped them", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-formatting-survives-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const pagePath = path.join(work, "doc.html");
    fs.writeFileSync(pagePath, docHtml(P_BEFORE));

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

  /** The agent's whole API: one appended JSON line. */
  function reply(itemId, rev) {
    fs.appendFileSync(
      path.join(world.reviewDir, "replies.jsonl"),
      JSON.stringify({ item: itemId, rev: rev, status: "handled", agent: "tester", files: ["doc.html"] }) + "\n"
    );
  }

  /** A build: the source is rewritten, and the page reloads itself off it. */
  function rebuild(p, stamp) {
    fs.writeFileSync(world.pagePath, docHtml(p, stamp));
    // The mtime is the reload signal, and a coarse-timestamp filesystem can
    // give two quick writes the same one.
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(world.pagePath, later, later);
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

  function blockHtml(page, id) {
    return page.evaluate((blockId) => document.getElementById(blockId).innerHTML, id);
  }

  function itemState(page, itemId) {
    return page.evaluate((id) => {
      const found = window.__lahe.items().find((item) => item.id === id);
      return found ? { state: found.state, note: found.note, rev: found.rev } : null;
    }, itemId);
  }

  /**
   * The reviewer's gesture, both halves in one revision: retype the paragraph,
   * then select one word of what they typed and italicize it. That is the shape
   * of the incident, and it is what makes the record an `edit` whose markup
   * says more than its text does.
   */
  async function handEditWithItalic(page, blockId) {
    await claim(page);
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
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, blockId);
    await page.keyboard.type(P_AFTER, { delay: 5 });

    // Select the one word and press italic, the way the frame's own I button
    // does. The bar lives in a closed shadow root; this is the same call it
    // makes, on a selection made the way a reviewer makes one.
    const italicized = await page.evaluate(
      ([id, word]) => {
        const el = document.getElementById(id);
        const node = el.firstChild;
        const at = node.data.indexOf(word);
        if (at === -1) return false;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return window.__lahe.handle.editing.format("italic").applied;
      },
      [blockId, ITALIC_WORD]
    );
    expect(italicized, "the italic button did something").toBe(true);

    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the hand edit on #" + blockId
    });

    await pollPage(
      page,
      (text) => !!window.__lahe.items().find((item) => item.kind === "edit" && item.after === text),
      P_AFTER,
      { message: "the hand edit to land as a ready edit record" }
    );
    return page.evaluate((text) => {
      const found = window.__lahe.items().find((item) => item.kind === "edit" && item.after === text);
      return { id: found.id, rev: found.rev, after: found.after, afterHtml: found.after_html, change: found.change };
    }, P_AFTER);
  }

  test("the words without the italic: replay puts it back and the check reopens the item once", async ({
    page
  }) => {
    await page.goto(world.open);
    await booted(page);

    const made = await handEditWithItalic(page, "p");

    // THE RECORD CARRIED IT, which was never the problem.
    expect(made.after, "the after text is the plain words").toBe(P_AFTER);
    expect(made.afterHtml, "and the markup is the words with the reviewer's italic").toContain("<em>");
    // AND THE CHANGE SENTENCE SAYS IT, which was the problem.
    expect(made.change, "the one intent line names the italic").toContain('Made "' + ITALIC_WORD + '" italic.');

    // What the agent did: carried the words into the source and not the
    // emphasis, then replied handled.
    rebuild(P_AFTER_PLAIN_HTML);
    reply(made.id, made.rev);
    await pollPage(
      page,
      (id) => {
        const found = window.__lahe.items().find((item) => item.id === id);
        return !!found && found.state === "handled";
      },
      made.id,
      { message: "the agent's reply to fold and move the item to Done", timeoutMs: 20000 }
    );

    // The reviewer's page reloads onto the rebuilt file.
    await page.reload();
    await booted(page);

    // REPLAY PUTS THE ITALIC BACK. The words are right, so the text comparison
    // calls this idempotent; the markup comparison does not.
    await pollPage(page, () => document.getElementById("p").innerHTML.indexOf("<em>") !== -1, undefined, {
      message: "replay to write the reviewer's italic back onto the page",
      timeoutMs: 20000
    });
    expect(await blockHtml(page, "p")).toBe(P_AFTER_ITALIC_HTML);

    // AND THE ITEM COMES BACK, with the sentence that says what is wrong.
    await pollPage(
      page,
      (id) => {
        const found = window.__lahe.items().find((item) => item.id === id);
        return !!found && found.state === "ready";
      },
      made.id,
      { message: "the page check to reopen the item on this load", timeoutMs: 20000 }
    );
    const reopened = await itemState(page, made.id);
    expect(reopened.note, "the reopened item says the words landed and the formatting did not").toContain(
      FORMAT_SENTENCE
    );
    expect(reopened.note.split(FORMAT_SENTENCE).length - 1, "one copy of the sentence").toBe(1);
    expect(reopened.rev, "the reopen bumped the rev").toBeGreaterThan(made.rev);
    expect(await page.evaluate(() => window.__lahe.counters.revertReopens), "one reopen on this load").toBe(1);

    // The agent answers handled again with the page unchanged, which is it
    // saying the rendering is intended. That has to end it: reopening again is
    // the loop of 2026-09-10 wearing different clothes.
    reply(made.id, reopened.rev);
    await pollPage(
      page,
      (id) => {
        const found = window.__lahe.items().find((item) => item.id === id);
        return !!found && found.state === "handled";
      },
      made.id,
      { message: "the second handled reply to fold", timeoutMs: 20000 }
    );

    await page.reload();
    await booted(page);
    await pollPage(page, () => window.__lahe.counters.revertChecks >= 1, undefined, {
      message: "the page check to run once the settling window closes",
      timeoutMs: 20000
    });
    expect(
      await page.evaluate(() => window.__lahe.counters.revertReopens),
      "the check reopened nothing on the second load"
    ).toBe(0);
    const settled = await itemState(page, made.id);
    expect(settled.state, "the item stays handled").toBe("handled");
    expect(settled.rev, "and no second reopen bumped the rev again").toBe(reopened.rev);
  });

  test("a rebuild that carries the italic is idempotent, and the item stays handled", async ({ page }) => {
    // The same gesture, and this time the agent's source says the emphasis, the
    // way a Markdown source says it with underscores. Nothing is written over
    // the page's own markup and nothing is reopened.
    rebuild(P_BEFORE);
    await page.goto(world.open);
    await booted(page);
    await pollPage(page, (text) => document.getElementById("p").textContent === text, P_BEFORE, {
      message: "the page to come back on the original wording",
      timeoutMs: 20000
    });

    const made = await handEditWithItalic(page, "p");

    // What a well-behaved agent writes: the emphasis AND the id the page put on
    // the element, so the next build is found with certainty rather than by its
    // words. Without the id the page check reopens the item and says so (S7),
    // which is test/browser/graceful_failure.spec.js.
    const stamp = await page.evaluate(() => document.getElementById("p").getAttribute("data-lahe-id"));
    expect(stamp, "the reviewer's hand edit stamped the paragraph").toBeTruthy();
    rebuild(P_AFTER_ITALIC_HTML, stamp);
    reply(made.id, made.rev);
    await pollPage(
      page,
      (id) => {
        const found = window.__lahe.items().find((item) => item.id === id);
        return !!found && found.state === "handled";
      },
      made.id,
      { message: "the agent's reply to fold and move the item to Done", timeoutMs: 20000 }
    );

    await page.reload();
    await booted(page);
    await pollPage(page, () => document.getElementById("p").innerHTML.indexOf("<em>") !== -1, undefined, {
      message: "the page to come back on the source that carries the italic",
      timeoutMs: 20000
    });
    await pollPage(page, () => window.__lahe.counters.revertChecks >= 1, undefined, {
      message: "the page check to run once the settling window closes",
      timeoutMs: 20000
    });

    expect(await blockHtml(page, "p"), "the page's own markup was left alone").toBe(P_AFTER_ITALIC_HTML);
    expect(await page.evaluate(() => window.__lahe.counters.regionsWritten), "nothing to write").toBe(0);
    expect(
      await page.evaluate(() => window.__lahe.counters.revertReopens),
      "nothing to reopen when the formatting is there"
    ).toBe(0);
    expect((await itemState(page, made.id)).state, "the item stays in Done").toBe("handled");
  });
});
