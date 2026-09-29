// Fix round F3, the layer's sync side (free writing, reviews_impl/FIX_ROUND.md):
// the layer refuses an older helper (design call 9), a refused run still reads
// "Not sent" after a reload (code lead 5), and the notes flag reaches the
// layer's config (design call 2).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");
const layer = require("../../src/layer/index.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const REVIEW = "review-f3";

function eventTarget() {
  const handlers = Object.create(null);
  return {
    addEventListener(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      handlers[type] = (handlers[type] || []).filter((f) => f !== fn);
    },
    fire(type, event) {
      (handlers[type] || []).slice().forEach((fn) => fn(event || { type }));
    }
  };
}

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

function memBacking() {
  const mem = Object.create(null);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => {
      mem[k] = String(v);
    },
    removeItem: (k) => {
      delete mem[k];
    }
  };
}

function rig(t, options) {
  const opts = options || {};
  const backing = opts.backing || memBacking();
  const store = storeModule.createStore({ locks: null, backing: backing, sessionBacking: memBacking() });
  const posts = [];
  const refusedWith = [];
  const failuresRaised = [];
  const doc = Object.assign(eventTarget(), { hidden: false, location: { pathname: "/plan" } });
  const win = Object.assign(eventTarget(), { location: { pathname: "/plan" } });
  const fetchImpl = async (url, config) => {
    const path = String(url);
    if (path.indexOf("/health") !== -1) return ok(opts.health || { ok: true, service_contract: protocol.SERVICE_CONTRACT });
    if (path.indexOf("/events") !== -1) {
      const sent = JSON.parse(config.body);
      posts.push(sent.events);
      const refuse = opts.refuse || (() => null);
      const rejected = [];
      const accepted = [];
      sent.events.forEach((e) => {
        const code = refuse(e);
        if (code) rejected.push({ event_id: e.event_id, code: code, reason: "refused by the test" });
        else accepted.push(e.event_id);
      });
      return ok({ accepted: accepted, rejected: rejected, seq: accepted.length });
    }
    if (path.indexOf("/replies") !== -1) return ok({ events: [], seq: 0 });
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
    fetch: fetchImpl,
    onRefused: (info) => refusedWith.push(info),
    onFailure: (f) => failuresRaised.push(f)
  });
  t.after(() => sync.stop());
  async function drain() {
    for (let i = 0; i < 80; i += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 80; i += 1) await Promise.resolve();
  }
  return { backing, store, sync, posts, refusedWith, failuresRaised, drain };
}

function readyRun() {
  const item = createFixtures({ seed: "f3sync" }).runFixtures().find((f) => f.name === "worked example").item;
  return Object.assign({}, item, { state: record.STATE.READY });
}

// --- design call 9 / CR 4 / CL 24 / T I7 -------------------------------------

test("a helper on an older service contract puts the layer read-only, with the failure shown", async (t) => {
  const r = rig(t, { health: { ok: true, service_contract: protocol.SERVICE_CONTRACT - 1 } });
  await r.sync.start();
  await r.drain();
  assert.equal(r.sync.isReadOnly(), true);
  assert.ok(r.refusedWith.some((info) => info.refusedBy === "contract"), JSON.stringify(r.refusedWith));
  const raised = r.failuresRaised.map((f) => f.code);
  assert.ok(raised.indexOf("HELPER_CONTRACT_OLDER") !== -1, raised.join(","));

  const before = r.posts.length;
  const item = readyRun();
  r.store.write(REVIEW, item);
  r.sync.recordItem(item, { immediate: "ready" });
  await r.sync.flush({ force: true });
  await r.drain();
  assert.equal(r.posts.length, before, "nothing is posted to an older helper");
  const takeover = await r.sync.takeover();
  assert.equal(takeover.ok, false, "Review here instead cannot talk past the version check");
  assert.equal(r.sync.isReadOnly(), true);
});

test("a helper on the current contract is not refused", async (t) => {
  const r = rig(t);
  await r.sync.start();
  await r.drain();
  assert.equal(r.sync.isReadOnly(), false);
  assert.equal(r.failuresRaised.some((f) => f.code === "HELPER_CONTRACT_OLDER"), false);
});

test("a newer helper is not refused either: this clone is behind, not the helper", async (t) => {
  const r = rig(t, { health: { ok: true, service_contract: protocol.SERVICE_CONTRACT + 1 } });
  await r.sync.start();
  await r.drain();
  assert.equal(r.sync.isReadOnly(), false);
});

// --- CL 5: "Not sent" survives a reload --------------------------------------

test("a refused run still carries RUN_EVENT_REFUSED after a reload, until an accepted post clears it", async (t) => {
  let refusing = true;
  const first = rig(t, { refuse: (e) => (refusing && e.record && e.record.new_blocks ? "RUN_OVER_CEILING" : null) });
  await first.sync.start();
  await first.drain();
  const item = readyRun();
  first.store.write(REVIEW, item);
  first.sync.recordItem(item, { immediate: "ready" });
  await first.sync.flush({ force: true });
  await first.drain();
  assert.equal(first.sync.refusalFor(item.id).code, "RUN_EVENT_REFUSED");
  first.sync.stop();

  // The reload: a new client over the same browser storage.
  const second = rig(t, { backing: first.backing, refuse: () => null });
  const failure = second.sync.refusalFor(item.id);
  assert.ok(failure, "the refusal is read back from browser storage");
  assert.equal(failure.code, "RUN_EVENT_REFUSED");
  assert.equal(failure.detail.helper_code, "RUN_OVER_CEILING");

  // A fixed copy the helper accepts clears it, in storage too.
  await second.sync.start();
  await second.drain();
  const fixed = record.bumpRev(item, {});
  second.store.write(REVIEW, fixed);
  second.sync.recordItem(fixed, { immediate: "ready" });
  await second.sync.flush({ force: true });
  await second.drain();
  assert.equal(second.sync.refusalFor(item.id), null);
  second.sync.stop();
  const third = rig(t, { backing: first.backing });
  assert.equal(third.sync.refusalFor(item.id), null);
});

// --- design call 2: the notes flag reaches the layer --------------------------

function scriptWith(attrs) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    }
  };
}

test("the script tag's notes attribute reaches the layer's config as notes: true", () => {
  const A = protocol.SCRIPT_ATTR;
  const on = {};
  on[A.REVIEW] = "rev1";
  on[A.TOKEN] = "tok";
  on[A.NOTES] = protocol.NOTES_ON;
  assert.equal(layer.resolveConfig(null, {}, scriptWith(on)).notes, true);
  const off = {};
  off[A.REVIEW] = "rev1";
  off[A.TOKEN] = "tok";
  assert.equal(layer.resolveConfig(null, {}, scriptWith(off)).notes, false);
  off[A.NOTES] = "yes";
  assert.equal(layer.resolveConfig(null, {}, scriptWith(off)).notes, false, "only the one value turns it on");
});

test("the script tag carries the notes attribute only for a notes review", () => {
  const base = { src: "/lib.js", review: "rev1", token: "tok" };
  assert.ok(protocol.scriptTag(Object.assign({ notes: true }, base)).indexOf(protocol.SCRIPT_ATTR.NOTES + '="' + protocol.NOTES_ON + '"') !== -1);
  assert.equal(protocol.scriptTag(base).indexOf(protocol.SCRIPT_ATTR.NOTES), -1);
});
