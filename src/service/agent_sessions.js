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
 * The four liveness states, computed from files rather than from claims.
 *
 * WATCHING   a monitor heartbeat for THIS handoff rev, younger than three of
 *            its loops. A heartbeat carrying an older rev is a pre-takeover
 *            monitor that has not noticed yet, and it must never make the rail
 *            say the new agent is watching.
 * WORKING    unanswered work, no fresh heartbeat, and the session ran a lahe
 *            command recently. This is the mid-batch case: the agent is editing
 *            and rebuilding, not polling. It exists so the rail stops showing a
 *            false red at exactly the moment the agent is doing the work.
 * UNATTENDED unanswered work and neither of the above. Nobody is listening, and
 *            the oldest item's age says how long that has been true.
 * NONE       nothing waiting and nobody watching. Not a problem, so not loud.
 *
 * @param {{session?: object, monitor?: object, activity?: object,
 *          unanswered?: number, oldestUnansweredAt?: string|null,
 *          nowMs?: number}} input
 */
function livenessFrom(input) {
  var spec = input || {};
  var nowMs = typeof spec.nowMs === "number" ? spec.nowMs : Date.now();
  var rev = handoffRev(spec.session);
  var monitor = spec.monitor || null;
  var activity = spec.activity || null;
  var unanswered = Number.isInteger(spec.unanswered) && spec.unanswered > 0 ? spec.unanswered : 0;

  var monitorAt = null;
  if (monitor && typeof monitor[protocol.MONITOR.HEARTBEAT_FIELD.AT] === "string") {
    var monitorRev = monitor[protocol.MONITOR.HEARTBEAT_FIELD.HANDOFF_REV];
    if (Number.isInteger(monitorRev) && monitorRev === rev) {
      monitorAt = monitor[protocol.MONITOR.HEARTBEAT_FIELD.AT];
    }
  }
  var activityAt = activity && typeof activity[protocol.MONITOR.ACTIVITY_FIELD.AT] === "string"
    ? activity[protocol.MONITOR.ACTIVITY_FIELD.AT]
    : null;

  var monitorFresh = withinMs(monitorAt, nowMs, protocol.MONITOR.HEARTBEAT_FRESH_MS);
  var activityFresh = withinMs(activityAt, nowMs, protocol.MONITOR.ACTIVITY_FRESH_MS);

  var state;
  if (monitorFresh) state = protocol.AGENT_LIVENESS.STATE.WATCHING;
  else if (unanswered > 0 && activityFresh) state = protocol.AGENT_LIVENESS.STATE.WORKING;
  else if (unanswered > 0) state = protocol.AGENT_LIVENESS.STATE.UNATTENDED;
  else state = protocol.AGENT_LIVENESS.STATE.NONE;

  var out = {};
  out[protocol.AGENT_LIVENESS.FIELD.STATE] = state;
  out[protocol.AGENT_LIVENESS.FIELD.MONITOR_AT] = monitorAt;
  out[protocol.AGENT_LIVENESS.FIELD.ACTIVITY_AT] = activityAt;
  out[protocol.AGENT_LIVENESS.FIELD.UNANSWERED] = unanswered;
  out[protocol.AGENT_LIVENESS.FIELD.OLDEST_UNANSWERED_AT] =
    typeof spec.oldestUnansweredAt === "string" && spec.oldestUnansweredAt ? spec.oldestUnansweredAt : null;
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
 * @param {{dir: string, session: string}} input
 */
function commandBlock(input) {
  var spec = input || {};
  if (!spec.dir || !spec.session) throw new Error("agent_sessions.commandBlock: dir and session are required");
  var wake = stateDir.wakeLogPath(spec.dir, spec.session);
  return (
    "  wake      tail -n 0 -f " + wake + "\n" +
    "            Claude Code: arm this once as a persistent Monitor. Each new line means run drain.\n" +
    "  monitor   " + protocol.monitorCommand(spec.session) + "\n" +
    "            Codex: run as a foreground pending exec and keep waiting on it. Antigravity: a\n" +
    "            background terminal task, never the native schedule timer. It prints work and exits.\n" +
    "  drain     " + protocol.drainCommand(spec.session) + "\n" +
    "            handle every item it prints, append replies, repeat until it prints nothing\n" +
    "  close     lahe session close " + spec.session + "\n" +
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
   * The liveness object the rail reads, for one session.
   *
   * @param {string} id
   * @param {{unanswered?: number, oldestUnansweredAt?: string|null, nowMs?: number}} [work]
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
      unanswered: w.unanswered,
      oldestUnansweredAt: w.oldestUnansweredAt,
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
    readActivity: readActivity,
    touchActivity: touchActivity,
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
