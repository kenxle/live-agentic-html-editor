// Run a test command, then fail if a helper or page server it started on a
// temp state dir is still running.
//
//   node scripts/no_stray_helpers.js node --test test/unit/
//
// This is the unit suite's survivor check; the browser suite has the same
// check as a Playwright global teardown (test/browser/support/no_stray_helpers.js).
// See test/helpers/temp_helpers.js for why and for exactly which processes
// count: only helpers whose command line names this run's own TMPDIR. The exit code is the command's own when it failed, 1 when it passed
// but left a helper running, and 0 otherwise.

"use strict";

const { spawn } = require("node:child_process");
const { makeRunRoot, reapStrayHelpers } = require("../test/helpers/temp_helpers.js");

async function main(argv) {
  if (!argv.length) {
    process.stderr.write("usage: node scripts/no_stray_helpers.js <command> [args...]\n");
    return 2;
  }
  // The run's own temp folder: everything the run starts lives under it, and
  // only what names it is counted.
  const runRoot = makeRunRoot();
  const env = Object.assign({}, process.env, { TMPDIR: runRoot, TMP: runRoot, TEMP: runRoot });
  const code = await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", env });
    child.on("error", (err) => {
      process.stderr.write("no_stray_helpers: " + err.message + "\n");
      resolve(1);
    });
    child.on("exit", (exitCode, signal) => resolve(signal ? 1 : exitCode));
  });
  const left = await reapStrayHelpers(runRoot);
  if (left.length) {
    process.stderr.write(
      "\nno_stray_helpers: " + left.length + " helper process" + (left.length === 1 ? "" : "es") +
        " from this run outlived it. A test that starts a helper stops it " +
        "(test/helpers/temp_helpers.js stopTempHelpers):\n" +
        left.map((p) => "  " + p.pid + (p.stopped ? " (now stopped) " : " (STILL RUNNING) ") + p.command).join("\n") + "\n"
    );
    return code || 1;
  }
  process.stdout.write("no_stray_helpers: no helper from this run is still running\n");
  return code;
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
