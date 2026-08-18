// What `review.write` and the facts it records are allowed to do.
//
// Five things that were each a live flaw:
//
//   1. any holder of a review token could add an ARBITRARY origin, which turned
//      the token-plus-origin pair into the token alone,
//   2. one review holds several pages, and a scalar target_path meant each add
//      overwrote the last,
//   3. the mtime trigger stat'd whatever was recorded, including a DIRECTORY,
//      so it fired on npm install and never on the page's own edit,
//   4. the source template could become the reload target,
//   5. the second-window refusal read a raw ISO timestamp at a person.
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
const service = require("../../src/service/index.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-write-"));
}

/** A helper's registry and log over a fresh state directory, plus one review. */
function fixture(reviewId, spec) {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  // The clock is injected so the mtime cache's short TTL can be stepped past
  // without the test sleeping through it.
  const clock = { at: Date.now() };
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => clock.at });
  reviews.create(Object.assign({ id: reviewId, origins: ["null"] }, spec || {}));
  return { dir: dir, log: log, reviews: reviews, clock: clock, deps: { log: log, reviews: reviews } };
}

function write(f, reviewId, body) {
  return routes.handlerFor("review.write")({ review: reviewId, query: {}, body: body }, f.deps);
}

// ---------------------------------------------------------------------------
// The origin allowlist is not writable to anywhere the caller likes
// ---------------------------------------------------------------------------

test("the origins `add` legitimately sends are accepted", () => {
  const f = fixture("review-1");
  const legit = ["http://localhost:3000", "http://127.0.0.1:8080", "https://localhost:4443", "null"];
  const result = write(f, "review-1", { origins: legit });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.origins, legit);
  legit.forEach((origin) => {
    assert.ok(f.reviews.get("review-1").origins.indexOf(origin) !== -1, origin + " was registered");
  });
});

test("an arbitrary origin is refused, and the refusal names it", () => {
  const f = fixture("review-1");
  const before = f.reviews.get("review-1").origins.slice();

  ["http://localhost:9999.evil.com", "https://evil.example.com", "http://192.168.1.10:3000", "file://", "*"].forEach(
    (origin) => {
      const result = write(f, "review-1", { origins: [origin] });
      assert.equal(result.status, 400, origin + " is refused");
      assert.equal(result.error.code, "PROTO_BAD_REQUEST");
      assert.ok(result.error.detail.indexOf(origin) !== -1, "the refusal names " + origin);
    }
  );

  // Nothing landed: the allowlist is exactly what it was.
  assert.deepEqual(f.reviews.get("review-1").origins, before);
});

test("a refused origin in a batch takes the whole write with it", () => {
  const f = fixture("review-1");
  const result = write(f, "review-1", { origins: ["http://localhost:3000", "https://evil.example.com"] });
  assert.equal(result.status, 400);
  assert.equal(f.reviews.get("review-1").origins.indexOf("http://localhost:3000"), -1);
});

test("the per-review origin count is capped", () => {
  const f = fixture("review-1");
  // One legal origin at a time, forever, is the quiet version of the same
  // problem. Ports are the cheapest way to mint distinct legal origins.
  let refusedAt = null;
  for (let port = 3000; port < 3000 + protocol.ORIGIN_LIMIT + 5; port += 1) {
    const origin = "http://127.0.0.1:" + port;
    const result = write(f, "review-1", { origins: [origin] });
    if (result.status === 400) {
      refusedAt = { port: port, detail: result.error.detail };
      break;
    }
  }
  assert.ok(refusedAt, "the cap was reached");
  assert.ok(refusedAt.detail.indexOf(String(protocol.ORIGIN_LIMIT)) !== -1, "the refusal names the limit");
  assert.ok(f.reviews.get("review-1").origins.length <= protocol.ORIGIN_LIMIT, "the list never grew past the limit");
});

test("re-registering an origin the review already holds never trips the cap", () => {
  const f = fixture("review-1");
  for (let i = 0; i < protocol.ORIGIN_LIMIT + 10; i += 1) {
    const result = write(f, "review-1", { origins: ["http://localhost:3000"] });
    assert.equal(result.status, 200, "repeat " + i + " is idempotent, not an accumulation");
  }
});

// ---------------------------------------------------------------------------
// One review, several pages
// ---------------------------------------------------------------------------

test("two pages on one review both trigger the reload", () => {
  const f = fixture("review-1");
  const one = path.join(f.dir, "one.html");
  const two = path.join(f.dir, "two.html");
  fs.writeFileSync(one, "<h1>one</h1>");
  fs.writeFileSync(two, "<h1>two</h1>");

  write(f, "review-1", { origins: [], target_path: one });
  write(f, "review-1", { origins: [], target_path: two });

  // The second add did not evict the first: both are recorded.
  const recorded = f.reviews.get("review-1").target_paths;
  assert.deepEqual(recorded, [one, two]);

  // A rebuild of the FIRST page still moves the reported mtime, which is what
  // the reviewer's open page reloads on.
  const before = f.reviews.targetMtime("review-1");
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(one, "<h1>one, rebuilt</h1>");
  fs.utimesSync(one, later, later);
  f.clock.at += 1000;
  assert.notEqual(f.reviews.targetMtime("review-1"), before);
  assert.equal(f.reviews.targetMtime("review-1"), fs.statSync(one).mtime.toISOString());
});

test("path matching keeps working for every page ever added", () => {
  const f = fixture("review-1");
  const one = path.join(f.dir, "one.html");
  const two = path.join(f.dir, "two.html");
  fs.writeFileSync(one, "<h1>one</h1>");
  fs.writeFileSync(two, "<h1>two</h1>");
  write(f, "review-1", { origins: [], target_path: one });
  write(f, "review-1", { origins: [], target_path: two });

  // `add` reads meta.json off disk (reviewMatchingPath), so the facts have to be
  // in the FILE, not only in memory: target_path is the most recent page, which
  // is the field old metas carry, and target_paths holds all of them.
  const meta = JSON.parse(fs.readFileSync(path.join(f.dir, "reviews", "review-1", "meta.json"), "utf8"));
  assert.equal(meta.target_path, two, "the scalar stays the most recent page, for add");
  assert.deepEqual(meta.target_paths, [one, two]);
});

test("the --source template never becomes a reload target", () => {
  const f = fixture("review-1");
  const built = path.join(f.dir, "page.html");
  const template = path.join(f.dir, "page.template.html");
  fs.writeFileSync(built, "<h1>built</h1>");
  fs.writeFileSync(template, "<h1>{{ title }}</h1>");
  write(f, "review-1", { origins: [], target_path: built, source_path: template });

  assert.deepEqual(f.reviews.get("review-1").target_paths, [built]);

  // Touching the template alone moves nothing: the built page is what the
  // reviewer is looking at, and reloading before the build has run shows them
  // the old page and calls it new.
  const mtime = f.reviews.targetMtime("review-1");
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(template, later, later);
  f.clock.at += 1000;
  assert.equal(f.reviews.targetMtime("review-1"), mtime);
});

test("a directory target reports no mtime at all", () => {
  const f = fixture("review-1");
  const project = path.join(f.dir, "project");
  fs.mkdirSync(project);
  write(f, "review-1", { origins: [], target_path: project });

  // A dev-server review records the project directory, whose mtime moves on
  // every npm install and stray .DS_Store and stays still when the page changes.
  assert.equal(f.reviews.targetMtime("review-1"), null);
});

// ---------------------------------------------------------------------------
// The second-window refusal is read by a person
// ---------------------------------------------------------------------------

test("the second-window refusal says how long, not an ISO timestamp", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  let now = Date.parse("2026-08-18T02:48:36.137Z");
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => now });
  reviews.create({ id: "review-1", origins: ["null"] });

  const holder = reviews.claimWindow("review-1", { window_id: "w1" });
  assert.equal(holder.granted, true);

  // Four minutes of the holder heartbeating, so it is still alive when the
  // second window asks. Without the beats it would simply go stale and the
  // second window would be granted the review.
  for (let i = 0; i < 24; i += 1) {
    now += 10 * 1000;
    reviews.claimWindow("review-1", { window_id: "w1", session_secret: holder.session_secret });
  }
  const refused = reviews.claimWindow("review-1", { window_id: "w2" });
  assert.equal(refused.granted, false);
  assert.ok(refused.reason.indexOf("for the last 4 minutes") !== -1, refused.reason);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(refused.reason), "no ISO timestamp in a sentence for a person");
  // The machine field is untouched.
  assert.equal(typeof refused.since, "string");
  assert.ok(/\d{4}-\d{2}-\d{2}T/.test(refused.since));
});

// ---------------------------------------------------------------------------
// The served library follows the build
// ---------------------------------------------------------------------------

test("a rebuilt bundle is served without restarting the helper", () => {
  const dir = tempDir();
  const bundle = path.join(dir, "lahe-layer.js");
  fs.writeFileSync(bundle, "// build one\n");
  const library = service.loadLibrary(bundle);

  const first = routes.handlerFor("library.get")({}, { library: library });
  assert.equal(first.raw.text, "// build one\n");

  fs.writeFileSync(bundle, "// build two, longer\n");
  const second = routes.handlerFor("library.get")({}, { library: library });
  assert.equal(second.raw.text, "// build two, longer\n");
});

test("a bundle that goes missing mid-review keeps serving the last good bytes", () => {
  const dir = tempDir();
  const bundle = path.join(dir, "lahe-layer.js");
  fs.writeFileSync(bundle, "// build one\n");
  const library = service.loadLibrary(bundle);
  assert.equal(library.source, "// build one\n");

  // Renamed out of the way, which is what a rebuild's write-beside-and-rename
  // looks like from here, and what a cleaned dist looks like too.
  fs.renameSync(bundle, bundle + ".away");
  const served = routes.handlerFor("library.get")({}, { library: library });
  assert.equal(served.status, 200, "a page mid-review is not failed over a rebuild window");
  assert.equal(served.raw.text, "// build one\n");
});

test("a bundle missing at startup is still a loud failure", () => {
  const dir = tempDir();
  assert.throws(
    () => service.loadLibrary(path.join(dir, "never-built.js")),
    /the built library is missing/
  );
});
