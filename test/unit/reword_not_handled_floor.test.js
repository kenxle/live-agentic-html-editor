// Rewording an edit the agent said no to is treated like rewording a ready one.
//
// Owner: 2A. The spec is
// docs/features/20260922.01_draft_write_cost/01_spec_draft_write_cost.md,
// requirement 6, and the code review's finding 5 ("a not_handled edit being
// reworded still posts at typing speed"). Before this, typing into a
// not_handled edit left it not_handled, so every pause posted to the helper
// within 750 ms and the helper rewrote review.json each time, with the
// half-typed words in it.
//
// The rule, the same one a ready edit follows:
//
//   - the first changing keystroke withdraws it to draft and posts at once
//   - later keystrokes wait for the 10 second draft floor
//   - review.json stops carrying the refused wording as soon as that first
//     post lands, and is not rewritten again while the reviewer types
//   - commit makes it ready at a new revision
//   - typing the wording back puts it back to not_handled, same revision,
//     with the agent's reason still on it
//   - a crash while withdrawn recovers the way a withdrawn ready edit does
//
// The clock is node:test's mock timers, and sync's poll loop is running.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");
const projection = require("../../src/service/projection.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");
const editingModule = require("../../src/layer/editing.js");

const REVIEW = "review-refused-reword";
const FLOOR = protocol.FLUSH.DRAFT_FLOOR_MS;
const DEBOUNCE = protocol.FLUSH.HELPER_DEBOUNCE_MS;
const PAGE = { origin: "http://127.0.0.1:4000", path: "/plan", title: "Plan", seq: 1, source_hint: null };
const REASON = "The source keeps ten minutes on purpose; see the coach's note.";

function fakeElement(text) {
  const attrs = Object.create(null);
  const handlers = Object.create(null);
  return {
    nodeType: 1,
    tagName: "P",
    textContent: text,
    innerHTML: text,
    isConnected: true,
    parentElement: null,
    parentNode: null,
    childNodes: [],
    firstChild: null,
    classList: { add() {}, remove() {}, contains: () => false },
    style: {},
    closest: () => null,
    matches: () => false,
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
    setAttribute: (name, value) => {
      attrs[name] = String(value);
    },
    removeAttribute: (name) => {
      delete attrs[name];
    },
    addEventListener(name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
    },
    removeEventListener(name, fn) {
      handlers[name] = (handlers[name] || []).filter((each) => each !== fn);
    },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }),
    querySelectorAll: () => [],
    contains: () => false,
    focus() {},
    typeTo(next) {
      this.textContent = next;
      this.innerHTML = next;
      (handlers.input || []).slice().forEach((fn) => fn({ type: "input", inputType: "insertText" }));
    }
  };
}

function eventTarget() {
  const handlers = Object.create(null);
  return {
    addEventListener(name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
    },
    removeEventListener(name, fn) {
      handlers[name] = (handlers[name] || []).filter((each) => each !== fn);
    },
    fire(name) {
      (handlers[name] || []).slice().forEach((fn) => fn({ type: name }));
    }
  };
}

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

function surfaceOver(store, sync) {
  const doc = {
    body: fakeElement(""),
    documentElement: null,
    createElement: () => fakeElement(""),
    createRange: null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null
  };
  return editingModule.createEditing({
    document: doc,
    window: null,
    reviewId: REVIEW,
    store: store,
    sync: sync,
    highlights: { ensureStylesheet() {}, surface: () => ({ root: null }), addSurfaceStyle() {} },
    page: PAGE
  });
}

// A running sync over a fake helper that keeps every accepted event as the log
// does, so the test can project review.json from exactly what reached it.
function rig(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
  const store = storeModule.createStore({ locks: null });
  const posts = [];
  const log = [];
  const doc = Object.assign(eventTarget(), { hidden: false, location: { pathname: "/plan" } });
  const win = Object.assign(eventTarget(), { location: { pathname: "/plan" } });
  const fetchImpl = async (url, config) => {
    const path = String(url);
    if (path.indexOf("/events") !== -1) {
      const sent = JSON.parse(config.body);
      posts.push({ at: Date.now(), events: sent.events });
      sent.events.forEach((e) => log.push(Object.assign({}, e, { seq: log.length + 1 })));
      return ok({ accepted: sent.events.map((e) => e.event_id), seq: log.length });
    }
    if (path.indexOf("/replies") !== -1) return ok({ events: [], seq: log.length });
    if (path.indexOf("/window/release") !== -1) return ok({ released: true });
    return ok({ granted: true, session_secret: "secret", heartbeat_seconds: 30 });
  };
  const sync = syncModule.createSync({
    review: REVIEW,
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: doc,
    window: win,
    fetch: fetchImpl
  });
  t.after(() => {
    sync.stop();
    t.mock.timers.reset();
  });
  async function drain() {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  }
  return {
    store,
    sync,
    posts,
    log,
    drain,
    async advance(ms, step) {
      const by = step || 100;
      for (let done = 0; done < ms; done += by) {
        t.mock.timers.tick(Math.min(by, ms - done));
        await drain();
      }
    },
    // review.json as the helper would write it from the log so far, without
    // generated_at: the exact comparison tickReview uses to skip a rewrite.
    reviewJson() {
      const got = projection.project(REVIEW, log, { generated_at: "2026-09-28T00:00:00.000Z" });
      return projection.stringify(got);
    },
    items() {
      const got = projection.project(REVIEW, log, { generated_at: "2026-09-28T00:00:00.000Z" });
      const out = [];
      (got.pages || []).forEach((page) => page.items.forEach((item) => out.push(item)));
      return out;
    },
    // The agent says no. The helper folds the reply into its log, and the page
    // takes it into browser storage, as reply folding does.
    refuse(id) {
      const held = store.readItem(REVIEW, id);
      const reply = { status: "not_handled", agent: "claude", reason: REASON, text: null, files: [] };
      log.push(
        Object.assign(
          protocol.newEvent({
            event: protocol.EVENT.REPLY_FOLDED,
            event_id: "evt_refuse_" + log.length,
            review: REVIEW,
            item: id,
            rev: held.rev,
            payload: { accepted: true, state: record.STATE.NOT_HANDLED, refusal: null, file: "replies.jsonl", reply: reply }
          }),
          { seq: log.length + 1 }
        )
      );
      const refused = Object.assign({}, held, { state: record.STATE.NOT_HANDLED, reply: reply });
      store.write(REVIEW, refused);
      return refused;
    }
  };
}

// One hand edit, committed at rev 1, posted, and refused by the agent.
async function refusedEdit(t) {
  const r = rig(t);
  await r.sync.start();
  await r.drain();
  const surface = surfaceOver(r.store, r.sync);
  const block = fakeElement("Warm up for ten minutes.");
  surface.editBlock(block);
  block.typeTo("Warm up for fifteen minutes.");
  const committed = surface.commit({ reason: "commit" });
  await r.advance(DEBOUNCE + 500);
  r.refuse(committed.id);
  const listed = r.items();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].state, "not_handled", "the refusal is in review.json");
  return { r, surface, block, id: committed.id, postsBefore: r.posts.length };
}

test("the first changing keystroke withdraws a refused edit to draft and posts at once", async (t) => {
  const { r, surface, block, id, postsBefore } = await refusedEdit(t);
  surface.editBlock(block);
  block.typeTo("Warm up for fifteen minutes, then");

  const now = r.store.readItem(REVIEW, id);
  assert.equal(now.state, record.STATE.DRAFT, "off the agent's desk while the reviewer rewords it");
  assert.equal(now.rev, 1, "a keystroke never moves the revision");

  await r.advance(DEBOUNCE + 200);
  const sent = r.posts.slice(postsBefore);
  assert.equal(sent.length, 1, "the withdrawal went on the ordinary debounce");
  assert.equal(sent[0].events[0].draft, true);
  assert.equal(r.items().length, 0, "review.json stops carrying the refused wording once the withdrawal lands");
});

test("typing into a refused edit posts once at the first change, then at most once per 10 seconds", async (t) => {
  const { r, surface, block, postsBefore } = await refusedEdit(t);
  surface.editBlock(block);
  let text = "Warm up for fifteen minutes";
  // Thirty seconds of typing, a keystroke every 200 ms, with a pause long
  // enough to fire the old 750 ms debounce every tenth keystroke.
  for (let i = 0; i < 100; i += 1) {
    text += "x";
    block.typeTo(text);
    await r.advance(i % 10 === 9 ? 1000 : 200);
  }
  const sent = r.posts.slice(postsBefore);
  assert.ok(sent.length >= 1, "the withdrawal reached the helper");
  assert.ok(sent.length <= 5, "at most one draft copy per 10 seconds, plus the first: " + sent.length);
  for (let i = 1; i < sent.length; i += 1) {
    assert.ok(sent[i].at - sent[i - 1].at >= FLOOR, "draft posts " + (i - 1) + " and " + i + " are 10 seconds apart");
  }
  sent.forEach((p) => p.events.forEach((e) => assert.equal(e.draft, true, "nothing but drafts went while typing")));
});

test("review.json is not rewritten per pause while a refused edit is reworded", async (t) => {
  const { r, surface, block, postsBefore } = await refusedEdit(t);
  surface.editBlock(block);
  block.typeTo("Warm up for fifteen minutes, t");
  await r.advance(DEBOUNCE + 200);
  const afterWithdrawal = r.reviewJson();

  let text = "Warm up for fifteen minutes, t";
  const versions = new Set();
  for (let i = 0; i < 40; i += 1) {
    text += "y";
    block.typeTo(text);
    await r.advance(1000);
    versions.add(r.reviewJson());
  }
  assert.ok(r.posts.length > postsBefore + 1, "the helper did get draft copies");
  assert.equal(versions.size, 1, "every draft copy left review.json's bytes as they were");
  assert.ok(versions.has(afterWithdrawal), "the same bytes the withdrawal wrote");
});

test("committing a reworded refused edit makes it ready at a new revision", async (t) => {
  const { r, surface, block, id } = await refusedEdit(t);
  surface.editBlock(block);
  block.typeTo("Warm up for twenty minutes.");
  assert.equal(r.store.readItem(REVIEW, id).state, record.STATE.DRAFT);

  const committed = surface.commit({ reason: "commit" });
  assert.equal(committed.state, record.STATE.READY);
  assert.equal(committed.rev, 2, "the agent sees a new revision");
  const stale = lifecycle.applyReply(committed, { rev: 1, status: "handled", agent: "claude" });
  assert.equal(stale.accepted, false, "a reply to the refused wording is refused as stale");

  await r.advance(DEBOUNCE + 200);
  const listed = r.items();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].state, "ready");
  assert.equal(listed[0].rev, 2);
  assert.equal(listed[0].after_full, "Warm up for twenty minutes.");
  assert.equal(listed[0].reply, null, "the old refusal does not answer the new wording");
});

test("typing the refused wording back gives not_handled again, with no new revision", async (t) => {
  const { r, surface, block, id } = await refusedEdit(t);
  surface.editBlock(block);
  block.typeTo("Warm up for fifteen minutes, then");
  await r.advance(DEBOUNCE + 200);
  assert.equal(r.items().length, 0);

  block.typeTo("Warm up for fifteen minutes.");
  const back = r.store.readItem(REVIEW, id);
  assert.equal(back.state, record.STATE.NOT_HANDLED, "back to the state it opened in");
  assert.equal(back.rev, 1);
  assert.equal(back.reply && back.reply.reason, REASON, "the agent's reason is still on the card");
  assert.equal(surface.commit({ reason: "commit" }), null, "leaving is not a commit");
  assert.equal(r.store.readItem(REVIEW, id).rev, 1);

  await r.advance(DEBOUNCE + 200);
  const listed = r.items();
  assert.equal(listed.length, 1, "review.json carries it again");
  assert.equal(listed[0].state, "not_handled");
  assert.equal(listed[0].rev, 1);
  assert.equal(listed[0].reply && listed[0].reply.reason, REASON);
});

test("a crash while a refused edit is withdrawn recovers the way a withdrawn ready edit does", async (t) => {
  const { r, surface, block, id } = await refusedEdit(t);
  surface.editBlock(block);
  block.typeTo("Warm up for fifteen minutes, then stretch");
  assert.equal(r.store.readItem(REVIEW, id).state, record.STATE.DRAFT);

  // The tab dies: no commit, no unload. The next page to hold the review
  // builds a new surface over the same storage.
  const second = surfaceOver(r.store, r.sync);
  const recovered = second.recoverWithdrawn();
  assert.equal(recovered.length, 1);
  const item = r.store.readItem(REVIEW, id);
  assert.equal(item.state, record.STATE.READY, "committed, as leaving the page would have");
  assert.equal(item.rev, 2);
  assert.equal(item.after, "Warm up for fifteen minutes, then stretch", "nothing the reviewer typed is lost");
});

test("a draft post at the same revision as a handled reply leaves it handled", () => {
  const item = record.newItem({
    kind: record.KIND.EDIT,
    state: record.STATE.READY,
    before: "a",
    after: "b",
    change: "a to b",
    page_origin: PAGE.origin,
    page_path: PAGE.path
  });
  let seq = 0;
  const ev = (type, payload) =>
    Object.assign(
      protocol.newEvent({ event: type, event_id: "evt_h_" + seq, review: REVIEW, item: item.id, rev: 1, page_path: PAGE.path, payload }),
      { seq: (seq += 1) }
    );
  const events = [
    ev(protocol.EVENT.ITEM_READY, { draft: false, record: item }),
    ev(protocol.EVENT.REPLY_FOLDED, {
      accepted: true,
      state: record.STATE.HANDLED,
      file: "replies.jsonl",
      reply: { status: "handled", agent: "claude", reason: null, text: null, files: [] }
    }),
    ev(protocol.EVENT.ITEM_CONTENT, { draft: true, record: Object.assign({}, item, { state: record.STATE.DRAFT, after: "bc" }) })
  ];
  const got = projection.project(REVIEW, events, { generated_at: "2026-09-28T00:00:00.000Z" });
  assert.equal(got.pages[0].items[0].state, "handled", "the helper's lifecycle stands for a handled item");
});

// ---------------------------------------------------------------------------
// Code review round: late replies, the scope of the helper's withdrawal rule,
// and a draft from before the first commit
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const logModule = require("../../src/service/log.js");
const stateDir = require("../../src/service/state_dir.js");
const replies = require("../../src/service/replies.js");

let helperEventCounter = 0;
function helperRig(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-refused-"));
  const log = logModule.createEventLog({ dir: dir });
  stateDir.ensureReviewDir(dir, REVIEW);
  const folder = replies.createReplyFolder(Object.assign({ dir: dir, log: log }, options || {}));
  const lines = Object.create(null);
  return {
    log,
    folder,
    post(item, type) {
      helperEventCounter += 1;
      log.append(REVIEW, [
        protocol.newEvent({
          event: type,
          event_id: "evt_helper_" + helperEventCounter,
          review: REVIEW,
          item: item.id,
          rev: item.rev,
          page_path: item.page_path,
          page_title: item.page_title,
          page_seq: item.page_seq,
          payload: { draft: record.isDraft(item), record: item }
        })
      ]);
    },
    reply(file, fields) {
      lines[file] = (lines[file] || "") + JSON.stringify(fields) + "\n";
      fs.writeFileSync(stateDir.replyFilePath(dir, REVIEW, file), lines[file], { mode: 0o600 });
      return folder.fold(REVIEW);
    },
    item(id) {
      return projection.itemsFrom(log.read(REVIEW)).find((each) => each.id === id);
    }
  };
}

// A committed hand edit (it has history), as the browser holds it after commit.
function committedRecord() {
  return record.newItem({
    kind: record.KIND.EDIT,
    state: record.STATE.READY,
    before: "Warm up for ten minutes.",
    after: "Warm up for fifteen minutes.",
    change: "ten to fifteen",
    page_origin: PAGE.origin,
    page_path: PAGE.path,
    page_title: PAGE.title,
    page_seq: 1
  });
}

function withdrawn(item, typed) {
  return Object.assign({}, item, { state: record.STATE.DRAFT, after: typed });
}

for (const late of [
  { status: "handled", pageShows: () => true, label: "a late handled reply" },
  { status: "handled", pageShows: () => false, label: "a late handled reply the page does not show" },
  { status: "not_handled", pageShows: null, label: "a late not_handled reply" },
  { status: "question", pageShows: null, label: "a late question" }
]) {
  test(late.label + " naming the same revision is refused while the refused edit is withdrawn", () => {
    const h = helperRig(late.pageShows ? { pageShows: late.pageShows } : {});
    const item = committedRecord();
    h.post(item, protocol.EVENT.ITEM_READY);
    const first = h.reply("replies-claude.jsonl", { item: item.id, rev: 1, status: "not_handled", agent: "claude", reason: REASON });
    assert.equal(first.accepted.length, 1);
    h.post(withdrawn(item, "Warm up for fifteen minutes, then"), protocol.EVENT.ITEM_CONTENT);
    assert.equal(h.item(item.id).state, "draft", "the withdrawal landed");

    const second = h.reply("replies-codex.jsonl", {
      item: item.id,
      rev: 1,
      status: late.status,
      agent: "codex",
      reason: late.status === "not_handled" ? "no" : undefined,
      text: late.status === "question" ? "which one?" : undefined
    });
    assert.equal(second.accepted.length, 0, "an agent never answers a draft");
    assert.equal(second.refused.length, 1);
    const now = h.item(item.id);
    assert.equal(now.state, "draft", "the draft stays a draft");
    assert.equal(now.reply.reason, REASON, "the first answer is still the one on the card");
  });
}

test("a ready edit carrying a question is withdrawn by rewording and restored by typing it back", () => {
  const h = helperRig();
  const item = committedRecord();
  h.post(item, protocol.EVENT.ITEM_READY);
  h.reply("replies.jsonl", { item: item.id, rev: 1, status: "question", agent: "claude", text: "Fifteen or twenty?" });
  assert.equal(h.item(item.id).state, "ready", "a question leaves it ready");

  h.post(withdrawn(item, "Warm up for fifteen minutes, or"), protocol.EVENT.ITEM_CONTENT);
  assert.equal(h.item(item.id).state, "draft", "rewording takes it off the agent's desk");

  h.post(Object.assign({}, item), protocol.EVENT.ITEM_CONTENT);
  const back = h.item(item.id);
  assert.equal(back.state, "ready", "typed back: ready again");
  assert.equal(back.reply.text, "Fifteen or twenty?", "and the question is still on it");
});

test("a draft from before the first commit is not read as a withdrawal", () => {
  const h = helperRig();
  const committed = committedRecord();
  // The same edit as a draft, before it was ever committed: no history.
  const early = Object.assign({}, committed, { state: record.STATE.DRAFT, after: "Warm up for fif", after_history: [] });
  h.post(committed, protocol.EVENT.ITEM_READY);
  h.reply("replies.jsonl", { item: committed.id, rev: 1, status: "not_handled", agent: "claude", reason: REASON });
  // The stale draft arrives late.
  h.post(early, protocol.EVENT.ITEM_CONTENT);
  assert.equal(h.item(committed.id).state, "not_handled", "the agent's answer stands");
});
