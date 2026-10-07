// The survivor check counts only its own run (test/helpers/temp_helpers.js).
//
// Each test run gets its own TMPDIR folder, and the check counts only helpers
// whose command line names that folder. A helper from another run in the same
// checkout, or one somebody started by hand, is never counted and never
// stopped. Real helpers on free ports and temp state dirs, never 7817.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stateDir = require("../../src/service/state_dir.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const { onFreePort } = require("../helpers/free_port.js");
const { makeRunRoot, strayHelpers, reapStrayHelpers, stopTempHelpers } = require("../helpers/temp_helpers.js");

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== "ESRCH"; }
}

async function helperIn(root) {
  const dir = path.join(fs.mkdtempSync(path.join(root, "lahe-stray-")), "state");
  await onFreePort((p) => sessionCommand.startHelper(dir, p));
  return { dir, pid: JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8")).pid };
}

test("the survivor check counts and stops only its own run's helpers", { skip: process.platform === "win32" }, async (t) => {
  const ours = makeRunRoot();
  const elsewhere = makeRunRoot();
  const outside = await helperIn(elsewhere);
  t.after(() => stopTempHelpers(outside.dir));
  assert.deepEqual(strayHelpers(ours), [], "a helper outside the run is not counted");
  assert.deepEqual(await reapStrayHelpers(ours, 200), [], "and the run passes");
  assert.ok(alive(outside.pid), "and it is left running");

  const inside = await helperIn(ours);
  t.after(() => stopTempHelpers(inside.dir));
  assert.deepEqual(strayHelpers(ours).map((p) => p.pid), [inside.pid], "only the run's own helper counts");
  const left = await reapStrayHelpers(ours, 200);
  assert.deepEqual(left.map((p) => [p.pid, p.stopped]), [[inside.pid, true]], "it is reported and stopped");
  assert.equal(alive(inside.pid), false);
  assert.ok(alive(outside.pid), "the other run's helper is still untouched");
});
