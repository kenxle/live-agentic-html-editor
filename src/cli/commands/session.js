// Open and close durable agent workstreams, and lease the shared helper only
// while at least one workstream is open.

"use strict";

var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var stateDir = require("../../service/state_dir.js");
var sessions = require("../../service/agent_sessions.js");
var service = require("../../service/index.js");
var sourceStamp = require("../../service/source_stamp.js");
var reviewsModule = require("../../service/reviews.js");
var catalogReader = require("../../service/catalog_reader.js");
var loginItem = require("../../service/login_item.js");
var selfStop = require("../../service/self_stop.js");

var statusCommand = require("./status.js");
var projection = require("../../service/projection.js");
var eventLog = require("../../service/log.js");

var BIN = path.join(__dirname, "..", "..", "..", "bin", "lahe.js");
// Every action `lahe session` accepts. parse() validates against this list, so
// a test can read the real actions instead of restating them.
var ACTIONS = ["list", "close", "reopen", "takeover", "name"];
var USAGE = [
  "usage: lahe session <list|close|reopen|takeover|name> [session-id] [--port <n>] [--state-dir <path>] [--json]",
  "",
  "  list      every agent session on this machine, open ones first. Read-only: it takes no id",
  "            and changes nothing. This is how you FIND a session id.",
  "  close     end a session, keep its review history",
  "  reopen    reopen a closed session you already own",
  "  takeover  explicitly continue another agent's session, only when the human asks for it.",
  "            --name \"<name>\" records the human's name for your session at the same time.",
  "            While the session's agent is listening it is refused, unless --request <id> names",
  "            the pending Library request (Pick this up, or Launch) that asked for it",
  "  name      lahe session name <id> \"<name>\": the human's name for this session, shown on",
  "            the reviewer's rail so they know which agent to check. \"\" clears it.",
  "            lahe session name <id> --from-review <review> names it after that review's",
  "            document, as the Library shows it",
  "",
  "  --json    with list: one JSON object per session, then one summary line"
].join("\n");

var BUSY_SENTENCE =
  "the helper was busy taking a reviewer's changes, so it was left running; the next lahe command replaces it";

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitFor(check, timeoutMs) {
  var end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await delay(50);
  }
  return false;
}

function parse(argv) {
  var list = argv || [];
  var action = list[0] || null;
  // `list` is the only action that takes no id: it is the command an agent runs
  // BECAUSE it has no id yet. Its options therefore start one slot earlier.
  var listing = action === "list";
  // `name` takes the name itself as its second positional, and an empty one is
  // a real answer (it clears the name), so it is read before the options.
  var naming = action === "name";
  var out = { action: action, id: listing ? null : list[1] || null, port: null, stateDir: null, json: false };
  var start = listing ? 1 : 2;
  if (naming && list[2] === "--from-review") {
    // The Library's Launch: name the session after a review's display name,
    // read here from the state dir, so the title never passes through a shell.
    if (!protocol.isSafeId(list[3])) return { error: "--from-review takes a review id: lahe session name <id> --from-review <review>" };
    out.fromReview = String(list[3]);
    start = 4;
  } else if (naming) {
    if (list.length < 3 || /^--/.test(String(list[2]))) return { error: "name takes a session id and a name: lahe session name <id> \"<name>\"" };
    out.name = String(list[2]);
    start = 3;
  }
  for (var i = start; i < list.length; i += 1) {
    if (list[i] === "--json") out.json = true;
    else if (list[i] === "--name" && list[i + 1] !== undefined && action === "takeover") out.name = String(list[(i += 1)]);
    else if (list[i] === "--request" && list[i + 1] !== undefined && action === "takeover") out.request = String(list[(i += 1)]);
    else if (list[i] === "--port" && list[i + 1] !== undefined) out.port = Number(list[(i += 1)]);
    else if (list[i] === "--state-dir" && list[i + 1] !== undefined) out.stateDir = list[(i += 1)];
    else return { error: "unknown or incomplete option " + JSON.stringify(list[i]) };
  }
  if (listing) {
    if (out.port !== null) return { error: "list takes no --port" };
    return out;
  }
  if (ACTIONS.indexOf(out.action) === -1) {
    return { error: "expected " + ACTIONS.slice(0, -1).join(", ") + ", or " + ACTIONS[ACTIONS.length - 1] };
  }
  if (out.json) return { error: "--json is only for `lahe session list`" };
  if (!protocol.isSafeId(out.id)) return { error: "session id must match " + String(protocol.SAFE_ID) };
  if (out.port !== null && (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535)) return { error: "--port takes a port number" };
  return out;
}

function readReady(dir) {
  try { return JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8")); } catch (err) { return null; }
}

async function stopVerifiedHelper(dir) {
  var ready = readReady(dir);
  if (!ready || typeof ready.pid !== "number" || typeof ready.port !== "number") return false;
  var live = await service.probeHealth(protocol.DEFAULT_HOST, ready.port);
  if (!live) return false;
  if (live.started_at !== ready.started_at) {
    throw new Error("refusing to stop an unverified pid from service.json");
  }
  try { process.kill(ready.pid, "SIGTERM"); } catch (err) { if (err.code !== "ESRCH") throw err; }
  var stopped = await waitFor(async function () {
    return !(await service.probeHealth(protocol.DEFAULT_HOST, ready.port));
  }, 10000);
  if (!stopped) throw new Error("the helper did not stop within 10 seconds");
  return true;
}

/**
 * Should the last `session close` leave the helper running? (LAHE Library,
 * architecture "Helper lifetime (R10a)".)
 *
 * The Library is the first page that must outlive every session: a reviewer
 * browsing it, or reading a document it opened, would otherwise lose both the
 * moment the last agent closed its session. So the helper stays up when:
 *
 *   - the Library page polled it within LIBRARY_SEEN_MS (health's
 *     catalog_seen_at, which only an authenticated list moves), or
 *   - any document window is still held (the same windows.json read the CLI
 *     already makes before replacing a helper).
 *
 * When it keeps the helper, the close leaves stop-when-quiet.json behind
 * (askStopWhenQuiet), and the helper stops itself once there is no open
 * session, no open review window and no Library poll for two minutes
 * (src/service/self_stop.js). Before that ask existed, nothing stopped it.
 *
 * @param {string} dir
 * @param {number} nowMs
 * @returns {Promise<{keep: boolean, why: string|null}>}
 */
async function helperStillWanted(dir, nowMs) {
  var ready = readReady(dir);
  if (ready && typeof ready.port === "number") {
    var live = await service.probeHealth(protocol.DEFAULT_HOST, ready.port);
    // AN ALWAYS-ON HELPER STAYS UP THROUGH EVERY CLOSE. It serves every page
    // at its stable address, so stopping it would take every page down until
    // the login item restarted it. Said by the helper itself, or by the
    // install recorded for this port.
    if ((live && live.always_on === true) || loginItem.installedFor(dir, ready.port)) {
      return { keep: true, why: "it is always on", always: true };
    }
    var seen = live ? Date.parse(live[protocol.HEALTH_FIELD.CATALOG_SEEN_AT]) : NaN;
    if (!Number.isNaN(seen) && nowMs - seen < protocol.CATALOG.LIBRARY_SEEN_MS) {
      return {
        keep: true,
        why: "the Library page polled it " + Math.max(0, Math.round((nowMs - seen) / 1000)) + "s ago"
      };
    }
  }
  if (reviewsModule.readLiveHolders(dir, reviewsModule.LIVE_WINDOW_MS, nowMs).length > 0) {
    return { keep: true, why: "for an open review page" };
  }
  return { keep: false, why: null };
}

/**
 * The last close left the helper up: ask it to stop itself once that reason
 * is gone (src/service/self_stop.js). A failed write only loses the ask; the
 * close itself stands.
 */
function askStopWhenQuiet(dir, nowMs, why) {
  try {
    stateDir.writeAtomic(
      stateDir.stopWhenQuietPath(dir),
      JSON.stringify({ asked_at: new Date(nowMs).toISOString(), why: why || null }, null, 2) + "\n"
    );
  } catch (err) {
    /* the helper keeps running, as it did before the ask existed */
  }
}

function realOrSame(p) {
  try { return fs.realpathSync(p); } catch (err) { return path.resolve(p); }
}

/**
 * Installed from another clone: the sentence to say instead of restarting.
 *
 * The login item runs the clone it was installed from. Restarting it because
 * THIS clone needs a newer service contract only runs that same older clone
 * again, after dropping every open page for the restart. So a CLI from another
 * clone says so and leaves the helper alone. Null when the login item runs
 * this clone, or when nothing is installed.
 */
function otherCloneSentence(installed) {
  if (!installed || !installed.clone) return null;
  var here = path.join(__dirname, "..", "..", "..");
  if (realOrSame(installed.clone) === realOrSame(here)) return null;
  return "the login item runs " + installed.clone + ", whose helper is older than this clone needs. " +
    "Run `lahe install` from this clone (" + realOrSame(here) + ") to have the login item run it instead";
}

/**
 * Is the running helper older than its code, and if so, may it go now?
 *
 * SOMEBODY IS REVIEWING ON IT. Being older than the code on disk is a reason to
 * replace the helper, not a reason to interrupt a person who is mid-sentence in
 * a comment box. The stale helper keeps serving them and the caller says so;
 * `lahe serve --restart` (`force`) is how a human overrules it.
 *
 * INSTALLED, the code is the clone the login item runs, and an open window does
 * not hold the helper back: an always-on helper serves every page all the time,
 * so some window is nearly always open, and the layer rides out a restart. It
 * waits only for a quiet moment with no review writes.
 *
 * @param {string} dir
 * @param {object} live the running helper's /health
 * @param {object|null} installed install.json for this port, or null
 * @param {{force?: boolean, now?: number, quietMs?: number, quietMaxMs?: number}} [options]
 * @returns {Promise<{stale: boolean, keep: string|null}>} `keep` is the sentence
 *   saying why a stale helper was left running
 */
async function staleDecision(dir, live, installed, options) {
  var opts = options || {};
  var roots = installed && installed.clone ? { roots: loginItem.sourceRoots(installed) } : undefined;
  if (!sourceStamp.helperPredatesSource(live.started_at, roots).stale) return { stale: false, keep: null };
  if (opts.force) return { stale: true, keep: null };
  if (installed) {
    var quiet = await loginItem.waitForQuiet(dir, { quietMs: opts.quietMs, maxMs: opts.quietMaxMs });
    return { stale: true, keep: quiet ? null : BUSY_SENTENCE };
  }
  var holders = reviewsModule.readLiveHolders(dir, reviewsModule.LIVE_WINDOW_MS, opts.now);
  return { stale: true, keep: holders.length > 0 ? reviewsModule.liveReviewerSentence(holders) : null };
}

/**
 * Make sure a helper this clone can talk to is running, and leave a current one
 * exactly where it is.
 *
 * Two things say the running one is behind: a lower service contract, which is
 * hand-bumped and so only catches what somebody remembered to declare, and the
 * mtimes of the code it loaded, which nobody has to remember (see
 * src/service/source_stamp.js). Either one gets it stopped and started again;
 * neither costs anything when the helper is current, because the source check
 * only runs when one is answering.
 *
 * A stale helper with a live review page open on it is left alone: replacing it
 * drops that page's connection and closes the comment boxes the reviewer has
 * open, and being a few minutes behind the code is the smaller problem.
 * `keptForReviewer` carries the sentence that says so.
 *
 * @param {string} dir the resolved state directory
 * @param {number} port
 * @param {{force?: boolean, now?: number}} [options] `force` replaces the helper
 *   even with a reviewer on it, which is what `lahe serve --restart` asks for
 * @returns {Promise<{started: boolean, stale: boolean, keptForReviewer: string|null}>}
 *   `started` is true when this call put a new process there, whether or not it
 *   replaced one.
 */
async function startHelper(dir, port, options) {
  var opts = options || {};
  var stale = false;
  // INSTALLED (lahe install): a login item runs the helper. This never spawns
  // one; it asks the login item, judges staleness by the clone the login item
  // runs, and lets an open window wait only for a quiet moment.
  var installed = loginItem.installedFor(dir, port);
  var live = await service.probeHealth(protocol.DEFAULT_HOST, port);
  if (live) {
    if (selfStop.stateFolderMismatch(dir, live)) {
      throw new Error(selfStop.differentFolderSentence(protocol.DEFAULT_HOST, port, dir));
    }
    var liveContract = Number.isInteger(live.service_contract) ? live.service_contract : 0;
    var verdict = protocol.helperContractVerdict(live);
    if (verdict === protocol.CONTRACT_VERDICT.NEWER) {
      throw new Error(
        "the running helper uses newer service contract " + liveContract +
        "; update this clone before changing the session"
      );
    }
    if (verdict === protocol.CONTRACT_VERDICT.OLDER && otherCloneSentence(installed)) {
      throw new Error(otherCloneSentence(installed));
    }
    if (verdict === protocol.CONTRACT_VERDICT.CURRENT) {
      var decision = await staleDecision(dir, live, installed, opts);
      stale = decision.stale;
      if (!stale) return { started: false, stale: false, keptForReviewer: null };
      if (decision.keep) return { started: false, stale: true, keptForReviewer: decision.keep };
    }
    // A replacement is a start: while the menu's Stop holds, refuse before
    // stopping anything.
    loginItem.refuseWhileStopped(dir);
    if (!(await stopVerifiedHelper(dir))) {
      throw new Error("refusing to replace an older helper whose process identity cannot be verified");
    }
  }
  var isUp = function () { return service.probeHealth(protocol.DEFAULT_HOST, port); };
  if (installed) {
    await loginItem.startThroughItem(installed, isUp, { runner: opts.runner, waitMs: opts.waitMs });
    return { started: true, stale: stale, keptForReviewer: null };
  }
  // Not installed for this port: the menu's Stop still holds the whole state
  // folder, so no helper is spawned on another port either.
  loginItem.refuseWhileStopped(dir);
  var child = childProcess.spawn(process.execPath, [BIN, "serve", "--port", String(port), "--state-dir", dir], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  var started = await waitFor(isUp, 10000);
  if (!started) throw new Error("the helper did not start within 10 seconds");
  return { started: true, stale: stale, keptForReviewer: null };
}

// ---------------------------------------------------------------------------
// `lahe session list`
// ---------------------------------------------------------------------------
//
// WHY IT EXISTS. A human says "claim the lahe session" and the agent has no id.
// Every other session action needs one, so without this command the agent's
// only move was to guess, or to go looking through its HOST's sessions, which
// are a different thing entirely (2026-08-20). This command is read-only: it
// starts nothing, stops nothing, and marks nothing seen.
//
// It reuses the routing and work definitions rather than restating them:
// ownership comes from status.ownerOfReview, an item counts as work only
// through record.isUnansweredReady (status.isUnansweredReady), and watcher
// liveness comes from the session store's own liveness helper.

/** The unanswered ready work in one review, read straight off the log. */
function reviewWork(dir, reviewId) {
  var events;
  try {
    events = eventLog.createEventLog({ dir: dir }).read(reviewId);
  } catch (err) {
    return { unanswered: 0, oldestUnansweredAt: null, lastItemAt: null };
  }
  if (!events.length) return { unanswered: 0, oldestUnansweredAt: null, lastItemAt: null };
  var items = statusCommand.itemsOf(projection.project(reviewId, events));
  var open = items.filter(statusCommand.isUnansweredReady);
  var oldest = null;
  open.forEach(function (item) {
    // WHEN IT LAST BECAME WORK, not when the card was opened. A card reworded a
    // minute ago is a minute of waiting, and "oldest unanswered 1d" about it is
    // the staleness signal this whole branch exists to take away. Same order as
    // routes.js unansweredWork.
    var at = item.reviewer_last_changed_at || item.card_first_created_at || null;
    if (typeof at === "string" && at && (!oldest || at < oldest)) oldest = at;
  });
  return { unanswered: open.length, oldestUnansweredAt: oldest, lastItemAt: statusCommand.lastItemAt(items) };
}

function newest() {
  var best = null;
  for (var i = 0; i < arguments.length; i += 1) {
    var at = arguments[i];
    if (typeof at === "string" && at && (!best || at > best)) best = at;
  }
  return best;
}

/**
 * One row per agent session on disk, open first and newest activity first.
 *
 * @param {{dir: string, nowMs?: number}} input
 */
function collect(input) {
  var spec = input || {};
  var dir = spec.dir;
  var nowMs = typeof spec.nowMs === "number" ? spec.nowMs : Date.now();
  var store = sessions.createStore({ dir: dir });

  var owners = Object.create(null);
  statusCommand.reviewsOnDisk(dir).forEach(function (reviewId) {
    var owner = statusCommand.ownerOfReview(dir, reviewId);
    if (!owners[owner]) owners[owner] = [];
    owners[owner].push(reviewId);
  });

  var rows = store.list().map(function (session) {
    var owned = owners[session.id] || [];
    var unanswered = 0;
    var oldestUnansweredAt = null;
    var lastItemAt = null;
    owned.forEach(function (reviewId) {
      var work = reviewWork(dir, reviewId);
      unanswered += work.unanswered;
      if (work.oldestUnansweredAt && (!oldestUnansweredAt || work.oldestUnansweredAt < oldestUnansweredAt)) {
        oldestUnansweredAt = work.oldestUnansweredAt;
      }
      lastItemAt = newest(lastItemAt, work.lastItemAt);
    });
    var liveness = store.liveness(session.id, {
      unanswered: unanswered,
      oldestUnansweredAt: oldestUnansweredAt,
      nowMs: nowMs
    });
    var monitorAt = liveness[protocol.AGENT_LIVENESS.FIELD.MONITOR_AT];
    return {
      id: session.id,
      name: sessions.cleanName(session.name),
      open: !session.closed_at,
      closed_at: session.closed_at || null,
      handoff_rev: sessions.handoffRev(session),
      reviews: owned.length,
      unanswered_ready: unanswered,
      liveness: liveness,
      last_activity_at: newest(
        session.created_at,
        session.taken_over_at,
        session.closed_at,
        liveness[protocol.AGENT_LIVENESS.FIELD.ACTIVITY_AT],
        monitorAt,
        lastItemAt
      )
    };
  });

  rows.sort(function (a, b) {
    if (a.open !== b.open) return a.open ? -1 : 1;
    var left = a.last_activity_at || "";
    var right = b.last_activity_at || "";
    if (left !== right) return left < right ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
  return rows;
}

/**
 * Whether anything on this machine is listening to this session, and when the
 * agent last answered.
 *
 * THIS IS THE OPERATOR'S VIEW, not the reviewer's. The reviewer's rail says how
 * long it has been since a reply and never mentions watchers, because a watcher
 * is our plumbing and not something they can act on. Here the plumbing is
 * exactly the point: this column is how a human finds the session whose agent
 * wandered off.
 *
 * `listening` is a merged verdict over three facts the helper reads off the
 * machine: something holds the session's wake feed open, a monitor heartbeat is
 * fresh and its pid still exists, or a lahe command ran recently. Null means the
 * machine could not be asked, which prints as unknown rather than as nobody.
 */
function watcherText(row, nowMs) {
  var listening = row.liveness[protocol.AGENT_LIVENESS.FIELD.LISTENING];
  var replyAt = row.liveness[protocol.AGENT_LIVENESS.FIELD.LAST_REPLY_AT];
  var word = listening === true ? "listening" : listening === false ? "no watcher" : "watcher unknown";
  var replied = replyAt ? statusCommand.ago(replyAt, nowMs) : null;
  return replied ? word + ", replied " + replied : word;
}

function listLine(row, nowMs) {
  return (
    row.id +
    // Quoted with JSON's rules, so a name with spaces or quotes stays one field.
    (row.name ? "  " + JSON.stringify(row.name) : "") +
    "  " +
    (row.open ? "open" : "closed " + row.closed_at) +
    "  handoff " + row.handoff_rev +
    "  reviews " + row.reviews +
    "  unanswered " + row.unanswered_ready +
    "  " + watcherText(row, nowMs)
  );
}

/**
 * Is there a pending Library request (pickup or launch) with this id, asking
 * for this session? The same queue check add.js makes for --adopt.
 */
function confirmedByLibrary(dir, sessionId, requestId) {
  if (!protocol.isSafeId(requestId)) return false;
  try {
    var catalogRequests = require("../../service/catalog_requests.js");
    return catalogRequests.createQueue({ dir: dir }).pending(Date.now()).some(function (request) {
      return request.id === requestId && request.session === sessionId &&
        catalogRequests.ACTIONS.indexOf(request.action) !== -1;
    });
  } catch (err) {
    return false;
  }
}

var TAKEOVER_HINT = "claim one with: lahe session takeover <id> (requires the human's explicit request)";

async function runList(args, opts) {
  var out = opts.stdout;
  var err = opts.stderr;
  var nowMs = typeof opts.now === "number" ? opts.now : Date.now();
  var dir;
  try { dir = args.stateDir ? stateDir.stateDir({ dir: args.stateDir }) : stateDir.stateDir(); }
  catch (error) { err("lahe session: " + error.message + "\n"); return 1; }

  // Ask the machine who is listening BEFORE reading the rows. This process is
  // about to exit, so the rail's take-the-last-answer rule would leave every
  // session reading "watcher unknown".
  try {
    var store = sessions.createStore({ dir: dir });
    await store.warmWatching(store.openSessions().map(function (session) { return session.id; }));
  } catch (error) { /* an unwarmed probe prints unknown, which is honest */ }

  var rows;
  try { rows = collect({ dir: dir, nowMs: nowMs }); }
  catch (error) { err("lahe session: " + error.message + "\n"); return 1; }

  if (args.json) {
    rows.forEach(function (row) { out(JSON.stringify(row) + "\n"); });
    out(JSON.stringify({
      sessions: rows.length,
      open: rows.filter(function (row) { return row.open; }).length,
      unanswered_ready: rows.reduce(function (sum, row) { return sum + row.unanswered_ready; }, 0),
      state_dir: dir
    }) + "\n");
    return protocol.CLI_EXIT.OK;
  }

  if (rows.length === 0) {
    // A plain sentence rather than an error: no sessions is a normal state, and
    // an agent that just arrived needs to be told that in words.
    out("no agent sessions in " + stateDir.agentSessionsRoot(dir) + "\n");
    return protocol.CLI_EXIT.OK;
  }
  rows.forEach(function (row) { out(listLine(row, nowMs) + "\n"); });
  out(TAKEOVER_HINT + "\n");
  return protocol.CLI_EXIT.OK;
}

async function run(argv, options) {
  var opts = options || {};
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var errOut = opts.stderr || function (text) { process.stderr.write(text); };
  if ((argv || []).indexOf("--help") !== -1 || (argv || []).indexOf("-h") !== -1) {
    out(USAGE + "\n");
    return protocol.CLI_EXIT.OK;
  }
  var args = parse(argv);
  if (args.error) {
    errOut("lahe session: " + args.error + "\n\n" + USAGE + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  if (args.action === "list") return runList(args, { stdout: out, stderr: errOut, now: opts.now });
  var dir;
  try { dir = args.stateDir ? stateDir.stateDir({ dir: args.stateDir }) : stateDir.stateDir(); }
  catch (err) { errOut("lahe session: " + err.message + "\n"); return 1; }
  var store = sessions.createStore({ dir: dir });
  try {
    if (args.action === "name") {
      var newName = args.name;
      if (args.fromReview) {
        var described = catalogReader.createReader({ dir: dir }).describeReview(args.fromReview, opts.now);
        if (!described) throw new Error("no review " + JSON.stringify(args.fromReview) + " in " + dir);
        if (described.session !== args.id) {
          throw new Error(
            "review " + args.fromReview + " belongs to agent session " + described.session + ", not " + args.id
          );
        }
        // A page title can run long: cut it where a word ends, not mid-word.
        newName = sessions.fitName(described.display_name);
      }
      var renamed = store.setName(args.id, newName, args.fromReview ? { source: sessions.NAME_SOURCE_PAGE } : undefined);
      out(
        "agent session " + args.id +
          (renamed.name ? " is named " + JSON.stringify(renamed.name) : " has no name now") + "\n"
      );
    } else if (args.action === "close") {
      // Only the session closes. Its pages stay at their addresses, served by
      // the helper, for as long as the helper runs.
      store.close(args.id);
      var stopped = false;
      var kept = null;
      if (store.openSessions().length === 0) {
        var wanted = await helperStillWanted(dir, typeof opts.now === "number" ? opts.now : Date.now());
        if (wanted.keep) {
          kept = wanted.why;
          // An always-on helper is never asked to stop once quiet either.
          if (!wanted.always) askStopWhenQuiet(dir, typeof opts.now === "number" ? opts.now : Date.now(), wanted.why);
        } else {
          stopped = await stopVerifiedHelper(dir);
        }
      }
      out(
        "agent session " + args.id + " closed; review history kept" +
          (stopped ? "; shared helper stopped" : "") +
          (kept ? "; shared helper left running" + (/^for /.test(kept) ? " " : ": ") + kept : "") + "\n"
      );
    } else {
      var handedOff = args.action === "takeover";
      // A HANDOFF OF A SESSION SOMEONE IS WATCHING IS THE HUMAN'S CALL. The
      // Library asks the human first, naming the agent that is listening; the
      // CLI has no way to ask, so it refuses. Takeover of a closed session, or
      // one nobody is listening to, cuts nobody off and goes ahead.
      // The Library's confirmed handoff ends here: "Pick this up" and "Launch a
      // new agent" both finish with this command, carrying the pending
      // request's id. A pending request for THIS session is the human's
      // confirmation, and only the Library page (its own token) makes one.
      if (handedOff && sessions.isListening(store, args.id, Date.now()) && !confirmedByLibrary(dir, args.id, args.request)) {
        process.stderr.write(
          "lahe session: agent session " + args.id + " has an agent listening to it right now, so it is not " +
            "taken over from here. A handoff of a session someone is watching is confirmed by your human from the " +
            "Library page, and the request it makes names the command to run. Ask them.\n"
        );
        return protocol.CLI_EXIT.BAD_USAGE;
      }
      var session = handedOff
        ? store.takeover(args.id, args.name !== undefined ? { name: args.name } : undefined)
        : store.reopen(args.id);
      var prior = readReady(dir);
      var port = args.port || (prior && prior.port) || protocol.DEFAULT_PORT;
      var helperRun = await startHelper(dir, port);
      var helperNote = "; shared helper already running";
      if (helperRun.started) helperNote = helperRun.stale ? "; shared helper restarted" : "; shared helper started";
      // The helper line below says why: an open review page, or a busy helper.
      else if (helperRun.keptForReviewer) helperNote = "; shared helper left running";
      var message =
        "agent session " + args.id + (handedOff ? " taken over explicitly" : " reopened") +
          helperNote +
          "\n";
      // Never a silent bounce: a restart drops every open review page's
      // connection for a moment, and the person watching that page is owed the
      // reason.
      if (helperRun.keptForReviewer) {
        message += "  helper    " + helperRun.keptForReviewer + "\n";
      } else if (helperRun.stale) {
        message +=
          "  helper    " + sourceStamp.REASON + ", so it was stopped and started again\n" +
          "            any review page open right now goes unreachable for a moment and reconnects on its own\n";
      }
      if (handedOff) {
        message +=
          "  handoff   " + session.handoff_rev + "  (older lahe monitor processes exit with " +
            protocol.CLI_EXIT.SESSION_TAKEN_OVER + ")\n" +
          "  catch-up  lahe status --session " + args.id + " --json\n" +
          "            handle every unanswered item before you start watching\n" +
          sessions.commandBlock({ dir: dir, session: args.id });
      }
      out(message);
    }
    return protocol.CLI_EXIT.OK;
  } catch (err) {
    errOut("lahe session: " + err.message + "\n");
    return 1;
  }
}

module.exports = {
  USAGE: USAGE,
  ACTIONS: ACTIONS,
  TAKEOVER_HINT: TAKEOVER_HINT,
  parse: parse,
  collect: collect,
  listLine: listLine,
  watcherText: watcherText,
  stopVerifiedHelper: stopVerifiedHelper,
  helperStillWanted: helperStillWanted,
  startHelper: startHelper,
  staleDecision: staleDecision,
  otherCloneSentence: otherCloneSentence,
  run: run
};
