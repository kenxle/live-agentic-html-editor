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

test("one session per review, refused without disclosing the holder, taken over when the heartbeat goes quiet", () => {
  const dir = tempDir();
  let now = 1000000;
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => now });
  reviews.create({ id: REVIEW });

  const first = reviews.claimWindow(REVIEW, { window_id: "w1" });
  assert.equal(first.granted, true);
  assert.equal(first.heartbeat_seconds, reviewsModule.HEARTBEAT_SECONDS);
  // The grant hands the holder a session secret, and that is the only thing that
  // proves possession afterwards.
  assert.equal(typeof first.session_secret, "string");
  assert.ok(first.session_secret.length > 0);

  // A second window, while the first is alive, is refused. The refusal discloses
  // NOTHING about the holder: not its window id, not its secret.
  const second = reviews.claimWindow(REVIEW, { window_id: "w2" });
  assert.equal(second.granted, false);
  assert.equal(second.holder, undefined, "the holder's window id must not leak in a refusal");
  assert.equal(second.session_secret, undefined, "the holder's secret must never leak");
  assert.match(second.reason, /already open in another window/);

  // The first window's heartbeat keeps it alive, and the heartbeat is the SECRET,
  // not the window id.
  now += 20000;
  assert.equal(reviews.claimWindow(REVIEW, { window_id: "w1", session_secret: first.session_secret }).granted, true);
  assert.equal(reviews.claimWindow(REVIEW, { window_id: "w2" }).granted, false);

  // Then the first window's tab dies. After the stale window, the second one
  // TAKES OVER rather than being locked out: a reviewer shut out of their own
  // review after a crash is a work-losing outcome.
  now += reviewsModule.STALE_AFTER_MS + 1;
  const takeover = reviews.claimWindow(REVIEW, { window_id: "w2" });
  assert.equal(takeover.granted, true);
  assert.equal(takeover.took_over, true);
  assert.equal(typeof takeover.session_secret, "string");
  assert.notEqual(takeover.session_secret, first.session_secret, "a takeover mints a fresh secret");
  assert.equal(reviews.holderOf(REVIEW).window_id, "w2");

  // And now the roles are reversed: the old holder's OLD secret is refused, because
  // the takeover minted a new one.
  assert.equal(reviews.claimWindow(REVIEW, { window_id: "w1", session_secret: first.session_secret }).granted, false);
});

test("finding 3: a rival that knows the holder's window id but not its secret is refused, not fed the heartbeat", () => {
  const dir = tempDir();
  let now = 1000000;
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => now });
  reviews.create({ id: REVIEW });

  const holder = reviews.claimWindow(REVIEW, { window_id: "holder-win" });
  assert.equal(holder.granted, true);

  // The rival presents the holder's exact window id (as if it had been disclosed
  // in a 409 body, which is exactly what used to happen). Without the secret it
  // is NOT the holder: it is refused, and it cannot bump the holder's last_seen.
  now += 5000;
  const rival = reviews.claimWindow(REVIEW, { window_id: "holder-win" });
  assert.equal(rival.granted, false, "presenting the holder's id is not proof of being the holder");

  // The rival's rejected claim must not have refreshed the holder's liveness. The
  // real holder proves itself with the secret only it holds.
  const stillHolder = reviews.claimWindow(REVIEW, { window_id: "holder-win", session_secret: holder.session_secret });
  assert.equal(stillHolder.granted, true);
});

test("NEW-3: a corrupt meta.json on restart is recovered from the log, loudly, not silently dropped", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const created = reviews.create({ id: REVIEW, origins: ["http://127.0.0.1:3000"] });

  // Corrupt the meta.json the way an interrupted write or a bad disk would.
  fs.writeFileSync(stateDirModule.metaPath(dir, REVIEW), "{ this is not json");

  // A loud startup error must reach the operator, not just a quiet diagnostic.
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let restarted;
  try {
    restarted = reviewsModule.createReviews({ dir: dir, log: logModule.createEventLog({ dir: dir }) });
    restarted.loadFromDisk();
  } finally {
    console.error = originalError;
  }

  // The review is NOT silently de-registered: it is recovered from the log, with
  // the same token the page still holds, so its edits stay reachable.
  assert.ok(restarted.get(REVIEW), "the review is recovered, not dropped");
  assert.equal(restarted.get(REVIEW).token, created.token);
  assert.deepEqual(restarted.get(REVIEW).origins, ["http://127.0.0.1:3000"]);
  assert.ok(
    errors.some((line) => /STARTUP ERROR/.test(line) && line.includes(REVIEW)),
    "the operator sees a loud startup error naming the review"
  );
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

test("a review minted after the helper started is learned from disk, and a bogus one still is not", () => {
  const dir = tempDir();
  // `add` runs in its own process, so the review it writes is written by a
  // registry the running helper knows nothing about. That is what these two are.
  const helperSide = reviewsModule.createReviews({ dir: dir, log: logModule.createEventLog({ dir: dir }) });
  const addSide = reviewsModule.createReviews({ dir: dir, log: logModule.createEventLog({ dir: dir }) });
  helperSide.writeReadyFile({ port: 7817 });

  const minted = addSide.create({ id: "r-after-start", origins: ["null"] });
  assert.equal(helperSide.get("r-after-start"), null, "the helper does not hold it: it started first");

  const learned = helperSide.ensureKnown("r-after-start");
  assert.ok(learned, "asked about it once, the helper finds it on disk");
  assert.equal(learned.token, minted.token, "with the token it was minted with, not a new one");
  assert.deepEqual(learned.origins, ["null"]);

  // The readiness file is how `lahe wait` and anything else on the machine finds
  // a token, so learning a review has to show up there too.
  const ready = JSON.parse(fs.readFileSync(path.join(dir, "service.json"), "utf8"));
  assert.equal(ready.reviews["r-after-start"].token, minted.token);

  // Nothing on disk is still nothing. A rescan is a look, never a grant.
  assert.equal(helperSide.ensureKnown("r-not-real"), null);
  assert.equal(helperSide.get("r-not-real"), null);
  assert.equal(helperSide.ensureKnown("../etc"), null, "and an unsafe id never becomes a path");
});

test("hammering unknown review ids does not rescan the disk every time", () => {
  const dir = tempDir();
  let now = 1000;
  const helperSide = reviewsModule.createReviews({
    dir: dir,
    log: logModule.createEventLog({ dir: dir }),
    now: () => now
  });
  const addSide = reviewsModule.createReviews({ dir: dir, log: logModule.createEventLog({ dir: dir }) });

  // The look is triggered by a request that has proved nothing yet, so it is
  // bounded. Whether it happened is observable: the review appears on disk
  // BETWEEN two asks, and an ask that really looked would find it.
  assert.equal(helperSide.ensureKnown("r-hammered"), null, "the first ask looked, and there was nothing");
  addSide.create({ id: "r-hammered", origins: ["null"] });

  for (let i = 0; i < 50; i += 1) {
    assert.equal(helperSide.ensureKnown("r-hammered"), null, "no look inside the interval, however hard it is asked");
  }

  now += reviewsModule.RESCAN_INTERVAL_MS + 1;
  assert.ok(helperSide.ensureKnown("r-hammered"), "and the interval later, one look, which finds it");
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
