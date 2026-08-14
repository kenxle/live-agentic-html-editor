// "Keep mine" on a page that is still repainting.
//
// Found by a real-browser walker on 2026-08-14, on the app fixture at
// /?morph=raw&poll=250 with the feed's source frozen. The reviewer edits a
// region, commits, the agent rewrites that sentence in the source, the card
// flags the collision, and the reviewer presses "Keep mine". The write lands,
// and the next morph pass 150ms later renders the region from source again and
// undoes it. The conflict re-raises, forever, and nothing tells the reviewer.
// With window.__app.morph.stop() the press sticks, which is what pins the cause:
// resolveConflict("keep_mine") was a ONE-SHOT WRITE, and every existing conflict
// spec runs with the morph off, so the suite never saw it.
//
// So this spec runs with the morph RUNNING. The reviewer's decision has to be
// carried by the ordinary replay engine, pass after pass, the same way any
// committed record is, even though the page's source still says the agent's
// sentence.
//
// THE SOURCE IS FROZEN, and that is the point rather than a convenience. The app
// fixture's feed advances a cursor on every poll, so consecutive morphs
// genuinely differ; a moving source would mean the region's text changed on
// every pass for reasons that have nothing to do with the reviewer's decision.
// Freezing it (one fixed body for /api/feed, flipped exactly once when "the
// agent rewrites the source") makes each pass a repeat of the same question:
// does the reviewer's answer still stand?
//
// The helper is deliberately down (a loopback port with nothing on it), which is
// the ordinary dev case. Nothing here is about sync.

"use strict";

const { test: base, expect, pollPage, pollUntil, placeCaret } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");
const { withLayer } = require("./support/with_layer");

const REVIEW = "keep-mine-live";
const TOKEN = "keep-mine-token";

// The sentence the reviewer edits, the words they add, and the words the agent
// later adds to the SOURCE. The agent's rewrite EXTENDS the original sentence on
// purpose: an anchor is placed by text and by nothing else, so a rewrite that
// replaced the sentence outright would be a lost anchor (a different, honest
// outcome) rather than the collision this spec is about.
const ORIGINAL = "Devon has missed two easy runs in a row and has not said why.";
const REVIEWER_TAIL = " Text him before lunch.";
const AGENT_TAIL = " The agent rewrote this from the source.";

const MINE = ORIGINAL + REVIEWER_TAIL;
const THEIRS = ORIGINAL + AGENT_TAIL;

const REGION = "#coach-note";

// The frozen feed. Same shape as the fixture's own feed region (four articles,
// stable ids), so the morph engine's raw flavor destroys and rebuilds exactly
// what it destroys and rebuilds in the fixture.
function feedHtml(sentence) {
  return (
    '<article id="feed-latest" class="feed-item"><h3>Latest activity</h3>' +
    "<p>Priya hit a squat number she has been chasing since February.</p></article>" +
    '<article id="feed-coach-note" class="feed-item"><h3>Coach note</h3>' +
    '<p id="coach-note">' +
    sentence +
    "</p></article>" +
    '<article id="feed-highlight" class="feed-item"><p>Nine clients checked in this week.</p></article>' +
    '<article id="feed-queue" class="feed-item"><h3>Tonight\'s queue</h3>' +
    "<p>Two plans to write and one call to make.</p></article>"
  );
}

const test = base.extend({
  appServer: async function ({}, use) {
    const server = await startAppServer();
    await use(server);
    await server.close();
  },
  helperOrigin: async function ({}, use) {
    await use("http://127.0.0.1:1");
  }
});

/** What the page, the record and replay all say right now, read in one task. */
function snapshot(page, id) {
  return page.evaluate(function (itemId) {
    const el = document.querySelector("#coach-note");
    return {
      passes: window.__app.counters.morphPasses,
      text: el ? el.textContent : null,
      accepted: (window.__lahe.handle.items().filter((i) => i.id === itemId)[0] || { region: {} }).region
        .accepted_page_texts,
      flagged: window.__lahe.flaggedIds().indexOf(itemId) !== -1,
      blocked: window.__lahe.counters.regionsBlockedChanged,
      replayPasses: window.__lahe.counters.replayPasses
    };
  }, id);
}

test.describe("the reviewer's decision on a collision, on a page that keeps repainting", () => {
  test("Keep mine survives every later morph pass, and the conflict does not come back", async ({
    page,
    appServer,
    helperOrigin
  }) => {
    // The agent's rewrite is one variable: the source the application serves.
    let served = ORIGINAL;
    await withLayer(page, { review: REVIEW, token: TOKEN, helper: helperOrigin });
    // Registered AFTER withLayer, because Playwright matches route handlers in
    // reverse registration order and withLayer's catch-all would otherwise
    // swallow the feed poll.
    await page.route("**/api/feed", function (route) {
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: feedHtml(served)
      });
    });

    await page.goto(appServer.urlFor("/?morph=raw&poll=250"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });

    // The frozen feed is on the page: the region only exists once a morph has
    // applied it, so this also proves the engine is running.
    await pollPage(
      page,
      (args) => {
        const el = document.querySelector(args.region);
        return !!el && el.textContent === args.original;
      },
      { region: REGION, original: ORIGINAL },
      { message: "the frozen feed to land on the page" }
    );

    // --- the reviewer's edit, made while the page is repainting --------------

    await placeCaret(page, { selector: REGION, offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.isEditing(), undefined, {
      message: "Cmd-Shift-E to put the coach note into edit state"
    });
    await placeCaret(page, { selector: REGION, offset: ORIGINAL.length });
    await page.keyboard.type(REVIEWER_TAIL);
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the edit"
    });

    const id = await pollUntil(
      async () => {
        const items = await page.evaluate(() => window.__lahe.items());
        const edit = items.filter((item) => item.kind === "edit" && item.after === MINE)[0];
        return edit ? edit.id : null;
      },
      {
        message: "the committed edit record to carry the reviewer's sentence",
        describe: () => page.evaluate(() => window.__lahe.items().map((i) => ({ kind: i.kind, after: i.after })))
      }
    );

    // The control, before any collision exists: the ordinary replay engine is
    // already carrying this record across morph passes. Without this, a later
    // failure could be "the engine stopped running" rather than "the decision
    // did not stick".
    const committed = await snapshot(page, id);
    await pollPage(page, (from) => window.__app.counters.morphPasses >= from + 3, committed.passes, {
      message: "three morph passes over the committed edit"
    });
    await pollPage(page, (args) => document.querySelector(args.region).textContent === args.mine, {
      region: REGION,
      mine: MINE
    }, { message: "replay to be holding the reviewer's sentence against the morph" });

    // --- the agent rewrites the source ---------------------------------------

    served = THEIRS;
    await pollPage(page, (itemId) => window.__lahe.flaggedIds().indexOf(itemId) !== -1, id, {
      message: "the collision to be flagged on the card"
    });

    const conflict = await page.evaluate((itemId) => {
      const flagged = window.LAHE.replay.conflictFor(itemId);
      return { yours: flagged.yours, theirs: flagged.theirs };
    }, id);
    expect(conflict.yours, "the card shows the reviewer's version in full").toBe(MINE);
    expect(conflict.theirs, "and the page's, in full").toBe(THEIRS);

    // --- the real press -------------------------------------------------------
    //
    // At the button's on-screen geometry: the rail lives in a closed shadow
    // root, so hit-testing is the only honest way in, and it is what a hand
    // does. The card is on the Edits tab, and a card in a hidden pane has no
    // box, so the tab is selected first.
    // The helper is deliberately down in this spec, and its failure chip panel
    // sits over the foot of the card, on top of the buttons. A reviewer waves a
    // chip away with its own x; this is that dismissal, through the rail's own
    // API, so the press is aimed at the button rather than at a notice about
    // something else.
    await page.evaluate(() => {
      const failures = window.__lahe.handle.rail.failures;
      failures.list().forEach((chip) => failures.dismiss(chip.code));
    });

    const rect = await pollUntil(
      () =>
        page.evaluate((itemId) => {
          const rail = window.__lahe.handle.rail;
          rail.selectTab("edits");
          const node = rail.cardNode(itemId);
          const button = node ? node.querySelector('[data-lahe-conflict-choice="keep_mine"]') : null;
          if (!button) return null;
          button.scrollIntoView({ block: "center" });
          const r = button.getBoundingClientRect();
          if (!r.width || !r.height) return null;
          return { x: r.x, y: r.y, width: r.width, height: r.height, label: button.textContent };
        }, id),
      { message: "the Keep mine button to be on screen" }
    );
    expect(rect.label).toBe("Keep mine");
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);


    // The press did what it says on the button, right now.
    await pollUntil(
      async () => {
        const sample = await snapshot(page, id);
        return sample.text === MINE ? sample : null;
      },
      {
        timeoutMs: 5000,
        message: "the press to put the reviewer's sentence back on the page",
        describe: () => snapshot(page, id)
      }
    );

    // --- and it is still true eight morph passes later ------------------------
    //
    // Sampled continuously rather than read once at the end: "it was right when
    // I looked" is what the one-shot write also produced, for about 150ms.
    const answered = await snapshot(page, id);
    const samples = [];
    await pollUntil(
      async () => {
        const sample = await snapshot(page, id);
        samples.push(sample);
        return sample.passes >= answered.passes + 8;
      },
      {
        intervalMs: 20,
        timeoutMs: 20000,
        message: "eight further morph passes over the answered collision"
      }
    );

    // Each pass gets its own bucket. Within one pass the region legitimately
    // holds the agent's sentence for a moment (the morph writes, then replay
    // runs), so the claim is that the reviewer's sentence is restored inside
    // EVERY pass, not that it is the only thing ever readable.
    const buckets = new Map();
    samples.forEach(function (sample) {
      if (!buckets.has(sample.passes)) buckets.set(sample.passes, []);
      buckets.get(sample.passes).push(sample.text);
    });
    const passesAfter = [...buckets.keys()].filter((n) => n > answered.passes);
    expect(passesAfter.length, "at least eight morph passes after the press").toBeGreaterThanOrEqual(8);
    passesAfter.forEach(function (n) {
      expect(buckets.get(n), "morph pass " + n + " ends with the reviewer's sentence on the page").toContain(MINE);
    });

    // The conflict is answered and stays answered. The re-raise is the symptom
    // the walker actually saw, and it is a counter, so it cannot be missed by a
    // sampling gap.
    const last = samples[samples.length - 1];
    expect(samples.some((s) => s.flagged), "the collision is never raised again").toBe(false);
    expect(last.blocked - answered.blocked, "and replay never counted another one").toBe(0);
    expect(last.replayPasses, "replay really did keep running").toBeGreaterThan(answered.replayPasses + 4);
    expect(await page.evaluate(() => document.querySelector("#coach-note").textContent)).toBe(MINE);

    // And the mechanism, named: the record remembers the page state the
    // reviewer answered, and it is written down rather than held in memory,
    // which is what lets the ordinary pass carry the decision. `before` is
    // untouched (R29): it is still the agent's diff base.
    const stored = await page.evaluate(
      (itemId) => window.__lahe.itemById(itemId),
      id
    );
    expect(stored.region.accepted_page_texts).toEqual([THEIRS]);
    expect(stored.before, "the diff base is pristine").toBe(ORIGINAL);
    expect(stored.after).toBe(MINE);
  });
});
