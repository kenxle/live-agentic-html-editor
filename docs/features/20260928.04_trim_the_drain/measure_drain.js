// Measure how many bytes the drain prints, in three states.
//
//   node docs/features/20260928.04_trim_the_drain/measure_drain.js [repo-root]
//
// repo-root is the checkout whose `lahe status` is measured, so the same script
// measures main (before) and this branch (after). It defaults to this checkout.
//
// The drain is `lahe status --session <id> --json --quiet`, run in-process with
// no helper up, against a fresh temp state directory per state. Each state is
// drained three times in a row, with nothing changing between runs, because the
// cost that matters is the one repeated on every wake.
//
// Prints one JSON line per state, then a table.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", ".."));
const req = (rel) => require(path.join(root, rel));
const protocol = req("src/shared/protocol.js");
const record = req("src/shared/record.js");
const logModule = req("src/service/log.js");
const reviewsModule = req("src/service/reviews.js");
const agentSessions = req("src/service/agent_sessions.js");
const status = req("src/cli/commands/status.js");

function freshSession(sessionId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-measure-"));
  agentSessions.createStore({ dir }).create({ id: sessionId });
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  return { dir, log, reviews };
}

function addItem(world, reviewId, note, state) {
  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: note,
    page_origin: "http://127.0.0.1:8000",
    page_path: "/report.html",
    page_seq: 1
  });
  world.log.append(reviewId, [protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: "ev_ready_" + item.id,
    review: reviewId,
    item: item.id,
    rev: item.rev,
    page_path: item.page_path,
    page_seq: item.page_seq,
    payload: { draft: false, record: item }
  })]);
  if (state === "handled") {
    world.log.append(reviewId, [protocol.newEvent({
      event: protocol.EVENT.REPLY_FOLDED,
      event_id: "ev_folded_" + item.id,
      review: reviewId,
      item: item.id,
      rev: item.rev,
      payload: {
        accepted: true,
        state: record.STATE.HANDLED,
        reply: { status: "handled", agent: "measure", reason: null, text: null, files: [] }
      }
    })]);
  }
}

function endReview(world, reviewId) {
  world.log.append(reviewId, [protocol.newEvent({
    event: protocol.EVENT.REVIEW_ARCHIVED,
    event_id: "ev_ended_" + reviewId,
    review: reviewId
  })]);
}

async function drainBytes(dir, sessionId) {
  const out = [];
  const code = await status.run(["--session", sessionId, "--json", "--quiet"], {
    stateDir: dir,
    stdout: (text) => out.push(String(text)),
    stderr: () => {}
  });
  if (code !== 0) throw new Error("drain exited " + code);
  return Buffer.byteLength(out.join(""), "utf8");
}

async function measure(name, build) {
  const sessionId = "s_measure";
  const world = freshSession(sessionId);
  build(world, sessionId);
  const runs = [];
  for (let i = 0; i < 3; i += 1) runs.push(await drainBytes(world.dir, sessionId));
  return { state: name, bytes_per_run: runs };
}

(async () => {
  const results = [];
  results.push(await measure("nothing waiting", (world, sessionId) => {
    world.reviews.create({ id: "r_quiet", agent_session_id: sessionId });
    addItem(world, "r_quiet", "already answered", "handled");
  }));
  results.push(await measure("one item waiting", (world, sessionId) => {
    world.reviews.create({ id: "r_one", agent_session_id: sessionId });
    addItem(world, "r_one", "tighten this headline", "ready");
  }));
  results.push(await measure("seven ended reviews, nothing waiting", (world, sessionId) => {
    for (let i = 1; i <= 7; i += 1) {
      const id = "r_ended_" + i;
      world.reviews.create({ id: id, agent_session_id: sessionId });
      addItem(world, id, "already answered", "handled");
      endReview(world, id);
    }
  }));

  console.log("measured: " + root);
  results.forEach((row) => console.log(JSON.stringify(row)));
  console.log("");
  console.log("| state | run 1 | run 2 | run 3 |");
  console.log("| --- | --- | --- | --- |");
  results.forEach((row) => console.log("| " + row.state + " | " + row.bytes_per_run.join(" | ") + " |"));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
