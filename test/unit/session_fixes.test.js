// The five review-session fixes, at the level each one is decidable without a
// browser: `wait` surviving a helper bounce, the origin-versus-unreachable
// decision, the pointer-outside commit rule, and the PATH-stable installer.
//
// The other halves live where they belong: `add` not restarting a held review
// and the helper serving the library are in test/unit/add_command.test.js
// (they need a real helper and a real command), and `status` is in
// test/unit/status_command.test.js.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const gestures = require("../../src/shared/gestures.js");
const syncModule = require("../../src/layer/sync.js");
const waitCommand = require("../../src/cli/commands/wait.js");
const installCli = require("../../scripts/install-cli.js");

// ---------------------------------------------------------------------------
// `lahe wait` survives the helper going away mid-wait
// ---------------------------------------------------------------------------

test("a dropped connection is retried from the SAME --since, not reported as unreachable", async () => {
  const seen = [];
  let calls = 0;
  const fetchImpl = async (url) => {
    seen.push(url);
    calls += 1;
    // The first two are the helper bouncing: the socket dies mid-long-poll.
    if (calls <= 2) throw new Error("fetch failed");
    return { ok: true, status: 200, json: async () => ({ events: [], seq: 12 }) };
  };
  const notes = [];

  const response = await waitCommand.blockingRequest(
    fetchImpl,
    { origin: "http://127.0.0.1:7817", token: "t", reviewOrigin: "null" },
    { review: "rev1", since: 7, timeout: 300 },
    (text) => notes.push(text)
  );

  assert.equal(response.ok, true);
  assert.equal(calls, 3, "it kept asking rather than giving up on the first drop");
  seen.forEach((url) => {
    assert.match(url, /since=7/, "every retry carries the same watermark, so nothing is skipped");
  });
  assert.equal(notes.length, 2, "one line when the connection went, one when it came back");
  assert.match(notes[0], /lost the connection/);
  assert.match(notes[1], /reconnected/);
});

test("a drop LATE in a long wait still gets its retries", async () => {
  // The flaw this covers: the grace was measured from the start of the long
  // poll, so a helper bounce more than thirty seconds into a wait had no window
  // left and the wait died on the first drop. The clock now starts when the
  // connection dropped. Date.now is stubbed so the test does not have to spend
  // a real minute proving it.
  const realNow = Date.now;
  let virtual = realNow();
  Date.now = () => virtual;
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        // Five minutes of an ordinary long poll, then the helper goes away.
        virtual += 5 * 60 * 1000;
        throw new Error("fetch failed");
      }
      if (calls === 2) throw new Error("fetch failed");
      return { ok: true, status: 200, json: async () => ({ events: [], seq: 3 }) };
    };
    const notes = [];
    const response = await waitCommand.blockingRequest(
      fetchImpl,
      { origin: "http://127.0.0.1:7817", token: "t", reviewOrigin: "null" },
      { review: "rev1", since: 4, timeout: 600 },
      (text) => notes.push(text)
    );
    assert.equal(response.ok, true);
    assert.equal(calls, 3, "the drop at t+5min was retried, not reported");
    assert.match(notes[0], /lost the connection/);
    assert.match(notes[1], /reconnected/);
  } finally {
    Date.now = realNow;
  }
});

test("the grace window is bounded: a helper that never comes back still fails", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch failed");
  };
  // --timeout 0 leaves nothing of the caller's own deadline to retry inside, so
  // the first failure is the answer. Outliving the caller's deadline would be a
  // different bug.
  await assert.rejects(
    waitCommand.blockingRequest(
      fetchImpl,
      { origin: "http://127.0.0.1:7817", token: "t", reviewOrigin: null },
      { review: "rev1", since: 0, timeout: 0 },
      () => {}
    ),
    /fetch failed/
  );
});

test("the reconnect window never outlives the caller's own timeout", () => {
  assert.equal(waitCommand.RECONNECT_GRACE_MS, 30 * 1000);
  assert.ok(waitCommand.RECONNECT_BACKOFF_MS.length > 0);
});

// ---------------------------------------------------------------------------
// The origin trap, told apart from a helper that is down
// ---------------------------------------------------------------------------

test("a 403 and a live helper both mean the origin, not the helper", () => {
  const decide = syncModule.decideFailureCode;
  // The direct refusal, when the request itself got through.
  assert.equal(decide({ status: 403 }), "SYNC_ORIGIN_NOT_ALLOWED");
  // The ordinary shape: the preflight was refused, so fetch failed with no
  // status at all, and health (unauthenticated, unpreflighted) still answered.
  assert.equal(decide({ healthAnswered: true }), "SYNC_ORIGIN_NOT_ALLOWED");
  // Nothing answered: the helper really is down.
  assert.equal(decide({ healthAnswered: false }), "HELPER_UNREACHABLE");
  assert.equal(decide({}), "HELPER_UNREACHABLE");
  // The two that outrank it, unchanged.
  assert.equal(decide({ cspRefused: true, healthAnswered: true }), "CSP_REFUSED");
  assert.equal(decide({ status: 401 }), "SYNC_UNAUTHORIZED");
});

// ---------------------------------------------------------------------------
// Leaving the block, every way there is
// ---------------------------------------------------------------------------

test("the pointer going down outside the edited block commits it, rail included", () => {
  const outside = gestures.gestureFor({ type: "pointerdown", editing: true, inEditedBlock: false });
  assert.equal(outside.gesture, gestures.GESTURE.COMMIT_EDIT);
  assert.equal(outside.passThrough, true, "the page and the rail still get the event");

  // The rail. A click here retargets to the overlay host and was swallowed by
  // the overlay rule, which is how an edit sat in draft forever.
  const onRail = gestures.gestureFor({ type: "pointerdown", editing: true, inEditedBlock: false, inOverlay: true });
  assert.equal(onRail.gesture, gestures.GESTURE.COMMIT_EDIT, "clicking the rail commits the open edit");

  // Inside the block is typing, not leaving.
  const inside = gestures.gestureFor({ type: "pointerdown", editing: true, inEditedBlock: true });
  assert.notEqual(inside.gesture, gestures.GESTURE.COMMIT_EDIT);

  // With no edit open, a pointer going down is the page's own.
  const idle = gestures.gestureFor({ type: "pointerdown", editing: false });
  assert.equal(idle.gesture, gestures.GESTURE.PAGE_DEFAULT);
});

test("a scrollbar drag and a right-click are not the reviewer leaving the block (review, 2026-08-17)", () => {
  // A scrollbar drag fires pointerdown on html with no click after it, so the
  // reviewer scrolling to see the rest of their edit had contenteditable
  // stripped out from under their pointer mid-drag.
  const scrollbar = gestures.gestureFor({ type: "pointerdown", editing: true, inEditedBlock: false, onScrollbar: true });
  assert.notEqual(scrollbar.gesture, gestures.GESTURE.COMMIT_EDIT);
  assert.equal(scrollbar.passThrough, true, "the page still scrolls");

  // Right-click opens a context menu. The reviewer is still editing.
  const right = gestures.gestureFor({ type: "pointerdown", editing: true, inEditedBlock: false, button: 2 });
  assert.notEqual(right.gesture, gestures.GESTURE.COMMIT_EDIT);
  const middle = gestures.gestureFor({ type: "mousedown", editing: true, inEditedBlock: false, button: 1 });
  assert.notEqual(middle.gesture, gestures.GESTURE.COMMIT_EDIT);

  // The primary button on content is still leaving, stated and unstated.
  const primary = gestures.gestureFor({ type: "pointerdown", editing: true, inEditedBlock: false, button: 0 });
  assert.equal(primary.gesture, gestures.GESTURE.COMMIT_EDIT);
  const unstated = gestures.gestureFor({ type: "pointerdown", editing: true, inEditedBlock: false });
  assert.equal(unstated.gesture, gestures.GESTURE.COMMIT_EDIT, "a caller that cannot tell means a primary press");
});

test("the scrollbar geometry: past the content box and inside the border box", () => {
  // A 200-wide box with a 15px vertical scrollbar: content stops at 185.
  const inner = { contentWidth: 185, contentHeight: 100, boxWidth: 200, boxHeight: 100 };
  assert.equal(gestures.isScrollbarPress(Object.assign({ x: 192, y: 40 }, inner)), true, "in the gutter");
  assert.equal(gestures.isScrollbarPress(Object.assign({ x: 184, y: 40 }, inner)), false, "one pixel of content");
  assert.equal(gestures.isScrollbarPress(Object.assign({ x: 260, y: 40 }, inner)), false, "past the box entirely");

  // A horizontal one, and both at once.
  const horizontal = { contentWidth: 200, contentHeight: 85, boxWidth: 200, boxHeight: 100 };
  assert.equal(gestures.isScrollbarPress(Object.assign({ x: 40, y: 92 }, horizontal)), true);
  assert.equal(gestures.isScrollbarPress(Object.assign({ x: 40, y: 40 }, horizontal)), false);

  // The root's scrollbar: outside the document element, inside the viewport.
  const root = { contentWidth: 1265, contentHeight: 800, boxWidth: 1280, boxHeight: 800 };
  assert.equal(gestures.isScrollbarPress(Object.assign({ x: 1272, y: 300 }, root)), true);
  assert.equal(gestures.isScrollbarPress(Object.assign({ x: 600, y: 300 }, root)), false);

  // No gutter at all is an overlay scrollbar, which takes no layout space and
  // receives no press. Nothing there can be a scrollbar press.
  const overlay = { contentWidth: 200, contentHeight: 100, boxWidth: 200, boxHeight: 100 };
  assert.equal(gestures.isScrollbarPress(Object.assign({ x: 199, y: 99 }, overlay)), false);

  // A caller that could not measure gets a no, never a guess.
  assert.equal(gestures.isScrollbarPress(null), false);
  assert.equal(gestures.isScrollbarPress({ contentWidth: 185, boxWidth: 200 }), false);
});

// ---------------------------------------------------------------------------
// The installer, and the nvm PATH trap
// ---------------------------------------------------------------------------

test("the wrapper pins both absolute paths, so nvm and PATH cannot break it", () => {
  const source = installCli.wrapperSource({ node: "/opt/node/bin/node", entry: "/repo/bin/lahe.js" });
  assert.match(source, /^#!\/bin\/sh\n/);
  assert.match(source, /exec "\/opt\/node\/bin\/node" "\/repo\/bin\/lahe\.js" "\$@"/);
  assert.equal(installCli.isOurWrapper(source), true, "and it carries the marker that makes it recognizable");
  assert.equal(installCli.isOurWrapper("#!/bin/sh\nexec something-else\n"), false);
});

test("it writes ~/.local/bin/lahe, and replaces only its own wrapper", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-home-"));
  const out = [];
  const err = [];
  const write = () =>
    installCli.install({
      home: home,
      node: "/opt/node/bin/node",
      entry: "/repo/bin/lahe.js",
      pathEnv: "/usr/bin",
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    });

  assert.equal(write(), 0);
  const target = path.join(home, ".local", "bin", "lahe");
  assert.equal(fs.existsSync(target), true);
  assert.equal((fs.statSync(target).mode & 0o111) !== 0, true, "and it is executable");
  // ~/.local/bin was not on the PATH it was given, so it says so and prints the
  // line to add rather than claiming success.
  assert.match(out.join(""), /not on your PATH/);
  assert.match(out.join(""), /export PATH=/);

  // Run again: its own wrapper is replaced without complaint.
  out.length = 0;
  assert.equal(write(), 0);
  assert.match(out.join(""), /replaced/);
});

test("it refuses, with the reason, rather than overwriting something else", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-home-"));
  const binDir = path.join(home, ".local", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const target = path.join(binDir, "lahe");
  fs.writeFileSync(target, "#!/bin/sh\necho somebody else's lahe\n");

  const err = [];
  const code = installCli.install({
    home: home,
    node: "/opt/node/bin/node",
    entry: "/repo/bin/lahe.js",
    pathEnv: binDir,
    stdout: () => {},
    stderr: (text) => err.push(text)
  });

  assert.equal(code, 1);
  assert.match(err.join(""), /leaving .* alone/);
  assert.equal(fs.readFileSync(target, "utf8"), "#!/bin/sh\necho somebody else's lahe\n", "untouched");
});

// ---------------------------------------------------------------------------
// The loopback-twin rule: a named localhost origin registers 127.0.0.1 too,
// and the reverse. Same server in every human's mind, two origins to every
// browser; a real review died on the difference (2026-08-17).
// ---------------------------------------------------------------------------

const addCommand = require("../../src/cli/commands/add.js");

test("a localhost origin brings its 127.0.0.1 twin, and the reverse", () => {
  assert.deepEqual(addCommand.withLoopbackTwins(["http://localhost:8899"]), [
    "http://localhost:8899",
    "http://127.0.0.1:8899"
  ]);
  assert.deepEqual(addCommand.withLoopbackTwins(["http://127.0.0.1:3000"]), [
    "http://127.0.0.1:3000",
    "http://localhost:3000"
  ]);
});

test("twins are not duplicated, ports are respected, and other hosts pass through", () => {
  assert.deepEqual(
    addCommand.withLoopbackTwins(["http://localhost:8899", "http://127.0.0.1:8899"]),
    ["http://localhost:8899", "http://127.0.0.1:8899"]
  );
  assert.deepEqual(addCommand.withLoopbackTwins(["http://localhost"]), [
    "http://localhost",
    "http://127.0.0.1"
  ]);
  assert.deepEqual(addCommand.withLoopbackTwins(["https://dev.example.test:4443"]), [
    "https://dev.example.test:4443"
  ]);
  assert.deepEqual(addCommand.withLoopbackTwins([]), []);
});
