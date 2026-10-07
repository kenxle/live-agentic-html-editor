// `lahe hook stop`: Claude Code's Stop hook, the re-arm guard.
//
// See docs/features/20261006.02_rearm_guard/00_decision.md. Claude Code runs a
// Stop hook each time the main agent tries to end its turn, and the hook may
// refuse. This one refuses when a Lahe session the agent started is open and
// nothing is watching it, and the refusal hands the agent the exact command to
// start the watcher again. The guarantee lives in the host, not in the agent's
// memory, which is the one thing every earlier fix depended on and lost.
//
// WHICH SESSIONS ARE THIS AGENT'S. Claude Code hands the hook the path of the
// agent's own transcript. The hook scans it, as data, for the places an id
// proves ownership:
//
//   - a `lahe monitor --session <id> ...` command, whether the agent ran it or
//     lahe printed it (the command block `lahe review`, `lahe library` and
//     `lahe session takeover` print, and the monitor's own relaunch line)
//   - `lahe library`'s "session   <id>  (started for this agent)" line, and its
//     --json form with "session_created":true
//   - `lahe session takeover`'s "agent session <id> taken over explicitly"
//     output, with the handoff rev it printed
//
// An id that only turns up in passing (a meta.json the agent read, a row of
// `lahe session list`) is not counted: an agent that reads about another
// agent's session does not own it.
//
// WHICH OF THOSE NEED A WATCHER. Read off the state directory, never guessed:
// the session exists, is not closed (a monitor that exited 5), is still at the
// handoff rev this agent holds (a monitor that exited 6 lost it), and still has
// a review the reviewer has not ended. A watcher is live when its heartbeat is
// at this rev and its pid still exists, whatever the heartbeat's age (see
// monitorAlive for why that is wider than the rail's rule).
//
// NEVER A TRAP, NEVER A FAILURE. `stop_hook_active` is true when the agent is
// already continuing because of a Stop hook, and then this prints nothing, so it
// blocks at most once per turn. Every error is silence and exit 0: a broken hook
// must cost the agent nothing, because Claude Code shows a hook's failures to
// the human.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var agentSessions = require("../../service/agent_sessions.js");
var stateDir = require("../../service/state_dir.js");

// Claude Code's background Bash limit when BASH_MAX_TIMEOUT_MS is not set.
var DEFAULT_MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000;

// How much of a transcript is read, from its end. A long session's transcript
// runs to tens of megabytes; ids are re-printed on every relaunch, so the recent
// end is where they are, and reading stops here whatever the size. A session
// whose last monitor command is further back than this is not seen.
var TRANSCRIPT_CAP_BYTES = 32 * 1024 * 1024;
var CHUNK_BYTES = 4 * 1024 * 1024;
// Each chunk also reads this far into the next one, so a match that straddles
// a chunk boundary is still seen whole. Longer than the longest pattern below.
var OVERLAP_BYTES = 4096;

// The id shape the CLI prints is s_ plus 16 hex digits; the CLI accepts any
// safe id, so the pattern is that broader shape and isSafeId has the last word.
var ID = "s_[A-Za-z0-9_-]{1,62}";
// Unquoted, or single-quoted as protocol.js's shellWord writes a path with a space.
var STATE_DIR_WORD = "('[^']*'|[A-Za-z0-9_@%+=:,./-]+)";

var MONITOR_RE = new RegExp(
  "lahe monitor((?: --session " + ID + ")+)(?: --state-dir " + STATE_DIR_WORD + ")?",
  "g"
);
var LIBRARY_RE = new RegExp("session {3}(" + ID + ") {2}\\(started for this agent\\)", "g");
// `lahe library --json` when it started the session: session_created true is
// its "started for this agent". Inside a transcript the quotes are escaped.
var LIBRARY_JSON_RE = new RegExp(
  '\\\\*"session\\\\*":\\\\*"(' + ID + ')\\\\*",\\\\*"session_created\\\\*":true',
  "g"
);
var TAKEOVER_RE = new RegExp("agent session (" + ID + ") taken over explicitly[^]{0,600}?handoff +(\\d+)", "g");
var ID_RE = new RegExp(ID, "g");

var USAGE = [
  "usage: lahe hook stop [--state-dir <path>]",
  "",
  "Claude Code's Stop hook. Reads the hook's JSON on stdin. When a Lahe session this",
  "agent started is open and has no live monitor, prints",
  '{"decision":"block","reason":"..."} with the command that starts the watcher again.',
  "Otherwise, and on any error, prints nothing. Always exits 0.",
  "",
  "npm run install-skills adds it to ~/.claude/settings.json under hooks.Stop."
].join("\n");

/**
 * The largest timeout a background Bash call may ask for: two hours, or
 * BASH_MAX_TIMEOUT_MS when that allows more.
 */
function maxTimeoutMs(env) {
  var raw = env && env.BASH_MAX_TIMEOUT_MS;
  var value = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isSafeInteger(value) && value > DEFAULT_MAX_TIMEOUT_MS ? value : DEFAULT_MAX_TIMEOUT_MS;
}

function unquote(word) {
  if (typeof word !== "string" || !word) return null;
  return word.charAt(0) === "'" ? word.slice(1, -1) : word;
}

/**
 * Every session the transcript proves this agent owns.
 *
 * @param {string} file the transcript path
 * @param {{capBytes?: number}} [options]
 * @returns {Map<string, {stateDirs: Set<string>, takeoverRevs: Set<number>}>}
 */
function scanTranscript(file, options) {
  var cap = (options && options.capBytes) || TRANSCRIPT_CAP_BYTES;
  var found = new Map();
  function claim(id) {
    if (!protocol.isSafeId(id)) return null;
    if (!found.has(id)) found.set(id, { stateDirs: new Set(), takeoverRevs: new Set() });
    return found.get(id);
  }

  var fd = fs.openSync(file, "r");
  try {
    var size = fs.fstatSync(fd).size;
    var floor = Math.max(0, size - cap);
    var buffer = Buffer.alloc(CHUNK_BYTES + OVERLAP_BYTES);
    var end = size;
    while (end > floor) {
      var start = Math.max(floor, end - CHUNK_BYTES);
      var length = end - start + Math.min(OVERLAP_BYTES, size - end);
      var read = fs.readSync(fd, buffer, 0, length, start);
      // latin1: one byte per character, and every pattern here is ASCII.
      var text = buffer.toString("latin1", 0, read);
      var match;

      MONITOR_RE.lastIndex = 0;
      while ((match = MONITOR_RE.exec(text))) {
        var dir = unquote(match[2]);
        var ids = match[1].match(ID_RE) || [];
        for (var i = 0; i < ids.length; i += 1) {
          var entry = claim(ids[i]);
          if (entry && dir) entry.stateDirs.add(dir);
        }
      }
      LIBRARY_RE.lastIndex = 0;
      while ((match = LIBRARY_RE.exec(text))) claim(match[1]);
      LIBRARY_JSON_RE.lastIndex = 0;
      while ((match = LIBRARY_JSON_RE.exec(text))) claim(match[1]);
      TAKEOVER_RE.lastIndex = 0;
      while ((match = TAKEOVER_RE.exec(text))) {
        var taken = claim(match[1]);
        if (taken) taken.takeoverRevs.add(Number(match[2]));
      }
      end = start;
    }
  } finally {
    fs.closeSync(fd);
  }
  return found;
}

function readJson(file) {
  try {
    var parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

/**
 * Has the reviewer ended every review this session owns? A session with no
 * reviews (a Library session) has nothing ended, so it still needs watching.
 */
function everyReviewEnded(dir, id) {
  var root = stateDir.reviewsRoot(dir);
  var names;
  try {
    names = fs.readdirSync(root);
  } catch (err) {
    return false;
  }
  var owned = 0;
  for (var i = 0; i < names.length; i += 1) {
    if (!protocol.isSafeId(names[i])) continue;
    var meta = readJson(path.join(root, names[i], "meta.json"));
    if (!meta || meta.agent_session_id !== id) continue;
    owned += 1;
    // The projection nests the review's own fields under `review`
    // (review_format.projectReview).
    var projection = readJson(path.join(root, names[i], "review.json"));
    var inner = projection && projection.review && typeof projection.review === "object" ? projection.review : null;
    if (!inner || !inner.ended_at) return false;
  }
  return owned > 0;
}

/**
 * Is a monitor running for this session at this handoff rev?
 *
 * WIDER THAN THE RAIL'S RULE ON PURPOSE. The rail also asks that the heartbeat
 * be fresher than HEARTBEAT_FRESH_MS. Here age is ignored: after the machine
 * sleeps, a monitor that is alive has simply not looped yet, and blocking then
 * would start a second monitor beside it. Every deliberate monitor exit removes
 * its own heartbeat, and a killed one leaves a pid that no longer exists, so a
 * heartbeat at this rev from a live pid is a running monitor. The cost is a pid
 * the OS reused for something else, which reads as watching until it exits.
 */
function monitorAlive(heartbeat, rev, pidAlive) {
  if (!heartbeat) return false;
  var field = protocol.MONITOR.HEARTBEAT_FIELD;
  if (heartbeat[field.HANDOFF_REV] !== rev) return false;
  var alive = typeof pidAlive === "function" ? pidAlive : agentSessions.pidAlive;
  return alive(heartbeat[field.PID]);
}

/**
 * Does this session need a watcher this agent should start? Null when not.
 *
 * Reads the session record itself: any doubt (unreadable, wrong schema) is a
 * no, because a hook that blocks on a guess is worse than one that says nothing.
 */
function unwatched(dir, id, claim, opts) {
  var session;
  try {
    session = agentSessions.createStore({ dir: dir }).read(id);
  } catch (err) {
    return null;
  }
  if (!session || session.synthetic || session.closed_at) return null;
  var rev = agentSessions.handoffRev(session);
  // Taken over since this agent last held it: rev 0 is the agent that started
  // it, and a later rev belongs to whoever printed that rev at takeover.
  if (rev === 0 ? false : !claim.takeoverRevs.has(rev)) return null;
  if (monitorAlive(readJson(stateDir.monitorPath(dir, id)), rev, opts.pidAlive)) return null;
  if (everyReviewEnded(dir, id)) return null;
  return { id: id, stateDir: stateDir.flagFor(dir) };
}

/**
 * The words the agent reads. One monitor command per state directory, holding
 * every unwatched session in it, since one monitor watches several.
 *
 * @param {{id: string, stateDir: string|null}[]} sessions
 * @param {number} timeoutMs
 */
function blockReason(sessions, timeoutMs) {
  var byDir = new Map();
  sessions.forEach(function (entry) {
    var key = entry.stateDir || "";
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key).push(entry.id);
  });
  var commands = [];
  byDir.forEach(function (ids, key) {
    commands.push("  " + protocol.monitorCommand(ids, key || null));
  });
  var ids = sessions.map(function (entry) { return entry.id; });
  var subject = ids.length === 1
    ? "your review session " + ids[0]
    : "your review sessions " + ids.join(", ");
  return (
    "Lahe: nothing is watching " + subject + ", so the reviewer's next comment will go unanswered. " +
    "Before you end this turn, start the watcher again with the Bash tool, run_in_background true and timeout " +
    timeoutMs + ":\n\n" +
    commands.join("\n") + "\n\n" +
    (commands.length === 1 ? "Run only that one command" : "Run only those commands") +
    "; there is no need to drain or to message the reviewer first. " +
    (sessions.length === 1
      ? "If the human has said this review is over, close the session instead with lahe session close " +
        sessions[0].id + protocol.stateDirFlag(sessions[0].stateDir) + ". "
      : "If the human has said a review is over, close that session instead with lahe session close <id>. ") +
    "If the session is not yours, say so in one line and end your turn."
  );
}

function parseArgs(argv) {
  var list = argv || [];
  var out = { event: list[0] || null, stateDir: null, help: false };
  for (var i = 1; i < list.length; i += 1) {
    if (list[i] === "--help" || list[i] === "-h") out.help = true;
    else if (list[i] === "--state-dir" && list[i + 1] !== undefined) out.stateDir = list[(i += 1)];
  }
  if (out.event === "--help" || out.event === "-h") out.help = true;
  return out;
}

function readStdin() {
  if (process.stdin.isTTY) return "";
  return fs.readFileSync(0, "utf8");
}

/**
 * The Stop decision, or null for "let the turn end".
 *
 * @returns {{decision: "block", reason: string}|null}
 */
function decideStop(payload, args, opts) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.stop_hook_active !== false) return null;
  if (typeof payload.transcript_path !== "string" || !payload.transcript_path) return null;

  var claims = scanTranscript(payload.transcript_path);
  if (claims.size === 0) return null;

  var env = opts.env;
  // A default directory that is refused (inside a checkout, say) only takes the
  // default out of the search. Sessions under a printed --state-dir still count.
  var defaultDir = null;
  try {
    defaultDir = args.stateDir
      ? stateDir.stateDir({ dir: args.stateDir })
      : env.LAHE_STATE_DIR
        ? stateDir.stateDir({ dir: env.LAHE_STATE_DIR })
        : stateDir.stateDir();
  } catch (err) {
    defaultDir = null;
  }

  var found = [];
  claims.forEach(function (claim, id) {
    // The directory the agent was told about, then the default one. A session
    // that is in neither is not one this hook can judge, so it is left alone.
    var dirs = Array.from(claim.stateDirs);
    if (defaultDir) dirs.push(defaultDir);
    for (var i = 0; i < dirs.length; i += 1) {
      var dir;
      try {
        dir = stateDir.stateDir({ dir: dirs[i] });
        if (!fs.existsSync(stateDir.agentSessionPath(dir, id))) continue;
      } catch (err) {
        continue;
      }
      var entry = unwatched(dir, id, claim, opts);
      if (entry) found.push(entry);
      return;
    }
  });
  if (found.length === 0) return null;
  found.sort(function (a, b) { return a.id.localeCompare(b.id); });
  return { decision: "block", reason: blockReason(found, maxTimeoutMs(env)) };
}

/**
 * @param {string[]} argv everything after `lahe hook`
 * @param {{stdin?: string, stdout?: function, stderr?: function, env?: object,
 *          nowMs?: number, pidAlive?: function}} [options]
 * @returns {Promise<number>} always 0
 */
async function run(argv, options) {
  var opts = options || {};
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  try {
    var args = parseArgs(argv);
    if (args.help) {
      out(USAGE + "\n");
      return protocol.CLI_EXIT.OK;
    }
    if (args.event !== "stop") return protocol.CLI_EXIT.OK;
    var text = typeof opts.stdin === "string" ? opts.stdin : readStdin();
    var payload = JSON.parse(text);
    var decision = decideStop(payload, args, {
      env: opts.env || process.env,
      nowMs: typeof opts.nowMs === "number" ? opts.nowMs : Date.now(),
      pidAlive: opts.pidAlive
    });
    if (decision) out(JSON.stringify(decision) + "\n");
  } catch (err) {
    // Silence. A hook that fails loudly is shown to the human on every turn.
  }
  return protocol.CLI_EXIT.OK;
}

module.exports = {
  USAGE: USAGE,
  DEFAULT_MAX_TIMEOUT_MS: DEFAULT_MAX_TIMEOUT_MS,
  TRANSCRIPT_CAP_BYTES: TRANSCRIPT_CAP_BYTES,
  CHUNK_BYTES: CHUNK_BYTES,
  maxTimeoutMs: maxTimeoutMs,
  scanTranscript: scanTranscript,
  blockReason: blockReason,
  decideStop: decideStop,
  run: run
};
