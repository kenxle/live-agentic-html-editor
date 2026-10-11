// Helper processes a test spawned itself, stopped by pid in teardown.
//
// WHY. stopTempHelpers finds a helper by the pid its state folder's
// service.json records. A helper a test spawned a moment before teardown may
// not have written service.json yet, so under load teardown looked, found
// nothing, and the helper then finished starting and kept running. Tracking
// the spawned child's own pid closes that gap: it is known the moment the
// process exists.
//
// Use: const spawned = trackSpawned(t, stateDir); spawned.spawn(args).
// Teardown stops every tracked pid (SIGTERM, then SIGKILL), waits for each to
// be gone, and then runs stopTempHelpers on the state folder, even when the
// test failed.

"use strict";

const childProcess = require("node:child_process");

const { pollUntil } = require("./poll.js");
const { stopTempHelpers } = require("./temp_helpers.js");

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

async function stopPid(pid) {
  if (!alive(pid)) return;
  try { process.kill(pid, "SIGTERM"); } catch (err) { /* already gone */ }
  try {
    await pollUntil(() => !alive(pid), { timeoutMs: 5000, message: "spawned helper " + pid + " to stop" });
  } catch (err) {
    try { process.kill(pid, "SIGKILL"); } catch (e) { /* already gone */ }
    await pollUntil(() => !alive(pid), { timeoutMs: 5000, message: "spawned helper " + pid + " to die after SIGKILL" });
  }
}

/**
 * @param {object} t the node:test context
 * @param {string} stateDir the temp state folder the helpers use
 * @returns {{spawn: function(string[]): object, pids: number[]}}
 */
function trackSpawned(t, stateDir) {
  const pids = [];
  t.after(async () => {
    for (const pid of pids) await stopPid(pid);
    await stopTempHelpers(stateDir);
  });
  return {
    pids,
    spawn(args) {
      const child = childProcess.spawn(process.execPath, args, { detached: true, stdio: "ignore" });
      pids.push(child.pid);
      child.unref();
      return child;
    }
  };
}

module.exports = { trackSpawned };
