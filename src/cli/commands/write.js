// `lahe write <path>`: notes on a blank page.
//
// docs/features/20260928.01_free_writing, architecture "Empty page and lahe
// write" and Security & Privacy Notes (the `lahe write` bullets). It creates
// a Markdown file, or opens one that exists, and serves it the way `lahe
// review` serves Markdown, with three differences:
//
//  - THE PATH RULES. Only `.md` or `.markdown`. The final path is checked with
//    lstat before either branch, and any symlink, dangling or not, is refused:
//    following one would create or serve a file somewhere the command line
//    never named. The parent folder must already exist; nothing is made. A new
//    file is created with the exclusive flag ("wx"), so a file that appears
//    between the check and the create is never truncated; on "already exists"
//    the path is checked again with lstat and used only if it is a regular
//    file. It never overwrites. The parent's real path is printed, so a folder
//    reached through a symlink is named as what it is.
//  - ITS OWN ONE-PAGE SERVER. Notes often sit in a home, Desktop or Documents
//    folder, and a folder server would serve all of it, dotfiles included. So
//    the page gets a server that serves that page and nothing else
//    (src/service/static_servers.js), even with --session.
//  - A NOTES REVIEW. The review carries `notes: true`, so the agent does not
//    proofread long sittings (plan PQ3).
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var markdown = require("../../service/markdown.js");
var review = require("./review.js");

var EXIT = protocol.CLI_EXIT;

var USAGE = [
  "usage: lahe write <file.md> [--session <id>] [--name <name>] [--state-dir <path>] [--port <n>]",
  "",
  "Opens a Markdown file for writing notes on a blank page: creates it when it does not",
  "exist (its folder must), or opens it as it is. The reviewer types on the page and the",
  "agent places the words in the file. Prints what lahe review prints: one URL, and the",
  "wake, monitor, drain, and close commands.",
  "",
  "  --session <id>  add this page to an existing agent session. It still gets its own",
  "                  server, which serves this one page and nothing else in its folder",
  "  --name <name>   the human's name for this agent session, as lahe review takes it",
  "",
  "Refused: a name that is not .md or .markdown, a missing folder, a directory, and any",
  "symlink. An existing file is never overwritten."
].join("\n");

var PASSED_VALUE_FLAGS = ["--session", "--name", "--state-dir", "--port"];

function parseArgs(argv) {
  var out = { target: null, pass: [], help: false, error: null };
  var list = argv || [];
  for (var i = 0; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (PASSED_VALUE_FLAGS.indexOf(arg) !== -1) {
      if (list[i + 1] === undefined) {
        out.error = arg + " needs a value";
        break;
      }
      out.pass.push(arg, list[(i += 1)]);
    } else if (arg.indexOf("--") === 0) {
      out.error = "unknown option " + JSON.stringify(arg);
      break;
    } else if (out.target === null) {
      out.target = arg;
    } else {
      out.error = "one file at a time; got " + JSON.stringify(out.target) + " and " + JSON.stringify(arg);
      break;
    }
  }
  if (!out.help && !out.error && !out.target) out.error = "name the Markdown file to write in";
  return out;
}

function lstatOrNull(file) {
  try {
    return fs.lstatSync(file);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Apply the path rules. Returns {file, folder, created} or {error}.
 * `folder` is the parent's real path.
 */
function prepare(target) {
  var file = path.resolve(target);
  if (!markdown.isMarkdown(file) || !/\.(md|markdown)$/i.test(file)) {
    return { error: "lahe write takes a .md or .markdown file, got " + JSON.stringify(path.basename(file)) };
  }
  var parent = path.dirname(file);
  var parentStat;
  try {
    parentStat = fs.statSync(parent);
  } catch (err) {
    return { error: "the folder " + parent + " does not exist; lahe write makes no folders" };
  }
  if (!parentStat.isDirectory()) return { error: parent + " is not a folder" };

  var stat = lstatOrNull(file);
  if (stat && stat.isSymbolicLink()) {
    return { error: file + " is a symlink; lahe write opens or creates a real file only, and never follows one" };
  }
  if (stat && !stat.isFile()) return { error: file + " is not a regular file" };

  var created = false;
  if (!stat) {
    try {
      fs.closeSync(fs.openSync(file, "wx"));
      created = true;
    } catch (err) {
      if (err.code !== "EEXIST") return { error: "could not create " + file + ": " + err.message };
      // Something made it between the check and the create. Check it again,
      // the same way, and never truncate it.
      var again = lstatOrNull(file);
      if (!again || again.isSymbolicLink()) {
        return { error: file + " appeared as a symlink while lahe write was creating it; refused" };
      }
      if (!again.isFile()) return { error: file + " is not a regular file" };
    }
  }
  return { file: file, folder: fs.realpathSync(parent), created: created };
}

/**
 * @param {string[]} argv everything after `write`
 * @returns {Promise<number>} the exit code
 */
async function run(argv) {
  var args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    return EXIT.OK;
  }
  if (args.error) {
    process.stderr.write("lahe write: " + args.error + "\n\n" + USAGE + "\n");
    return EXIT.BAD_USAGE;
  }
  var ready;
  try {
    ready = prepare(args.target);
  } catch (err) {
    ready = { error: err.message };
  }
  if (ready.error) {
    process.stderr.write("lahe write: " + ready.error + "\n");
    return EXIT.BAD_USAGE;
  }
  if (ready.created) process.stdout.write("  created   " + ready.file + "\n");
  return review.run([ready.file].concat(args.pass), { notes: true, notesFolder: ready.folder });
}

module.exports = { USAGE: USAGE, parseArgs: parseArgs, prepare: prepare, run: run };
