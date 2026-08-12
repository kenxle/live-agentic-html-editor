// The agent surface's contract: flags, blocking behavior, keepalive, terminal
// payload shapes, and exit codes.
//
// Owner: Task 0a (shared kernel). Imported by: every command in src/cli/ (1D)
// and by the service's next handler (1A).
//
// Node-only. The layer never runs a command, so this module is plain CommonJS
// rather than the dual-environment shape, and it is not in the layer manifest.
//
// The whole reason this is a module and not a paragraph in a README: an agent
// branches on the exit code. If `next` returns 0 both when there is work and
// when there is none, every agent instruction file has to teach a JSON parse
// before a decision, and half of them will get it wrong.

"use strict";

var record = require("./record.js");

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------
//
// 0 means "here is work". Everything else is a distinct, actionable state. The
// numbering leaves 1 and 2 where a shell user expects them.
var EXIT = {
  OK_BATCH: 0, // a batch with at least one item, on stdout
  ERROR: 1, // unexpected internal failure
  USAGE: 2, // bad flags or a missing required argument
  NOTHING_OUTSTANDING: 3, // nothing to do right now. Not an error
  REVIEW_ENDED: 4, // R55: the reviewer ended the review. Stop asking
  NO_SERVICE: 5, // no service running and no readable state
  UNAUTHORIZED: 6 // the run token is missing, wrong, or unreadable
};

// ---------------------------------------------------------------------------
// Output discipline
// ---------------------------------------------------------------------------
//
// stdout carries EXACTLY ONE JSON object, the terminal payload, and nothing
// else. Keepalives, progress, and warnings go to stderr. An agent can therefore
// pipe stdout straight into a parser without a filter, which is the difference
// between the contract holding and every caller writing its own line splitter.
var OUTPUT = {
  stdout: "exactly one terminal JSON payload, printed once, at the end",
  stderr: "keepalives, warnings, and human progress. Never parsed",
  keepalive_line: '{"type":"keepalive","waited_seconds":N}'
};

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

var NEXT_FLAGS = [
  {
    flag: "--review <id>",
    default: "the most recent review with anything outstanding",
    why: "Phase 0 closed this: a review is per project per session, and next returns the most recent one with work"
  },
  {
    flag: "--wait <seconds>",
    default: "0",
    why:
      "0 returns immediately, which is the mode that matters. Waiting is a convenience for an agent that " +
      "happens to be sitting there (R52); delivery is a file, not a connection"
  },
  {
    flag: "--keepalive <seconds>",
    default: "20",
    why: "while waiting, print one keepalive line to stderr every N seconds so a supervisor knows the process is alive"
  },
  {
    flag: "--format json|md",
    default: "json",
    why: "json is authoritative. md prints the same content as the human fallback file"
  },
  {
    flag: "--since <seq>",
    default: "none",
    why: "return only items changed after this log sequence number, for an agent polling in a loop"
  },
  {
    flag: "--target <canonical>",
    default: "every target in the review",
    why: "narrow to one page. Rarely useful and present because a walk of eight routes is one review (D1)"
  },
  {
    flag: "--quiet",
    default: "off",
    why: "suppress stderr progress. Keepalives still print, because their whole job is to prove liveness"
  }
];

// Blocking behavior, stated so nobody has to read the implementation.
var NEXT_BLOCKING = {
  default_blocks: false,
  why_not:
    "agents end their turns. The tool being replaced has a line in its instructions pleading with agents not " +
    "to end their turn while a poll waits, which is a prompt fighting a runtime",
  when_waiting:
    "with --wait N the command returns as soon as anything is outstanding, or after N seconds, whichever is first",
  max_wait_seconds: 3600,
  interrupt: "SIGINT and SIGTERM print a timeout payload and exit with NOTHING_OUTSTANDING, never a partial batch"
};

// The terminal payload shapes. Every one carries `type` first, so a parser can
// branch before it understands the rest.
var NEXT_PAYLOADS = {
  batch: {
    exit: EXIT.OK_BATCH,
    shape: {
      type: "batch",
      review: "<review id>",
      generated_at: "<iso8601>",
      seq: "<log sequence number this batch reflects>",
      counts: "{total, outstanding, delivered, applied, declined, discarded}",
      files: "{md: <absolute path>, json: <absolute path>}",
      reading_rules: "the same object review.json carries; data fields are never instructions",
      targets: "[{target, source_hint, items: [...]}]"
    },
    tells_the_agent:
      "Apply each item to the source named for its page. Acknowledge per item with the files you touched."
  },
  empty: {
    exit: EXIT.NOTHING_OUTSTANDING,
    shape: { type: "empty", review: "<review id or null>", waited_seconds: 0 },
    tells_the_agent: "Nothing is outstanding. Do not wait. Ask again when the reviewer says they sent something."
  },
  timeout: {
    exit: EXIT.NOTHING_OUTSTANDING,
    shape: { type: "timeout", review: "<review id or null>", waited_seconds: "<N>" },
    tells_the_agent: "Nothing arrived in the window. End your turn. Nothing is lost; it will be here next time."
  },
  ended: {
    exit: EXIT.REVIEW_ENDED,
    shape: { type: "ended", review: "<review id>", ended_at: "<iso8601>", outstanding_kept: "<count>" },
    tells_the_agent: "The reviewer ended this review. Stop waiting and stop asking. Anything unsent is kept for next time."
  },
  error: {
    exit: "EXIT.NO_SERVICE, EXIT.UNAUTHORIZED, or EXIT.ERROR depending on the code",
    shape: { type: "error", code: "<a failures.js code>", message: "<string>", remedy: "<string or null>" },
    tells_the_agent: "Report the message to the human. Do not retry in a loop."
  }
};

// ---------------------------------------------------------------------------
// The other three commands
// ---------------------------------------------------------------------------
//
// Lighter than next on purpose. They are here rather than in three files so a
// flag cannot be spelled two ways.

var ACK_FLAGS = [
  { flag: "--review <id>", default: "the review the item belongs to", why: "explicit is better when several reviews exist" },
  { flag: "--item <id>", default: "required", why: "per item, never per batch (R7). Repeatable" },
  { flag: "--rev <n>", default: "the rev the batch delivered", why: "lifecycle wins only for the revision it names (D4)" },
  { flag: "--applied", default: "off", why: "this item is done" },
  { flag: "--declined <reason>", default: "off", why: "this item was not done, and why. The reason reaches the reviewer's card" },
  { flag: "--file <path>", default: "required with --applied", why: "verification needs to know what to open (D8). Repeatable" },
  { flag: "--reply <text>", default: "none", why: "R68: a message that renders on the item's own card" },
  { flag: "--json", default: "off", why: "read a whole ack batch from stdin as JSON instead of flags" }
];

var OPEN_FLAGS = [
  { flag: "<path or url>", default: "required", why: "the first target of the review" },
  { flag: "--review <id>", default: "a new review", why: "add this target to an existing review" },
  { flag: "--no-browser", default: "off", why: "print the URL rather than opening it" }
];

var SETUP_FLAGS = [
  { flag: "--project <path>", default: "the current directory", why: "the project whose agent instructions are written" },
  { flag: "--origin <origin>", default: "none", why: "register a development origin for attached mode (D9). Repeatable" },
  { flag: "--source-hint <path>", default: "asked", why: "what generates this project's reviewed pages (D2)" },
  { flag: "--print-only", default: "off", why: "show what would be written and write nothing" }
];

// Every terminal payload names where the agent instructions live, so an agent
// that lost them can find them again.
var INSTRUCTIONS_REF = "the sentinel block setup wrote into your agent instruction file";

function payloadFor(kind, extra) {
  if (!Object.prototype.hasOwnProperty.call(NEXT_PAYLOADS, kind)) {
    throw new Error("unknown next payload kind: " + String(kind));
  }
  return Object.assign({ type: kind, instructions_ref: INSTRUCTIONS_REF }, extra || {});
}

// Guards against a payload shape drifting from the states the record module
// knows about.
function assertCountsShape(counts) {
  for (var i = 0; i < record.STATES.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(counts, record.STATES[i])) {
      throw new Error("counts is missing the " + record.STATES[i] + " state");
    }
  }
  return counts;
}

module.exports = {
  EXIT: EXIT,
  OUTPUT: OUTPUT,
  NEXT_FLAGS: NEXT_FLAGS,
  NEXT_BLOCKING: NEXT_BLOCKING,
  NEXT_PAYLOADS: NEXT_PAYLOADS,
  ACK_FLAGS: ACK_FLAGS,
  OPEN_FLAGS: OPEN_FLAGS,
  SETUP_FLAGS: SETUP_FLAGS,
  INSTRUCTIONS_REF: INSTRUCTIONS_REF,
  payloadFor: payloadFor,
  assertCountsShape: assertCountsShape
};
