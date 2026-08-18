// The review-session fixes, at the level each one is decidable without a
// browser: the origin-versus-unreachable decision, the pointer-outside commit
// rule, and the PATH-stable installer.
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
const installCli = require("../../scripts/install-cli.js");
const installSkills = require("../../scripts/install-skills.js");

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
  const canonicalSkill = fs.readFileSync(installSkills.SOURCE, "utf8");
  assert.equal(
    fs.readFileSync(path.join(home, ".agents", "skills", "lahe", "SKILL.md"), "utf8"),
    canonicalSkill,
    "the shared agent skill is installed from the repository"
  );
  assert.equal(
    fs.readFileSync(path.join(home, ".claude", "skills", "lahe", "SKILL.md"), "utf8"),
    canonicalSkill,
    "Claude gets the same repository-owned skill"
  );
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

test("skill installation preserves one hand-maintained LAHE copy before migration", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-skill-home-"));
  const target = path.join(home, ".claude", "skills", "lahe", "SKILL.md");
  const prior = "---\nname: lahe\ndescription: old local workflow\n---\n\nUse lahe add.\n";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, prior);

  const output = [];
  assert.equal(installSkills.install({ home: home, stdout: (text) => output.push(text), stderr: () => {} }), 0);
  assert.equal(fs.readFileSync(target, "utf8"), fs.readFileSync(installSkills.SOURCE, "utf8"));
  assert.equal(fs.readFileSync(installSkills.backupPath(home, "claude"), "utf8"), prior);
  assert.match(output.join(""), /preserved previous skill/);

  assert.equal(installSkills.install({ home: home, stdout: () => {}, stderr: () => {} }), 0);
  assert.equal(fs.readFileSync(installSkills.backupPath(home, "claude"), "utf8"), prior, "refresh does not rewrite the migration backup");
});

test("skill installation refuses an unrelated file at a target path", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-skill-home-"));
  const target = path.join(home, ".agents", "skills", "lahe", "SKILL.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "not a skill\n");
  const errors = [];
  const code = installSkills.install({
    home: home,
    targets: [{ agent: "shared", file: target }],
    stdout: () => {},
    stderr: (text) => errors.push(text)
  });
  assert.equal(code, 1);
  assert.equal(fs.readFileSync(target, "utf8"), "not a skill\n");
  assert.match(errors.join(""), /existing file is not a LAHE skill/);
});

test("the canonical skill rejects the retired and cross-session workflows", () => {
  const skill = fs.readFileSync(installSkills.SOURCE, "utf8");
  assert.match(skill, /lahe review <target>/);
  assert.match(skill, /session-scoped/);
  assert.match(skill, /Direct `\.md` and `\.markdown` targets/);
  assert.match(skill, /Do not use `lahe wait`/);
  assert.match(skill, /Do not monitor globally/);
  assert.match(skill, /Do not start `python3 -m http\.server`/);
  assert.doesNotMatch(skill, /lahe status --json --seen-file/, "the skill must not teach an unscoped monitor command");
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

// ---------------------------------------------------------------------------
// A duplicated tab cannot inherit the review by inheriting the window id
// ---------------------------------------------------------------------------
//
// The window id lives in sessionStorage, and a browser COPIES sessionStorage
// into a duplicated or restored tab. The same-tab reclaim trusted that id, so a
// second LIVE tab presented the first tab's id, was handed acquired:true with no
// Web Lock, and the two wrote one storage bucket with nothing to stop them. The
// lock, not the id, is what decides now: the reclaim asks for it without
// ifAvailable and takes acquisition as the proof.
//
// The browser half of this is test/browser/duplicate_tab.spec.js, which drives a
// real second tab with a copied sessionStorage.

const storeModule = require("../../src/layer/store.js");

// A Web Locks stand-in. `ifAvailable` is refused in both cases, which is the
// state that sends the claim down the reclaim path; `frees` is the difference
// between the two cases the reclaim has to tell apart: an outgoing document
// finishing its teardown (the lock comes free) and a live second window (it
// never does).
function locksWhere(frees) {
  return {
    request: function (name, optionsOrCallback, maybeCallback) {
      const ifAvailable = typeof optionsOrCallback === "object" && optionsOrCallback.ifAvailable === true;
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      if (ifAvailable) return Promise.resolve(callback(null));
      if (!frees) return new Promise(function () {});
      return Promise.resolve(callback({ name: name }));
    }
  };
}

function storeWith(locks, seeded) {
  const backing = { map: Object.create(null) };
  const api = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing.map, k) ? backing.map[k] : null),
    setItem: (k, v) => {
      backing.map[k] = String(v);
    },
    removeItem: (k) => {
      delete backing.map[k];
    },
    key: (i) => (Object.keys(backing.map)[i] === undefined ? null : Object.keys(backing.map)[i]),
    get length() {
      return Object.keys(backing.map).length;
    }
  };
  Object.keys(seeded || {}).forEach((k) => api.setItem(k, JSON.stringify(seeded[k])));
  return storeModule.createStore({ backing: api, windowId: "win-copied", locks: locks, reclaimMs: 25 });
}

test("a second LIVE tab holding a copied window id is refused, not handed the review", async () => {
  const seeded = { "lahe.holder.v1:rev-dupe": { window_id: "win-copied", since: new Date().toISOString(), path: "/deck.html" } };
  const got = await storeWith(locksWhere(false), seeded).claimWindow("rev-dupe", { path: "/deck.html" });
  assert.equal(got.acquired, false, "the lock is held by a live window, so the id match proves nothing");
  assert.equal(got.failure.code, "SECOND_WINDOW_REFUSED");
});

test("and the same id mid-reload still reclaims, because the lock is free", async () => {
  const seeded = { "lahe.holder.v1:rev-reload": { window_id: "win-copied", since: new Date().toISOString(), path: "/deck.html" } };
  const got = await storeWith(locksWhere(true), seeded).claimWindow("rev-reload", { path: "/deck.html" });
  assert.equal(got.acquired, true);
  assert.equal(got.reclaimed, true);
});

// ---------------------------------------------------------------------------
// What a chip is allowed to offer, beside the codes it answers for
// ---------------------------------------------------------------------------

const failuresModule = require("../../src/shared/failures.js");

test("the codes whose remedy IS an agent handoff can hand the line over", () => {
  assert.equal(failuresModule.isCopyable("REPLY_LINE_MALFORMED"), true);
  assert.equal(failuresModule.isCopyable("SYNC_UNAUTHORIZED"), true);
  assert.equal(failuresModule.isCopyable("SYNC_ORIGIN_NOT_ALLOWED"), true);
  assert.equal(failuresModule.isCopyable("CSP_REFUSED"), true);
});

test("a chip with its own button never also gets a Copy button", () => {
  assert.equal(failuresModule.chipAction("SECOND_WINDOW_REFUSED").action, "takeover");
  assert.equal(failuresModule.isCopyable("SECOND_WINDOW_REFUSED"), false);
  assert.equal(failuresModule.chipAction("HELPER_UNREACHABLE"), null);
  assert.equal(failuresModule.isCopyable("HELPER_UNREACHABLE"), false);
});

test("every code a table names is a code that exists", () => {
  Object.keys(failuresModule.CHIP_ACTIONS)
    .concat(Object.keys(failuresModule.COPYABLE))
    .forEach((code) => {
      assert.ok(failuresModule.describe(code), code + " is defined in failures.js");
    });
});
