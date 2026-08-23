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
const normalize = require("../../src/shared/normalize.js");
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
  // The page-level stylesheet holds two things and nothing else: the highlight
  // rules, all of them scoped to screen because printing hands the document
  // over rather than the document plus a reviewer's wash on top of it, and the
  // two rules that say what the reset tags mean (see highlight.js).
  var lines = highlightModule.STYLE_TEXT.trim().split("\n");

  // The reset rules are deliberately NOT inside the media block. A wash is an
  // annotation and does not print; text the reviewer took the bold off is the
  // document itself, and it prints the way they left it.
  assert.deepEqual(
    lines.slice(-2).map(function (line) {
      return line.trim();
    }),
    [
      normalize.NOT_BOLD_TAG + " { font-weight: normal; }",
      normalize.NOT_ITALIC_TAG + " { font-style: normal; }"
    ]
  );

  var media = lines.slice(0, -2).join("\n").trim();
  assert.match(media, /^@media not print \{/, "the highlight rules are screen-only");
  assert.equal(media.slice(-1), "}", "the media block is closed");
  var inner = media.slice(media.indexOf("{") + 1, media.lastIndexOf("}"));
  inner
    .split("}")
    .map(function (chunk) {
      return chunk.trim();
    })
    .filter(Boolean)
    .forEach(function (chunk) {
      assert.match(chunk, /^::highlight\(lahe-/);
    });

});

test("the surface hides for print as one rule against its own host", () => {
  var text = highlightModule.PRINT_HOST_STYLE_TEXT.trim();
  assert.match(text, /^@media print \{/);
  assert.match(text, /:host\s*\{\s*display:\s*none\s*!important;?\s*\}/);
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

// ---------------------------------------------------------------------------
// How big the box gets, and where its corner lands
// ---------------------------------------------------------------------------
//
// The browser half (test/browser/comments_highlights.spec.js) drives a real
// textarea and a real pointer. What is here is the arithmetic behind both, which
// a browser would only make slower to check.

const VIEWPORT = { viewportWidth: 1280, viewportHeight: 800 };

function grow(extra) {
  return commentsModule.growthFor(
    Object.assign(
      {
        lineHeight: 20,
        chromeHeight: 60,
        baseWidth: commentsModule.BOX_WIDTH,
        top: 100,
        left: 100
      },
      VIEWPORT,
      extra
    )
  );
}

test("a fresh box is exactly the size it has always been", () => {
  const size = grow({ contentHeight: 40 });
  assert.equal(size.inputHeight, commentsModule.INPUT_MIN_HEIGHT, "the floor is today's size");
  assert.equal(size.width, commentsModule.BOX_WIDTH, "one line stays one width");
  assert.equal(size.capped, false);
});

test("the box follows the words: taller with the content, wider once it wraps", () => {
  const short = grow({ contentHeight: 40 });
  const longer = grow({ contentHeight: 140 });
  assert.ok(longer.inputHeight > short.inputHeight, "height follows content");
  assert.equal(longer.inputHeight, 140);
  assert.ok(longer.width > short.width, "width follows the line count");

  // ...and back down again when the words are deleted.
  const shrunk = grow({ contentHeight: 40 });
  assert.deepEqual(
    { w: shrunk.width, h: shrunk.inputHeight },
    { w: short.width, h: short.inputHeight },
    "deleting text puts the box back"
  );
});

test("both caps hold: 40% of the viewport tall, 1.5x the starting width", () => {
  const huge = grow({ contentHeight: 4000 });
  assert.equal(huge.boxHeight, Math.round(VIEWPORT.viewportHeight * commentsModule.BOX_MAX_VIEWPORT_SHARE));
  assert.equal(huge.capped, true, "past the cap the textarea scrolls instead");
  const cap = Math.min(Math.round(commentsModule.BOX_WIDTH * 1.5), commentsModule.BOX_WIDTH_CAP);
  assert.equal(huge.width, cap);
  assert.equal(cap, 432);

  // Holding a step open cannot push the box past either cap: a box held at a
  // step wider than the cap allows is still exactly the cap.
  const heldPastCap = grow({ contentHeight: 4000, heldLines: 40, heldHeight: 4000, allowShrink: false });
  assert.equal(heldPastCap.width, cap);
  assert.equal(heldPastCap.boxHeight, Math.round(VIEWPORT.viewportHeight * commentsModule.BOX_MAX_VIEWPORT_SHARE));
});

// The bug this pins: the box used to measure its text inside itself, so its own
// width fed back into the size it chose. On a wrap boundary a keystroke wrapped
// the text, the box widened, the wider box unwrapped it, and the box narrowed:
// visible jitter on every keystroke. The measure is now taken at the starting
// width, and these three tests are the properties that keep it honest.
test("the same words give the same size, whatever size the box already is", () => {
  const held = [1, 2, 3, 5, 9];
  const sizes = held.map(function (lines) {
    return grow({ contentHeight: 146, heldLines: lines, allowShrink: true });
  });
  sizes.forEach(function (size) {
    assert.deepEqual(
      { w: size.width, h: size.inputHeight },
      { w: sizes[0].width, h: sizes[0].inputHeight },
      "the size is a function of the content, not of the box"
    );
  });
});

test("a value on the threshold cannot flip the box between two sizes", () => {
  // 146px of content is one line past the 126px that wins the fourth step
  // (66 + 3 * 20), so it grows.
  const grown = grow({ contentHeight: 146 });
  const step = grown.lines;
  assert.ok(step > 1, "past the threshold, the box grows");

  // The same content, with the box already standing on that step, does not
  // hand the step back: it is inside the band.
  const again = grow({ contentHeight: 146, heldLines: step, allowShrink: true });
  assert.equal(again.width, grown.width, "no oscillation on a boundary value");
  const nudged = grow({ contentHeight: 140, heldLines: step, allowShrink: true });
  assert.equal(nudged.width, grown.width, "nor a hair under it");

  // Clearly below the band, it does shrink.
  const clear = grow({
    contentHeight: 146 - commentsModule.SHRINK_BAND - 20,
    heldLines: step,
    allowShrink: true
  });
  assert.ok(clear.width < grown.width, "a clearly shorter text does put the step back");
});

test("typing forward never makes the box smaller, deleting does", () => {
  const wide = grow({ contentHeight: 300 });
  // Nothing shrinks mid-sentence, however the wrap count moves.
  const typing = grow({ contentHeight: 80, heldLines: wide.lines, heldHeight: wide.inputHeight, allowShrink: false });
  assert.equal(typing.width, wide.width, "the width is held while typing forward");
  assert.equal(typing.inputHeight, wide.inputHeight, "and so is the height");

  // Deleting text (or leaving the box) is what lets it back down.
  const deleted = grow({ contentHeight: 80, heldLines: wide.lines, heldHeight: wide.inputHeight, allowShrink: true });
  assert.ok(deleted.width < wide.width);
  assert.equal(deleted.inputHeight, 80);
});

test("growth never leaves the viewport: it grows the other way instead", () => {
  // A box anchored near the foot of the page grows upward, by exactly as much
  // as it has to, rather than off the bottom edge.
  const low = grow({ contentHeight: 300, top: 700 });
  assert.ok(low.top < 700, "the corner moves only because the bottom edge is there");
  assert.equal(low.top + low.boxHeight, VIEWPORT.viewportHeight - commentsModule.BOX_EDGE);

  const right = grow({ contentHeight: 300, left: 1250 });
  assert.equal(right.left + right.width, VIEWPORT.viewportWidth - commentsModule.BOX_EDGE);

  // A box with room grows down and right from where it is, and does not move.
  const roomy = grow({ contentHeight: 300, top: 100, left: 100 });
  assert.deepEqual({ top: roomy.top, left: roomy.left }, { top: 100, left: 100 });
});

test("a dragged box is kept whole on screen", () => {
  const box = { width: 300, height: 200, viewportWidth: 1280, viewportHeight: 800 };
  const inside = commentsModule.dragTo(Object.assign({ left: 400, top: 300 }, box));
  assert.deepEqual(inside, { left: 400, top: 300 }, "a drag with room lands where it was put");

  const offTop = commentsModule.dragTo(Object.assign({ left: -80, top: -80 }, box));
  assert.deepEqual(offTop, { left: commentsModule.BOX_EDGE, top: commentsModule.BOX_EDGE });

  const offEnd = commentsModule.dragTo(Object.assign({ left: 5000, top: 5000 }, box));
  assert.equal(offEnd.left + box.width, 1280 - commentsModule.BOX_EDGE);
  assert.equal(offEnd.top + box.height, 800 - commentsModule.BOX_EDGE);
});

// ---------------------------------------------------------------------------
// What a repaint is allowed to cover
// ---------------------------------------------------------------------------
//
// Ken, 2026-08-23: "sometimes the page will refresh and everything is
// highlighted. it usually goes away after a bit."
//
// The browser half is test/browser/late_render_highlights.spec.js, which loads a
// page that draws itself after load and watches the paint THROUGHOUT the load.
// What is here is the rule's own arithmetic, at its boundary.

test("the paint rule collapses both sides of every comparison the same way", () => {
  // One rule, or a quote stops matching the page it was taken from.
  assert.equal(commentsModule.collapseForMatch("  the third   week \n was  "), "the third week was");
  assert.equal(commentsModule.collapseForMatch("the third\tweek"), "the third week");
  // Zero-width characters carry no position for a reader and are dropped.
  assert.equal(commentsModule.collapseForMatch("the​third week"), "thethird week");
  assert.equal(commentsModule.collapseForMatch(null), "");
});

test("the reviewer's words are located only when exactly one place holds them", () => {
  const page = "one two three two one";
  assert.equal(commentsModule.soleIndexOf(page, "three"), 8);
  // Twice is not a near miss: it is a question nobody can answer, and it fails
  // closed exactly the way uniqueness.selectUnique fails on a tie.
  assert.equal(commentsModule.soleIndexOf(page, "two"), -1);
  assert.equal(commentsModule.soleIndexOf(page, "four"), -1);
  assert.equal(commentsModule.soleIndexOf("", "two"), -1);
  assert.equal(commentsModule.soleIndexOf(page, ""), -1);
});

test("a whole-element paint stops at twice the region it was minted from", () => {
  const ratio = commentsModule.PAINT_MAX_TEXT_RATIO;
  assert.equal(ratio, 2, "the number is a decision, not a knob: see comments.js");

  const probe = "abcd";
  // An untouched region matches exactly. Ratio 1, always painted.
  assert.equal(commentsModule.paintableSize(probe, probe), true);
  // The agent grew the paragraph. Still the region, still painted: this is the
  // R16 tolerance the paint rule must not take away.
  assert.equal(commentsModule.paintableSize(probe, "abcd efg"), true);
  // Exactly twice is the boundary, and the boundary is included.
  assert.equal(commentsModule.paintableSize(probe, "abcdefgh"), true);
  // One character past it is refused. Nothing is painted and the settle-window
  // repaint asks again.
  assert.equal(commentsModule.paintableSize(probe, "abcdefghi"), false);

  // The failure this exists for: an unrendered container holding the whole
  // document, which is not twice a passage but many times it.
  const passage = "The third week is where a comeback stops being about willpower.";
  const document = ["Coming back from a layoff", passage, "Everything else on this page holds still."].join(" ");
  assert.equal(commentsModule.paintableSize(passage, document), false);

  // Whitespace is not size. The same words laid out over several lines are the
  // same region, and measuring them raw would refuse a paint that is correct.
  assert.equal(commentsModule.paintableSize(probe, "\n    abcd\n  "), true);

  // Nothing to measure is not a licence to paint.
  assert.equal(commentsModule.paintableSize("", "abcd"), false);
  assert.equal(commentsModule.paintableSize(probe, ""), false);
});

test("a character of the collapsed text can be pointed back at where it came from", () => {
  // This is what lets the paint be narrowed to the reviewer's own words without
  // holding a position for every character of the page: only the two characters
  // at the ends of the match are ever mapped back.
  const raw = "\n   The third\n   week  \n";
  const text = commentsModule.collapseForMatch(raw);
  assert.equal(text, "The third week");

  const at = text.indexOf("week");
  assert.equal(raw.charAt(commentsModule.rawIndexOfCollapsed(raw, at)), "w");
  assert.equal(raw.charAt(commentsModule.rawIndexOfCollapsed(raw, at + 3)), "k");
  // The first character survives the leading whitespace being dropped.
  assert.equal(raw.charAt(commentsModule.rawIndexOfCollapsed(raw, 0)), "T");
  // A space in the collapsed text points at the first character of the run it
  // stands for, which is inside the document and therefore paintable.
  assert.equal(/\s/.test(raw.charAt(commentsModule.rawIndexOfCollapsed(raw, 9))), true);
  // Past the end is not a place.
  assert.equal(commentsModule.rawIndexOfCollapsed(raw, text.length + 5), -1);
  assert.equal(commentsModule.rawIndexOfCollapsed(raw, -1), -1);
});
