// Durable routing ownership for independent top-level agent workstreams.
// One machine may have many sessions and one shared helper, but one review has
// exactly one immutable agent-session owner. Stewardship of that whole session
// may move explicitly between top-level agents through a handoff revision.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");
var wakeFeed = require("./wake_feed.js");
var watchersModule = require("./watchers.js");

// One probe per process, made on first use. It is a cache in front of a
// subprocess, so a second one would be a second subprocess per session per TTL
// for the same answer. A store can be handed its own for a test.
var sharedWatchers = null;
function defaultWatchers() {
  if (!sharedWatchers) sharedWatchers = watchersModule.createWatchers();
  return sharedWatchers;
}

var SCHEMA = 1;
var LEGACY_ID = "legacy";

function mintId() {
  return "s_" + crypto.randomBytes(8).toString("hex");
}

function handoffRev(session) {
  return session && Number.isInteger(session.handoff_rev) && session.handoff_rev >= 0
    ? session.handoff_rev
    : 0;
}

/**
 * Is a pid a process that still exists?
 *
 * signal 0 checks for existence without delivering anything. EPERM means the
 * process is there and owned by somebody else, which still counts as alive.
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * What the rail may say about the agent, computed from the machine rather than
 * from anything an agent claimed.
 *
 * NOTHING WAITING, NOTHING SAID. A review with every item answered and an agent
 * sitting quietly on it is the healthy, ordinary state of a review: the reviewer
 * has three other documents open and has not got to them yet. Saying anything
 * about the agent there would be an alarm on nearly every session on the
 * machine. `none` is that case, and it is most of the life of most reviews.
 *
 * The other three only exist while an item is waiting, and what they report is
 * HOW LONG IT HAS WAITED:
 *
 * WORKING   the agent ran a lahe command or landed a reply in the last few
 *           minutes. It is mid-task, and the wait is not alarming.
 * WAITING   nothing has come back for a while.
 * NO_AGENT  the same, plus the machine can SEE that nothing is listening: no
 *           process holds this session's wake feed open, no live monitor, and no
 *           lahe command in minutes. A different next move for the reviewer.
 *
 * THREE THINGS COUNT AS LISTENING, and every one of them is read off this
 * machine:
 *
 *   1. Something holds the session's wake feed open. That is the host that arms
 *      `tail -n 0 -f wake.log`, which is the wake channel we want and which used
 *      to be invisible here. `null` from the probe means CANNOT TELL and never
 *      becomes "nobody".
 *   2. A monitor heartbeat that is fresh, carries THIS handoff rev, AND whose
 *      pid still exists. The pid check is new: a killed monitor's heartbeat used
 *      to read as live for its whole freshness window.
 *   3. A lahe command in the last few minutes, which is the exit-on-work monitor
 *      case: it is gone while the agent works the batch it printed.
 *
 * LISTENING ONLY EVER WITHHOLDS AN ACCUSATION. It decides between "nothing back
 * yet" and "no agent listening", and it can never make a wait quieter or
 * shorter. An armed tail over an agent that stopped reading is still an item
 * nobody answered, because the wait is measured from the reviewer's item.
 *
 * @param {{session?: object, monitor?: object, activity?: object,
 *          listening?: boolean|null, unanswered?: number,
 *          oldestUnansweredAt?: string|null, lastReplyAt?: string|null,
 *          nowMs?: number, pidAlive?: function}} input
 */
function livenessFrom(input) {
  var spec = input || {};
  var nowMs = typeof spec.nowMs === "number" ? spec.nowMs : Date.now();
  var rev = handoffRev(spec.session);
  var alive = typeof spec.pidAlive === "function" ? spec.pidAlive : pidAlive;
  var monitor = spec.monitor || null;
  var activity = spec.activity || null;
  var unanswered = Number.isInteger(spec.unanswered) && spec.unanswered > 0 ? spec.unanswered : 0;
  var states = protocol.AGENT_LIVENESS.STATE;

  var monitorAt = null;
  var monitorPid = null;
  if (monitor && typeof monitor[protocol.MONITOR.HEARTBEAT_FIELD.AT] === "string") {
    var monitorRev = monitor[protocol.MONITOR.HEARTBEAT_FIELD.HANDOFF_REV];
    if (Number.isInteger(monitorRev) && monitorRev === rev) {
      monitorAt = monitor[protocol.MONITOR.HEARTBEAT_FIELD.AT];
      monitorPid = monitor[protocol.MONITOR.HEARTBEAT_FIELD.PID];
    }
  }
  var activityAt = activity && typeof activity[protocol.MONITOR.ACTIVITY_FIELD.AT] === "string"
    ? activity[protocol.MONITOR.ACTIVITY_FIELD.AT]
    : null;

  var monitorLive =
    withinMs(monitorAt, nowMs, protocol.MONITOR.HEARTBEAT_FRESH_MS) && alive(monitorPid);
  var commandRecently = withinMs(activityAt, nowMs, protocol.AGENT_LIVENESS.RECENT_COMMAND_MS);
  var watcher = spec.listening === true ? true : spec.listening === false ? false : null;

  var listening;
  if (watcher === true || monitorLive || commandRecently) listening = true;
  else if (watcher === false) listening = false;
  else listening = null;

  var oldestAt = typeof spec.oldestUnansweredAt === "string" && spec.oldestUnansweredAt
    ? spec.oldestUnansweredAt
    : null;
  var lastReplyAt = typeof spec.lastReplyAt === "string" && spec.lastReplyAt ? spec.lastReplyAt : null;
  // Mid-task: something the AGENT did, in the last few minutes. A drain stamps
  // activity.json and a folded reply stamps it too, so this is the agent's own
  // footprints rather than a process that happens to be running.
  var active =
    withinMs(activityAt, nowMs, protocol.AGENT_LIVENESS.ACTIVE_MS) ||
    withinMs(lastReplyAt, nowMs, protocol.AGENT_LIVENESS.ACTIVE_MS);

  var state;
  if (unanswered === 0) state = states.NONE;
  else if (active) state = states.WORKING;
  else if (listening === false) state = states.NO_AGENT;
  else state = states.WAITING;

  var out = {};
  out[protocol.AGENT_LIVENESS.FIELD.STATE] = state;
  out[protocol.AGENT_LIVENESS.FIELD.UNANSWERED] = unanswered;
  out[protocol.AGENT_LIVENESS.FIELD.OLDEST_UNANSWERED_AT] = oldestAt;
  out[protocol.AGENT_LIVENESS.FIELD.LAST_REPLY_AT] = lastReplyAt;
  out[protocol.AGENT_LIVENESS.FIELD.LISTENING] = listening;
  out[protocol.AGENT_LIVENESS.FIELD.MONITOR_AT] = monitorAt;
  out[protocol.AGENT_LIVENESS.FIELD.ACTIVITY_AT] = activityAt;
  return out;
}

function withinMs(iso, nowMs, windowMs) {
  if (typeof iso !== "string" || !iso) return false;
  var then = Date.parse(iso);
  if (Number.isNaN(then)) return false;
  return nowMs - then <= windowMs;
}

/**
 * The four commands an agent needs, printed the same way everywhere.
 *
 * `lahe review` prints it at setup and `lahe session takeover` prints it at
 * handoff. One spelling, because two spellings of the wake command is how an
 * agent ends up tailing a path that does not exist.
 *
 * The wake line is FIRST because it is the one that costs nothing while it
 * waits. The monitor line is the fallback for a host with no persistent file
 * watcher of its own.
 *
 * THE COMMANDS CARRY --state-dir WHEN THIS SESSION IS NOT IN THE DEFAULT
 * DIRECTORY. They are printed to be copied, and a copied command resolves the
 * state directory itself: without the flag it reads the default one and reports
 * no work while items sit unanswered here.
 *
 * @param {{dir: string, session: string}} input
 */
function commandBlock(input) {
  var spec = input || {};
  if (!spec.dir || !spec.session) throw new Error("agent_sessions.commandBlock: dir and session are required");
  var wake = stateDir.wakeLogPath(spec.dir, spec.session);
  var flagDir = stateDir.flagFor(spec.dir);
  return (
    "  wake      tail -n 0 -f " + wake + "\n" +
    "            Claude Code: arm this once as a Monitor with persistent true, never the default\n" +
    "            timeout. Each new line means run drain.\n" +
    "  monitor   " + protocol.monitorCommand(spec.session, flagDir) + "\n" +
    "            Codex: run as a foreground pending exec and keep waiting on it. Antigravity: a\n" +
    "            background terminal task, never the native schedule timer. It prints work and exits.\n" +
    "  drain     " + protocol.drainCommand(spec.session, flagDir) + "\n" +
    "            handle every item it prints, append replies, repeat until it prints nothing\n" +
    "  close     lahe session close " + spec.session + protocol.stateDirFlag(flagDir) + "\n" +
    "  exits     monitor: 0 work printed, " + protocol.CLI_EXIT.SESSION_CLOSED + " session closed, " +
      protocol.CLI_EXIT.SESSION_TAKEN_OVER + " taken over. " + protocol.CLI_EXIT.SESSION_CLOSED + " and " +
      protocol.CLI_EXIT.SESSION_TAKEN_OVER + " mean stop relaunching.\n"
  );
}

function createStore(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("agent_sessions.createStore: dir is required");
  var dir = opts.dir;
  var now = typeof opts.now === "function" ? opts.now : function () { return new Date().toISOString(); };
  // Whatever can answer "is something holding this session's wake feed open?".
  // A test passes its own rather than spawning anything.
  var watchers = opts.watchers || null;

  function read(id) {
    if (id === LEGACY_ID) return { schema: SCHEMA, id: LEGACY_ID, created_at: null, closed_at: null, synthetic: true };
    if (!protocol.isSafeId(id)) throw new Error("invalid agent session id " + JSON.stringify(id));
    var file = stateDir.agentSessionPath(dir, id);
    if (!fs.existsSync(file)) return null;
    var parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      throw new Error("agent session " + id + " has unreadable session.json: " + err.message);
    }
    if (!parsed || parsed.schema !== SCHEMA || parsed.id !== id) {
      throw new Error("agent session " + id + " has invalid session.json");
    }
    return parsed;
  }

  function write(session) {
    stateDir.ensureAgentSessionDir(dir, session.id);
    stateDir.writeAtomic(stateDir.agentSessionPath(dir, session.id), JSON.stringify(session, null, 2) + "\n");
    return session;
  }

  // Its own clock, deliberately. The store's `now` is the session record's
  // clock, and a test that counts its ticks is asserting session timestamps, not
  // feed timestamps. Sharing it made appending a wake line change what a session
  // record said its created_at was.
  var feed = wakeFeed.createWakeFeed({ dir: dir });

  function create(input) {
    var spec = input || {};
    var id = spec.id || mintId();
    if (id === LEGACY_ID || !protocol.isSafeId(id)) throw new Error("invalid agent session id " + JSON.stringify(id));
    var existing = read(id);
    // The wake feed is created EMPTY here, before any work exists, so a host can
    // arm `tail -n 0 -f` on it the moment the session id is printed. Tailing a
    // path that does not exist yet is a race, and losing it is a session that
    // never wakes. Also run for an existing session, so a state directory made
    // before the feed existed gets one.
    feed.ensure(id);
    if (existing) return existing;
    return write({ schema: SCHEMA, id: id, created_at: now(), closed_at: null, handoff_rev: 0 });
  }

  function list() {
    var root = stateDir.agentSessionsRoot(dir);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(function (entry) { return entry.isDirectory() && protocol.isSafeId(entry.name); })
      .map(function (entry) { return read(entry.name); })
      .sort(function (a, b) { return a.id.localeCompare(b.id); });
  }

  function requireOpen(id) {
    var session = read(id);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(id));
    if (session.closed_at) throw new Error("agent session " + id + " is closed; run `lahe session reopen " + id + "`");
    return session;
  }

  function close(id) {
    var session = read(id);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(id));
    if (!session.closed_at) {
      session.closed_at = now();
      write(session);
      // The last line the feed ever gets. A tail that is still armed reads it
      // and knows the answer is "stop", not "drain".
      try { feed.appendSessionEvent(id, protocol.WAKE.KIND.CLOSED); } catch (err) { /* the close itself stands */ }
    }
    return session;
  }

  function reopen(id) {
    var session = read(id);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(id));
    if (session.closed_at) {
      session.closed_at = null;
      write(session);
    }
    // A reopened session gets a live feed again. It was never removed, but a
    // session that predates the feed has none, and the reopen output points an
    // agent straight at that path.
    feed.ensure(id);
    return session;
  }

  function takeover(id) {
    var session = read(id);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(id));
    session.closed_at = null;
    session.handoff_rev = handoffRev(session) + 1;
    session.taken_over_at = now();
    write(session);
    // The previous agent's tail is still armed on this same file. The line tells
    // it the session moved, which is the one thing it cannot learn from silence.
    try { feed.appendSessionEvent(id, protocol.WAKE.KIND.TAKEOVER); } catch (err) { /* the takeover itself stands */ }
    return session;
  }

  function openSessions() {
    return list().filter(function (session) { return !session.closed_at; });
  }

  // ---------------------------------------------------------------------------
  // The monitor heartbeat and the session activity stamp
  // ---------------------------------------------------------------------------

  function readJson(file) {
    if (!fs.existsSync(file)) return null;
    try {
      var parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  /** The running monitor's heartbeat, or null. */
  function readMonitor(id) {
    return readJson(stateDir.monitorPath(dir, id));
  }

  /** Written once per monitor loop, atomically. */
  function writeMonitor(id, spec) {
    var s = spec || {};
    stateDir.ensureAgentSessionDir(dir, id);
    var record = {};
    record[protocol.MONITOR.HEARTBEAT_FIELD.PID] = Number.isInteger(s.pid) ? s.pid : process.pid;
    record[protocol.MONITOR.HEARTBEAT_FIELD.HANDOFF_REV] = Number.isInteger(s.handoff_rev) ? s.handoff_rev : 0;
    record[protocol.MONITOR.HEARTBEAT_FIELD.AT] = s.at || now();
    stateDir.writeAtomic(stateDir.monitorPath(dir, id), JSON.stringify(record, null, 2) + "\n");
    return record;
  }

  /**
   * Stop claiming to be watching: remove this monitor's own heartbeat.
   *
   * Every deliberate monitor exit calls it, and the reason is the relaunch every
   * doc tells an agent to do immediately. A heartbeat left behind stays fresh
   * for 45 seconds, and a pid that has exited but not been reaped still answers
   * signal 0, so the relaunch met "a live monitor already runs" and the session
   * sat unwatched while the agent believed one was up.
   *
   * ONLY ITS OWN. The pid guard is what keeps this from deleting the heartbeat
   * of the monitor that replaced it. A crash still leaves a heartbeat behind,
   * which is what the freshness window and the pid check are for.
   *
   * @param {string} id
   * @param {{pid?: number}} [spec] the pid that must own the heartbeat
   * @returns {boolean} true when a heartbeat was removed
   */
  function clearMonitor(id, spec) {
    var s = spec || {};
    var current = readMonitor(id);
    if (!current) return false;
    if (Number.isInteger(s.pid) && current[protocol.MONITOR.HEARTBEAT_FIELD.PID] !== s.pid) return false;
    try {
      fs.rmSync(stateDir.monitorPath(dir, id), { force: true });
    } catch (err) {
      return false;
    }
    return true;
  }

  /** When this session last ran a lahe command, or null. */
  function readActivity(id) {
    return readJson(stateDir.activityPath(dir, id));
  }

  /**
   * The drain and the reply-append paths call this.
   *
   * It is what separates "an agent is mid-batch" from "nobody is home", and the
   * rail says something different for each. Failure is swallowed: a status
   * command must not fail because a liveness stamp could not be written.
   */
  function touchActivity(id) {
    try {
      stateDir.ensureAgentSessionDir(dir, id);
      var record = {};
      record[protocol.MONITOR.ACTIVITY_FIELD.AT] = now();
      stateDir.writeAtomic(stateDir.activityPath(dir, id), JSON.stringify(record, null, 2) + "\n");
      return record;
    } catch (err) {
      return null;
    }
  }

  /**
   * Is anything holding this session's wake feed open?
   *
   * true, false, or null for cannot tell. It is the LAST answer rather than a
   * fresh one: asking schedules the next look, and the reply poll runs about
   * once a second per open page, which is not a rate to spawn a subprocess at.
   */
  function watchingFeed(id) {
    var probe = watchers || defaultWatchers();
    if (!probe || typeof probe.listening !== "function") return null;
    try {
      return probe.listening(stateDir.wakeLogPath(dir, id));
    } catch (err) {
      return null;
    }
  }

  /**
   * Ask the machine now, and wait for the answer.
   *
   * The rail never does this: it polls once a second and takes the last answer.
   * A CLI does, because it exits in a few milliseconds and the last answer in a
   * process that has only just started is "cannot tell", which would print
   * "watcher unknown" for every session on every run.
   *
   * @param {string[]} ids
   * @returns {Promise}
   */
  function warmWatching(ids) {
    var probe = watchers || defaultWatchers();
    if (!probe || typeof probe.refresh !== "function") return Promise.resolve([]);
    return Promise.all((ids || []).map(function (id) {
      try {
        return probe.refresh(stateDir.wakeLogPath(dir, id));
      } catch (err) {
        return null;
      }
    }));
  }

  /**
   * The liveness object the rail reads, for one session.
   *
   * @param {string} id
   * @param {{unanswered?: number, oldestUnansweredAt?: string|null,
   *          lastReplyAt?: string|null, listening?: boolean|null,
   *          nowMs?: number}} [work]
   */
  function liveness(id, work) {
    var w = work || {};
    var session = null;
    try {
      session = read(id);
    } catch (err) {
      session = null;
    }
    return livenessFrom({
      session: session,
      monitor: readMonitor(id),
      activity: readActivity(id),
      listening: w.listening === undefined ? watchingFeed(id) : w.listening,
      unanswered: w.unanswered,
      oldestUnansweredAt: w.oldestUnansweredAt,
      lastReplyAt: w.lastReplyAt,
      nowMs: w.nowMs
    });
  }

  return {
    create: create,
    read: read,
    list: list,
    requireOpen: requireOpen,
    close: close,
    reopen: reopen,
    takeover: takeover,
    handoffRev: handoffRev,
    openSessions: openSessions,
    wake: feed,
    readMonitor: readMonitor,
    writeMonitor: writeMonitor,
    clearMonitor: clearMonitor,
    readActivity: readActivity,
    touchActivity: touchActivity,
    watchingFeed: watchingFeed,
    warmWatching: warmWatching,
    liveness: liveness
  };
}

module.exports = {
  SCHEMA: SCHEMA,
  LEGACY_ID: LEGACY_ID,
  mintId: mintId,
  handoffRev: handoffRev,
  pidAlive: pidAlive,
  livenessFrom: livenessFrom,
  commandBlock: commandBlock,
  createStore: createStore
};
