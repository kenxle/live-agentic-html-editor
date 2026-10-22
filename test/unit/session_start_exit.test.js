// `startHelper` in session.js spawns the helper and waits for it to answer. A
// helper that exits before it answers (its port taken, a bad state folder) is
// reported at once, with its exit status, instead of after the whole wait as
// "did not start". The wait itself matches add.js: 15 seconds, so a slow
// machine is not told a start failed while the helper is still coming up.
//
// The port is held by a plain HTTP server that answers 500, so the health probe
// gets a fast "not a helper" and the spawned helper exits on EADDRINUSE. The
// helper stops itself; t.after stops one by its state folder's pid regardless.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const sessionCommand = require("../../src/cli/commands/session.js");

test("a helper that exits before it answers is reported at once, with its exit status", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-session-start-exit-"));
  const holder = http.createServer((req, res) => { res.statusCode = 500; res.end(); });
  await new Promise((resolve) => holder.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { holder.close(resolve); holder.closeAllConnections(); }));
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });
  const port = holder.address().port;

  const began = Date.now();
  await assert.rejects(sessionCommand.startHelper(dir, port), (err) => {
    assert.match(err.message, /the helper exited \(\d+\) before it answered on 127\.0\.0\.1:\d+/);
    assert.match(err.message, /lahe serve/, "it says how to see why");
    return true;
  });
  assert.ok(Date.now() - began < 10000, "said when the helper exited, not at the end of the wait");
});

test("the helper start waits as long as add.js does", () => {
  assert.equal(sessionCommand.HELPER_START_WAIT_MS, 15000);
});
