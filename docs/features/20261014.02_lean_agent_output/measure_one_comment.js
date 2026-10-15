#!/usr/bin/env node
// What one plain comment costs the agent, in characters and estimated tokens.
//
// Builds a throwaway state folder holding one session, one review and one
// comment shaped like the one in ~/Documents/token-audit (a comment on a list
// item in a Markdown page). Then it runs, in process, the three commands an
// agent runs for that comment, exactly as a host would see them:
//
//   1. lahe monitor --session <id>   (both streams, as a host that merges them)
//   2. lahe status --session <id> --json --quiet   (the drain)
//   3. lahe reply ... --status handled --text "..."
//
// The helper is faked as up, with the page seen a moment ago, so the drain sees
// what it sees in real use. No process is started, and nothing listens.
// Tokens are estimated as characters divided by 4; no tokenizer is installed.
//
// Usage: node docs/features/20261014.02_lean_agent_output/measure_one_comment.js [--show]

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..", "..", "..");
const protocol = require(path.join(root, "src/shared/protocol.js"));
const record = require(path.join(root, "src/shared/record.js"));
const logModule = require(path.join(root, "src/service/log.js"));
const reviewsModule = require(path.join(root, "src/service/reviews.js"));
const agentSessions = require(path.join(root, "src/service/agent_sessions.js"));
const projectionModule = require(path.join(root, "src/service/projection.js"));
const stateDirModule = require(path.join(root, "src/service/state_dir.js"));
const monitor = require(path.join(root, "src/cli/commands/monitor.js"));
const status = require(path.join(root, "src/cli/commands/status.js"));
const reply = require(path.join(root, "src/cli/commands/reply.js"));

const SESSION = "s_45fc5db4f9dcd41c";
const REVIEW = "rc4e1cfd1c0d9";
const NOTE =
  "splitting the skill reduces instruction following accuracy, so we would need to be very specific in how we do this. the skill is read once and then cached, i'm more concerned with what we're adding every turn";
const REPLY_TEXT =
  "Reran it on document editing only, in a new section \"Document editing only\". That is 10 sessions out of 136, chosen by: replied on cards, ran no test, build or commit, edited only document files. Chat is still small (1.8%). LAHE's own share (skill, command output, replies) is about a quarter of what gets re-read, and the skill alone was a median of 32% in sessions that loaded it. The table you commented on moved to a comparison line at the end of that section.";

function buildState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-measure-"));
  agentSessions.createStore({ dir: dir }).create({ id: SESSION });
  const log = logModule.createEventLog({ dir: dir });
  reviewsModule.createReviews({ dir: dir, log: log }).create({ id: REVIEW, agent_session_id: SESSION });
  const item = record.newItem({
    id: "itm_88d7407d1b5da1645f7c9618",
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: NOTE,
    page_origin: "http://documents.token-audit.lahe.localhost",
    page_path: "/lahe_token_audit.md",
    page_title: "Where LAHE tokens go, and whether caveman helps",
    page_seq: 1,
    created_at: "2026-10-14T20:47:58.025Z",
    updated_at: "2026-10-14T20:48:39.468Z",
    context: {
      quote: "starting with splitting the skill.",
      prefix: "",
      suffix:
        "Trim the chat after LAHE replies? Recommended: yes, one line per batch. It saves almost no tokens, but it saves you reading. It could ride along with the build in decision 1.",
      heading: "Needs your call",
      element: null,
      subject: null
    },
    region: {
      ref: { id: "ref_1", stamp: "e8m86g2km", where: "main > section.sheet > ol > li", ordinal: { index: 1, of: 1 } },
      label: "li 1",
      lost: null
    }
  });
  log.append(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_measure_item",
      review: REVIEW,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    })
  ]);
  // The helper, as status finds it: a ready file naming a port and the review.
  fs.writeFileSync(
    stateDirModule.readyPath(dir),
    JSON.stringify({ port: 7999, reviews: { [REVIEW]: { token: "t".repeat(16), origins: ["http://documents.token-audit.lahe.localhost"] } } })
  );
  return { dir: dir, item: item };
}

function fakeHelper(dir) {
  return async function () {
    const events = logModule.createEventLog({ dir: dir }).read(REVIEW);
    const projection = projectionModule.project(REVIEW, events);
    projection.page_last_seen_at = new Date(Date.now() - 5000).toISOString();
    return { ok: true, status: 200, json: async () => projection };
  };
}

async function main() {
  const show = process.argv.indexOf("--show") !== -1;
  const state = buildState();
  const fetchImpl = fakeHelper(state.dir);

  // 1. The monitor. A host that merges the two streams into one output is the
  // Claude Code case the audit measured, so both are counted, in one buffer.
  const wake = [];
  const monitorCode = await monitor.run(["--session", SESSION, "--state-dir", state.dir], {
    stdout: (text) => wake.push(String(text)),
    stderr: (text) => wake.push(String(text)),
    sameStream: true,
    wait: async () => {},
    statusRun: (args, io) => status.run(args, Object.assign({}, io, { fetch: fetchImpl }))
  });

  // 2. The drain the agent runs next.
  const drain = [];
  await status.run(["--session", SESSION, "--json", "--quiet", "--state-dir", state.dir], {
    stdout: (text) => drain.push(String(text)),
    stderr: (text) => drain.push(String(text)),
    fetch: fetchImpl
  });

  // 3. The reply.
  const answer = [];
  await reply.run(
    [
      "--review", REVIEW, "--item", state.item[record.FIELD.ID], "--rev", "1", "--status", "handled",
      "--agent", "claude", "--text", REPLY_TEXT,
      "--file", "/Users/kennethstclair/Documents/token-audit/lahe_token_audit.md",
      "--state-dir", state.dir
    ],
    { stdout: (text) => answer.push(String(text)), stderr: (text) => answer.push(String(text)), stdinIsTty: true }
  );

  const parts = [
    ["monitor (wake)", wake.join("")],
    ["drain", drain.join("")],
    ["reply", answer.join("")]
  ];
  let total = 0;
  parts.forEach(function (part) {
    const chars = part[1].length;
    total += chars;
    console.log(part[0] + ": " + chars + " chars, " + Math.round(chars / 4) + " tokens");
    if (show) console.log(part[1]);
  });
  console.log("total: " + total + " chars, " + Math.round(total / 4) + " tokens (monitor exit " + monitorCode + ")");
  // The script removes the folder it made.
  fs.rmSync(state.dir, { recursive: true, force: true });
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
