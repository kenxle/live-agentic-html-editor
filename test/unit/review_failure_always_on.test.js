// A failed `lahe review` on a fresh session closes that session, and used to
// stop the helper when no other session was open, with no check for an
// always-on helper. On an installed helper that took every page down until
// the login item restarted it. It now asks the same question `session close`
// asks (session.helperStillWanted), and leaves an always-on helper up.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

const service = require("../../src/service/index.js");
const { tempRoot, writeFile } = require("../helpers/sites_world.js");
const { freePort } = require("../helpers/free_port.js");
const { pollUntil } = require("../helpers/poll.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");

async function helperAndFailingReview(t, extraArgs) {
  const root = tempRoot("lahe-review-fail-");
  const dir = path.join(root, "state");
  fs.mkdirSync(dir);
  const port = await freePort();
  t.after(() => stopTempHelpers(dir));
  const env = Object.assign({}, process.env, { LAHE_PAGES_PORT: "0" });
  const child = spawn(process.execPath, [BIN, "serve", "--port", String(port), "--state-dir", dir].concat(extraArgs), {
    detached: true, stdio: "ignore", env
  });
  child.unref();
  await pollUntil(() => service.probeHealth("127.0.0.1", port), { timeoutMs: 15000, message: "the helper to answer" });
  // A page inside the state folder: the review is made, then site.bind
  // refuses the root, so the command fails on a session it just created.
  const page = writeFile(dir, "inside/page.html", "<!doctype html><p>x</p>");
  const out = await new Promise((resolve) => {
    execFile(process.execPath, [BIN, "review", page, "--port", String(port), "--state-dir", dir], { env, encoding: "utf8" },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  return { out, port };
}

test("a failed lahe review leaves an always-on helper running", async (t) => {
  const r = await helperAndFailingReview(t, ["--always-on"]);
  assert.notEqual(r.out.code, 0, "the review failed, as set up");
  assert.match(r.out.stderr, /state folder is never served/);
  assert.ok(await service.probeHealth("127.0.0.1", r.port), "the always-on helper still answers");
});

test("a failed lahe review still stops a plain clone's helper when no session is open", async (t) => {
  const r = await helperAndFailingReview(t, []);
  assert.notEqual(r.out.code, 0);
  assert.equal(await service.probeHealth("127.0.0.1", r.port), null);
});
