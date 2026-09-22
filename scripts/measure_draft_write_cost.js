#!/usr/bin/env node
// One scripted typing session, measured: what a reviewer typing unsent
// comments costs in browser storage writes, helper posts and review.json
// rewrites.
//
// Written for docs/features/20260922.01_draft_write_cost (task 6), to be run
// once against the code before the change and once after:
//
//   node scripts/measure_draft_write_cost.js [<tree root>] [--json]
//
// <tree root> is a checkout (or `git archive` of one) whose src/ is measured.
// It defaults to this repo. The session is the same either way:
//
//   - a review that already holds 20 ready comments (so the item list and
//     review.json have a realistic size)
//   - three new comments, 120 characters each, one keystroke every 150ms
//   - the page's poll loop running the whole time
//   - after each comment: leave the box (where the tree has that hook), then
//     Cmd-Enter, then two seconds idle
//
// The clock is virtual, so the session takes no real time and gives the same
// numbers every run. The page side is the tree's own store.js and sync.js over
// a counting storage; the helper side is the tree's own log, projection and
// events.append route, in process, over a temporary state directory. Nothing
// is estimated: every number is a counter this script increments.
//
// Node-only. Not part of the tool.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var args = process.argv.slice(2);
var asJson = args.indexOf("--json") !== -1;
var rootArg = args.filter(function (a) {
  return a !== "--json";
})[0];
var ROOT = path.resolve(rootArg || path.join(__dirname, ".."));

// ---------------------------------------------------------------------------
// A virtual clock. Installed before the tree's modules load, so sync.js's
// timers and Date.now() both run on it.
// ---------------------------------------------------------------------------

var realSetImmediate = setImmediate;
var virtualNow = Date.parse("2026-09-22T12:00:00.000Z");
var timers = [];
var timerSeq = 0;
var RealDate = Date;
Date.now = function () {
  return virtualNow;
};
global.setTimeout = function (fn, ms) {
  timerSeq += 1;
  var handle = { id: timerSeq, at: virtualNow + Math.max(0, ms || 0), fn: fn, unref: function () {} };
  timers.push(handle);
  return handle;
};
global.clearTimeout = function (handle) {
  timers = timers.filter(function (t) {
    return t !== handle;
  });
};
global.setInterval = function () {
  return { unref: function () {} };
};
global.clearInterval = function () {};

function settle() {
  return new Promise(function (resolve) {
    realSetImmediate(resolve);
  });
}

async function advance(ms) {
  var until = virtualNow + ms;
  for (;;) {
    timers.sort(function (a, b) {
      return a.at - b.at || a.id - b.id;
    });
    var next = timers[0];
    if (!next || next.at > until) break;
    timers.shift();
    virtualNow = Math.max(virtualNow, next.at);
    next.fn();
    await settle();
    await settle();
  }
  virtualNow = until;
  await settle();
}

// ---------------------------------------------------------------------------
// The tree under test
// ---------------------------------------------------------------------------

function load(rel) {
  return require(path.join(ROOT, rel));
}

var record = load("src/shared/record.js");
var protocol = load("src/shared/protocol.js");
var storeModule = load("src/layer/store.js");
var syncModule = load("src/layer/sync.js");
var logModule = load("src/service/log.js");
var projection = load("src/service/projection.js");
var routes = load("src/service/routes.js");
var stateDir = load("src/service/state_dir.js");

var REVIEW = "rmeasure00001";
var PAGE = { origin: "http://127.0.0.1:4000", path: "/plan", title: "Plan", seq: 1 };

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

var counts = {
  storage_writes: 0,
  storage_bytes: 0,
  storage_item_writes: 0,
  storage_item_bytes: 0,
  storage_outbox_writes: 0,
  storage_outbox_bytes: 0,
  helper_posts: 0,
  helper_post_bytes: 0,
  draft_events_posted: 0,
  ready_events_posted: 0,
  review_json_rewrites: 0,
  review_json_bytes: 0,
  keystrokes: 0,
  characters: 0
};
var measuring = false;

function countingBacking() {
  var values = Object.create(null);
  return {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null;
    },
    setItem: function (k, v) {
      var s = String(v);
      values[k] = s;
      if (!measuring) return;
      // UTF-16 code units, which is how browsers count storage quota.
      var bytes = (k.length + s.length) * 2;
      counts.storage_writes += 1;
      counts.storage_bytes += bytes;
      if (k.indexOf("lahe.outbox.") === 0) {
        counts.storage_outbox_writes += 1;
        counts.storage_outbox_bytes += bytes;
      } else if (k.indexOf("lahe.items.") === 0 || k.indexOf("lahe.item.") === 0 || k.indexOf("lahe.index.") === 0) {
        counts.storage_item_writes += 1;
        counts.storage_item_bytes += bytes;
      }
    },
    removeItem: function (k) {
      delete values[k];
    },
    key: function (i) {
      return Object.keys(values)[i] || null;
    },
    get length() {
      return Object.keys(values).length;
    }
  };
}

// review.json lands by rename from a temp file; count those renames.
var realRename = fs.renameSync;
fs.renameSync = function (from, to) {
  if (measuring && String(to).slice(-"review.json".length) === "review.json") {
    counts.review_json_rewrites += 1;
    counts.review_json_bytes += fs.statSync(from).size;
  }
  return realRename.apply(fs, arguments);
};

// ---------------------------------------------------------------------------
// The helper, in process
// ---------------------------------------------------------------------------

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-measure-"));
stateDir.ensureReviewDir(dir, REVIEW);
var log = logModule.createEventLog({ dir: dir });
var deps = { log: log, projection: projection };
var seq = 0;

function ok(body) {
  return {
    ok: true,
    status: 200,
    json: function () {
      return Promise.resolve(body);
    }
  };
}

function fakeFetch(url, config) {
  var where = String(url);
  if (where.indexOf("/events") !== -1) {
    var body = JSON.parse(config.body);
    if (measuring) {
      counts.helper_posts += 1;
      counts.helper_post_bytes += Buffer.byteLength(config.body, "utf8");
      body.events.forEach(function (e) {
        if (e.draft === true) counts.draft_events_posted += 1;
        if (e.event === protocol.EVENT.ITEM_READY) counts.ready_events_posted += 1;
      });
    }
    var answer = routes.HANDLERS["events.append"]({ routeName: "events.append", review: REVIEW, body: body }, deps);
    seq = answer.body.seq;
    return Promise.resolve(ok(answer.body));
  }
  if (where.indexOf("/replies") !== -1) {
    // The real poll ticks the projector too; with nothing new it writes nothing.
    projection.tickReview(deps, REVIEW);
    return Promise.resolve(ok({ events: [], seq: seq }));
  }
  if (where.indexOf("/window/release") !== -1) return Promise.resolve(ok({ released: true }));
  return Promise.resolve(ok({ granted: true, session_secret: "secret", heartbeat_seconds: 30 }));
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function eventTarget() {
  return { addEventListener: function () {}, removeEventListener: function () {} };
}

var store = storeModule.createStore({ backing: countingBacking(), locks: null });
var doc = Object.assign(eventTarget(), { hidden: false, location: { pathname: PAGE.path } });
var win = Object.assign(eventTarget(), { location: { pathname: PAGE.path } });
var sync = syncModule.createSync({
  review: REVIEW,
  token: "t",
  helperOrigin: "http://127.0.0.1:7817",
  store: store,
  document: doc,
  window: win,
  fetch: fakeFetch
});

function newComment(note, state) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: state,
    note: note,
    page_origin: PAGE.origin,
    page_path: PAGE.path,
    page_title: PAGE.title,
    page_seq: PAGE.seq
  });
}

var SENTENCE =
  "This paragraph promises a summary it never gives; move the numbers from the table up here and cut the second clause. ";

async function main() {
  // Seed: 20 ready comments, in the browser and on the helper.
  for (var i = 0; i < 20; i += 1) {
    var seeded = newComment("Seeded comment " + i + ": " + SENTENCE + SENTENCE, record.STATE.READY);
    store.write(REVIEW, seeded);
    sync.recordItem(seeded, { immediate: "ready" });
  }
  await sync.start();
  await advance(3000);

  measuring = true;
  for (var c = 0; c < 3; c += 1) {
    var item = newComment("", record.STATE.DRAFT);
    var text = "";
    for (var k = 0; k < 120; k += 1) {
      text += SENTENCE.charAt(k % SENTENCE.length);
      item = Object.assign({}, item, { note: text, updated_at: new RealDate(virtualNow).toISOString() });
      store.write(REVIEW, item);
      sync.recordItem(item);
      counts.keystrokes += 1;
      counts.characters += 1;
      await advance(150);
    }
    // Leaving the box, where this tree has the hook for it.
    if (typeof sync.flushNow === "function") sync.flushNow("blur");
    await advance(100);
    var ready = Object.assign({}, item, { state: record.STATE.READY });
    store.write(REVIEW, ready);
    sync.recordItem(ready, { immediate: "ready" });
    await advance(2000);
  }
  await advance(15000);
  measuring = false;
  sync.stop();

  var out = { root: ROOT, counts: counts, pending_after: store.pendingEvents(REVIEW).length };
  if (asJson) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    Object.keys(counts).forEach(function (key) {
      process.stdout.write(key + "\t" + counts[key] + "\n");
    });
    process.stdout.write("pending_after\t" + out.pending_after + "\n");
  }
}

main().catch(function (err) {
  process.stderr.write(String((err && err.stack) || err) + "\n");
  process.exit(1);
});
