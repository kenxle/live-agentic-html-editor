// A handled hand edit that gets reverted reopens itself on the next page load.
//
// The incident this comes from. The reviewer hand-edited a line, the agent
// carried the edit into the source and replied handled, and the item moved to
// Done. Two hours later a doc-wide sweep for a different item took the
// hand-edited line back out. The reviewer's recorded decision was undone and
// nothing said so.
//
// Nothing here is simulated: it is the real `lahe review` walk, so the session,
// the helper, the static server, the injected script line, the reply file and
// the wake feed are all the real ones. The agent's whole API is still one
// appended JSON line, and the "sweep" is a rewrite of the source file, which is
// what a sweep actually is.
//
// Both directions are asserted, because the check is only useful if it can tell
// them apart:
//
//   revert     the after text is gone and the before text is back, so the item
//              becomes ready work again
//   rewrite    the after text is gone and the before text is NOT back, so the
//              passage moved on for a reason nobody here can see, and the item
//              stays handled

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

// One walk, one helper, one session. Serial because the whole file is one story.
test.describe.configure({ mode: "serial" });

const P_BEFORE = "The trainer writes the plan every week.";
const P_AFTER = "The trainer writes the plan each week.";
const Q_BEFORE = "Runners come back too fast after a layoff.";
const Q_AFTER = "Runners come back too fast after a break.";
// Neither the before text nor the after text: the passage genuinely moved on.
const Q_REWRITTEN = "Coming back from time off is where most training plans fall apart.";

function docHtml(p, q, scriptLine) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Steady Pace</title></head>',
    "<body>",
    "<main>",
    '<p id="p">' + p + "</p>",
    '<p id="q">' + q + "</p>",
    "</main>",
    scriptLine,
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

test.describe("a handled hand edit that was reverted reopens itself", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-reverted-edit-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const pagePath = path.join(work, "doc.html");
    fs.writeFileSync(pagePath, docHtml(P_BEFORE, Q_BEFORE, ""));

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    const port = await freePort();

    // The documented walk, run exactly as a person would type it.
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

    // NOTHING WAS WRITTEN INTO THE PAGE, and the rebuilds below put nothing
    // back. `lahe review` owns the server that answers for this file, so the
    // script line goes into the response and the reviewer's own folder keeps
    // no review id and no token. A rebuild here is what an ad hoc script does:
    // it writes the document and knows nothing about this tool.
    expect(
      fs.readFileSync(pagePath, "utf8").indexOf("data-lahe-review"),
      "the walk left the page on disk alone"
    ).toBe(-1);

    world = {
      root: root,
      stateDir: stateDir,
      pagePath: pagePath,
      env: env,
      session: session,
      review: review,
      open: open,
      reviewDir: path.join(stateDir, "reviews", review),
      wakeLog: path.join(stateDir, "agent-sessions", session, "wake.log")
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

  // --- what the agent does, and what a build does ---------------------------

  /** The agent's whole API: one appended JSON line. */
  function reply(itemId, rev) {
    fs.appendFileSync(
      path.join(world.reviewDir, "replies.jsonl"),
      JSON.stringify({ item: itemId, rev: rev, status: "handled", agent: "tester", files: ["doc.html"] }) + "\n"
    );
  }

  /** A build: the source is rewritten, and the page reloads itself off it. */
  function rebuild(p, q) {
    fs.writeFileSync(world.pagePath, docHtml(p, q, ""));
    // The mtime is the reload signal, and a coarse-timestamp filesystem can
    // give two quick writes the same one.
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(world.pagePath, later, later);
  }

  function wakeLines() {
    if (!fs.existsSync(world.wakeLog)) return [];
    return fs
      .readFileSync(world.wakeLog, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  // --- the reviewer's gesture -----------------------------------------------

  /**
   * A second test window opens on a review the first one still holds, and a
   * refused window is read-only on purpose. Pressing the real takeover is what
   * a reviewer does; nothing here weakens the claim to avoid it.
   */
  async function claim(page) {
    if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
      await page.evaluate(() => window.__lahe.handle.sync.takeover());
      await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "this window to take over the retained review"
      });
    }
  }

  /** Cmd-Shift-E, select the block, retype it, Esc. A real hand edit. */
  async function handEdit(page, blockId, text) {
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
    await page.keyboard.type(text, { delay: 5 });
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the hand edit on #" + blockId
    });
  }

  /** The revert check having RUN on this load. The check is once per load. */
  async function checkRan(page) {
    await pollPage(page, () => window.__lahe.counters.revertChecks >= 1, undefined, {
      message: "the revert check to run once the settling window closes",
      timeoutMs: 20000
    });
  }

  async function booted(page) {
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its own script tag",
      timeoutMs: 20000
    });
  }

  function itemState(page, itemId) {
    return page.evaluate((id) => {
      const found = window.__lahe.items().find((item) => item.id === id);
      return found ? { state: found.state, note: found.note, rev: found.rev } : null;
    }, itemId);
  }

  /** Land one hand edit, have the agent apply it to the source and answer it. */
  async function handledEdit(page, blockId, after, p, q) {
    await handEdit(page, blockId, after);
    await pollPage(
      page,
      (text) => !!window.__lahe.items().find((item) => item.kind === "edit" && item.after === text),
      after,
      { message: "the hand edit on #" + blockId + " to land as a ready record" }
    );
    const made = await page.evaluate((text) => {
      const found = window.__lahe.items().find((item) => item.kind === "edit" && item.after === text);
      return { id: found.id, rev: found.rev };
    }, after);

    // What the agent does: put the change in the source, rebuild, then answer.
    rebuild(p, q);
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
    return made;
  }

  test("a sweep that puts the original text back reopens the item, with a note saying why", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const made = await handledEdit(page, "p", P_AFTER, P_AFTER, Q_BEFORE);

    // The page now shows the reviewer's wording and the item is finished. The
    // check has to leave it alone: this is the state every handled edit is in.
    await checkRan(page);
    expect((await itemState(page, made.id)).state, "a handled edit still on the page stays handled").toBe(
      "handled"
    );

    const before = wakeLines().length;

    // The sweep: a doc-wide change for some other item takes the hand-edited
    // line back out and the original wording is what is left.
    rebuild(P_BEFORE, Q_BEFORE);
    await pollPage(page, (text) => document.querySelector("#p").textContent === text, P_BEFORE, {
      message: "the page to reload itself onto the reverted file",
      timeoutMs: 20000
    });
    await booted(page);

    await pollPage(
      page,
      (id) => {
        const found = window.__lahe.items().find((item) => item.id === id);
        return !!found && found.state === "ready";
      },
      made.id,
      { message: "the revert check to reopen the item on this load", timeoutMs: 20000 }
    );
    const reopened = await itemState(page, made.id);

    expect(reopened.note, "the reopened item carries the tool-generated sentence").toContain(
      "Reopened by the page check:"
    );
    expect(reopened.note, "and it says what to do about it").toContain("Reapply it, or reply not_handled saying why.");
    expect(reopened.rev, "the reopen bumped the rev, like a reviewer's own reopen").toBeGreaterThan(made.rev);

    // The card is back out of Done.
    const doneRows = await page.evaluate(() => window.__lahe.handle.doneTab().rowCount());
    expect(doneRows, "the Done pane no longer holds the reopened card").toBe(0);

    // And the agent was woken, through the feed that already wakes on a reopen.
    const lines = await pollUntil(
      () => {
        const all = wakeLines();
        return all.length > before ? all : null;
      },
      { message: "a wake line for the reopened item", timeoutMs: 20000 }
    );
    const work = lines.filter((line) => line.kind === "work" && line.item === made.id);
    expect(work.length, "the wake feed named the reopened item").toBeGreaterThan(0);
    expect(work[work.length - 1].drain, "the wake line points at the drain command").toContain(world.session);
  });

  test("a rebuild that genuinely rewrites the passage does not reopen anything", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);

    const made = await handledEdit(page, "q", Q_AFTER, P_BEFORE, Q_AFTER);
    const before = wakeLines().length;

    // The passage is rewritten: the reviewer's wording is gone, and so is the
    // text it replaced. That is a document moving on, not a revert.
    rebuild(P_BEFORE, Q_REWRITTEN);
    await pollPage(page, (text) => document.querySelector("#q").textContent === text, Q_REWRITTEN, {
      message: "the page to reload itself onto the rewritten file",
      timeoutMs: 20000
    });
    await booted(page);

    // The check RAN on this load and chose to reopen nothing, which is a real
    // result rather than a wait that happened to expire quietly.
    await checkRan(page);
    const reopens = await page.evaluate(() => window.__lahe.counters.revertReopens);
    expect(reopens, "the check reopened nothing on this load").toBe(0);
    const after = await itemState(page, made.id);
    expect(after.state, "a rewritten passage leaves the handled item alone").toBe("handled");
    expect(wakeLines().length, "and nobody was woken for it").toBe(before);
  });
});
