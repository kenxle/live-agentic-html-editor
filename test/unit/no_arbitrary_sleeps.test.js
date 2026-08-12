// The no-arbitrary-sleeps rule, enforced rather than documented.
//
// Plan Task 0c: "No arbitrary sleeps. Every wait is a condition poll or a
// counter read. A flaky browser test gets its determinism fixed, never its
// assertion loosened, and the tool is never weakened to make a test pass."
//
// A rule that lives only in a document is the same shape as the "never rewrite
// the document" line in the tool being replaced: stated, agreed with, and
// quietly violated the first time something is flaky at 6pm. So this test walks
// every JS file under test/ and fails the gate on a sleep.
//
// What counts as a sleep, and what does not:
//
//   BANNED   page.waitForTimeout(...)          waiting a while and hoping
//   BANNED   new Promise(r => setTimeout(...)) the hand-rolled version
//   BANNED   a function called sleep/delay/pause that takes a duration
//   BANNED   setTimeout / setInterval anywhere outside the allowlist
//
// The known hole: the setTimeout rule skips a call preceded by a dot, so
// socket.setTimeout(ms) survives. It is a connect deadline on a socket, not a
// sleep, and flagging it would push someone into deleting a real timeout to
// satisfy a lint. The cost is that window.setTimeout inside a page.evaluate also
// slips through. If that starts happening, tighten the rule rather than removing
// it.
//
//   FINE     pollUntil / pollPage / page.waitForFunction / expect.poll
//   FINE     waitForCounter and friends
//   FINE     Playwright's `delay` option on keyboard.type, which is input
//            cadence: "ten characters, one per 50ms" is the scenario, not a
//            guess about how long something takes
//   FINE     a timer inside a fixture page, which is the reviewed app's own
//            behavior rather than the test waiting
//
// Two exemptions, both narrow and both marked in the file itself with
// `harness-allow-timer:` plus a reason:
//
//   test/helpers/poll.js   the one place a poll's interval timer lives
//
// If you are about to add a third, the answer is almost certainly a counter.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TEST_ROOT = path.join(__dirname, "..");

// Fixture pages and their assets simulate the reviewed application, which is
// allowed to have timers; that is the whole point of a page that repaints every
// 200ms. The scanner file itself is skipped because it necessarily names every
// banned pattern.
const SKIP_DIRS = new Set(["fixtures", "node_modules"]);
const SKIP_FILES = new Set([path.join(__dirname, "no_arbitrary_sleeps.test.js")]);

const ALLOW_MARKER = "harness-allow-timer:";

const BANNED = [
  {
    name: "page.waitForTimeout",
    pattern: /\.waitForTimeout\s*\(/,
    fix: "poll a condition (pollPage, waitForCounter) or read a counter"
  },
  {
    // The lookbehind matters: socket.setTimeout(ms) is a connect deadline on a
    // socket, not a sleep, and flagging it would push someone into deleting a
    // real timeout to satisfy a lint.
    name: "setTimeout",
    pattern: /(?<![.\w])setTimeout\s*\(/,
    fix: "use pollUntil from test/helpers/poll.js, which is the one place a poll interval lives"
  },
  {
    name: "setInterval",
    pattern: /(?<![.\w])setInterval\s*\(/,
    fix: "a test should not drive an interval; ask the fixture to repaint and wait on the counter"
  },
  {
    name: "a sleep helper",
    pattern: /\b(sleep|pause|wait)\s*\(\s*\d+\s*\)/,
    fix: "name the condition you are waiting for and poll it"
  }
];

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      if (SKIP_FILES.has(full)) continue;
      out.push(full);
    }
  }
  return out;
}

function stripped(line) {
  // Comments describe rules; they should not trip them.
  const commentAt = line.indexOf("//");
  return commentAt === -1 ? line : line.slice(0, commentAt);
}

test("no test file reaches for an arbitrary sleep", () => {
  const files = collect(TEST_ROOT, []);
  assert.ok(files.length > 0, "the scanner found no files to scan, which means it is broken");

  const violations = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const exempt = source.includes(ALLOW_MARKER);
    if (exempt) continue;

    source.split("\n").forEach(function (rawLine, index) {
      const line = stripped(rawLine);
      for (const rule of BANNED) {
        if (rule.pattern.test(line)) {
          violations.push(
            path.relative(TEST_ROOT, file) +
              ":" +
              (index + 1) +
              "  uses " +
              rule.name +
              "\n    " +
              rawLine.trim() +
              "\n    fix: " +
              rule.fix
          );
        }
      }
    });
  }

  assert.equal(
    violations.length,
    0,
    "Arbitrary sleeps found in the test suite. Every wait is a condition poll or a counter read.\n\n" +
      violations.join("\n\n") +
      "\n\nIf a timer genuinely belongs here, mark the file with a '" +
      ALLOW_MARKER +
      " <reason>' comment, and expect to justify it in review."
  );
});

test("the scanner actually catches a sleep", () => {
  // The scanner has to be watched failing too, or it is one typo away from
  // passing on every file forever.
  const samples = [
    "await page.waitForTimeout(300);",
    "await new Promise((resolve) => setTimeout(resolve, 250));",
    "const timer = setInterval(tick, 100);",
    "await sleep(500);"
  ];
  samples.forEach(function (sample) {
    const matched = BANNED.some(function (rule) {
      return rule.pattern.test(sample);
    });
    assert.ok(matched, "the scanner should have flagged: " + sample);
  });
});

test("the scanner does not flag the legitimate waits", () => {
  const samples = [
    "await page.keyboard.type(text, { delay: 50 });",
    "await waitForCounter(page, 'replayPasses', 5);",
    "await pollPage(page, () => window.__lahe.ready);",
    "await expect(locator).toHaveText('x');",
    "await startRepaints(page, 200);",
    "socket.setTimeout(timeoutMs);"
  ];
  samples.forEach(function (sample) {
    const matched = BANNED.filter(function (rule) {
      return rule.pattern.test(sample);
    });
    assert.equal(matched.length, 0, "the scanner wrongly flagged: " + sample + " (" + matched.map((r) => r.name).join(", ") + ")");
  });
});

test("the one exempt file is the one we expect", () => {
  const files = collect(TEST_ROOT, []);
  const exempt = files
    .filter(function (file) {
      return fs.readFileSync(file, "utf8").includes(ALLOW_MARKER);
    })
    .map(function (file) {
      return path.relative(TEST_ROOT, file);
    })
    .sort();

  assert.deepEqual(
    exempt,
    ["helpers/poll.js"],
    "the timer allowlist changed. Adding a file here needs a reason that is not 'it was flaky'."
  );
});
