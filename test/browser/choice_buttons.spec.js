// Choice buttons on a document (docs/features/20261013.01_choice_buttons).
//
// The real walk: `lahe review` on a copy of a fixture, with this worktree's
// own helper in a temp state folder, the page the helper serves itself, the
// reply file and `lahe status --json`. Every press is a real mouse click (or a
// real Enter or Space on a focused button) on the page's own button. The rail
// is a closed shadow root, so it is read back through window.__lahe.rail.
//
// Rows of the plan's verification table this file proves:
//   V1, V22  a dev-server page (no data-lahe-document) arms nothing, claims no
//            click, raises no chip, and its own handler still counts
//   V2       every broken group is inert and the chip names it and why
//   V3       a press mints a ready choice record, kept then open; Enter and
//            Space press too; a second press is a reword; the drain shows the latest
//   V4       after handled a press is a new item; after not_handled it reopens
//   V5       a reload keeps it; with the helper stopped a press is kept, and the
//            restarted helper stores it
//   V6       the five states; data-chosen with no record is left alone; a
//            newer press is drawn beside data-chosen; a held press is not a
//            program-down warning
//   V7       a moved group keeps its state; a removed or renamed one is lost
//            and the card says so, while the item stays on the drain
//   V8       pick mode, an open edit, a read-only window and present mode are
//            not presses; a group in a form submits nothing
//   V11      replies fold onto the card; Mark as done; words in the reply box
//            are a note follow-up and the answer is unchanged
//   V23      the rail card, light and dark (with CHOICE_SHOTS set)
//
// Every helper a test starts is stopped in afterEach (stopTempHelpers).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const { test, expect, pollPage, pollUntil, placeCaret } = require("../helpers");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");
const { withLayer } = require("./support/with_layer");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const FIXTURES = path.join(REPO_ROOT, "test", "fixtures");
// Set CHOICE_SHOTS=<folder> to also write the rail screenshots there, as
// test/browser/choice_style.spec.js does. A plain run writes no file, so it
// never rewrites the tracked pictures under docs/.
const SHOTS = process.env.CHOICE_SHOTS || "";

async function shot(page, file, options) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const clip = options && options.railOnly
    ? await page.evaluate(() => {
        const r = window.__lahe.rail.geometry().rail;
        return { x: Math.max(0, r.left - 16), y: 0, width: r.right - r.left + 32, height: window.innerHeight };
      })
    : undefined;
  await page.screenshot({ path: path.join(SHOTS, file), clip: clip });
}


const CSS_COUNTER = "lesson-css-counter";
const REVEAL = "lesson-reveal-timer";
const MONITOR = "lesson-monitor-setting";
const PANDOC = "lesson-pandoc-section";

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

// ---------------------------------------------------------------------------
// The world: one `lahe review` per test, on a copy of a fixture
// ---------------------------------------------------------------------------

async function openWorld(fixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-choice-"));
  const stateDir = path.join(root, "state");
  const work = path.join(root, "work");
  fs.mkdirSync(work, { recursive: true });
  const source = path.join(work, path.basename(fixture));
  fs.copyFileSync(path.join(FIXTURES, fixture), source);
  const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
  delete env.XDG_STATE_HOME;
  const world = { root, stateDir, source, env, port: await freePort() };
  const output = execFileSync(process.execPath, [CLI, "review", source, "--port", String(world.port)], {
    cwd: REPO_ROOT,
    env: env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  world.session = labelled(output, "session");
  world.review = labelled(output, "review");
  world.open = labelled(output, "open");
  world.reviewDir = path.join(stateDir, "reviews", world.review);
  return world;
}

async function closeWorld(world) {
  if (!world) return;
  if (world.session) {
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
  }
  await stopTempHelpers(world.stateDir);
}

function reply(world, fields) {
  fs.appendFileSync(path.join(world.reviewDir, "replies.jsonl"), JSON.stringify(Object.assign({ agent: "claude" }, fields)) + "\n");
}

function drainLines(world) {
  const out = execFileSync(process.execPath, [CLI, "status", "--session", world.session, "--json", "--quiet"], {
    cwd: REPO_ROOT,
    env: world.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((line) => line.id);
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its own script tag",
    timeoutMs: 20000
  });
  await page.evaluate(() => window.__lahe.interactionBusy(50));
}

async function claim(page) {
  await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
    message: "the window claim to be decided"
  });
  if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
    await page.evaluate(() => window.__lahe.handle.sync.takeover());
    await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
      message: "this window to take over the retained review"
    });
  }
}

async function ready(page, world) {
  await page.goto(world.open);
  await booted(page);
  await claim(page);
}

function buttonSel(group, value) {
  return '.choice[data-choice="' + group + '"] button[value="' + value + '"]';
}

/** A real mouse click on the page's own button. */
async function press(page, group, value) {
  await page.locator(buttonSel(group, value)).scrollIntoViewIfNeeded();
  await page.click(buttonSel(group, value));
}

function choices(page, group) {
  return page.evaluate(
    (g) =>
      window.__lahe
        .items()
        .filter((i) => i.kind === "choice" && (!g || (i.choice && i.choice.group === g)))
        .map((i) => ({ id: i.id, rev: i.rev, state: i.state, choice: i.choice, context: i.context, region: i.region, created_at: i.created_at, note: i.note })),
    group || null
  );
}

async function latestChoice(page, group) {
  const list = await choices(page, group);
  return list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).pop() || null;
}

function groupPaint(page, group) {
  return page.evaluate((g) => {
    const el = document.querySelector('.choice[data-choice="' + g + '"]');
    if (!el) return null;
    return {
      state: el.getAttribute("data-lahe-choice-state"),
      inert: el.getAttribute("data-lahe-inert"),
      pressed: Array.from(el.querySelectorAll("button[data-lahe-pressed]")).map((b) => b.value),
      chosen: Array.from(el.querySelectorAll("button[data-chosen]")).map((b) => b.value)
    };
  }, group);
}

async function expectState(page, group, state, message) {
  await pollPage(
    page,
    (args) => {
      const el = document.querySelector('.choice[data-choice="' + args.g + '"]');
      return !!el && el.getAttribute("data-lahe-choice-state") === args.s;
    },
    { g: group, s: state },
    { message: message || group + " to show " + state, timeoutMs: 30000 }
  );
}

async function waitForItem(page, predicate, arg, message) {
  await pollPage(page, predicate, arg, { message: message, timeoutMs: 30000 });
}

function cardText(page, id) {
  return page.evaluate((itemId) => {
    const node = window.__lahe.rail.cardNode(itemId);
    return node ? node.textContent.replace(/\s+/g, " ").trim() : null;
  }, id);
}

// ---------------------------------------------------------------------------
// V1, V22: a dev-server page arms nothing
// ---------------------------------------------------------------------------

test.describe("a page from someone else's dev server", () => {
  test("arms no group, claims no click, raises no chip, and the page's own handler counts (V1, V22)", async ({ page, fixtureServer }) => {
    // with_layer injects an ordinary tag, as `lahe add` writes one: no
    // data-lahe-document. The helper is deliberately absent.
    await withLayer(page, { review: "devserver-review", token: "devserver-token", helper: "http://127.0.0.1:1" });
    await page.goto(fixtureServer.urlFor("choice-devserver.html"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot on the dev-server page"
    });
    expect(await page.evaluate(() => window.__lahe.choices.isDocument())).toBe(false);
    expect(await page.evaluate(() => window.__lahe.choices.armed())).toEqual([]);

    await page.click(buttonSel("site-group", "yes"));
    await page.click(buttonSel("site-group", "no"));
    await expect(page.locator("#clicks")).toHaveText("2");

    expect(await choices(page), "no record is minted").toEqual([]);
    const paint = await groupPaint(page, "site-group");
    expect(paint, "nothing of Lahe's is written onto the dev server's group").toEqual({ state: null, inert: null, pressed: [], chosen: [] });
    const chips = await page.evaluate(() => window.__lahe.failures().map((f) => f.code));
    expect(chips, "no chip").not.toContain("CHOICE_GROUP_INERT");
  });
});

// ---------------------------------------------------------------------------
// The lesson queue: pressing, states, replies
// ---------------------------------------------------------------------------

test.describe("the lesson queue, served by the helper", () => {
  let world = null;

  test.beforeEach(async () => {
    world = await openWorld("choice-doc.md");
  });

  test.afterEach(async () => {
    await closeWorld(world);
    world = null;
  });

  test("a press mints a ready choice, kept then open; a second press is a reword; the drain shows the latest (V3, V6 kept/open)", async ({ page }) => {
    await ready(page, world);
    expect(await page.evaluate(() => window.__lahe.choices.isDocument()), "the helper marked this page a document").toBe(true);
    expect((await page.evaluate(() => window.__lahe.choices.armed())).sort()).toEqual([CSS_COUNTER, MONITOR, PANDOC, REVEAL].sort());
    const statusBefore = await page.evaluate(() => window.__lahe.status());

    await press(page, CSS_COUNTER, "promote");
    const first = await latestChoice(page, CSS_COUNTER);
    expect(first, "the click is a record").toBeTruthy();
    expect(first.state, "ready in the same tick, with no draft step the reviewer sees").toBe("ready");
    expect(first.rev).toBe(1);
    expect(first.choice).toEqual({ group: CSS_COUNTER, answer: "promote" });
    expect(first.context.quote).toBe("Promote this lesson?");
    expect(first.context.heading).toBe("A CSS counter ignores an ol start attribute");
    expect(first.region.ref).toEqual({ kind: "choice", group: CSS_COUNTER });
    expect(first.region.ref.stamp, "no stamp is minted for a press").toBeUndefined();
    expect(await page.evaluate(() => document.querySelector("[data-lahe-id]")), "no stamp on the page either").toBe(null);

    // Held for the quiet spell: kept, and not a program-down warning.
    const held = await groupPaint(page, CSS_COUNTER);
    expect(held.pressed).toEqual(["promote"]);
    expect(held.state).toBe("kept");
    const during = await page.evaluate(() => ({ status: window.__lahe.status(), chips: window.__lahe.failures().map((f) => f.code) }));
    expect(during.status, "a held press is not the helper-down status").not.toBe("kept_locally");
    expect(during.chips).not.toContain("HELPER_UNREACHABLE");
    expect(statusBefore).not.toBe("kept_locally");

    // A second press before any reply: rev 2 of the same item.
    await press(page, CSS_COUNTER, "merge");
    const second = await latestChoice(page, CSS_COUNTER);
    expect(second.id, "the same item").toBe(first.id);
    expect(second.rev).toBe(2);
    expect(second.choice.answer).toBe("merge");
    expect((await choices(page, CSS_COUNTER)).length).toBe(1);
    expect((await groupPaint(page, CSS_COUNTER)).pressed).toEqual(["merge"]);

    await expectState(page, CSS_COUNTER, "open", "the press to be stored, so the group shows open");
    const drain = await pollUntil(
      () => {
        const lines = drainLines(world).filter((l) => l.id === first.id);
        return lines.length ? lines : null;
      },
      { message: "the press on the drain", timeoutMs: 30000 }
    );
    expect(drain.length, "the drain lists the item once").toBe(1);
    expect(drain[0].rev).toBe(2);
    expect(drain[0].choice).toEqual({ group: CSS_COUNTER, answer: "merge" });
    expect(drain[0].page.quote).toBe("Promote this lesson?");
    expect(drain[0].page.context).toEqual({ heading: "A CSS counter ignores an ol start attribute" });

    // The card: Choice, the question, the answer as the button says it.
    const card = await cardText(page, first.id);
    expect(card).toContain("Choice");
    expect(card).toContain("Promote this lesson?");
    expect(card).toContain("Merge");
  });

  test("Enter and Space on a focused button press it (V3 keyboard)", async ({ page }) => {
    await ready(page, world);
    await page.focus(buttonSel(REVEAL, "discard"));
    await page.keyboard.press("Enter");
    await waitForItem(page, (g) => window.__lahe.items().some((i) => i.kind === "choice" && i.choice.group === g), REVEAL, "Enter to press");
    expect((await latestChoice(page, REVEAL)).choice.answer).toBe("discard");
    await page.focus(buttonSel(PANDOC, "promote"));
    await page.keyboard.press("Space");
    await waitForItem(page, (g) => window.__lahe.items().some((i) => i.kind === "choice" && i.choice.group === g), PANDOC, "Space to press");
    expect((await latestChoice(page, PANDOC)).choice.answer).toBe("promote");
  });

  test("the five states paint from the record, and replies fold onto the card (V6, V11)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await ready(page, world);

    // data-chosen with no record: left exactly as the agent wrote it.
    const decided = await groupPaint(page, MONITOR);
    expect(decided).toEqual({ state: null, inert: null, pressed: [], chosen: ["discard"] });

    await press(page, CSS_COUNTER, "promote");
    await press(page, REVEAL, "promote");
    await press(page, PANDOC, "discard");
    const a = await latestChoice(page, CSS_COUNTER);
    const b = await latestChoice(page, REVEAL);
    const c = await latestChoice(page, PANDOC);
    await expectState(page, CSS_COUNTER, "open");
    await expectState(page, REVEAL, "open");
    await expectState(page, PANDOC, "open");

    // A question: the card shows it, and the group says question.
    reply(world, { item: a.id, rev: a.rev, status: "question", text: "Promote it to both stylesheets' docs, or only the lahe one?" });
    // Not handled, with a reason.
    reply(world, { item: b.id, rev: b.rev, status: "not_handled", reason: "This lesson already exists as L14." });
    // Handled.
    reply(world, { item: c.id, rev: c.rev, status: "handled", text: "Discarded; data-chosen is on the button." });
    await expectState(page, CSS_COUNTER, "question");
    await expectState(page, REVEAL, "not_handled");
    await expectState(page, PANDOC, "done");
    expect(await cardText(page, a.id)).toContain("Promote it to both stylesheets");
    expect(await cardText(page, b.id)).toContain("This lesson already exists as L14.");
    expect(await cardText(page, c.id)).toContain("Discarded; data-chosen is on the button.");

    // A read mark queued by opening this card is not the press waiting to be
    // stored: the group still says question while the mark sits in the outbox.
    const whileMarked = await page.evaluate((id) => {
      const item = window.__lahe.items().find((i) => i.id === id);
      window.__lahe.handle.sync.markReplySeen(item);
      const queued = window.__lahe.handle.store.pendingEvents(window.__lahe.handle.review).some((e) => e.item === id && e.event === "reply.seen");
      window.__lahe.choices.paint();
      const el = document.querySelector('.choice[data-choice="lesson-css-counter"]');
      return { queued: queued, state: el.getAttribute("data-lahe-choice-state") };
    }, a.id);
    expect(whileMarked.queued, "the read mark is in the outbox").toBe(true);
    expect(whileMarked.state, "and the stored press is not read as kept").toBe("question");

    // The picture of the card, light and dark: a question on a choice.
    await page.evaluate((id) => {
      window.__lahe.rail.selectTab("active");
      const node = window.__lahe.rail.cardNode(id);
      if (node) node.scrollIntoView({ block: "center" });
      document.querySelector('.choice[data-choice="lesson-css-counter"]').scrollIntoView({ block: "center" });
    }, a.id);
    await page.mouse.move(1, 1);
    await shot(page, "choice_card_light.png");
    await page.evaluate(() => {
      document.documentElement.style.background = "#14161b";
      document.body.style.background = "#14161b";
      document.body.style.color = "#e6e6e6";
      window.__lahe.rail.refreshScheme();
    });
    // The rail alone: a document is light only, and darkening the page body
    // to turn the rail dark would show the page in a scheme it never has.
    await shot(page, "choice_card_dark.png", { railOnly: true });
    await page.evaluate(() => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
      document.body.style.color = "";
      window.__lahe.rail.refreshScheme();
    });

    // Words in the card's reply box: a note follow-up on the same record, and
    // the answer is unchanged (V11). Under a question, that is the composer.
    await page.evaluate((id) => {
      window.__lahe.rail.selectTab("active");
      const node = window.__lahe.rail.cardNode(id);
      node.scrollIntoView({ block: "center" });
      const box = Array.from(node.querySelectorAll("textarea")).find((t) => t.offsetParent !== null && !t.disabled);
      box.focus();
    }, a.id);
    await page.keyboard.type("Only the lahe one.");
    await page.keyboard.press("ControlOrMeta+Enter");
    await waitForItem(
      page,
      (id) => {
        const it = window.__lahe.items().find((i) => i.id === id);
        return !!it && it.rev === 2 && it.note === "Only the lahe one." && !it.reply;
      },
      a.id,
      "the follow-up to be a new revision of the same record"
    );
    const followed = await latestChoice(page, CSS_COUNTER);
    expect(followed.id).toBe(a.id);
    expect(followed.choice, "the answer is unchanged").toEqual({ group: CSS_COUNTER, answer: "promote" });
    expect((await choices(page, CSS_COUNTER)).length).toBe(1);

    // Mark as done closes it, and the group says done.
    const info = await page.evaluate((id) => {
      window.__lahe.rail.selectTab("active");
      window.__lahe.rail.cardNode(id).scrollIntoView({ block: "center" });
      return window.__lahe.rail.cardStateInfo(id);
    }, a.id);
    await page.mouse.click(info.chipRect.x + info.chipRect.width / 2, info.chipRect.y + info.chipRect.height / 2);
    const menu = await pollUntil(
      async () => {
        const got = await page.evaluate((id) => window.__lahe.rail.cardStateInfo(id), a.id);
        return got.open ? got : null;
      },
      { message: "the chip's menu to open" }
    );
    const item = menu.items.find((one) => one.label === "Mark as done");
    await page.mouse.click(item.rect.x + item.rect.width / 2, item.rect.y + item.rect.height / 2);
    await waitForItem(
      page,
      (id) => {
        const it = window.__lahe.items().find((i) => i.id === id);
        return !!it && it.state === "handled" && it.closed_by === "reviewer";
      },
      a.id,
      "Mark as done to close the choice"
    );
    await expectState(page, CSS_COUNTER, "done");
  });

  test("after handled a press is a new item; after not_handled it reopens the same one (V4)", async ({ page }) => {
    await ready(page, world);
    await press(page, CSS_COUNTER, "promote");
    const first = await latestChoice(page, CSS_COUNTER);
    await expectState(page, CSS_COUNTER, "open");
    reply(world, { item: first.id, rev: first.rev, status: "handled", text: "Promoted." });
    await expectState(page, CSS_COUNTER, "done");

    await press(page, CSS_COUNTER, "discard");
    const second = await latestChoice(page, CSS_COUNTER);
    expect(second.id, "a press after handled is a new item").not.toBe(first.id);
    expect(second.rev).toBe(1);
    expect((await groupPaint(page, CSS_COUNTER)).pressed).toEqual(["discard"]);
    // The Done tab keeps the earlier decision.
    await pollPage(page, (id) => window.__lahe.rail.getCard(id).pane === "done", first.id, { message: "the earlier card in Done" });
    expect(await cardText(page, first.id)).toContain("Promote");

    await press(page, REVEAL, "promote");
    const r1 = await latestChoice(page, REVEAL);
    await expectState(page, REVEAL, "open");
    reply(world, { item: r1.id, rev: r1.rev, status: "not_handled", reason: "Duplicate of L14." });
    await expectState(page, REVEAL, "not_handled");
    await press(page, REVEAL, "discard");
    const r2 = await latestChoice(page, REVEAL);
    expect(r2.id, "a press after not_handled reopens the same item").toBe(r1.id);
    expect(r2.rev).toBe(r1.rev + 1);
    expect(r2.state).toBe("ready");
    expect(r2.choice.answer).toBe("discard");
    await expectState(page, REVEAL, "open");
  });

  test("a newer press is drawn beside data-chosen, and a reload keeps every state (V5 reload, V6)", async ({ page }) => {
    await ready(page, world);
    await press(page, MONITOR, "promote");
    const paint = await groupPaint(page, MONITOR);
    expect(paint.pressed, "the newer press is the pressed button").toEqual(["promote"]);
    expect(paint.chosen, "the source's decision is untouched").toEqual(["discard"]);
    await expectState(page, MONITOR, "open");
    const before = await latestChoice(page, MONITOR);

    await page.reload();
    await booted(page);
    await expectState(page, MONITOR, "open", "the state painted again after a reload");
    const after = await latestChoice(page, MONITOR);
    expect(after.id).toBe(before.id);
    expect((await groupPaint(page, MONITOR)).pressed).toEqual(["promote"]);
  });

  test("with the helper stopped a press is kept; the restarted helper stores it (V5)", async ({ page }) => {
    await ready(page, world);
    const pagesPort = new URL(world.open).port;
    await stopTempHelpers(world.stateDir);
    await pollPage(page, () => window.__lahe.status() === "kept_locally" || window.__lahe.failures().some((f) => f.code === "HELPER_UNREACHABLE"), undefined, {
      message: "the page to notice the helper is gone",
      timeoutMs: 30000
    });

    await press(page, CSS_COUNTER, "promote");
    const item = await latestChoice(page, CSS_COUNTER);
    expect(item.state).toBe("ready");
    await page.evaluate(() => window.__lahe.handle.sync.flush({ force: true }));
    expect((await groupPaint(page, CSS_COUNTER)).state, "kept while the helper is down").toBe("kept");
    const notStored = await page.evaluate(() => ({ status: window.__lahe.status(), chips: window.__lahe.failures().map((f) => f.code) }));
    expect(notStored.status === "kept_locally" || notStored.chips.indexOf("HELPER_UNREACHABLE") !== -1, "the rail says it is not stored").toBe(true);

    // The restart: same helper port, same pages port, same state folder.
    const env = Object.assign({}, world.env, { LAHE_PAGES_PORT: pagesPort });
    const child = spawn(process.execPath, [CLI, "serve", "--port", String(world.port), "--state-dir", world.stateDir], {
      cwd: REPO_ROOT,
      env: env,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    await expectState(page, CSS_COUNTER, "open", "the restarted helper to store the press");
    const lines = await pollUntil(
      () => {
        const got = drainLines(world).filter((l) => l.id === item.id);
        return got.length ? got : null;
      },
      { message: "the press on the drain after the restart", timeoutMs: 30000 }
    );
    expect(lines[0].choice).toEqual({ group: CSS_COUNTER, answer: "promote" });
  });

  test("a rebuild that moves a group keeps its state; one that removes or renames it marks the press lost (V7)", async ({ page }) => {
    await ready(page, world);
    await press(page, CSS_COUNTER, "promote");
    await press(page, PANDOC, "promote");
    await press(page, REVEAL, "discard");
    const moved = await latestChoice(page, CSS_COUNTER);
    const removed = await latestChoice(page, PANDOC);
    const renamed = await latestChoice(page, REVEAL);
    await expectState(page, CSS_COUNTER, "open");
    await expectState(page, PANDOC, "open");
    await expectState(page, REVEAL, "open");
    reply(world, { item: removed.id, rev: removed.rev, status: "handled", text: "Promoted." });
    await expectState(page, PANDOC, "done");

    // The agent rebuilds: the counter section moves to the end, the pandoc
    // group (handled) is gone, and the reveal group is renamed.
    const text = fs.readFileSync(world.source, "utf8");
    const sections = text.split(/\n(?=## )/);
    const head = sections[0];
    const counter = sections.find((s) => s.indexOf(CSS_COUNTER) !== -1);
    const reveal = sections.find((s) => s.indexOf(REVEAL) !== -1).replace('data-choice="' + REVEAL + '"', 'data-choice="lesson-reveal-timer-2"');
    const monitor = sections.find((s) => s.indexOf(MONITOR) !== -1);
    fs.writeFileSync(world.source, [head, reveal, monitor, counter].join("\n"));

    await pollPage(page, () => !document.querySelector('.choice[data-choice="lesson-pandoc-section"]'), undefined, {
      message: "the page to show the rebuild",
      timeoutMs: 30000
    });
    await booted(page);
    await expectState(page, CSS_COUNTER, "open", "the moved group keeps its state");
    expect((await groupPaint(page, CSS_COUNTER)).pressed).toEqual(["promote"]);
    const order = await page.evaluate(() => Array.from(document.querySelectorAll(".choice")).map((g) => g.getAttribute("data-choice")));
    expect(order[order.length - 1], "it really moved").toBe(CSS_COUNTER);

    // The renamed group: the press is lost, never bound to the new name.
    await waitForItem(
      page,
      (id) => {
        const it = window.__lahe.items().find((i) => i.id === id);
        return !!it && !!it.region.lost;
      },
      renamed.id,
      "the press on the renamed group to be marked lost"
    );
    const lost = (await choices(page, REVEAL)).find((i) => i.id === renamed.id);
    expect(lost.region.lost.code).toBe("CHOICE_GROUP_GONE");
    expect(await groupPaint(page, "lesson-reveal-timer-2")).toEqual({ state: null, inert: null, pressed: [], chosen: [] });
    expect(await cardText(page, renamed.id)).toContain("This choice is no longer on the page.");
    const stillOnDrain = await pollUntil(
      () => {
        const got = drainLines(world).filter((l) => l.id === renamed.id);
        return got.length && got[0].lost ? got : null;
      },
      { message: "the lost press still on the drain, saying it is lost", timeoutMs: 30000 }
    );
    expect(stillOnDrain[0].lost.code).toBe("CHOICE_GROUP_GONE");

    // The handled press on the removed group: not lost, nothing painted.
    const handled = (await choices(page, PANDOC)).find((i) => i.id === removed.id);
    expect(handled.state).toBe("handled");
    expect(handled.region.lost).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// V8: the click is not a press while something else owns it
// ---------------------------------------------------------------------------

test.describe("a press only in browse, in a window that may write", () => {
  let world = null;

  test.beforeEach(async () => {
    world = await openWorld("choice-doc.html");
  });

  test.afterEach(async () => {
    await closeWorld(world);
    world = null;
  });

  test("pick mode, an open edit, present mode and a read-only window are not presses; a form submits nothing (V8)", async ({ page, context }) => {
    await ready(page, world);
    expect((await page.evaluate(() => window.__lahe.choices.armed())).sort()).toEqual(["inside-form", "ship-menu-bar"]);
    await expect(page.locator("#submits"), "the page's own submit counter is running").toHaveText("0");
    const url = page.url();

    // Element-pick mode: the click picks the element, it does not press.
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    await pollPage(page, () => window.__lahe.pickMode() === true, undefined, { message: "pick mode to open" });
    await page.click(buttonSel("ship-menu-bar", "ship"));
    expect(await choices(page), "a pick is not a press").toEqual([]);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__lahe.handle.comments.closeAll());
    await pollPage(page, () => window.__lahe.pickMode() === false, undefined, { message: "pick mode to close" });

    // A block open for editing: the click commits the edit, it does not press.
    await placeCaret(page, { selector: "section.sheet p", offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "a block to open for editing" });
    await page.click(buttonSel("ship-menu-bar", "hold"));
    expect(await choices(page), "a click that leaves an edit is not a press").toEqual([]);
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the edit to commit" });

    // Present mode.
    await page.evaluate(() => window.__lahe.present(true));
    await page.click(buttonSel("ship-menu-bar", "ship"));
    expect(await choices(page), "a click while presenting is not a press").toEqual([]);
    await page.evaluate(() => window.__lahe.present(false));

    // A group inside a form: the press is a record, and the form never
    // submits. "Rework" has no type, so it is a submit button by default; the
    // page counts its form's own submit events.
    await press(page, "inside-form", "rework");
    expect((await latestChoice(page, "inside-form")).choice.answer).toBe("rework");
    // A beat for a submit to land, if one were coming. A submit fires during
    // the click's own activation, so two rendered frames later it has long
    // since been counted.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator("#submits"), "the form never submitted").toHaveText("0");
    expect(page.url(), "and nothing navigated").toBe(url);

    // A second window on the same review is read-only: its click is not a press.
    const other = await context.newPage();
    await other.goto(world.open);
    await booted(other);
    await pollPage(other, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
      message: "the second window's claim to be decided"
    });
    const readOnly = await other.evaluate(() => window.__lahe.handle.sync.status().readOnly === true);
    expect(readOnly, "the second window is read-only").toBe(true);
    const countBefore = (await choices(other)).length;
    await other.click(buttonSel("ship-menu-bar", "hold"));
    expect((await choices(other)).length, "a read-only window mints nothing").toBe(countBefore);
    expect(await other.evaluate(() => window.__lahe.choices.counters().refusedPresses)).toBeGreaterThan(0);
    await other.close();
  });
});

// ---------------------------------------------------------------------------
// V2: broken groups
// ---------------------------------------------------------------------------

test.describe("groups an agent got wrong", () => {
  let world = null;

  test.beforeEach(async () => {
    world = await openWorld("choice-broken.md");
  });

  test.afterEach(async () => {
    await closeWorld(world);
    world = null;
  });

  test("each broken group is inert and the chip names it and why; the valid one arms (V2)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await ready(page, world);
    expect(await page.evaluate(() => window.__lahe.choices.armed())).toEqual(["fine"]);
    const inert = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".choice")).map((g) => ({
        name: g.getAttribute("data-choice"),
        inert: g.getAttribute("data-lahe-inert")
      }))
    );
    expect(inert).toEqual([
      { name: null, inert: "no-name" },
      { name: "Has Spaces And Caps", inert: "bad-name" },
      { name: "twin", inert: "duplicate" },
      { name: "twin", inert: "duplicate" },
      { name: "lonely", inert: "too-few-buttons" },
      { name: "bad-value", inert: "bad-value" },
      { name: "wrapped", inert: "nested-buttons" },
      { name: "same-value", inert: "same-value" },
      { name: "two-chosen", inert: "two-chosen" },
      { name: "fine", inert: null }
    ]);
    const chip = await page.evaluate(() => window.__lahe.failures().find((f) => f.code === "CHOICE_GROUP_INERT") || null);
    expect(chip, "one chip for the broken groups").toBeTruthy();
    expect(chip.detail).toContain('The choice asking "No name on this group.": it has no data-choice name.');
    expect(chip.detail).toContain('"Has Spaces And Caps" is not 1 to 32 lowercase letters, digits and hyphens');
    expect(chip.detail).toContain("The choice twin: 2 groups on this page are named twin.");
    expect(chip.detail).toContain("The choice lonely: it has only one button.");
    expect(chip.detail).toContain('The choice bad-value: the button "Yes" has the value "yes please do it"');
    expect(chip.detail).toContain("The choice wrapped: its buttons must sit directly inside the group");
    expect(chip.detail).toContain("The choice same-value: two buttons have the value yes.");
    expect(chip.detail).toContain("The choice two-chosen: more than one button carries data-chosen.");

    // A click on an inert group is the page's: nothing is minted.
    await page.click(buttonSel("lonely", "yes"));
    await page.click(buttonSel("twin", "yes"));
    await page.click(buttonSel("wrapped", "no"));
    await page.click(buttonSel("same-value", "yes"));
    await page.click(buttonSel("two-chosen", "no"));
    expect(await choices(page)).toEqual([]);
    // The valid one presses.
    await press(page, "fine", "no");
    expect((await latestChoice(page, "fine")).choice.answer).toBe("no");

    await page.evaluate(() => window.__lahe.rail.selectTab("active"));
    await page.mouse.move(1, 1);
    await shot(page, "choice_inert_chip_light.png");
  });
});
