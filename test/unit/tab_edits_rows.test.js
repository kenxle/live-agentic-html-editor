// 3D: what a row SAYS, as pure functions.
//
// The browser spec (test/browser/edits_tab.spec.js) is the done bar and is where
// the tab is really judged. These are the two decisions inside it that are pure,
// and that a reader of the tab would otherwise have to run a browser to check:
// which kinds this tab holds, and what each kind's row reads as.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const tabEdits = require("../../src/layer/tab_edits.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "3d-rows" });

test("the Edits tab holds hand edits and nothing else", () => {
  assert.equal(tabEdits.isHandEdit(fixtures.edit()), true);
  assert.equal(tabEdits.isHandEdit(fixtures.deletion()), true);
  assert.equal(tabEdits.isHandEdit(fixtures.formatOnly()), true);
  assert.equal(tabEdits.isHandEdit(fixtures.comment()), false);
  assert.equal(tabEdits.isHandEdit(fixtures.note()), false);
});

test("an edit row is a before and an after", () => {
  const item = fixtures.edit();
  const row = tabEdits.rowText(item);
  assert.equal(row.before, item[record.FIELD.BEFORE]);
  assert.equal(row.after, item[record.FIELD.AFTER]);
  assert.notEqual(row.before, row.after);
  assert.equal(row.emptyAfter, false);
});

test("a delete row reads as a deletion, not as an edit into nothing (R27)", () => {
  const item = fixtures.deletion();
  const row = tabEdits.rowText(item);
  assert.equal(row.before, item[record.FIELD.BEFORE]);
  assert.equal(row.after, tabEdits.DELETED_TEXT);
  assert.equal(row.emptyAfter, true);
});

test("a formatting-only row shows the words once and names what changed (R31)", () => {
  const item = fixtures.formatOnly();
  const row = tabEdits.rowText(item);
  // The words did not change, so the row does not show the same sentence twice.
  assert.equal(row.before, row.after);
  assert.match(row.structure, /added <strong>/);
});

test("the structural summary reads the structural view, so a wrapper the comparison ignores is not named", () => {
  // A div wrapper is not a structural tag, so adding one is not a change the
  // format-only comparison can see, and the summary must not claim it is.
  assert.equal(
    tabEdits.structuralSummary("<p>Warm up for ten minutes.</p>", "<div><p>Warm up for ten minutes.</p></div>"),
    "the markup changed"
  );
  assert.equal(
    tabEdits.structuralSummary("<p>Warm up <em>slowly</em>.</p>", "<p>Warm up <strong>slowly</strong>.</p>"),
    "added <strong>, removed <em>"
  );
  assert.equal(
    tabEdits.structuralSummary("<p>One <strong>a</strong> and <strong>b</strong>.</p>", "<p>One a and b.</p>"),
    "removed <strong> x2"
  );
});
