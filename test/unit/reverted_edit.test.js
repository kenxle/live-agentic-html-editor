// The page check on a handled hand edit.
//
// Spec docs/features/20261011.01_stuck_replayed_blocks/01_spec_flag_dont_hold.md.
// After the agent answers handled, the page is the file. The check used to
// reopen a handled edit whose words were reverted, or whose bold or italic was
// lost, and replay then wrote the reviewer's old words back. Now neither
// reopens anything (requirement 2), and the one round left is the stamp round
// (requirement 5): the words landed and the data-lahe-id did not reach an HTML
// source. That round is between the tool and the agent.
//
// The browser half is test/browser/reverted_edit.spec.js.

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

function stampedEdit(stamp, overrides) {
  return handledEdit(
    Object.assign(
      {
        region: { ref: { id: "ref_edit", probe: null, stamp: stamp }, label: "Stamped region", lost: null },
        page_path: "/doc.html"
      },
      overrides || {}
    )
  );
}

/** The document as the check reads it: the ids on it, and the helper's answer. */
function rebuilt(stamps, carriable) {
  return {
    stamps: (stamps || []).reduce(function (set, id) {
      set[id] = true;
      return set;
    }, {}),
    stampCarriable: carriable === undefined ? true : carriable
  };
}

/** The agent answering the revision in front of it. */
function answeredHandled(item, at) {
  const next = Object.assign({}, item);
  next[record.FIELD.STATE] = record.STATE.HANDLED;
  next[record.FIELD.REPLY] = { status: "handled", agent: "claude", at: at };
  return next;
}

// ---------------------------------------------------------------------------
// Requirement 2: no reopen over the reviewer's words
// ---------------------------------------------------------------------------

test("a handled edit whose words were reverted on the page is not reopened", () => {
  const item = handledEdit();
  assert.equal(replay.pageCheckReasonFor(item, page(BEFORE)), null);
  assert.deepEqual(replay.pageCheckIds([item], page(BEFORE)), []);
  // Not even when the page could be read in full and the source holds ids.
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-1a2b3c"), page(BEFORE), rebuilt([])), null);
});

test("a handled edit the agent rewrote is not reopened", () => {
  const rewritten = page("The coach drafts a new plan for the athlete every Sunday night.");
  assert.equal(replay.pageCheckReasonFor(handledEdit(), rewritten), null);
});

test("a handled edit whose italic the rebuild dropped is not reopened", () => {
  const item = handledEdit({ after_html: "<p>The trainer writes the plan <em>each</em> week.</p>" });
  assert.equal(replay.pageCheckReasonFor(item, page(AFTER)), null);
  assert.equal(replay.pageCheckReasonFor(item, page(AFTER), { pageHtml: "<p>" + AFTER + "</p>" }), null);
});

test("un-bolding the page did not carry is not reopened either", () => {
  const item = handledEdit({
    before_html: "<p>Runners come back <strong>too fast</strong> after a layoff.</p>",
    after_html: "<p>Runners come back <not-bold>too fast</not-bold> after a layoff.</p>",
    before: "Runners come back too fast after a layoff.",
    after: "Runners come back too fast after a layoff."
  });
  assert.equal(replay.pageCheckReasonFor(item, page("Runners come back too fast after a layoff.")), null);
});

test("only a handled hand edit is ever asked about", () => {
  const ready = fixtures.edit();
  assert.equal(replay.pageCheckReasonFor(ready, page(AFTER), rebuilt([])), null);
  const comment = fixtures.comment({ state: record.STATE.HANDLED });
  assert.equal(replay.pageCheckReasonFor(comment, page(AFTER), rebuilt([])), null);
  assert.equal(replay.pageCheckReasonFor(null, page(AFTER)), null);
  assert.equal(replay.pageCheckReasonFor(handledEdit(), null), null);
});

test("the removed reasons and their sentences are gone", () => {
  assert.deepEqual(Object.keys(replay.PAGE_CHECK_REASON), ["STAMP"]);
  ["REVERTED_EDIT_NOTE", "FORMATTING_LOST_NOTE", "TAG_WRONG_NOTE", "TAKEBACK_NOTE", "CHECK_NOTICES"].forEach((name) => {
    assert.equal(replay[name], undefined, name);
  });
  ["isRevertedHandledEdit", "pageCheckNoteFor", "pageCheckNoticeFor", "pageCheckToolFor", "runCheckReason", "revertedHandledEditIds"].forEach(
    (name) => {
      assert.equal(replay[name], undefined, name);
    }
  );
  assert.equal(record.PAGE_CHECK_NOTE, undefined);
  assert.equal(record.PAGE_CHECK_FORMAT_NOTE, undefined);
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
  // Without the skip, the rail's own copy of the after text would read as the
  // words having landed, and a missing id would open a round for an element
  // that is not on the page.
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-1a2b3c"), pageText, rebuilt([])), null);
});

test("the page text joins text nodes the way textContent does", () => {
  const body = node("body", [node("p", [text("Ken"), text(" St. Clair")])]);
  assert.equal(replay.pageTextOf(body), "Ken St. Clair");
  assert.equal(replay.pageTextOf(null), "");
});

// ---------------------------------------------------------------------------
// S7: the change landed and the id did not
// ---------------------------------------------------------------------------
//
// The reviewer's page wrote data-lahe-id onto the element the moment they
// touched it, and the contract asks the agent to carry that attribute into the
// source. An agent that rewrites the words and drops the attribute leaves a
// page that READS right and can only be found by its words again. The check
// asks for the id once, as a round the reviewer never sees.

test("S7: the words are on the page and no element carries the id, so the round opens", () => {
  const item = stampedEdit("e-1a2b3c");
  assert.equal(replay.pageCheckReasonFor(item, page(AFTER), rebuilt(["e-something-else"])), replay.PAGE_CHECK_REASON.STAMP);
  assert.deepEqual(replay.pageCheckIds([item], page(AFTER), rebuilt([])), [item[record.FIELD.ID]]);
});

test("S7: the id in the rebuilt source is the whole ask, and it closes the check", () => {
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-1a2b3c"), page(AFTER), rebuilt(["e-1a2b3c"])), null);
});

test("S7: a whitespace rewrap still reads as the words having landed", () => {
  const rewrapped = "A heading above it.\n\n   The trainer\n   writes the plan\n   each week.\n";
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-1a2b3c"), rewrapped, rebuilt([])), replay.PAGE_CHECK_REASON.STAMP);
});

test("S7: the words gone means no round: there is no element to carry the id", () => {
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-1a2b3c"), page(BEFORE), rebuilt([])), null);
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-1a2b3c", { after: "" }), page(BEFORE), rebuilt([])), null);
  const deleted = fixtures.deletion({ state: record.STATE.HANDLED });
  assert.equal(replay.pageCheckReasonFor(deleted, page(BEFORE), rebuilt([])), null);
});

test("S7: lost italic does not stop the round, and the round writes nothing", () => {
  // The words landed, so the id is still worth asking for. The round is a tool
  // round, which replay never writes (record.isReplayable), so the italic is
  // not put back by it.
  const item = stampedEdit("e-1a2b3c", { after_html: "<p>The trainer writes the plan <em>each</em> week.</p>" });
  assert.equal(replay.pageCheckReasonFor(item, page(AFTER), rebuilt([])), replay.PAGE_CHECK_REASON.STAMP);
  const round = record.pageCheckReopenOf(item, replay.STAMP_LOST_NOTE, null, record.TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(record.isReplayable(round), false);
});

test("S7: a record with no stamp is untouched, because nothing went missing", () => {
  assert.equal(replay.pageCheckReasonFor(handledEdit(), page(AFTER), rebuilt([])), null);
  assert.equal(replay.pageCheckReasonFor(stampedEdit(null), page(AFTER), rebuilt([])), null);
  assert.equal(replay.pageCheckReasonFor(stampedEdit(""), page(AFTER), rebuilt([])), null);
});

test("S7: with no id list read off the document, the absence is not evidence", () => {
  const item = stampedEdit("e-1a2b3c");
  assert.equal(replay.pageCheckReasonFor(item, page(AFTER)), null);
  assert.equal(replay.pageCheckReasonFor(item, page(AFTER), { stamps: null, stampCarriable: true }), null);
});

test("S7: a take-back is not asked about: the reviewer's undo asks for the opposite", () => {
  const takenBack = stampedEdit("e-1a2b3c");
  const revert = record.revertOf(takenBack);
  assert.deepEqual(replay.pageCheckIds([takenBack, revert], page(AFTER), rebuilt([])), []);
  const other = stampedEdit("e-other");
  assert.deepEqual(replay.pageCheckIds([takenBack, revert, other], page(AFTER), rebuilt([])), [other[record.FIELD.ID]]);
});

test("S7: the sentence names the check, asks for the id, and carries no page text", () => {
  assert.equal(
    replay.STAMP_LOST_NOTE,
    "Reopened by the page check: the change landed but the data-lahe-id stamp did not reach the source. " +
      "Write the stamp onto that element so the next build reproduces it, or reply not_handled saying why."
  );
  assert.equal(replay.STAMP_LOST_NOTE, record.PAGE_CHECK_STAMP_NOTE);
  assert.equal(replay.STAMP_LOST_NOTE.indexOf(BEFORE), -1);
  assert.equal(replay.STAMP_LOST_NOTE.indexOf(AFTER), -1);
});

// ---------------------------------------------------------------------------
// The loop, and the things that stop it
// ---------------------------------------------------------------------------
//
// On 2026-09-10 the check and an agent answered each other thirteen times in
// thirty six minutes, each round appending another copy of the same sentence.

test("the check opens a round once, and the agent's next handled reply ends it", () => {
  const pageText = page(AFTER);
  const built = rebuilt([]);
  const first = stampedEdit("e-1a2b3c");

  assert.equal(replay.pageCheckReasonFor(first, pageText, built), replay.PAGE_CHECK_REASON.STAMP);
  const reopened = record.pageCheckReopenOf(first, replay.STAMP_LOST_NOTE, "2026-09-10T16:31:00.000Z", record.TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(reopened[record.FIELD.STATE], record.STATE.READY);
  assert.equal(reopened[record.FIELD.REV], first[record.FIELD.REV] + 1, "the reopen bumped the rev");
  assert.equal(reopened.region.check_reopen.rev, reopened[record.FIELD.REV], "and stamped the rev it created");

  const answered = answeredHandled(reopened, "2026-09-10T16:33:00.000Z");
  assert.equal(replay.pageCheckReasonFor(answered, pageText, built), null, "the check does not reopen its own reopen");
  assert.deepEqual(replay.pageCheckIds([answered], pageText, built), []);
});

test("the sentence lands in the note exactly once, however many cycles run", () => {
  let item = stampedEdit("e-1a2b3c", { note: "Please split this into two paragraphs." });
  const at = Date.parse("2026-09-10T16:31:00.000Z");
  for (let cycle = 0; cycle < 13; cycle += 1) {
    const when = new Date(at + cycle * 180000).toISOString();
    item = answeredHandled(record.pageCheckReopenOf(item, replay.STAMP_LOST_NOTE, when, record.TOOL_ROUND.PAGE_CHECK_STAMP), when);
  }
  assert.equal(item[record.FIELD.NOTE].split(replay.STAMP_LOST_NOTE).length - 1, 1, "thirteen rounds, one sentence");
  assert.match(item[record.FIELD.NOTE], /^Please split this into two paragraphs\./, "the reviewer's own words are kept");
});

test("a stored note carrying an old sentence many times collapses to one copy when it is read", () => {
  const item = handledEdit({ note: "Split this in two." });
  const damaged = Object.assign({}, item);
  damaged[record.FIELD.NOTE] = "Split this in two.\n\n" + new Array(13).fill(record.LEGACY_PAGE_CHECK_NOTE).join("\n\n");
  const fixed = record.collapsePageCheckNote(damaged);
  assert.equal(fixed[record.FIELD.NOTE].split(record.LEGACY_PAGE_CHECK_NOTE).length - 1, 1);
  assert.match(fixed[record.FIELD.NOTE], /^Split this in two\./, "the reviewer's own words survive");
  assert.equal(record.collapsePageCheckNote(fixed), fixed, "nothing to collapse returns the same object");

  const many = new Array(5).fill(record.PAGE_CHECK_STAMP_NOTE).join("\n\n");
  const collapsed = record.collapsePageCheckNote({ [record.FIELD.NOTE]: many });
  assert.equal(collapsed[record.FIELD.NOTE].split(record.PAGE_CHECK_STAMP_NOTE).length - 1, 1);
});

test("the cooldown holds a second round back even when the rev has moved on", () => {
  const reopened = record.pageCheckReopenOf(stampedEdit("e-1a2b3c"), replay.STAMP_LOST_NOTE, "2026-09-10T16:31:00.000Z", record.TOOL_ROUND.PAGE_CHECK_STAMP);
  const moved = answeredHandled(record.bumpRev(reopened, {}), "2026-09-10T16:31:30.000Z");
  const at = Date.parse("2026-09-10T16:31:00.000Z");
  const built = rebuilt([]);

  assert.equal(replay.pageCheckReasonFor(moved, page(AFTER), Object.assign({ now: at + 30000 }, built)), null);
  assert.equal(
    replay.pageCheckReasonFor(moved, page(AFTER), Object.assign({ now: at + replay.CHECK_REOPEN_COOLDOWN_MS + 1 }, built)),
    replay.PAGE_CHECK_REASON.STAMP,
    "past the cooldown, the id is asked for again"
  );
  assert.equal(replay.CHECK_REOPEN_COOLDOWN_MS, 60000);
});

// ---------------------------------------------------------------------------
// The source decides whether an id can be asked for at all
// ---------------------------------------------------------------------------
//
// FOUND BY DOGFOODING, 2026-09-14. Markdown has no place for a data-lahe-id,
// and without this rule every handled edit of every Markdown review reopened
// once.

test("S7: a Markdown source is never asked for a stamp it cannot hold", () => {
  const item = stampedEdit("e-1a2b3c", { page_path: "/scratch.md" });
  assert.equal(replay.pageCheckReasonFor(item, page(AFTER), rebuilt([], false)), null);
});

test("S7: the rendered page's own path does not decide it, the SOURCE does", () => {
  const fromMarkdown = stampedEdit("e-1a2b3c", {
    page_path: "/rendered.html",
    source_hint: { known: true, path: "docs/drafts/scratch.md" }
  });
  const fromTemplate = stampedEdit("e-1a2b3c", {
    page_path: "/dashboard",
    source_hint: { known: true, path: "app/views/home.html.erb" }
  });
  assert.equal(replay.pageCheckReasonFor(fromMarkdown, page(AFTER), rebuilt([], false)), null);
  assert.equal(replay.pageCheckReasonFor(fromTemplate, page(AFTER), rebuilt([], false)), null, "the answer outranks the hint");
  assert.equal(replay.pageCheckReasonFor(fromTemplate, page(AFTER), rebuilt([], true)), replay.PAGE_CHECK_REASON.STAMP);
  assert.equal(replay.pageCheckReasonFor(fromMarkdown, page(AFTER), rebuilt([], true)), replay.PAGE_CHECK_REASON.STAMP);
});

test("S7: no answer from the helper yet means no round", () => {
  const unanswered = rebuilt([]);
  delete unanswered.stampCarriable;
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-1a2b3c"), page(AFTER), unanswered), null);
});

test("which sources can hold a stamp, said once and read by everyone who asks", () => {
  ["page.html", "a/b/page.htm", "index.xhtml", "logo.svg", "App.vue", "Card.jsx", "Card.tsx",
   "home.html.erb", "list.ejs", "page.njk", "row.hbs", "block.liquid", "index.php", "x.mustache",
   "t.twig", "t.jinja", "t.j2", "App.svelte", "page.astro"].forEach((path) => {
    assert.equal(record.sourceCanCarryStamp(path), true, path + " holds markup with attributes");
  });
  ["scratch.md", "NOTES.markdown", "readme.txt", "guide.rst", "doc.adoc", "notes.org", "rows.csv",
   "data.json", "config.yaml", "/dashboard", "", null, undefined].forEach((path) => {
    assert.equal(record.sourceCanCarryStamp(path), false, String(path) + " has nowhere to put one");
  });
  assert.equal(record.sourceCanCarryStamp("/page.html?tab=2"), true);
  assert.equal(record.sourceCanCarryStamp("/page.md#top"), false);
  assert.equal(record.sourceCanCarryStamp("/PAGE.HTML"), true);
});

test("pageCheckOptions reads the document's ids once and carries the helper's answer", () => {
  const stamped = { getAttribute: () => "e-1a2b3c" };
  const blank = { getAttribute: () => "" };
  const body = { innerHTML: "<p>" + AFTER + "</p>", querySelectorAll: () => [stamped, blank] };
  const options = replay.pageCheckOptions(body, { stampCarriable: true });
  assert.deepEqual(options.stamps, { "e-1a2b3c": true }, "an empty attribute is not an id");
  assert.equal(options.stampCarriable, true);
  assert.equal(Object.prototype.hasOwnProperty.call(options, "pageHtml"), false, "the markup is no longer read");
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-1a2b3c"), page(AFTER), options), null);
  assert.equal(replay.pageCheckReasonFor(stampedEdit("e-gone"), page(AFTER), options), replay.PAGE_CHECK_REASON.STAMP);

  assert.equal(replay.pageCheckOptions({ innerHTML: "<p>x</p>" }).stamps, null);
  assert.equal(replay.pageCheckOptions(null).stamps, null);
  assert.equal(Object.prototype.hasOwnProperty.call(replay.pageCheckOptions(body, { stampCarriable: null }), "stampCarriable"), false);
});

// ---------------------------------------------------------------------------
// The tool's sentence is the tool's, not the reviewer's
// ---------------------------------------------------------------------------

test("the reviewer's note is their own words, with the stamp sentence taken back out", () => {
  const asked = record.pageCheckReopenOf(
    handledEdit({ note: "shorten this heading" }),
    record.PAGE_CHECK_STAMP_NOTE,
    "2026-09-15T10:00:00.000Z",
    record.TOOL_ROUND.PAGE_CHECK_STAMP
  );
  assert.match(asked[record.FIELD.NOTE], /data-lahe-id/, "the agent still reads it in review.json");
  assert.equal(record.reviewerNote(asked), "shorten this heading", "and the card shows only theirs");
  assert.equal(record.toolRoundOf(asked), record.TOOL_ROUND.PAGE_CHECK_STAMP);

  const bare = record.pageCheckReopenOf(handledEdit({ note: null }), record.PAGE_CHECK_STAMP_NOTE, "2026-09-15T10:00:00.000Z", record.TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(record.reviewerNote(bare), null);
});

test("a stored card carrying an older check's sentence about the reviewer's words still shows it", () => {
  const stored = handledEdit({ note: "shorten this heading\n\n" + record.LEGACY_PAGE_CHECK_NOTE });
  assert.match(record.reviewerNote(stored), /no longer on the page/);
});

test("a tool round reads as handled to the reviewer and as ready to everyone else", () => {
  const asked = record.pageCheckReopenOf(handledEdit(), record.PAGE_CHECK_STAMP_NOTE, "2026-09-15T10:00:00.000Z", record.TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(asked[record.FIELD.STATE], record.STATE.READY, "the agent has work, and that is true");
  assert.equal(record.displayState(asked), record.STATE.HANDLED, "the reviewer decided this, and still has");

  const answered = answeredHandled(asked, "2026-09-15T10:02:00.000Z");
  const followed = record.followUp(answered, "one more thing");
  assert.equal(record.toolRoundOf(followed), null);
  assert.equal(record.displayState(followed), record.STATE.READY);
  assert.equal(record.isToolRound(record.threadOf(followed).pop()), true, "and the tool's round travels marked");
});
