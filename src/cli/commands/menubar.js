// `lahe menubar show` and `lahe menubar rebuild`: the menu bar icon's two
// commands (macOS only; src/service/menubar.js does the work).
//
//   lahe menubar show    [--state-dir <path>]
//   lahe menubar rebuild [--state-dir <path>]
//
// SHOW IS THE ONE WAY BACK FROM HIDE (menu bar brief R17). The icon's Hide
// holds until the next login or this command, and nothing an agent runs may
// undo it, so show refuses without a terminal the way `lahe install` does.
//
// REBUILD builds the app now, from the clone install.json names, the same way
// the helper's tick does when the source changes. It restarts the icon only
// if it was running, so it never brings a hidden icon back, and an agent may
// run it.
//
// Node-only. Every system call goes through the menubar module's runner.

"use strict";

var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var stateDirModule = require("../../service/state_dir.js");
var menubar = require("../../service/menubar.js");

var USAGE = [
  "usage: lahe menubar show [--state-dir <path>]",
  "       lahe menubar rebuild [--state-dir <path>]",
  "",
  "  show     bring back a menu bar icon you hid. Run it yourself, in a terminal.",
  "  rebuild  build the icon's app again now, from the clone `lahe install` recorded. It restarts",
  "           the icon only if it is running. The helper does this by itself when the source changes.",
  "",
  "  macOS only. `lahe install --menu-bar` adds the icon; `lahe uninstall` removes it."
].join("\n");

function parse(argv) {
  var list = argv || [];
  var out = { action: null, stateDir: null };
  for (var i = 0; i < list.length; i += 1) {
    if (list[i] === "--help" || list[i] === "-h") return { help: true };
    if (list[i] === "--state-dir" && list[i + 1] !== undefined) {
      out.stateDir = list[(i += 1)];
    } else if ((list[i] === "show" || list[i] === "rebuild") && !out.action) {
      out.action = list[i];
    } else {
      return { error: "unknown or incomplete option " + JSON.stringify(list[i]) };
    }
  }
  if (!out.action) return { error: "say show or rebuild" };
  return out;
}

/**
 * @param {string[]} argv the arguments after `menubar`
 * @param {{stdout?: function, stderr?: function, platform?: string,
 *          isTTY?: boolean, home?: string, uid?: number, label?: string,
 *          runner?: function, arch?: string}} [deps] seams for tests
 * @returns {Promise<number>} the exit code
 */
async function run(argv, deps) {
  var d = deps || {};
  var out = d.stdout || function (text) { process.stdout.write(text); };
  var err = d.stderr || function (text) { process.stderr.write(text); };
  var args = parse(argv);
  if (args.help) {
    out(USAGE + "\n");
    return protocol.CLI_EXIT.OK;
  }
  if (args.error) {
    err("lahe menubar: " + args.error + "\n\n" + USAGE + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  if ((d.platform || process.platform) !== "darwin") {
    err("lahe menubar: the menu bar icon is macOS only.\n");
    return 1;
  }
  var isTTY = d.isTTY !== undefined ? d.isTTY : !!(process.stdin.isTTY && process.stdout.isTTY);
  if (args.action === "show" && !isTTY) {
    err(
      "lahe menubar show needs a terminal: only a person brings back an icon they hid.\n" +
        "An agent asks the human to type `! lahe menubar show`.\n"
    );
    return 1;
  }
  var dir;
  try {
    dir = args.stateDir ? stateDirModule.stateDir({ dir: args.stateDir }) : stateDirModule.stateDir();
  } catch (error) {
    err("lahe menubar: " + error.message + "\n");
    return 1;
  }
  var options = { stateDir: dir, home: d.home, uid: d.uid, label: d.label, runner: d.runner, arch: d.arch };

  if (args.action === "show") {
    var shown = await menubar.showApp(options);
    if (!shown.ok) {
      err("lahe menubar: " + shown.message + "\n");
      return 1;
    }
    out("lahe menubar: the icon is back in the menu bar.\n");
    return protocol.CLI_EXIT.OK;
  }

  var rebuilt = await menubar.rebuildNow(options);
  if (!rebuilt.ok) {
    err(
      "lahe menubar: " + rebuilt.message +
        (rebuilt.code === menubar.FAILED.NOT_INSTALLED ? "" : "\n  The old app is unchanged. Its log is " + path.join(dir, menubar.LOG_FILE) + ".") + "\n"
    );
    return 1;
  }
  out(
    "lahe menubar: rebuilt " + rebuilt.app + "; " +
      (rebuilt.restarted
        ? "restarted it."
        : rebuilt.owned === false
          ? "the icon's login item belongs to another state folder, so nothing was restarted."
          : "it was not running, so it was left as it was.") + "\n"
  );
  return protocol.CLI_EXIT.OK;
}

module.exports = { USAGE: USAGE, run: run };
