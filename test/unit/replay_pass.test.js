// Replay's four branches at the PASS level, over a simulated DOM.
//
// Owner: 2C. The browser half of the same bar is test/browser/replay_branches.spec.js
// and test/browser/replay_human_and_agent.spec.js, which run against Chromium on
// a page that actively reverts what the tool writes. This file exists because
// the branch decisions and the counter arithmetic are worth checking in
// milliseconds while building, and because the plan's ranked test 13 names the
// counters, not the pixels.
//
// Why a fake DOM and not jsdom: jsdom is banned repo-wide (scripts/lint.js
// enforces it) and it is not needed. Replay asks a node the same five questions
// the anchor engine asks (tag, text, attribute, element children, parent) plus
// three writes (textContent, innerHTML, remove). Those eight are written out in
// el() below, which is the whole simulated DOM. It is the same shape
// test/unit/anchor_engine.test.js uses, extended with the writes.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const replay = require("../../src/layer/replay.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "2c-pass" });

// ---------------------------------------------------------------------------
// The simulated DOM
// ---------------------------------------------------------------------------

function el(tag, opts) {
  const options = opts || {};
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: options.attrs || {},
    children: [],
    parentElement: null,
    ownText: typeof options.text === "string" ? options.text : "",
    ownHtml: typeof options.html === "string" ? options.html : null,
    // A node given markup reports the text inside it, the way a real one does.
    ownTextFromHtml: typeof options.html === "string" ? options.html.replace(/<[^>]*>/g, "") : null,
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    contains: function (other) {
      if (other === this) return true;
      return this.children.some(function (child) {
        return child.contains(other);
      });
    },
    remove: function () {
      const parent = this.parentElement;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1);
      this.parentElement = null;
    }
  };
  Object.defineProperty(node, "textContent", {
    get: function () {
      if (!this.children.length) {
        return typeof this.ownTextFromHtml === "string" ? this.ownTextFromHtml : this.ownText;
      }
      return this.children
        .map(function (c) {
          return c.textContent;
        })
        .join("");
    },
    set: function (value) {
      this.children.length = 0;
      this.ownText = String(value);
      this.ownHtml = null;
      this.ownTextFromHtml = null;
    }
  });
  Object.defineProperty(node, "innerHTML", {
    get: function () {
      return typeof this.ownHtml === "string" ? this.ownHtml : this.textContent;
    },
    set: function (value) {
      this.children.length = 0;
      this.ownHtml = String(value);
      // Text seen through the markup, the way a real element would report it.
      this.ownTextFromHtml = String(value).replace(/<[^>]*>/g, "");
      this.ownText = this.ownTextFromHtml;
    }
  });
  (options.children || []).forEach(function (child) {
    child.parentElement = node;
    node.children.push(child);
  });
  return node;
}

/** A body of one <p> per block. Returns {root, blocks}. */
function pageOf(blocks) {
  const nodes = blocks.map(function (block) {
    return typeof block === "string" ? el("p", { text: block }) : el("p", block);
  });
  return { root: el("body", { children: nodes }), blocks: nodes };
}

/**
 * A record pointed at one of those blocks, with a reference the real anchor
 * engine minted from the real node. Nothing here hand-writes a reference: a
 * hand-written one would let replay pass against a shape 1C never emits.
 */
const anchor = require("../../src/layer/anchor.js");

function anchored(item, node, root) {
  const ref = anchor.mint({ element: node, root: root });
  assert.equal(ref.ok, true, "the fixture's own anchor must mint: " + JSON.stringify(ref.failure));
  const next = Object.assign({}, item);
  next[record.FIELD.REGION] = { ref: ref, label: "Fixture region", lost: null };
  return next;
}

/** A card surface that records what replay told the reviewer. */
function fakeCards() {
  const notices = {};
  const badges = {};
  const attached = {};
  return {
    notices: notices,
    badges: badges,
    attached: attached,
    setCardNotice: function (id, text) {
      notices[id] = text;
    },
    setCardBadge: function (id, failure) {
      badges[id] = (badges[id] || []).filter(function (b) {
        return b.code !== failure.code;
      });
      badges[id].push(failure);
    },
    clearCardBadge: function (id, code) {
      badges[id] = (badges[id] || []).filter(function (b) {
        return b.code !== code;
      });
    },
    cardBadges: function (id) {
      return (badges[id] || []).slice();
    },
    attachCardNode: function (id, node) {
      attached[id] = node;
      return { id: id };
    },
    cardBody: function () {
      return null;
    }
  };
}

function runOne(item, root, extra) {
  replay.resetCounters();
  const cards = fakeCards();
  const context = Object.assign({ root: root, items: [item], cards: cards }, extra || {});
  const summary = replay.runPass(replay.REASON.MUTATION, context);
  return { summary: summary, cards: cards, result: summary.results[0] };
}

// ---------------------------------------------------------------------------
// Ranked test 13: each of the four branches, with its counters
// ---------------------------------------------------------------------------

test("branch three: an earlier revision landed, so the current one is re-applied and the card says so", () => {
  // TWO rewordings, so the earlier `after` is neither the current `after` nor
  // the `before`. A single rewording lets a broken implementation pass by
  // accident: its prior `after` happens to equal its `before`, which branch two
  // already handles.
  const item = fixtures.editRewordedTwice();
  const earlier = record.priorAfters(item, record.FIELD.AFTER)[0];
  assert.notEqual(earlier, item.after);
  assert.notEqual(earlier, item.before);

  const page = pageOf(["A paragraph before it.", earlier, "A paragraph after it."]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);

  const ran = runOne(anchoredItem, page.root);

  assert.equal(ran.result.branch, replay.BRANCH.EARLIER_REVISION);
  assert.equal(page.blocks[1].textContent, item.after, "the current revision is what lands");
  assert.equal(replay.counters.regionsWritten, 1, "written exactly once");
  assert.equal(replay.counters.regionsEarlierRevision, 1);
  assert.equal(replay.counters.regionsConflicted, 0, "an earlier revision is not a collision");
  assert.equal(replay.counters.passes, 1);
  assert.equal(
    ran.cards.notices[item.id],
    replay.EARLIER_REVISION_MESSAGE,
    "the reviewer is told an earlier version had landed"
  );
});

test("branch one: the DOM already matches the current after, so nothing is written", () => {
  const item = fixtures.edit();
  const page = pageOf(["Before it.", item.after, "After it."]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);

  // Five passes, and the region is never touched.
  replay.resetCounters();
  const cards = fakeCards();
  const context = { root: page.root, items: [anchoredItem], cards: cards };
  for (let i = 0; i < 5; i += 1) replay.runPass(replay.REASON.MUTATION, context);

  assert.equal(replay.counters.passes, 5);
  assert.equal(replay.counters.regionsWritten, 0, "idempotent: no second write");
  assert.equal(replay.counters.regionsSkippedEqual, 5);
});

test("branch two: the DOM matches before, so the edit is applied again", () => {
  const item = fixtures.edit();
  const page = pageOf(["Before it.", item.before, "After it."]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);

  const ran = runOne(anchoredItem, page.root);

  assert.equal(ran.result.branch, replay.BRANCH.REAPPLY);
  assert.equal(page.blocks[1].textContent, item.after);
  assert.equal(replay.counters.regionsWritten, 1);
});

test("branch four: neither version matches, so nothing is written and the card shows BOTH in full", () => {
  const item = fixtures.edit();
  // The agent rewrote the source under the region: the paragraph is still
  // recognizably this region (the anchor binds), and it is neither what the
  // reviewer edited nor what they changed it to.
  const theirs = item.before + " It is reviewed on Sunday by both of them.";
  const page = pageOf(["Before it.", item.before, "After it."]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);
  page.blocks[1].textContent = theirs;

  const ran = runOne(anchoredItem, page.root);

  assert.equal(ran.result.branch, replay.BRANCH.CONTENT_CHANGED);
  assert.equal(page.blocks[1].textContent, theirs, "R5: the page is not overwritten");
  assert.equal(replay.counters.regionsWritten, 0);
  assert.equal(replay.counters.regionsConflicted, 1);

  const badge = ran.cards.badges[item.id][0];
  assert.equal(badge.canonical_code, "REPLAY_NEITHER_MATCHES");
  // Both versions in full, the reviewer's and the page's. No indirection.
  assert.equal(badge.detail.yours, item.after);
  assert.equal(badge.detail.theirs, theirs);
});

test("a format-only record compares on structure, so a text-equal change is still a change", () => {
  const item = fixtures.formatOnly();
  const page = pageOf([
    { text: "Before it." },
    { html: item.before_html.replace(/^<p>|<\/p>$/g, "") },
    { text: "After it." }
  ]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);

  const ran = runOne(anchoredItem, page.root);

  assert.equal(ran.result.branch, replay.BRANCH.REAPPLY);
  assert.equal(replay.counters.regionsWritten, 1);
  assert.match(page.blocks[1].innerHTML, /<strong>matters<\/strong>/);
});

test("finding 11: two successive format-only rewordings resolve as branch three, not a false conflict", () => {
  // A formatting-only edit reworded TWICE. A format-only record's after TEXT
  // never moves (it equals its before by construction); only the after_html
  // does. bumpRev must extend the applied-after history when the MARKUP moves,
  // or replay's branch three has nothing to compare against and flags a false
  // collision on the reviewer's own third formatting revision.
  const v1 = fixtures.formatOnly();
  const v2 = record.bumpRev(v1, { after_html: "<p>This part <em>matters</em>.</p>" });
  const v3 = record.bumpRev(v2, { after_html: "<p><strong>This part matters</strong>.</p>" });

  const priors = record.priorAfters(v3, record.FIELD.AFTER_HTML);
  assert.ok(
    priors.indexOf("<p>This part <em>matters</em>.</p>") !== -1,
    "the earlier formatting revision must be in the applied-after history for branch three"
  );

  // The page holds v2's markup (an earlier revision landed). Replay must read
  // branch three and re-apply v3, not flag a collision on the reviewer.
  const page = pageOf([{ text: "Before it." }, { html: "This part <em>matters</em>." }, { text: "After it." }]);
  const anchoredItem = anchored(v3, page.blocks[1], page.root);

  const ran = runOne(anchoredItem, page.root);

  assert.equal(ran.result.branch, replay.BRANCH.EARLIER_REVISION, "branch three, not branch four");
  assert.equal(replay.counters.regionsConflicted, 0, "no false conflict on the reviewer's own change");
  assert.equal(replay.counters.regionsEarlierRevision, 1);
  assert.equal(replay.counters.regionsWritten, 1, "the current revision is what lands");
});

test("a delete is idempotent by absence: the block gone is applied, the block back is re-applied", () => {
  const item = fixtures.deletion();
  const page = pageOf(["Before it.", item.before, "After it."]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);

  const first = runOne(anchoredItem, page.root);
  assert.equal(first.result.branch, replay.BRANCH.REAPPLY);
  assert.equal(page.root.children.length, 2, "the block is gone");
  assert.equal(replay.counters.regionsWritten, 1);

  // The page put it back. Re-applied, once, and then left alone.
  const second = runOne(anchoredItem, page.root);
  assert.equal(second.result.branch, replay.BRANCH.ALREADY_APPLIED);
  assert.equal(replay.counters.regionsWritten, 0, "absence is applied; nothing to write");
});

// ---------------------------------------------------------------------------
// Ranked test 14: a lost anchor, both shapes
// ---------------------------------------------------------------------------

test("zero matches and two matches are both surfaced as lost, and neither writes", () => {
  const item = fixtures.edit();

  // Zero: the passage is gone from the page entirely.
  const gonePage = pageOf(["Before it.", item.before, "After it."]);
  const goneItem = anchored(item, gonePage.blocks[1], gonePage.root);
  gonePage.blocks[1].textContent = "Nothing here resembles the region any more.";
  const gone = runOne(goneItem, gonePage.root);

  assert.equal(gone.result.lost, true);
  assert.equal(replay.counters.regionsLost, 1);
  assert.equal(replay.counters.regionsWritten, 0);
  assert.equal(replay.counters.passes, 1, "the pass still ran and still counted");
  assert.equal(gone.result.item.region.lost.code, "ANCHOR_LOST", "on the record, which is what 3A projects");
  assert.equal(gone.cards.badges[item.id][0].canonical_code, "ANCHOR_LOST");

  // Two: the page grew a duplicate of the region, with the same context on both
  // sides, so context cannot break the tie either.
  const twinPage = pageOf(["Context before.", item.before, "Context after."]);
  const twinItem = anchored(item, twinPage.blocks[1], twinPage.root);
  ["Context before.", item.before, "Context after."].forEach(function (text) {
    const node = el("p", { text: text });
    node.parentElement = twinPage.root;
    twinPage.root.children.push(node);
  });
  const twin = runOne(twinItem, twinPage.root);

  assert.equal(twin.result.lost, true, "two matches fails closed exactly like zero");
  assert.equal(replay.counters.regionsLost, 1);
  assert.equal(replay.counters.regionsWritten, 0);
  assert.equal(twinPage.blocks[1].textContent, item.before, "nothing moved");
  assert.equal(twinPage.root.children[4].textContent, item.before, "and the twin was not written either");
  assert.match(twin.result.item.region.lost.reason, /more than one place/);
});

// ---------------------------------------------------------------------------
// The property that makes the rest safe
// ---------------------------------------------------------------------------

test("an agent rewriting one region leaves every other outstanding record untouched", () => {
  const items = fixtures.manyEdits(4);
  const page = pageOf(
    items.map(function (item) {
      return item.before;
    })
  );
  const anchoredItems = items.map(function (item, i) {
    return anchored(item, page.blocks[i], page.root);
  });
  const before = JSON.stringify(anchoredItems);

  // The agent rewrote the source under region 2 while the records stood. The
  // region is still recognizably itself, and it is neither version of the edit.
  const rewritten = items[1].before + " The agent added this sentence.";
  page.blocks[1].textContent = rewritten;

  replay.resetCounters();
  const cards = fakeCards();
  const summary = replay.runPass(replay.REASON.REMOUNT, {
    root: page.root,
    items: anchoredItems,
    cards: cards
  });

  assert.equal(replay.counters.regionsConflicted, 1, "exactly the one the agent touched");
  assert.equal(replay.counters.regionsWritten, 3, "the other three re-applied");
  assert.equal(page.blocks[1].textContent, rewritten, "R5: the collision writes nothing");
  assert.equal(summary.results.length, 4);

  // Byte-identical and unchanged in state, every one but the collision.
  const after = JSON.parse(JSON.stringify(anchoredItems));
  JSON.parse(before).forEach(function (item, i) {
    if (i === 1) return;
    assert.deepEqual(after[i], item, "record " + i + " must be byte-identical");
  });
});

test("the post-commit seam: protection lifts, replay runs on the element 2B hands it", () => {
  // 2B calls replay the moment protection lifts, with the block the reviewer
  // was in. A change the page tried to make while it was protected surfaces
  // here as branch four rather than being silently swallowed.
  const item = fixtures.edit();
  const page = pageOf(["Before it.", item.before, "After it."]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);
  const theirs = "The page swapped this paragraph out while the reviewer was in it.";
  page.blocks[1].textContent = theirs;

  replay.resetCounters();
  const cards = fakeCards();
  const outcome = replay.applyRecord(anchoredItem, {
    root: page.root,
    element: page.blocks[1],
    cards: cards
  });

  assert.equal(outcome.branch, replay.BRANCH.CONTENT_CHANGED);
  assert.equal(replay.counters.regionsConflicted, 1);
  assert.equal(replay.counters.regionsWritten, 0);
  assert.equal(page.blocks[1].textContent, theirs, "nothing was swallowed and nothing was written");
  assert.equal(replay.conflictFor(item.id).yours, item.after);
  assert.equal(replay.conflictFor(item.id).theirs, theirs);
});

test("replay never writes into a protected region", () => {
  const item = fixtures.edit();
  const page = pageOf(["Before it.", item.before, "After it."]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);

  const ran = runOne(anchoredItem, page.root, {
    protect: {
      isProtected: function (node) {
        return node === page.blocks[1];
      }
    }
  });

  assert.equal(ran.result.branch, null);
  assert.equal(replay.counters.regionsSkippedProtected, 1);
  assert.equal(replay.counters.regionsWritten, 0);
  assert.equal(page.blocks[1].textContent, item.before, "the reviewer is in there");
});

test("every DOM write happens inside the write epoch, so replay does not retrigger replay", () => {
  const item = fixtures.edit();
  const page = pageOf(["Before it.", item.before, "After it."]);
  const anchoredItem = anchored(item, page.blocks[1], page.root);
  const epoch = require("../../src/shared/epoch.js");

  const seen = [];
  const original = page.blocks[1];
  const spy = Object.create(original);
  Object.defineProperty(spy, "textContent", {
    get: function () {
      return original.textContent;
    },
    set: function (value) {
      seen.push(epoch.isWriting());
      original.textContent = value;
    }
  });

  replay.applyRecord(anchoredItem, { root: page.root, element: spy, cards: fakeCards() });
  assert.deepEqual(seen, [true], "the write must be inside epoch.write");
});
