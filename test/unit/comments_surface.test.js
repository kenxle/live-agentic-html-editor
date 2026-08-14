// 1D's Node-side half: the rules that hold with no browser in the room.
//
// The browser half is test/browser/comments_highlights.spec.js, which is where
// painting, picking, and ranked test 18 live. What is here is what a browser
// would only make slower to check: the record a box mints, the revision rule,
// the deferred note, and the two strings that must not drift.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const gestures = require("../../src/shared/gestures.js");
const commentsModule = require("../../src/layer/comments.js");
const highlightModule = require("../../src/layer/highlight.js");
const storeModule = require("../../src/layer/store.js");

const PAGE = { origin: "http://localhost:3000", path: "/clients", title: "Clients", seq: 1, source_hint: null };

function surface() {
  const store = storeModule.createStore();
  const comments = commentsModule.createComments({ store, reviewId: "rev_1", document: null, page: PAGE });
  return { store, comments };
}

test("the on-card hint is Ken's copy, and it is spelled once", () => {
  assert.equal(commentsModule.HINT_READY, "Cmd-Enter when done with this comment");
  // The gesture table says the same thing, as a sentence. Two wordings of one
  // instruction is how a hint line and a card drift apart.
  assert.equal(gestures.hintFor(gestures.GESTURE.MARK_READY), commentsModule.HINT_READY + ".");
});

test("every highlight name is namespaced, so a page using the API itself cannot collide", () => {
  assert.ok(highlightModule.NAMES.length > 0);
  highlightModule.NAMES.forEach(function (name) {
    assert.equal(name.indexOf(highlightModule.PREFIX), 0, name + " is not namespaced");
  });
  // The page-level stylesheet contains highlight rules and nothing else.
  highlightModule.STYLE_TEXT.split("}")
    .map(function (chunk) {
      return chunk.trim();
    })
    .filter(Boolean)
    .forEach(function (chunk) {
      assert.match(chunk, /^::highlight\(lahe-/);
    });
});

test("a browser with no Custom Highlight API fails loud rather than painting nothing", () => {
  const highlights = highlightModule.createHighlights({ document: null });
  assert.equal(highlights.supported(), false);
  assert.throws(
    function () {
      highlights.paint("itm_1", { cloneRange: function () {} });
    },
    /Custom Highlight API/
  );
});

test("a comment box mints a draft and every keystroke is durable at once", () => {
  const { store, comments } = surface();
  const box = comments.openBox({ quote: "The trainer writes the plan." });

  assert.equal(box.item.state, record.STATE.DRAFT);
  assert.equal(box.item.context.quote, "The trainer writes the plan.");
  assert.equal(box.item.page_origin, PAGE.origin, "the page fields come from the surface's page");

  box.type("this says the opp");
  assert.equal(store.readItem("rev_1", box.id).note, "this says the opp");
  box.type("this says the opposite");
  assert.equal(store.readItem("rev_1", box.id).note, "this says the opposite");
  assert.equal(store.readItem("rev_1", box.id).rev, 1, "a draft does not bump rev");
});

test("Cmd-Enter marks it ready, and one rewording after that bumps the revision once", () => {
  const { store, comments } = surface();
  const box = comments.openBox({ quote: "q" });
  box.type("say this instead");
  box.markReady();
  assert.equal(store.readItem("rev_1", box.id).state, record.STATE.READY);
  assert.equal(store.readItem("rev_1", box.id).rev, 1);

  // A rewording SESSION is one revision. The keystrokes on the way are durable
  // at once and are content, not revisions: rev is what an agent's reply names,
  // and a rev that races the typing refuses every reply as stale (R21).
  const reword = comments.reopen(box.id);
  reword.type("no, say ");
  reword.type("no, say this ");
  reword.type("no, say this instead");
  assert.equal(store.readItem("rev_1", box.id).rev, 1, "typing a reword does not bump rev");
  assert.equal(store.readItem("rev_1", box.id).note, "no, say this instead", "and it is durable at once");

  reword.markReady();
  assert.equal(store.readItem("rev_1", box.id).rev, 2, "the commit bumps it, once");
  assert.equal(store.readItem("rev_1", box.id).note, "no, say this instead");

  // Closing the box after the commit has nothing left to commit.
  reword.close();
  assert.equal(store.readItem("rev_1", box.id).rev, 2);
});

test("a rewording ended with Esc still commits at one revision", () => {
  const { store, comments } = surface();
  const box = comments.openBox({ quote: "q" });
  box.type("say this instead");
  box.markReady();

  const reword = comments.reopen(box.id);
  reword.type("no, say this instead");
  reword.close();
  assert.equal(store.readItem("rev_1", box.id).rev, 2, "closing ends the session, so the revision moves");
  assert.equal(store.readItem("rev_1", box.id).note, "no, say this instead");
});

// Ken: "before we could just edit a comment and the color would go from green to
// yellow and that was how we knew." Editing a ready comment takes it back off
// the agent's desk (draft is the state that is not in review.json, R7) and the
// commit puts it back. The half that is easy to break: the session must still
// know it is rewording a COMMITTED item while that transient draft is on, or the
// revision never moves and a stale reply is accepted.
test("editing a ready comment drops it to draft, and the commit still moves the revision once", () => {
  const { store, comments } = surface();
  const box = comments.openBox({ quote: "q" });
  box.type("say this instead");
  box.markReady();
  box.close();

  const reword = comments.reopen(box.id);
  reword.type("no, say this instead");
  assert.equal(store.readItem("rev_1", box.id).state, record.STATE.DRAFT, "off the agent's desk while it is rewritten");
  assert.equal(store.readItem("rev_1", box.id).rev, 1, "and typing is still not a revision");

  reword.markReady();
  assert.equal(store.readItem("rev_1", box.id).state, record.STATE.READY);
  assert.equal(store.readItem("rev_1", box.id).rev, 2, "the commit moves it, once");

  // Typing the words back exactly puts it straight back: nothing an agent would
  // read has changed, so nothing has been withdrawn.
  reword.type("no, say this");
  assert.equal(store.readItem("rev_1", box.id).state, record.STATE.DRAFT);
  reword.type("no, say this instead");
  assert.equal(store.readItem("rev_1", box.id).state, record.STATE.READY);
  reword.close();
  assert.equal(store.readItem("rev_1", box.id).rev, 2, "and the revision did not move again");
});

test("reopening and typing the same words back is not a rewording", () => {
  const { store, comments } = surface();
  const box = comments.openBox({ quote: "q" });
  box.type("say this instead");
  box.markReady();

  const reword = comments.reopen(box.id);
  reword.type("say this inste");
  reword.type("say this instead");
  reword.close();
  assert.equal(store.readItem("rev_1", box.id).rev, 1, "the words the agent reads did not change");
});

test("the note box standing open at the foot mints nothing until it is typed in", () => {
  const { store, comments } = surface();
  const note = comments.openNote({});
  assert.equal(store.read("rev_1").length, 0, "an untouched note is not a record");

  note.type("the whole page reads cold");
  const items = store.read("rev_1");
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, record.KIND.NOTE);
  assert.equal(items[0].context.quote, null, "a note is tied to nothing");
  assert.equal(items[0].region.ref, null);
});

test("closing keeps the draft; only the reviewer's own delete removes it", () => {
  const { store, comments } = surface();
  const box = comments.openBox({ quote: "q" });
  box.type("half a thought");
  box.close();
  assert.equal(store.readItem("rev_1", box.id).note, "half a thought");

  comments.remove(box.id);
  assert.equal(store.readItem("rev_1", box.id), null);
});

test("outstanding is newest first, and a handled item is not outstanding", () => {
  const { store, comments } = surface();
  const first = comments.openBox({ quote: "one" });
  first.type("a");
  const second = comments.openBox({ quote: "two" });
  second.type("b");

  let out = comments.outstanding();
  assert.equal(out[0].id, second.id, "newest is visible without scrolling");

  const handled = Object.assign({}, store.readItem("rev_1", first.id));
  handled[record.FIELD.STATE] = record.STATE.HANDLED;
  store.write("rev_1", handled);
  out = comments.outstanding();
  assert.equal(out.length, 1);
  assert.equal(out[0].id, second.id);
});
