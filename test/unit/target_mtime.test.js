// R36's refresh trigger, at the level it is decidable without a browser: the
// helper reporting the reviewed file's mtime on the reply poll, and the layer
// deciding from a sequence of those values whether to reload.
//
// The browser half (the page actually reloading, a comment surviving it, and no
// reload landing on top of an open edit) is test/browser/auto_reload.spec.js.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const routes = require("../../src/service/routes.js");
const protocol = require("../../src/shared/protocol.js");
const syncModule = require("../../src/layer/sync.js");
const { pollUntil } = require("../helpers/poll.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-mtime-"));
}

function pollBody(deps, reviewId, pagePath) {
  const query = { since: 0 };
  if (pagePath) query.page_path = pagePath;
  return routes.handlerFor("replies.poll")({ review: reviewId, query: query }, deps).body;
}

// ---------------------------------------------------------------------------
// The helper side
// ---------------------------------------------------------------------------

test("replies.poll carries the reviewed file's mtime", () => {
  const dir = tempDir();
  const page = path.join(dir, "page.html");
  fs.writeFileSync(page, "<h1>one</h1>");

  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  reviews.create({ id: "review-1", origins: ["null"], target_path: page });

  const body = pollBody({ log: log, reviews: reviews }, "review-1");
  assert.equal(typeof body.target_mtime, "string");
  assert.equal(body.target_mtime, fs.statSync(page).mtime.toISOString());
  // The route's existing promises are untouched.
  assert.deepEqual(body.events, []);
  assert.equal(typeof body.seq, "number");
});

test("a rebuild moves the mtime the poll reports", () => {
  const dir = tempDir();
  const page = path.join(dir, "page.html");
  fs.writeFileSync(page, "<h1>one</h1>");

  const log = logModule.createEventLog({ dir: dir });
  // The read-through cache is TTL'd on this clock, so the test advances it
  // rather than sleeping past it.
  let now = 1000;
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => now });
  reviews.create({ id: "review-1", origins: ["null"], target_path: page });
  const deps = { log: log, reviews: reviews };

  const before = pollBody(deps, "review-1").target_mtime;
  now += 5000;
  // Far enough that the filesystem's own timestamp resolution cannot make the
  // two writes look simultaneous.
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(page, "<h1>two</h1>");
  fs.utimesSync(page, later, later);

  const after = pollBody(deps, "review-1").target_mtime;
  assert.notEqual(after, before, "the rebuild is visible on the wire");
});

test("a multi-page poll reports only the requesting page's target mtime", () => {
  const dir = tempDir();
  const one = path.join(dir, "one.html");
  const two = path.join(dir, "two.html");
  const line = '<script data-lahe-review="review-1"></script>';
  fs.writeFileSync(one, "<h1>one</h1>" + line);
  fs.writeFileSync(two, "<h1>two</h1>" + line);

  const log = logModule.createEventLog({ dir: dir });
  let now = 1000;
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => now });
  reviews.create({ id: "review-1", origins: ["null"], target_path: one });
  reviews.recordPaths("review-1", { target_path: two });
  const deps = { log: log, reviews: reviews };

  const oneBefore = pollBody(deps, "review-1", "/one.html").target_mtime;
  const twoBefore = pollBody(deps, "review-1", "/two.html").target_mtime;
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(one, "<h1>one rebuilt</h1>" + line);
  fs.utimesSync(one, later, later);
  now += 1000;

  assert.notEqual(pollBody(deps, "review-1", "/one.html").target_mtime, oneBefore);
  assert.equal(
    pollBody(deps, "review-1", "/two.html").target_mtime,
    twoBefore,
    "page one's rebuild is not page two's reload trigger"
  );
  assert.equal(
    pollBody(deps, "review-1").target_mtime,
    null,
    "an old multi-page client without page identity fails closed"
  );
});

test("a missing file and a review with no path both report null, and the route still answers", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const deps = { log: log, reviews: reviews };

  reviews.create({ id: "gone", origins: ["null"], target_path: path.join(dir, "never-written.html") });
  reviews.create({ id: "pathless", origins: ["null"] });

  const missing = pollBody(deps, "gone");
  assert.equal(missing.target_mtime, null, "a file the build deleted is null, never a thrown request");
  assert.deepEqual(missing.events, []);

  const pathless = pollBody(deps, "pathless");
  assert.equal(pathless.target_mtime, null);
});

test("the route table documents target_mtime, so nobody has to read the handler to find it", () => {
  const route = protocol.route("replies.poll");
  assert.match(route.response, /target_mtime/);
  assert.match(route.request, /page_path/);
});

// ---------------------------------------------------------------------------
// The layer side: what a sequence of mtimes decides
// ---------------------------------------------------------------------------

function syncFor(overrides) {
  const reloads = [];
  const notices = [];
  const opts = Object.assign(
    {
      review: "review-1",
      token: "t",
      store: { pendingEvents: () => [], windowId: "w1" },
      document: null,
      window: { location: { reload: () => reloads.push(Date.now()) } },
      fetch: null,
      onPageChanged: () => notices.push("said"),
      reloadDebounceMs: 5,
      reloadNoticeMs: 0
    },
    overrides || {}
  );
  const sync = syncModule.createSync(opts);
  return { sync: sync, reloads: reloads, notices: notices };
}

// The debounce and the notice pause are timers, so the assertions wait on a
// COUNTER rather than on a duration. `reloadChecks` counts every closed debounce
// window, which is what makes "and then nothing happened" a decidable claim.
function reloaded(sync, n) {
  return pollUntil(() => sync.status().reloadsFired >= (n || 1), { message: "the page to reload" });
}

function decided(sync, n) {
  return pollUntil(() => sync.status().reloadChecks >= (n || 1), { message: "the debounce window to close" });
}

test("the layer identifies its current pathname on every reply poll", async () => {
  let requested = null;
  const h = syncFor({
    window: {
      location: { pathname: "/reports/two.html", reload: () => {} }
    },
    fetch: async (url) => {
      requested = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ events: [], seq: 0, target_mtime: null })
      };
    }
  });

  await h.sync.poll();
  const query = new URL(requested).searchParams;
  assert.equal(query.get("review"), "review-1");
  assert.equal(query.get("page_path"), "/reports/two.html");
});

test("the first mtime is a baseline: the page already shows that version", () => {
  const h = syncFor();
  h.sync.noteTargetMtime("2026-08-17T10:00:00.000Z");
  assert.equal(h.sync.status().reloadPending, false, "nothing is even armed");
  assert.equal(h.reloads.length, 0);
  assert.equal(h.sync.status().targetMtime, "2026-08-17T10:00:00.000Z");
});

test("a different mtime reloads the page, and says so first", async () => {
  const h = syncFor();
  h.sync.noteTargetMtime("2026-08-17T10:00:00.000Z");
  h.sync.noteTargetMtime("2026-08-17T10:00:05.000Z");
  await reloaded(h.sync);
  assert.deepEqual(h.notices, ["said"], "the rail says what is about to happen");
  await pollUntil(() => h.reloads.length === 1, { message: "location.reload to be called" });
});

test("a rebuild that touches the file three times is one reload", async () => {
  const h = syncFor();
  h.sync.noteTargetMtime("2026-08-17T10:00:00.000Z");
  h.sync.noteTargetMtime("2026-08-17T10:00:01.000Z");
  h.sync.noteTargetMtime("2026-08-17T10:00:02.000Z");
  h.sync.noteTargetMtime("2026-08-17T10:00:03.000Z");
  await reloaded(h.sync);
  // The three writes shared one debounce window, so exactly one decision was
  // ever made about them.
  assert.equal(h.sync.status().reloadChecks, 1);
  assert.equal(h.sync.status().reloadsFired, 1);
});

test("the same mtime, polled forever, reloads nothing", () => {
  const h = syncFor();
  for (let i = 0; i < 5; i += 1) h.sync.noteTargetMtime("2026-08-17T10:00:00.000Z");
  assert.equal(h.sync.status().reloadPending, false);
  assert.equal(h.reloads.length, 0);
});

test("a null says nothing at all: a build mid-write is not a change", () => {
  const h = syncFor();
  h.sync.noteTargetMtime("2026-08-17T10:00:00.000Z");
  h.sync.noteTargetMtime(null);
  assert.equal(h.sync.status().reloadPending, false);
  assert.equal(h.reloads.length, 0);
  assert.equal(h.sync.status().targetMtime, "2026-08-17T10:00:00.000Z", "the baseline is kept, not cleared");
});

test("mid-work defers the reload, and the next quiet poll fires it", async () => {
  let busy = true;
  const h = syncFor({ isBusy: () => busy });
  h.sync.noteTargetMtime("2026-08-17T10:00:00.000Z");
  h.sync.noteTargetMtime("2026-08-17T10:00:05.000Z");
  await decided(h.sync);
  assert.equal(h.sync.status().reloadsFired, 0, "the page does not swap under a live edit");
  assert.equal(h.sync.status().reloadPending, true, "deferred is not cancelled");

  busy = false;
  // The next poll reports the SAME mtime, which is the ordinary case: nothing
  // changed again, and the pending reload is what gets to happen now.
  h.sync.noteTargetMtime("2026-08-17T10:00:05.000Z");
  await reloaded(h.sync);
  await pollUntil(() => h.reloads.length === 1, { message: "location.reload to be called" });
});

test("a busy check that throws defers rather than reloading over the reviewer", async () => {
  const h = syncFor({
    isBusy: () => {
      throw new Error("the rail is mid-remount");
    }
  });
  h.sync.noteTargetMtime("2026-08-17T10:00:00.000Z");
  h.sync.noteTargetMtime("2026-08-17T10:00:05.000Z");
  await decided(h.sync);
  assert.equal(h.sync.status().reloadsFired, 0);
  assert.equal(h.reloads.length, 0);
  assert.equal(h.sync.status().reloadPending, true);
});
