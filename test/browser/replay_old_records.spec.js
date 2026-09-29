// Old records keep today's replay path (free-writing plan Task 2.5).
//
// After the editing workstream lands, Enter makes a run record, so the specs
// that typed their way to an old-shape record (no_duplicate_text,
// split_not_conflict) stop covering today's path. This file keeps it covered:
// every scenario in those two specs and in replay_branches.spec.js, with the
// record injected in the old shape (nested blocks in after_html, no
// new_blocks) and the rebuilt page drawn by hand. Replay loads from src/.

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

function fx() {
  return fixtures.createFixtures({ seed: "2b-old" });
}

function stamped(item, s, tag) {
  item.region = { ref: { id: "ref_" + s, probe: null, stamp: s, fingerprint: { tag: tag || "p" } }, label: "region", lost: null };
  return item;
}

// A page of our own: the blog fixture's article replaced by `html`.
async function pageWith(page, html) {
  await openReplayPage(page, server, "free_writing/blog.html");
  await page.evaluate((markup) => {
    document.getElementById("post").innerHTML = markup;
  }, html);
}

function count(page, text) {
  return page.evaluate((t) => window.__count(t), text);
}

function flagged(page) {
  return page.evaluate(() => window.LAHE.replay.conflictIds());
}

function oldEdit(before, paragraphs, afterHtml) {
  return fx().edit({
    before: before,
    before_html: before,
    after: paragraphs.join("\n\n"),
    after_html: afterHtml || paragraphs[0] + paragraphs.slice(1).map((p) => "<p>" + p + "</p>").join(""),
    change: "old shape"
  });
}

// ---------------------------------------------------------------------------
// no_duplicate_text.spec.js
// ---------------------------------------------------------------------------

test.describe("no_duplicate_text, as old-shape records", () => {
  const ORIGINAL = "Runners come back too fast after a layoff.";
  const ONE = "It is becoming a common experience to have the following conversation.";
  const TWO = "Human: Claude, it looks like you did not do X.";
  const THREE = "Claude: You are right. Let us do that.";
  const CURLY_ONE = "The builder's day is not over - it is just starting.";
  const CURLY_ONE_RENDERED = "The builder’s day is not over — it is just starting.";
  const ADDED = " Slowly.";
  const AGENT_FIRST = "Runners come back too fast after a layoff. Mostly.";
  const LINKED = 'Runners come back <a href="https://example.com/pace">too fast</a> after a layoff.';
  const FORMATTED =
    '<strong>Runners</strong> come back <a href="https://example.com/pace">too fast</a> after a <em>layoff</em>.' + ADDED;

  // The Markdown render's shape: an Intro section, then a Premise section.
  function doc(paragraphs, s) {
    return (
      '<section><h2>Intro</h2>' +
      paragraphs.map((p, i) => (i === 0 ? '<p data-lahe-id="' + (s || "s-intro") + '">' + p + "</p>" : "<p>" + p + "</p>")).join("") +
      "</section><section><h2>Premise</h2><p>All those days are gone.</p></section>"
    );
  }

  async function replayTwice(page, item) {
    await setItems(page, [stamped(item, "s-intro")]);
    await page.evaluate(() => window.__pass());
    await page.evaluate(() => window.__pass());
  }

  function introFormats(page) {
    return page.evaluate(() => {
      const el = document.querySelector("#post section p");
      const link = el.querySelector("a");
      return {
        text: el.textContent.replace(/\s+/g, " ").trim(),
        bold: Array.from(el.querySelectorAll("strong")).map((n) => n.textContent),
        italic: Array.from(el.querySelectorAll("em")).map((n) => n.textContent),
        link: link ? { href: link.getAttribute("href"), text: link.textContent } : null
      };
    });
  }

  test("a single paragraph replacement lands once", async ({ page }) => {
    await pageWith(page, doc([ONE]));
    await replayTwice(page, oldEdit(ORIGINAL, [ONE]));
    expect(await count(page, ONE)).toBe(1);
  });

  test("a multi-paragraph replacement the source carries as separate paragraphs lands once", async ({ page }) => {
    await pageWith(page, doc([ONE, TWO, THREE]));
    await replayTwice(page, oldEdit(ORIGINAL, [ONE, TWO, THREE]));
    for (const t of [ONE, TWO, THREE]) expect(await count(page, t)).toBe(1);
  });

  test("a rebuild that curls a quote and lengthens a dash still lands once", async ({ page }) => {
    await pageWith(page, doc([CURLY_ONE_RENDERED, TWO, THREE]));
    await replayTwice(page, oldEdit(ORIGINAL, [CURLY_ONE, TWO, THREE]));
    expect(await count(page, TWO)).toBe(1);
    expect(await count(page, THREE)).toBe(1);
  });

  test("paragraphs appended under an unchanged one land once", async ({ page }) => {
    await pageWith(page, doc([ORIGINAL, TWO, THREE]));
    await replayTwice(page, oldEdit(ORIGINAL, [ORIGINAL, TWO, THREE]));
    expect(await count(page, TWO)).toBe(1);
    expect(await count(page, THREE)).toBe(1);
  });

  test("a rebuild that curls a quote and lengthens a dash lands once, and says nothing clashed", async ({ page }) => {
    await pageWith(page, doc([ORIGINAL, TWO, CURLY_ONE_RENDERED]));
    const item = oldEdit(ORIGINAL, [ORIGINAL, TWO, CURLY_ONE]);
    await replayTwice(page, item);
    expect(await count(page, ORIGINAL)).toBe(1);
    expect(await count(page, TWO)).toBe(1);
    expect(await count(page, CURLY_ONE_RENDERED)).toBe(1);
    expect(await flagged(page)).not.toContain(item.id);
  });

  test("a rebuild that reworded the last paragraph doubles nothing", async ({ page }) => {
    await pageWith(page, doc([ORIGINAL, TWO, THREE + " Right away."]));
    await replayTwice(page, oldEdit(ORIGINAL, [ORIGINAL, TWO, THREE]));
    expect(await count(page, TWO)).toBe(1);
    expect(await count(page, ORIGINAL)).toBe(1);
  });

  test("the one paragraph replay writes keeps its bold, italic and link", async ({ page }) => {
    await pageWith(page, doc([LINKED, TWO, THREE]));
    const item = oldEdit(ORIGINAL, [ORIGINAL + ADDED, TWO, THREE], FORMATTED + "<p>" + TWO + "</p><p>" + THREE + "</p>");
    await replayTwice(page, item);
    const formats = await introFormats(page);
    expect(formats.text).toBe(ORIGINAL + ADDED);
    expect(formats.bold).toEqual(["Runners"]);
    expect(formats.italic).toEqual(["layoff"]);
    expect(formats.link).toEqual({ href: "https://example.com/pace", text: "too fast" });
    expect(await count(page, TWO)).toBe(1);
    expect(await count(page, THREE)).toBe(1);
  });

  test("Keep mine on the same shape keeps the bold, italic and link too", async ({ page }) => {
    await pageWith(page, doc([AGENT_FIRST, TWO, THREE]));
    const item = oldEdit(ORIGINAL, [ORIGINAL + ADDED, TWO, THREE], FORMATTED + "<p>" + TWO + "</p><p>" + THREE + "</p>");
    await replayTwice(page, item);
    expect(await flagged(page)).toContain(item.id);
    await page.evaluate((id) => window.__cards.nodes[id].querySelector('[data-lahe-conflict-choice="keep_mine"]').click(), item.id);
    expect(await flagged(page)).not.toContain(item.id);
    const formats = await introFormats(page);
    expect(formats.text).toBe(ORIGINAL + ADDED);
    expect(formats.bold).toEqual(["Runners"]);
    expect(formats.italic).toEqual(["layoff"]);
    expect(formats.link).toEqual({ href: "https://example.com/pace", text: "too fast" });
    expect(await count(page, TWO)).toBe(1);
    expect(await count(page, THREE)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// split_not_conflict.spec.js
// ---------------------------------------------------------------------------

test.describe("split_not_conflict, as old-shape records", () => {
  const ORIGINAL = "It's becoming a common experience to have the following conversation.";
  const SECOND = "Human: Claude it looks like you didn't do X.";
  const THIRD = "Claude: You're right! Let's do that.";

  function sketch(paragraphs) {
    return (
      "<h1>The new debugging hell</h1>" +
      paragraphs.map((p, i) => (i === 0 ? '<p data-lahe-id="s-first">' : "<p>") + p + "</p>").join("") +
      "<p>The rest of this sketch holds still while the agent works.</p>"
    );
  }

  test("three typed paragraphs rebuilt as three <p> raise no conflict card", async ({ page }) => {
    await pageWith(page, sketch([ORIGINAL, SECOND, THIRD]));
    const item = stamped(oldEdit(ORIGINAL, [ORIGINAL, SECOND, THIRD]), "s-first");
    await setItems(page, [item]);
    await page.evaluate(() => window.__pass());
    await page.evaluate(() => window.__pass());
    expect(await flagged(page)).not.toContain(item.id);
    const texts = await page.evaluate(() => Array.from(document.querySelectorAll("#post > p")).map((p) => p.textContent));
    expect(texts.slice(0, 3)).toEqual([ORIGINAL, SECOND, THIRD]);
  });

  test("control: a rebuilt page whose last paragraph differs still conflicts", async ({ page }) => {
    await pageWith(page, sketch([ORIGINAL, SECOND, THIRD + " The agent added this sentence."]));
    const item = stamped(oldEdit(ORIGINAL, [ORIGINAL, SECOND, THIRD]), "s-first");
    await setItems(page, [item]);
    await page.evaluate(() => window.__pass());
    expect(await flagged(page)).toContain(item.id);
  });
});

// ---------------------------------------------------------------------------
// replay_branches.spec.js
// ---------------------------------------------------------------------------

test.describe("replay_branches, as old-shape records", () => {
  const BEFORE = "The trainer writes the plan every week.";
  const AFTER = "The trainer writes the plan each week.";

  async function one(page, item, html) {
    await pageWith(page, html);
    await setItems(page, [item]);
  }

  function text(page, sel) {
    return page.evaluate((s) => document.querySelector(s).textContent, sel);
  }

  function counters(page) {
    return page.evaluate(() => Object.assign({}, window.LAHE.replay.counters));
  }

  test("branch three: an earlier revision landed, so the current one is re-applied once and the card says so", async ({ page }) => {
    const item = stamped(fx().editRewordedTwice(), "s-b");
    const earlier = item.after_history.map((e) => e.after).filter((a) => a && a !== item.after && a !== item.before)[0];
    await one(page, item, '<p id="b" data-lahe-id="s-b">' + earlier + "</p>");
    const before = await counters(page);
    const r = await page.evaluate(() => window.__pass());
    const after = await counters(page);
    expect(r[0].branch).toBe("earlier_revision");
    expect(await text(page, "#b")).toBe(item.after);
    expect(after.regionsEarlierRevision - before.regionsEarlierRevision).toBe(1);
    expect(after.regionsWritten - before.regionsWritten).toBe(1);
    expect(await page.evaluate((id) => window.__cards.notices[id], item.id)).toBe(
      await page.evaluate(() => window.LAHE.replay.EARLIER_REVISION_MESSAGE)
    );
  });

  test("branch two: the repaint put the page back, so the edit is applied again", async ({ page }) => {
    const item = stamped(fx().edit(), "s-c");
    await one(page, item, '<p id="c" data-lahe-id="s-c">' + AFTER + "</p>");
    await page.evaluate((t) => (document.getElementById("c").textContent = t), BEFORE);
    const before = await counters(page);
    await page.evaluate(() => window.__pass());
    const after = await counters(page);
    expect(await text(page, "#c")).toBe(AFTER);
    expect(after.regionsWritten).toBeGreaterThan(before.regionsWritten);
  });

  test("branch four: the page changed underneath, so nothing is written and the card shows both versions in full", async ({ page }) => {
    const item = stamped(fx().edit(), "s-c");
    const theirs = BEFORE + " The agent rewrote this from the source.";
    await one(page, item, '<p id="c" data-lahe-id="s-c">' + theirs + "</p>");
    const before = await counters(page);
    const r = await page.evaluate(() => window.__pass());
    const after = await counters(page);
    expect(r[0]).toMatchObject({ branch: "content_changed", wrote: false });
    expect(await text(page, "#c")).toBe(theirs);
    expect(after.regionsWritten - before.regionsWritten).toBe(0);
    expect(after.regionsConflicted - before.regionsConflicted).toBe(1);
    expect(await page.evaluate((id) => Object.keys(window.__cards.badges[id]), item.id)).toContain("REPLAY_NEITHER_MATCHES");
    expect(await page.evaluate((id) => window.LAHE.replay.conflictFor(id), item.id)).toMatchObject({ yours: AFTER, theirs: theirs });
    expect(await page.evaluate((id) => window.__cards.nodes[id].hasAttribute("hidden"), item.id)).toBe(false);
  });

  test("a collision that resolves takes its card off the page, and a later one builds a new one", async ({ page }) => {
    const item = stamped(fx().edit(), "s-c");
    await one(page, item, '<p id="c" data-lahe-id="s-c">' + BEFORE + " The agent rewrote this.</p>");
    await page.evaluate(() => window.__pass());
    const first = await page.evaluate((id) => window.__cards.nodes[id], item.id);
    expect(first).toBeTruthy();
    await page.evaluate((t) => (document.getElementById("c").textContent = t), AFTER);
    await page.evaluate(() => window.__pass());
    expect(await flagged(page)).not.toContain(item.id);
    expect(await page.evaluate((id) => !!window.__cards.nodes[id], item.id)).toBe(false);
    await page.evaluate((t) => (document.getElementById("c").textContent = t), BEFORE + " The agent rewrote this twice.");
    await page.evaluate(() => window.__pass());
    const again = await page.evaluate((id) => {
      const node = window.__cards.nodes[id];
      return node ? { hidden: node.hasAttribute("hidden"), display: getComputedStyle(node).display } : null;
    }, item.id);
    expect(again).toEqual({ hidden: false, display: "flex" });
  });

  test("a resolved collision does not come back on the next pass", async ({ page }) => {
    const item = stamped(fx().edit(), "s-c");
    await one(page, item, '<p id="c" data-lahe-id="s-c">' + BEFORE + " The agent rewrote this.</p>");
    await page.evaluate(() => window.__pass());
    await page.evaluate((t) => (document.getElementById("c").textContent = t), AFTER);
    await page.evaluate(() => window.__pass());
    await page.evaluate(() => window.__pass());
    expect(await page.evaluate((id) => !!window.__cards.nodes[id], item.id)).toBe(false);
  });

  test("clearing one collision leaves the one still standing drawn", async ({ page }) => {
    const f = fx();
    const b = stamped(f.edit({ before: "Region b before words.", after: "Region b after words." }), "s-b");
    const c = stamped(f.edit(), "s-c");
    await pageWith(
      page,
      '<p id="b" data-lahe-id="s-b">Region b before words. Neither version says this.</p><p id="c" data-lahe-id="s-c">' +
        BEFORE +
        " Neither version says this.</p>"
    );
    await setItems(page, [b, c]);
    await page.evaluate(() => window.__pass());
    expect(await flagged(page)).toEqual(expect.arrayContaining([b.id, c.id]));
    await page.evaluate(() => (document.getElementById("b").textContent = "Region b after words."));
    await page.evaluate(() => window.__pass());
    const left = await page.evaluate(
      ([bid, cid]) => ({ b: !!window.__cards.nodes[bid], c: getComputedStyle(window.__cards.nodes[cid]).display }),
      [b.id, c.id]
    );
    expect(left).toEqual({ b: false, c: "flex" });
  });

  test("a collision that clears while the reviewer is in the card waits for them to leave", async ({ page }) => {
    const item = stamped(fx().edit(), "s-c");
    await one(page, item, '<p id="c" data-lahe-id="s-c">' + BEFORE + " The agent rewrote this.</p>");
    await page.evaluate(() => window.__pass());
    const node = await page.evaluate((id) => !!window.__cards.nodes[id], item.id);
    expect(node).toBe(true);
    // The reviewer is in the card.
    await page.evaluate(() => {
      window.LAHE.replay.configure({ cards: Object.assign({}, window.LAHE.replay.context.cards, { holdsFocus: () => true }) });
      document.getElementById("c").textContent = "The trainer writes the plan each week.";
    });
    await page.evaluate(() => window.__pass());
    const held = await page.evaluate((id) => {
      const n = window.__cards.nodes[id];
      return n ? { hidden: n.hasAttribute("hidden"), text: n.querySelector("[data-lahe-conflict-text]").textContent } : null;
    }, item.id);
    expect(held).toEqual({ hidden: true, text: "" });
    await page.evaluate(() => {
      window.LAHE.replay.configure({ cards: Object.assign({}, window.LAHE.replay.context.cards, { holdsFocus: () => false }) });
    });
    await page.evaluate(() => window.__pass());
    expect(await page.evaluate((id) => !!window.__cards.nodes[id], item.id)).toBe(false);
  });

  test("a format-only record compares on structure, and a delete is idempotent by absence", async ({ page }) => {
    const f = fx();
    const fmt = stamped(f.formatOnly(), "s-fmt");
    const del = stamped(f.deletion(), "s-del");
    await pageWith(page, '<p id="fmt" data-lahe-id="s-fmt">This part matters.</p><p id="del" data-lahe-id="s-del">This whole paragraph should go.</p>');
    await setItems(page, [fmt, del]);
    await page.evaluate(() => window.__pass());
    expect(await page.evaluate(() => document.getElementById("fmt").innerHTML)).toContain("<strong>matters</strong>");
    expect(await page.evaluate(() => !!document.getElementById("del"))).toBe(false);
    const settled = await counters(page);
    const r = await page.evaluate(() => window.__pass());
    const again = await counters(page);
    expect(r[0]).toMatchObject({ branch: "already_applied", wrote: false });
    expect(r[1]).toMatchObject({ branch: "already_applied", wrote: false, lost: false });
    expect(again.regionsWritten).toBe(settled.regionsWritten);
  });

  test("five passes with no repaint in between write nothing at all", async ({ page }) => {
    const item = stamped(fx().edit(), "s-c");
    await one(page, item, '<p id="c" data-lahe-id="s-c">' + BEFORE + "</p>");
    await page.evaluate(() => window.__pass());
    const settled = await counters(page);
    await page.evaluate(() => {
      for (let i = 0; i < 5; i += 1) window.__pass();
    });
    const after = await counters(page);
    expect(after.regionsWritten).toBe(settled.regionsWritten);
    expect(after.regionsSkippedEqual - settled.regionsSkippedEqual).toBe(5);
  });

  test("a repaint reverting the page is the only thing that makes replay write again", async ({ page }) => {
    const item = stamped(fx().edit(), "s-c");
    await one(page, item, '<p id="c" data-lahe-id="s-c">' + BEFORE + "</p>");
    await page.evaluate(() => window.__pass());
    const quiet = await counters(page);
    await page.evaluate((t) => {
      const old = document.getElementById("c");
      const fresh = old.cloneNode(false);
      fresh.textContent = t;
      old.replaceWith(fresh);
    }, BEFORE);
    await page.evaluate(() => window.__pass());
    const loud = await counters(page);
    expect(loud.regionsWritten).toBeGreaterThan(quiet.regionsWritten);
    expect(await text(page, "#c")).toBe(AFTER);
  });

  test("an anchor that matches nothing is surfaced as lost, and writes nothing", async ({ page }) => {
    const item = fx().edit({
      before: "This block is outside every repaint target.",
      after: "This block is outside every repaint target and stays that way.",
      region: { ref: { id: "ref_out", probe: "This block is outside every repaint target." }, label: "out", lost: null }
    });
    await one(page, item, "<p>Nothing like it here.</p>");
    const r = await page.evaluate(() => window.__pass());
    expect(r[0]).toMatchObject({ lost: true, wrote: false });
    const stored = await page.evaluate(() => window.__items[0]);
    expect(stored.region.lost.code).toBe("ANCHOR_NO_TEXT_MATCH");
    expect(stored.region.lost.reason).toContain("could not be safely matched");
    expect(await page.evaluate((id) => Object.keys(window.__cards.badges[id]), item.id)).toContain("ANCHOR_NO_TEXT_MATCH");
  });

  test("an anchor that matches two places is surfaced as lost, and moves nothing", async ({ page }) => {
    const twin = "Two clients have not accepted the invite yet.";
    const item = fx().edit({
      before: twin,
      after: "Two clients have accepted the invite.",
      region: { ref: { id: "ref_twin", probe: twin }, label: "twin", lost: null }
    });
    await one(page, item, "<p>" + twin + "</p><p>" + twin + "</p>");
    const r = await page.evaluate(() => window.__pass());
    expect(r[0]).toMatchObject({ lost: true, wrote: false });
    expect(await page.evaluate(() => Array.from(document.querySelectorAll("#post p")).map((p) => p.textContent))).toEqual([twin, twin]);
    const stored = await page.evaluate(() => window.__items[0]);
    expect(stored.region.lost.code).toBe("ANCHOR_AMBIGUOUS");
    expect(stored.region.lost.reason).toContain("more than one place");
  });
});

// Also the unused-import guard: the record module is the shape source.
test("old-shape fixtures carry no run fields", () => {
  expect(record.hasRunFields(fx().oldShapeNested())).toBe(false);
  expect(record.hasRunFields(fx().edit())).toBe(false);
});
