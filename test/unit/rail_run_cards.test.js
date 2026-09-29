// The rail's reading of a free-writing record (plan Tasks 3.2 and 3.3).
//
// The pure halves: the pinned two-line summary a run's card and edits row lead
// with, the block-by-block list under the card's disclosure, the empty-page
// lines, and what the proofreading question's two buttons would do. The drawn
// halves are in test/browser/edits_tab.spec.js and agent_replies.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const overlay = require("../../src/layer/overlay.js");
const tabDone = require("../../src/layer/tab_done.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const fx = createFixtures({ seed: "rail-run-cards" });

function fixture(name) {
  const found = fx.runFixtures().find((f) => f.name === name);
  if (!found) throw new Error("no run fixture named " + name);
  return found.item;
}

// ---------------------------------------------------------------------------
// The two-line summary
// ---------------------------------------------------------------------------

test("a run after a paragraph reads as new text after the anchor's first words, and its shape by count", () => {
  const item = fx.runItem({
    before: "Then I tried asking for one paragraph at a time, which kept the chat short.",
    before_html: "Then I tried asking for one paragraph at a time, which kept the chat short.",
    anchor_after_html: "Then I tried asking for one paragraph at a time, which kept the chat short.",
    new_blocks: [
      { tag: "h2", html: "What the chat window cost me" },
      { tag: "p", html: "Every draft came back as a wall of text." },
      { tag: "p", html: "The draft also lost its shape." },
      { tag: "ul", html: "<li>Twenty minutes</li><li>A second round trip</li><li>No record</li>" }
    ]
  });
  const s = overlay.runSummary(item);
  assert.equal(s.first, "New text after 'Then I tried asking for one...'");
  assert.equal(s.second, "A heading, 'What the chat window cost me', then 2 paragraphs and a 3-item list.");
});

test("each block is listed by the block menu's label, with its words", () => {
  const s = overlay.runSummary(fixture("worked example"));
  assert.deepEqual(
    s.blocks.map((b) => [b.label, b.moved]),
    [
      ["Heading", false],
      ["Paragraph", false],
      ["Bulleted list", false]
    ]
  );
  assert.equal(s.blocks[1].text, "I lost my place every time zqxcanary");
});

test("a split tail reads as moved, never as added", () => {
  const alone = overlay.runSummary(fixture("split tail, no typing"));
  assert.equal(alone.first, "Edit of 'First half zqxcanary. Second half zqxcanary.'");
  assert.equal(alone.second, "A paragraph moved out of it.");
  assert.deepEqual(alone.blocks.map((b) => [b.label, b.moved]), [["Paragraph", true]]);

  const typed = overlay.runSummary(fixture("split tail, with typing"));
  assert.equal(typed.first, "Edit of 'First half zqxcanary. Second half zqxcanary.' plus new text");
  assert.equal(typed.second, "A paragraph moved out of it, then a paragraph.");
});

test("a reworded anchor plus new blocks reads as an edit plus new text", () => {
  const item = fx.runItem({
    before: "Old words here",
    before_html: "Old words here",
    anchor_after_html: "New words here",
    new_blocks: [{ tag: "p", html: "And more" }]
  });
  const s = overlay.runSummary(item);
  assert.equal(s.first, "Edit of 'Old words here' plus new text");
  assert.equal(s.second, "A paragraph.");
});

test("a run at the start of an empty page says so", () => {
  const s = overlay.runSummary(fixture("start of container"));
  assert.equal(s.first, "New text at the start of the page");
  assert.equal(s.second, "A heading, 'Notes zqxcanary', then a paragraph.");
});

test("a numbered list, a subheading and a small heading are named as the menu names them", () => {
  const item = fx.runItem({
    new_blocks: [
      { tag: "h3", html: "Sub" },
      { tag: "h4", html: "Small" },
      { tag: "ol", html: "<li>one</li>" }
    ]
  });
  const s = overlay.runSummary(item);
  assert.equal(s.second, "A subheading, 'Sub', then a small heading, 'Small' and a 1-item numbered list.");
  assert.deepEqual(
    s.blocks.map((b) => b.label),
    ["Subheading", "Small heading", "Numbered list"]
  );
});

test("a record with no new blocks has no run summary, so its row stays as it was", () => {
  assert.equal(overlay.runSummary(fixture("tag-only change")), null);
  assert.equal(overlay.runSummary(fixture("take-back")), null);
  assert.equal(overlay.runSummary(fx.edit()), null);
});

test("a folded run card shows the summary's first line, not the agent-facing change text", () => {
  const item = fixture("worked example");
  assert.equal(overlay.collapsedLineText(item, 200), "New text after 'What changed'");
});

// ---------------------------------------------------------------------------
// The empty page
// ---------------------------------------------------------------------------

test("the empty-page lines name the file when the page has a file-name title", () => {
  assert.deepEqual(overlay.emptyPageLines("2026-09-28.md"), [
    "Nothing written yet",
    "Start typing. Your notes go to 2026-09-28.md.",
    "Each time you stop writing, everything you wrote in that sitting becomes one card here, and the agent places it in the file.",
    "The agent only places your words. It organizes the notes when you ask it to."
  ]);
});

test("without a file-name title the second line is only the instruction", () => {
  assert.equal(overlay.emptyPageLines(null)[1], "Start typing.");
  assert.equal(overlay.emptyPageLines("")[1], "Start typing.");
});

// ---------------------------------------------------------------------------
// The proofreading question
// ---------------------------------------------------------------------------

test("only a question marked proofread on a run record offers the two answers", () => {
  const proof = fx.proofreadQuestion();
  const offer = tabDone.proofreadOffer(proof);
  assert.ok(offer, "a proofread question offers answers");
  assert.equal(offer.keepMine, true);
  assert.ok(offer.useFixes, "its suggestions apply, so Use the fixes is offered");

  const plain = fx.proofreadQuestion();
  plain.reply = Object.assign({}, proof.reply);
  delete plain.reply.proofread;
  delete plain.reply.suggestions;
  plain.reply.text = "Should this go under Intro?";
  assert.equal(tabDone.proofreadOffer(plain), null, "a placement question on a run record offers nothing");

  const handled = fx.proofreadQuestion();
  handled.reply = Object.assign({}, handled.reply, { status: record.REPLY_STATUS.HANDLED });
  assert.equal(tabDone.proofreadOffer(handled), null, "a handled reply is not a question");
});

test("a proofread whose suggestion cannot apply offers Keep mine only", () => {
  const proof = fx.proofreadQuestion();
  proof.reply.suggestions = [{ block: 0, from: "words that are not there", to: "x" }];
  const offer = tabDone.proofreadOffer(proof);
  assert.equal(offer.keepMine, true);
  assert.equal(offer.useFixes, null);
});

test("Use the fixes is the reviewer's reword at the next revision, carrying the pinned reply", () => {
  const proof = fx.proofreadQuestion();
  const next = tabDone.proofreadOffer(proof).useFixes;
  assert.equal(next.rev, proof.rev + 1, "one revision, not two");
  assert.equal(next.state, record.STATE.READY);
  assert.equal(next.reply, null);
  assert.equal(next.note, "Use the fixes you listed. Change nothing else.");
  assert.equal(next.new_blocks[1].html, "I lost my spot <strong>every</strong> time zqxcanary");
  assert.equal(next.new_blocks[0].html, "What the chat window cost us zqxcanary");
  assert.match(next.after, /cost us/);
  assert.equal(next.thread.length, proof.thread ? proof.thread.length + 1 : 1, "the question is archived as a round");
  assert.equal(next.thread[next.thread.length - 1].agent.status, record.REPLY_STATUS.QUESTION);
  assert.equal(next.change, proof.change, "the change sentence is carried");
});

test("Keep mine carries the pinned text and changes no words", () => {
  const proof = fx.proofreadQuestion();
  const next = tabDone.keepMineRecord(proof);
  assert.equal(next.rev, proof.rev + 1);
  assert.equal(next.note, "Keep mine as written. No changes.");
  assert.deepEqual(next.new_blocks, proof.new_blocks);
  assert.equal(next.state, record.STATE.READY);
});

test("the pinned words", () => {
  assert.equal(tabDone.PROOFREAD.USE_LABEL, "Use the fixes");
  assert.equal(tabDone.PROOFREAD.KEEP_LABEL, "Keep mine");
  assert.equal(tabDone.PROOFREAD.WAITING, "Waiting on the agent");
});
