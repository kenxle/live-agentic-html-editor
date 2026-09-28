// `lahe monitor`: wait locally for new session work, print it, and exit.
//
// This process, not an LLM timer, pays for idle polling. Empty status checks
// stay inside this Node process; the command completes only when new item lines
// exist, the session is taken over, or the session closes. A host that wakes an
// agent on task completion therefore spends no model tokens on no-ops.
//
// It is SELF-SUFFICIENT about why it stopped, and that is a fix for a real bug.
// It used to learn "this session is closed" only from a `lahe status` error that
// was gated on a flag it no longer passes, so a closed session polled forever
// while the chat said monitoring was active. Now this command reads closed_at
// itself and exits on a code of its own.
//
// FOUR REASONS TO STOP, FOUR EXIT CODES. The host reads the number and decides
// whether to relaunch, so "handle this work" and "stop relaunching, the session
// is over" cannot share one.
//
//   OK                  work is printed; handle it, drain, relaunch
//   SESSION_CLOSED      the session is closed; do not relaunch
//   SESSION_TAKEN_OVER  another agent owns this session now; do not relaunch
//   BAD_USAGE           a caller error, including a duplicate monitor

"use strict";

var protocol = require("../../shared/protocol.js");
var agentSessions = require("../../service/agent_sessions.js");
var stateDir = require("../../service/state_dir.js");
var status = require("./status.js");

var DEFAULT_INTERVAL_SECONDS = protocol.MONITOR.INTERVAL_SECONDS;
var MAX_INTERVAL_SECONDS = 3600;
var ACTION_REQUIRED = "LAHE ACTION REQUIRED: do not end this turn or report that work is ready. Handle every item below now, rebuild and verify visible output, append replies, drain status until empty, then relaunch lahe monitor.\n";

var USAGE = [
  "usage: lahe monitor --session <id> [--session <id> ...] [--interval <seconds>] [--state-dir <path>]",
  "",
  "Polls session-scoped status locally, prints only unanswered work, then exits.",
  "Idle polls invoke no model and print nothing.",
  "",
  "  --session <id>       required agent-session owner. Give it more than once to watch several",
  "                       sessions with one monitor; the first is the primary. A session that",
  "                       closes or is taken over is dropped with a line, and the rest are watched",
  "                       on; its exit code is used only when no session is left.",
  "  --interval <seconds> local polling interval; default " + DEFAULT_INTERVAL_SECONDS,
  "  --state-dir <path>   same state root used by review and status",
  "",
  "Exit codes:",
  "  " + protocol.CLI_EXIT.OK + "  new work printed; handle it, drain, then relaunch",
  "  " + protocol.CLI_EXIT.BAD_USAGE + "  bad usage, an unknown session, or another monitor already running",
  "  " + protocol.CLI_EXIT.SESSION_CLOSED + "  the agent session is closed; monitoring has ended, do not relaunch",
  "  " + protocol.CLI_EXIT.SESSION_TAKEN_OVER + "  another agent took this session over; do not relaunch"
].join("\n");

function parseArgs(argv) {
  var out = {
    // The first --session: the primary. `session` is kept for every caller that
    // reads one; `sessions` is the whole watch set, in the order given.
    session: null,
    sessions: [],
    // Accepted and ignored. The redelivery doctrine replaced it: work stays
    // listed until a reply lands, so there is no ledger to carry and a monitor
    // relaunched after a crash re-delivers rather than skipping. Older docs and
    // older agents still type it, and failing them on a flag whose absence
    // changes nothing would be a worse answer than taking it.
    seenFile: null,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    stateDir: null,
    help: false,
    error: null
  };
  var list = argv || [];
  for (var i = 0; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--session" || arg === "--seen-file" || arg === "--interval" || arg === "--state-dir") {
      if (list[i + 1] === undefined) {
        out.error = arg + " needs a value";
        break;
      }
      var value = list[(i += 1)];
      // More than once is how one monitor watches several sessions (after a
      // Library pick-up the agent owns its own and the document's). A repeated
      // id is watched once.
      if (arg === "--session" && out.sessions.indexOf(value) === -1) out.sessions.push(value);
      if (arg === "--seen-file") out.seenFile = value;
      if (arg === "--state-dir") out.stateDir = value;
      if (arg === "--interval") {
        var seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_INTERVAL_SECONDS) {
          out.error = "--interval must be an integer from 1 through " + MAX_INTERVAL_SECONDS;
          break;
        }
        out.intervalSeconds = seconds;
      }
    } else {
      out.error = "unknown option " + JSON.stringify(arg);
      break;
    }
  }
  if (out.help || out.error) return out;
  out.session = out.sessions.length ? out.sessions[0] : null;
  if (!out.session) out.error = "--session is required";
  else {
    for (var j = 0; j < out.sessions.length; j += 1) {
      if (!protocol.isSafeId(out.sessions[j])) {
        out.error = "--session must be a safe id: " + String(protocol.SAFE_ID);
        break;
      }
    }
  }
  return out;
}

function waitMs(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Is another monitor for this same session and this same handoff rev alive?
 *
 * Two monitors on one session both deliver the same work and both tell the
 * agent to handle it, which is how one batch gets worked twice. The guard is
 * three facts together: a heartbeat fresh enough to be a running loop, the SAME
 * handoff rev (an older rev is a fenced pre-takeover monitor, which is not a
 * duplicate), and a pid that still exists.
 *
 * WHAT IT STILL CANNOT SEE, said plainly. The guard reads a file, so two
 * monitors that start at the same instant can both read "no heartbeat" before
 * either writes one. The window is now the milliseconds between this check and
 * the first heartbeat write, which happens before the first poll rather than
 * inside the loop. That is small enough to be an accident nobody hits and large
 * enough to be worth saying: the file is the only lock here, and a file is not
 * an atomic one.
 */
function liveDuplicate(heartbeat, handoffRev, nowMs, ownPid) {
  if (!heartbeat) return null;
  var at = heartbeat[protocol.MONITOR.HEARTBEAT_FIELD.AT];
  var pid = heartbeat[protocol.MONITOR.HEARTBEAT_FIELD.PID];
  var rev = heartbeat[protocol.MONITOR.HEARTBEAT_FIELD.HANDOFF_REV];
  if (typeof at !== "string" || !at) return null;
  var then = Date.parse(at);
  if (Number.isNaN(then) || nowMs - then > protocol.MONITOR.HEARTBEAT_FRESH_MS) return null;
  if (!Number.isInteger(rev) || rev !== handoffRev) return null;
  if (!Number.isInteger(pid) || pid === ownPid) return null;
  if (!agentSessions.pidAlive(pid)) return null;
  return pid;
}

async function run(argv, options) {
  var opts = options || {};
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var err = opts.stderr || function (text) { process.stderr.write(text); };
  var statusRun = opts.statusRun || status.run;
  var wait = opts.wait || waitMs;
  var pid = typeof opts.pid === "number" ? opts.pid : process.pid;
  var nowMs = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
  // The session store this monitor reads and heartbeats through. `readSession`
  // is the narrower seam a test uses when it only wants to script the session
  // record; a store built from it has no heartbeat, which the guards below allow.
  var storeFor = opts.store || (opts.readSession
    ? function (stateDirOption) {
        return { read: function (id) { return opts.readSession(id, stateDirOption); } };
      }
    : function (stateDirOption) {
        var dir = stateDirOption ? stateDir.stateDir({ dir: stateDirOption }) : stateDir.stateDir();
        return agentSessions.createStore({ dir: dir });
      });
  var args = parseArgs(argv);

  if (args.help) {
    out(USAGE + "\n");
    return protocol.CLI_EXIT.OK;
  }
  if (args.error) {
    err("lahe monitor: " + args.error + "\n\n" + USAGE + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }

  // THE WATCH SET. One entry per --session, the primary first. Each carries the
  // handoff rev it started under, because a takeover fences each session on its
  // own: a takeover of one drops that one and leaves the rest watched.
  var store;
  var watched = [];
  try {
    store = storeFor(args.stateDir);
    for (var s = 0; s < args.sessions.length; s += 1) {
      var startingSession = store.read(args.sessions[s]);
      if (!startingSession) {
        err("lahe monitor: unknown agent session " + JSON.stringify(args.sessions[s]) + "\n");
        return protocol.CLI_EXIT.BAD_USAGE;
      }
      watched.push({
        id: args.sessions[s],
        handoffRev: agentSessions.handoffRev(startingSession),
        closedAtStart: !!startingSession.closed_at
      });
    }
  } catch (readError) {
    err("lahe monitor: " + readError.message + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }

  // Closed BEFORE the first poll, not only between them. A monitor relaunched
  // against a session that closed while the agent was working used to start a
  // loop that could never end. With several sessions a closed one is dropped
  // and the rest are watched; with none left, this is the closed exit.
  var lastExit = null;
  watched = watched.filter(function (entry) {
    if (!entry.closedAtStart) return true;
    lastExit = { entry: entry, state: "closed" };
    return false;
  });
  if (watched.length === 0) return exitFor(lastExit.entry, lastExit.state);
  if (lastExit) {
    args.sessions.forEach(function (id) {
      if (!watched.some(function (entry) { return entry.id === id; })) droppedLine(id, "closed");
    });
  }

  // The duplicate guard runs once, at startup, against whatever heartbeat is on
  // disk for each session. A stale one, or one whose pid is gone, is simply
  // overwritten below.
  if (typeof store.readMonitor === "function") {
    for (var d = 0; d < watched.length; d += 1) {
      var other = liveDuplicate(store.readMonitor(watched[d].id), watched[d].handoffRev, nowMs(), pid);
      if (other !== null) {
        err(
          "lahe monitor: agent session " + watched[d].id + " already has a live monitor (pid " + other +
            "). Two monitors deliver the same work twice. Use that one, or stop it first.\n"
        );
        return protocol.CLI_EXIT.BAD_USAGE;
      }
    }
  }

  // The heartbeat, written HERE rather than at the top of the first loop. The
  // duplicate guard above reads a file, so until this line runs there is nothing
  // on disk for a second monitor to find: writing it before the first poll (and
  // a poll can take a while) shrinks that window from an interval to
  // milliseconds.
  beatAll();

  /** The primary: the first session still watched. */
  function primary() {
    return watched.length ? watched[0].id : null;
  }

  function beat(entry) {
    if (typeof store.writeMonitor !== "function") return false;
    try {
      store.writeMonitor(entry.id, { pid: pid, handoff_rev: entry.handoffRev, primary: primary() });
      return true;
    } catch (writeError) {
      // A heartbeat that cannot be written costs the rail a chip, not the agent
      // its work. Keep going.
      return false;
    }
  }

  function beatAll() {
    watched.forEach(beat);
  }

  /**
   * Take a heartbeat down on the way out.
   *
   * Every deliberate exit runs it, because every deliberate exit is followed by
   * a relaunch or by nothing at all, and a heartbeat left behind refuses that
   * relaunch for the next 45 seconds. The store only removes a heartbeat still
   * carrying this pid, so a monitor that started in the meantime keeps its own.
   */
  function stopBeating(entry) {
    if (typeof store.clearMonitor !== "function") return false;
    try {
      return store.clearMonitor(entry.id, { pid: pid });
    } catch (clearError) {
      return false;
    }
  }

  function stopBeatingAll() {
    watched.forEach(stopBeating);
  }

  function droppedLine(id, state) {
    var remaining = watched.map(function (entry) { return entry.id; }).join(", ");
    var why = state === "closed" ? "is closed" : state === "taken_over" ? "was taken over" : "is gone from the state directory";
    err("lahe monitor: agent session " + id + " " + why + "; no longer watching it; still watching " + remaining + "\n");
  }

  // Declared as function statements so the startup checks above can use them.
  function exitFor(entry, state) {
    if (typeof store.clearMonitor === "function") stopBeating(entry);
    if (state === "closed") {
      err(
        "lahe monitor: agent session " + entry.id +
          " is closed; monitoring has ended; do not relaunch this monitor\n"
      );
      return protocol.CLI_EXIT.SESSION_CLOSED;
    }
    if (state === "taken_over") {
      err(
        "lahe monitor: agent session " + entry.id +
          " was taken over; this older monitor has ended; do not relaunch it\n"
      );
      return protocol.CLI_EXIT.SESSION_TAKEN_OVER;
    }
    err("lahe monitor: agent session " + entry.id + " is gone from the state directory\n");
    return protocol.CLI_EXIT.SESSION_CLOSED;
  }

  /**
   * Does this monitor still own the session?
   *
   * TWO questions, not one. A takeover bumps handoff_rev; a close does not
   * touch it. Checking only the rev is what let a closed session poll forever.
   */
  function ownership(entry) {
    var current = store.read(entry.id);
    if (!current) return "gone";
    if (current.closed_at) return "closed";
    if (agentSessions.handoffRev(current) !== entry.handoffRev) return "taken_over";
    return "owned";
  }

  /**
   * Drop every session this monitor no longer owns. Returns an exit code when
   * none is left (the code of the last one dropped), or null to keep going.
   */
  function prune() {
    var dropped = [];
    watched = watched.filter(function (entry) {
      var state = ownership(entry);
      if (state === "owned") return true;
      dropped.push({ entry: entry, state: state });
      return false;
    });
    if (dropped.length === 0) return null;
    if (watched.length === 0) {
      for (var i = 0; i < dropped.length - 1; i += 1) stopBeating(dropped[i].entry);
      var last = dropped[dropped.length - 1];
      return exitFor(last.entry, last.state);
    }
    dropped.forEach(function (gone) {
      stopBeating(gone.entry);
      droppedLine(gone.entry.id, gone.state);
    });
    return null;
  }

  // The drain command, in exactly the spelling every doc and every wake line
  // uses. One spelling, in protocol.js. It carries --state-dir when this monitor
  // is not on the default directory, because the agent copies these two lines
  // into a different shell and a resolved-by-default drain would report no work.
  var flagDir = stateDir.flagFor(args.stateDir);

  function statusArgsFor(entry) {
    var list = ["--session", entry.id, "--json", "--quiet"];
    if (args.stateDir) list.push("--state-dir", args.stateDir);
    return list;
  }

  while (true) {
    var early;
    try {
      early = prune();
    } catch (readError) {
      stopBeatingAll();
      err("lahe monitor: " + readError.message + "\n");
      return protocol.CLI_EXIT.BAD_USAGE;
    }
    if (early !== null) return early;

    // Once per loop after the first, which was written before the loop. It is
    // what the rail reads to say "an agent is watching" without taking the
    // agent's word for it.
    beatAll();

    var results = [];
    for (var w = 0; w < watched.length; w += 1) {
      var stdout = [];
      var stderr = [];
      var code = await statusRun(statusArgsFor(watched[w]), {
        stdout: function (text) { stdout.push(String(text)); },
        stderr: function (text) { stderr.push(String(text)); },
        // THIS POLL IS NOT THE AGENT WORKING. It is this Node process looking at
        // a file every few seconds while the agent may be asleep or gone. Letting
        // it stamp activity.json made the rail say "agent working" for as long as
        // the monitor ran and pushed the unattended alarm out of reach, which is
        // exactly the false comfort the liveness line exists to remove. The
        // heartbeat above is the honest signal for "a monitor is up".
        suppressActivityTouch: true,
        // ONCE, NOT ON EVERY RELAUNCH. An ended review is permanent state, so
        // without this the monitor would surface it, exit, be relaunched, surface
        // it again, and spend a model turn every time round. Only the monitor
        // marks it: the agent's own drain always answers "why was I woken". The
        // same flag marks Library requests delivered, once per request.
        markEndedDelivered: true
      });
      results.push({ entry: watched[w], printed: stdout.join(""), errors: stderr.join(""), code: code });
    }

    // Checked AFTER the poll too, so work captured a moment before a takeover is
    // never handed to the agent that no longer owns it.
    var late;
    try {
      late = prune();
    } catch (readError) {
      stopBeatingAll();
      err("lahe monitor: " + readError.message + "\n");
      return protocol.CLI_EXIT.BAD_USAGE;
    }
    if (late !== null) return late;
    results = results.filter(function (result) { return watched.indexOf(result.entry) !== -1; });

    var withWork = results.filter(function (result) { return !!result.printed; });
    if (withWork.length > 0) {
      // ON STDOUT, ahead of the items, and on stderr as well. A host that
      // captures one stream used to get the instruction without the work, or the
      // work without the instruction.
      out(ACTION_REQUIRED);
      err(ACTION_REQUIRED);
      withWork.forEach(function (result) { out(result.printed); });
      // The next step, printed where the agent is already looking, rather than
      // left in a doc it may never open. One drain per session that had work;
      // the relaunch names every session still watched.
      var drains = withWork.map(function (result, index) {
        return (index === 0 ? "  drain     " : "            ") + protocol.drainCommand(result.entry.id, flagDir);
      });
      out(
        "\nNEXT: handle every item above, rebuild and verify, append your replies.\n" +
          drains.join("\n") + "\n" +
          "            repeat until it prints no items\n" +
          "  relaunch  " + protocol.monitorCommand(watched.map(function (entry) { return entry.id; }), flagDir) + "\n"
      );
    }
    var failed = null;
    results.forEach(function (result) {
      if (result.errors) err(result.errors);
      if (failed === null && result.code !== protocol.CLI_EXIT.OK) failed = result.code;
    });
    // Both of these are the end of this monitor. The heartbeats come down with
    // it so the relaunch the agent is being told to run is not refused by the
    // corpse of the process telling it to.
    if (failed !== null) {
      stopBeatingAll();
      return failed;
    }
    if (withWork.length > 0) {
      stopBeatingAll();
      return protocol.CLI_EXIT.OK;
    }

    await wait(args.intervalSeconds * 1000);
  }
}

module.exports = {
  DEFAULT_INTERVAL_SECONDS: DEFAULT_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS: MAX_INTERVAL_SECONDS,
  ACTION_REQUIRED: ACTION_REQUIRED,
  USAGE: USAGE,
  liveDuplicate: liveDuplicate,
  parseArgs: parseArgs,
  run: run
};
