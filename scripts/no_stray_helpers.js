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
//
// The run's temp folder is removed at the end, since one unit run leaves about
// 600 MB in it. It is kept when a helper survived, and its path is printed.

"use strict";

const { spawn } = require("node:child_process");
const { makeRunRoot, reapStrayHelpers, removeRunRoot } = require("../test/helpers/temp_helpers.js");

/**
 * @param {string[]} argv the command and its arguments
 * @param {{graceMs?: number, onRunRoot?: function(string): void,
 *          out?: function(string): void, err?: function(string): void}} [options]
 *   graceMs is how long to wait for helpers still shutting down; onRunRoot is
 *   called with the run folder before the command starts; out and err take the
 *   wrapper's own messages (they default to stdout and stderr).
 * @returns {Promise<number>} the exit code
 */
async function main(argv, options) {
  const opts = options || {};
  const out = opts.out || ((text) => process.stdout.write(text));
  const err = opts.err || ((text) => process.stderr.write(text));
  if (!argv.length) {
    err("usage: node scripts/no_stray_helpers.js <command> [args...]\n");
    return 2;
  }
  // The run's own temp folder: everything the run starts lives under it, and
  // only what names it is counted.
  const runRoot = makeRunRoot();
  if (opts.onRunRoot) opts.onRunRoot(runRoot);
  const env = Object.assign({}, process.env, { TMPDIR: runRoot, TMP: runRoot, TEMP: runRoot });
  const code = await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", env });
    child.on("error", (e) => {
      err("no_stray_helpers: " + e.message + "\n");
      resolve(1);
    });
    child.on("exit", (exitCode, signal) => resolve(signal ? 1 : exitCode));
  });
  const left = await reapStrayHelpers(runRoot, opts.graceMs);
  const outcome = removeRunRoot(runRoot, left);
  if (left.length) {
    err(
      "\nno_stray_helpers: " + left.length + " helper process" + (left.length === 1 ? "" : "es") +
        " from this run outlived it. A test that starts a helper stops it " +
        "(test/helpers/temp_helpers.js stopTempHelpers):\n" +
        left.map((p) => "  " + p.pid + (p.stopped ? " (now stopped) " : " (STILL RUNNING) ") + p.command).join("\n") + "\n" +
        "no_stray_helpers: kept the run folder as evidence: " + outcome.kept + "\n"
    );
    return code || 1;
  }
  out("no_stray_helpers: no helper from this run is still running\n");
  return code;
}

module.exports = { main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
