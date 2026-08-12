// Self-test for the service helpers: start, readiness, per-review credentials,
// suspend, and kill -9.
//
// Node-side only, so it runs in the unit suite rather than in Playwright.
//
// The readiness assertion is the load-bearing one. A helper that returns as soon
// as it spawned the process makes every durability test race, and a race in a
// durability test is worse than no test: it fails intermittently, someone adds a
// wait, and the assertion quietly stops meaning anything.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  startService,
  STUB_SERVICE_ENTRY,
  SERVICE_ENTRY,
  SERVICE_READY_FILE,
  DEFAULT_REVIEW_ID,
  makeStateDir,
  readReadyFile,
  readEventLog,
  eventLogPath,
  listReviewDirs,
  tcpProbe,
  processAlive,
  processState
} = require("../helpers/service");

function postItem(service, reviewId, body, overrides = {}) {
  return fetch(service.itemsUrlFor(reviewId), {
    method: "POST",
    headers: Object.assign(
      {
        "Content-Type": "application/json",
        "Origin": "http://127.0.0.1:1",
        "x-lahe-token": service.tokenFor(reviewId),
        "x-lahe-request": "1"
      },
      overrides
    ),
    body: JSON.stringify(body)
  });
}

test("startService waits for the ready file AND for the port to answer", async () => {
  const stateDir = makeStateDir();
  const service = await startService({ entry: STUB_SERVICE_ENTRY, stateDir });
  try {
    const ready = readReadyFile(stateDir);
    assert.ok(ready, SERVICE_READY_FILE + " should exist once startService returns");
    assert.equal(ready.port, service.port);
    assert.equal(ready.pid, service.pid);
    assert.ok(await tcpProbe(service.port), "the port should be answering");

    // Owner only. The log and the token must not be readable by anyone else on
    // the machine (architecture D11).
    const mode = fs.statSync(path.join(stateDir, SERVICE_READY_FILE)).mode & 0o777;
    assert.equal(mode, 0o600, "the ready file should be mode 0600, got " + mode.toString(8));
  } finally {
    await service.kill9();
  }
});

test("the service answers /health while it is up", async () => {
  const stateDir = makeStateDir();
  const service = await startService({ entry: STUB_SERVICE_ENTRY, stateDir });
  try {
    const res = await fetch(service.url + "/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.pid, service.pid);
  } finally {
    await service.kill9();
  }
});

test("kill9 leaves the process reaped and the port refusing", async () => {
  const stateDir = makeStateDir();
  const service = await startService({ entry: STUB_SERVICE_ENTRY, stateDir });

  assert.ok(processAlive(service.pid));
  await service.kill9();

  assert.equal(processAlive(service.pid), false, "the process should be gone");
  assert.equal(await tcpProbe(service.port, "127.0.0.1", 300), false, "the port should refuse");

  await assert.rejects(function () {
    return fetch(service.url + "/health");
  }, "a request after kill -9 should fail to connect");
});

test("the ready file carries a token per review, not one for the machine", async () => {
  const stateDir = makeStateDir();
  const service = await startService({
    entry: STUB_SERVICE_ENTRY,
    stateDir,
    reviews: ["alpha", "beta"],
    allowedOrigins: ["http://127.0.0.1:1"]
  });

  try {
    assert.deepEqual(service.reviewIds.sort(), ["alpha", "beta"]);
    assert.notEqual(service.tokenFor("alpha"), service.tokenFor("beta"));

    // With two reviews open there is no such thing as "the" token. Reading one
    // has to name a review; guessing would let a test authenticate against the
    // wrong review and pass for the wrong reason.
    assert.throws(function () {
      return service.token;
    }, /holding 2 reviews/);
    assert.throws(function () {
      return service.tokenFor("gamma");
    }, /no review named 'gamma'/);

    // And the credential really is scoped: alpha's token cannot write to beta.
    const crossed = await fetch(service.itemsUrlFor("beta"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://127.0.0.1:1",
        "x-lahe-token": service.tokenFor("alpha"),
        "x-lahe-request": "1"
      },
      body: JSON.stringify({ forged: "cross-review" })
    });
    assert.equal(crossed.status, 403);
    assert.equal(readEventLog(stateDir, "beta").length, 0);

    assert.equal((await postItem(service, "alpha", { text: "alpha's own" })).status, 200);
    assert.equal(readEventLog(stateDir, "alpha").length, 1);
    assert.equal(readEventLog(stateDir, "beta").length, 0);
  } finally {
    await service.kill9();
  }
});

test("readEventLog reads reviews/<id>/events.jsonl, and says so when the id is ambiguous", async () => {
  const stateDir = makeStateDir();
  const service = await startService({
    entry: STUB_SERVICE_ENTRY,
    stateDir,
    reviews: ["alpha", "beta"],
    allowedOrigins: ["http://127.0.0.1:1"]
  });

  try {
    await postItem(service, "alpha", { text: "one" });

    assert.equal(
      eventLogPath(stateDir, "alpha"),
      path.join(stateDir, "reviews", "alpha", "events.jsonl"),
      "the path is the one the architecture names, not the old flat events.log"
    );
    assert.ok(fs.existsSync(eventLogPath(stateDir, "alpha")));
    assert.equal(fs.existsSync(path.join(stateDir, "events.log")), false);
    assert.deepEqual(listReviewDirs(stateDir), ["alpha", "beta"]);

    // The reader that every refusal assertion runs through must never quietly
    // read a path that cannot have anything in it. An empty array is exactly
    // what a passing refusal assertion looks like, so ambiguity throws.
    assert.throws(function () {
      return readEventLog(stateDir);
    }, /holds 2 reviews/);
  } finally {
    await service.kill9();
  }
});

test("what was written before kill -9 is still on disk after it", async () => {
  const stateDir = makeStateDir();
  const service = await startService({
    entry: STUB_SERVICE_ENTRY,
    stateDir,
    allowedOrigins: ["http://127.0.0.1:1"]
  });

  const res = await postItem(service, undefined, { kind: "note", text: "written before the kill" });
  assert.equal(res.status, 200);

  await service.kill9();

  const log = readEventLog(stateDir);
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.text, "written before the kill");
  assert.equal(log[0].review, DEFAULT_REVIEW_ID);
});

test("suspend stops the helper answering without killing it, and resume delivers what queued", async () => {
  const stateDir = makeStateDir();
  const service = await startService({
    entry: STUB_SERVICE_ENTRY,
    stateDir,
    allowedOrigins: ["http://127.0.0.1:1"]
  });

  try {
    await service.suspend();
    assert.equal(service.alive(), true, "SIGSTOP must not kill it");
    assert.equal(service.suspended(), true, "the OS should report it stopped");
    assert.equal(processState(service.pid), "T");

    // The socket is still accepted, so the request does not fail fast the way it
    // does against a dead helper. It hangs. That difference is the whole reason
    // this helper exists: a sync client written only against kill9 blocks the
    // reviewer here.
    const hung = fetch(service.url + "/health", { signal: AbortSignal.timeout(400) });
    await assert.rejects(function () {
      return hung;
    }, "a suspended helper accepts the connection and never answers");
    assert.ok(await tcpProbe(service.port), "the port is still open while suspended");

    await service.resume();
    assert.equal(service.suspended(), false);

    const res = await fetch(service.url + "/health");
    assert.equal(res.status, 200);

    // And it is the same process, still holding the same credentials.
    const body = await res.json();
    assert.equal(body.pid, service.pid);
    assert.equal((await postItem(service, undefined, { text: "after the resume" })).status, 200);
    assert.equal(readEventLog(stateDir).length, 1);
  } finally {
    await service.kill9();
  }
});

test("a refused write appends nothing, so cross-origin tests can assert on effect", async () => {
  const stateDir = makeStateDir();
  const service = await startService({
    entry: STUB_SERVICE_ENTRY,
    stateDir,
    allowedOrigins: ["http://127.0.0.1:1"]
  });

  try {
    const cases = [
      { name: "no origin", headers: { "Content-Type": "application/json", "x-lahe-token": service.token, "x-lahe-request": "1" } },
      { name: "wrong origin", headers: { "Content-Type": "application/json", "Origin": "http://evil.test", "x-lahe-token": service.token, "x-lahe-request": "1" } },
      { name: "simple content type", headers: { "Content-Type": "text/plain", "Origin": "http://127.0.0.1:1" } },
      { name: "no custom header", headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:1", "x-lahe-token": service.token } },
      { name: "bad token", headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:1", "x-lahe-token": "guessed", "x-lahe-request": "1" } }
    ];

    for (const testCase of cases) {
      const res = await fetch(service.itemsUrl, {
        method: "POST",
        headers: testCase.headers,
        body: JSON.stringify({ forged: testCase.name })
      });
      assert.equal(res.status, 403, testCase.name + " should be refused");
    }

    // An unknown review is refused before any check that could tell an attacker
    // whether the review exists, and it writes nothing anywhere.
    const unknown = await fetch(service.url + "/reviews/no-such-review/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://127.0.0.1:1",
        "x-lahe-token": service.token,
        "x-lahe-request": "1"
      },
      body: JSON.stringify({ forged: "unknown review" })
    });
    assert.equal(unknown.status, 403);
    assert.deepEqual(listReviewDirs(stateDir), [DEFAULT_REVIEW_ID]);

    assert.equal(readEventLog(stateDir).length, 0, "no refusal may leave a trace in the log");
  } finally {
    await service.kill9();
  }
});

test("startService names the real service entry, so the swap is one constant", () => {
  // Not a behavior test. It records where the swap happens: point the tests'
  // `entry` at SERVICE_ENTRY once src/service/index.js is a real server that
  // honors the readiness contract in test/helpers/service.js.
  assert.match(SERVICE_ENTRY, /src[\\/]service[\\/]index\.js$/);
  assert.match(STUB_SERVICE_ENTRY, /test[\\/]fixtures[\\/]servers[\\/]stub-service\.js$/);
});
