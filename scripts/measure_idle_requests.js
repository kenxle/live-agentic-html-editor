#!/usr/bin/env node
// How many requests one review tab makes to the helper, in three states.
//
// Written for docs/features/20260928.01_quiet_tab_polling (task 7), to be run
// once against the code before the change and once after:
//
//   node scripts/measure_idle_requests.js [<tree root>] [--json] [--minutes N]
//
// <tree root> is a checkout (or `git archive` of one) whose src/ is measured.
// It defaults to this repo. Each state is a fresh page that has booted and
// holds its review, then runs for the window (10 minutes by default):
//
//   focused_idle     the tab is visible and focused, and nobody touches it
//   focused_active   visible and focused, a key press every 2 seconds and a
//                    click every 10 seconds, the whole window
//   visible_unfocused  focused at boot, then the window loses focus (the
//                    reviewer switched to the terminal beside it) and stays
//                    visible
//   hidden           focused at boot, then the window loses focus and the tab
//                    is hidden (window blur plus visibilitychange)
//   closed           hidden for the whole window, then the tab is closed
//                    (pagehide); counts only what the close itself sends,
//                    because a closed page runs nothing afterwards
//
// The clock is virtual, so a 10 minute window takes no real time and gives the
// same numbers every run. The page is the tree's own store.js and sync.js. The
// helper's window claims are answered by the tree's own reviews.js, so an old
// tree gets the old claim answer. The reply poll is answered with no replies,
// and an agent line whose monitor timestamp moves every 15 seconds, which is
// what a real listening agent does. Nothing is estimated: every number is a
// counter this script increments.
//
// What it does not model: a real browser's own timer throttling for hidden
// tabs. That throttling only ever lowers the hidden counts further.
//
// Node-only. Not part of the tool.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var args = process.argv.slice(2);
var asJson = args.indexOf("--json") !== -1;
var minutesAt = args.indexOf("--minutes");
var MINUTES = minutesAt !== -1 ? Number(args[minutesAt + 1]) : 10;
var positional = args.filter(function (a, i) {
  return a !== "--json" && a !== "--minutes" && !(minutesAt !== -1 && i === minutesAt + 1);
});
var ROOT = path.resolve(positional[0] || path.join(__dirname, ".."));
var WINDOW_MS = MINUTES * 60 * 1000;

// ---------------------------------------------------------------------------
// A virtual clock, installed before the tree's modules load.
// ---------------------------------------------------------------------------

var realSetImmediate = setImmediate;
var virtualNow = Date.parse("2026-09-28T12:00:00.000Z");
var timers = [];
var timerSeq = 0;

Date.now = function () {
  return virtualNow;
};

function addTimer(fn, ms, every) {
  timerSeq += 1;
  var wait = Math.max(0, ms || 0);
  var handle = { id: timerSeq, at: virtualNow + wait, fn: fn, every: every ? Math.max(1, wait) : 0, unref: function () {} };
  timers.push(handle);
  return handle;
}

function removeTimer(handle) {
  timers = timers.filter(function (t) {
    return t !== handle;
  });
}

global.setTimeout = function (fn, ms) {
  return addTimer(fn, ms, false);
};
global.clearTimeout = removeTimer;
global.setInterval = function (fn, ms) {
  return addTimer(fn, ms, true);
};
global.clearInterval = removeTimer;

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
    virtualNow = Math.max(virtualNow, next.at);
    if (next.every) next.at = virtualNow + next.every;
    else timers.shift();
    next.fn();
    for (var i = 0; i < 4; i += 1) await settle();
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

var storeModule = load("src/layer/store.js");
var syncModule = load("src/layer/sync.js");
var logModule = load("src/service/log.js");
var reviewsModule = load("src/service/reviews.js");

var PAGE_PATH = "/plan";

function ok(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () {
      return Promise.resolve(body);
    }
  };
}

function routeOf(url) {
  var where = String(url);
  if (where.indexOf("/window/release") !== -1) return "window_release";
  if (where.indexOf("/window") !== -1) return "window_claim";
  if (where.indexOf("/replies") !== -1) return "reply_poll";
  if (where.indexOf("/events") !== -1) return "events_append";
  if (where.indexOf("/health") !== -1) return "health";
  return "other";
}

function eventTarget() {
  var handlers = Object.create(null);
  return {
    addEventListener: function (name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
    },
    removeEventListener: function (name, fn) {
      handlers[name] = (handlers[name] || []).filter(function (each) {
        return each !== fn;
      });
    },
    fire: function (name) {
      (handlers[name] || []).slice().forEach(function (fn) {
        fn({ type: name, target: null });
      });
    }
  };
}

/** One state: a fresh helper registry, a fresh page, a window of virtual time. */
async function runState(name, script) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-idle-"));
  var review = "ridle" + name.replace(/[^a-z]/g, "");
  var log = logModule.createEventLog({ dir: dir });
  var reviews = reviewsModule.createReviews({
    dir: dir,
    log: log,
    now: function () {
      return virtualNow;
    }
  });
  reviews.create({ id: review, origins: ["http://127.0.0.1:4000"] });

  var counts = { reply_poll: 0, window_claim: 0, window_release: 0, events_append: 0, health: 0, other: 0 };
  var measuring = false;
  var seq = 0;

  function fakeFetch(url, config) {
    var route = routeOf(url);
    if (measuring) counts[route] += 1;
    if (route === "window_claim") {
      var body = JSON.parse(config.body);
      var answer = reviews.claimWindow(review, body);
      return Promise.resolve(ok(answer.granted ? 200 : 409, answer));
    }
    if (route === "window_release") {
      return Promise.resolve(ok(200, reviews.releaseWindow(review, JSON.parse(config.body))));
    }
    if (route === "events_append") {
      var sent = JSON.parse(config.body);
      seq += sent.events.length;
      return Promise.resolve(
        ok(200, {
          accepted: sent.events.map(function (e) {
            return e.event_id;
          }),
          seq: seq
        })
      );
    }
    if (route === "reply_poll") {
      // An agent that is listening: its monitor stamps a heartbeat every 15s.
      var monitorAt = new Date(Math.floor(virtualNow / 15000) * 15000).toISOString();
      return Promise.resolve(
        ok(200, {
          events: [],
          seq: seq,
          target_mtime: "2026-09-28T11:00:00.000Z",
          agent_liveness: { state: "none", monitor_at: monitorAt, unanswered: 0 }
        })
      );
    }
    return Promise.resolve(ok(200, { ok: true }));
  }

  var focused = true;
  var store = storeModule.createStore({ locks: null });
  var doc = Object.assign(eventTarget(), {
    hidden: false,
    visibilityState: "visible",
    location: { pathname: PAGE_PATH },
    hasFocus: function () {
      return focused;
    }
  });
  var win = Object.assign(eventTarget(), { location: { pathname: PAGE_PATH } });
  var sync = syncModule.createSync({
    review: review,
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: doc,
    window: win,
    fetch: fakeFetch
  });

  await sync.start();
  await advance(3000);
  var lock = sync.lockState();
  if (!lock.acquired || lock.helperGranted !== true) {
    throw new Error(name + ": the page never came to hold its review");
  }

  measuring = true;
  var page = {
    blur: function () {
      focused = false;
      win.fire("blur");
    },
    close: function () {
      Object.keys(counts).forEach(function (key) {
        counts[key] = 0;
      });
      win.fire("pagehide");
    },
    hide: function () {
      focused = false;
      win.fire("blur");
      doc.hidden = true;
      doc.visibilityState = "hidden";
      doc.fire("visibilitychange");
    },
    key: function () {
      doc.fire("keydown");
    },
    click: function () {
      doc.fire("pointerdown");
    }
  };
  await script(page);
  measuring = false;
  var lockAfter = sync.lockState();
  sync.stop();

  var total = Object.keys(counts).reduce(function (sum, key) {
    return sum + counts[key];
  }, 0);
  return {
    state: name,
    window_minutes: MINUTES,
    total: total,
    counts: counts,
    // Still holding the review at the end, as the helper sees it. A page that
    // went quiet has to keep its review for the whole window.
    helper_still_holds: (function () {
      var holder = reviews.holderOf(review);
      return !!holder && holder.stale === false;
    })(),
    page_still_holds: lockAfter.acquired === true && lockAfter.helperGranted === true
  };
}

async function main() {
  var results = [];

  results.push(
    await runState("focused_idle", async function () {
      await advance(WINDOW_MS);
    })
  );

  results.push(
    await runState("focused_active", async function (page) {
      for (var at = 0; at < WINDOW_MS; at += 2000) {
        page.key();
        if (at % 10000 === 0) page.click();
        await advance(2000);
      }
    })
  );

  results.push(
    await runState("visible_unfocused", async function (page) {
      page.blur();
      await advance(WINDOW_MS);
    })
  );

  results.push(
    await runState("hidden", async function (page) {
      page.hide();
      await advance(WINDOW_MS);
    })
  );

  results.push(
    await runState("closed", async function (page) {
      page.hide();
      await advance(WINDOW_MS);
      // Only what the close sends is counted: the counters start again here,
      // and a closed page runs nothing after it.
      page.close();
      // No time passes: a closed page's timers never fire, so only what the
      // pagehide handler itself sent is counted.
      for (var i = 0; i < 8; i += 1) await settle();
    })
  );

  var out = { root: ROOT, window_minutes: MINUTES, results: results };
  if (asJson) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }
  process.stdout.write("tree\t" + ROOT + "\nwindow\t" + MINUTES + " minutes\n\n");
  process.stdout.write(
    "state\ttotal\treply_poll\twindow_claim\tevents_append\twindow_release\thealth\thelper_still_holds\n"
  );
  results.forEach(function (r) {
    process.stdout.write(
      [
        r.state,
        r.total,
        r.counts.reply_poll,
        r.counts.window_claim,
        r.counts.events_append,
        r.counts.window_release,
        r.counts.health,
        r.helper_still_holds
      ].join("\t") + "\n"
    );
  });
}

main().catch(function (err) {
  process.stderr.write(String((err && err.stack) || err) + "\n");
  process.exit(1);
});
