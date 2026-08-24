// Is anything on this machine holding a file open?
//
// WHY THIS EXISTS. The helper is local, so it can ask questions a web server
// never could. An agent host that arms `tail -n 0 -f wake.log` is the wake
// channel we WANT (a file tail catches every line and costs no model tokens),
// but until now it left no trace the helper could read, so a session that was
// armed all afternoon looked identical to one nobody had ever opened. The trace
// is there; it is just held by the kernel rather than written to disk:
//
//   $ lsof ~/.local/state/lahe/agent-sessions/s_926c.../wake.log
//   tail (pid 52312)
//
// WHY AN OPEN HANDLE IS STRONG EVIDENCE, AND NOT A GUESS. The file is ours. It
// lives at <state-dir>/agent-sessions/<id>/wake.log, we created it, it exists
// for exactly one purpose, and nothing else on the machine has any reason to
// hold it open. So a process with it open is an agent watching this session.
// That is a sounder inference than most liveness checks get to make, and we only
// get to make it because this runs on the reviewer's own computer.
//
// WHAT IT STILL DOES NOT PROVE. Something is LISTENING is not something is
// ANSWERING. A tail stays armed over an agent that has stopped reading, so this
// answer never makes a wait shorter or quieter; it decides which of two
// sentences the reviewer reads while they wait. Nothing waiting means nothing is
// said at all, watcher or no watcher.
//
// THE COST RULE. `lsof` is a subprocess, and the reply poll runs about once a
// second per open page. So it is never run on the poll path: callers get the
// LAST ANSWER, and asking is what schedules a refresh, at most one per file per
// TTL and never two at once. A poll that arrives while a refresh is in flight
// costs nothing at all.
//
// WHEN IT CANNOT ANSWER, IT SAYS SO. No lsof on PATH (Windows, a stripped
// container) is `null`, not `false`, forever after the first attempt. Null means
// "cannot tell" everywhere downstream, and "cannot tell" must never turn into
// "nobody is there": the honest line in that case is the one about how long it
// has been since a reply, which needs no machine inspection at all.
//
// Node-only. Not in the layer bundle.

"use strict";

var childProcess = require("node:child_process");

// How long an answer is reused before asking again. Fifteen seconds is the
// monitor's own loop, and it is far inside the ten minutes at which the rail
// starts shouting: nothing the reviewer reads turns on a fifteen-second lag.
var DEFAULT_TTL_MS = 15000;
// A probe that has not answered in two seconds is not going to help this poll.
var PROBE_TIMEOUT_MS = 2000;

/**
 * @param {{ttlMs?: number, probe?: function, now?: function}} [options]
 *   `probe` takes a path and returns a Promise of
 *   `{listening: true|false|null, supported: boolean}`. The default shells out
 *   to lsof. Tests pass their own and never spawn anything.
 */
function createWatchers(options) {
  var opts = options || {};
  var ttlMs = typeof opts.ttlMs === "number" ? opts.ttlMs : DEFAULT_TTL_MS;
  var now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
  var probe = typeof opts.probe === "function" ? opts.probe : lsofProbe;
  // path -> { answer: boolean|null, at: number, inFlight: boolean }
  var cache = new Map();
  // Set once the machine has told us it cannot answer this question at all.
  var unsupported = false;

  function entryFor(file) {
    var found = cache.get(file);
    if (found) return found;
    var fresh = { answer: null, at: 0, inFlight: null };
    cache.set(file, fresh);
    return fresh;
  }

  /**
   * Look now, and hand back the answer.
   *
   * A look already in flight is handed back AS ITSELF rather than as the stale
   * answer beside it. A caller that waits deserves the result of the wait, and
   * two callers a millisecond apart must still only cost one subprocess.
   */
  function refresh(file) {
    var entry = entryFor(file);
    if (unsupported) return Promise.resolve(entry.answer);
    if (entry.inFlight) return entry.inFlight;
    entry.inFlight = Promise.resolve()
      .then(function () { return probe(file); })
      .then(function (result) {
        var answer = result && typeof result === "object" ? result.listening : null;
        entry.answer = answer === true ? true : answer === false ? false : null;
        entry.at = now();
        // UNSUPPORTED IS NOT THE SAME AS A BAD RUN. A probe that timed out tells
        // us nothing this once; a machine with no lsof on it will never tell us
        // anything, and asking it every fifteen seconds forever is a subprocess
        // per session per quarter minute for an answer that cannot come.
        if (result && result.supported === false) unsupported = true;
        return entry.answer;
      })
      .catch(function () {
        // A probe that threw tells us nothing, which is exactly `null`. It does
        // NOT tell us nobody is there.
        entry.answer = null;
        entry.at = now();
        return null;
      })
      .then(function (answer) {
        entry.inFlight = null;
        return answer;
      });
    return entry.inFlight;
  }

  /**
   * The last answer for this file: true, false, or null for cannot tell.
   *
   * Asking is also what schedules the next look, so a rail that is being polled
   * keeps a warm answer and a rail nobody is watching costs nothing.
   */
  function listening(file) {
    if (!file || unsupported) return null;
    var entry = entryFor(file);
    var age = now() - entry.at;
    if (entry.at === 0 || age >= ttlMs) refresh(file);
    if (entry.at === 0) return null;
    return entry.answer;
  }

  return {
    TTL_MS: ttlMs,
    listening: listening,
    refresh: refresh,
    unsupported: function () { return unsupported; }
  };
}

/**
 * The default probe: `lsof -t -- <path>`, which prints one pid per line.
 *
 * -t is the terse form, one pid per line and nothing else to parse. `--` ends
 * the options so a path that begins with a dash is still a path. Exit status 1
 * with no output is lsof's way of saying nobody has it open, which is an answer
 * and not an error.
 *
 * MISSING lsof IS null, NOT false. On a machine that cannot be asked, "nobody is
 * watching" would be a fabrication, and it is exactly the fabrication this whole
 * mechanism exists to prevent.
 */
function lsofProbe(file) {
  return new Promise(function (resolve) {
    var done = false;
    function finish(value) {
      if (done) return;
      done = true;
      resolve(value);
    }
    var child;
    try {
      child = childProcess.execFile(
        "lsof",
        ["-t", "--", file],
        { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
        function (error, stdout) {
          var pids = String(stdout || "")
            .split("\n")
            .map(function (line) { return line.trim(); })
            .filter(function (line) { return /^[0-9]+$/.test(line); })
            .map(Number)
            .filter(function (pid) { return pid !== process.pid; });
          if (pids.length) return finish({ listening: true, supported: true });
          if (!error) return finish({ listening: false, supported: true });
          // ENOENT means there is no lsof on this machine: stop asking. A kill
          // by the timeout is this run failing, not the machine refusing.
          if (error.code === "ENOENT") return finish({ listening: null, supported: false });
          if (error.killed) return finish({ listening: null, supported: true });
          // lsof exits 1 when nothing has the file open, which is an answer.
          return finish(
            error.code === 1
              ? { listening: false, supported: true }
              : { listening: null, supported: true }
          );
        }
      );
    } catch (spawnError) {
      return finish({ listening: null, supported: false });
    }
    if (child && typeof child.on === "function") {
      child.on("error", function (spawnError) {
        finish({ listening: null, supported: spawnError && spawnError.code !== "ENOENT" });
      });
    }
  });
}

module.exports = {
  DEFAULT_TTL_MS: DEFAULT_TTL_MS,
  PROBE_TIMEOUT_MS: PROBE_TIMEOUT_MS,
  createWatchers: createWatchers,
  lsofProbe: lsofProbe
};
