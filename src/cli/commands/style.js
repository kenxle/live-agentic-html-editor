// lahe style add and lahe style list.
// Owner: Style switcher 1.2. See docs/features/20260930.01_style_switcher/,
// architecture "Key Flows", Install.
//
// `lahe style add <folder>...` checks each style folder and copies only the
// files a page may use into <state dir>/styles/<id>/, replacing an earlier
// install of the same id. `lahe style list` prints what is installed. There is
// no remove: a style is removed by deleting its folder.
//
// Every rule lives in src/service/styles.js. This file parses arguments and
// prints. Everything printed from a style folder has been through
// styles.clean, so a name or a reason cannot put escape codes on a terminal.
//
// Node-only.

"use strict";

var protocol = require("../../shared/protocol.js");
var stateDirModule = require("../../service/state_dir.js");
var styles = require("../../service/styles.js");

var EXIT = protocol.CLI_EXIT;
// A refused folder is not bad usage: the command was right and the folder was
// not. `lahe add` uses 1 for the same kind of answer.
var EXIT_REFUSED = 1;

var USAGE = [
  "usage: lahe style add <folder>... [--state-dir <path>]",
  "       lahe style list [--state-dir <path>]",
  "",
  "  add   check a downloaded style folder and install it for every Lahe page on this",
  "        machine. The folder's name is the style's id. Installing the same id again",
  "        replaces it",
  "  list  print each installed style's id, name and version",
  "",
  "A page uses an installed style through one line: in HTML,",
  "  <link rel=\"stylesheet\" href=\"./.lahe-styles/<id>/style.css\">",
  "directly after the ./.lahe-doc-style.css link; in Markdown, the frontmatter line",
  "  lahe-style: <id>",
  "To remove a style, delete its folder from the styles folder `list` names.",
  "",
  styles.FOLDER_HELP
].join("\n");

function parseArgs(argv) {
  var out = { action: null, folders: [], stateDir: null, help: false, error: null };
  var list = argv || [];
  for (var i = 0; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--state-dir") {
      if (list[i + 1] === undefined) { out.error = "--state-dir needs a value"; break; }
      out.stateDir = list[(i += 1)];
    } else if (arg.indexOf("--") === 0) {
      out.error = "unknown option " + JSON.stringify(arg);
      break;
    } else if (out.action === null) {
      out.action = arg;
    } else {
      out.folders.push(arg);
    }
  }
  if (out.help || out.error) return out;
  if (out.action !== "add" && out.action !== "list") {
    out.error = out.action === null ? "name an action: add or list" : "unknown action " + JSON.stringify(out.action);
  } else if (out.action === "add" && out.folders.length === 0) {
    out.error = "name the style folder to add";
  } else if (out.action === "list" && out.folders.length) {
    out.error = "list takes no folders";
  }
  return out;
}

function pad(text, width) {
  return text.length >= width ? text + "  " : text + new Array(width - text.length + 1).join(" ") + "  ";
}

function add(dir, folders) {
  var refused = 0;
  folders.forEach(function (folder) {
    var result = styles.install(dir, folder);
    if (result.ok) {
      process.stdout.write(
        "installed " + result.id + " (" + styles.clean(result.name) + ")" +
          (result.replaced ? ", replacing the earlier install" : "") + "\n"
      );
      return;
    }
    refused += 1;
    process.stderr.write("lahe style add: refused " + styles.clean(folder) + ": " + styles.clean(result.reason) + "\n");
  });
  if (refused) process.stderr.write("\n" + styles.FOLDER_HELP + "\n");
  if (folders.length > refused) {
    process.stdout.write("styles folder: " + stateDirModule.stylesRoot(dir) + "\n");
  }
  return refused ? EXIT_REFUSED : EXIT.OK;
}

function list(dir) {
  var entries = styles.list(dir);
  if (!entries.length) {
    process.stdout.write("no styles installed. Add one with `lahe style add <folder>`.\n");
    return EXIT.OK;
  }
  var good = entries.filter(function (entry) { return entry.ok; });
  var bad = entries.filter(function (entry) { return !entry.ok; });
  var idWidth = entries.reduce(function (max, entry) { return Math.max(max, entry.id.length); }, 0);
  var nameWidth = good.reduce(function (max, entry) { return Math.max(max, entry.metadata.name.length); }, 0);
  good.forEach(function (entry) {
    var line = pad(entry.id, idWidth) + pad(styles.clean(entry.metadata.name), nameWidth) + (entry.metadata.version || "-");
    process.stdout.write(line.replace(/\s+$/, "") + "\n");
  });
  bad.forEach(function (entry) {
    process.stdout.write(pad(entry.id, idWidth) + "refused: " + styles.clean(entry.reason) + "\n");
  });
  return EXIT.OK;
}

/**
 * @param {string[]} argv everything after `lahe style`
 * @returns {Promise<number>}
 */
async function run(argv) {
  var args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    return EXIT.OK;
  }
  if (args.error) {
    process.stderr.write("lahe style: " + args.error + "\n\n" + USAGE + "\n");
    return EXIT.BAD_USAGE;
  }
  var dir;
  try {
    dir = stateDirModule.stateDir({ dir: args.stateDir || undefined });
  } catch (err) {
    process.stderr.write("lahe style: " + err.message + "\n");
    return EXIT.BAD_USAGE;
  }
  if (args.action === "add") return add(dir, args.folders);
  return list(dir);
}

module.exports = { USAGE: USAGE, parseArgs: parseArgs, run: run };
