// Self-test for the service helpers: start, readiness, and kill -9.
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
  makeStateDir,
  readReadyFile,
  readEventLog,
  tcpProbe,
  processAlive
} = require("../helpers/service");

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

test("what was written before kill -9 is still on disk after it", async () => {
  const stateDir = makeStateDir();
  const service = await startService({
    entry: STUB_SERVICE_ENTRY,
    stateDir,
    allowedOrigins: ["http://127.0.0.1:1"]
  });

  const res = await fetch(service.url + "/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "http://127.0.0.1:1",
      "x-lahe-token": service.token,
      "x-lahe-request": "1"
    },
    body: JSON.stringify({ kind: "note", text: "written before the kill" })
  });
  assert.equal(res.status, 200);

  await service.kill9();

  const log = readEventLog(stateDir);
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.text, "written before the kill");
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
      const res = await fetch(service.url + "/items", {
        method: "POST",
        headers: testCase.headers,
        body: JSON.stringify({ forged: testCase.name })
      });
      assert.equal(res.status, 403, testCase.name + " should be refused");
    }

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
