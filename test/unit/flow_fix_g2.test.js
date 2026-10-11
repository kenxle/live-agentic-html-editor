// The flow walk's replay-side failures, the pure halves (reviews_impl/flow_walk.md,
// fix builder G2). The browser halves are in free_writing_flow_fix.spec.js.
//
// Fail 2: once the agent placed a run, a later record of the reviewer's on one
// of its blocks takes that block over (record.handedOverBlocks). The page check
// on the placed run then reads the block's new words as the later record's,
// not as its own going missing. Since spec 20261011.01 the page check does not
// reopen a handled run at all; replay still reads the takeover (laterRun).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const replay = require("../../src/layer/replay.js");
const fixtures = require("../../src/shared/record_fixtures.js");
const overlay = require("../../src/layer/overlay.js");

function fx() {
  return fixtures.createFixtures({ seed: "g2-unit" });
}

const HEAD = '<div class="sheet-head"><h2>What changed</h2><span class="n">Section 1</span></div>';

// The agent placed a heading, a paragraph and a two-item list after the anchor.
function placedRun(f) {
  const item = f.runItem({
    new_blocks: [
      { tag: "h2", html: "Plan for the week" },
      { tag: "p", html: "Two things today." },
      { tag: "ol", html: "<li>First item</li><li>Second item</li>" }
    ]
  });
  item.state = record.STATE.HANDLED;
  item.created_at = "2026-09-30T01:00:00.000Z";
  return item;
}

// The reviewer's later sitting on the placed list: a third item.
function laterListEdit(f, extra) {
  const item = f.runItem(
    Object.assign(
      {
        before: "First item\n\nSecond item",
        before_html: "<li>First item</li><li>Second item</li>",
        anchor_after_html: "<li>First item</li><li>Second item</li><li>Third item</li>",
        new_blocks: [{ tag: "p", html: "A paragraph after the list." }]
      },
      extra || {}
    )
  );
  item.created_at = "2026-09-30T01:05:00.000Z";
  return item;
}

function pageWith(listHtml, tail) {
  return (
    "<main>" +
    HEAD +
    "<p>What changed</p><h2>Plan for the week</h2><p>Two things today.</p>" +
    listHtml +
    (tail || "") +
    "<p>The page's own next paragraph.</p></main>"
  );
}

function check(item, pageHtml, items) {
  const text = pageHtml.replace(/<[^>]+>/g, " ");
  const options = { pageHtml: pageHtml };
  if (items) options.items = items;
  return replay.pageCheckReasonFor(item, text, options);
}

test("a later record whose anchor is a placed block takes that block over", () => {
  const f = fx();
  const placed = placedRun(f);
  const later = laterListEdit(f);
  const handed = record.handedOverBlocks(placed, [placed, later]);
  assert.deepEqual(Object.keys(handed), ["2"]);
  assert.equal(handed[2].id, later.id);
  assert.equal(handed[2].html, "<li>First item</li><li>Second item</li><li>Third item</li>");
});

test("a take-back, an older record and a comment take nothing over", () => {
  const f = fx();
  const placed = placedRun(f);
  const older = laterListEdit(f);
  older.created_at = "2026-09-30T00:59:00.000Z";
  const takeBack = laterListEdit(f);
  takeBack.reverts = "itm_someone";
  const comment = f.comment ? f.comment({ before: "First item\n\nSecond item" }) : null;
  const list = [placed, older, takeBack].concat(comment ? [comment] : []);
  assert.deepEqual(record.handedOverBlocks(placed, list), {});
});

// Since spec 20261011.01 the page check reopens no handled run over its own
// blocks, so the later record no longer has to be read to keep it quiet. These
// pin that a handled run stays handled in every one of these shapes.
test("a placed list with a third item from a later record is not reopened", () => {
  const f = fx();
  const placed = placedRun(f);
  const later = laterListEdit(f);
  const page = pageWith("<ol><li>First item</li><li>Second item</li><li>Third item</li></ol>", "<p>A paragraph after the list.</p>");
  assert.equal(check(placed, page), null, "with or without the later record");
  assert.equal(check(placed, page, [placed, later]), null);
});

test("a handled run with a paragraph missing from the page is not reopened", () => {
  const f = fx();
  const placed = placedRun(f);
  const later = laterListEdit(f);
  const page = "<main>" + HEAD + "<p>What changed</p><h2>Plan for the week</h2><ol><li>First item</li><li>Second item</li><li>Third item</li></ol></main>";
  assert.equal(check(placed, page, [placed, later]), null, "the page shows the file, and the card stays handled");
});

test("pageCheckIds lists nothing for a handled run whatever the page did to it", () => {
  const f = fx();
  const placed = placedRun(f);
  const later = laterListEdit(f);
  const page = pageWith("<ol><li>First item</li><li>Second item</li><li>Third item</li></ol>", "<p>A paragraph after the list.</p>");
  assert.deepEqual(replay.pageCheckIds([placed, later], page.replace(/<[^>]+>/g, " "), {}), []);
});

test("a later record that rewords the run's own reworded anchor takes the anchor over", () => {
  const f = fx();
  const placed = f.runItem({
    before: "What changed",
    before_html: "What changed",
    anchor_after_html: "What changed this week",
    new_blocks: [{ tag: "p", html: "Two things today." }]
  });
  placed.state = record.STATE.HANDLED;
  const later = f.runItem({
    before: "What changed this week",
    before_html: "What changed this week",
    anchor_after_html: "What changed today",
    new_blocks: null,
    anchor_tag_after: "h3"
  });
  assert.equal(record.handedOverBlocks(placed, [placed, later]).anchor.id, later.id);
  const page = "<main>" + HEAD + "<p>What changed today</p><p>Two things today.</p></main>";
  // The old words back on the page are no reason to reopen it either.
  assert.equal(check(placed, page), null);
  assert.equal(check(placed, page, [placed, later]), null);
});

// Flow walk, design problem 6: a draft that changes nothing draws no card.
test("a draft whose words and bold are unchanged is quiet; a typed letter, a new block or a tag change is not", () => {
  const f = fx();
  const base = { state: record.STATE.DRAFT, kind: record.KIND.EDIT, before: "Plain words", after: "Plain words", before_html: "Plain <strong>words</strong>", after_html: "Plain <strong>words</strong>" };
  assert.equal(overlay.isUnchangedDraft(base), true);
  assert.equal(overlay.isUnchangedDraft(Object.assign({}, base, { after: null, after_html: null })), true, "opened, nothing typed yet");
  assert.equal(overlay.isQuietDraft(base), true);
  assert.equal(overlay.isUnchangedDraft(Object.assign({}, base, { after: "Plain words!", after_html: "Plain <strong>words</strong>!" })), false);
  assert.equal(overlay.isUnchangedDraft(Object.assign({}, base, { after_html: "Plain words" })), false, "bold taken off is a change");
  assert.equal(overlay.isUnchangedDraft(Object.assign({}, base, { anchor_tag_after: "h2" })), false);
  assert.equal(overlay.isUnchangedDraft(Object.assign({}, base, { new_blocks: [{ tag: "p", html: "New" }] })), false);
  assert.equal(overlay.isUnchangedDraft(Object.assign({}, base, { state: record.STATE.READY })), false, "only a draft");
  const run = f.runItem({ new_blocks: [{ tag: "p", html: "" }] });
  run.state = record.STATE.DRAFT;
  assert.equal(overlay.isUnchangedDraft(run), true, "a run whose one new block is still empty");
});
