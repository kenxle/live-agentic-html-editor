// Measure what the drain prints, and what it repeats.
//
//   node docs/features/20260928.04_trim_the_drain/measure_drain.js [repo-root]
//
// repo-root is the checkout whose `lahe status` is measured, so the same script
// measures the base commit (before) and this branch (after). It defaults to
// this checkout.
//
// The drain is `lahe status --session <id> --json --quiet`, run in-process with
// no helper up, against a fresh temp state directory per state. Each state is
// drained three times in a row with nothing changing between runs, because the
// cost that matters is the one repeated on every wake.
//
// For each drain it splits the bytes into:
//   item_lines       the item lines, all of them
//   per_item         item_lines divided by the number of items
//   per_drain        everything that is not an item line (a pointer line, the
//                    summary line): paid once per drain whatever the item count
//   repeated_rules   bytes of rule text or rule tables the tool itself adds,
//                    per drain: the pointer line with its field-class table, and
//                    any "trust" fence field on an item line, and the lost.hint
//                    sentence on each lost item. Reviewer words and
//                    page text are never counted here.
//   liveness_per_item the liveness block each item line repeats, for reference
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

const bytes = (text) => Buffer.byteLength(text, "utf8");

function freshSession(sessionId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-measure-"));
  agentSessions.createStore({ dir }).create({ id: sessionId });
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  return { dir, log, reviews };
}

// A typical comment: the reviewer's note plus the quoted passage and context the
// layer records, so the item line is the size real ones are.
function addItem(world, reviewId, n, state, lost) {
  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "tighten this sentence, number " + n,
    page_origin: "http://127.0.0.1:8000",
    page_path: "/report.html",
    page_seq: n,
    context: {
      quote: "The quarterly numbers show steady growth across all regions.",
      prefix: "Summary. ",
      suffix: " Next, the outlook.",
      heading: "Summary",
      element: "p"
    },
    region: lost ? { ref: { id: "ref_" + n }, label: "Summary, p 1", lost: { code: "ANCHOR_NO_TEXT_MATCH", reason: null, at: null } } : undefined
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

async function drain(dir, sessionId) {
  const out = [];
  const code = await status.run(["--session", sessionId, "--json", "--quiet"], {
    stateDir: dir,
    stdout: (text) => out.push(String(text)),
    stderr: () => {}
  });
  if (code !== 0) throw new Error("drain exited " + code);
  const text = out.join("");
  const split = { total: bytes(text), items: 0, item_lines: 0, per_drain: 0, repeated_rules: 0, liveness: 0 };
  text.split("\n").filter(Boolean).forEach((raw) => {
    const line = JSON.parse(raw);
    const size = bytes(raw) + 1;
    if (typeof line.id === "string") {
      split.items += 1;
      split.item_lines += size;
      if (typeof line.trust === "string") split.repeated_rules += bytes(JSON.stringify({ trust: line.trust })) - 1;
      if (line.lost && typeof line.lost.hint === "string") split.repeated_rules += bytes(JSON.stringify({ hint: line.lost.hint })) - 1;
      if (line.liveness) split.liveness += bytes(JSON.stringify({ liveness: line.liveness })) - 1;
    } else {
      split.per_drain += size;
      if (line.field_classes || line.contract_in) split.repeated_rules += size;
    }
  });
  return split;
}

async function measure(name, build) {
  const sessionId = "s_measure";
  const world = freshSession(sessionId);
  build(world, sessionId);
  const runs = [];
  for (let i = 0; i < 3; i += 1) runs.push(await drain(world.dir, sessionId));
  const first = runs[0];
  return {
    state: name,
    total_per_run: runs.map((run) => run.total),
    items: first.items,
    per_item: first.items ? Math.round(first.item_lines / first.items) : 0,
    per_drain: first.per_drain,
    repeated_rules: first.repeated_rules,
    liveness_per_item: first.items ? Math.round(first.liveness / first.items) : 0
  };
}

function waiting(count, lost) {
  return (world, sessionId) => {
    world.reviews.create({ id: "r_items", agent_session_id: sessionId });
    for (let n = 1; n <= count; n += 1) addItem(world, "r_items", n, "ready", lost);
  };
}

(async () => {
  const results = [];
  results.push(await measure("nothing waiting", (world, sessionId) => {
    world.reviews.create({ id: "r_quiet", agent_session_id: sessionId });
    addItem(world, "r_quiet", 1, "handled");
  }));
  results.push(await measure("1 item waiting", waiting(1)));
  results.push(await measure("10 items waiting", waiting(10)));
  results.push(await measure("100 items waiting", waiting(100)));
  results.push(await measure("1000 items waiting", waiting(1000)));
  results.push(await measure("100 lost items waiting (a page restructure)", waiting(100, true)));
  results.push(await measure("7 ended reviews, nothing waiting", (world, sessionId) => {
    for (let i = 1; i <= 7; i += 1) {
      const id = "r_ended_" + i;
      world.reviews.create({ id: id, agent_session_id: sessionId });
      addItem(world, id, 1, "handled");
      endReview(world, id);
    }
  }));

  console.log("measured: " + root);
  results.forEach((row) => console.log(JSON.stringify(row)));
  console.log("");
  console.log("| state | bytes, runs 1 / 2 / 3 | per item | per drain | repeated rule bytes per drain | liveness per item |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  results.forEach((row) => console.log(
    "| " + row.state + " | " + row.total_per_run.join(" / ") + " | " + row.per_item + " | " + row.per_drain +
      " | " + row.repeated_rules + " | " + row.liveness_per_item + " |"
  ));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
