// The handled check on run records and bold or italic edits (free-writing
// plan Task 2.9, architecture "The handled check", AQ3).
//
// Every page here is a real render of a Markdown source by markdown.js, so a
// section label ("Section 1") sits between a run's heading and its paragraph,
// the way the reviewer's page has it. verdictFor answers true (shown), false
// (held open), or null (not judged, which a caller treats as shown).
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const handled = require("../../src/service/handled_check.js");
const markdown = require("../../src/service/markdown.js");
const record = require("../../src/shared/record.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const fx = () => createFixtures({ seed: "handledrun" });
const WRITTEN = false;
const NOTHING_WRITTEN = true;

let n = 0;
function page(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-hcrun-"));
  n += 1;
  const file = path.join(dir, "post" + n + ".md");
  fs.writeFileSync(file, source);
  return markdown.render(file);
}

const WORKED_SOURCE = [
  "# Post",
  "",
  "What changed",
  "",
  "## What the chat window cost me zqxcanary",
  "",
  "I lost my place **every** time zqxcanary",
  "",
  "- scrolling",
  "- re-asking zqxcanary",
  ""
].join("\n");

function worked() {
  return fx().runFixtures().find((f) => f.name === "worked example").item;
}

test("a correct run with an h2 passes, with a section label between blocks", () => {
  const html = page(WORKED_SOURCE);
  assert.ok(html.indexOf("Section 1") !== -1, "the render has the section label");
  assert.equal(handled.checkable(worked()), true);
  assert.equal(handled.verdictFor([html], worked(), WRITTEN), true);
  assert.equal(handled.verdictFor([html], worked(), NOTHING_WRITTEN), true);
});

test("a run whose second block is missing is held open, written or not", () => {
  const html = page(WORKED_SOURCE.replace("I lost my place **every** time zqxcanary\n\n", ""));
  assert.equal(handled.verdictFor([html], worked(), WRITTEN), false);
  assert.equal(handled.verdictFor([html], worked(), NOTHING_WRITTEN), false);
});

test("two runs answered handled, one placed: the skipped one is held open", () => {
  const f = fx();
  const placed = f.runItem({ new_blocks: [{ tag: "p", html: "The first new paragraph zqxcanary" }] });
  const skipped = f.runItem({
    before: "Another anchor",
    before_html: "Another anchor",
    anchor_after_html: "Another anchor",
    new_blocks: [{ tag: "p", html: "The second new paragraph zqxcanary" }]
  });
  const html = page("What changed\n\nThe first new paragraph zqxcanary\n\nAnother anchor\n");
  assert.equal(handled.verdictFor([html], placed, WRITTEN), true);
  assert.equal(handled.verdictFor([html], skipped, WRITTEN), false, "judged although the source was written");
});

test("a run whose words became raw HTML in the source is held open, though the source was written", () => {
  const item = fx().runFixtures().find((f) => f.name.indexOf("special") !== -1 || /&lt;b&gt;/.test(JSON.stringify(f.item.new_blocks))).item;
  const raw = "What changed\n\nUse <b> & *stars* _under_ `code` # not a heading 1. not a list \"straight\" 'quotes' -- dashes zqxcanary\n";
  assert.equal(handled.verdictFor([page(raw)], item, WRITTEN), false);
});

test("a run holding 'a < b & c', correctly escaped, passes", () => {
  const item = fx().runItem({ new_blocks: [{ tag: "p", html: "Is a &lt; b &amp; c true zqxcanary" }] });
  const html = page("What changed\n\nIs a &lt; b &amp; c true zqxcanary\n");
  assert.equal(handled.verdictFor([html], item, WRITTEN), true);
});

test("straight quotes rendered curly, and -- rendered as a dash, pass", () => {
  const item = fx().runItem({ new_blocks: [{ tag: "p", html: "She said \"yes\" and 'no' -- then left zqxcanary" }] });
  const html = page("What changed\n\nShe said “yes” and ‘no’ — then left zqxcanary\n");
  assert.equal(handled.verdictFor([html], item, WRITTEN), true);
});

function rewordedAnchorRun() {
  return fx().runItem({
    before: "The old anchor sentence has six words",
    before_html: "The old anchor sentence has six words",
    anchor_after_html: "The new anchor sentence has six words",
    new_blocks: [{ tag: "p", html: "Then a fresh paragraph zqxcanary" }]
  });
}

test("a reworded anchor: changed on the page with the run placed, it passes", () => {
  const html = page("The new anchor sentence has six words\n\nThen a fresh paragraph zqxcanary\n");
  assert.equal(handled.verdictFor([html], rewordedAnchorRun(), WRITTEN), true);
});

test("a reworded anchor: the old words left on the page, it is held open", () => {
  const html = page("The old anchor sentence has six words\n\nThen a fresh paragraph zqxcanary\n");
  assert.equal(handled.verdictFor([html], rewordedAnchorRun(), WRITTEN), false);
});

test("a start_of_container run skips the anchor and passes", () => {
  const item = fx().runFixtures().find((f) => f.item.placement === "start_of_container").item;
  const lines = item.new_blocks.map((b) => (b.tag === "h2" ? "## " : "") + b.html.replace(/<[^>]+>/g, ""));
  const html = page(lines.join("\n\n") + "\n");
  assert.equal(handled.verdictFor([html], item, WRITTEN), true);
  assert.equal(handled.verdictFor([html], item, NOTHING_WRITTEN), true);
});

test("a format_only bold edit where the agent wrote nothing is held open (the R14 bold-two-words case)", () => {
  const item = fx().formatOnly({
    before: "Make these two words stand out.",
    after: "Make these two words stand out.",
    before_html: "Make these two words stand out.",
    after_html: "Make these <strong>two words</strong> stand out."
  });
  assert.equal(handled.checkable(item), true);
  const html = page("Make these two words stand out.\n");
  assert.equal(handled.verdictFor([html], item, NOTHING_WRITTEN), false);
});

test("the same bold edit with the bold in the source passes", () => {
  const item = fx().formatOnly({
    before: "Make these two words stand out.",
    after: "Make these two words stand out.",
    before_html: "Make these two words stand out.",
    after_html: "Make these <strong>two words</strong> stand out."
  });
  const html = page("Make these **two words** stand out.\n");
  assert.equal(handled.verdictFor([html], item, NOTHING_WRITTEN), true);
  assert.notEqual(handled.verdictFor([html], item, WRITTEN), false);
});

test("a comment and a delete are still not checked", () => {
  const f = fx();
  assert.equal(handled.checkable(f.comment()), false);
  assert.equal(handled.checkable(f.deletion()), false);
});
