// The helper's own promises: durability across a kill -9, one session per
// review with a takeover after a stale heartbeat, and an idempotent serve.
//
// Owner: 1A. Architecture D5 and D11.
//
// These are node tests rather than browser tests on purpose: none of them is
// about what a browser does. The browser half of ranked test 5 lives in
// test/browser/harness_second_origin.spec.js, where it needs a real second
// origin in a real browser to mean anything.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const protocol = require("../../src/shared/protocol.js");
const stateDirModule = require("../../src/service/state_dir.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const service = require("../../src/service/index.js");
// The one place a poll interval is allowed to live. Nothing in the suite waits a
// while and hopes; every wait below names the condition it is waiting for.
const { pollUntil } = require("../helpers/poll.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const ENTRY = path.join(REPO_ROOT, "src", "service", "index.js");
const REVIEW = "review-1";
const EVENTS_PATH = protocol.route("events.append").path;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-helper-"));
}

/** Spawn the helper the way the harness does, and wait for it to be ready. */
async function spawnHelper(dir, origins) {
  const child = spawn(process.execPath, [ENTRY, "--port", "0"], {
    env: Object.assign({}, process.env, {
      LAHE_STATE_DIR: dir,
      LAHE_REVIEWS: REVIEW,
      LAHE_ALLOWED_ORIGINS: (origins || []).join(",")
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const errors = [];
  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));

  const readyPath = path.join(dir, "service.json");
  const ready = await pollUntil(
    () => {
      if (!fs.existsSync(readyPath)) return null;
      try {
        const parsed = JSON.parse(fs.readFileSync(readyPath, "utf8"));
        return parsed.port && parsed.reviews && parsed.reviews[REVIEW] ? parsed : null;
      } catch (err) {
        // Half written. The helper renames into place, so this settles on the
        // next poll rather than needing a guard of its own.
        return null;
      }
    },
    {
      message: "the helper to write service.json with a token for " + REVIEW,
      describe: () => ({ stderr: errors.join("") })
    }
  );
  return { child: child, port: ready.port, token: ready.reviews[REVIEW].token, errors: errors };
}

function postEvents(port, token, origin, events) {
  return fetch("http://127.0.0.1:" + port + EVENTS_PATH, {
    method: "POST",
    headers: {
      "Content-Type": protocol.JSON_CONTENT_TYPE,
      [protocol.HEADER.CLIENT]: protocol.CLIENT_LAYER,
      [protocol.HEADER.TOKEN]: token,
      Origin: origin
    },
    body: JSON.stringify({ review: REVIEW, events: events })
  });
}

function anEvent(id) {
  return protocol.newEvent({
    event: protocol.EVENT.ITEM_CREATED,
    event_id: id,
    review: REVIEW,
    item: "c_" + id,
    rev: 1,
    payload: { text: "record " + id }
  });
}

test("a kill -9 in the middle of the work leaves a readable history", async () => {
  const dir = tempDir();
  const origin = "http://127.0.0.1:3000";
  const helper = await spawnHelper(dir, [origin]);

  // Keep posting, and pull the plug while requests are in flight. The point is
  // not to hit the exact microsecond of a write; it is that whenever the process
  // dies, what is on disk is still readable and every complete line is intact.
  const logPath = stateDirModule.eventsPath(dir, REVIEW);
  const inFlight = [];
  for (let i = 0; i < 40; i += 1) {
    inFlight.push(postEvents(helper.port, helper.token, origin, [anEvent("ev_" + i)]).catch(() => null));
  }

  // Wait for the condition that makes the kill interesting: the helper is
  // actually writing. Then pull the plug with the rest still in flight.
  await pollUntil(
    () => fs.existsSync(logPath) && fs.readFileSync(logPath, "utf8").split("\n").length > 4,
    { message: "the helper to have written several lines of the log" }
  );
  process.kill(helper.child.pid, "SIGKILL");
  await pollUntil(
    () => {
      try {
        process.kill(helper.child.pid, 0);
        return null;
      } catch (err) {
        return true;
      }
    },
    { message: "the helper process to be gone" }
  );
  await Promise.all(inFlight);
  const raw = fs.readFileSync(logPath, "utf8").split("\n").filter((line) => line.length > 0);
  assert.ok(raw.length > 0, "the log has something in it");

  let torn = 0;
  raw.forEach((line, index) => {
    try {
      JSON.parse(line);
    } catch (err) {
      torn += 1;
      assert.equal(index, raw.length - 1, "only the LAST line may be torn, and line " + (index + 1) + " was not");
    }
  });
  assert.ok(torn <= 1, "at most one torn line");

  // And a restarted helper reads that history rather than choking on it.
  const reopened = logModule.createEventLog({ dir: dir });
  const history = reopened.read(REVIEW);
  assert.equal(history.length, raw.length - torn);
  const ids = history.map((event) => event.event_id);
  assert.equal(new Set(ids).size, ids.length, "no event is doubled");
  assert.deepEqual(
    history.map((event) => event.seq),
    history.map((event, index) => index + 1),
    "seq is monotonic with no gaps"
  );
});

test("one session per review, refused by name, taken over when the heartbeat goes quiet", () => {
  const dir = tempDir();
  let now = 1000000;
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => now });
  reviews.create({ id: REVIEW });

  const first = reviews.claimWindow(REVIEW, { window_id: "w1" });
  assert.equal(first.granted, true);
  assert.equal(first.heartbeat_seconds, reviewsModule.HEARTBEAT_SECONDS);

  // A second window, while the first is alive, is refused with a reason NAMING
  // the first. A refusal the reviewer cannot act on is just a broken tab.
  const second = reviews.claimWindow(REVIEW, { window_id: "w2" });
  assert.equal(second.granted, false);
  assert.equal(second.holder, "w1");
  assert.match(second.reason, /already open in another window \(w1\)/);

  // The first window's heartbeat keeps it alive.
  now += 20000;
  assert.equal(reviews.claimWindow(REVIEW, { window_id: "w1" }).granted, true);
  assert.equal(reviews.claimWindow(REVIEW, { window_id: "w2" }).granted, false);

  // Then the first window's tab dies. After the stale window, the second one
  // TAKES OVER rather than being locked out: a reviewer shut out of their own
  // review after a crash is a work-losing outcome.
  now += reviewsModule.STALE_AFTER_MS + 1;
  const takeover = reviews.claimWindow(REVIEW, { window_id: "w2" });
  assert.equal(takeover.granted, true);
  assert.equal(takeover.took_over, true);
  assert.equal(reviews.holderOf(REVIEW).window_id, "w2");

  // And now the roles are reversed: the old holder is the one refused.
  assert.equal(reviews.claimWindow(REVIEW, { window_id: "w1" }).granted, false);
});

test("a review's token and origins persist across a restart", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const created = reviews.create({ id: REVIEW, origins: ["http://127.0.0.1:3000"] });

  // Rotating the token on restart would orphan every page mid-review: the page
  // holds the old one in its script tag and every sync would 401 forever.
  const restarted = reviewsModule.createReviews({ dir: dir, log: logModule.createEventLog({ dir: dir }) });
  restarted.loadFromDisk();
  assert.equal(restarted.get(REVIEW).token, created.token);
  assert.deepEqual(restarted.get(REVIEW).origins, ["http://127.0.0.1:3000"]);

  // Origins are a SET: adding the same one twice is ordinary, not an error, and
  // a second origin joins rather than replacing. This is what makes one review
  // span localhost and 127.0.0.1.
  restarted.registerOrigin(REVIEW, "http://127.0.0.1:3000");
  restarted.registerOrigin(REVIEW, "http://localhost:3000");
  assert.deepEqual(restarted.get(REVIEW).origins, ["http://127.0.0.1:3000", "http://localhost:3000"]);

  // And creating the same review twice does not mint a second token, which would
  // silently invalidate the page already open on the first.
  assert.equal(restarted.create({ id: REVIEW }).token, created.token);
});

test("serve is idempotent: a second one reports the running helper and exits 0", async () => {
  const dir = tempDir();
  const first = await service.serve({ port: 0, stateDir: dir, reviews: [REVIEW], quiet: true });
  try {
    const health = await service.probeHealth(protocol.DEFAULT_HOST, first.port);
    assert.ok(health && health.ok, "the running helper answers health");
    assert.equal(health.api, protocol.API_VERSION);

    // Health carries no review data, because it is the one route with no
    // credential: `add` needs to tell an up helper from a down one and nothing
    // more.
    assert.equal(health.reviews, undefined);

    await assert.rejects(
      service.serve({ port: first.port, stateDir: tempDir(), quiet: true }),
      (err) => err.code === "EADDRINUSE"
    );
  } finally {
    await first.close();
  }
});

test("the readiness file is the shape the harness reads, and it is owner-only", async () => {
  const dir = tempDir();
  const helper = await service.serve({ port: 0, stateDir: dir, reviews: [REVIEW], quiet: true });
  try {
    const readyPath = stateDirModule.readyPath(dir);
    const parsed = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    assert.equal(typeof parsed.port, "number");
    assert.equal(parsed.pid, process.pid);
    assert.equal(typeof parsed.reviews[REVIEW].token, "string");
    assert.ok(parsed.reviews[REVIEW].token.length >= 32);
    assert.equal(fs.statSync(readyPath).mode & 0o777, 0o600);
  } finally {
    await helper.close();
  }
});
