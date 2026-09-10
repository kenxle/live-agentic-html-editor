// `lahe reply`: write one correct reply line, so no agent has to hand-encode
// JSON in a shell.
//
// Owner: 3A, beside `status` and `monitor`, because this is the write half of
// the same agent-facing loop.
//
// WHY THIS COMMAND EXISTS. On 2026-09-10 an agent appended a reply to
// replies.jsonl with a shell echo. The text it was answering with had
// paragraphs in it, so the raw newlines inside the JSON string split one object
// across three physical lines. The helper read three lines and rejected all
// three ("not JSON: Unterminated string", then "Unexpected token 'I'"), the
// reviewer got a malformed-line chip on their rail, and the agent had to notice
// and re-append a correct copy. Nothing was lost and everything about that was
// avoidable: the failure is not the agent's carelessness, it is that the tool
// asked a shell to do JSON encoding. This command does the encoding.
//
// WHAT IT DOES NOT DO. It does not decide whether the reply is right, and it
// does not check that the rev is current: the helper's fold owns that decision
// (a stale rev is refused there, on purpose, so the reviewer's rewording stays
// outstanding). When the projection is readable on disk it says so as a
// WARNING, because "you are answering rev 2 and the item is at rev 3" is worth
// hearing a second before the fold says it, and never as a refusal, because a
// second opinion about the item's current rev is exactly the thing this command
// is not the owner of.
//
// It writes the same file the protocol already names: replies.jsonl alone, or
// replies-<agent>.jsonl when --agent names one. Append only, one line, one
// trailing newline.
//
// Node-only.

"use strict";

var fs = require("node:fs");

var protocol = require("../../shared/protocol.js");
var record = require("../../shared/record.js");
var stateDirModule = require("../../service/state_dir.js");
var logModule = require("../../service/log.js");
var projectionModule = require("../../service/projection.js");
var agentSessionsModule = require("../../service/agent_sessions.js");

var EXIT = protocol.CLI_EXIT;

var FIELD = protocol.REPLY_FIELD;

var USAGE = [
  "usage: lahe reply --review <id> --item <item-id> --rev <n> --status handled|not_handled|question",
  "                  [--text <words>] [--reason <words>] [--file <path>]... [--needs-see]",
  "                  [--agent <name>] [--session <agent-session-id>] [--state-dir <path>]",
  "",
  "Appends one correctly encoded reply line to your reply file in the review folder.",
  "Newlines and quotes in --text and --reason are encoded for you; never hand-write the JSON.",
  "",
  "  --review <id>    the review the item belongs to",
  "  --item <id>      the item id, as review.json or lahe status prints it",
  "  --rev <n>        the item's rev, as review.json or lahe status prints it",
  "  --status <s>     handled (you made the change), not_handled (--reason says why),",
  "                   question (--text asks it)",
  "  --text <words>   what you want to say. `-` reads it from stdin, and stdin is also",
  "                   read when it is a pipe and --text and --reason are both absent",
  "  --reason <words> why an item was not handled. `-` reads it from stdin",
  "  --file <path>    a file you changed. Repeat the flag for each one",
  "  --needs-see      the reviewer should read this reply. Needs --text or --reason",
  "  --agent <name>   your name. It goes on the card and names replies-<name>.jsonl",
  "  --session <id>   your agent session, stamped as activity so the reviewer's rail",
  "                   says an agent is working without waiting for the next fold",
  "  --state-dir <p>  where the helper keeps its data, the same flag every command takes",
  "",
  "Exit codes: " + EXIT.OK + " written, " + EXIT.HELPER_UNREACHABLE + " the state directory is unusable, " + EXIT.UNKNOWN_REVIEW + " unknown review, " + EXIT.BAD_USAGE + " bad usage."
].join("\n");

var VALUE_FLAGS = ["--review", "--item", "--rev", "--status", "--text", "--reason", "--file", "--agent", "--session", "--state-dir"];

function parseArgs(argv) {
  var out = {
    review: null,
    item: null,
    rev: null,
    status: null,
    text: null,
    reason: null,
    files: [],
    needsSee: false,
    agent: null,
    session: null,
    stateDir: null,
    help: false,
    error: null
  };
  var list = argv || [];

  for (var i = 0; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--needs-see") {
      out.needsSee = true;
    } else if (VALUE_FLAGS.indexOf(arg) !== -1) {
      if (list[i + 1] === undefined) {
        out.error = arg + " needs a value";
        break;
      }
      var value = list[(i += 1)];
      if (arg === "--review") out.review = value;
      if (arg === "--item") out.item = value;
      if (arg === "--rev") out.rev = value;
      if (arg === "--status") out.status = value;
      if (arg === "--text") out.text = value;
      if (arg === "--reason") out.reason = value;
      if (arg === "--file") out.files.push(value);
      if (arg === "--agent") out.agent = value;
      if (arg === "--session") out.session = value;
      if (arg === "--state-dir") out.stateDir = value;
    } else {
      out.error = "unknown option " + JSON.stringify(arg);
      break;
    }
  }

  if (out.help || out.error) return out;

  if (!out.review) out.error = "--review is required";
  else if (!protocol.isSafeId(out.review)) out.error = "--review must be a safe id: " + String(protocol.SAFE_ID);
  else if (!out.item) out.error = "--item is required";
  else if (!protocol.isSafeId(out.item)) out.error = "--item must be an item id as review.json prints it: " + String(protocol.SAFE_ID);
  else if (out.rev === null) out.error = "--rev is required; it is the item's rev, as review.json prints it";
  else if (!/^-?\d+$/.test(String(out.rev).trim()) || !Number.isInteger(Number(out.rev))) {
    out.error = "--rev must be an integer, got " + JSON.stringify(out.rev);
  } else if (!out.status) out.error = "--status is required";
  else if (protocol.REPLY_STATUSES.indexOf(out.status) === -1) {
    out.error = "--status must be one of " + protocol.REPLY_STATUSES.join(", ") + ", got " + JSON.stringify(out.status);
  } else if (out.agent !== null && !protocol.isSafeId(out.agent)) {
    out.error = "--agent names a file too, so it must be a safe id: " + String(protocol.SAFE_ID);
  } else if (out.session !== null && !protocol.isSafeId(out.session)) {
    out.error = "--session must be a safe id: " + String(protocol.SAFE_ID);
  } else if (out.files.some(function (path) { return typeof path !== "string" || !path.trim(); })) {
    out.error = "--file needs a path";
  }

  if (!out.error) out.rev = Number(out.rev);
  return out;
}

/**
 * Everything on stdin, as text, with one trailing newline dropped.
 *
 * The trailing newline goes because `echo` and a heredoc both add one and no
 * agent means it: it would land in the reviewer's card as a blank last line.
 * Interior newlines are the whole point of reading stdin and are kept exactly.
 */
function readStdin(readFileSync) {
  var text;
  try {
    text = (readFileSync || fs.readFileSync)(0, "utf8");
  } catch (err) {
    return "";
  }
  return String(text).replace(/\r?\n$/, "");
}

/**
 * Where --text and --reason really come from.
 *
 * `-` is the explicit form. The implicit one, a pipe with neither flag, exists
 * because the shape an agent reaches for is `... | lahe reply --status question`
 * and failing that for want of a dash is a refusal nobody learns anything from.
 * A TTY is never read: that would hang a person typing the command by hand.
 */
function resolveStdin(args, options) {
  var opts = options || {};
  var isTty = opts.stdinIsTty === undefined ? Boolean(process.stdin && process.stdin.isTTY) : opts.stdinIsTty;
  var read = function () {
    return opts.stdin === undefined ? readStdin(opts.readFileSync) : String(opts.stdin).replace(/\r?\n$/, "");
  };

  if (args.text === "-") {
    args.text = read();
    if (!args.text) return "--text - read nothing from stdin";
  }
  if (args.reason === "-") {
    args.reason = read();
    if (!args.reason) return "--reason - read nothing from stdin";
  }
  if (args.text === null && args.reason === null && !isTty) {
    var piped = read();
    if (piped) args.text = piped;
  }
  return null;
}

/**
 * The per-status rules, said in the contract's own words.
 *
 * The needs-see rule is quoted rather than paraphrased because it is the one
 * an agent argues with: a flagged reply carrying no words draws the card's
 * wordless fallback, and an agent that flags one of those flags twelve.
 */
function validateBody(args) {
  if (args.status === protocol.REPLY_STATUS.QUESTION && !args.text) {
    return "--status question needs --text: the question is what the reviewer answers";
  }
  if (args.status === protocol.REPLY_STATUS.NOT_HANDLED && !args.reason) {
    return "--status not_handled needs --reason, in words the reviewer will read";
  }
  if (args.needsSee && !args.text && !args.reason) {
    return "--needs-see needs --text or --reason. The contract: \"the flag counts only when the same line carries text or reason; flagging a reply with nothing in it sends the reviewer to a card that says nothing\"";
  }
  return null;
}

/** The reply object, in the field order protocol.js spells. */
function replyObject(args) {
  var reply = {};
  reply[FIELD.ITEM] = args.item;
  reply[FIELD.REV] = args.rev;
  reply[FIELD.STATUS] = args.status;
  if (args.agent) reply[FIELD.AGENT] = args.agent;
  if (args.reason) reply[FIELD.REASON] = args.reason;
  if (args.text) reply[FIELD.TEXT] = args.text;
  if (args.files.length) reply[FIELD.FILES] = args.files.slice();
  if (args.needsSee) reply[FIELD.NEEDS_SEE] = true;
  return reply;
}

/** replies.jsonl alone, replies-<agent>.jsonl when an agent is named. */
function replyFilename(agent) {
  return agent ? protocol.REPLY_FILE.prefix + agent + protocol.REPLY_FILE.suffix : protocol.REPLY_FILE.SINGLE;
}

/**
 * A warning, or null, about the rev this line names.
 *
 * Read off disk through the projector, the same way `status` reads it with no
 * helper up. Anything unreadable is silence: this is a courtesy, and a courtesy
 * that throws would cost the agent the reply it came to write.
 */
function revWarning(dir, reviewId, itemId, rev) {
  var items;
  try {
    var log = logModule.createEventLog({ dir: dir });
    var events = log.read(reviewId);
    if (!events.length) return null;
    items = projectionModule.itemsFrom(events);
  } catch (err) {
    return null;
  }
  var found = null;
  for (var i = 0; i < items.length; i += 1) {
    if (items[i][record.FIELD.ID] === itemId) {
      found = items[i];
      break;
    }
  }
  if (!found) return "no item " + JSON.stringify(itemId) + " in review " + reviewId + " on disk; the fold will refuse this line";
  var current = found[record.FIELD.REV];
  if (typeof current === "number" && current !== rev) {
    return "item " + itemId + " is at rev " + current + " and you passed " + rev + "; the fold refuses a stale rev, so re-read the item and answer its new rev";
  }
  return null;
}

/**
 * @param {string[]} argv everything after `reply`
 * @param {{stateDir?: string, stdout?: function, stderr?: function, stdin?: string,
 *   stdinIsTty?: boolean, readFileSync?: function}} [options]
 * @returns {Promise<number>} the exit code, from protocol.CLI_EXIT
 */
async function run(argv, options) {
  var opts = options || {};
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var err = opts.stderr || function (text) { process.stderr.write(text); };

  var args = parseArgs(argv);
  if (args.help) {
    out(USAGE + "\n");
    return EXIT.OK;
  }
  if (args.error) {
    err("lahe reply: " + args.error + "\n\n" + USAGE + "\n");
    return EXIT.BAD_USAGE;
  }

  var stdinError = resolveStdin(args, opts);
  if (stdinError) {
    err("lahe reply: " + stdinError + "\n");
    return EXIT.BAD_USAGE;
  }

  var bodyError = validateBody(args);
  if (bodyError) {
    err("lahe reply: " + bodyError + "\n");
    return EXIT.BAD_USAGE;
  }

  var dir;
  try {
    dir = args.stateDir
      ? stateDirModule.stateDir({ dir: args.stateDir })
      : opts.stateDir || stateDirModule.stateDir();
  } catch (error) {
    err("lahe reply: " + error.message + "\n");
    return EXIT.HELPER_UNREACHABLE;
  }

  var target;
  try {
    if (!fs.existsSync(stateDirModule.reviewDir(dir, args.review))) {
      err("lahe reply: no review " + JSON.stringify(args.review) + " in " + stateDirModule.reviewsRoot(dir) + "\n");
      return EXIT.UNKNOWN_REVIEW;
    }
    target = stateDirModule.replyFilePath(dir, args.review, replyFilename(args.agent));
  } catch (error) {
    err("lahe reply: " + error.message + "\n");
    return EXIT.BAD_USAGE;
  }

  var line = JSON.stringify(replyObject(args));
  try {
    stateDirModule.appendLine(target, line + "\n");
  } catch (error) {
    err("lahe reply: could not append to " + target + ": " + error.message + "\n");
    return EXIT.BAD_USAGE;
  }

  var warning = revWarning(dir, args.review, args.item, args.rev);
  if (warning) err("lahe reply: warning: " + warning + "\n");

  // Replying IS the agent working, and the rail's "agent is working" line is
  // drawn from activity rather than from anything an agent claims. The fold
  // stamps it too, a second or two later; this makes the rail truthful now.
  if (args.session) {
    try {
      agentSessionsModule.createStore({ dir: dir }).touchActivity(args.session);
    } catch (error) {
      // A session that does not exist is not a reason to fail a written reply.
    }
  }

  out(line + "\n");
  return EXIT.OK;
}

module.exports = {
  USAGE: USAGE,
  EXIT: EXIT,
  parseArgs: parseArgs,
  resolveStdin: resolveStdin,
  validateBody: validateBody,
  replyObject: replyObject,
  replyFilename: replyFilename,
  revWarning: revWarning,
  run: run
};
