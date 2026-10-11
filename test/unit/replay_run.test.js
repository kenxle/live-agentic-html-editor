// Replay of a run record: the pure halves (free-writing plan Tasks 2.5 to 2.7).
//
// The anchor view the compare reads, the page check leaving a handled run
// alone, and the card's words. The DOM halves (the
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

// Spec docs/features/20261011.01_stuck_replayed_blocks, requirement 2: after the
// agent answers handled, the page is the file. Every shape below used to reopen
// the run (missing, tag, formatting, undone, take-back). Now none of them does:
// the card stays handled, nothing is written, and nothing new is shown.

function punctuationFix() {
  const f = fx();
  const first = f.runItem({ new_blocks: [{ tag: "p", html: "A well--known fact about builds zqxcanary" }] });
  const blocks = [{ tag: "p", html: "A well-known fact about builds zqxcanary" }];
  const built = record.buildRunAfter(first.anchor_after_html, blocks);
  const later = record.bumpRev(first, { new_blocks: blocks, after_html: built.after_html, after: built.after });
  later.change = record.runChangeText(later);
  return later;
}

// Design call 4 (CR 3, CL 2): a take-back carries the old tag in
// anchor_tag_after, and the page check acts on it.
function tagOnlyTakeBack() {
  const orig = named("tag-only change");
  const back = record.revertOf(orig);
  back.anchor_tag_after = "p";
  back.region = orig.region;
  return handled(back);
}

// The page's side of a take-back of placed blocks (adversary review 3): the
// same rule as the helper's takeBackVerdictFor. The anchor's old words stay on
// the page either way, so the check reads the listed blocks by absence.
function blockTakeBack() {
  const orig = named("worked example");
  const back = record.revertOf(orig);
  assert.ok(Array.isArray(back.remove_blocks) && back.remove_blocks.length > 0, "the fixture take-back lists blocks");
  return { back: handled(back), blocks: back.remove_blocks };
}

function pageWith(anchor, blocks) {
  return "<main><h2>" + anchor + "</h2>" + blocks.map((b) => "<" + b.tag + ">" + b.html + "</" + b.tag + ">").join("") + "</main>";
}

const FORMAT_ONLY_ANCHOR = () =>
  handled(
    fx().runItem({
      kind: record.KIND.FORMAT_ONLY,
      before: "Plain words zqxcanary",
      before_html: "Plain words zqxcanary",
      anchor_after_html: "Plain <strong>words</strong> zqxcanary",
      anchor_tag_after: "h2",
      new_blocks: []
    })
  );

const NO_LONGER_REOPENED = [
  ["a paragraph that lost its bold", () => handled(named("worked example")), () => WORKED_PAGE.replace("<strong>every</strong>", "every")],
  [
    "a header placed as a paragraph",
    () => handled(named("worked example")),
    () => WORKED_PAGE.replace("<h2>What the chat window cost me zqxcanary</h2>", "<p>What the chat window cost me zqxcanary</p>")
  ],
  ["a missing block", () => handled(named("worked example")), () => WORKED_PAGE.replace("<ul><li>scrolling</li><li>re-asking zqxcanary</li></ul>", "")],
  [
    "a block the agent added words to",
    () => handled(named("worked example")),
    () => WORKED_PAGE.replace("time zqxcanary</p>", "time zqxcanary. The agent added this sentence.</p>")
  ],
  ["the anchor's before back on the page", () => handled(named("tag change with new words")), () => "<main><p>Old words zqxcanary</p></main>"],
  ["a tag-only change the page did not take", () => handled(named("tag-only change")), () => "<main><p>Plain words zqxcanary</p></main>"],
  ["a start_of_container run with its block gone", () => handled(named("start of container")), () => "<main><h2>Notes zqxcanary</h2></main>"],
  ["a format_only anchor whose bold the page lost", FORMAT_ONLY_ANCHOR, () => "<main><h2>Plain words zqxcanary</h2></main>"],
  [
    "a punctuation fix whose earlier revision is back",
    () => handled(punctuationFix()),
    () => "<main><p>What changed</p><p>A well--known fact about builds zqxcanary</p></main>"
  ],
  ["a take-back of a tag change whose page keeps the new tag", tagOnlyTakeBack, () => "<main><h2>Plain words zqxcanary</h2></main>"],
  ["a take-back whose listed blocks are still after the anchor", () => blockTakeBack().back, () => pageWith("What changed", blockTakeBack().blocks)],
  ["the lines turned into a table on request", () => handled(named("worked example")), () =>
    "<main>" + HEAD + "<table><tr><td>What the chat window cost me zqxcanary</td></tr><tr><td>I lost my place every time zqxcanary</td></tr></table></main>"]
];

for (const [label, itemOf, pageOf] of NO_LONGER_REOPENED) {
  test("a handled run is not reopened for " + label, () => {
    const item = itemOf();
    const page = pageOf();
    assert.equal(check(item, page), null);
    assert.deepEqual(replay.pageCheckIds([item], page.replace(/<[^>]+>/g, " "), { pageHtml: page }), []);
  });
}

test("a handled run whose blocks landed and whose id did not still opens the stamp round", () => {
  const item = handled(named("worked example"));
  item.region = Object.assign({}, item.region, { ref: Object.assign({}, (item.region && item.region.ref) || {}, { stamp: "e-run1" }) });
  const text = WORKED_PAGE.replace(/<[^>]+>/g, " ");
  assert.equal(replay.pageCheckReasonFor(item, text, { stamps: {}, stampCarriable: true }), replay.PAGE_CHECK_REASON.STAMP);
  assert.equal(replay.pageCheckReasonFor(item, text, { stamps: { "e-run1": true }, stampCarriable: true }), null);
  // A block gone from the page: no element left to ask about, so no round.
  const gone = WORKED_PAGE.replace("<ul><li>scrolling</li><li>re-asking zqxcanary</li></ul>", "").replace(/<[^>]+>/g, " ");
  assert.equal(replay.pageCheckReasonFor(item, gone, { stamps: {}, stampCarriable: true }), null);
});

test("an outstanding run is not checked", () => {
  assert.equal(check(named("worked example"), "<main></main>"), null);
});

// ---------------------------------------------------------------------------
// What the card says
// ---------------------------------------------------------------------------

test("the held run's line says where the blocks are once they are on the page", () => {
  assert.equal(
    replay.runConflictLine(named("worked example"), true),
    "Your 3 new blocks are on the page after this paragraph. Either answer keeps them."
  );
  assert.equal(
    replay.runConflictLine(named("special characters"), true),
    "Your 1 new block is on the page after this paragraph. Either answer keeps it."
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

// Fix round F5 (CL 20): the one shared copy of "the first few words".
test("normalize.firstWords cuts to the word limit and adds the suffix only when it cut", () => {
  const normalize = require("../../src/shared/normalize.js");
  assert.equal(normalize.firstWords("  one   two three four  ", 3), "one two three");
  assert.equal(normalize.firstWords("one two three four", 3, "..."), "one two three...");
  assert.equal(normalize.firstWords("one two", 3, "..."), "one two");
  assert.equal(normalize.firstWords(null, 3, "..."), "");
});
