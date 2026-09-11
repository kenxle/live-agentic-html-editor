// The revert check: a handled hand edit whose change is gone from the page
// while the text it replaced is back.
//
// Owner: 3C. The browser half is test/browser/edits_tab.spec.js, which reverts a
// real source file, rebuilds, reloads, and asserts the card comes back out of
// Done. This file pins the DECISION, which is a pure function of a record and
// the page's current text, plus the sentence the reopened item carries.
//
// The two halves of the decision are the whole point, so both negatives get
// their own test: after-gone alone is a legitimate rewrite and must not reopen
// anything, and before-back only counts alongside after-gone.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const replay = require("../../src/layer/replay.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "3c-revert" });

const BEFORE = "The trainer writes the plan every week.";
const AFTER = "The trainer writes the plan each week.";

function handledEdit(overrides) {
  const item = fixtures.edit(overrides || {});
  item[record.FIELD.STATE] = record.STATE.HANDLED;
  item[record.FIELD.REPLY] = { status: "handled", agent: "claude", at: "2026-08-19T00:00:00.000Z" };
  return item;
}

function page(passage) {
  return "A heading above it. " + passage + " And a paragraph below it.";
}

test("a handled edit whose after is gone and whose before is back qualifies", () => {
  const item = handledEdit();
  assert.equal(replay.isRevertedHandledEdit(item, page(BEFORE)), true);
});

test("after gone on its own is a rewrite, not a revert, and does not qualify", () => {
  const item = handledEdit();
  const rewritten = page("The coach drafts a new plan for the athlete every Sunday night.");
  assert.equal(replay.isRevertedHandledEdit(item, rewritten), false);
});

test("the edit still standing on the page does not qualify", () => {
  const item = handledEdit();
  assert.equal(replay.isRevertedHandledEdit(item, page(AFTER)), false);
});

test("rewrapping the page is not a revert: the compare ignores whitespace", () => {
  const item = handledEdit();
  const rewrapped = "A heading above it.\n\n   The trainer\n   writes the plan\n   each week.\n";
  assert.equal(replay.isRevertedHandledEdit(item, rewrapped), false);
});

test("whitespace in the source does not hide a real revert either", () => {
  const item = handledEdit();
  const rewrapped = "A heading above it.\n\n   The trainer\n   writes the plan\n   every week.\n";
  assert.equal(replay.isRevertedHandledEdit(item, rewrapped), true);
});

test("a draft or ready edit never qualifies: only a handled one was ever decided", () => {
  const ready = fixtures.edit();
  assert.equal(ready[record.FIELD.STATE], record.STATE.READY);
  assert.equal(replay.isRevertedHandledEdit(ready, page(BEFORE)), false);

  const draft = fixtures.edit({ state: record.STATE.DRAFT });
  assert.equal(replay.isRevertedHandledEdit(draft, page(BEFORE)), false);
});

test("a comment is not a hand edit and never qualifies", () => {
  const comment = fixtures.comment({ state: record.STATE.HANDLED });
  assert.equal(replay.isRevertedHandledEdit(comment, page(BEFORE)), false);
});

test("an item with no before text has nothing to come back, so it never qualifies", () => {
  assert.equal(replay.isRevertedHandledEdit(handledEdit({ before: null }), page(BEFORE)), false);
  assert.equal(replay.isRevertedHandledEdit(handledEdit({ before: "   " }), page(BEFORE)), false);
});

test("an item whose after was never page text never qualifies", () => {
  assert.equal(replay.isRevertedHandledEdit(handledEdit({ after: null }), page(BEFORE)), false);
  assert.equal(replay.isRevertedHandledEdit(handledEdit({ after: "" }), page(BEFORE)), false);
  // A delete carries no after text at all.
  const deleted = fixtures.deletion({ state: record.STATE.HANDLED });
  assert.equal(replay.isRevertedHandledEdit(deleted, page(BEFORE)), false);
});

test("a format-only record cannot qualify: its before and after are the same text", () => {
  const formatted = fixtures.formatOnly({ state: record.STATE.HANDLED });
  assert.equal(formatted[record.FIELD.BEFORE], formatted[record.FIELD.AFTER]);
  assert.equal(replay.isRevertedHandledEdit(formatted, page(formatted[record.FIELD.BEFORE])), false);
});

test("nothing qualifies against an empty page or a missing record", () => {
  assert.equal(replay.isRevertedHandledEdit(handledEdit(), ""), false);
  assert.equal(replay.isRevertedHandledEdit(handledEdit(), null), false);
  assert.equal(replay.isRevertedHandledEdit(null, page(BEFORE)), false);
});

test("the id list picks out only the reverted items", () => {
  const reverted = handledEdit();
  const standing = handledEdit();
  const ready = fixtures.edit();
  const ids = replay.revertedHandledEditIds([reverted, standing, ready], page(BEFORE) + " " + AFTER);
  // Both handled items carry the same before and after text, so the page above
  // holds the after text once, which clears both of them.
  assert.deepEqual(ids, []);

  const onlyBefore = replay.revertedHandledEditIds([reverted, ready], page(BEFORE));
  assert.deepEqual(onlyBefore, [reverted[record.FIELD.ID]]);
});

test("a take-back is not drift: an item another record reverts is left alone", () => {
  // The page looks IDENTICAL in both cases: the reviewer's wording gone, the
  // text it replaced back. The difference is in the log, and it is the whole
  // reason this list function exists rather than the single-item check alone.
  const takenBack = handledEdit();
  const drifted = handledEdit();
  const pageText = page(BEFORE);

  // Nothing says anyone asked, so it is drift and it reopens.
  assert.deepEqual(replay.revertedHandledEditIds([drifted], pageText), [drifted[record.FIELD.ID]]);

  // The reviewer pressed Undo, which mints a record naming what it took back.
  // Reopening now would ask the agent to reapply the exact change the reviewer
  // had just withdrawn, while the revert record beside it asks for the opposite.
  const revert = record.revertOf(takenBack);
  assert.deepEqual(replay.revertedHandledEditIds([takenBack, revert], pageText), []);

  // And the check itself is untouched: it still says what it sees.
  assert.equal(replay.isRevertedHandledEdit(takenBack, pageText), true);

  // One item's take-back does not cover another's drift.
  assert.deepEqual(replay.revertedHandledEditIds([takenBack, revert, drifted], pageText), [
    drifted[record.FIELD.ID]
  ]);
});

test("the note the reopened item carries names the check and asks for the change back", () => {
  assert.equal(
    replay.REVERTED_EDIT_NOTE,
    "Reopened by the page check: this handled change is no longer on the page and the original text is back. " +
      "Reapply it, or reply not_handled saying why."
  );
  // It says whose sentence it is, because the record has no field that could.
  assert.match(replay.REVERTED_EDIT_NOTE, /^Reopened by the page check:/);
  // And it carries no page text: the item already holds the before and after.
  assert.equal(replay.REVERTED_EDIT_NOTE.indexOf(BEFORE), -1);
  assert.equal(replay.REVERTED_EDIT_NOTE.indexOf(AFTER), -1);
});

// ---------------------------------------------------------------------------
// The page text the check reads
// ---------------------------------------------------------------------------

function node(tag, children) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attrs: {},
    firstChild: null,
    nextSibling: null,
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    setAttribute: function (name, value) {
      this.attrs[name] = value;
    },
    className: "",
    append: function (list) {
      let prev = null;
      list.forEach(function (child) {
        if (prev) prev.nextSibling = child;
        prev = child;
      });
      this.firstChild = list[0] || null;
      return this;
    }
  }.append(children || []);
}

function text(value) {
  return { nodeType: 3, nodeValue: value, nextSibling: null };
}

test("the page text leaves the library's own chrome out", () => {
  const markers = require("../../src/shared/markers.js");
  const rail = node("div", [text("Reopen issue " + AFTER)]);
  markers.markChrome(rail);
  const body = node("body", [node("p", [text(BEFORE)]), rail]);

  const pageText = replay.pageTextOf(body);
  assert.equal(pageText, BEFORE);
  // Without the skip, the rail's own copy of the after text would say the edit
  // was still standing.
  const item = handledEdit();
  assert.equal(replay.isRevertedHandledEdit(item, pageText), true);
});

test("the page text joins text nodes the way textContent does", () => {
  const body = node("body", [node("p", [text("Ken"), text(" St. Clair")])]);
  assert.equal(replay.pageTextOf(body), "Ken St. Clair");
  assert.equal(replay.pageTextOf(null), "");
});

// ---------------------------------------------------------------------------
// The loop, and the three things that stop it
// ---------------------------------------------------------------------------
//
// What happened on 2026-09-10, in review rbbe2de599404. The reviewer split a
// numbered list item in two and added a sentence. The agent applied it as a new
// numbered item instead, which was a legitimate reading and the one the
// reviewer had actually meant. So the record's `after` was never on the page as
// one block, and the record's `before` was still sitting there untouched: both
// halves of the check held, on a page nobody had reverted. The check reopened
// the item, the agent replied handled, the check read the same page and
// reopened it again. Thirteen revisions in thirty six minutes, each one waking
// the agent and appending another copy of the same sentence to the note.

/** The agent answering the revision in front of it. */
function answeredHandled(item, at) {
  const next = Object.assign({}, item);
  next[record.FIELD.STATE] = record.STATE.HANDLED;
  next[record.FIELD.REPLY] = { status: "handled", agent: "claude", at: at };
  return next;
}

test("the page check reopens a stuck item once, and the agent's next handled reply ends it", () => {
  const pageText = page(BEFORE);
  const first = handledEdit();

  // Pass one. Nothing has been stamped, the page reads reverted, so it reopens.
  assert.equal(replay.isRevertedHandledEdit(first, pageText), true);
  const reopened = record.pageCheckReopenOf(first, replay.REVERTED_EDIT_NOTE, "2026-09-10T16:31:00.000Z");
  assert.equal(reopened[record.FIELD.STATE], record.STATE.READY);
  assert.equal(reopened[record.FIELD.REV], first[record.FIELD.REV] + 1, "the reopen bumped the rev");
  assert.equal(reopened.region.check_reopen.rev, reopened[record.FIELD.REV], "and stamped the rev it created");

  // Pass two. The agent answers handled again and the page has not moved: this
  // is the agent saying the rendering is intended, and the loop's first turn.
  const answered = answeredHandled(reopened, "2026-09-10T16:33:00.000Z");
  assert.equal(
    replay.isRevertedHandledEdit(answered, pageText),
    false,
    "the check does not reopen its own reopen coming back"
  );
  assert.deepEqual(replay.revertedHandledEditIds([answered], pageText), []);
});

test("the reopen sentence lands in the note exactly once, however many cycles run", () => {
  let item = handledEdit();
  let at = Date.parse("2026-09-10T16:31:00.000Z");
  for (let cycle = 0; cycle < 13; cycle += 1) {
    const when = new Date(at + cycle * 180000).toISOString();
    // Forced, so the note path is exercised even once the rule has closed it.
    item = answeredHandled(record.pageCheckReopenOf(item, replay.REVERTED_EDIT_NOTE, when), when);
  }
  const copies = item[record.FIELD.NOTE].split(replay.REVERTED_EDIT_NOTE).length - 1;
  assert.equal(copies, 1, "thirteen reopens, one sentence");
});

test("the reviewer's own words are kept, with the sentence added under them once", () => {
  const item = handledEdit({ note: "Please split this into two paragraphs." });
  const once = record.pageCheckReopenOf(item, replay.REVERTED_EDIT_NOTE, "2026-09-10T16:31:00.000Z");
  assert.match(once[record.FIELD.NOTE], /^Please split this into two paragraphs\./);
  assert.match(once[record.FIELD.NOTE], /Reopened by the page check:/);
  const twice = record.pageCheckReopenOf(
    answeredHandled(once, "2026-09-10T16:33:00.000Z"),
    replay.REVERTED_EDIT_NOTE,
    "2026-09-10T16:35:00.000Z"
  );
  assert.equal(twice[record.FIELD.NOTE].split(replay.REVERTED_EDIT_NOTE).length - 1, 1);
});

test("a note carrying the sentence many times collapses to one copy when it is read", () => {
  const item = handledEdit({ note: "Split this in two." });
  const damaged = Object.assign({}, item);
  damaged[record.FIELD.NOTE] =
    "Split this in two.\n\n" + new Array(13).fill(replay.REVERTED_EDIT_NOTE).join("\n\n");
  const fixed = record.collapsePageCheckNote(damaged);
  assert.equal(fixed[record.FIELD.NOTE].split(replay.REVERTED_EDIT_NOTE).length - 1, 1);
  assert.match(fixed[record.FIELD.NOTE], /^Split this in two\./, "the reviewer's own words survive");

  // A note with one copy, or none, comes back untouched and unrewritten.
  assert.equal(record.collapsePageCheckNote(fixed), fixed);
  assert.equal(record.collapsePageCheckNote(item), item);
});

test("the cooldown holds a second check-reopen back even when the rev has moved on", () => {
  // The reviewer reworded after the check reopened, so the stamped rev no longer
  // matches and the stamp rule has let go. The clock has not.
  const reopened = record.pageCheckReopenOf(handledEdit(), replay.REVERTED_EDIT_NOTE, "2026-09-10T16:31:00.000Z");
  const moved = answeredHandled(record.bumpRev(reopened, {}), "2026-09-10T16:31:30.000Z");
  const at = Date.parse("2026-09-10T16:31:00.000Z");

  assert.equal(
    replay.isRevertedHandledEdit(moved, page(BEFORE), { now: at + 30000 }),
    false,
    "half a minute after the last check-reopen, not again"
  );
  assert.equal(
    replay.isRevertedHandledEdit(moved, page(BEFORE), { now: at + replay.CHECK_REOPEN_COOLDOWN_MS + 1 }),
    true,
    "past the cooldown, a genuine revert is still caught"
  );
  assert.equal(replay.CHECK_REOPEN_COOLDOWN_MS, 60000);
});

test("a later revert, long after the check's own round closed, still reopens", () => {
  // The honest case must survive all of the above: the reviewer reopened by
  // hand months later, the agent answered handled, and a build then took the
  // change back out.
  const reopened = record.pageCheckReopenOf(handledEdit(), replay.REVERTED_EDIT_NOTE, "2026-09-10T16:31:00.000Z");
  const laterRound = record.bumpRev(answeredHandled(reopened, "2026-09-10T16:33:00.000Z"), {});
  const answered = answeredHandled(laterRound, "2026-12-01T09:00:00.000Z");
  assert.equal(
    replay.isRevertedHandledEdit(answered, page(BEFORE), { now: Date.parse("2026-12-01T09:05:00.000Z") }),
    true
  );
});

// ---------------------------------------------------------------------------
// The other half of "not on the page": the words landed, the emphasis did not
// ---------------------------------------------------------------------------
//
// 2026-09-11. The reviewer made a word italic and a clause bold inside a
// rewrite, the agent carried the words into a Markdown source and not the
// emphasis and replied handled, and the check read text alone and saw a change
// fully applied.

const ITALIC_AFTER = "The trainer writes the plan each week.";
const ITALIC_AFTER_HTML = "<p>The trainer writes the plan <em>each</em> week.</p>";

function formattedEdit(overrides) {
  return handledEdit(
    Object.assign(
      {
        after: ITALIC_AFTER,
        after_html: ITALIC_AFTER_HTML,
        before_html: "<p>The trainer writes the plan every week.</p>"
      },
      overrides || {}
    )
  );
}

function pageHtml(passage) {
  return "<h2>A heading above it.</h2>" + passage + "<p>And a paragraph below it.</p>";
}

test("a handled edit whose words landed without its italic is reopened, with its own sentence", () => {
  const item = formattedEdit();
  const plain = { pageHtml: pageHtml("<p>The trainer writes the plan each week.</p>") };
  assert.equal(replay.isRevertedHandledEdit(item, page(ITALIC_AFTER), plain), true);
  assert.equal(replay.pageCheckReasonFor(item, page(ITALIC_AFTER), plain), replay.PAGE_CHECK_REASON.FORMATTING);
  assert.equal(replay.pageCheckNoteFor(item, page(ITALIC_AFTER), plain), replay.FORMATTING_LOST_NOTE);
  assert.notEqual(replay.FORMATTING_LOST_NOTE, replay.REVERTED_EDIT_NOTE);
});

test("the same edit with its italic on the page is left alone", () => {
  const item = formattedEdit();
  const carried = { pageHtml: pageHtml(ITALIC_AFTER_HTML) };
  assert.equal(replay.isRevertedHandledEdit(item, page(ITALIC_AFTER), carried), false);
  assert.equal(replay.pageCheckNoteFor(item, page(ITALIC_AFTER), carried), null);
  // The rebuilt page is free to say it differently, as long as it still says it.
  const reserialized = {
    pageHtml: pageHtml('<p class="lead">The trainer writes the plan <i>each</i>\n   week.</p>')
  };
  assert.equal(replay.isRevertedHandledEdit(item, page(ITALIC_AFTER), reserialized), false);
});

test("a revert still reads as a revert, and carries the revert sentence", () => {
  const item = formattedEdit();
  const options = { pageHtml: pageHtml("<p>The trainer writes the plan every week.</p>") };
  assert.equal(replay.pageCheckReasonFor(item, page(BEFORE), options), replay.PAGE_CHECK_REASON.REVERTED);
  assert.equal(replay.pageCheckNoteFor(item, page(BEFORE), options), replay.REVERTED_EDIT_NOTE);
});

test("emphasis the page adds of its own is not a loss and reopens nothing", () => {
  // The record asks for nothing about emphasis, so the page rendering the block
  // with its own <em> is rendering, not losing anything.
  const item = handledEdit();
  const extra = { pageHtml: pageHtml("<p>The trainer writes the plan <em>each</em> week.</p>") };
  assert.equal(replay.isRevertedHandledEdit(item, page(AFTER), extra), false);

  // And a page that emphasizes MORE words than the record asked for still says
  // what the record asked for.
  const wider = { pageHtml: pageHtml("<p>The trainer writes <em>the plan each week.</em></p>") };
  assert.equal(replay.isRevertedHandledEdit(formattedEdit(), page(ITALIC_AFTER), wider), false);
});

test("un-bolding is carried too: the words are bold on the page again", () => {
  const item = handledEdit({
    before_html: "<p>Runners come back <strong>too fast</strong> after a layoff.</p>",
    after_html: "<p>Runners come back <not-bold>too fast</not-bold> after a layoff.</p>",
    before: "Runners come back too fast after a layoff.",
    after: "Runners come back too fast after a layoff."
  });
  // before and after read the same, so the revert half can never fire here.
  const stillBold = { pageHtml: pageHtml("<p>Runners come back <strong>too fast</strong> after a layoff.</p>") };
  const page_ = page("Runners come back too fast after a layoff.");
  assert.equal(replay.pageCheckReasonFor(item, page_, stillBold), replay.PAGE_CHECK_REASON.FORMATTING);

  // A source that dropped the ** has no <strong> left, which is what the reset
  // asked for, so nothing is reopened.
  const unbolded = { pageHtml: pageHtml("<p>Runners come back too fast after a layoff.</p>") };
  assert.equal(replay.pageCheckReasonFor(item, page_, unbolded), null);
});

test("a record whose markup no longer says its text is never reopened for formatting", () => {
  // The reviewer reworded without the markup following. The writer will not use
  // after_html either, so the check must not ask for it.
  const item = formattedEdit({ after: "The trainer writes a different plan." });
  const plain = { pageHtml: pageHtml("<p>The trainer writes a different plan.</p>") };
  assert.equal(replay.isRevertedHandledEdit(item, page("The trainer writes a different plan."), plain), false);
});

test("with no page markup to read, the check answers on text alone", () => {
  const item = formattedEdit();
  assert.equal(replay.isRevertedHandledEdit(item, page(ITALIC_AFTER)), false);
  assert.equal(replay.isRevertedHandledEdit(item, page(BEFORE)), true);
});

test("the sweep reads the page's structure once and hands it to every item", () => {
  const lost = formattedEdit();
  const standing = formattedEdit();
  const options = { pageHtml: pageHtml("<p>The trainer writes the plan each week.</p>") };
  const ids = replay.revertedHandledEditIds([lost, standing], page(ITALIC_AFTER), options);
  assert.deepEqual(ids, [lost[record.FIELD.ID], standing[record.FIELD.ID]]);
  // The caller's own options object is not written into.
  assert.equal(Object.prototype.hasOwnProperty.call(options, "pageStructure"), false);
});

test("pageCheckOptions reads the document's markup once for the whole sweep", () => {
  const body = { innerHTML: pageHtml(ITALIC_AFTER_HTML) };
  const options = replay.pageCheckOptions(body);
  assert.equal(options.pageHtml, body.innerHTML);
  assert.equal(replay.isRevertedHandledEdit(formattedEdit(), page(ITALIC_AFTER), options), false);
  assert.equal(replay.pageCheckOptions(null).pageHtml, null);
});

test("the reopened item carries the formatting sentence at most once", () => {
  const item = formattedEdit();
  const once = record.pageCheckReopenOf(item, replay.FORMATTING_LOST_NOTE, "2026-09-11T06:45:00.000Z");
  assert.equal(once[record.FIELD.NOTE].split(replay.FORMATTING_LOST_NOTE).length - 1, 1);
  const twice = record.pageCheckReopenOf(
    Object.assign({}, once, {
      [record.FIELD.REPLY]: { status: "handled", agent: "claude", at: "2026-09-11T06:46:00.000Z" }
    }),
    replay.FORMATTING_LOST_NOTE,
    "2026-09-11T06:47:00.000Z"
  );
  assert.equal(twice[record.FIELD.NOTE].split(replay.FORMATTING_LOST_NOTE).length - 1, 1);
});

test("a stored note holding many copies of either sentence collapses to one of each", () => {
  const both =
    record.PAGE_CHECK_NOTE +
    "\n\n" +
    record.PAGE_CHECK_NOTE +
    "\n\nthe reviewer's own words\n\n" +
    record.PAGE_CHECK_FORMAT_NOTE +
    "\n\n" +
    record.PAGE_CHECK_FORMAT_NOTE;
  const collapsed = record.collapsePageCheckNote({ [record.FIELD.NOTE]: both });
  assert.equal(collapsed[record.FIELD.NOTE].split(record.PAGE_CHECK_NOTE).length - 1, 1);
  assert.equal(collapsed[record.FIELD.NOTE].split(record.PAGE_CHECK_FORMAT_NOTE).length - 1, 1);
  assert.equal(collapsed[record.FIELD.NOTE].indexOf("the reviewer's own words") !== -1, true);
  const clean = { [record.FIELD.NOTE]: record.PAGE_CHECK_FORMAT_NOTE };
  assert.equal(record.collapsePageCheckNote(clean), clean, "nothing to collapse returns the same object");
});
