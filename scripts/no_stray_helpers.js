// Run a test command, then fail if a helper or page server it started on a
// temp state dir is still running.
//
//   node scripts/no_stray_helpers.js [--limit-minutes N] node --test test/unit/
//
// With --limit-minutes, a run still going after N minutes is stopped, with
// everything it started, and fails. One stuck test once held the unit run for
// a day, because nothing in the chain had a deadline (LAHE-unit-run-timeout).
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
 * Split the wrapper's own flag from the command. Only a flag BEFORE the
 * command is the wrapper's; anything after belongs to the command.
 *
 * @param {string[]} argv
 * @returns {{limitMs: number|null, command: string[]}}
 */
function parseArgs(argv) {
  if (argv[0] === "--limit-minutes") {
    const minutes = Number(argv[1]);
    if (!(minutes > 0)) throw new Error("--limit-minutes takes a number of minutes above 0, not " + JSON.stringify(argv[1]));
    return { limitMs: minutes * 60000, command: argv.slice(2) };
  }
  return { limitMs: null, command: argv };
}

/**
 * Signal the child's whole process group (POSIX), or the child alone
 * (Windows, which has no process groups here: the test files `node --test`
 * started there are left to end on their own).
 */
function signalRun(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (e) {
    // Already gone.
  }
}

/**
 * @param {string[]} argv the command and its arguments
 * @param {{graceMs?: number, limitMs?: number, onRunRoot?: function(string): void,
 *          out?: function(string): void, err?: function(string): void}} [options]
 *   graceMs is how long to wait for helpers still shutting down; limitMs is
 *   how long the command may run before it is stopped and fails; onRunRoot is
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
  // Every helper a test starts serves pages on its own free port, never 1483:
  // parallel test files would otherwise fight over it, and Ken's own helper
  // holds it. A test that needs a fixed pages port names one itself.
  if (env.LAHE_PAGES_PORT === undefined) env.LAHE_PAGES_PORT = "0";
  const limitMs = opts.limitMs || null;
  const code = await new Promise((resolve) => {
    // Its own process group, so a stop at the limit reaches the test files
    // `node --test` runs as children of its own. Helpers detach into groups
    // of their own and are left to the survivor check below.
    const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", env, detached: process.platform !== "win32" });
    // A child in its own group no longer gets the terminal's Ctrl-C, so pass
    // it on, and let the survivor check run once the child has gone.
    const forward = (signal) => signalRun(child, signal);
    // SIGHUP too: a closed terminal used to take the run with it.
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    signals.forEach((s) => process.on(s, forward));
    let limitTimer = null;
    let killTimer = null;
    let overLimit = false;
    if (limitMs) {
      limitTimer = setTimeout(() => {
        overLimit = true;
        err(
          "\nno_stray_helpers: the run passed its limit of " + Math.round(limitMs / 1000) + " seconds and was stopped. " +
            "The last `# Subtest:` line above with no `ok` after it names the test that was still running.\n"
        );
        signalRun(child, "SIGTERM");
        killTimer = setTimeout(() => signalRun(child, "SIGKILL"), 2000);
      }, limitMs);
    }
    const done = (value) => {
      clearTimeout(limitTimer);
      clearTimeout(killTimer);
      signals.forEach((s) => process.removeListener(s, forward));
      // What the run started in its own group goes with it, even when the
      // command itself exited first.
      if (overLimit) signalRun(child, "SIGKILL");
      resolve(overLimit ? 1 : value);
    };
    child.on("error", (e) => {
      err("no_stray_helpers: " + e.message + "\n");
      done(1);
    });
    child.on("exit", (exitCode, signal) => done(signal ? 1 : exitCode));
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

module.exports = { main, parseArgs };

if (require.main === module) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write("no_stray_helpers: " + e.message + "\n");
    process.exit(2);
  }
  main(parsed.command, { limitMs: parsed.limitMs }).then((code) => {
    process.exitCode = code;
  });
}
