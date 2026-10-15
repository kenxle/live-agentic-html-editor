#!/usr/bin/env node
// What a follow-up item costs the agent on the drain, before and after the drain
// stops echoing the agent's own earlier answers (requirement 1 of the spec).
//
// Builds a throwaway state folder holding one review and one item shaped like
// the real follow-up in ~/Documents/token-audit: the reviewer's second comment
// on a card, with the agent's first answer in the item's thread. Then it prints
// that item's drain line twice:
//
//   before  the thread as the drain used to print it (what the catch-up still prints)
//   after   what `lahe status --session <id> --json --quiet` prints now
//
// "After" is the real drain command run in process. "Before" is the same line
// built with the drop switched off. Tokens are estimated as characters divided
// by 4; no tokenizer is installed. Nothing listens and no process is started.
//
// Usage: node docs/features/20261015.01_batch_reply_own_answers/measure_follow_up.js [--show]

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
const status = require(path.join(root, "src/cli/commands/status.js"));

const SESSION = "s_45fc5db4f9dcd41c";
const REVIEW = "rc4e1cfd1c0d9";
const ORIGIN = "http://documents.token-audit.lahe.localhost";
const FIRST_NOTE =
  "splitting the skill reduces instruction following accuracy, so we would need to be very specific in how we do this. the skill is read once and then cached, i'm more concerned with what we're adding every turn";
const FIRST_ANSWER =
  "Reran it on document editing only, in a new section \"Document editing only\". That is 10 sessions out of 136, chosen by: replied on cards, ran no test, build or commit, edited only document files. Chat is still small (1.8%). LAHE's own share (skill, command output, replies) is about a quarter of what gets re-read, and the skill alone was a median of 32% in sessions that loaded it. The table you commented on moved to a comparison line at the end of that section.";
const SECOND_NOTE = "ok, and what does the skill cost on the first turn alone?";

function buildState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-measure-"));
  agentSessions.createStore({ dir: dir }).create({ id: SESSION });
  const log = logModule.createEventLog({ dir: dir });
  reviewsModule.createReviews({ dir: dir, log: log }).create({ id: REVIEW, agent_session_id: SESSION });
  const item = record.newItem({
    id: "itm_88d7407d1b5da1645f7c9618",
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    rev: 2,
    note: SECOND_NOTE,
    page_origin: ORIGIN,
    page_path: "/lahe_token_audit.md",
    page_title: "Where LAHE tokens go, and whether caveman helps",
    page_seq: 1,
    created_at: "2026-10-14T20:47:58.025Z",
    updated_at: "2026-10-14T21:10:39.468Z",
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
    },
    thread: [
      {
        rev: 1,
        reviewer: { note: FIRST_NOTE, change: null, at: "2026-10-14T20:48:39.468Z" },
        agent: {
          status: "handled",
          agent: "claude",
          text: FIRST_ANSWER,
          reason: null,
          files: ["/Users/kennethstclair/Documents/token-audit/lahe_token_audit.md"],
          at: "2026-10-14T20:52:10.000Z"
        }
      }
    ]
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
  fs.writeFileSync(
    stateDirModule.readyPath(dir),
    JSON.stringify({ port: 7999, reviews: { [REVIEW]: { token: "t".repeat(16), origins: [ORIGIN] } } })
  );
  return dir;
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
  const dir = buildState();
  const fetchImpl = fakeHelper(dir);

  // After: the real drain.
  const drained = [];
  await status.run(["--session", SESSION, "--json", "--quiet", "--state-dir", dir], {
    stdout: (text) => drained.push(String(text)),
    stderr: (text) => drained.push(String(text)),
    fetch: fetchImpl
  });
  const after = drained.join("");

  // Before: the same item line with the drop switched off.
  const projection = projectionModule.project(REVIEW, logModule.createEventLog({ dir: dir }).read(REVIEW));
  const projected = projection.pages.reduce((all, page) => all.concat(page.items || []), [])[0];
  const before = JSON.stringify(status.drainLine({ review: REVIEW }, projected, false)) + "\n";

  const rows = [["before", before], ["after", after]];
  rows.forEach(function (row) {
    console.log(row[0] + ": " + row[1].length + " chars, " + Math.round(row[1].length / 4) + " tokens");
    if (show) console.log(row[1]);
  });
  const saved = before.length - after.length;
  console.log("saved: " + saved + " chars, " + Math.round(saved / 4) + " tokens");
  console.log("drain keeps the reviewer's first note: " + (after.indexOf("splitting the skill reduces") !== -1));
  console.log("drain repeats the agent's first answer: " + (after.indexOf("Reran it on document editing only") !== -1));
  // The script removes the folder it made.
  fs.rmSync(dir, { recursive: true, force: true });
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
