// A LAHE agent session can carry the human's name for it.
//
// Ken runs many agents at once, and "s_9a3835ce54bc9e66" does not say which
// window to go check. Claude Code tells the agent the name after /rename, so the
// agent passes it on: `lahe review ... --name`, `lahe session takeover <id>
// --name`, and `lahe session name <id> "<name>"` when it changes. The rail's
// banner then says which agent to check.
//
// Spec: docs/features/20260916.04_unanswered_prominence/01_spec_unanswered_prominence.md,
// "Session names".

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const projectionModule = require("../../src/service/projection.js");
const routes = require("../../src/service/routes.js");
const watchersModule = require("../../src/service/watchers.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const reviewCommand = require("../../src/cli/commands/review.js");

const FIELD = protocol.AGENT_LIVENESS.FIELD;

function tempState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-session-names-"));
}

function quietWatchers() {
  return watchersModule.createWatchers({ probe: () => Promise.resolve({ listening: false, supported: true }) });
}

async function runSession(args) {
  const out = [];
  const err = [];
  const code = await sessionCommand.run(args, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text)
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

// ---------------------------------------------------------------------------
// What counts as a name
// ---------------------------------------------------------------------------

test("a name is plain text: trimmed, control characters stripped, capped at 80 characters", () => {
  assert.equal(agentSessions.cleanName("  lahe updates 9/16  "), "lahe updates 9/16");
  assert.equal(agentSessions.cleanName("two\nlines\tandbell"), "twolinesandbell");
  assert.equal(agentSessions.cleanName("x".repeat(200)).length, agentSessions.NAME_MAX);
  assert.equal(agentSessions.NAME_MAX, 80);
  // Capped by character, not by UTF-16 unit, so an emoji is never cut in half.
  const emoji = "\u{1F600}".repeat(100);
  assert.equal(Array.from(agentSessions.cleanName(emoji)).length, 80);
  // Markup is not stripped: it is display text, and the rail draws it as text.
  assert.equal(agentSessions.cleanName("<b>bold</b>"), "<b>bold</b>");
});

test("an empty, blank or missing name is no name", () => {
  assert.equal(agentSessions.cleanName(""), null);
  assert.equal(agentSessions.cleanName("   \n "), null);
  assert.equal(agentSessions.cleanName(null), null);
  assert.equal(agentSessions.cleanName(undefined), null);
  assert.equal(agentSessions.cleanName(42), null);
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test("a session is created with a name, renamed, and cleared", () => {
  const dir = tempState();
  const store = agentSessions.createStore({ dir });
  const made = store.create({ id: "s_named", name: "  lahe updates 9/16 " });
  assert.equal(made.name, "lahe updates 9/16");
  assert.equal(store.read("s_named").name, "lahe updates 9/16");

  store.setName("s_named", "amber banner");
  assert.equal(store.read("s_named").name, "amber banner");

  store.setName("s_named", "");
  assert.equal(Object.prototype.hasOwnProperty.call(store.read("s_named"), "name"), false, "unset means no field");

  const plain = store.create({ id: "s_plain" });
  assert.equal(Object.prototype.hasOwnProperty.call(plain, "name"), false, "no name, nothing else changes");
  assert.throws(() => store.setName("s_missing", "x"), /unknown agent session/);
});

test("a takeover can carry the new agent's name", () => {
  const dir = tempState();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_handed", name: "old window" });
  const taken = store.takeover("s_handed", { name: "new window" });
  assert.equal(taken.name, "new window");
  assert.equal(taken.handoff_rev, 1);
  // A takeover with no name keeps the one it had.
  assert.equal(store.takeover("s_handed").name, "new window");
});

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

test("`lahe session name <id> <name>` sets and clears the name", async () => {
  const dir = tempState();
  agentSessions.createStore({ dir }).create({ id: "s_cli" });

  const set = await runSession(["name", "s_cli", "lahe updates 9/16", "--state-dir", dir]);
  assert.equal(set.code, protocol.CLI_EXIT.OK, set.stderr);
  assert.match(set.stdout, /s_cli/);
  assert.equal(agentSessions.createStore({ dir }).read("s_cli").name, "lahe updates 9/16");

  const cleared = await runSession(["name", "s_cli", "", "--state-dir", dir]);
  assert.equal(cleared.code, protocol.CLI_EXIT.OK, cleared.stderr);
  assert.equal(agentSessions.createStore({ dir }).read("s_cli").name, undefined);

  const missing = await runSession(["name", "s_cli", "--state-dir", dir]);
  assert.equal(missing.code, protocol.CLI_EXIT.BAD_USAGE, "the name itself is required, even if empty");
});

test("`lahe session takeover <id> --name` parses, and --name is refused where it means nothing", () => {
  assert.deepEqual(
    (({ action, id, name }) => ({ action, id, name }))(sessionCommand.parse(["takeover", "s_abc", "--name", "new window"])),
    { action: "takeover", id: "s_abc", name: "new window" }
  );
  assert.ok(sessionCommand.parse(["takeover", "s_abc", "--name"]).error, "--name needs a value");
  assert.ok(sessionCommand.parse(["close", "s_abc", "--name", "x"]).error, "close takes no name");
  assert.ok(sessionCommand.ACTIONS.includes("name"));
  assert.match(sessionCommand.USAGE, /lahe session name|name +/);
});

test("`lahe review ... --name` is taken off the arguments before the rest are parsed", () => {
  const taken = reviewCommand.takeName(["page.html", "--name", "lahe updates 9/16", "--only"]);
  assert.equal(taken.name, "lahe updates 9/16");
  assert.deepEqual(taken.list, ["page.html", "--only"]);
  assert.equal(reviewCommand.takeName(["page.html"]).name, undefined);
  assert.ok(reviewCommand.takeName(["page.html", "--name"]).error);
  assert.match(reviewCommand.USAGE, /--name/);
});

test("`lahe session list` prints the name after the id, quoted, and --json carries it", async () => {
  const dir = tempState();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_list_named", name: 'lahe "updates" 9/16' });
  store.create({ id: "s_list_plain" });

  const rows = sessionCommand.collect({ dir });
  const named = rows.find((row) => row.id === "s_list_named");
  const plain = rows.find((row) => row.id === "s_list_plain");
  assert.equal(named.name, 'lahe "updates" 9/16');
  assert.equal(plain.name, null);

  const line = sessionCommand.listLine(named, Date.now());
  assert.ok(line.startsWith('s_list_named  "lahe \\"updates\\" 9/16"  open'), line);
  assert.ok(sessionCommand.listLine(plain, Date.now()).startsWith("s_list_plain  open"));

  const text = await runSession(["list", "--state-dir", dir]);
  assert.match(text.stdout, /s_list_named {2}"lahe \\"updates\\" 9\/16"/);
  const json = await runSession(["list", "--json", "--state-dir", dir]);
  const parsed = json.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(parsed.find((row) => row.id === "s_list_named").name, 'lahe "updates" 9/16');
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

test("the name reaches the page in the liveness answer, next to the takeover command", () => {
  const dir = tempState();
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  const store = agentSessions.createStore({ dir, watchers: quietWatchers() });
  store.create({ id: "s_page", name: "lahe updates 9/16" });
  reviews.create({ id: "r_page", agent_session_id: "s_page" });
  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "words",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/p.html",
    page_seq: 1
  });
  log.append("r_page", [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_page",
      review: "r_page",
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: "/p.html",
      page_seq: 1,
      payload: { draft: false, record: item }
    })
  ]);
  const deps = { log, reviews, agentSessions: store, projection: projectionModule };
  const liveness = routes.handlerFor("replies.poll")({ review: "r_page", query: { since: 0 } }, deps).body.agent_liveness;
  assert.equal(FIELD.NAME, "session_name");
  assert.equal(liveness.session_name, "lahe updates 9/16");
  assert.ok(liveness.takeover_command.startsWith("lahe session takeover s_page"));

  // No name, no field value; and the pure half reads the name off the session.
  store.setName("s_page", "");
  const unnamed = routes.handlerFor("replies.poll")({ review: "r_page", query: { since: 0 } }, deps).body.agent_liveness;
  assert.equal(unnamed.session_name, null);
  const pure = agentSessions.livenessFrom({ session: { handoff_rev: 0, name: " x " }, unanswered: 0 });
  assert.equal(pure.session_name, "x");
});
