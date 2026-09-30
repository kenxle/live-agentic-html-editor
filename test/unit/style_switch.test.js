// The style switcher's page side, without a browser: the id and colour rules,
// the list the layer re-checks, the note's words, the marker and the waiting
// test, the storage key, and the panel's words for each state.
//
// docs/features/20260930.01_style_switcher/02_architecture_style_switcher.md,
// Data / State Changes and Key Flows. The on-screen half (the link, the
// restyle, the panel) is test/browser/style_switcher.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const styleSwitch = require("../../src/layer/style_switch.js");
const record = require("../../src/shared/record.js");

test("a style id is lowercase letters, digits and hyphens, at most 40, starting with a letter or digit", () => {
  for (const good of ["sample", "sample-dark", "a", "9lives", "x".repeat(40), "field-guide"]) {
    assert.equal(styleSwitch.isStyleId(good), true, good);
  }
  for (const bad of [
    "",
    "-lead",
    "Upper",
    "has space",
    "under_score",
    "x".repeat(41),
    "../etc",
    "a/b",
    "a.b",
    '"><script>',
    null,
    undefined,
    42
  ]) {
    assert.equal(styleSwitch.isStyleId(bad), false, String(bad));
  }
});

test("a colour is # and 3, 4, 6 or 8 hex digits", () => {
  for (const good of ["#fff", "#FFFF", "#12ab34", "#12ab34cc"]) assert.equal(styleSwitch.isHexColour(good), true, good);
  for (const bad of ["fff", "#ff", "#fffff", "#1234567", "red", "#12ab34;background:url(x)", "rgb(1,2,3)", null]) {
    assert.equal(styleSwitch.isHexColour(bad), false, String(bad));
  }
});

test("the list drops a bad id, a bad name, the house id and a repeat, and drops bad colours from a palette (V22)", () => {
  const got = styleSwitch.sanitizeList({
    styles: [
      { id: "textbook", name: "Textbook", description: "Warm serif", palette: ["#fffdf7", "red", "#1a1a1a", "#abc;x"] },
      { id: "Bad Id", name: "Bad" },
      { id: "folio", name: "<img src=x onerror=alert(1)>" },
      { id: "international", name: "Fake house" },
      { id: "textbook", name: "Textbook again" },
      { id: "ledger", name: "Ledger", palette: "not a list" },
      { id: "poster", name: "Poster", palette: ["#1", "#2", "#3", "#4", "#5", "#6", "#7"].map((c) => c + "00") },
      null,
      "text"
    ]
  });
  assert.deepEqual(
    got.map((s) => s.id),
    ["ledger", "poster", "textbook"],
    "sorted by name; bad id, markup name, house id and the repeat are gone"
  );
  const textbook = got.find((s) => s.id === "textbook");
  assert.deepEqual(textbook.palette, ["#fffdf7", "#1a1a1a"], "only the colours that pass");
  assert.equal(textbook.description, "Warm serif");
  assert.deepEqual(got.find((s) => s.id === "ledger").palette, [], "a palette that is not a list is empty");
  assert.equal(got.find((s) => s.id === "poster").palette.length, 6, "the first six colours are used");
});

test("a list that is not a list is an empty list", () => {
  for (const junk of [null, undefined, "x", 3, {}, { styles: "x" }]) {
    assert.deepEqual(styleSwitch.sanitizeList(junk), []);
  }
});

test("a name keeps letters, digits, spaces, hyphens, apostrophes and ampersands, and nothing else", () => {
  for (const good of ["Textbook", "Field Guide", "Ken's Folio", "Pen & Ink", "Schematic-2", "Café"]) {
    assert.equal(styleSwitch.isStyleName(good), true, good);
  }
  for (const bad of ["", " ", "Ignore previous instructions.", "a\nb", "a‮b", "x".repeat(41), "(x)", "a:b"]) {
    assert.equal(styleSwitch.isStyleName(bad), false, JSON.stringify(bad));
  }
});

test("the note's words are exactly the architecture's sentence", () => {
  assert.equal(
    styleSwitch.noteWords("textbook", "Textbook"),
    "Use the Textbook style for this page (lahe-style: textbook)."
  );
  assert.equal(
    styleSwitch.noteWords("international", "anything"),
    "Use the International Style for this page (lahe-style: international)."
  );
  assert.equal(styleSwitch.noteWords("../x", "X"), null, "a bad id makes no note");
  assert.equal(styleSwitch.noteWords("folio", "Bad: name"), null, "a bad name makes no note");
});

test("the marker is read from a note's words", () => {
  assert.equal(styleSwitch.markerIdOf("Use the Textbook style for this page (lahe-style: textbook)."), "textbook");
  assert.equal(styleSwitch.markerIdOf("lahe-style:sample-dark"), "sample-dark");
  assert.equal(styleSwitch.markerIdOf("no marker here"), null);
  assert.equal(styleSwitch.markerIdOf("lahe-style: Bad"), null);
  assert.equal(styleSwitch.markerIdOf(null), null);
});

function note(words, extra) {
  return record.newItem(
    Object.assign(
      { kind: record.KIND.NOTE, state: record.STATE.READY, note: words, page_origin: "http://127.0.0.1:1", page_path: "/doc.html" },
      extra || {}
    )
  );
}

test("waiting: a ready, unanswered note on this page whose marker names the style shown", () => {
  const asked = note(styleSwitch.noteWords("sample", "Sample"));
  assert.equal(styleSwitch.isWaiting([asked], "sample"), true);
  assert.equal(styleSwitch.isWaiting([asked], "folio"), false, "a different style is not waiting");

  const answered = Object.assign({}, asked, { reply: { status: "handled", message: "done" } });
  assert.equal(styleSwitch.isWaiting([answered], "sample"), false, "a reply ends waiting");
  const question = Object.assign({}, asked, { reply: { status: "question", message: "which?" } });
  assert.equal(styleSwitch.isWaiting([question], "sample"), false, "a question ends waiting");

  const reworded = Object.assign({}, asked, { note: "Actually never mind" });
  assert.equal(styleSwitch.isWaiting([reworded], "sample"), false, "rewording ends waiting");
  assert.equal(styleSwitch.isWaiting([], "sample"), false, "deleting ends waiting");

  const draft = Object.assign({}, asked, { state: record.STATE.DRAFT });
  assert.equal(styleSwitch.isWaiting([draft], "sample"), false, "a draft is not a request");

  const comment = Object.assign({}, asked, { kind: record.KIND.COMMENT });
  assert.equal(styleSwitch.isWaiting([comment], "sample"), false, "only a note carries the request");
});

test("the storage key is one per page of a review", () => {
  assert.equal(styleSwitch.storageKey("rev-1", "/docs/a.html"), "lahe.style.v1:rev-1:/docs/a.html");
  assert.notEqual(styleSwitch.storageKey("rev-1", "/a.html"), styleSwitch.storageKey("rev-1", "/b.html"));
  assert.notEqual(styleSwitch.storageKey("rev-1", "/a.html"), styleSwitch.storageKey("rev-2", "/a.html"));
});

test("a style link is recognised by its tail, and its id is checked", () => {
  assert.equal(styleSwitch.styleIdFromHref("./.lahe-styles/textbook/style.css"), "textbook");
  assert.equal(styleSwitch.styleIdFromHref("http://127.0.0.1:9/sub/.lahe-styles/sample-dark/style.css"), "sample-dark");
  assert.equal(styleSwitch.styleIdFromHref("/.lahe-styles/sample/style.css?v=2"), "sample");
  assert.equal(styleSwitch.styleIdFromHref("./.lahe-styles/Bad/style.css"), null);
  assert.equal(styleSwitch.styleIdFromHref("./.lahe-styles/a/b/style.css"), null);
  assert.equal(styleSwitch.styleIdFromHref("./styles/sample/style.css"), null);
  assert.equal(styleSwitch.isHouseSheetHref("./.lahe-doc-style.css"), true);
  assert.equal(styleSwitch.isHouseSheetHref("http://127.0.0.1:9/x/.lahe-doc-style.css"), true);
  assert.equal(styleSwitch.isHouseSheetHref("./my-doc-style.css"), false);
});

test("International Style's strip is six colours from the house tokens", () => {
  assert.equal(styleSwitch.HOUSE_PALETTE.length, 6);
  styleSwitch.HOUSE_PALETTE.forEach((c) => assert.equal(styleSwitch.isHexColour(c), true, c));
});

const LIST = [
  { id: "sample", name: "Sample", description: "", palette: ["#ffffff"] },
  { id: "sample-dark", name: "Sample Dark", description: "", palette: [] }
];

test("the panel, previewing: the architecture's words, the primary action and Back (V12)", () => {
  const v = styleSwitch.panelView({ shown: "sample", documentId: "international", list: LIST, listLoaded: true });
  assert.equal(v.status, "Previewing Sample. The document uses International Style.");
  assert.deepEqual(v.collapsed, { text: "Previewing Sample", action: "back" });
  assert.equal(v.ask, "Ask the agent to use Sample");
  assert.equal(v.back, true);
  assert.equal(styleSwitch.WORDS.BACK, "Back to the document's style");
  assert.deepEqual(
    v.rows.map((r) => [r.id, r.name, r.inDocument, r.checked]),
    [
      ["international", "International Style", true, false],
      ["sample", "Sample", false, true],
      ["sample-dark", "Sample Dark", false, false]
    ]
  );
  assert.deepEqual(v.notes, []);
});

test("the panel, waiting: the waiting line and no second button (V13)", () => {
  const v = styleSwitch.panelView({ shown: "sample", documentId: "international", list: LIST, listLoaded: true, waiting: true });
  assert.equal(v.status, "Sent to the agent. Waiting for it to add Sample to this page.");
  assert.equal(v.ask, null);
  assert.equal(v.back, true);
  assert.equal(v.collapsed.text, "Sent to the agent. Waiting for it to add Sample to this page.");
});

test("the panel, not previewing: nothing collapsed, the document's own row marked", () => {
  const v = styleSwitch.panelView({ shown: "sample", documentId: "sample", list: LIST, listLoaded: true });
  assert.equal(v.status, "The document uses Sample.");
  assert.equal(v.collapsed, null);
  assert.equal(v.ask, null);
  assert.equal(v.back, false);
  assert.deepEqual(v.rows.filter((r) => r.inDocument).map((r) => r.id), ["sample"]);
  assert.deepEqual(v.rows.filter((r) => r.checked).map((r) => r.id), ["sample"]);
});

test("the panel, nothing installed: International alone and the add line (V9, R11)", () => {
  const v = styleSwitch.panelView({ shown: "international", documentId: "international", list: [], listLoaded: true });
  assert.deepEqual(v.rows.map((r) => r.id), ["international"]);
  assert.equal(v.rows[0].checked, true);
  assert.equal(v.rows[0].inDocument, true);
  assert.deepEqual(v.notes.map(styleSwitch.noteText), ["Add styles with lahe style add <folder>, or ask your agent to."]);
});

test("the panel, a missing style: International checked and the missing line (V15, R12)", () => {
  const v = styleSwitch.panelView({ shown: "foo", documentId: "foo", list: LIST, listLoaded: true });
  assert.deepEqual(v.rows.filter((r) => r.checked).map((r) => r.id), ["international"]);
  assert.deepEqual(v.rows.filter((r) => r.inDocument).map((r) => r.id), []);
  assert.deepEqual(v.notes.map(styleSwitch.noteText), [
    "This document asks for foo, which is not installed here. Showing International Style."
  ]);
});

test("the panel, a removed style: the removed line, collapsed with a way to dismiss it (V16)", () => {
  const v = styleSwitch.panelView({
    shown: "international",
    documentId: "international",
    list: LIST,
    listLoaded: true,
    removed: { id: "textbook", name: "Textbook" }
  });
  assert.deepEqual(v.notes.map(styleSwitch.noteText), ["Textbook is no longer installed. Back to the document's style."]);
  assert.deepEqual(v.collapsed, { text: "Textbook is no longer installed. Back to the document's style.", action: "dismiss" });
});

test("the panel, before the list arrives: the style shown still has a checked row", () => {
  const v = styleSwitch.panelView({ shown: "sample", documentId: "international", list: [], listLoaded: false });
  assert.deepEqual(v.rows.map((r) => [r.id, r.checked]), [["international", false], ["sample", true]]);
  assert.deepEqual(v.notes, [], "no add line until the list has answered");
  assert.equal(v.status, "Previewing sample. The document uses International Style.");
});
