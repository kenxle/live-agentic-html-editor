// A refused card is not written onto the page.
//
// Spec: docs/features/20261011.01_stuck_replayed_blocks/01_spec_flag_dont_hold.md,
// requirement 1. The page differs from the file only while an edit is waiting
// for the agent's first answer. Once the agent says not_handled, the page shows
// the file and the reviewer's words stay on the card with the reason.
//
// Before this, replay counted not_handled as open work and wrote the refused
// words back after every repaint, which is how old lines stayed stuck inside a
// table the agent had built on request (the hackathon review, 2026-10-08).
//
// The fake DOM is the same eight-question shape replay_pass.test.js uses.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const replay = require("../../src/layer/replay.js");
const anchor = require("../../src/layer/anchor.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "refused-not-replayed" });

function el(tag, opts) {
  const options = opts || {};
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: options.attrs || {},
    children: [],
    parentElement: null,
    ownText: typeof options.text === "string" ? options.text : "",
    ownHtml: null,
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
      if (!this.children.length) return this.ownText;
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
    }
  });
  Object.defineProperty(node, "innerHTML", {
    get: function () {
      return typeof this.ownHtml === "string" ? this.ownHtml : this.textContent;
    },
    set: function (value) {
      this.children.length = 0;
      this.ownHtml = String(value);
      this.ownText = String(value).replace(/<[^>]*>/g, "");
    }
  });
  Object.defineProperty(node, "nodeType", { value: 1 });
  Object.defineProperty(node, "firstChild", {
    get: function () {
      if (this.children.length) return this.children[0];
      return this.ownText ? { nodeType: 3, data: this.ownText, nextSibling: null } : null;
    }
  });
  Object.defineProperty(node, "nextSibling", {
    get: function () {
      const parent = this.parentElement;
      if (!parent) return null;
      const at = parent.children.indexOf(this);
      return at === -1 ? null : parent.children[at + 1] || null;
    }
  });
  (options.children || []).forEach(function (child) {
    child.parentElement = node;
    node.children.push(child);
  });
  return node;
}

function pageOf(texts) {
  const nodes = texts.map(function (text) {
    return el("p", { text: text });
  });
  return { root: el("body", { children: nodes }), blocks: nodes };
}

function anchored(item, node, root) {
  const ref = anchor.mint({ element: node, root: root });
  assert.equal(ref.ok, true, "the fixture's own anchor must mint");
  const next = Object.assign({}, item);
  next[record.FIELD.REGION] = { ref: ref, label: "Fixture region", lost: null };
  return next;
}

function fakeCards() {
  const badges = {};
  return {
    badges: badges,
    setCardNotice: function () {},
    setCardBadge: function (id, failure) {
      badges[id] = (badges[id] || []).filter(function (b) {
        return b.code !== failure.code;
      });
      badges[id].push(failure);
    },
    clearCardBadge: function (id, code) {
      badges[id] = (badges[id] || []).filter(function (b) {
        return b.code !== code && b.canonical_code !== code;
      });
    },
    cardBadges: function (id) {
      return (badges[id] || []).slice();
    },
    attachCardNode: function (id) {
      return { id: id };
    },
    cardBody: function () {
      return null;
    }
  };
}

function refused(item) {
  const out = Object.assign({}, item);
  out[record.FIELD.STATE] = record.STATE.NOT_HANDLED;
  out[record.FIELD.REPLY] = { status: "not_handled", agent: "claude", reason: "These lines are rows in the table now.", at: "2026-10-11T00:00:00.000Z" };
  return out;
}

test("record.isReplayable counts only a ready item the reviewer is waiting on", () => {
  assert.equal(record.isReplayable({ state: record.STATE.READY }), true);
  assert.equal(record.isReplayable({ state: record.STATE.NOT_HANDLED }), false, "the agent answered no");
  assert.equal(record.isReplayable({ state: record.STATE.HANDLED }), false);
  assert.equal(record.isReplayable({ state: record.STATE.DRAFT }), false);
  // The rail's open count is a different question, and keeps its answer.
  assert.equal(record.isOutstanding({ state: record.STATE.NOT_HANDLED }), true);
});

test("a stamp round is not replayed: the reviewer's card still reads handled", () => {
  const item = fixtures.edit();
  item[record.FIELD.STATE] = record.STATE.HANDLED;
  item[record.FIELD.REPLY] = { status: "handled", agent: "claude", at: "2026-10-11T00:00:00.000Z" };
  const round = record.pageCheckReopenOf(item, record.PAGE_CHECK_STAMP_NOTE, null, record.TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(round[record.FIELD.STATE], record.STATE.READY);
  assert.equal(record.isReplayable(round), false, "a round between the tool and the agent writes nothing on the page");
  // A reviewer's own reopen is theirs, and it is replayed.
  assert.equal(record.isReplayable(record.reopenIssue(item)), true);
});

test("a refused edit is not written onto the page", () => {
  const item = fixtures.edit();
  const page = pageOf(["Before it.", item.before, "After it."]);
  const no = refused(anchored(item, page.blocks[1], page.root));

  replay.resetCounters();
  const outcome = replay.applyRecord(no, { root: page.root, items: [no], cards: fakeCards() });

  assert.equal(outcome.wrote, false);
  assert.equal(page.blocks[1].textContent, item.before, "the page shows the file");
  assert.equal(replay.counters.regionsWritten, 0);
});

test("the same edit at ready is written, so a reworded refused card shows again once committed", () => {
  const item = fixtures.edit();
  const page = pageOf(["Before it.", item.before, "After it."]);
  const ready = anchored(item, page.blocks[1], page.root);

  replay.resetCounters();
  const outcome = replay.applyRecord(ready, { root: page.root, items: [ready], cards: fakeCards() });

  assert.equal(outcome.wrote, true);
  assert.equal(page.blocks[1].textContent, item.after);
});

test("a refused run is not placed", () => {
  const run = fixtures.runFixtures().find((f) => f.name === "worked example").item;
  const no = refused(run);
  const outcome = replay.applyRecord(no, { root: el("body"), items: [no], cards: fakeCards() });
  assert.equal(outcome.wrote, false);
  assert.equal(outcome.reason, "not replayed");
});

test("a refused card drops a stale lost stamp, and the drop is written down", () => {
  const item = fixtures.edit();
  const page = pageOf(["Before it.", item.before, "After it."]);
  const no = refused(anchored(item, page.blocks[1], page.root));
  no[record.FIELD.REGION] = Object.assign({}, no[record.FIELD.REGION], {
    lost: { code: "ANCHOR_NO_TEXT_MATCH", reason: "gone", at: "2026-10-11T00:00:00.000Z" }
  });
  const persisted = [];
  replay.applyRecord(no, {
    root: page.root,
    items: [no],
    cards: fakeCards(),
    persist: function (saved) {
      persisted.push(saved);
    }
  });
  assert.equal(no[record.FIELD.REGION].lost, null, "no stale lost state in review.json");
  assert.equal(persisted.length, 1);
});

test("a refused card drops a conflict it carried from when it was ready", () => {
  const item = fixtures.edit();
  const theirs = item.before + " It is reviewed on Sunday by both of them.";
  const page = pageOf(["Before it.", item.before, "After it."]);
  const ready = anchored(item, page.blocks[1], page.root);
  page.blocks[1].textContent = theirs;
  const cards = fakeCards();

  replay.resetCounters();
  const first = replay.applyRecord(ready, { root: page.root, items: [ready], cards: cards });
  assert.equal(first.branch, replay.BRANCH.CONTENT_CHANGED);
  assert.notEqual(replay.conflictFor(item.id), null, "the clash is raised while the card is ready");

  const no = refused(ready);
  replay.applyRecord(no, { root: page.root, items: [no], cards: cards });
  assert.equal(replay.conflictFor(item.id), null, "a refused card keeps no conflict");
  assert.deepEqual(
    cards.cardBadges(item.id).filter((b) => b.canonical_code === "REPLAY_NEITHER_MATCHES" || b.code === "REPLAY_NEITHER_MATCHES"),
    [],
    "and its card no longer shows one"
  );
  assert.equal(page.blocks[1].textContent, theirs, "and nothing was written");
});

test("Keep mine on a refused card's conflict sends it back to the agent instead of writing once", () => {
  const item = fixtures.edit();
  const theirs = item.before + " It is reviewed on Sunday by both of them.";
  const page = pageOf(["Before it.", item.before, "After it."]);
  const ready = anchored(item, page.blocks[1], page.root);
  page.blocks[1].textContent = theirs;
  const cards = fakeCards();

  replay.resetCounters();
  replay.applyRecord(ready, { root: page.root, items: [ready], cards: cards });
  assert.notEqual(replay.conflictFor(item.id), null);

  // The agent refused while the conflict card was still up.
  const no = refused(ready);
  const reopened = [];
  replay.configure({
    root: page.root,
    items: [no],
    cards: cards,
    persist: function () {},
    reopen: function (id) {
      reopened.push(id);
      return { id: id };
    }
  });
  const answered = replay.resolveConflict(item.id, "keep_mine");
  replay.configure({ root: null, items: null, cards: null, persist: null, reopen: null });

  assert.equal(answered.resolved, true, answered.reason || "");
  assert.deepEqual(reopened, [item.id], "the card goes back to ready for the agent");
  assert.equal(page.blocks[1].textContent, theirs, "nothing is written by the press itself");
  assert.deepEqual(record.acceptedPageTexts(no), [theirs], "the answered page state is remembered for the replay that follows");
  assert.equal(replay.conflictFor(item.id), null);
});
