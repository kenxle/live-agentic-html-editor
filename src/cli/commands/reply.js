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
// --batch answers many items in one run (docs/features/20261015.01_batch_reply_own_answers).
// An agent answering ten comments made up to ten calls, and each call re-reads
// the whole conversation. The batch is one JSON array on stdin, checked entry
// by entry with the single form's rules, and written all together or not at
// all.
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
  "                  [--proofread [--suggest <block> <from> <to>]...]",
  "       lahe reply --review <id> --batch [--agent <name>] [--session <agent-session-id>] [--state-dir <path>]",
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
  "  --reason <words> why an item was not handled, naming what you checked and what you",
  "                   found. Required for not_handled, and blank does not count.",
  "                   `-` reads it from stdin",
  "  --file <path>    a file you changed. Repeat the flag for each one",
  "  --needs-see      the reviewer should read this reply. Needs --text or --reason",
  "  --agent <name>   the kind of agent you are (claude, codex). It goes on the card and names replies-<name>.jsonl",
  "  --session <id>   your agent session, stamped as activity so the reviewer's rail",
  "                   says an agent is working without waiting for the next fold",
  "  --state-dir <p>  where the helper keeps its data, the same flag every command takes",
  "  --proofread      this question is a proofread of an item carrying proofread: true.",
  "                   Place the words as written first. Question replies only",
  "  --suggest <block> <from> <to>",
  "                   one fix: in new_blocks[<block>], change <from> to <to>. Repeat it.",
  "                   <from> must be in that block's words exactly once. Needs --proofread",
  "  --batch          answer many items in one run. Reads a JSON array from stdin, one entry per",
  "                   item: {\"item\":\"...\",\"rev\":1,\"status\":\"handled\",\"text\":\"...\"}. An entry also",
  "                   takes reason, files (a list), needs_see, proofread, and suggest (a list of",
  "                   [block, from, to]). Each entry is checked like the single form. If any",
  "                   entry fails, nothing is written. Prints one result line per entry.",
  "                   It refuses --item, --rev, --status, --text, --reason, --file,",
  "                   --needs-see, --proofread and --suggest",
  "",
  "Exit codes: " + EXIT.OK + " written, " + EXIT.HELPER_UNREACHABLE + " the state directory is unusable, " + EXIT.UNKNOWN_REVIEW + " unknown review, " + EXIT.BAD_USAGE + " bad usage."
].join("\n");

// The flags that describe one reply. --batch carries its replies on stdin and
// refuses all of them.
var SINGLE_VALUE_FLAGS = ["--item", "--rev", "--status", "--text", "--reason", "--file"];

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
    proofread: false,
    suggestions: [],
    agent: null,
    session: null,
    stateDir: null,
    batch: false,
    singleFlags: [],
    help: false,
    error: null
  };
  var list = argv || [];

  for (var i = 0; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--batch") {
      out.batch = true;
    } else if (arg === "--needs-see") {
      out.needsSee = true;
      out.singleFlags.push(arg);
    } else if (arg === "--proofread") {
      out.proofread = true;
      out.singleFlags.push(arg);
    } else if (arg === "--suggest") {
      out.singleFlags.push(arg);
      if (list[i + 1] === undefined || list[i + 2] === undefined || list[i + 3] === undefined) {
        out.error = "--suggest needs three values: <block> <from> <to>";
        break;
      }
      var blockArg = String(list[i + 1]).trim();
      if (!/^\d+$/.test(blockArg)) {
        out.error = "--suggest <block> must be a whole number from 0 (the index in new_blocks), got " + JSON.stringify(list[i + 1]);
        break;
      }
      out.suggestions.push({ block: Number(blockArg), from: list[i + 2], to: list[i + 3] });
      i += 3;
    } else if (VALUE_FLAGS.indexOf(arg) !== -1) {
      if (list[i + 1] === undefined) {
        out.error = arg + " needs a value";
        break;
      }
      var value = list[(i += 1)];
      if (SINGLE_VALUE_FLAGS.indexOf(arg) !== -1) out.singleFlags.push(arg);
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

  if (out.batch) {
    if (out.singleFlags.length) {
      out.error = "--batch takes its replies as a JSON array on stdin, so it cannot be combined with " + out.singleFlags[0];
    } else if (!out.review) out.error = "--review is required";
    else if (!protocol.isSafeId(out.review)) out.error = "--review must be a safe id: " + String(protocol.SAFE_ID);
    else if (out.agent !== null && !protocol.isSafeId(out.agent)) {
      out.error = "--agent names a file too, so it must be a safe id: " + String(protocol.SAFE_ID);
    } else if (out.session !== null && !protocol.isSafeId(out.session)) {
      out.error = "--session must be a safe id: " + String(protocol.SAFE_ID);
    }
    return out;
  }

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

  if (!out.error) out.error = proofreadRuleError(out);

  if (!out.error) out.rev = Number(out.rev);
  return out;
}

/** Null, or which proofread rule these args break. Shared by the single form and each batch entry. */
function proofreadRuleError(args) {
  if (args.suggestions.length && !args.proofread) {
    return "--suggest needs --proofread: suggestions belong on a proofreading question";
  }
  if (args.proofread && args.status !== protocol.REPLY_STATUS.QUESTION) {
    return "--proofread and --suggest belong on a --status question reply only";
  }
  if (args.suggestions.some(function (sg) { return !sg.from; })) {
    return "--suggest <from> must not be empty";
  }
  return null;
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
  // Blank is not an answer. A reason of "" or "   " used to pass this check on
  // the not_handled path and land a refusal with no words on the reviewer's
  // card, which is the same failure as a refusal whose words are "this card is
  // old": the reviewer is told no and told nothing.
  var blank = function (value) {
    return typeof value !== "string" || !value.trim();
  };
  // TEXT ALONE, because that is what the fold requires (protocol.REPLY_REQUIRED
  // .question). Accepting a reason in its place wrote a line this command exits
  // 0 on and parseReplyLine then rejects: the agent believes it asked, and the
  // reviewer gets a malformed-line chip instead of a question.
  if (args.status === protocol.REPLY_STATUS.QUESTION && blank(args.text)) {
    return "--status question needs --text: the question is what the reviewer answers, and --reason does not stand in for it";
  }
  if (args.status === protocol.REPLY_STATUS.NOT_HANDLED && blank(args.reason)) {
    return "--status not_handled needs --reason, in words the reviewer will read, naming what you checked and what you found. " +
      "An item on the drain is the reviewer's current request whatever its card's age, so \"this card is old\" is not a reason.";
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
  if (args.proofread) {
    reply[FIELD.PROOFREAD] = true;
    reply[FIELD.SUGGESTIONS] = args.suggestions.map(function (sg) {
      return { block: sg.block, from: sg.from, to: sg.to };
    });
  }
  return reply;
}

function suggestionName(sg) {
  return "--suggest " + sg.block + " " + JSON.stringify(sg.from) + " " + JSON.stringify(sg.to);
}

/**
 * Null, or why a proofreading reply cannot be written. The item is read from
 * review.json at the rev the line names, and each suggestion is tried alone
 * and then all together through record.applySuggestions, the function the
 * reviewer's "Use the fixes" runs, so a line this writes is one it can apply.
 */
function proofreadProblem(dir, args) {
  var projected;
  try {
    projected = JSON.parse(fs.readFileSync(stateDirModule.reviewJsonPath(dir, args.review), "utf8"));
  } catch (error) {
    return "--proofread reads the item from review.json, which could not be read: " + error.message;
  }
  var found = null;
  (Array.isArray(projected.pages) ? projected.pages : []).forEach(function (page) {
    (Array.isArray(page && page.items) ? page.items : []).forEach(function (it) {
      if (it && it[record.FIELD.ID] === args.item) found = it;
    });
  });
  if (!found) return "no item " + JSON.stringify(args.item) + " in review.json for review " + args.review;
  if (found[record.FIELD.REV] !== args.rev) {
    return "item " + args.item + " is at rev " + found[record.FIELD.REV] + " in review.json and you passed " + args.rev +
      "; suggestions name that revision's words, so re-read the item and answer its current rev";
  }
  if (!record.isRunRecord(found)) return "item " + args.item + " has no new_blocks, so there is nothing to proofread";
  var named = [];
  args.suggestions.forEach(function (sg) {
    var one = record.applySuggestions(found, [sg]);
    if (one && one.code) named.push(suggestionName(sg) + ": " + one.code + ", " + one.reason.replace(/^suggestion 0/, "this suggestion"));
  });
  if (named.length) return "refused " + named.join("; ");
  var all = record.applySuggestions(found, args.suggestions);
  if (all && all.code) return "the suggestions do not apply together: " + all.code + ", " + all.reason;
  return null;
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

var ENTRY_KEYS = ["item", "rev", "status", "text", "reason", "files", "needs_see", "proofread", "suggest"];

/** "entry 2 (item itm_x)", the words every batch problem opens with. */
function entryName(entry, index) {
  var item = entry && typeof entry === "object" && typeof entry.item === "string" ? entry.item : null;
  return "entry " + (index + 1) + (item ? " (item " + item + ")" : "");
}

/**
 * One batch entry, as the args the single form would have built from flags.
 * Returns {args} or {error}. The field types are checked here because JSON can
 * hold a number where a flag held a string; the per-status and proofread rules
 * are the single form's own functions, not copies of them.
 */
function entryArgs(entry, batchArgs) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { error: "must be a JSON object" };
  var unknown = Object.keys(entry).filter(function (key) { return ENTRY_KEYS.indexOf(key) === -1; });
  if (unknown.length) {
    return { error: "has an unknown field " + JSON.stringify(unknown[0]) + "; the fields are " + ENTRY_KEYS.join(", ") };
  }
  if (typeof entry.item !== "string" || !entry.item) return { error: "item is required, as review.json or lahe status prints it" };
  if (!protocol.isSafeId(entry.item)) return { error: "item must be an item id as review.json prints it: " + String(protocol.SAFE_ID) };
  if (typeof entry.rev !== "number" || !Number.isInteger(entry.rev)) {
    return { error: "rev is required and must be an integer (a number, not a string), got " + JSON.stringify(entry.rev) };
  }
  if (protocol.REPLY_STATUSES.indexOf(entry.status) === -1) {
    return { error: "status must be one of " + protocol.REPLY_STATUSES.join(", ") + ", got " + JSON.stringify(entry.status) };
  }
  var notString = ["text", "reason"].filter(function (key) {
    return entry[key] !== undefined && typeof entry[key] !== "string";
  })[0];
  if (notString) return { error: notString + " must be a string" };
  if (entry.files !== undefined) {
    var goodFiles = Array.isArray(entry.files) && entry.files.every(function (path) { return typeof path === "string" && path.trim(); });
    if (!goodFiles) return { error: "files must be a list of paths" };
  }
  if (entry.needs_see !== undefined && typeof entry.needs_see !== "boolean") return { error: "needs_see must be true or false" };
  if (entry.proofread !== undefined && typeof entry.proofread !== "boolean") return { error: "proofread must be true or false" };
  var suggestions = [];
  if (entry.suggest !== undefined) {
    if (!Array.isArray(entry.suggest)) return { error: "suggest must be a list of [block, from, to]" };
    for (var i = 0; i < entry.suggest.length; i += 1) {
      var sg = entry.suggest[i];
      if (!Array.isArray(sg) || sg.length !== 3 || !Number.isInteger(sg[0]) || sg[0] < 0 || typeof sg[1] !== "string" || typeof sg[2] !== "string") {
        return { error: "each suggest entry must be [block, from, to]: a whole number from 0, then two strings" };
      }
      suggestions.push({ block: sg[0], from: sg[1], to: sg[2] });
    }
  }

  var args = {
    review: batchArgs.review,
    item: entry.item,
    rev: entry.rev,
    status: entry.status,
    text: entry.text || null,
    reason: entry.reason || null,
    files: entry.files ? entry.files.slice() : [],
    needsSee: entry.needs_see === true,
    proofread: entry.proofread === true,
    suggestions: suggestions,
    agent: batchArgs.agent
  };
  var problem = proofreadRuleError(args) || validateBody(args);
  return problem ? { error: problem } : { args: args };
}

/**
 * The entries of a batch, or why the stdin text is not one.
 * Every entry is checked before the caller writes anything.
 */
function parseBatch(text, batchArgs, dir) {
  if (!String(text).trim()) return { error: "--batch read nothing from stdin; it needs a JSON array of replies" };
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: "stdin is not valid JSON (" + error.message + "). A line break inside a string must be written \\n; --batch refuses a raw one rather than splitting it" };
  }
  if (!Array.isArray(parsed)) return { error: "stdin must be a JSON array of replies, got " + (parsed === null ? "null" : typeof parsed) };
  if (!parsed.length) return { error: "the batch is empty; there is nothing to write" };

  var entries = [];
  for (var i = 0; i < parsed.length; i += 1) {
    var built = entryArgs(parsed[i], batchArgs);
    var problem = built.error || (built.args.proofread ? proofreadProblem(dir, built.args) : null);
    if (problem) return { error: entryName(parsed[i], i) + ": " + problem };
    entries.push(built.args);
  }
  return { entries: entries };
}

/** `lahe reply --batch`: validate every entry, then append every line in one write. */
async function runBatch(args, opts, out, err) {
  var isTty = opts.stdinIsTty === undefined ? Boolean(process.stdin && process.stdin.isTTY) : opts.stdinIsTty;
  var text;
  if (opts.stdin !== undefined) text = String(opts.stdin);
  else if (isTty) {
    err("lahe reply: --batch reads a JSON array of replies from stdin, and stdin is a terminal\n");
    return EXIT.BAD_USAGE;
  } else text = readStdin(opts.readFileSync);

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
  var batch;
  try {
    if (!fs.existsSync(stateDirModule.reviewDir(dir, args.review))) {
      err("lahe reply: no review " + JSON.stringify(args.review) + " in " + stateDirModule.reviewsRoot(dir) + "\n");
      return EXIT.UNKNOWN_REVIEW;
    }
    batch = parseBatch(text, args, dir);
    if (batch.error) {
      err("lahe reply: nothing written. " + batch.error + "\n");
      return EXIT.BAD_USAGE;
    }
    target = stateDirModule.replyFilePath(dir, args.review, replyFilename(args.agent));
  } catch (error) {
    err("lahe reply: " + error.message + "\n");
    return EXIT.BAD_USAGE;
  }

  var lines = batch.entries.map(function (entry) { return JSON.stringify(replyObject(entry)); });
  try {
    stateDirModule.appendLine(target, lines.join("\n") + "\n");
  } catch (error) {
    err("lahe reply: could not append to " + target + ": " + error.message + "\n");
    return EXIT.BAD_USAGE;
  }

  batch.entries.forEach(function (entry, index) {
    var warning = revWarning(dir, args.review, entry.item, entry.rev);
    if (warning) err("lahe reply: warning: " + entryName(entry, index) + ": " + warning + "\n");
  });

  if (args.session) {
    try {
      agentSessionsModule.createStore({ dir: dir }).touchActivity(args.session);
    } catch (error) {
      // A session that does not exist is not a reason to fail a written reply.
    }
  }

  out(batch.entries.map(function (entry) {
    return JSON.stringify({ item: entry.item, status: entry.status }) + "\n";
  }).join(""));
  return EXIT.OK;
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
  if (args.batch) return runBatch(args, opts, out, err);

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
    if (args.proofread) {
      var problem = proofreadProblem(dir, args);
      if (problem) {
        err("lahe reply: " + problem + "\n");
        return EXIT.BAD_USAGE;
      }
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

  // THE ITEM AND THE STATUS, NOT THE WHOLE LINE. The agent just wrote the
  // words, and echoing them back put every reply in its context twice. The
  // file holds the whole line.
  out(JSON.stringify({ item: args.item, status: args.status }) + "\n");
  return EXIT.OK;
}

module.exports = {
  USAGE: USAGE,
  EXIT: EXIT,
  parseArgs: parseArgs,
  resolveStdin: resolveStdin,
  validateBody: validateBody,
  replyObject: replyObject,
  proofreadProblem: proofreadProblem,
  replyFilename: replyFilename,
  revWarning: revWarning,
  entryArgs: entryArgs,
  parseBatch: parseBatch,
  run: run
};
