// The helper putting the script line back after a rebuild stripped it out.
//
// Owner: 1A. The failure this covers happened twice in live use on 2026-08-18:
// a rebuild regenerated a reviewed page, the lahe script line went with it, and
// the reviewer's page came back with no rail at all. The documented fix (re-run
// `lahe add` after every rebuild) is discipline, and discipline is not a
// mechanism, so the helper heals the page itself on the stat it already does.
//
// The browser half (the page actually reloading onto the healed file with its
// items intact) is test/browser/auto_reload.spec.js.
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
const protocol = require("../../src/shared/protocol.js");
const scriptLine = require("../../src/shared/script_line.js");
const heal = require("../../src/service/heal.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-heal-"));
}

// A review holding one static page, on a clock the test drives: the stability
// window and the mtime cache are both measured on it, so nothing sleeps here.
function fixture(options) {
  const opts = options || {};
  const dir = tempDir();
  const page = path.join(dir, "page.html");
  fs.writeFileSync(page, opts.html === undefined ? BUILT_WITHOUT_LINE : opts.html);
  const log = logModule.createEventLog({ dir: dir });
  const clock = { at: 10000 };
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => clock.at });
  const review = reviews.create({ id: "r1", origins: ["null"], target_path: page });
  return { dir: dir, page: page, log: log, reviews: reviews, review: review, clock: clock };
}

const BUILT_WITHOUT_LINE = "<html>\n  <body>\n    <h1>rebuilt</h1>\n  </body>\n</html>\n";

/**
 * Two polls with the stability window between them, which is what an ordinary
 * session does at one second per poll: the first sighting records the mtime,
 * the second one acts on a file that has stopped changing.
 */
function pollTwice(f) {
  f.reviews.targetMtime("r1");
  f.clock.at += 2000;
  return f.reviews.targetMtime("r1");
}

function helperLogText(dir) {
  const logPath = path.join(dir, "helper.log");
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
}

test("a rebuild that dropped the line gets it back, identical to the one add writes", () => {
  const f = fixture();
  const mtime = pollTwice(f);

  const healed = fs.readFileSync(f.page, "utf8");
  assert.equal(scriptLine.reviewAlreadyInFile(healed), "r1", "the review id survives the rebuild");
  assert.match(healed, /data-lahe-token="/, "the token is on the line");
  assert.ok(healed.indexOf(f.review.token) !== -1, "and it is THIS review's token, not a fresh one");

  // Byte for byte the tag `add` writes, from the same pinned form.
  const expected = protocol.scriptTag({
    src: "http://" + protocol.DEFAULT_HOST + ":" + protocol.DEFAULT_PORT + protocol.route("library.get").path,
    review: "r1",
    token: f.review.token,
    helper: "http://" + protocol.DEFAULT_HOST + ":" + protocol.DEFAULT_PORT,
    fallback: heal.BUNDLE_BASENAME
  });
  assert.ok(healed.indexOf(expected.split("\n")[0]) !== -1, "the src line is the pinned one");
  assert.match(healed, /<\/body>/, "the page itself is untouched around it");
  assert.ok(healed.indexOf("<h1>rebuilt</h1>") !== -1, "the build's own content is kept");

  // The fallback copy beside the page is refreshed, exactly as `add` does it.
  assert.ok(fs.existsSync(path.join(f.dir, heal.BUNDLE_BASENAME)), "the sibling fallback copy is there");

  // The heal's own write is the reload trigger the page is waiting for.
  assert.equal(mtime, fs.statSync(f.page).mtime.toISOString());
  assert.match(helperLogText(f.dir), /stripped the script line out/);
});

test("a page carrying a DIFFERENT review's line is left alone and said out loud", () => {
  const other = '<html>\n  <body>\n    <script src="/x" data-lahe-review="r2" data-lahe-token="t2"></script>\n  </body>\n</html>\n';
  const f = fixture({ html: other });
  pollTwice(f);

  assert.equal(fs.readFileSync(f.page, "utf8"), other, "a page re-attached elsewhere is not ours to rewrite");
  assert.match(helperLogText(f.dir), /not healing .*it carries review r2/);
});

test("a file still being written is left until its mtime stands still", () => {
  const f = fixture();
  // One poll: the helper has seen this version of the file for the first time
  // and knows nothing about whether the build has finished writing it.
  f.reviews.targetMtime("r1");
  assert.equal(scriptLine.reviewAlreadyInFile(fs.readFileSync(f.page, "utf8")), null, "nothing is written mid-build");

  // The file changed again before the next poll, which is what a build writing
  // in pieces looks like: a moved mtime is a fresh sighting, never something to
  // act on, however long the previous version had been sitting still.
  const later = new Date(Date.now() + 4000);
  fs.writeFileSync(f.page, BUILT_WITHOUT_LINE + "<p>more</p>\n");
  fs.utimesSync(f.page, later, later);
  f.clock.at += 2000;
  f.reviews.targetMtime("r1");
  assert.equal(scriptLine.reviewAlreadyInFile(fs.readFileSync(f.page, "utf8")), null, "still deferred");

  // The build finished: the mtime stops moving, and now the line goes back.
  f.clock.at += 2000;
  f.reviews.targetMtime("r1");
  assert.equal(scriptLine.reviewAlreadyInFile(fs.readFileSync(f.page, "utf8")), "r1");
});

test("a file the build deleted is skipped, and the poll still answers", () => {
  const f = fixture();
  const gone = path.join(f.dir, "gone.html");
  f.reviews.recordPaths("r1", { target_path: gone });
  fs.unlinkSync(f.page);
  f.clock.at += 2000;

  assert.equal(f.reviews.targetMtime("r1"), null, "no mtime, no throw, nothing written");
  assert.equal(fs.existsSync(gone), false, "a missing file is never created by the heal");
});

test("a dev-server review is untouched: its target is a directory", () => {
  const dir = tempDir();
  const project = path.join(dir, "project");
  fs.mkdirSync(project);
  const log = logModule.createEventLog({ dir: dir });
  const clock = { at: 10000 };
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => clock.at });
  reviews.create({ id: "r1", origins: ["null"], target_path: project });

  reviews.targetMtime("r1");
  clock.at += 2000;
  assert.equal(reviews.targetMtime("r1"), null);
  assert.deepEqual(fs.readdirSync(project), [], "nothing was written into the project");
  assert.equal(reviews.lastHealAt("r1"), null);
});

test("the helper's own write does not retrigger it: one heal, one mtime bump", () => {
  const f = fixture();
  pollTwice(f);
  const afterHeal = fs.statSync(f.page).mtimeMs;
  const healedAt = f.reviews.lastHealAt("r1");
  const contents = fs.readFileSync(f.page, "utf8");

  // Poll for a while afterwards. The file already carries the line, and the
  // helper's own write is its new baseline, so nothing is written again.
  for (let i = 0; i < 5; i += 1) {
    f.clock.at += 2000;
    f.reviews.targetMtime("r1");
  }
  assert.equal(fs.statSync(f.page).mtimeMs, afterHeal, "the mtime moved exactly once");
  assert.equal(fs.readFileSync(f.page, "utf8"), contents);
  assert.equal(f.reviews.lastHealAt("r1"), healedAt, "and there was exactly one heal");
});

test("the heal is reported to lahe status through review.read", () => {
  const f = fixture();
  assert.equal(f.reviews.lastHealAt("r1"), null, "nothing has happened yet");
  pollTwice(f);

  const at = f.reviews.lastHealAt("r1");
  assert.equal(typeof at, "string");
  assert.ok(!Number.isNaN(Date.parse(at)));

  const status = require("../../src/cli/commands/status.js");
  const line = status.healLine({ last_heal_at: new Date(Date.now() - 4000).toISOString() }, Date.now());
  assert.match(line, /script line re-injected after a rebuild, 4s ago/);
  assert.equal(status.healLine({ last_heal_at: null }), null, "a review that never needed one says nothing");
});
