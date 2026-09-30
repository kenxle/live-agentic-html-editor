// Replay's insert path for a run record (free-writing plan Task 2.6).
//
// One test per row of the architecture's presence table, then the placement
// cases (after a sheet-head, the start of an empty notes page), the take-back,
// branch three for the run, the held run on the conflict card, and the two
// refusals (a forged tag, a gone anchor). Records are record_fixtures.js
// shapes; anchors are found by their stamp.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer } = require("../helpers");
const { openReplayPage, setItems } = require("./support/replay_run_page");
const fixtures = require("../../src/shared/record_fixtures.js");
const record = require("../../src/shared/record.js");

const FIXTURES = path.join(__dirname, "..", "fixtures");

let server = null;
test.beforeAll(async () => {
  server = await startStaticServer({ root: FIXTURES });
});
test.afterAll(async () => {
  if (server) await server.close();
});

const ANCHOR = "Most weeks look busy from the outside. This one did not.";
const LONG_A = "The first new paragraph has enough words zqxcanary";
const LONG_B = "The second new paragraph also has words zqxcanary";

function fx() {
  return fixtures.createFixtures({ seed: "2b-insert" });
}

function stamp(item, s, tag) {
  item.region = { ref: { id: "ref_" + s, probe: null, stamp: s, fingerprint: { tag: tag } }, label: "anchor", lost: null };
  return item;
}

// A run after the blog's first paragraph, which the reviewer did not reword.
function blogRun(blocks, extra) {
  return stamp(
    fx().runItem(
      Object.assign({ before: ANCHOR, before_html: ANCHOR, anchor_after_html: ANCHOR, new_blocks: blocks }, extra || {})
    ),
    "s-p1",
    "p"
  );
}

async function blog(page) {
  await openReplayPage(page, server, "free_writing/blog.html");
  await page.evaluate(() => document.getElementById("p1").setAttribute("data-lahe-id", "s-p1"));
}

// The article's blocks, as tag: text, in order.
function articleShape(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#post > *")).map((el) => el.tagName.toLowerCase() + ": " + el.textContent.replace(/\s+/g, " ").trim())
  );
}

function afterP1(page, html) {
  return page.evaluate((markup) => document.getElementById("p1").insertAdjacentHTML("afterend", markup), html);
}

test.describe("the presence table, row by row", () => {
  test("present one to one with the right tag and markup: nothing is written", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>" + LONG_A + "</p><p>" + LONG_B + "</p>");
    await setItems(page, [blogRun([{ tag: "p", html: LONG_A }, { tag: "p", html: LONG_B }])]);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(false);
    expect(await page.evaluate((t) => window.__count(t), LONG_A)).toBe(1);
  });

  test("present one to one with the wrong tag: the tag is swapped in place and the card says so", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>" + LONG_A + "</p>");
    const item = blogRun([{ tag: "h2", html: LONG_A }]);
    await setItems(page, [item]);
    await page.evaluate(() => window.__pass());
    const shape = await articleShape(page);
    expect(shape.slice(1, 3)).toEqual(["p: " + ANCHOR, "h2: " + LONG_A]);
    expect(shape.filter((s) => s.indexOf(LONG_A) !== -1)).toHaveLength(1);
    const badge = await page.evaluate((id) => window.__cards.badges[id].REPLAY_RUN_WRONG_TAG, item.id);
    expect(badge.message).toBe(
      "The agent placed 'The first new paragraph has enough...' as a paragraph. You wrote a heading, so Lahe sent it back."
    );
  });

  test("present one to one with the bold lost: the block's markup is rewritten in place", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>I lost my place every time zqxcanary</p>");
    await setItems(page, [blogRun([{ tag: "p", html: "I lost my place <strong>every</strong> time zqxcanary" }])]);
    await page.evaluate(() => window.__pass());
    const html = await page.evaluate(() => document.getElementById("p1").nextElementSibling.innerHTML);
    expect(html).toBe("I lost my place <strong>every</strong> time zqxcanary");
    expect(await page.evaluate(() => window.__count("I lost my place every time zqxcanary"))).toBe(1);
  });

  test("present but joined into one block: left as the page has it", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>" + LONG_A + " " + LONG_B + "</p>");
    await setItems(page, [blogRun([{ tag: "h2", html: LONG_A }, { tag: "p", html: LONG_B }])]);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(false);
    const shape = await articleShape(page);
    expect(shape[2]).toBe("p: " + LONG_A + " " + LONG_B);
  });

  test("present but split over two blocks: left as the page has it", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>The first new paragraph</p><p>has enough words zqxcanary</p>");
    await setItems(page, [blogRun([{ tag: "h3", html: LONG_A }])]);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(false);
    expect((await articleShape(page)).slice(2, 4)).toEqual(["p: The first new paragraph", "p: has enough words zqxcanary"]);
  });

  test("missing from the walk and five or more words found elsewhere: nothing is written and the card says so", async ({ page }) => {
    await blog(page);
    // Far enough down that the walk stops before it.
    await page.evaluate((t) => document.getElementById("list").insertAdjacentHTML("afterend", "<p>" + t + "</p>"), LONG_A);
    const item = blogRun([{ tag: "p", html: LONG_A }]);
    await setItems(page, [item]);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(false);
    expect(await page.evaluate((t) => window.__count(t), LONG_A)).toBe(1);
    const badge = await page.evaluate((id) => window.__cards.badges[id].REPLAY_RUN_PLACED_ELSEWHERE, item.id);
    expect(badge.message).toBe("'The first new paragraph has enough...' is already further down the page, so Lahe did not add it again.");
  });

  test("a short block whose words appear further down, past the walk's stop, is inserted", async ({ page }) => {
    await blog(page);
    await page.evaluate(() => document.getElementById("list").insertAdjacentHTML("afterend", "<p>Notes zqxcanary</p>"));
    await setItems(page, [blogRun([{ tag: "p", html: "Notes zqxcanary" }])]);
    await page.evaluate(() => window.__pass());
    const shape = await articleShape(page);
    expect(shape[2]).toBe("p: Notes zqxcanary");
    expect(shape.filter((s) => s === "p: Notes zqxcanary")).toHaveLength(2);
  });

  test("a missing block goes after the last present block before it, with its own tag and markup", async ({ page }) => {
    await blog(page);
    await afterP1(page, "<p>" + LONG_A + "</p><p>" + LONG_B + "</p>");
    const middle = "A <em>middle</em> heading between the two zqxcanary";
    await setItems(page, [blogRun([{ tag: "p", html: LONG_A }, { tag: "h3", html: middle }, { tag: "p", html: LONG_B }])]);
    await page.evaluate(() => window.__pass());
    expect((await articleShape(page)).slice(1, 5)).toEqual([
      "p: " + ANCHOR,
      "p: " + LONG_A,
      "h3: A middle heading between the two zqxcanary",
      "p: " + LONG_B
    ]);
    const html = await page.evaluate(() => document.querySelector("#post h3").innerHTML);
    expect(html).toBe(middle);
    const again = await page.evaluate(() => window.__pass());
    expect(again[0].wrote).toBe(false);
  });

  test("with nothing present, the run goes at the anchor's insert point, in order", async ({ page }) => {
    await blog(page);
    const f = fx();
    const worked = f.runFixtures().find((x) => x.name === "worked example").item;
    const item = blogRun(worked.new_blocks);
    await setItems(page, [item]);
    await page.evaluate(() => window.__pass());
    expect((await articleShape(page)).slice(1, 5)).toEqual([
      "p: " + ANCHOR,
      "h2: What the chat window cost me zqxcanary",
      "p: I lost my place every time zqxcanary",
      "ul: scrollingre-asking zqxcanary"
    ]);
  });
});

test("a run with an h2 on the Markdown render lands after the sheet-head, not inside it", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/md_render.html");
  await page.evaluate(() => document.querySelector("section h2").setAttribute("data-lahe-id", "s-h2"));
  const item = stamp(
    fx().runItem({
      new_blocks: [
        { tag: "h2", html: "A new heading zqxcanary" },
        { tag: "p", html: "A line under the <strong>new</strong> heading zqxcanary" }
      ]
    }),
    "s-h2",
    "h2"
  );
  await setItems(page, [item]);
  await page.evaluate(() => window.__pass());
  const got = await page.evaluate(() => {
    const head = document.querySelector("section .sheet-head");
    return {
      headKids: Array.from(head.children).map((c) => c.tagName.toLowerCase()),
      next: head.nextElementSibling.outerHTML,
      after: head.nextElementSibling.nextElementSibling.outerHTML
    };
  });
  expect(got.headKids).toEqual(["h2", "span"]);
  expect(got.next).toBe("<h2>A new heading zqxcanary</h2>");
  expect(got.after).toBe("<p>A line under the <strong>new</strong> heading zqxcanary</p>");
});

test("the start_of_container record on the empty notes page lands after the marked title, and a reload raises no conflict", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/empty_notes.html");
  const item = fx().runFixtures().find((x) => x.name === "start of container").item;
  await setItems(page, [item]);
  await page.evaluate(() => window.__pass());
  const shape = await page.evaluate(() =>
    Array.from(document.querySelector("main").children).map((el) => el.tagName.toLowerCase() + ": " + el.textContent.trim())
  );
  expect(shape).toEqual(["div: empty_notes.md", "h2: Notes zqxcanary", "p: First thought zqxcanary"]);
  // The agent placed the notes in the file; the page reloads with them in it.
  await openReplayPage(page, server, "free_writing/empty_notes.html");
  await page.evaluate(() =>
    document.querySelector("main").insertAdjacentHTML("beforeend", "<h2>Notes zqxcanary</h2><p>First thought zqxcanary</p>")
  );
  await setItems(page, [item]);
  const r = await page.evaluate(() => window.__pass());
  expect(r[0].branch).not.toBe("content_changed");
  expect(r[0].wrote).toBe(false);
  expect(await page.evaluate(() => Object.keys(window.__cards.nodes))).toEqual([]);
  expect(await page.evaluate(() => window.__count("First thought zqxcanary"))).toBe(1);
});

test("a take-back removes the listed blocks, inserts nothing, and they stay gone over two reloads", async ({ page }) => {
  const placed =
    "<h2>What the chat window cost me zqxcanary</h2><p>I lost my place <strong>every</strong> time zqxcanary</p><ul><li>scrolling</li><li>re-asking zqxcanary</li></ul>";
  const f = fx();
  const original = stamp(f.runFixtures().find((x) => x.name === "worked example").item, "s-wc", "p");
  original.state = record.STATE.HANDLED;
  const back = record.revertOf(original, { created_at: fixtures.FIXED_AT });
  back.id = "itm_takeback_1";
  // The original is still in the list, outstanding, the way an undo leaves it
  // in the store before the helper hears: it must never be replayed again.
  const again = Object.assign({}, original, { state: record.STATE.READY });
  for (let load = 0; load < 3; load += 1) {
    await openReplayPage(page, server, "free_writing/blog.html");
    await page.evaluate(
      (markup) => {
        const p = document.getElementById("p1");
        p.textContent = "What changed";
        p.setAttribute("data-lahe-id", "s-wc");
        p.insertAdjacentHTML("afterend", markup);
      },
      placed
    );
    await setItems(page, [again, back]);
    await page.evaluate(() => window.__pass());
    const shape = await articleShape(page);
    expect(shape.slice(1, 3)).toEqual(["p: What changed", "h2: What changed"]);
    expect(await page.evaluate(() => window.__count("zqxcanary"))).toBe(0);
  }
});

test("an earlier revision placed, then the current one reworded: the block is rewritten in place and shows once", async ({ page }) => {
  await blog(page);
  const EARLY = "An earlier run of the words zqxcanary";
  const NOW = "A reworded run of the words zqxcanary";
  const first = blogRun([{ tag: "p", html: EARLY }]);
  const built = record.buildRunAfter(ANCHOR, [{ tag: "p", html: NOW }]);
  const later = record.bumpRev(first, { new_blocks: [{ tag: "p", html: NOW }], after_html: built.after_html, after: built.after });
  await afterP1(page, "<p>" + EARLY + "</p>");
  await setItems(page, [later]);
  await page.evaluate(() => window.__pass());
  expect(await page.evaluate((t) => window.__count(t), NOW)).toBe(1);
  expect(await page.evaluate((t) => window.__count(t), EARLY)).toBe(0);
  expect((await articleShape(page))[2]).toBe("p: " + NOW);
});

test.describe("an anchor conflict holds the run", () => {
  const MINE = "Most weeks look busy. This one was quiet.";
  const THEIRS = ANCHOR + " The agent added this line.";

  async function conflicted(page) {
    await blog(page);
    const item = blogRun([{ tag: "p", html: LONG_A }, { tag: "p", html: LONG_B }], { anchor_after_html: MINE });
    await page.evaluate((t) => {
      document.getElementById("p1").textContent = t;
    }, THEIRS);
    await setItems(page, [item]);
    const r = await page.evaluate(() => window.__pass());
    return { item, r };
  }

  // The anchor waits on the answer and the run does not: either answer keeps
  // it, so it stays on the page after the page's anchor while the card waits
  // (flow walk, Fail 3 and design problem 2). The anchor itself is untouched.
  test("the card shows the run and its count, the run stays on the page after the page's anchor, and the second button says the run is kept", async ({
    page
  }) => {
    const { item, r } = await conflicted(page);
    expect(r[0], JSON.stringify(r[0])).toMatchObject({ branch: "content_changed" });
    expect((await articleShape(page)).slice(1, 4)).toEqual(["p: " + THEIRS, "p: " + LONG_A, "p: " + LONG_B]);
    const again = await page.evaluate(() => window.__pass());
    expect(again[0].wrote, "a second pass while waiting writes nothing").toBe(false);
    expect(await page.evaluate((t) => window.__count(t), LONG_A)).toBe(1);
    const card = await page.evaluate((id) => {
      const node = window.__cards.nodes[id];
      return {
        line: node.querySelector("[data-lahe-conflict-run-line]").textContent,
        blocks: Array.from(node.querySelectorAll("[data-lahe-conflict-run-block]")).map((n) => n.textContent),
        buttons: Array.from(node.querySelectorAll("[data-lahe-conflict-choice]")).map((b) => b.textContent)
      };
    }, item.id);
    expect(card.line).toBe("Your 2 new blocks are on the page after this paragraph. Either answer keeps them.");
    const note = await page.evaluate((id) => window.__cards.badges[id].REPLAY_NEITHER_MATCHES.message, item.id);
    expect(note).toBe("The page's paragraph changed after you edited it, so Lahe did not write your version over it. Your new text is kept.");
    expect(card.blocks).toEqual([LONG_A, LONG_B]);
    expect(card.buttons).toEqual(["Keep mine", "Take the page's, keep my new text"]);
  });

  test("Take the page's, keep my new text keeps the page's anchor and places the run", async ({ page }) => {
    const { item } = await conflicted(page);
    await page.evaluate((id) => window.__cards.nodes[id].querySelector('[data-lahe-conflict-choice="take_theirs"]').click(), item.id);
    expect((await articleShape(page)).slice(1, 4)).toEqual(["p: " + THEIRS, "p: " + LONG_A, "p: " + LONG_B]);
    const after = await page.evaluate(() => window.__pass());
    expect(after[0].branch).toBe("already_applied");
    expect(after[0].wrote).toBe(false);
    const kept = await page.evaluate(() => window.__items[0]);
    expect(kept.anchor_after_html).toBe(THEIRS);
    expect(kept.rev).toBe(item.rev + 1);
  });

  test("Keep mine applies both the anchor and the run", async ({ page }) => {
    const { item } = await conflicted(page);
    await page.evaluate((id) => window.__cards.nodes[id].querySelector('[data-lahe-conflict-choice="keep_mine"]').click(), item.id);
    expect((await articleShape(page)).slice(1, 4)).toEqual(["p: " + MINE, "p: " + LONG_A, "p: " + LONG_B]);
  });
});

test.describe("a run block the page holds with words the reviewer never typed is a conflict", () => {
  // Brief R6: the words stay as typed. "Joined" is a leaf whose words are
  // exactly new blocks, nothing else. A leaf holding a block's words plus a
  // sentence the agent added is neither present nor missing: inserting the
  // block would show the reviewer's words twice. It is a conflict on that
  // block, on the anchor conflict's card and buttons.
  const LONG_C = "The third new paragraph has words zqxcanary";
  const EXTRA = LONG_B + " The agent added this line.";

  async function clashed(page) {
    await blog(page);
    await afterP1(page, "<p>" + LONG_A + "</p><p>" + EXTRA + "</p>");
    const item = blogRun([{ tag: "p", html: LONG_A }, { tag: "p", html: LONG_B }, { tag: "p", html: LONG_C }]);
    await setItems(page, [item]);
    const before = await page.evaluate(() => document.getElementById("post").innerHTML);
    const r = await page.evaluate(() => window.__pass());
    return { item, r, before };
  }

  function sides(page, id) {
    return page.evaluate((itemId) => {
      const node = window.__cards.nodes[itemId];
      const text = (side) => node.querySelector('[data-lahe-conflict-side="' + side + '"] [data-lahe-conflict-text]').textContent;
      return { yours: text("yours"), theirs: text("theirs") };
    }, id);
  }

  test("replay writes nothing, the card is flagged, and it shows the reviewer's block and the page's", async ({ page }) => {
    const { item, r, before } = await clashed(page);
    expect(r[0], JSON.stringify(r[0])).toMatchObject({ wrote: false, branch: "content_changed" });
    expect(await page.evaluate(() => document.getElementById("post").innerHTML)).toBe(before);
    expect(await page.evaluate((t) => window.__count(t), LONG_C)).toBe(0);
    expect(await page.evaluate((id) => !!window.__cards.badges[id].REPLAY_NEITHER_MATCHES, item.id)).toBe(true);
    expect(await page.evaluate((id) => window.__cards.badges[id].REPLAY_NEITHER_MATCHES.message, item.id)).toBe(
      "On the page, your new paragraph has words you did not write. Lahe changed nothing. Pick the version that stands."
    );
    expect(await sides(page, item.id)).toEqual({ yours: LONG_B, theirs: EXTRA });
    expect(await page.evaluate(() => window.LAHE.replay.conflictIds())).toEqual([item.id]);
  });

  test("a second pass over the same page keeps the one conflict and writes nothing", async ({ page }) => {
    const { item, before } = await clashed(page);
    const again = await page.evaluate(() => window.__pass());
    expect(again[0].wrote).toBe(false);
    expect(await page.evaluate(() => document.getElementById("post").innerHTML)).toBe(before);
    expect(await page.evaluate(() => window.LAHE.replay.conflictIds())).toEqual([item.id]);
  });

  test("Keep mine rewrites that block to the reviewer's words, places the rest, and holds over a repaint", async ({ page }) => {
    const { item } = await clashed(page);
    await page.evaluate((id) => window.__cards.nodes[id].querySelector('[data-lahe-conflict-choice="keep_mine"]').click(), item.id);
    expect((await articleShape(page)).slice(1, 5)).toEqual(["p: " + ANCHOR, "p: " + LONG_A, "p: " + LONG_B, "p: " + LONG_C]);
    expect(await page.evaluate(() => window.LAHE.replay.conflictIds())).toEqual([]);
    // The page repaints from a source that still has the agent's sentence.
    await page.evaluate((t) => {
      document.getElementById("p1").nextElementSibling.nextElementSibling.textContent = t;
    }, EXTRA);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(true);
    expect((await articleShape(page)).slice(1, 5)).toEqual(["p: " + ANCHOR, "p: " + LONG_A, "p: " + LONG_B, "p: " + LONG_C]);
    expect(await page.evaluate(() => window.LAHE.replay.conflictIds())).toEqual([]);
  });

  test("Take the page's keeps the page's block, places the rest, and a later pass reads it as present", async ({ page }) => {
    const { item } = await clashed(page);
    await page.evaluate((id) => window.__cards.nodes[id].querySelector('[data-lahe-conflict-choice="take_theirs"]').click(), item.id);
    expect((await articleShape(page)).slice(1, 5)).toEqual(["p: " + ANCHOR, "p: " + LONG_A, "p: " + EXTRA, "p: " + LONG_C]);
    expect(await page.evaluate(() => window.LAHE.replay.conflictIds())).toEqual([]);
    const kept = await page.evaluate(() => window.__items[0]);
    expect(kept.new_blocks[1].html).toBe(EXTRA);
    expect(kept.rev).toBe(item.rev + 1);
    const r = await page.evaluate(() => window.__pass());
    expect(r[0].wrote).toBe(false);
    expect(await page.evaluate(() => window.LAHE.replay.conflictIds())).toEqual([]);
  });

  test("the page fixed by the agent clears the conflict with no answer", async ({ page }) => {
    const { item } = await clashed(page);
    await page.evaluate((t) => {
      document.getElementById("p1").nextElementSibling.nextElementSibling.textContent = t;
    }, LONG_B);
    await page.evaluate(() => window.__pass());
    expect(await page.evaluate(() => window.LAHE.replay.conflictIds())).toEqual([]);
    expect(await page.evaluate((id) => !!(window.__cards.badges[id] || {}).REPLAY_NEITHER_MATCHES, item.id)).toBe(false);
    expect(await page.evaluate((t) => window.__count(t), LONG_C)).toBe(1);
  });
});

test("a forged record with tag script writes nothing", async ({ page }) => {
  await blog(page);
  const forged = stamp(fx().forgedRuns().find((f) => f.code === "RUN_BLOCK_REFUSED").item, "s-p1", "p");
  forged.before = forged.before_html = forged.anchor_after_html = ANCHOR;
  const before = await page.evaluate(() => document.getElementById("post").innerHTML);
  await setItems(page, [forged]);
  const r = await page.evaluate(() => window.__pass());
  expect(r[0].wrote).toBe(false);
  expect(await page.evaluate(() => document.getElementById("post").innerHTML)).toBe(before);
  expect(await page.evaluate(() => document.querySelectorAll("#post script").length)).toBe(0);
});

test("a record whose anchor is not on the page goes lost and inserts nothing", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/blog.html");
  const item = stamp(fx().runItem({ before: "Words that are nowhere", before_html: "Words that are nowhere", anchor_after_html: "Words that are nowhere" }), "s-gone", "p");
  const before = await page.evaluate(() => document.getElementById("post").innerHTML);
  await setItems(page, [item]);
  const r = await page.evaluate(() => window.__pass());
  expect(r[0].lost).toBe(true);
  expect(await page.evaluate(() => document.getElementById("post").innerHTML)).toBe(before);
});
