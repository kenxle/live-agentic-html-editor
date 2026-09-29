// Replay of a run record: the pure halves (free-writing plan Tasks 2.5 to 2.7).
//
// The anchor view the compare reads, the page check on a run read block by
// block from the page's markup, and the card's words. The DOM halves (the
// insert path, the tag swap, the held run) are in the browser specs
// replay_run_anchor, replay_run_insert and replay_run_check.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const replay = require("../../src/layer/replay.js");
const fixtures = require("../../src/shared/record_fixtures.js");

function fx() {
  return fixtures.createFixtures({ seed: "2b-unit" });
}

function named(name) {
  return fx().runFixtures().find((f) => f.name === name).item;
}

function handled(item) {
  item.state = record.STATE.HANDLED;
  return item;
}

function check(item, pageHtml) {
  return replay.pageCheckReasonFor(item, pageHtml.replace(/<[^>]+>/g, " "), { pageHtml: pageHtml });
}

const HEAD = '<div class="sheet-head"><h2>What changed</h2><span class="n">Section 1</span></div>';

// ---------------------------------------------------------------------------
// The anchor view
// ---------------------------------------------------------------------------

test("the anchor view reads the anchor's own after, never the whole sitting", () => {
  const view = replay.runAnchorView(named("worked example"));
  assert.equal(view.after_html, "What changed");
  assert.equal(view.after, "What changed");
  assert.equal(view.before, "What changed");
});

test("the anchor view's history gives each revision's anchor, so branch three never matches a whole sitting", () => {
  const item = named("with an earlier run in history");
  const view = replay.runAnchorView(item);
  assert.deepEqual(
    view.after_history.map((e) => e.after),
    ["What changed", "What changed"]
  );
  assert.deepEqual(record.priorAfters(view, "after"), []);
});

test("a trimmed history entry with no anchor markup gives no prior after", () => {
  const item = named("worked example");
  item.after_history = [{ rev: 0, after: "What changed\n\nold sitting", after_html: null }].concat(item.after_history);
  const view = replay.runAnchorView(item);
  assert.equal(view.after_history[0].after, null);
});

test("a take-back's anchor view has the anchor's before, with the removed run cut off", () => {
  const view = replay.runAnchorView(named("take-back"));
  assert.equal(view.before_html, "What changed");
  assert.equal(view.before, "What changed");
  assert.equal(view.after_html, "What changed");
});

test("the source record is never changed by the view", () => {
  const item = named("worked example");
  const copy = JSON.parse(JSON.stringify(item));
  replay.runAnchorView(item);
  assert.deepEqual(item, copy);
});

// ---------------------------------------------------------------------------
// The page check on a run
// ---------------------------------------------------------------------------

const WORKED_PAGE =
  "<main>" +
  HEAD +
  '<section><div class="sheet-head"><h2>What the chat window cost me zqxcanary</h2><span class="n">Section 2</span></div>' +
  "<p>I lost my place <strong>every</strong> time zqxcanary</p>" +
  "<ul><li>scrolling</li><li>re-asking zqxcanary</li></ul>" +
  "</section></main>";

test("a handled run placed right, with a section label between blocks, is not reopened", () => {
  const item = handled(named("worked example"));
  assert.equal(check(item, WORKED_PAGE), null);
});

test("a handled run whose paragraph lost its bold is reopened with the formatting note", () => {
  const item = handled(named("worked example"));
  const page = WORKED_PAGE.replace("<strong>every</strong>", "every");
  assert.equal(check(item, page), replay.PAGE_CHECK_REASON.FORMATTING);
  assert.equal(replay.pageCheckNoteFor(item, page, { pageHtml: page }), record.PAGE_CHECK_FORMAT_NOTE);
});

test("a header placed as a paragraph is reopened with the tag note, not the formatting note", () => {
  const item = handled(named("worked example"));
  const page = WORKED_PAGE.replace("<h2>What the chat window cost me zqxcanary</h2>", "<p>What the chat window cost me zqxcanary</p>").replace(
    "<strong>every</strong>",
    "every"
  );
  assert.equal(check(item, page), replay.PAGE_CHECK_REASON.TAG);
  assert.equal(replay.pageCheckNoteFor(item, page, { pageHtml: page }), record.PAGE_CHECK_TAG_NOTE);
});

test("a missing block reopens as undone", () => {
  const item = handled(named("worked example"));
  const page = WORKED_PAGE.replace("<ul><li>scrolling</li><li>re-asking zqxcanary</li></ul>", "");
  assert.equal(check(item, page), replay.PAGE_CHECK_REASON.REVERTED);
  assert.equal(replay.pageCheckNoteFor(item, page, { pageHtml: page }), record.PAGE_CHECK_NOTE);
});

test("a block of five or more words the page shows elsewhere is not missing", () => {
  const item = handled(named("worked example"));
  const page = WORKED_PAGE.replace("<h2>What the chat window cost me zqxcanary</h2>", "") + "<p>x</p><p>y</p><p>z</p><h2>What the chat window cost me zqxcanary</h2>";
  assert.equal(check(item, page), null);
});

test("the anchor's before back on the page, and not its after, reopens as undone", () => {
  const item = handled(named("tag change with new words"));
  assert.equal(check(item, "<main><p>Old words zqxcanary</p></main>"), replay.PAGE_CHECK_REASON.REVERTED);
});

test("a tag-only change the page did not take reopens with the tag note", () => {
  const item = handled(named("tag-only change"));
  assert.equal(check(item, "<main><p>Plain words zqxcanary</p></main>"), replay.PAGE_CHECK_REASON.TAG);
  assert.equal(check(item, "<main><h2>Plain words zqxcanary</h2></main>"), null);
});

test("a start_of_container run is checked from the container's start", () => {
  const item = handled(named("start of container"));
  assert.equal(check(item, "<main><h2>Notes zqxcanary</h2><p>First thought zqxcanary</p></main>"), null);
  assert.equal(check(item, "<main><h2>Notes zqxcanary</h2></main>"), replay.PAGE_CHECK_REASON.REVERTED);
});

test("an outstanding run is not checked", () => {
  assert.equal(check(named("worked example"), "<main></main>"), null);
});

test("an old record keeps today's check: the whole after as one string", () => {
  const old = handled(fx().oldShapeNested());
  assert.equal(check(old, "<main><h2>Intro</h2><p>A new line</p></main>"), null);
});

// ---------------------------------------------------------------------------
// What the card says
// ---------------------------------------------------------------------------

test("the rail has a line for the tag note", () => {
  assert.equal(
    replay.pageCheckNoticeFor(record.PAGE_CHECK_TAG_NOTE),
    "A block in this change is on the page as a different type. The item is open again."
  );
});

test("the held run's line counts the blocks and names the anchor's type", () => {
  assert.equal(
    replay.runConflictLine(named("worked example")),
    "Your 3 new blocks after this paragraph are waiting on this choice. Either answer keeps them."
  );
  assert.equal(
    replay.runConflictLine(named("special characters")),
    "Your 1 new block after this paragraph is waiting on this choice. Either answer keeps it."
  );
  assert.equal(replay.TAKE_THEIRS_RUN_LABEL, "Take the page's, keep my new text");
});

test("a block typed with -- and rendered with a dash is not missing", () => {
  const item = handled(named("worked example"));
  item.new_blocks = item.new_blocks.map((b) => (b.tag === "p" ? Object.assign({}, b, { html: b.html.replace("every</strong> time", "every</strong> time -- then") }) : b));
  const page = WORKED_PAGE.replace("every</strong> time", "every</strong> time — then");
  assert.equal(check(item, page), null);
});

test("a handled block the agent added words to reopens as undone", () => {
  const item = handled(named("worked example"));
  const page = WORKED_PAGE.replace("time zqxcanary</p>", "time zqxcanary. The agent added this sentence.</p>");
  assert.equal(check(item, page), replay.PAGE_CHECK_REASON.REVERTED);
});

// ---------------------------------------------------------------------------
// Fix round (reviews_impl/FIX_ROUND.md, group F2)
// ---------------------------------------------------------------------------

// Code lead finding 19: a sitting that retags and bolds the anchor is
// format_only, and its bold was never checked.
test("a format_only anchor whose bold the page lost reopens with the formatting note", () => {
  const item = handled(
    fx().runItem({
      kind: record.KIND.FORMAT_ONLY,
      before: "Plain words zqxcanary",
      before_html: "Plain words zqxcanary",
      anchor_after_html: "Plain <strong>words</strong> zqxcanary",
      anchor_tag_after: "h2",
      new_blocks: []
    })
  );
  assert.equal(check(item, "<main><h2>Plain words zqxcanary</h2></main>"), replay.PAGE_CHECK_REASON.FORMATTING);
  assert.equal(check(item, "<main><h2>Plain <strong>words</strong> zqxcanary</h2></main>"), null);
});

// Code lead finding 18: a proofread fix of "well--known" to "well-known" folds
// to the same words, so the page showing the earlier revision was never seen.
function punctuationFix() {
  const f = fx();
  const first = f.runItem({ new_blocks: [{ tag: "p", html: "A well--known fact about builds zqxcanary" }] });
  const blocks = [{ tag: "p", html: "A well-known fact about builds zqxcanary" }];
  const built = record.buildRunAfter(first.anchor_after_html, blocks);
  const later = record.bumpRev(first, { new_blocks: blocks, after_html: built.after_html, after: built.after });
  later.change = record.runChangeText(later);
  return later;
}

test("a handled punctuation fix whose earlier revision is back on the page reopens as undone", () => {
  const item = handled(punctuationFix());
  assert.equal(check(item, "<main><p>What changed</p><p>A well--known fact about builds zqxcanary</p></main>"), replay.PAGE_CHECK_REASON.REVERTED);
  assert.equal(check(item, "<main><p>What changed</p><p>A well-known fact about builds zqxcanary</p></main>"), null);
});

test("a punctuation fix rendered with a typographic dash is not reopened", () => {
  // The render draws "-" as it is, and "--" in the earlier revision as a dash:
  // the page shows neither revision exactly, and the fold says it is present.
  const item = handled(punctuationFix());
  assert.equal(check(item, "<main><p>What changed</p><p>A well‑known fact about builds zqxcanary</p></main>"), null);
});

// Design call 4 (CR 3, CL 2): a take-back carries the old tag in
// anchor_tag_after, and the page check acts on it.
function tagOnlyTakeBack() {
  const orig = named("tag-only change");
  const back = record.revertOf(orig);
  back.anchor_tag_after = "p";
  back.region = orig.region;
  return handled(back);
}

test("a handled take-back of a tag change is not reopened when the anchor is back to its old tag", () => {
  assert.equal(check(tagOnlyTakeBack(), "<main><p>Plain words zqxcanary</p></main>"), null);
});

test("a handled take-back of a tag change reopens with the tag note while the page keeps the new tag", () => {
  const back = tagOnlyTakeBack();
  const page = "<main><h2>Plain words zqxcanary</h2></main>";
  assert.equal(check(back, page), replay.PAGE_CHECK_REASON.TAG);
  assert.equal(replay.pageCheckNoteFor(back, page, { pageHtml: page }), record.PAGE_CHECK_TAG_NOTE);
});

test("a handled take-back of a retagged run checks the anchor's old tag too", () => {
  const orig = fx().runItem({ anchor_tag_after: "h3" });
  const back = handled(record.revertOf(orig));
  back.anchor_tag_after = "p";
  assert.equal(check(back, "<main><p>What changed</p></main>"), null);
  assert.equal(check(back, "<main><h3>What changed</h3></main>"), replay.PAGE_CHECK_REASON.TAG);
});
