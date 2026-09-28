// The drain's catalog_requests section (LAHE Library, Task 1.4, architecture
// "The drain section"): a pending Library request is work for the session it
// is `for`, it wakes the monitor once per request per handoff rev, and the
// drain keeps listing it until it is answered or expires.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const status = require("../../src/cli/commands/status.js");
const monitor = require("../../src/cli/commands/monitor.js");

const C = protocol.CATALOG;
const T0 = Date.parse("2026-09-28T16:00:00.000Z");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-status-catalog-"));
}

// s_attached is the agent that opened the Library: attached, with a live
// monitor heartbeat (this process's pid, so the pid check passes). s_doc owns
// three reviews; s_other is a second agent.
function world() {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_attached" });
  store.create({ id: "s_doc" });
  store.create({ id: "s_other" });
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  reviews.create({ id: "r_doc", agent_session_id: "s_doc" });
  reviews.create({ id: "r_doc2", agent_session_id: "s_doc" });
  reviews.create({ id: "r_doc3", agent_session_id: "s_doc" });
  catalogRequests.writeAttach(dir, "s_attached", T0);
  beat(store, "s_attached", T0);
  const queue = catalogRequests.createQueue({ dir, writeExpired: true });
  return { dir, store, queue };
}

function beat(store, id, nowMs) {
  const rev = agentSessions.handoffRev(store.read(id));
  store.writeMonitor(id, { pid: process.pid, handoff_rev: rev, at: new Date(nowMs).toISOString() });
}

async function drain(w, argv, extra) {
  const stdout = [];
  const stderr = [];
  const code = await status.run(argv.concat(["--state-dir", w.dir]), Object.assign({
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    now: T0 + 1000
  }, extra || {}));
  const text = stdout.join("");
  const jsonLines = text.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
  return { code, text, stderr: stderr.join(""), summary: jsonLines[jsonLines.length - 1] || null, lines: jsonLines };
}

function pickup(w, review, forSession, nowMs) {
  return w.queue.append(
    { action: "pickup", review: review || "r_doc", session: "s_doc", for: forSession || "s_attached" },
    nowMs === undefined ? T0 : nowMs
  ).request;
}

const QUIET = ["--session", "s_attached", "--json", "--quiet"];

test("a pending request for the drained session gets past --quiet with nothing else ready", async () => {
  const w = world();
  // s_attached owns no reviews at all: the Library's agent often owns none.
  const request = pickup(w);
  const out = await drain(w, QUIET);
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  assert.ok(out.summary, "the drain printed something: " + out.text);
  assert.equal(out.summary.catalog_requests.length, 1);
  const entry = out.summary.catalog_requests[0];
  assert.deepEqual(Object.keys(entry), [
    "request", "action", "review", "session", "kind", "moves_with", "at", "title", "path", "candidate", "handoff"
  ]);
  assert.equal(entry.request, request.id);
  assert.equal(entry.action, "pickup");
  assert.equal(entry.review, "r_doc");
  assert.equal(entry.session, "s_doc");
  assert.equal(entry.at, request.at);
  assert.deepEqual(entry.moves_with, ["r_doc2", "r_doc3"], "the other reviews in the document's session");
  // Filled by 2.1 from the reader's describeReview; null until then.
  assert.equal(entry.kind, null);
  assert.equal(entry.title, null);
  assert.equal(entry.handoff, null);
  // Line one is the field classes, which fence the page-text fields.
  assert.equal(out.lines[0].field_classes["catalog_requests[].title"], "data");
});

test("a pending request also gets past --quiet when the session owns reviews with nothing ready", async () => {
  const w = world();
  const log = logModule.createEventLog({ dir: w.dir });
  reviewsModule.createReviews({ dir: w.dir, log }).create({ id: "r_own", agent_session_id: "s_attached" });
  const quietBefore = await drain(w, QUIET);
  assert.equal(quietBefore.text, "", "nothing waiting, nothing printed");
  pickup(w);
  const out = await drain(w, QUIET);
  assert.equal(out.summary.catalog_requests.length, 1);
});

test("the describe seam fills kind and the page-text fields", async () => {
  const w = world();
  pickup(w);
  const seen = [];
  const out = await drain(w, QUIET, {
    describeRequest: (request) => {
      seen.push(request.review);
      return { kind: "static", title: "A title", path: "/x/y.md", candidate: null, handoff: "paste this", extra: "dropped" };
    }
  });
  assert.deepEqual(seen, ["r_doc"]);
  const entry = out.summary.catalog_requests[0];
  assert.equal(entry.kind, "static");
  assert.equal(entry.title, "A title");
  assert.equal(entry.path, "/x/y.md");
  assert.equal(entry.handoff, "paste this");
  assert.equal(Object.prototype.hasOwnProperty.call(entry, "extra"), false);
});

test("a request for session A never shows in session B's drain", async () => {
  const w = world();
  pickup(w);
  beat(w.store, "s_other", T0);
  const other = await drain(w, ["--session", "s_other", "--json", "--quiet"]);
  assert.equal(other.text, "");
  const plain = await drain(w, ["--session", "s_other", "--json"]);
  assert.deepEqual(plain.summary.catalog_requests, []);
});

test("the drain without --session lists every pending request", async () => {
  const w = world();
  pickup(w);
  const out = await drain(w, ["--json"]);
  assert.equal(out.summary.catalog_requests.length, 1);
});

test("the monitor's drain delivers a request once per session, and again after a takeover", async () => {
  const w = world();
  const request = pickup(w);
  const mark = { markEndedDelivered: true, suppressActivityTouch: true };
  const first = await drain(w, QUIET, mark);
  assert.equal(first.summary.catalog_requests.length, 1);
  assert.equal(first.summary.catalog_requests[0].request, request.id);
  const second = await drain(w, QUIET, mark);
  assert.equal(second.text, "", "delivered once: the second monitor poll is quiet");
  const delivered = fs.readFileSync(stateDir.catalogDeliveredPath(w.dir, "s_attached"), "utf8");
  assert.equal(delivered, request.id + " 0\n");

  // A takeover of the attached session delivers the still-pending request again,
  // to the agent that owns the session now.
  w.store.takeover("s_attached");
  beat(w.store, "s_attached", T0);
  const again = await drain(w, QUIET, mark);
  assert.equal(again.summary.catalog_requests.length, 1);
  assert.equal(await drain(w, QUIET, mark).then((out) => out.text), "");
});

test("the agent's own drain lists a request until it is answered, even after the monitor delivered it", async () => {
  const w = world();
  const request = pickup(w);
  await drain(w, QUIET, { markEndedDelivered: true, suppressActivityTouch: true });
  const quiet = await drain(w, QUIET);
  assert.equal(quiet.summary.catalog_requests.length, 1, "an agent that was woken can find out why");
  const plain = await drain(w, ["--session", "s_attached", "--json"]);
  assert.equal(plain.summary.catalog_requests.length, 1);

  assert.equal(w.queue.answer({ id: request.id, by: "s_attached", status: "done", text: "ok" }, T0 + 500).ok, true);
  const after = await drain(w, ["--session", "s_attached", "--json"]);
  assert.deepEqual(after.summary.catalog_requests, []);
  assert.equal((await drain(w, QUIET)).text, "");
});

test("the drain stops listing a request once it expires", async () => {
  const w = world();
  pickup(w);
  const at = T0 + C.REQUEST_EXPIRY_MS;
  beat(w.store, "s_attached", at);
  const out = await drain(w, ["--session", "s_attached", "--json"], { now: at });
  assert.deepEqual(out.summary.catalog_requests, []);
});

test("a monitor delivery stamps the session active, so the request outlives the monitor exiting on it", async () => {
  // The exit-on-work monitor takes its heartbeat down as it hands the request
  // over. Without a stamp, the request read as "monitor dead" before the agent
  // could drain and answer it.
  const w = world();
  const request = pickup(w, "r_doc", "s_attached", Date.now());
  await drain(w, QUIET, { markEndedDelivered: true, suppressActivityTouch: true });
  w.store.clearMonitor("s_attached");
  const later = Date.now() + 5000;
  assert.deepEqual(w.queue.pending(later).map((r) => r.id), [request.id]);
});

test("lahe monitor exits 0 on a pending request alone, and not again for the same one", async () => {
  const w = world();
  w.store.clearMonitor("s_attached");
  pickup(w, "r_doc", "s_attached", Date.now());
  const stdout = [];
  let idle = 0;
  const code = await monitor.run(["--session", "s_attached", "--state-dir", w.dir], {
    stdout: (text) => stdout.push(text),
    stderr: () => {},
    // Bounded: a monitor that never sees the request ends here instead of
    // polling forever.
    wait: async () => {
      idle += 1;
      if (idle === 2) w.store.close("s_attached");
    }
  });
  assert.equal(code, protocol.CLI_EXIT.OK);
  assert.match(stdout.join(""), /"catalog_requests":\[\{"request":"cq_/);

  let polls = 0;
  const again = await monitor.run(["--session", "s_attached", "--state-dir", w.dir], {
    stdout: () => {},
    stderr: () => {},
    wait: async () => {
      polls += 1;
      if (polls === 2) w.store.close("s_attached");
    }
  });
  assert.equal(again, protocol.CLI_EXIT.SESSION_CLOSED, "the delivered request did not wake it a second time");
});

test("the human-readable status names a pending request", async () => {
  const w = world();
  const request = pickup(w);
  const log = logModule.createEventLog({ dir: w.dir });
  reviewsModule.createReviews({ dir: w.dir, log }).create({ id: "r_own", agent_session_id: "s_attached" });
  const out = await drain(w, ["--session", "s_attached"]);
  assert.match(out.text, new RegExp("library request " + request.id + "  pickup  review r_doc  session s_doc"));
  assert.match(out.text, /lahe library answer/);
});
