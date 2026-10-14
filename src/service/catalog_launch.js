// Launching a new agent from the Library, by the helper itself.
//
// Owner: LAHE Library, direct launch (the architecture's Open Question 1).
//
// WHAT THIS IS. "Launch a new agent" on a Library row opens a new Terminal
// window running the agent's command line (`claude` or `codex`) in the
// document's project folder, with the hand-off message as its first prompt.
// Until this module, only an attached agent could do that, following the
// recipe in the skill. On a Mac the helper now does it itself, so the button
// works with no agent attached. Anywhere else the request still goes to the
// attached agent, which follows the skill.
//
// WHY IT IS SAFE TO RUN FROM A BUTTON. The command is fixed: `osascript` with
// a script spelled here, taking the host command and two file paths as
// arguments. No shell string is built. The hand-off message and the folder
// are written to files under the state folder and read back by the script,
// and `quoted form of` makes each one word for the new shell. Nothing a page
// wrote reaches the command line: the request carries ids only, the session
// name the hand-off quotes is the one `lahe session name` keeps (cleaned, cut),
// and the folder comes from records a page cannot write (launchRoot).
//
// Node-only.

"use strict";

var childProcess = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");
var agentSessions = require("./agent_sessions.js");

// The hosts with a command line a new Terminal window can run. The default
// is Claude Code; LAHE_LAUNCH_HOST=codex picks Codex.
var HOSTS = ["claude", "codex"];
var DEFAULT_HOST = "claude";
var LAUNCH_DIR = "launches";

// The AppleScript the skill spells for an agent, verbatim: argv is the host,
// the hand-off file, and (when there is a folder) the folder file.
var SCRIPT_WITH_FOLDER = [
  "on run argv",
  "set msg to read (POSIX file (item 2 of argv)) as «class utf8»",
  "set dir to paragraph 1 of (read (POSIX file (item 3 of argv)) as «class utf8»)",
  "tell application \"Terminal\"",
  "activate",
  "do script \"cd \" & (quoted form of dir) & \" && \" & (quoted form of (item 1 of argv)) & \" \" & (quoted form of msg)",
  "end tell",
  "end run"
];
var SCRIPT_NO_FOLDER = [
  "on run argv",
  "set msg to read (POSIX file (item 2 of argv)) as «class utf8»",
  "tell application \"Terminal\"",
  "activate",
  "do script (quoted form of (item 1 of argv)) & \" \" & (quoted form of msg)",
  "end tell",
  "end run"
];

// What the Library row says after the helper launched.
var TEXT = {
  LAUNCHED: "Launched {host} in a new Terminal window.",
  LAUNCHED_NO_FOLDER: "Launched {host} in a new Terminal window. It started in its default folder, since this document has no project folder on record.",
  FAILED: "Couldn't open a Terminal window: {why}"
};

function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, function (whole, key) {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole;
  });
}

// ---------------------------------------------------------------------------
// The launch folder
// ---------------------------------------------------------------------------

/**
 * Where the launch folder is looked for, from records a page cannot write:
 * a static row's site root, a worktree row's candidate (itself derived from
 * that root), a legacy row's document only when it holds the review's own
 * script line. meta.json's source_path and target_path are page text
 * (review.write records them), so they never name the folder.
 */
function launchRoot(described) {
  if (!described) return null;
  if (described.kind === "static") {
    // Served by the helper: the site's root, which the registry or an old
    // page-server record vouched for (catalog_sites.planOf). A notes site's
    // root is its one page, so the folder is the one it sits in.
    var site = described.site;
    if (site && !site.worktree && typeof site.root === "string" && site.root) {
      return site.mode === "page-only" ? path.dirname(site.root) : site.root;
    }
    return null;
  }
  if (described.kind === "worktree") return described.candidate || null;
  if (described.kind === "legacy") return described.verified_path || null;
  return null;
}

/** The home folder as given and by real path, so either spelling stops the walk. */
function homeFolders() {
  var home = os.homedir();
  if (!home) return [];
  var out = [path.resolve(home)];
  try {
    var real = fs.realpathSync(home);
    if (out.indexOf(real) === -1) out.push(real);
  } catch (err) {
    // a home folder that is not there stops nothing extra
  }
  return out;
}

/**
 * The folder a launched agent starts in: the repository that holds the
 * document (the nearest folder with a .git, below the home folder), else the
 * document's own folder.
 * Null for no path, or for a folder with a control character in it, which the
 * Launch steps could not read back as one line.
 */
function projectFolder(docPath) {
  if (typeof docPath !== "string" || !docPath) return null;
  var start = docPath;
  while (!fs.existsSync(start)) {
    var up = path.dirname(start);
    if (up === start) return null;
    start = up;
  }
  try {
    if (!fs.statSync(start).isDirectory()) start = path.dirname(start);
  } catch (err) {
    return null;
  }
  var found = start;
  // The walk stops at the home folder: a dotfiles repository in ~ is never a
  // document's project, and a new agent must not start there.
  var homes = homeFolders();
  for (var current = start; ; current = path.dirname(current)) {
    if (homes.indexOf(current) !== -1) break;
    if (fs.existsSync(path.join(current, ".git"))) {
      found = current;
      break;
    }
    if (path.dirname(current) === current) break;
  }
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(found) ? null : found;
}

// ---------------------------------------------------------------------------
// The hand-off message
// ---------------------------------------------------------------------------

/**
 * The hand-off message a launched agent gets as its first prompt, or null
 * for a row with no session to take over (a legacy review).
 *
 * A worktree row's session is real; only its folder is gone. Its message
 * adds one line telling the new agent to serve the main repository's copy,
 * which the reader already checked (under the repository by real path, owned
 * by this user, a page). A worktree row with no such copy gets null.
 *
 * @param {string} dir the state folder
 * @param {object|null} described the reader's describeReview
 * @param {{id: string, session: string}} request
 * @param {string|null} sessionName the session's name as `lahe session name`
 *   keeps it, never a page title read here
 */
function handoffFor(dir, described, request, sessionName) {
  if (!described || described.kind === "legacy") return null;
  if (described.kind === "worktree" && !described.candidate) return null;
  var sessionId = request.session;
  var takeable = protocol.isSafeId(sessionId) && sessionId !== agentSessions.LEGACY_ID;
  if (!takeable) return null;
  var message = protocol.AGENT_LIVENESS.handoffMessage(sessionId, sessionName || null, false, {
    library: true,
    stateDir: stateDir.flagFor(dir),
    request: request.id
  });
  if (described.kind === "worktree") {
    var flag = stateDir.flagFor(dir) ? " --state-dir " + stateDir.flagFor(dir) : "";
    message += "\n\nThe worktree this document was reviewed in is gone. After the takeover, serve the main repository's copy so I can keep reading it:\n\n    lahe review " + described.candidate + " --session " + sessionId + flag + "\n";
  }
  return message;
}

// ---------------------------------------------------------------------------
// The launcher
// ---------------------------------------------------------------------------

/**
 * @param {{dir: string, platform?: string, host?: string, spawn?: function,
 *          log?: function(string)}} options
 *   `platform` and `spawn` are seams for tests: the platform defaults to this
 *   process's, and spawn to child_process.spawn. `host` defaults to
 *   LAHE_LAUNCH_HOST, else claude.
 */
function createLauncher(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("catalog_launch.createLauncher: dir is required");
  var dir = opts.dir;
  var platform = typeof opts.platform === "string" ? opts.platform : process.platform;
  var wanted = typeof opts.host === "string" ? opts.host : process.env.LAHE_LAUNCH_HOST;
  var host = HOSTS.indexOf(wanted) !== -1 ? wanted : DEFAULT_HOST;
  var spawn = typeof opts.spawn === "function" ? opts.spawn : childProcess.spawn;
  var log = typeof opts.log === "function" ? opts.log : function () {};
  // Two off switches, so a helper under test never opens a real window with
  // a real agent in it (one did, on 2026-10-14, from a unit test's temp state
  // folder): LAHE_DIRECT_LAUNCH=off in the environment, and a state folder
  // under the system temp folder, which only a test's helper has.
  var enabled = opts.enabled === true || (opts.enabled !== false && process.env.LAHE_DIRECT_LAUNCH !== "off" && !underTmp(dir));

  /** Can this helper open a Terminal window itself? Only on a Mac. */
  function available() {
    return enabled && platform === "darwin";
  }

  /** What the Library tells the page: whether Launch works with no agent. */
  function describe() {
    return { direct: available(), host: host };
  }

  /**
   * Open the new Terminal window. Writes the message and folder to files
   * under <state>/launches/, named by the request id, then runs osascript
   * with no shell. Resolves to {ok: true, text} or {ok: false, text}; the
   * text is what the Library row shows.
   *
   * @param {{id: string}} request
   * @param {string} handoff the message, already built
   * @param {string|null} folder the project folder, or null for none
   */
  function launch(request, handoff, folder) {
    if (!available()) return Promise.resolve({ ok: false, text: fill(TEXT.FAILED, { why: "this is not a Mac" }) });
    if (!protocol.isSafeId(request && request.id)) return Promise.resolve({ ok: false, text: fill(TEXT.FAILED, { why: "bad request id" }) });
    var folderDir = path.join(dir, LAUNCH_DIR);
    var handoffFile = path.join(folderDir, request.id + ".handoff.txt");
    var folderFile = path.join(folderDir, request.id + ".folder.txt");
    var args;
    try {
      stateDir.ensureDir(folderDir);
      fs.writeFileSync(handoffFile, handoff, { encoding: "utf8", mode: 384 });
      if (folder) {
        fs.writeFileSync(folderFile, folder + "\n", { encoding: "utf8", mode: 384 });
        args = scriptArgs(SCRIPT_WITH_FOLDER).concat([host, handoffFile, folderFile]);
      } else {
        args = scriptArgs(SCRIPT_NO_FOLDER).concat([host, handoffFile]);
      }
    } catch (err) {
      return Promise.resolve({ ok: false, text: fill(TEXT.FAILED, { why: err.message }) });
    }
    return new Promise(function (resolve) {
      var child;
      try {
        child = spawn("osascript", args, { stdio: ["ignore", "ignore", "pipe"], shell: false });
      } catch (err) {
        resolve({ ok: false, text: fill(TEXT.FAILED, { why: err.message }) });
        return;
      }
      var stderr = "";
      if (child.stderr) child.stderr.on("data", function (chunk) { stderr += String(chunk); });
      child.on("error", function (err) {
        resolve({ ok: false, text: fill(TEXT.FAILED, { why: err.message }) });
      });
      child.on("close", function (code) {
        if (code === 0) {
          log("catalog launch " + request.id + ": opened " + host + (folder ? " in " + folder : " in its default folder"));
          resolve({ ok: true, text: fill(folder ? TEXT.LAUNCHED : TEXT.LAUNCHED_NO_FOLDER, { host: host }) });
        } else {
          var why = stderr.trim().split("\n")[0] || "osascript exited " + code;
          log("catalog launch " + request.id + ": failed: " + why);
          resolve({ ok: false, text: fill(TEXT.FAILED, { why: why }) });
        }
      });
    });
  }

  return { available: available, describe: describe, launch: launch, host: host };
}

/** Is this folder under the system temp folder (a test helper's state dir)? */
function underTmp(dir) {
  var tmp = os.tmpdir();
  var candidates = [path.resolve(tmp)];
  try { candidates.push(fs.realpathSync(tmp)); } catch (err) { /* as given */ }
  var real = path.resolve(dir);
  try { real = fs.realpathSync(dir); } catch (err) { /* as given */ }
  return candidates.some(function (root) { return real === root || real.indexOf(root + path.sep) === 0; });
}

/** osascript takes each script line as its own -e argument. */
function scriptArgs(lines) {
  var out = [];
  lines.forEach(function (line) { out.push("-e", line); });
  return out;
}

module.exports = {
  HOSTS: HOSTS,
  DEFAULT_HOST: DEFAULT_HOST,
  TEXT: TEXT,
  launchRoot: launchRoot,
  projectFolder: projectFolder,
  handoffFor: handoffFor,
  createLauncher: createLauncher,
  scriptArgs: scriptArgs,
  underTmp: underTmp
};
