// THE GRACEFUL-FAILURE NET: every way the stamp can be confidently wrong.
//
// Ken, 2026-09-11: "I would much rather have graceful failures than quiet
// failures or destroying work."
//
// `data-lahe-id` is the top rung of the write ladder, so it is also the newest
// way to be certain and wrong. Each case below is a REBUILT PAGE that lies to
// the engine in a different way, and each one has to end the same way: nothing
// written, the record stamped lost with a sentence the reviewer can read, and
// the page exactly as the rebuild left it.
//
// The cases, from docs/ongoing/FINGERPRINTING.md:
//
//   S1  the same id on two elements (a copy-paste in the source)
//   S2  the id moved to an element whose words are not the reviewer's
//   S4  the id is gone and the words are on the page twice
//   S6  the reviewer is mid-edit in the block when the rebuild lands
//   S7  the agent replied handled and the id never reached the source
//
// S3 (a stale id and no words either) and S5 (the tie-breakers disagree) are
// decided in test/unit/anchor_cases.test.js, and S8 (a probable place is never
// a write target) is a property of the two functions rather than of a page.
//
// Nothing here is simulated. It is the real `lahe review` walk, so the session,
// the helper, the static server, the injected script line and review.json are
// the real ones, and a "rebuild" is what a rebuild actually is: somebody else's
// program overwriting the source file.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

// One review per test. These pages lie to the engine in ways that leave a
// record stamped lost, and a shared walk would carry one test's wreckage into
// the next one's assertions about an untouched page.
test.describe.configure({ mode: "serial" });

// The neighbours are identical on every copy on purpose: that is what makes the
// duplicated block genuinely ambiguous instead of separable by its surroundings.
const LEAD = "A lead-in line, the same above every copy.";
const TRAIL = "A trailing line, the same below every copy.";
const P_BEFORE = "The trainer writes the plan every week.";
// What the reviewer retypes it as.
const MINE = "The trainer writes the plan each week.";
// What a rebuild says instead: the original sentence with the agent's own
// sentence added, so the record still finds the block and the two versions
// genuinely collide.
const THEIRS = P_BEFORE + " Five minutes of easy jogging is enough.";
// Words that are nobody's edit, for the id to be moved onto.
const ELSEWHERE = "Runners come back too fast after a layoff.";

/** One paragraph, with the id the reviewer's page minted if it is given one. */
function block(text, options) {
  const opts = options || {};
  const id = opts.id ? ' id="' + opts.id + '"' : "";
  const stamp = opts.stamp ? ' data-lahe-id="' + opts.stamp + '"' : "";
  return { text: text, html: "<p" + id + stamp + ">" + text + "</p>" };
}

// The blocks go on ONE line inside <main>, so the page's text content is
// exactly the blocks' text joined. That is what makes "nothing was written"
// a string comparison rather than a whitespace argument.
function docHtml(blocks) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Steady Pace</title></head>',
    "<body>",
    "<main>" + blocks.map((b) => b.html).join("") + "</main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

function textOf(blocks) {
  return blocks.map((b) => b.text).join("");
}

/** The page as the reviewer first opens it. */
function startBlocks() {
  return [block(LEAD, { id: "lead" }), block(P_BEFORE, { id: "p" }), block(TRAIL, { id: "trail" })];
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

/** The documented walk, run exactly as a person would type it. */
async function openReview() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-graceful-"));
  const stateDir = path.join(root, "state");
  const work = path.join(root, "work");
  fs.mkdirSync(work, { recursive: true });
  const pagePath = path.join(work, "doc.html");
  fs.writeFileSync(pagePath, docHtml(startBlocks()));

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

  return {
    stateDir: stateDir,
    pagePath: pagePath,
    env: env,
    session: session,
    review: review,
    open: open,
    reviewJson: path.join(stateDir, "reviews", review, "review.json"),
    repliesPath: path.join(stateDir, "reviews", review, "replies.jsonl")
  };
}

function closeReview(world) {
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
}

/** A build: somebody else's program overwrites the source, and the page reloads. */
function rebuild(world, blocks) {
  fs.writeFileSync(world.pagePath, docHtml(blocks));
  // The mtime is the reload signal, and a coarse-timestamp filesystem can give
  // two quick writes the same one.
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(world.pagePath, later, later);
}

/**
 * The baseline the reload watcher needs before it can see a change.
 *
 * The library learns the source's mtime from the helper's poll, and the FIRST
 * value it hears is a baseline rather than news. So a page that never rebuilds
 * before the one rebuild a test cares about will sit there: the change it wanted
 * noticed is the value that initialized the watcher. Rewriting the same document
 * is what primes it, and it is what auto_reload.spec.js does too.
 */
async function prime(page, world, blocks) {
  rebuild(world, blocks);
  await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
    message: "the library to learn the source's mtime",
    timeoutMs: 20000
  });
}

/** The agent's whole API: one appended JSON line. */
function reply(world, itemId, rev) {
  fs.appendFileSync(
    world.repliesPath,
    JSON.stringify({ item: itemId, rev: rev, status: "handled", agent: "tester", files: ["doc.html"] }) + "\n"
  );
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its own script tag",
    timeoutMs: 20000
  });
  // A LAHE reload waits for the reviewer to be still. This suite types and then
  // expects a reload, so it shortens that window rather than sitting out ten
  // real seconds per test.
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

/** Cmd-Shift-E, select the block, retype it. Left OPEN: the caller commits. */
async function startEdit(page, blockId, text) {
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
}

/** A whole hand edit: retype the block and commit it. */
async function handEdit(page, blockId, text) {
  await startEdit(page, blockId, text);
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
    message: "Esc to commit the hand edit on #" + blockId
  });
  await page.evaluate(() => window.__lahe.handle.comments.closeAll());
  await pollPage(
    page,
    (after) => !!window.__lahe.items().find((item) => item.kind === "edit" && item.after === after),
    text,
    { message: "the hand edit to land as a ready record" }
  );
  return page.evaluate((after) => {
    const found = window.__lahe.items().find((item) => item.kind === "edit" && item.after === after);
    return {
      id: found.id,
      rev: found.rev,
      // The id the reviewer's page wrote onto the element. An agent editing the
      // source is asked to carry this across; these tests carry it, or move it,
      // or duplicate it, which is the whole suite.
      stamp: document.getElementById("p").getAttribute("data-lahe-id")
    };
  }, text);
}

/** The page's own text, which is the thing that must not change. */
function mainText(page) {
  return page.evaluate(() => document.querySelector("main").textContent);
}

function itemOn(page, id) {
  return page.evaluate((itemId) => {
    const found = window.__lahe.items().find((item) => item.id === itemId);
    if (!found) return null;
    return {
      state: found.state,
      lost: (found.region && found.region.lost) || null,
      written: window.__lahe.counters.regionsWritten
    };
  }, id);
}

/** The record as the AGENT reads it, which is the other half of every claim. */
async function projected(world, id) {
  return pollUntil(
    () => {
      if (!fs.existsSync(world.reviewJson)) return null;
      let file = null;
      try {
        file = JSON.parse(fs.readFileSync(world.reviewJson, "utf8"));
      } catch (err) {
        return null;
      }
      const pages = file.pages || [];
      for (let i = 0; i < pages.length; i += 1) {
        const found = (pages[i].items || []).find((item) => item.id === id);
        if (found && found.lost) return found;
      }
      return null;
    },
    { message: "review.json to carry the lost stamp for " + id, timeoutMs: 20000 }
  );
}

/** The verdict, once the settling window has closed and the pass has spoken. */
async function lostVerdict(page, id) {
  await pollPage(
    page,
    (itemId) => {
      const found = window.__lahe.items().find((item) => item.id === itemId);
      return !!(found && found.region && found.region.lost);
    },
    id,
    { message: "the replay pass to stamp the record lost", timeoutMs: 25000 }
  );
  return itemOn(page, id);
}

test.describe("the stamp's graceful failures: nothing written, and the reviewer is told", () => {
  let world = null;

  test.beforeEach(async () => {
    world = await openReview();
  });

  test.afterEach(async () => {
    closeReview(world);
    world = null;
  });

  test("S1: the same id on two elements writes to neither, and says which kind of no", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);
    await prime(page, world, startBlocks());
    const made = await handEdit(page, "p", MINE);
    expect(made.stamp, "the hand edit stamped the paragraph").toBeTruthy();

    // THE COPY-PASTE. A rebuild duplicated the block and the attribute with it,
    // so one id now names two elements. Neither is the answer.
    const twice = [
      block(LEAD),
      block(P_BEFORE, { stamp: made.stamp }),
      block(TRAIL),
      block(LEAD),
      block(P_BEFORE, { stamp: made.stamp }),
      block(TRAIL)
    ];
    rebuild(world, twice);
    await pollPage(page, (want) => document.querySelector("main").textContent === want, textOf(twice), {
      message: "the page to reload itself onto the duplicated block",
      timeoutMs: 20000
    });
    await booted(page);

    const verdict = await lostVerdict(page, made.id);
    expect(verdict.lost.code, "two elements under one id is ambiguity, and it says so").toBe("ANCHOR_AMBIGUOUS");
    expect(verdict.lost.reason, "in the words the engine wrote for the reviewer").toContain(
      "two elements carry this id"
    );
    expect(verdict.written, "and nothing was written").toBe(0);
    expect(await mainText(page), "both paragraphs are exactly as the rebuild left them").toBe(textOf(twice));

    const agentSees = await projected(world, made.id);
    expect(agentSees.lost.code).toBe("ANCHOR_AMBIGUOUS");
    expect(agentSees.lost.reason, "review.json says the same thing the card does").toContain(
      "two elements carry this id"
    );
  });

  test("S2: the id over somebody else's words writes nothing, even where the words still are", async ({
    page
  }) => {
    await page.goto(world.open);
    await booted(page);
    await prime(page, world, startBlocks());
    const made = await handEdit(page, "p", MINE);

    // THE WRONG TWIN. The agent put the attribute on the wrong element. The
    // reviewer's own paragraph is still sitting there, findable by its words,
    // and the write still refuses: identity is certain and it disagrees, which
    // is exactly when a write must not land on a maybe.
    const moved = [
      block(LEAD),
      block(P_BEFORE, { id: "p" }),
      block(TRAIL),
      block(ELSEWHERE, { id: "other", stamp: made.stamp })
    ];
    rebuild(world, moved);
    await pollPage(page, (want) => document.querySelector("main").textContent === want, textOf(moved), {
      message: "the page to reload itself onto the moved id",
      timeoutMs: 20000
    });
    await booted(page);

    const verdict = await lostVerdict(page, made.id);
    expect(verdict.lost.reason, "the card says where the id is pointing").toContain(
      "the stamp points at different words"
    );
    expect(verdict.written, "and nothing was written, here or anywhere").toBe(0);
    expect(await mainText(page), "the page is as the rebuild left it").toBe(textOf(moved));

    const agentSees = await projected(world, made.id);
    expect(agentSees.lost.reason, "review.json says it too").toContain("the stamp points at different words");
  });

  test("S4: no id and the words twice over refuses, exactly as it did before ids existed", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);
    await prime(page, world, startBlocks());
    const made = await handEdit(page, "p", MINE);

    // The rebuild dropped the attribute AND duplicated the block. Symmetric all
    // the way out: the same neighbour above and below each copy, so widening
    // cannot separate them and only position could. D9 says position never does.
    const twice = [
      block(LEAD),
      block(P_BEFORE, { id: "p" }),
      block(TRAIL),
      block(LEAD),
      block(P_BEFORE),
      block(TRAIL)
    ];
    rebuild(world, twice);
    await pollPage(page, (want) => document.querySelector("main").textContent === want, textOf(twice), {
      message: "the page to reload itself onto the duplicated block",
      timeoutMs: 20000
    });
    await booted(page);

    const verdict = await lostVerdict(page, made.id);
    expect(verdict.lost.code, "the pre-stamp answer, unchanged").toBe("ANCHOR_AMBIGUOUS");
    expect(verdict.lost.reason, "and it says how many places matched").toContain("more than one place");
    expect(verdict.written).toBe(0);
    expect(await mainText(page), "neither copy was written to").toBe(textOf(twice));

    const agentSees = await projected(world, made.id);
    expect(agentSees.lost.code).toBe("ANCHOR_AMBIGUOUS");
  });

  test("S6: a rebuild under an open edit waits, and then collides rather than overwriting", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);
    await claim(page);
    await prime(page, world, startBlocks());

    // The reviewer is mid-edit IN THE BLOCK: the box is open and the words are
    // typed, not committed. This is the moment the feature could do real harm.
    await startEdit(page, "p", MINE);
    expect(await page.evaluate(() => window.__lahe.isEditing()), "the edit is open").toBe(true);

    const theirs = [block(LEAD), block(THEIRS, { id: "p" }), block(TRAIL)];
    rebuild(world, theirs);

    // The library NOTICED and DECIDED, which is what makes the next assertion a
    // fact rather than a race won by being slow.
    await pollUntil(
      async () => (await page.evaluate(() => window.__lahe.handle.sync.status().reloadChecks)) >= 1,
      { message: "the library to reach its reload decision", timeoutMs: 20000 }
    );
    const deferred = await page.evaluate(() => {
      const status = window.__lahe.handle.sync.status();
      return { fired: status.reloadsFired, pending: status.reloadPending, editing: window.__lahe.isEditing() };
    });
    expect(deferred.fired, "the page did not reload out from under the open edit").toBe(0);
    expect(deferred.pending, "and the reload is deferred, not dropped").toBe(true);
    expect(deferred.editing, "the reviewer is still in the block").toBe(true);
    expect(await page.evaluate(() => document.getElementById("p").textContent), "their words are untouched").toBe(
      MINE
    );

    // They put their pen down. Now the page is allowed to catch up.
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the hand edit"
    });
    await page.evaluate(() => window.__lahe.handle.comments.closeAll());
    const made = await page.evaluate((after) => {
      const found = window.__lahe.items().find((item) => item.kind === "edit" && item.after === after);
      return found ? { id: found.id, rev: found.rev } : null;
    }, MINE);
    expect(made, "the edit committed as a record before the reload landed").toBeTruthy();

    await pollPage(page, (want) => document.querySelector("main").textContent === want, textOf(theirs), {
      message: "the deferred reload to land once the reviewer is still",
      timeoutMs: 20000
    });
    await booted(page);

    // THE CONFLICT BRANCH. The block is findable and holds neither the
    // reviewer's version nor anything this record has ever said, so both
    // versions go on the card and NOTHING is written.
    await pollPage(
      page,
      (id) => window.__lahe.flaggedIds().indexOf(id) !== -1,
      made.id,
      { message: "the collision to be flagged on the card", timeoutMs: 25000 }
    );
    const conflict = await page.evaluate((id) => {
      const flagged = window.LAHE.replay.conflictFor(id);
      return flagged ? { yours: flagged.yours, theirs: flagged.theirs } : null;
    }, made.id);
    expect(conflict.yours, "the card shows the reviewer's version").toBe(MINE);
    expect(conflict.theirs, "and the page's").toBe(THEIRS);
    expect(await mainText(page), "and the page still says what the rebuild said").toBe(textOf(theirs));
    expect(await page.evaluate(() => window.__lahe.counters.regionsWritten), "nothing was written").toBe(0);
    const state = await itemOn(page, made.id);
    expect(state.lost, "a collision is not a lost anchor: the block was found").toBe(null);
  });

  test("S7: handled, and the id never reached the source: reopened once, and once only", async ({ page }) => {
    await page.goto(world.open);
    await booted(page);
    await prime(page, world, startBlocks());
    const made = await handEdit(page, "p", MINE);

    // The agent applies the words and drops the attribute. The page READS
    // right, which is why nothing else catches this: the only thing missing is
    // the one signal that finds this element with certainty next time.
    const applied = [block(LEAD), block(MINE, { id: "p" }), block(TRAIL)];
    rebuild(world, applied);
    await pollPage(page, (want) => document.querySelector("main").textContent === want, textOf(applied), {
      message: "the page to reload itself onto the agent's rewrite",
      timeoutMs: 20000
    });
    await booted(page);
    reply(world, made.id, made.rev);
    await pollPage(
      page,
      (id) => {
        const found = window.__lahe.items().find((item) => item.id === id);
        return !!found && found.state === "handled";
      },
      made.id,
      { message: "the agent's reply to fold and move the item to Done", timeoutMs: 20000 }
    );

    // The page check runs on the next load and reopens it ONCE, asking for the
    // id rather than for the change.
    await page.reload();
    await booted(page);
    await pollPage(
      page,
      (id) => {
        const found = window.__lahe.items().find((item) => item.id === id);
        return !!found && found.state === "ready";
      },
      made.id,
      { message: "the page check to reopen the item on this load", timeoutMs: 25000 }
    );
    const reopened = await page.evaluate((id) => {
      const found = window.__lahe.items().find((item) => item.id === id);
      return { rev: found.rev, note: found.note, stamp: found.region.check_reopen };
    }, made.id);
    expect(reopened.note, "the note says which of the check's three things happened").toContain(
      "the data-lahe-id stamp did not reach the source"
    );
    expect(reopened.note, "and what to do about it").toContain("Write the stamp onto that element");
    expect(reopened.note.split("Reopened by the page check:").length - 1, "one sentence, not two").toBe(1);
    expect(reopened.stamp.rev, "the reopen stamped the revision it created").toBe(reopened.rev);
    expect(await page.evaluate(() => window.__lahe.counters.revertReopens), "one reopen on this load").toBe(1);
    expect(await mainText(page), "and the page itself was not touched").toBe(textOf(applied));

    // The agent answers handled again with the page unchanged, which is it
    // saying the rendering is intended. That has to end it.
    reply(world, made.id, reopened.rev);
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
      timeoutMs: 25000
    });
    expect(
      await page.evaluate(() => window.__lahe.counters.revertReopens),
      "the check reopened nothing on the second load"
    ).toBe(0);
    const settled = await page.evaluate((id) => {
      const found = window.__lahe.items().find((item) => item.id === id);
      return { state: found.state, rev: found.rev };
    }, made.id);
    expect(settled.state, "the item stays handled").toBe("handled");
    expect(settled.rev, "and no second reopen bumped the rev again").toBe(reopened.rev);
    expect(await mainText(page), "the page is still exactly as the agent built it").toBe(textOf(applied));
  });
});
