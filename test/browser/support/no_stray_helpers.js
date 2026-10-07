// Playwright global setup and teardown: the browser suite fails if a helper or
// page server it started on a temp state dir is still running at the end.
//
// See test/helpers/temp_helpers.js for why (1,892 leaked helpers on one Mac)
// and for the rules: only processes started from this checkout, on a state dir
// under the temp folder, and new since the run began. Survivors are stopped
// through their own state dir's records before the run is failed, so a red
// check leaves nothing behind.

"use strict";

const { snapshotStrayHelpers, reapStrayHelpers } = require("../../helpers/temp_helpers.js");

module.exports = async function globalSetup() {
  const before = snapshotStrayHelpers();
  return async function globalTeardown() {
    const left = await reapStrayHelpers(before);
    if (left.length) {
      throw new Error(
        left.length + " helper process" + (left.length === 1 ? "" : "es") +
          " from this run outlived the browser suite. A test that starts a helper stops it " +
          "(test/helpers/temp_helpers.js stopTempHelpers):\n" +
          left.map((p) => "  " + p.pid + (p.stopped ? " (now stopped) " : " (STILL RUNNING) ") + p.command).join("\n")
      );
    }
  };
};
