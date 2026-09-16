#!/usr/bin/env node
// Turn real event logs into test fixtures that carry no real words.
//
// The equivalence tests in test/unit/projection_incremental.test.js have to run
// against sequences a browser really produced, because the fold keeps state
// across event boundaries and a hand-written sequence is a guess about which
// boundaries matter. But a real log carries the reviewer's comments, the text
// of whatever document they were reviewing, the paths on their disk, and the
// review's bearer token, and this repository is public. So the fixtures are
// real in SHAPE and fake in CONTENT, and this script is how one becomes the
// other, so the next person can redo it rather than trust it.
//
// WHAT IS KEPT, because the fold reads it:
//
//   the order of the lines, and every seq and ts
//   every event type, item id, revision, review id and page_seq
//   every lifecycle field: state, status, kind, accepted, draft, reply shape
//   the LENGTH of every piece of text, because review_format.js bounds
//     page-derived text at a maximum and a shorter fake would not be bounded
//   the LENGTH of thread and after_history arrays, because the fold's
//     continuation rule compares them
//
// WHAT IS REPLACED:
//
//   every prose field, with a deterministic slice of a lorem corpus of exactly
//     the same length (same input, same output, so two fields that were equal
//     stay equal and page grouping does not change)
//   every path, with dir-N/page-N.ext, keeping the extension and the depth
//   every origin, with http://127.0.0.1:4NNN, one per distinct original
//   the review token and the agent session id, with obvious dummies
//   the agent's name, with "agent"
//
// THE TABLE IS DEFAULT-DENY. Every string is looked up by its full path in the
// event (record.context.quote, reply.files[], and so on). A path that is not in
// the table is scrubbed as prose and reported, so a log shape this script has
// not seen cannot leak by being unrecognised.
//
// Usage, from a machine that has the real logs:
//
//   node scripts/scrub-log-fixtures.js
//
// It reads the review ids in FIXTURES below out of the helper's state directory
// (LAHE_STATE_DIR, or ~/.local/state/lahe) and writes test/fixtures/logs/.
//
// Node-only. Not shipped, not required by anything at runtime.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Which logs, and why each one
// ---------------------------------------------------------------------------

const FIXTURES = [
  { review: "r9de3b2a18cd4", why: "the largest log under the 20 MB cap" },
  { review: "r9dcf69be6afc", why: "the most replies, and the most rewording" },
  { review: "ra34b8e0e4d5a", why: "60 replies in a short log, and the only item.deleted" },
  { review: "r0fce850a67da", why: "the only small log carrying an item.reopened" },
  { review: "r28b63eabad87", why: "tiny, and carries review.archived, so ended_at is folded" }
];

const OUT_DIR = path.join(__dirname, "..", "test", "fixtures", "logs");

// ---------------------------------------------------------------------------
// The placeholder corpus
// ---------------------------------------------------------------------------
//
// Lowercase letters and single spaces, nothing else. No capital, no digit, no
// punctuation, no "@", no slash, no angle bracket. That is what makes the leak
// check in the test a complete statement rather than a list of words somebody
// remembered: a scrubbed field either IS a slice of this corpus or it is not,
// and nothing written by a person is.

const LOREM =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam " +
  "quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo " +
  "consequat duis aute irure in reprehenderit voluptate velit esse cillum eu " +
  "fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt " +
  "culpa qui officia deserunt mollit anim id est laborum ";

/** A small stable hash, so the same original always becomes the same fake. */
function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A lorem slice of exactly `length` characters, chosen by the original. */
function placeholder(original) {
  const length = original.length;
  if (length === 0) return "";
  const start = hashOf(original) % LOREM.length;
  let out = "";
  while (out.length < length) out += LOREM.slice(start) + LOREM.slice(0, start);
  return out.slice(0, length);
}

/**
 * Is this string a lorem slice, and therefore not something a person wrote?
 *
 * Exported so the test can assert it over every scrubbed field rather than
 * taking this script's word for it.
 */
function isPlaceholder(value) {
  if (typeof value !== "string" || value.length === 0) return true;
  const head = value.slice(0, Math.min(value.length, LOREM.length));
  const start = (LOREM + LOREM).indexOf(head);
  if (start === -1 || start >= LOREM.length) return false;
  let out = "";
  while (out.length < value.length) out += LOREM.slice(start) + LOREM.slice(0, start);
  return out.slice(0, value.length) === value;
}

// ---------------------------------------------------------------------------
// Stable renaming, one counter per kind
// ---------------------------------------------------------------------------

function createNamer() {
  const seen = Object.create(null);
  const counts = Object.create(null);
  return function name(kind, original, make) {
    const key = kind + "" + original;
    if (key in seen) return seen[key];
    counts[kind] = (counts[kind] || 0) + 1;
    seen[key] = make(counts[kind]);
    return seen[key];
  };
}

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

function createActions() {
  const name = createNamer();

  function fakePath(value) {
    // Depth and extension are kept, every name is replaced. A distinct original
    // always gets a distinct fake, so page grouping (origin plus path) keeps
    // exactly the groups it had.
    const leading = value.charAt(0) === "/" ? "/" : "";
    const parts = value.replace(/^\/+/, "").split("/");
    const base = parts.pop() || "";
    const dirs = parts.map((segment) => name("dir", segment, (n) => "dir-" + n));
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    const fakeBase = name("base", stem, (n) => "page-" + n) + ext;
    return leading + dirs.concat([fakeBase]).join("/");
  }

  return {
    keep: (value) => value,
    text: (value) => placeholder(value),
    path: (value) => fakePath(value),
    origin: (value) =>
      value === "null" ? "null" : name("origin", value, (n) => "http://127.0.0.1:" + (4000 + n)),
    session: (value) => name("session", value, (n) => "s_" + String(n).padStart(16, "0")),
    token: (value) => "x".repeat(value.length),
    agent: () => "agent",
    element: (value) => name("element", value, (n) => "el-" + n),
    cssClass: (value) => name("class", value, (n) => "cls-" + n),
    replyFile: (value) => (value.indexOf("-") === -1 ? value : "replies-agent.jsonl")
  };
}

// ---------------------------------------------------------------------------
// The table: every string path a real log has produced, and what happens to it
// ---------------------------------------------------------------------------
//
// Anything not listed is scrubbed as prose and reported. Grouped the way the
// census that produced it was grouped, so a new field is easy to slot in.

const TABLE = {
  // The envelope
  event: "keep",
  event_id: "keep", // minted ids and sha256 digests of reply lines; no content
  ts: "keep",
  review: "keep",
  item: "keep",
  state: "keep",
  token: "token",
  agent_session_id: "session",
  origin: "origin",
  page_path: "path",
  page_title: "text",
  source_hint: "path",
  file: "replyFile",
  refusal: "text",

  // The folded reply, as the event carries it
  "reply.agent": "agent",
  "reply.status": "keep",
  "reply.reason": "text",
  "reply.text": "text",
  "reply.files[]": "path",

  // The carried record
  "record.id": "keep",
  "record.kind": "keep",
  "record.state": "keep",
  "record.created_at": "keep",
  "record.updated_at": "keep",
  "record.page_origin": "origin",
  "record.page_path": "path",
  "record.page_title": "text",
  "record.source_hint": "path",
  "record.reverts": "keep",
  "record.note": "text",
  "record.change": "text",
  "record.before": "text",
  "record.after": "text",
  "record.before_html": "text",
  "record.after_html": "text",
  "record.after_history[].at": "keep",
  "record.after_history[].after": "text",
  "record.after_history[].after_html": "text",

  // Where on the page it was anchored
  "record.context.element": "keep",
  "record.context.heading": "text",
  "record.context.prefix": "text",
  "record.context.suffix": "text",
  "record.context.quote": "text",
  "record.context.subject.tag": "keep",
  "record.context.subject.html": "text",
  "record.context.subject.near": "text",
  "record.context.subject.alt": "text",
  "record.context.subject.src": "path",
  "record.region.label": "text",
  "record.region.label_source": "keep",
  "record.region.lost.at": "keep",
  "record.region.lost.code": "keep",
  "record.region.lost.reason": "text",
  "record.region.ref.id": "keep",
  "record.region.ref.minted_at": "keep",
  "record.region.ref.path": "keep",
  "record.region.ref.where": "keep",
  "record.region.ref.stamp": "keep",
  "record.region.ref.probe_kind": "keep",
  "record.region.ref.not_unique_reason": "keep",
  "record.region.ref.heading": "text",
  "record.region.ref.prefix": "text",
  "record.region.ref.suffix": "text",
  "record.region.ref.probe": "text",
  "record.region.ref.failure.failureCode": "keep",
  "record.region.ref.failure.reason": "keep",
  "record.region.ref.failure.detail": "keep",
  "record.region.ref.fingerprint.tag": "keep",
  "record.region.ref.fingerprint.element_id": "element",
  "record.region.ref.fingerprint.classes[]": "cssClass",
  "record.region.ref.fingerprint.chain[].tag": "keep",
  "record.region.ref.fingerprint.chain[].id": "element",
  "record.region.ref.fingerprint.chain[].classes[]": "cssClass",

  // The reply as the record holds it, and the archived rounds
  "record.reply.agent": "agent",
  "record.reply.at": "keep",
  "record.reply.status": "keep",
  "record.reply.reason": "text",
  "record.reply.text": "text",
  "record.reply.files[]": "path",
  "record.thread[].reviewer.at": "keep",
  "record.thread[].reviewer.note": "text",
  "record.thread[].reviewer.change": "text",
  "record.thread[].agent.agent": "agent",
  "record.thread[].agent.at": "keep",
  "record.thread[].agent.status": "keep",
  "record.thread[].agent.reason": "text",
  "record.thread[].agent.text": "text",
  "record.thread[].agent.files[]": "path"
};

/** Every path in the table whose value survives as written. */
function keptPaths() {
  return Object.keys(TABLE).filter((key) => TABLE[key] === "keep");
}

// ---------------------------------------------------------------------------
// Walking one event
// ---------------------------------------------------------------------------

function scrubEvent(event, actions, unknown) {
  function walk(node, at) {
    if (typeof node === "string") {
      const action = TABLE[at] || "text";
      if (!TABLE[at]) unknown[at] = (unknown[at] || 0) + 1;
      return actions[action](node);
    }
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((each) => walk(each, at + "[]"));
    const out = {};
    Object.keys(node).forEach((key) => {
      out[key] = walk(node[key], at ? at + "." + key : key);
    });
    return out;
  }
  return walk(event, "");
}

// ---------------------------------------------------------------------------
// The shape census: what the test asserts the scrub did not change
// ---------------------------------------------------------------------------

function shapeOf(events) {
  const eventTypes = Object.create(null);
  const maxRev = Object.create(null);
  const threadLengths = [];
  const afterHistoryLengths = [];
  let maxSeq = 0;

  events.forEach((event) => {
    eventTypes[event.event] = (eventTypes[event.event] || 0) + 1;
    if (typeof event.seq === "number" && event.seq > maxSeq) maxSeq = event.seq;
    if (typeof event.item === "string" && typeof event.rev === "number") {
      if (!(event.item in maxRev) || event.rev > maxRev[event.item]) maxRev[event.item] = event.rev;
    }
    if (event.record && typeof event.record === "object") {
      if (Array.isArray(event.record.thread)) threadLengths.push(event.record.thread.length);
      if (Array.isArray(event.record.after_history)) afterHistoryLengths.push(event.record.after_history.length);
    }
  });

  const items = Object.keys(maxRev).sort();
  return {
    events: events.length,
    max_seq: maxSeq,
    event_types: sortedObject(eventTypes),
    items: items.length,
    items_past_rev_1: items.filter((id) => maxRev[id] >= 2).length,
    replies_folded: eventTypes["reply.folded"] || 0,
    max_rev_by_item: items.map((id) => [id, maxRev[id]]),
    thread_lengths: threadLengths,
    after_history_lengths: afterHistoryLengths
  };
}

function sortedObject(source) {
  const out = {};
  Object.keys(source)
    .sort()
    .forEach((key) => {
      out[key] = source[key];
    });
  return out;
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

function stateDirPath() {
  if (process.env.LAHE_STATE_DIR) return path.resolve(process.env.LAHE_STATE_DIR);
  if (process.env.XDG_STATE_HOME) return path.join(path.resolve(process.env.XDG_STATE_HOME), "lahe");
  return path.join(os.homedir(), ".local", "state", "lahe");
}

function main() {
  const root = stateDirPath();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const unknown = Object.create(null);
  const manifest = { generated_by: "scripts/scrub-log-fixtures.js", kept_paths: keptPaths().sort(), logs: [] };

  FIXTURES.forEach((fixture) => {
    const source = path.join(root, "reviews", fixture.review, "events.jsonl");
    if (!fs.existsSync(source)) {
      console.error("missing: " + source);
      process.exitCode = 1;
      return;
    }
    const raw = fs.readFileSync(source, "utf8");
    const actions = createActions();
    const before = [];
    const after = [];
    raw.split("\n").forEach((line) => {
      if (!line) return;
      const parsed = JSON.parse(line);
      before.push(parsed);
      after.push(scrubEvent(parsed, actions, unknown));
    });

    const target = path.join(OUT_DIR, fixture.review + ".events.jsonl");
    fs.writeFileSync(target, after.map((event) => JSON.stringify(event)).join("\n") + "\n", { mode: 0o644 });

    const beforeShape = shapeOf(before);
    const afterShape = shapeOf(after);
    if (JSON.stringify(beforeShape) !== JSON.stringify(afterShape)) {
      console.error("SHAPE CHANGED for " + fixture.review + ": the scrub is not faithful");
      process.exitCode = 1;
    }

    manifest.logs.push({
      file: fixture.review + ".events.jsonl",
      review: fixture.review,
      why: fixture.why,
      bytes_before: Buffer.byteLength(raw, "utf8"),
      bytes_after: fs.statSync(target).size,
      shape: afterShape
    });
    console.log(
      fixture.review +
        ": " +
        Buffer.byteLength(raw, "utf8") +
        " -> " +
        fs.statSync(target).size +
        " bytes, " +
        afterShape.events +
        " events"
    );
  });

  fs.writeFileSync(path.join(OUT_DIR, "shape.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });

  const surprises = Object.keys(unknown);
  if (surprises.length) {
    console.error("scrubbed as prose because the table does not name them:");
    surprises.sort().forEach((at) => console.error("  " + at + " (" + unknown[at] + ")"));
    console.error("add each one to TABLE and re-run, so the choice is on the record.");
    process.exitCode = 1;
  }
}

module.exports = {
  LOREM: LOREM,
  TABLE: TABLE,
  placeholder: placeholder,
  isPlaceholder: isPlaceholder,
  shapeOf: shapeOf,
  scrubEvent: scrubEvent,
  createActions: createActions,
  keptPaths: keptPaths
};

if (require.main === module) main();
