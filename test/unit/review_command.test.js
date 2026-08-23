// `lahe review`'s own printed output, for a plain static HTML target and for a
// Markdown one: the ONE openable URL rule and the source hint it can infer.
//
// These tests run the REAL command through the real entry point (`node
// bin/lahe.js review ...`), the same convention add_command.test.js uses and
// for the same reason: the thing under test is what a user (or the reviewer an
// agent hands a URL to) actually meets on their terminal, and capturing
// process.stdout.write in-process risks catching the test runner's own
// concurrent reporting between adjacent tests in a file, not just the
// command's output.
//
// Owner: 3B. The failure these tests pin: `lahe review` used to print its own
// authoritative "server"/"open" lines and then delegate to `add`, which printed
// a SECOND guess at the same URL ("Open it: likely ...") plus a confidently
// worded `file://` fallback right underneath. An agent pasted both to the
// reviewer, who opened both, and one document split into two page identities
// (Ken, live, 2026-08-18, and reproduced against unmodified main on
// 2026-08-23: three URLs in one block, the served one hedged twice and the
// file:// one stated with total confidence). `lahe review`'s output must carry
// exactly one openable URL, on the `open` line, and no `file://` string at all.
//
// Also pinned here: a Markdown review's source is known exactly (the .md file
// itself), and `review` records it so the agent reading review.json is told
// that rather than "source unknown". A plain static HTML target, where
// nothing was told to this tool, stays honestly unknown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const logModule = require("../../src/service/log.js");
const projectionModule = require("../../src/service/projection.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");

let eventCounter = 0;
function eventId() {
  eventCounter += 1;
  return "ev_review_command_test_" + eventCounter;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      server.close(function () {
        resolve(port);
      });
    });
  });
}

/** One `lahe review` run, through the real entry point. */
function runReview(args) {
  const result = { code: 0, stdout: "", stderr: "" };
  try {
    result.stdout = execFileSync(process.execPath, [BIN, "review"].concat(args), {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
  } catch (err) {
    result.code = typeof err.status === "number" ? err.status : 1;
    result.stdout = err.stdout ? String(err.stdout) : "";
    result.stderr = err.stderr ? String(err.stderr) : "";
  }
  return result;
}

function closeSession(sessionId, stateDir, port) {
  try {
    execFileSync(process.execPath, [BIN, "session", "close", sessionId, "--state-dir", stateDir, "--port", String(port)], {
      stdio: "ignore"
    });
  } catch (err) {
    // Best-effort cleanup; a failure here must not fail the test that already ran.
  }
}

function projectedPages(state, reviewId) {
  const events = logModule.createEventLog({ dir: state }).read(reviewId);
  return projectionModule.project(reviewId, events).pages;
}

// review.json only groups by page over ACTIONABLE items (D6): a review with
// none of its own yet, just the setup events `lahe review` wrote, has zero
// pages. One ready comment gives the projection a page to carry the source
// hint on, which is the thing under test.
function postReadyComment(state, reviewId, page) {
  const log = logModule.createEventLog({ dir: state });
  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "test comment",
    page_origin: page.origin,
    page_path: page.path,
    page_seq: 1
  });
  log.append(reviewId, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: eventId(),
      review: reviewId,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: page.path,
      page_seq: 1,
      payload: { draft: false, record: item }
    })
  ]);
}

test("lahe review on a plain static file prints exactly one openable URL and no file:// string", async () => {
  const root = tempDir("lahe-review-plain-");
  const state = path.join(tempDir("lahe-review-plain-state-"), "state");
  const target = path.join(root, "report.html");
  fs.writeFileSync(target, "<html><body><h1>Report</h1></body></html>");
  const port = await freePort();

  const run = runReview([target, "--state-dir", state, "--port", String(port)]);
  assert.equal(run.code, 0, run.stdout + run.stderr);
  const sessionId = run.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];

  try {
    // Exactly one line that opens the page.
    const openLines = run.stdout.split("\n").filter((line) => /^\s*open\s+http/.test(line));
    assert.equal(openLines.length, 1, "one open line:\n" + run.stdout);

    // No file:// string anywhere, and no second, hedged guess at the same URL.
    assert.equal(run.stdout.indexOf("file://"), -1, "no file:// substring in the output:\n" + run.stdout);
    assert.equal(run.stdout.indexOf("Open it:"), -1, "add's own second URL line is suppressed under review");
    assert.equal(run.stdout.indexOf("Fallback:"), -1, "add's own fallback line is suppressed under review");
    assert.doesNotMatch(run.stdout, /likely/, "the served URL review started is not a guess");

    // The static server binds its own ephemeral port, separate from the
    // helper's --port above, so only the shape (host and basename) is pinned.
    const openUrlText = run.stdout.match(/^\s*open\s+(http:\/\/\S+)/m)[1];
    assert.match(openUrlText, /^http:\/\/127\.0\.0\.1:\d+\/report\.html$/);
    const openUrl = new URL(openUrlText);

    // A plain static target: nothing was told to this tool about its source, so
    // the hint stays honestly unknown.
    const reviewId = run.stdout.match(/^\s*review\s+(r[a-f0-9]+)/m)[1];
    postReadyComment(state, reviewId, { origin: openUrl.origin, path: openUrl.pathname });
    const pages = projectedPages(state, reviewId);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].source_hint.known, false);
  } finally {
    closeSession(sessionId, state, port);
  }
});

// THE REVIEWED PAGE'S OWN FOLDER IS NOT THIS TOOL'S TO WRITE IN.
//
// `lahe review` used to put two files there: the script line into the page, and
// a copy of the built library beside it. That folder is very often a git
// checkout, so an ordinary `git add -A` committed both, and this repo's own
// tree carried four tagged HTML files and two committed bundles because of it.
// The tag is the dangerous half: its onerror names the fallback by a RELATIVE
// path, so once both files ship to a deployed site the localhost src fails, the
// sibling bundle loads, and the review rail comes up for every visitor.
//
// `lahe review` owns the server that answers for the page, so the line goes in
// the response instead and the library comes off that server's own reserved
// route. A plain `lahe add` has no server to inject for it and keeps writing
// both halves, which is what the second half of this test pins.
test("lahe review writes nothing into the reviewed page's folder, and a plain add still does", async () => {
  const root = tempDir("lahe-review-clean-");
  const state = path.join(tempDir("lahe-review-clean-state-"), "state");
  const target = path.join(root, "report.html");
  const onDisk = "<!doctype html>\n<html><body><h1>Report</h1></body></html>\n";
  fs.writeFileSync(target, onDisk);
  const sibling = path.join(root, "lahe-layer.js");
  const port = await freePort();

  const run = runReview([target, "--state-dir", state, "--port", String(port)]);
  assert.equal(run.code, 0, run.stdout + run.stderr);
  const sessionId = run.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const reviewId = run.stdout.match(/^\s*review\s+(r[a-f0-9]+)/m)[1];

  try {
    assert.equal(fs.readFileSync(target, "utf8"), onDisk, "the page on disk is byte for byte what it was");
    assert.equal(fs.existsSync(sibling), false, "and no copy of the library was left beside it");
    assert.equal(fs.readdirSync(root).join(","), "report.html", "the folder holds exactly what it held");

    // Nothing is lost by that: the rail arrives with the page, from the server
    // that answered the request, and it names that same server for the library.
    const openUrl = run.stdout.match(/^\s*open\s+(http:\/\/\S+)/m)[1];
    const served = await (await fetch(openUrl)).text();
    assert.ok(served.indexOf('data-lahe-review="' + reviewId + '"') !== -1, "the response carries the tag:\n" + served);
    assert.ok(served.indexOf('src="/.lahe-library/lahe-layer.js"') !== -1, "and loads the library from that server");
    assert.equal(served.indexOf('data-lahe-fallback="lahe-layer.js"'), -1, "nothing names a sibling file that is not there");

    // The advanced command, run directly, has no server of ours behind it. Both
    // halves are written, exactly as they always were.
    const added = execFileSync(
      process.execPath,
      [BIN, "add", target, "--state-dir", state, "--port", String(port), "--session", sessionId],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
    );
    assert.match(added, /The script line is in report\.html/);
    assert.ok(
      fs.readFileSync(target, "utf8").indexOf('data-lahe-review="' + reviewId + '"') !== -1,
      "a plain add writes the line into the file"
    );
    assert.equal(fs.existsSync(sibling), true, "and copies the library beside the page");
  } finally {
    closeSession(sessionId, state, port);
  }
});

test("lahe review on a Markdown file records the source, and an agent reads it as known", async () => {
  const root = tempDir("lahe-review-md-");
  const state = path.join(tempDir("lahe-review-md-state-"), "state");
  const source = path.join(root, "guide.md");
  fs.writeFileSync(source, "# Guide\n\nSome text.\n");
  const port = await freePort();

  const run = runReview([source, "--state-dir", state, "--port", String(port)]);
  assert.equal(run.code, 0, run.stdout + run.stderr);
  const sessionId = run.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];

  try {
    const openLines = run.stdout.split("\n").filter((line) => /^\s*open\s+http/.test(line));
    assert.equal(openLines.length, 1, "one open line:\n" + run.stdout);
    assert.equal(run.stdout.indexOf("file://"), -1);

    const openUrl = new URL(run.stdout.match(/^\s*open\s+(http:\/\/\S+)/m)[1]);
    const reviewId = run.stdout.match(/^\s*review\s+(r[a-f0-9]+)/m)[1];
    postReadyComment(state, reviewId, { origin: openUrl.origin, path: openUrl.pathname });
    const pages = projectedPages(state, reviewId);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].source_hint.known, true, "the .md source is known exactly");
    assert.equal(pages[0].source_hint.path, source);
  } finally {
    closeSession(sessionId, state, port);
  }
});
