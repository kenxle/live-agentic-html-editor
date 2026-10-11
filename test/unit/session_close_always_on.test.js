// `lahe session close` leaves an always-on helper running (stable addresses,
// Step 3). An installed helper serves every page at its stable address, so
// stopping it on the last close would take every page down until the login
// item restarted it. The close skips both the stop and the stop-when-quiet
// request when the helper reports always_on, or the state folder records an
// install for this port. A plain clone's helper still stops as before.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../../src/service/index.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const stateDir = require("../../src/service/state_dir.js");
const { spawn } = require("node:child_process");
const { tempRoot } = require("../helpers/sites_world.js");
const { freePort } = require("../helpers/free_port.js");
const { pollUntil } = require("../helpers/poll.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");

/** A real helper process on free ports, stopped in teardown even on failure. */
async function closeLast(t, extraArgs) {
  const dir = path.join(tempRoot("lahe-close-always-on-"), "state");
  const port = await freePort();
  t.after(() => stopTempHelpers(dir));
  const child = spawn(process.execPath, [BIN, "serve", "--port", String(port), "--state-dir", dir].concat(extraArgs), {
    detached: true, stdio: "ignore", env: Object.assign({}, process.env, { LAHE_PAGES_PORT: "0" })
  });
  child.unref();
  await pollUntil(() => service.probeHealth("127.0.0.1", port), { timeoutMs: 15000, message: "the helper to answer" });
  agentSessions.createStore({ dir }).create({ id: "s_last" });
  const out = [];
  const code = await sessionCommand.run(["close", "s_last", "--state-dir", dir, "--port", String(port)], {
    stdout: (x) => out.push(x), stderr: (x) => out.push(x), now: Date.now()
  });
  return { code, text: out.join(""), dir, port };
}

test("the last close leaves an always-on helper up, and asks nothing of it", async (t) => {
  const r = await closeLast(t, ["--always-on"]);
  assert.equal(r.code, 0, r.text);
  assert.ok(await service.probeHealth("127.0.0.1", r.port), "the helper still answers");
  assert.equal(fs.existsSync(stateDir.stopWhenQuietPath(r.dir)), false, "no stop-when-quiet request");
  assert.match(r.text, /shared helper left running: it is always on/);
});

test("the last close still stops a plain clone's helper", async (t) => {
  const r = await closeLast(t, []);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /shared helper stopped/);
});
