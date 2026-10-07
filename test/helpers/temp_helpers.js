// Stop the helper processes a test started in its own temp state dir, and prove
// none of them outlived the test run.
//
// WHY. `lahe session close` leaves the shared helper up while a review page is
// open or the Library polled recently, and a test closes its session with the
// page still open. Before the helper could stop itself, every such run left a
// `lahe serve` behind for good: one Mac collected 1,892 of them from test temp
// dirs, about 12 GB resident with swap full. So a test that starts a helper
// stops it, by name, here.
//
// SAFETY. These functions only ever touch a process whose command line names
// the given state dir, and only a state dir under the OS temp folder. Ken's
// real helper (port 7817, ~/.local/state/lahe) can never match.
//
// Two kinds of process count as "a helper" here:
//   - the shared helper, `bin/lahe.js serve ... --state-dir <dir>`
//   - a page server,      `src/service/static_servers.js --serve ... <dir> ...`
//
// POSIX only: the lookup reads `ps`. On Windows each function does nothing.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { pollUntil } = require("./poll.js");

function realOr(p) {
  try { return fs.realpathSync(p); } catch (err) { return p; }
}

/** Every spelling of the temp folder: macOS has /var and /private/var. */
function tempRoots() {
  const roots = new Set([os.tmpdir(), realOr(os.tmpdir())]);
  return Array.from(roots).map((r) => r.replace(/\/+$/, ""));
}

function isUnderTemp(dir) {
  return tempRoots().some((root) => dir === root || dir.indexOf(root + "/") === 0);
}

function isHelperCommand(command) {
  return /\bbin\/lahe\.js serve\b/.test(command) || /static_servers\.js --serve\b/.test(command);
}

/** [{pid, command}] for every process, or [] where ps is not available. */
function processes() {
  if (process.platform === "win32") return [];
  let out;
  try {
    out = execFileSync("ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return [];
  }
  return out
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), command: m[2] }))
    .filter((p) => p.pid !== process.pid);
}

/** Does this command line name the state dir as a whole path segment? */
function namesDir(command, dir) {
  const spellings = new Set([dir, realOr(dir)]);
  for (const s of spellings) {
    let from = 0;
    for (;;) {
      const at = command.indexOf(s, from);
      if (at === -1) break;
      const next = command.charAt(at + s.length);
      if (next === "" || next === " " || next === "/") return true;
      from = at + 1;
    }
  }
  return false;
}

function readPid(file) {
  try {
    const pid = JSON.parse(fs.readFileSync(file, "utf8")).pid;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (err) {
    return null;
  }
}

/**
 * The pids this state dir's own records name: the helper's service.json and
 * every page server record under agent-sessions/<id>/static-servers/.
 */
function recordedPids(dir) {
  const pids = [];
  const helper = readPid(path.join(dir, "service.json"));
  if (helper) pids.push(helper);
  const sessionsRoot = path.join(dir, "agent-sessions");
  let sessions = [];
  try { sessions = fs.readdirSync(sessionsRoot); } catch (err) { sessions = []; }
  sessions.forEach((session) => {
    const root = path.join(sessionsRoot, session, "static-servers");
    let names = [];
    try { names = fs.readdirSync(root); } catch (err) { names = []; }
    names
      .filter((name) => /^ss_[A-Za-z0-9_-]+\.json$/.test(name))
      .forEach((name) => {
        const pid = readPid(path.join(root, name));
        if (pid) pids.push(pid);
      });
  });
  return pids;
}

/**
 * Helper and page server pids this state dir's records name, kept only when
 * that process is still a helper on this same dir. A pid the OS has since
 * given to some other program is left alone.
 */
function helperPidsFor(stateDir) {
  const dir = path.resolve(stateDir).replace(/\/+$/, "");
  const recorded = new Set(recordedPids(dir));
  if (!recorded.size) return [];
  return processes()
    .filter((p) => recorded.has(p.pid) && isHelperCommand(p.command) && namesDir(p.command, dir))
    .map((p) => p.pid);
}

/** The state dir a helper or page server command line names, or null. */
function stateDirOf(command) {
  const flag = / --state-dir (\S+)/.exec(command);
  if (flag) return flag[1];
  // static_servers.js --serve <file> <session> <id> <instance> <root> <dir> ...
  const serve = /static_servers\.js --serve (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)/.exec(command);
  return serve ? serve[6] : null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

function signal(pids, sig) {
  pids.forEach((pid) => {
    try { process.kill(pid, sig); } catch (err) { /* already gone */ }
  });
}

/**
 * Stop every helper and page server started on this temp state dir, and wait
 * until each is gone. SIGTERM first, SIGKILL for anything still up after five
 * seconds. Throws if one survives both, so the leak fails the test that made it.
 *
 * Run it after the test's own `lahe session close`: the close is the product
 * path, this is the guarantee.
 *
 * @param {string} stateDir a state dir under the OS temp folder
 * @returns {Promise<number[]>} the pids it stopped
 */
async function stopTempHelpers(stateDir) {
  if (!stateDir) return [];
  const dir = path.resolve(stateDir);
  if (!isUnderTemp(dir) && !isUnderTemp(realOr(dir))) {
    throw new Error("stopTempHelpers refuses a state dir outside the temp folder: " + dir);
  }
  const pids = helperPidsFor(dir);
  if (!pids.length) return [];
  signal(pids, "SIGTERM");
  const gone = () => pids.every((pid) => !alive(pid));
  try {
    await pollUntil(gone, { timeoutMs: 5000, message: "the test's helpers to stop" });
  } catch (err) {
    signal(pids.filter(alive), "SIGKILL");
    await pollUntil(gone, {
      timeoutMs: 5000,
      message: "the test's helpers to die after SIGKILL",
      describe: () => ({ alive: pids.filter(alive) })
    });
  }
  return pids;
}

/**
 * A folder for one test run. The run's commands get it as TMPDIR, so every
 * temp state dir the run makes lives under it, and the survivor check counts
 * only helpers whose command line names it. Another run in the same checkout,
 * or a helper somebody started by hand, is never counted or touched.
 *
 * @returns {string} the run folder
 */
function makeRunRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-run-"));
}

/** Helpers and page servers whose command line names this run folder. */
function strayHelpers(runRoot) {
  if (!runRoot) throw new Error("strayHelpers needs the run folder");
  const spellings = Array.from(new Set([path.resolve(runRoot), realOr(runRoot)])).map((r) => r.replace(/\/+$/, ""));
  return processes().filter(
    (p) => isHelperCommand(p.command) && spellings.some((root) => p.command.indexOf(root + "/") !== -1)
  );
}

/**
 * After a whole run: every helper still running under this run's folder. It
 * waits up to `graceMs` for ones still shutting down, then stops what is left
 * through each one's own state dir records (stopTempHelpers), and returns the
 * list, so a failing check leaves nothing running behind it.
 *
 * @param {string} runRoot the folder from makeRunRoot
 * @returns {Promise<Array<{pid: number, command: string, stopped: boolean}>>}
 */
async function reapStrayHelpers(runRoot, graceMs) {
  const left = () => strayHelpers(runRoot);
  try {
    await pollUntil(() => left().length === 0, { timeoutMs: typeof graceMs === "number" ? graceMs : 5000, message: "no stray helpers" });
    return [];
  } catch (err) {
    const found = left();
    const dirs = new Set(found.map((p) => stateDirOf(p.command)).filter(Boolean));
    for (const dir of dirs) {
      try { await stopTempHelpers(dir); } catch (err2) { /* reported below as a survivor */ }
    }
    return found.map((p) => Object.assign({ stopped: !alive(p.pid) }, p));
  }
}

module.exports = {
  helperPidsFor,
  stopTempHelpers,
  makeRunRoot,
  strayHelpers,
  reapStrayHelpers
};
