// Lean agent output (docs/features/20261014.02_lean_agent_output).
//
// One plain comment used to put about 1,320 tokens into the agent's context:
// the monitor printed the item, the drain printed it again, the banner went out
// twice, each item carried two dozen empty fields, the summary line rode along
// on every drain, a NEXT footer repeated the commands, and lahe reply echoed the
// whole reply back. These tests pin the leaner output, one behavior each.
//
// Node-only. No process is started: every command runs in this process, and
// the helper is faked where a test needs it to look up.

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
const monitor = require("../../src/cli/commands/monitor.js");
const status = require("../../src/cli/commands/status.js");
const reply = require("../../src/cli/commands/reply.js");

const SESSION = "s_lean";
const REVIEW = "r_lean";
const ORIGIN = "http://docs.lean.lahe.localhost";

const tempDirs = [];
test.after(() => {
  // The test removes the folders it made.
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-lean-"));
  tempDirs.push(dir);
  return dir;
}

function aComment(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "say this more plainly",
        page_origin: ORIGIN,
        page_path: "/brief.md",
        page_title: "The brief",
        page_seq: 1,
        created_at: "2026-10-14T20:47:58.025Z",
        updated_at: "2026-10-14T20:48:39.468Z",
        context: {
          quote: "starting with splitting the skill. Then trim the chat.",
          prefix: "We could save tokens by",
          suffix: "Then trim the chat.",
          heading: "Needs your call",
          element: null,
          subject: null
        },
        region: {
          ref: { id: "ref_1", stamp: "e8m86g2km", where: "main > ol > li", ordinal: { index: 1, of: 1 } },
          label: "li 1",
          lost: null
        }
      },
      overrides || {}
    )
  );
}

/** A state folder with one session, one review, and the given items. */
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
        event_id: "ev_lean_" + index,
        review: REVIEW,
        item: item[record.FIELD.ID],
        rev: item[record.FIELD.REV],
        page_path: item[record.FIELD.PAGE_PATH],
        page_seq: item[record.FIELD.PAGE_SEQ],
        payload: { draft: false, record: item }
      })
    ]);
  });
  if (opts.ended) {
    log.append(REVIEW, [
      protocol.newEvent({ event: protocol.EVENT.REVIEW_ARCHIVED, event_id: "ev_lean_end", review: REVIEW })
    ]);
  }
  if (opts.helperUp) {
    fs.writeFileSync(
      stateDirModule.readyPath(dir),
      JSON.stringify({ port: 7999, reviews: { [REVIEW]: { token: "t".repeat(16), origins: [ORIGIN] } } })
    );
  }
  return dir;
}

/** A helper that answers review.read with the projection, the page seen just now. */
function helperFor(dir) {
  return async function () {
    const projection = projectionModule.project(REVIEW, logModule.createEventLog({ dir: dir }).read(REVIEW));
    projection.page_last_seen_at = new Date().toISOString();
    return { ok: true, status: 200, json: async () => projection };
  };
}

async function drain(dir, extra, fetchImpl) {
  const out = [];
  const err = [];
  const code = await status.run(["--session", SESSION, "--json", "--state-dir", dir].concat(extra || ["--quiet"]), {
    stdout: (text) => out.push(String(text)),
    stderr: (text) => err.push(String(text)),
    fetch: fetchImpl
  });
  assert.equal(code, protocol.CLI_EXIT.OK, err.join(""));
  return out.join("");
}

function linesOf(text) {
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// ---------------------------------------------------------------------------
// The monitor prints one line
// ---------------------------------------------------------------------------

async function runMonitor(printed, options) {
  const stdout = [];
  const stderr = [];
  const opts = options || {};
  const code = await monitor.run(["--session", "s_owner"].concat(opts.extraArgs || []), {
    stdout: (text) => stdout.push(String(text)),
    stderr: (text) => stderr.push(String(text)),
    readSession: (id) => ({ id: id, handoff_rev: 0, closed_at: null }),
    statusRun: async (args, io) => {
      const text = typeof printed === "function" ? printed(args) : printed;
      if (text) io.stdout(text);
      if (opts.error) io.stderr(opts.error);
      return opts.code === undefined ? protocol.CLI_EXIT.OK : opts.code;
    },
    wait: async () => {}
  });
  return { code: code, stdout: stdout.join(""), stderr: stderr.join("") };
}

test("the monitor prints one line naming the work, the drain and the relaunch, and none of the item", async () => {
  const result = await runMonitor('{"review":"r_one","id":"c_one","rev":1,"note":"fix the footer"}\n');
  assert.equal(result.code, protocol.CLI_EXIT.OK);
  const lines = result.stdout.split("\n").filter((line) => line);
  assert.equal(lines.length, 1, "one line: " + result.stdout);
  assert.ok(lines[0].startsWith(monitor.ACTION_REQUIRED), "the banner leads it");
  assert.match(lines[0], /\b1 item waiting\b/);
  assert.ok(lines[0].includes("lahe status --session s_owner --json --quiet"), "names the drain");
  assert.ok(lines[0].includes("lahe monitor --session s_owner"), "names the relaunch");
  assert.equal(result.stdout.includes("fix the footer"), false, "the item is the drain's to print");
  assert.equal(result.stdout.includes("NEXT:"), false, "no NEXT footer");
  assert.equal(result.stdout.includes("{"), false, "no JSON at all");
});

test("the wake prints once on stdout even when the host captures streams separately", async () => {
  const item = '{"review":"r_one","id":"c_one","rev":1}\n';
  const split = await runMonitor(item);
  assert.equal((split.stdout.match(/LAHE ACTION REQUIRED/g) || []).length, 1);
  assert.equal(split.stderr, "", "a successful wake is not an error");
});

test("a drain failure still prints its diagnostic on stderr alongside a wake", async () => {
  const result = await runMonitor('{"review":"r_one","id":"c_one","rev":1}\n', {
    error: "cannot read another review\n",
    code: protocol.CLI_EXIT.BAD_USAGE
  });
  assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(result.stdout, /^LAHE ACTION REQUIRED:/);
  assert.equal(result.stderr, "cannot read another review\n");
});

test("the line counts items, ended reviews and Library requests", async () => {
  const printed =
    '{"review":"r_one","id":"c_one","rev":1}\n' +
    '{"review":"r_one","id":"c_two","rev":3}\n' +
    '{"reviews":1,"ended_reviews":[{"review":"r_one"}],"catalog_requests":[{"request":"cq_1"}]}\n';
  const result = await runMonitor(printed);
  assert.match(result.stdout, /2 items, 1 ended review, 1 Library request waiting/);
});

test("a drain line the monitor cannot read still wakes, as work waiting", async () => {
  const result = await runMonitor("something new\n");
  assert.equal(result.code, protocol.CLI_EXIT.OK);
  assert.match(result.stdout, /LAHE ACTION REQUIRED: work waiting\./);
});

test("with two sessions, the line names a drain for each session with work and one relaunch for all", async () => {
  const result = await runMonitor(
    (args) => (args[1] === "s_other" ? '{"review":"r_two","id":"c_two","rev":1}\n' : '{"review":"r_one","id":"c_one","rev":1}\n'),
    { extraArgs: ["--session", "s_other"] }
  );
  const lines = result.stdout.split("\n").filter((line) => line);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /2 items waiting/);
  assert.ok(lines[0].includes("lahe status --session s_owner --json --quiet"));
  assert.ok(lines[0].includes("lahe status --session s_other --json --quiet"));
  assert.ok(lines[0].includes("lahe monitor --session s_owner --session s_other"));
});

// ---------------------------------------------------------------------------
// Empty fields are left out
// ---------------------------------------------------------------------------

test("leanValue leaves out null, [], {}, false and empty strings at every depth, and keeps array entries", () => {
  const lean = status.leanValue({
    a: null,
    b: [],
    c: {},
    d: false,
    e: "",
    zero: 0,
    yes: true,
    nested: { deeper: { flag: false, gone: null } },
    kept: { flag: true, off: false },
    blocks: [{ html: "<p>x</p>", from_anchor: false }, { html: "", text: null }]
  });
  assert.deepEqual(lean, {
    zero: 0,
    yes: true,
    kept: { flag: true },
    blocks: [{ html: "<p>x</p>" }, {}]
  });
});

test("a drain line carries no empty field, keeps a true one, and drops a nested false", async () => {
  const dir = stateWith([aComment()]);
  const lines = linesOf(await drain(dir));
  const item = lines.find((line) => line.id);
  assert.ok(item, "the item is on the drain");
  const text = JSON.stringify(item);
  assert.equal(/:null\b/.test(text), false, "no null: " + text);
  assert.equal(/:false\b/.test(text), false, "no false: " + text);
  assert.equal(text.includes(":[]"), false, "no empty list");
  assert.equal(text.includes(":{}"), false, "no empty object");
  assert.equal(text.includes(':""'), false, "no empty string");
  assert.equal(has(item.page.region, "stamp_carriable"), false, "a nested false is left out");
  assert.equal(item.page.region.text_unique, true, "a true is kept");
  assert.equal(item.page.region.stamp, "e8m86g2km");
  assert.deepEqual(item.page.region.ordinal, { index: 1, of: 1 }, "numbers are kept");
  assert.equal(has(item, "proofread"), false);
  assert.equal(has(item, "change"), false);
  assert.equal(item.note, "say this more plainly");
});

test("context the quote already holds is left out, and a partial overlap is kept whole", async () => {
  const dir = stateWith([
    aComment({
      context: {
        quote: "starting with splitting the skill. Then trim the chat.",
        // Only partly inside the quote: kept.
        prefix: "We could save tokens by starting with",
        // Fully inside the quote once whitespace is normalized: dropped.
        suffix: "  Then   trim the\nchat. ",
        heading: "Needs your call",
        element: null,
        subject: null
      }
    })
  ]);
  const item = linesOf(await drain(dir)).find((line) => line.id);
  assert.equal(has(item.page.context, "suffix"), false, "the suffix repeats the quote");
  assert.equal(item.page.context.prefix, "We could save tokens by starting with");
  assert.equal(item.page.context.heading, "Needs your call");
});

test("the drain line drops the session id, the page address and title, the region label and the card's birthday", async () => {
  const dir = stateWith([aComment()]);
  const item = linesOf(await drain(dir)).find((line) => line.id);
  assert.equal(has(item, "agent_session_id"), false);
  assert.equal(has(item.page, "origin"), false);
  assert.equal(has(item.page, "title"), false);
  assert.equal(has(item.page, "region_label"), false);
  assert.equal(has(item, "card_first_created_at"), false);
  // Kept: the page path, the ids to reply with, and when the reviewer last
  // changed these words (docs/features/20260923.02_no_stale_excuse, R1).
  assert.equal(item.page.path, "/brief.md");
  assert.equal(item.review, REVIEW);
  assert.equal(item.rev, 1);
  assert.equal(item.reviewer_last_changed_at, "2026-10-14T20:48:39.468Z");
});

test("review.json is untouched: the projection keeps every field", () => {
  const item = aComment();
  const projected = projectionModule.project(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_lean_projection",
      review: REVIEW,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    })
  ]).pages[0].items[0];
  assert.equal(projected.proofread, false);
  assert.equal(projected.lost, null);
  assert.equal(projected.region_label, "li 1");
  assert.equal(projected.card_first_created_at, "2026-10-14T20:47:58.025Z");
});

// ---------------------------------------------------------------------------
// The summary line only when it carries something
// ---------------------------------------------------------------------------

test("a healthy drain prints its items and no summary line", async () => {
  const dir = stateWith([aComment()], { helperUp: true });
  const lines = linesOf(await drain(dir, ["--quiet"], helperFor(dir)));
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.ok(lines[0].id);
});

test("the summary line prints when the helper is down", async () => {
  const dir = stateWith([aComment()]);
  const lines = linesOf(await drain(dir));
  const summary = lines.find((line) => has(line, "reviews"));
  assert.ok(summary, "the agent is told the page is not connected");
  assert.equal(summary.liveness[REVIEW].helper_up, false);
});

test("the summary line prints when a review ended, even with the helper up", async () => {
  const dir = stateWith([aComment()], { helperUp: true, ended: true });
  const lines = linesOf(await drain(dir, ["--quiet"], helperFor(dir)));
  const summary = lines.find((line) => has(line, "reviews"));
  assert.ok(summary);
  assert.equal(summary.ended_reviews[0].review, REVIEW);
});

test("summaryNeeded keys on ended reviews, Library requests and an unconnected page", () => {
  const healthy = { [REVIEW]: { helper_up: true, page_last_seen_at: "2026-10-14T20:48:39.468Z" } };
  assert.equal(status.summaryNeeded({ ended_reviews: [], catalog_requests: [], liveness: healthy }), false);
  assert.equal(status.summaryNeeded({ ended_reviews: [{ review: REVIEW }], catalog_requests: [], liveness: healthy }), true);
  assert.equal(status.summaryNeeded({ ended_reviews: [], catalog_requests: [{ request: "cq_1" }], liveness: healthy }), true);
  assert.equal(
    status.summaryNeeded({ ended_reviews: [], catalog_requests: [], liveness: { [REVIEW]: { helper_up: true, page_last_seen_at: null } } }),
    true
  );
  assert.equal(
    status.summaryNeeded({ ended_reviews: [], catalog_requests: [], liveness: { [REVIEW]: { helper_up: false, page_last_seen_at: null } } }),
    true
  );
});

test("an audit read still prints the summary line", async () => {
  const dir = stateWith([aComment()], { helperUp: true });
  const lines = linesOf(await drain(dir, [], helperFor(dir)));
  assert.ok(lines.find((line) => has(line, "reviews")), "--json without --quiet is a look, and keeps the whole picture");
});

test("a drain with nothing waiting prints nothing", async () => {
  const dir = stateWith([]);
  assert.equal(await drain(dir), "");
  const healthy = stateWith([], { helperUp: true });
  assert.equal(await drain(healthy, ["--quiet"], helperFor(healthy)), "");
});

// ---------------------------------------------------------------------------
// lahe reply prints the item and the status
// ---------------------------------------------------------------------------

test("lahe reply prints only the item id and the status", async () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "reviews", REVIEW), { recursive: true });
  const out = [];
  const code = await reply.run(
    [
      "--review", REVIEW, "--item", "itm_one", "--rev", "2", "--status", "handled",
      "--agent", "claude", "--text", "You left off the period and I added it.", "--file", "brief.md",
      "--state-dir", dir
    ],
    { stdout: (text) => out.push(String(text)), stderr: () => {}, stdinIsTty: true }
  );
  assert.equal(code, protocol.CLI_EXIT.OK);
  assert.equal(out.join(""), '{"item":"itm_one","status":"handled"}\n');
  // The file still gets the whole line.
  const written = fs.readFileSync(path.join(dir, "reviews", REVIEW, "replies-claude.jsonl"), "utf8");
  assert.match(written, /You left off the period/);
  assert.match(written, /"files":\["brief.md"\]/);
});
