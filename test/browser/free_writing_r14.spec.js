// Brief R14 (bold and italic edits survive the rebuild), on a real
// `lahe review post.md`.
//
// This is the runnable port of the script that reproduced the three R14 cases
// (test/fixtures/free_writing/r14_repro_reference.js). On main at 2b6eb96 the
// first case passed and the other three failed (plan Task 1.1). With the
// free-writing branches merged, all of them are ordinary tests:
//
//   bold in the first paragraph, left out by the agent   comes back bold
//   bold in the second paragraph, left out by the agent  comes back bold
//   the header line, by click and by Esc                 shows once, under the h2
//   bold two words, the agent changes nothing            not retired
//
// Nothing is simulated: the session, the helper, its server, the reply and the
// rebuild are all real, and a rebuild is a rewrite of the source file. Each
// test runs its own helper on its own port with its own state folder, and
// never touches the helper on 7817.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil } = require("../helpers");

const REPO_ROOT = process.env.LAHE_REPO || path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

const ORIGINAL = "Runners come back too fast after a layoff.";
const INTRO_SECTION = "main > section:first-of-type";
const INTRO_P = "main > section:first-of-type > p";
const INTRO_H2 = "main > section:first-of-type h2";
const P_BOLD = "First new paragraph has a bold word in it.";
const P_PLAIN = "Second new paragraph is plain.";
const NEW_LINE = "A new line";

function md(introBlocks) {
  return ["# Debugging hell", "", "## Intro", ""]
    .concat(introBlocks.join("\n\n"))
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

async function makeWorld(testInfo, blocks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-r14-"));
  const stateDir = path.join(root, "state");
  const work = path.join(root, "work");
  fs.mkdirSync(work, { recursive: true });
  const source = path.join(work, "post.md");
  fs.writeFileSync(source, md(blocks));
  const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
  delete env.XDG_STATE_HOME;
  const port = await freePort();
  const cli = function (args) {
    return execFileSync(process.execPath, [CLI].concat(args), {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  };
  const out = cli(["review", source, "--port", String(port)]);
  const world = {
    root: root,
    stateDir: stateDir,
    source: source,
    cli: cli,
    session: labelled(out, "session"),
    review: labelled(out, "review"),
    open: labelled(out, "open")
  };
  world.reviewDir = path.join(stateDir, "reviews", world.review);
  expect(world.open, "`lahe review` printed the page URL").toBeTruthy();
  return world;
}

function closeWorld(world) {
  if (!world) return;
  try {
    world.cli(["session", "close", world.session]);
  } catch (err) {
    // A session that already went down is not a test failure.
  }
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot",
    timeoutMs: 20000
  });
  await page.evaluate(() => window.__lahe.interactionBusy(50));
}

async function claim(page) {
  if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
    await page.evaluate(() => window.__lahe.handle.sync.takeover());
    await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
      message: "this window to take the review"
    });
  }
}

function caret(page, selector, offset) {
  return page.evaluate(
    ({ selector, offset }) => {
      const el = document.querySelector(selector);
      if (el.focus) el.focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      let node = nodes[0];
      let at = offset;
      if (offset === "end") {
        node = nodes[nodes.length - 1];
        at = node.data.length;
      }
      const range = document.createRange();
      range.setStart(node, at);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    { selector, offset }
  );
}

function selectAll(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    const range = document.createRange();
    range.setStart(nodes[0], 0);
    const last = nodes[nodes.length - 1];
    range.setEnd(last, last.data.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, selector);
}

function selectPhrase(page, selector, phrase) {
  return page.evaluate(
    ({ selector, phrase }) => {
      const el = document.querySelector(selector);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.data.indexOf(phrase);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + phrase.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return true;
      }
      return false;
    },
    { selector, phrase }
  );
}

async function openEdit(page, selector) {
  await claim(page);
  await caret(page, selector, 0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "edit state to open" });
}

async function pressBold(page) {
  const rect = await page.evaluate(() => {
    const node = window.__lahe.handle.editing.buttonNode("bold");
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(rect, "the edit frame shows its B button").toBeTruthy();
  await page.mouse.click(rect.x, rect.y);
}

async function commitByEsc(page) {
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the edit to commit" });
}

async function commitByClickOutside(page) {
  const box = await page.locator("main > section:nth-of-type(2) > p").boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the edit to commit" });
}

async function committedEdit(page) {
  await pollPage(
    page,
    () => window.__lahe.items().some((i) => i.state === "ready" && (i.kind === "edit" || i.kind === "format_only")),
    undefined,
    { message: "a ready hand edit in the store" }
  );
  return page.evaluate(() =>
    window.__lahe.items().filter((i) => i.state === "ready" && (i.kind === "edit" || i.kind === "format_only"))[0]
  );
}

function reviewJsonItem(world, id) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(world.reviewDir, "review.json"), "utf8"));
    for (const p of json.pages) for (const it of p.items) if (it.id === id) return it;
  } catch (err) {
    // Mid-write; the poll tries again.
  }
  return null;
}

async function helperHas(world, id, rev) {
  return pollUntil(
    () => {
      const it = reviewJsonItem(world, id);
      return it && it.rev === rev ? it : null;
    },
    { message: "review.json to hold " + id + " at rev " + rev, timeoutMs: 20000 }
  );
}

/** Settle the page after a load: the layer booted, the check ran, one replay pass. */
async function settled(page) {
  await booted(page);
  await pollPage(page, () => window.__lahe.counters.revertChecks >= 1, undefined, {
    message: "the page check to run on this load",
    timeoutMs: 20000
  });
  await page.evaluate(() => window.__lahe.replayNow());
}

/** The agent writes the .md; the page reloads itself off the new render. */
async function agentWrites(page, world, blocks) {
  await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
    message: "the page's mtime baseline",
    timeoutMs: 20000
  });
  let navigations = 0;
  const onNav = (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  };
  page.on("framenavigated", onNav);
  fs.writeFileSync(world.source, md(blocks));
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(world.source, later, later);
  await pollUntil(() => navigations > 0, { message: "the page to reload after the rebuild", timeoutMs: 30000 });
  page.off("framenavigated", onNav);
  await page.waitForLoadState("load");
  await settled(page);
}

function sectionText(page) {
  return page.evaluate((sel) => document.querySelector(sel).innerText.replace(/\s+/g, " "), INTRO_SECTION);
}

function countOnPage(page, text) {
  return page.evaluate((t) => {
    const words = document.querySelector("main").innerText.replace(/\s+/g, " ");
    let n = 0;
    for (let at = words.indexOf(t); at !== -1; at = words.indexOf(t, at + 1)) n += 1;
    return n;
  }, text);
}

function reply(world, it) {
  return world.cli([
    "reply", "--review", world.review, "--item", it.id, "--rev", String(it.rev),
    "--status", "handled", "--agent", "r14", "--file", world.source
  ]);
}

test.describe("brief R14: bold and italic edits survive the rebuild", () => {
  let world = null;

  test.afterEach(() => {
    closeWorld(world);
    world = null;
  });

  test("a lone paragraph: bold in the FIRST new paragraph, left out by the agent, comes back bold", async ({ page }, testInfo) => {
    world = await makeWorld(testInfo, [ORIGINAL]);
    await page.goto(world.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    await selectAll(page, INTRO_P);
    await page.keyboard.type(P_BOLD, { delay: 2 });
    await selectPhrase(page, INTRO_P, "bold");
    await pressBold(page);
    await caret(page, INTRO_P, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type(P_PLAIN, { delay: 2 });
    await commitByEsc(page);
    const it = await committedEdit(page);
    await helperHas(world, it.id, it.rev);

    // The agent places only the plain paragraph.
    await agentWrites(page, world, [ORIGINAL, P_PLAIN]);

    await pollPage(page, (sel) => !!document.querySelector(sel + " strong"), INTRO_SECTION, {
      message: "the bold paragraph to be written back with its bold",
      timeoutMs: 5000
    });
    expect(await countOnPage(page, P_BOLD)).toBe(1);
    expect(await countOnPage(page, P_PLAIN)).toBe(1);
  });

  test("a lone paragraph: bold in the SECOND new paragraph, left out by the agent, comes back bold", async ({ page }, testInfo) => {
    world = await makeWorld(testInfo, [ORIGINAL]);
    await page.goto(world.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    await selectAll(page, INTRO_P);
    await page.keyboard.type(P_PLAIN, { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(P_BOLD, { delay: 2 });
    // Enter made the second paragraph its own p (a run block), so the phrase
    // is looked for across the section, not in the first p.
    expect(await selectPhrase(page, INTRO_SECTION, "bold")).toBe(true);
    await pressBold(page);
    await caret(page, INTRO_SECTION + " > p:last-of-type", "end");
    await commitByEsc(page);
    const it = await committedEdit(page);
    expect(it.new_blocks.map((b) => b.html)).toEqual(["First new paragraph has a <strong>bold</strong> word in it."]);
    await helperHas(world, it.id, it.rev);

    await agentWrites(page, world, [P_PLAIN]);

    await pollPage(page, (sel) => !!document.querySelector(sel + " strong"), INTRO_SECTION, {
      message: "the left-out bold paragraph to come back with its bold",
      timeoutMs: 5000
    });
    expect(await countOnPage(page, P_BOLD)).toBe(1);
  });

  for (const leave of ["click", "Esc"]) {
    test("the header line: a line written after a heading shows once after the rebuild, left by " + leave, async ({ page }, testInfo) => {
      world = await makeWorld(testInfo, [ORIGINAL]);
      await page.goto(world.open);
      await booted(page);
      await openEdit(page, INTRO_H2);
      await caret(page, INTRO_H2, "end");
      await page.keyboard.press("Enter");
      await page.keyboard.type(NEW_LINE, { delay: 5 });
      if (leave === "click") await commitByClickOutside(page);
      else await commitByEsc(page);
      const it = await committedEdit(page);
      await helperHas(world, it.id, it.rev);

      // A correct agent: the new line as its own paragraph under the heading.
      await agentWrites(page, world, [NEW_LINE, ORIGINAL]);

      expect(await page.evaluate((s) => document.querySelector(s).innerText.trim(), INTRO_H2)).toBe("Intro");
      expect(await countOnPage(page, NEW_LINE)).toBe(1);
      expect(await sectionText(page)).toContain(NEW_LINE + " " + ORIGINAL);
    });
  }

  test("bold two words: an agent that changes nothing and replies handled does not retire the edit", async ({ page }, testInfo) => {
    world = await makeWorld(testInfo, [ORIGINAL]);
    await page.goto(world.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    expect(await selectPhrase(page, INTRO_P, "too fast")).toBe(true);
    await pressBold(page);
    await commitByEsc(page);
    const it = await committedEdit(page);
    expect(it.kind).toBe("format_only");
    await helperHas(world, it.id, it.rev);

    reply(world, it);
    const folded = await pollUntil(
      () => {
        const got = reviewJsonItem(world, it.id);
        return got && got.reply ? got : null;
      },
      { message: "the helper to fold the handled reply", timeoutMs: 20000 }
    );
    expect(folded.state).toBe("ready");
    expect(folded.handled_not_on_page).toBe(true);
  });
});
