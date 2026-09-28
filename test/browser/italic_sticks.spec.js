// Taking italics off a paragraph sticks after the reload.
//
// The report, review r88dec64b8451 on 2026-09-22: "using the italics button
// still doesn't stick after the reload." A Markdown review, the Intro paragraph:
//
//   1. The page had <p><em>(open, your hook goes here)</em></p>.
//   2. The reviewer rewrote the paragraph's words (an edit record, two
//      revisions: the first typed inside the <em>, the second plain). The agent
//      wrote plain text into the .md and replied handled.
//   3. The reviewer used the italics button to take italics off the paragraph
//      (a format_only record, before <em>, after plain). The agent replied
//      handled: the source was already plain.
//   4. The rendered page was plain. After a reload the paragraph was italic.
//
// This walk is that sequence on the real `lahe review file.md` path: the
// session, the helper, the Markdown render, the injected script line and the
// reply file are all real, and a "rebuild" is the agent rewriting the .md and
// rerunning `lahe review`, which is what the skill tells it to do.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const SHOT_DIR = path.join(REPO_ROOT, "docs", "features", "20260922.03_italic_sticks");

test.describe.configure({ mode: "serial" });

const PLACEHOLDER = "(open, your hook goes here)";
const FIRST_TRY = "A";
const SECOND = "Runners come back too fast after a layoff.";
const INTRO = "It is never been a better time to be a builder, and I believe that whole-heartedly.";

// The Intro paragraph, found by its place rather than by its words, because
// its words are the thing this walk changes.
const INTRO_P = "main > section:first-of-type > p";

function markdownWith(introLine) {
  return ["# Debugging hell", "", "## Intro", "", introLine, "", "## Premise", "", "All those days are gone.", ""].join(
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

test.describe("taking italics off a paragraph sticks after the reload", () => {
  let world = null;

  function runReview() {
    return execFileSync(process.execPath, [CLI, "review", world.source, "--port", String(world.port)], {
      cwd: REPO_ROOT,
      env: world.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-italic-sticks-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const source = path.join(work, "post.md");
    fs.writeFileSync(source, markdownWith("*" + PLACEHOLDER + "*"));

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    world = { root: root, stateDir: stateDir, source: source, env: env, port: await freePort() };

    const output = runReview();
    world.session = labelled(output, "session");
    world.review = labelled(output, "review");
    world.open = labelled(output, "open");
    expect(world.session, "`lahe review` printed the agent session id").toBeTruthy();
    expect(world.open, "`lahe review` printed the URL of the rendered page").toBeTruthy();
    world.reviewDir = path.join(stateDir, "reviews", world.review);
  });

  test.afterAll(async () => {
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
  });

  function reply(itemId, rev) {
    fs.appendFileSync(
      path.join(world.reviewDir, "replies.jsonl"),
      JSON.stringify({ item: itemId, rev: rev, status: "handled", agent: "tester", files: ["post.md"] }) + "\n"
    );
  }

  async function helperHasRev(itemId, rev) {
    await pollUntil(
      () => {
        try {
          const projected = JSON.parse(fs.readFileSync(path.join(world.reviewDir, "review.json"), "utf8"));
          return projected.pages.some((page) => page.items.some((item) => item.id === itemId && item.rev === rev));
        } catch (err) {
          return false;
        }
      },
      { message: "review.json to hold " + itemId + " at rev " + rev, timeoutMs: 20000 }
    );
  }

  /** The agent's side of a change: rewrite the .md, rerun `lahe review`. */
  function rebuild(introLine) {
    fs.writeFileSync(world.source, markdownWith(introLine));
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

  function introHtml(page) {
    return page.evaluate((sel) => document.querySelector(sel).innerHTML, INTRO_P);
  }

  function introStyle(page) {
    return page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).fontStyle, INTRO_P);
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

  function itemOf(page, id) {
    return page.evaluate((itemId) => {
      const found = window.__lahe.items().find((item) => item.id === itemId);
      return found
        ? {
            id: found.id,
            kind: found.kind,
            state: found.state,
            rev: found.rev,
            before_html: found.before_html,
            after_html: found.after_html
          }
        : null;
    }, id);
  }

  async function handled(page, id) {
    await pollPage(
      page,
      (itemId) => {
        const found = window.__lahe.items().find((item) => item.id === itemId);
        return !!found && found.state === "handled";
      },
      id,
      { message: "the agent's reply to fold " + id + " as handled", timeoutMs: 20000 }
    );
  }

  /** Reload, then wait out the settling window so replay and the check have run. */
  async function reloadAndSettle(page) {
    await page.reload();
    await booted(page);
    await pollPage(page, () => window.__lahe.counters.revertChecks >= 1, undefined, {
      message: "the page check to run once the settling window closes",
      timeoutMs: 20000
    });
  }

  test("the paragraph stays plain after the reload, and after a second one", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);
    expect(await introHtml(page)).toBe("<em>" + PLACEHOLDER + "</em>");

    // STEP 2, revision 1: the reviewer types inside the <em>, so the first
    // commit is italic words.
    await openEdit(page);
    await selectAllWords(page);
    await page.keyboard.type(FIRST_TRY, { delay: 5 });
    await commitEdit(page);
    const firstRev = await page.evaluate(
      (text) => window.__lahe.items().find((item) => item.kind === "edit" && item.after === text),
      FIRST_TRY
    );
    expect(firstRev, "the first try is an edit record").toBeTruthy();
    expect(firstRev.after_html).toBe("<em>" + FIRST_TRY + "</em>");
    const editId = firstRev.id;

    // Revision 2. The reviewer opens the paragraph again, and while they are
    // in it the agent carries the first try into the source as `*A*`. Nothing
    // reloads under an open edit, so the page holds that rebuild.
    await openEdit(page);
    rebuild("*" + FIRST_TRY + "*");
    await selectAllWords(page);
    const off = await page.evaluate(() => window.__lahe.handle.editing.format("italic"));
    expect(off.applied, "the italic button took the italic off").toBe(true);
    await selectAllWords(page);
    await page.keyboard.type(INTRO, { delay: 2 });
    await commitEdit(page);
    const edit = await page.evaluate(
      (id) => window.__lahe.items().find((item) => item.id === id),
      editId
    );
    expect(edit.after, "the rewrite is the edit's next revision").toBe(INTRO);
    expect(edit.after_html, "and it is plain words").toBe(INTRO);

    // The held reload lands now, on the `*A*` source. Replay finds the first
    // try on the page and puts the current revision back: plain words.
    await reloadAndSettle(page);
    const onFirstTry = await introHtml(page);

    // The agent writes the rewrite into the .md, plain, and answers handled.
    rebuild(INTRO);
    await helperHasRev(editId, edit.rev);
    reply(editId, edit.rev);
    await handled(page, editId);
    await reloadAndSettle(page);
    const onPlainSource = await introHtml(page);

    // The reviewer takes italics off with the button, if there is any to take.
    let formatId = null;
    if (onPlainSource.indexOf("<em>") !== -1) {
      await openEdit(page);
      await selectAllWords(page);
      const plain = await page.evaluate(() => window.__lahe.handle.editing.format("italic"));
      expect(plain.applied).toBe(true);
      await commitEdit(page);
      await pollPage(
        page,
        () => !!window.__lahe.items().find((item) => item.kind === "format_only" && item.state === "ready"),
        undefined,
        { message: "the italic removal to land as a format_only record" }
      );
      const fo = await page.evaluate(() =>
        window.__lahe.items().find((item) => item.kind === "format_only" && item.state === "ready")
      );
      formatId = fo.id;
      await helperHasRev(fo.id, fo.rev);
      reply(fo.id, fo.rev);
      await handled(page, fo.id);
    }

    // STEP 4. The reload: the paragraph is plain, as the source is.
    await reloadAndSettle(page);
    expect(
      {
        html: await introHtml(page),
        onFirstTry: onFirstTry,
        onPlainSource: onPlainSource,
        formatId: formatId
      },
      "the paragraph is never italic once the reviewer took the italic off"
    ).toEqual({ html: INTRO, onFirstTry: INTRO, onPlainSource: INTRO, formatId: null });
    expect(await introStyle(page)).toBe("normal");

    // And a second reload does not bring it back either.
    await reloadAndSettle(page);
    expect(await introHtml(page), "still plain after a second reload").toBe(INTRO);
    expect(await introStyle(page)).toBe("normal");
    expect((await itemOf(page, editId)).state, "the edit stays handled").toBe("handled");

  });

  test("the italics button alone: the removal holds across a reload before and after the agent answers", async ({
    page
  }) => {
    // The same wrapper, reached by the button alone. The reviewer takes the
    // italics off a paragraph whose words all sit in one <em>. Until the agent
    // rebuilds, a reload brings back the italic source, and replay has to put
    // the removal back on the PARAGRAPH, not inside the <em>.
    rebuild("*" + SECOND + "*");
    await page.goto(world.open);
    await booted(page);
    await pollPage(page, (sel) => document.querySelector(sel).textContent.indexOf("Runners") === 0, INTRO_P, {
      message: "the page to come back on the italic paragraph",
      timeoutMs: 20000
    });
    expect(await introHtml(page)).toBe("<em>" + SECOND + "</em>");

    await openEdit(page);
    await selectAllWords(page);
    const off = await page.evaluate(() => window.__lahe.handle.editing.format("italic"));
    expect(off.applied, "the italic button took the italic off").toBe(true);
    await commitEdit(page);
    await pollPage(
      page,
      () => !!window.__lahe.items().find((item) => item.kind === "format_only" && item.state === "ready"),
      undefined,
      { message: "the italic removal to land as a format_only record" }
    );
    const fo = await page.evaluate(() =>
      window.__lahe.items().find((item) => item.kind === "format_only" && item.state === "ready")
    );
    expect(fo.before_html).toBe("<em>" + SECOND + "</em>");
    expect(fo.after_html).toBe(SECOND);

    // A reload before the agent has touched the source: the page says *...*
    // again, and replay takes the italic back off.
    await reloadAndSettle(page);
    expect(await introHtml(page), "replay put the removal back on the paragraph").toBe(SECOND);
    expect(await introStyle(page)).toBe("normal");

    // The agent writes the paragraph plain and answers handled.
    rebuild(SECOND);
    await helperHasRev(fo.id, fo.rev);
    reply(fo.id, fo.rev);
    await handled(page, fo.id);

    await reloadAndSettle(page);
    expect(await introHtml(page), "plain after the reload").toBe(SECOND);
    await reloadAndSettle(page);
    expect(await introHtml(page), "plain after a second reload").toBe(SECOND);
    expect(await introStyle(page)).toBe("normal");
    expect((await itemOf(page, fo.id)).state).toBe("handled");

    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.locator(INTRO_P).scrollIntoViewIfNeeded();
    await page.locator("main > section:first-of-type").screenshot({ path: path.join(SHOT_DIR, "after_reload.png") });
  });
});
