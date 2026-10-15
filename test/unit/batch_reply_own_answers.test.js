// Batch reply, and no echo of the agent's own answers
// (docs/features/20261015.01_batch_reply_own_answers).
//
// Two cuts to what a reviewed document costs the agent. The drain
// (`lahe status --json --quiet`) stops handing the agent its own earlier
// answers back, and `lahe reply --batch` answers many items in one run. The
// catch-up (`lahe status --json`) and review.json keep every word.
//
// Node-only. No process is started: every command runs in this process.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const projectionModule = require("../../src/service/projection.js");
const stateDirModule = require("../../src/service/state_dir.js");
const reviewFormat = require("../../src/shared/review_format.js");
const status = require("../../src/cli/commands/status.js");
const reply = require("../../src/cli/commands/reply.js");

const SESSION = "s_batch";
const REVIEW = "r_batch";
const ORIGIN = "http://docs.batch.lahe.localhost";

const tempDirs = [];
test.after(() => {
  // The test removes the folders it made.
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-batch-"));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// The drain leaves out the agent's own words
// ---------------------------------------------------------------------------

const FIRST_ANSWER = "FIRST-ANSWER-WORDS I moved the table up.";
const SECOND_ANSWER = "SECOND-ANSWER-WORDS I trimmed the heading as well.";
const SECOND_REASON = "SECOND-REASON-WORDS the heading is shared.";

function aFollowUp(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        rev: 3,
        note: "THIRD-REVIEWER-NOTE now the footer",
        page_origin: ORIGIN,
        page_path: "/brief.md",
        page_seq: 1,
        created_at: "2026-10-14T20:47:58.025Z",
        updated_at: "2026-10-14T20:48:39.468Z",
        context: { quote: "the table", prefix: "", suffix: "", heading: "Needs your call", element: null, subject: null },
        region: { ref: { id: "ref_1", stamp: "e8m86g2km", where: "main > p", ordinal: { index: 1, of: 1 } }, label: "p 1", lost: null },
        thread: [
          {
            rev: 1,
            reviewer: { note: "FIRST-REVIEWER-NOTE move the table", change: null, at: "2026-10-14T20:00:00.000Z" },
            agent: { status: "handled", agent: "claude", text: FIRST_ANSWER, reason: null, files: ["brief.md"], at: "2026-10-14T20:01:00.000Z" }
          },
          {
            rev: 2,
            reviewer: { note: "SECOND-REVIEWER-NOTE and the heading", change: "SECOND-REVIEWER-CHANGE", at: "2026-10-14T20:10:00.000Z" },
            agent: { status: "not_handled", agent: "claude", text: SECOND_ANSWER, reason: SECOND_REASON, files: [], at: "2026-10-14T20:11:00.000Z" }
          }
        ]
      },
      overrides || {}
    )
  );
}

function stateWith(items, options) {
  const opts = options || {};
  const dir = tempDir();
  agentSessions.createStore({ dir: dir }).create({ id: SESSION });
  const log = logModule.createEventLog({ dir: dir });
  reviewsModule.createReviews({ dir: dir, log: log }).create({ id: REVIEW, agent_session_id: SESSION });
  items.forEach((item, index) => {
    log.append(REVIEW, [
      protocol.newEvent({
        event: protocol.EVENT.ITEM_READY,
        event_id: "ev_batch_" + index,
        review: REVIEW,
        item: item[record.FIELD.ID],
        rev: item[record.FIELD.REV],
        page_path: item[record.FIELD.PAGE_PATH],
        page_seq: item[record.FIELD.PAGE_SEQ],
        payload: { draft: false, record: item }
      })
    ]);
  });
  if (opts.helperUp) {
    fs.writeFileSync(
      stateDirModule.readyPath(dir),
      JSON.stringify({ port: 7999, reviews: { [REVIEW]: { token: "t".repeat(16), origins: [ORIGIN] } } })
    );
  }
  return dir;
}

function helperFor(dir) {
  return async function () {
    const projection = projectionModule.project(REVIEW, logModule.createEventLog({ dir: dir }).read(REVIEW));
    projection.page_last_seen_at = new Date().toISOString();
    return { ok: true, status: 200, json: async () => projection };
  };
}

async function statusRun(dir, extra, fetchImpl) {
  const out = [];
  const err = [];
  const code = await status.run(["--session", SESSION, "--json", "--state-dir", dir].concat(extra), {
    stdout: (text) => out.push(String(text)),
    stderr: (text) => err.push(String(text)),
    fetch: fetchImpl
  });
  assert.equal(code, protocol.CLI_EXIT.OK, err.join(""));
  return out.join("");
}

function itemLine(text) {
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).find((line) => line.id);
}

test("drainLine as a drain keeps each agent turn's status and agent and leaves out its words", () => {
  const projected = reviewFormat.projectItem(aFollowUp(), null, undefined, {});
  const line = status.drainLine({ review: REVIEW }, projected, true);
  const text = JSON.stringify(line);
  assert.equal(text.includes("FIRST-ANSWER-WORDS"), false, text);
  assert.equal(text.includes("SECOND-ANSWER-WORDS"), false, text);
  assert.equal(text.includes("SECOND-REASON-WORDS"), false, text);
  assert.equal(line.thread.length, 2, "both rounds are still there");
  assert.equal(line.thread[0].agent.status, "handled");
  assert.equal(line.thread[0].agent.agent, "claude");
  assert.equal(line.thread[1].agent.status, "not_handled");
});

test("drainLine as a drain keeps everything the reviewer wrote in the thread", () => {
  const projected = reviewFormat.projectItem(aFollowUp(), null, undefined, {});
  const line = status.drainLine({ review: REVIEW }, projected, true);
  assert.equal(line.note, "THIRD-REVIEWER-NOTE now the footer");
  assert.equal(line.thread[0].reviewer.note, "FIRST-REVIEWER-NOTE move the table");
  assert.equal(line.thread[1].reviewer.note, "SECOND-REVIEWER-NOTE and the heading");
  assert.equal(line.thread[1].reviewer.change, "SECOND-REVIEWER-CHANGE");
  assert.equal(line.thread[1].reviewer.at, "2026-10-14T20:10:00.000Z");
});

test("drainLine leaves out the words of a current top-level reply too, and keeps its status", () => {
  const item = aFollowUp({
    reply: { status: "question", agent: "claude", text: "PENDING-QUESTION-WORDS which table?", reason: null, files: [], at: "2026-10-14T20:30:00.000Z" }
  });
  const projected = reviewFormat.projectItem(item, null, undefined, {});
  assert.ok(projected.reply && projected.reply.text, "the projection holds the reply");
  const line = status.drainLine({ review: REVIEW }, projected, true);
  assert.equal(JSON.stringify(line).includes("PENDING-QUESTION-WORDS"), false);
  assert.equal(line.reply.status, "question");
  assert.equal(line.reply.agent, "claude");
});

test("a proofread turn's fixes stay on the drain, because the contract sends the agent to read them there", () => {
  const item = aFollowUp({
    thread: [
      {
        rev: 1,
        reviewer: { note: "go", change: null, at: "2026-10-14T20:00:00.000Z" },
        agent: {
          status: "question", agent: "claude", text: "I placed it as written.", proofread: true,
          suggestions: [{ block: 0, from: "teh", to: "the" }], at: "2026-10-14T20:01:00.000Z"
        }
      }
    ]
  });
  const projected = reviewFormat.projectItem(item, null, undefined, {});
  const line = status.drainLine({ review: REVIEW }, projected, true);
  // The proofread question is the thread's last turn, and the reviewer's button
  // answers it, so its words stay with its fixes.
  assert.equal(line.thread[0].agent.text, "I placed it as written.");
  assert.deepEqual(line.thread[0].agent.suggestions, [{ block: 0, from: "teh", to: "the" }]);
});

test("drainLine without the drain flag prints the agent's words in full", () => {
  const projected = reviewFormat.projectItem(aFollowUp(), null, undefined, {});
  const line = status.drainLine({ review: REVIEW }, projected);
  assert.equal(line.thread[0].agent.text, FIRST_ANSWER);
  assert.equal(line.thread[1].agent.text, SECOND_ANSWER);
  assert.equal(line.thread[1].agent.reason, SECOND_REASON);
});

test("lahe status --json --quiet prints no agent words and keeps the reviewer's notes", async () => {
  const dir = stateWith([aFollowUp()]);
  const text = await statusRun(dir, ["--quiet"]);
  const line = itemLine(text);
  assert.ok(line, "the item is on the drain");
  assert.equal(text.includes("FIRST-ANSWER-WORDS"), false);
  assert.equal(text.includes("SECOND-ANSWER-WORDS"), false);
  assert.equal(text.includes("SECOND-REASON-WORDS"), false);
  assert.equal(line.thread[0].reviewer.note, "FIRST-REVIEWER-NOTE move the table");
  assert.equal(line.thread[1].reviewer.note, "SECOND-REVIEWER-NOTE and the heading");
  assert.equal(line.thread[0].agent.status, "handled");
});

test("lahe status --json without --quiet prints the threads in full", async () => {
  const dir = stateWith([aFollowUp()], { helperUp: true });
  const text = await statusRun(dir, [], helperFor(dir));
  const line = itemLine(text);
  assert.ok(line, "the item is in the catch-up");
  assert.equal(line.thread[0].agent.text, FIRST_ANSWER);
  assert.equal(line.thread[1].agent.text, SECOND_ANSWER);
  assert.equal(line.thread[1].agent.reason, SECOND_REASON);
});

function questionThread(extraRound) {
  const rounds = [
    {
      rev: 1,
      reviewer: { note: "FIRST-REVIEWER-NOTE move the table", change: null, at: "2026-10-14T20:00:00.000Z" },
      agent: { status: "handled", agent: "claude", text: FIRST_ANSWER, reason: null, files: [], at: "2026-10-14T20:01:00.000Z" }
    },
    {
      rev: 2,
      reviewer: { note: "SECOND-REVIEWER-NOTE and the heading", change: null, at: "2026-10-14T20:10:00.000Z" },
      agent: { status: "question", agent: "claude", text: "ASKED-QUESTION-WORDS which heading?", reason: null, files: [], at: "2026-10-14T20:11:00.000Z" }
    }
  ];
  return extraRound ? rounds.concat([extraRound]) : rounds;
}

test("a question the reviewer is now answering keeps its words on the drain", async () => {
  const item = aFollowUp({ note: "THE-ANSWER the second one", thread: questionThread() });
  const text = await statusRun(stateWith([item]), ["--quiet"]);
  const line = itemLine(text);
  assert.equal(line.note, "THE-ANSWER the second one");
  assert.equal(line.thread[1].agent.text, "ASKED-QUESTION-WORDS which heading?", "the question stays");
  assert.equal(text.includes("FIRST-ANSWER-WORDS"), false, "the earlier answer still goes");
});

test("a question that is not the thread's last turn is dropped like any answer", () => {
  const later = {
    rev: 3,
    reviewer: { note: "THIRD-REVIEWER-NOTE the second one", change: null, at: "2026-10-14T20:20:00.000Z" },
    agent: { status: "handled", agent: "claude", text: "LATER-ANSWER-WORDS done", reason: null, files: [], at: "2026-10-14T20:21:00.000Z" }
  };
  const projected = reviewFormat.projectItem(aFollowUp({ rev: 4, thread: questionThread(later) }), null, undefined, {});
  const text = JSON.stringify(status.drainLine({ review: REVIEW }, projected, true));
  assert.equal(text.includes("ASKED-QUESTION-WORDS"), false);
  assert.equal(text.includes("LATER-ANSWER-WORDS"), false);
});

test("after a takeover, a turn written before it keeps its words and a newer turn drops them", async () => {
  const dir = stateWith([aFollowUp()]);
  // The thread's turns are dated 2026-10-14; the takeover happens now.
  agentSessions.createStore({ dir: dir }).takeover(SESSION);
  const newer = {
    rev: 3,
    reviewer: { note: "THIRD-REVIEWER-NOTE", change: null, at: "2999-01-01T00:00:00.000Z" },
    agent: { status: "handled", agent: "claude", text: "NEWER-ANSWER-WORDS", reason: null, files: [], at: "2999-01-01T00:01:00.000Z" }
  };
  const fresh = stateWith([aFollowUp({ rev: 4, thread: aFollowUp().thread.concat([newer]) })]);
  agentSessions.createStore({ dir: fresh }).takeover(SESSION);

  const kept = itemLine(await statusRun(dir, ["--quiet"]));
  assert.equal(kept.thread[0].agent.text, FIRST_ANSWER, "written before the takeover, so the new agent never saw it");
  assert.equal(kept.thread[1].agent.reason, SECOND_REASON);

  const mixed = itemLine(await statusRun(fresh, ["--quiet"]));
  assert.equal(mixed.thread[0].agent.text, FIRST_ANSWER);
  assert.equal(mixed.thread[2].agent.text, undefined, "written after the takeover, so this agent has it");
});

test("drainLine takes the takeover time as its fourth argument", () => {
  const projected = reviewFormat.projectItem(aFollowUp(), null, undefined, {});
  const kept = status.drainLine({ review: REVIEW }, projected, true, "2026-10-14T20:05:00.000Z");
  assert.equal(kept.thread[0].agent.text, FIRST_ANSWER, "turn at 20:01 is before 20:05");
  assert.equal(kept.thread[1].agent.text, undefined, "turn at 20:11 is after 20:05");
  const never = status.drainLine({ review: REVIEW }, projected, true, null);
  assert.equal(never.thread[0].agent.text, undefined, "a session never taken over drops them");
});

test("review.json's projection keeps the agent's words", () => {
  const projected = reviewFormat.projectItem(aFollowUp(), null, undefined, {});
  assert.equal(projected.thread[0].agent.text, FIRST_ANSWER);
  assert.equal(projected.thread[1].agent.reason, SECOND_REASON);
});

// ---------------------------------------------------------------------------
// lahe reply --batch
// ---------------------------------------------------------------------------

function aReviewDir() {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "reviews", REVIEW), { recursive: true });
  return dir;
}

async function runBatch(dir, args, entries, options) {
  const stdout = [];
  const stderr = [];
  const stdin = typeof entries === "string" ? entries : JSON.stringify(entries);
  const code = await reply.run(
    ["--review", REVIEW, "--batch", "--state-dir", dir].concat(args || []),
    Object.assign(
      { stdout: (t) => stdout.push(String(t)), stderr: (t) => stderr.push(String(t)), stdin: stdin, stdinIsTty: false },
      options || {}
    )
  );
  return { code: code, stdout: stdout.join(""), stderr: stderr.join("") };
}

function replyLines(dir, filename) {
  const file = path.join(dir, "reviews", REVIEW, filename);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").split("\n").filter((line) => line !== "");
}

const THREE = [
  { item: "itm_one", rev: 1, status: "handled", text: "Moved the table.\n\nAnd the \"heading\".", files: ["brief.md"] },
  { item: "itm_two", rev: 2, status: "not_handled", reason: "The heading is shared with page two." },
  { item: "itm_three", rev: 1, status: "question", text: "Which table do you mean?", needs_see: true }
];

test("a good batch of three writes three lines and prints three result lines, in order", async () => {
  const dir = aReviewDir();
  const result = await runBatch(dir, ["--agent", "claude"], THREE);
  assert.equal(result.code, protocol.CLI_EXIT.OK, result.stderr);
  assert.equal(
    result.stdout,
    '{"item":"itm_one","status":"handled"}\n{"item":"itm_two","status":"not_handled"}\n{"item":"itm_three","status":"question"}\n'
  );
  const lines = replyLines(dir, "replies-claude.jsonl");
  assert.equal(lines.length, 3, "one physical line each, the raw newlines encoded");
  const parsed = lines.map((line) => protocol.parseReplyLine(line));
  parsed.forEach((p) => assert.ok(p.ok !== false && !p.error, JSON.stringify(p)));
  const first = JSON.parse(lines[0]);
  assert.equal(first.item, "itm_one");
  assert.equal(first.agent, "claude");
  assert.equal(first.text, THREE[0].text);
  assert.deepEqual(first.files, ["brief.md"]);
  assert.equal(JSON.parse(lines[1]).reason, THREE[1].reason);
  assert.equal(JSON.parse(lines[2]).user_needs_to_see_reply, true);
});

test("without --agent the batch goes to replies.jsonl", async () => {
  const dir = aReviewDir();
  const result = await runBatch(dir, [], THREE.slice(0, 1));
  assert.equal(result.code, protocol.CLI_EXIT.OK, result.stderr);
  assert.equal(replyLines(dir, "replies.jsonl").length, 1);
});

test("a batch with one bad entry writes nothing and names the entry by position and item", async () => {
  const dir = aReviewDir();
  const entries = [THREE[0], { item: "itm_two", rev: 2, status: "not_handled" }, THREE[2]];
  const result = await runBatch(dir, ["--agent", "claude"], entries);
  assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.equal(replyLines(dir, "replies-claude.jsonl"), null, "nothing was written");
  assert.equal(result.stdout, "", "no result lines for a refused batch");
  assert.match(result.stderr, /entry 2/);
  assert.match(result.stderr, /itm_two/);
  assert.match(result.stderr, /not_handled needs --reason/);
});

test("the single form's checks all apply per entry", async () => {
  const bad = [
    [{ item: "itm_a", rev: 1, status: "maybe" }, /status/],
    [{ item: "itm_a", rev: "1", status: "handled" }, /rev/],
    [{ item: "itm_a", status: "handled" }, /rev/],
    [{ rev: 1, status: "handled" }, /item/],
    [{ item: "../x", rev: 1, status: "handled" }, /item/],
    [{ item: "itm_a", rev: 1, status: "question" }, /question needs --text/],
    [{ item: "itm_a", rev: 1, status: "handled", needs_see: true }, /needs-see needs/],
    [{ item: "itm_a", rev: 1, status: "handled", text: 5 }, /text/],
    [{ item: "itm_a", rev: 1, status: "handled", files: "a.md" }, /files/],
    [{ item: "itm_a", rev: 1, status: "handled", suggest: [[0, "a", "b"]] }, /proofread/],
    [{ item: "itm_a", rev: 1, status: "handled", mystery: 1 }, /mystery/],
    ["not an object", /object/]
  ];
  for (const [entry, pattern] of bad) {
    const dir = aReviewDir();
    const result = await runBatch(dir, [], [THREE[0], entry]);
    assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE, JSON.stringify(entry));
    assert.match(result.stderr, pattern, JSON.stringify(entry));
    assert.match(result.stderr, /entry 2/, JSON.stringify(entry));
    assert.equal(replyLines(dir, "replies.jsonl"), null, "nothing written for " + JSON.stringify(entry));
  }
});

test("a batch entry can carry proofread suggestions as a list of [block, from, to]", async () => {
  const dir = aReviewDir();
  // The proofread check reads review.json, which this folder does not have.
  const result = await runBatch(dir, [], [
    { item: "itm_a", rev: 1, status: "question", text: "Placed as written.", proofread: true, suggest: [[0, "teh", "the"]] }
  ]);
  assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(result.stderr, /entry 1/);
  assert.match(result.stderr, /review\.json/);
  assert.equal(replyLines(dir, "replies.jsonl"), null);
});

test("bad JSON, a non-array and an empty array are refused and write nothing", async () => {
  for (const [input, pattern] of [
    ["{not json", /JSON/],
    ['{"item":"itm_a"}', /array/],
    ["[]", /empty/],
    ["", /stdin|empty|JSON/]
  ]) {
    const dir = aReviewDir();
    const result = await runBatch(dir, [], input);
    assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE, input);
    assert.match(result.stderr, pattern, input);
    assert.equal(replyLines(dir, "replies.jsonl"), null);
  }
});

test("a raw line break inside a string is refused, never split into two lines", async () => {
  const dir = aReviewDir();
  const raw = '[{"item":"itm_a","rev":1,"status":"handled","text":"line one\nline two"}]';
  const result = await runBatch(dir, [], raw);
  assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(result.stderr, /JSON/);
  assert.equal(replyLines(dir, "replies.jsonl"), null);
});

test("--batch together with a single-form flag is refused", () => {
  for (const flags of [
    ["--item", "itm_a"],
    ["--rev", "1"],
    ["--status", "handled"],
    ["--text", "hi"],
    ["--reason", "no"],
    ["--file", "a.md"],
    ["--needs-see"],
    ["--proofread"]
  ]) {
    const parsed = reply.parseArgs(["--review", REVIEW, "--batch"].concat(flags));
    assert.match(parsed.error || "", /--batch/, flags.join(" "));
  }
  const ok = reply.parseArgs(["--review", REVIEW, "--batch", "--agent", "claude", "--session", "s_one"]);
  assert.equal(ok.error, null);
  assert.equal(ok.batch, true);
});

test("--batch on a terminal says it reads stdin instead of waiting", async () => {
  const dir = aReviewDir();
  const result = await runBatch(dir, [], THREE, { stdinIsTty: true, stdin: undefined });
  assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(result.stderr, /stdin/);
});

test("an unknown review is still refused with its own exit code", async () => {
  const dir = tempDir();
  const result = await runBatch(dir, [], THREE);
  assert.equal(result.code, protocol.CLI_EXIT.UNKNOWN_REVIEW);
});

test("the stale rev warning prints for the entry that is stale, and the batch still writes", async () => {
  const dir = stateWith([aFollowUp()]);
  const item = projectionModule.itemsFrom(logModule.createEventLog({ dir: dir }).read(REVIEW))[0];
  const stderr = [];
  const stdout = [];
  const code = await reply.run(["--review", REVIEW, "--batch", "--state-dir", dir], {
    stdout: (t) => stdout.push(String(t)),
    stderr: (t) => stderr.push(String(t)),
    stdin: JSON.stringify([
      { item: item.id, rev: item.rev, status: "handled", text: "ok" },
      { item: item.id, rev: item.rev - 1, status: "handled", text: "stale" }
    ]),
    stdinIsTty: false
  });
  assert.equal(code, protocol.CLI_EXIT.OK);
  const warnings = stderr.join("").split("\n").filter((l) => l.includes("warning"));
  assert.equal(warnings.length, 1, stderr.join(""));
  assert.match(warnings[0], /entry 2/);
  assert.match(warnings[0], /rev/);
  assert.equal(stdout.join("").split("\n").filter(Boolean).length, 2);
  assert.equal(replyLines(dir, "replies.jsonl").length, 2);
});

test("the usage text names --batch", () => {
  assert.match(reply.USAGE, /--batch/);
});
