// Making it obvious when nobody is picking up the reviewer's comments.
//
// Ken, 2026-09-16, looking at "Stored · nobody has picked this up, 10m": "active
// boxes should change color if they haven't been picked up after a certain
// amount of time. something with more prominence should tell you to go check
// your agent or assign a new one to this doc."
//
// Spec: docs/features/20260916.04_unanswered_prominence/01_spec_unanswered_prominence.md
//
// Three things are pinned here, headless:
//
//   THE RULE      when a wait is overdue. One rule, in protocol.js, and the
//                 footer line, the card color and the banner all read it.
//   THE CARD      a waiting card past the rule is overdue, says how long, and
//                 stops being overdue the moment a reply lands.
//   THE HANDOFF   the message the banner's button copies: plain text naming
//                 this session and the takeover command, and no secret.
//
// What it LOOKS like (the amber, the banner at the top of the rail) is asserted
// in a real browser: test/browser/rail_agent_liveness.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const overlay = require("../../src/layer/overlay.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const stateDir = require("../../src/service/state_dir.js");
const watchersModule = require("../../src/service/watchers.js");

const LIVENESS = protocol.AGENT_LIVENESS;
const STATE = LIVENESS.STATE;
const NOW = Date.parse("2026-09-16T20:00:00.000Z");

function agoIso(ms) {
  return new Date(NOW - ms).toISOString();
}

function readyItem(waitedMs, overrides) {
  const item = record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "the heading is still wrong",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/"
      },
      overrides || {}
    )
  );
  item[record.FIELD.CREATED_AT] = agoIso(waitedMs);
  item[record.FIELD.UPDATED_AT] = agoIso(waitedMs);
  return item;
}

function railAt(clock) {
  const rail = overlay.createRail({ document: null, now: () => clock });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  return rail;
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test("no agent listening: overdue after the quiet limit, and not before", () => {
  assert.equal(LIVENESS.overdue(STATE.NO_AGENT, LIVENESS.QUIET_MS - 1), false);
  assert.equal(LIVENESS.overdue(STATE.NO_AGENT, LIVENESS.QUIET_MS), true, "there is nobody to wait for");
});

test("an agent listening with nothing back: overdue after the stale limit, and not before", () => {
  assert.equal(LIVENESS.overdue(STATE.WAITING, LIVENESS.QUIET_MS + 1000), false);
  assert.equal(LIVENESS.overdue(STATE.WAITING, LIVENESS.STALE_MS - 1), false);
  assert.equal(LIVENESS.overdue(STATE.WAITING, LIVENESS.STALE_MS), true);
});

test("an agent that is working is never overdue, however long the queue behind it", () => {
  assert.equal(LIVENESS.overdue(STATE.WORKING, LIVENESS.STALE_MS * 20), false);
});

test("nothing waiting, an unknown state, or no wait at all is never overdue", () => {
  assert.equal(LIVENESS.overdue(STATE.NONE, LIVENESS.STALE_MS * 2), false);
  assert.equal(LIVENESS.overdue("something_new", LIVENESS.STALE_MS * 2), false);
  assert.equal(LIVENESS.overdue(null, LIVENESS.STALE_MS * 2), false);
  assert.equal(LIVENESS.overdue(STATE.NO_AGENT, null), false);
});

test("the footer's loud line is the same rule, not a second one", () => {
  const cases = [
    [STATE.NO_AGENT, LIVENESS.QUIET_MS + 1000],
    [STATE.NO_AGENT, 5000],
    [STATE.WAITING, LIVENESS.STALE_MS + 1000],
    [STATE.WAITING, LIVENESS.STALE_MS - 1000],
    [STATE.WORKING, LIVENESS.STALE_MS * 3]
  ];
  cases.forEach(([state, waited]) => {
    const rail = railAt(NOW);
    rail.setAgentLiveness({ state: state, unanswered: 1, oldest_unanswered_at: agoIso(waited) });
    assert.equal(
      rail.statusLine().loud,
      LIVENESS.overdue(state, waited),
      state + " after " + waited + "ms: the line and the rule agree"
    );
    rail.unmount();
  });
});

// ---------------------------------------------------------------------------
// The card and the banner
// ---------------------------------------------------------------------------

test("a card waiting past the limit is overdue and says how long; a fresh one is not", () => {
  const rail = railAt(NOW);
  const old = readyItem(12 * 60000);
  const fresh = readyItem(20000);
  rail.upsertCard(old);
  rail.upsertCard(fresh);
  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 2,
    listening: true,
    oldest_unanswered_at: old[record.FIELD.UPDATED_AT]
  });

  const late = rail.cardWait(old[record.FIELD.ID]);
  assert.equal(late.overdue, true);
  assert.equal(late.text, "waiting 12m");
  assert.equal(rail.cardWait(fresh[record.FIELD.ID]).overdue, false, "twenty seconds is not late");
  rail.unmount();
});

test("no agent listening turns a card amber after thirty seconds", () => {
  const rail = railAt(NOW);
  const item = readyItem(45000);
  rail.upsertCard(item);
  rail.setAgentLiveness({
    state: STATE.NO_AGENT,
    unanswered: 1,
    listening: false,
    oldest_unanswered_at: item[record.FIELD.UPDATED_AT]
  });
  assert.equal(rail.cardWait(item[record.FIELD.ID]).overdue, true);
  assert.equal(rail.waitBanner().shown, true);
  rail.unmount();
});

test("a working agent keeps every card calm and the banner away", () => {
  const rail = railAt(NOW);
  const item = readyItem(40 * 60000);
  rail.upsertCard(item);
  rail.setAgentLiveness({
    state: STATE.WORKING,
    unanswered: 1,
    listening: true,
    oldest_unanswered_at: item[record.FIELD.UPDATED_AT],
    activity_at: agoIso(20000)
  });
  assert.equal(rail.cardWait(item[record.FIELD.ID]).overdue, false);
  assert.equal(rail.waitBanner().shown, false);
  rail.unmount();
});

test("the banner shows exactly when the footer is loud, and says how long in plain words", () => {
  const rail = railAt(NOW);
  rail.setAgentLiveness({
    state: STATE.NO_AGENT,
    unanswered: 2,
    listening: false,
    oldest_unanswered_at: agoIso(20 * 60000)
  });
  const banner = rail.waitBanner();
  assert.equal(banner.shown, rail.statusLine().loud);
  assert.equal(banner.shown, true);
  assert.match(banner.text, /20m/);
  assert.equal(banner.text, LIVENESS.PROMINENT.BANNER.no_agent.replace("{age}", "20m"));
  assert.equal(banner.check, LIVENESS.PROMINENT.CHECK);
  assert.equal(banner.button, LIVENESS.PROMINENT.HANDOFF_BUTTON);

  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 2,
    listening: true,
    oldest_unanswered_at: agoIso(11 * 60000)
  });
  assert.equal(rail.waitBanner().text, LIVENESS.PROMINENT.BANNER.waiting.replace("{age}", "11m"));

  // Work that has not reached the helper has not reached an agent either.
  rail.setStatusLine(overlay.STATUS.KEPT_LOCALLY);
  assert.equal(rail.waitBanner().shown, false);
  rail.unmount();
});

test("a reply landing puts the card back and takes the banner away", () => {
  const rail = railAt(NOW);
  const item = readyItem(15 * 60000);
  rail.upsertCard(item);
  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 1,
    listening: true,
    oldest_unanswered_at: item[record.FIELD.UPDATED_AT]
  });
  assert.equal(rail.cardWait(item[record.FIELD.ID]).overdue, true);
  assert.equal(rail.waitBanner().shown, true);

  // The reply folds onto the item before the helper's next liveness answer
  // arrives. The card goes back on the item alone.
  const answered = Object.assign({}, item);
  answered[record.FIELD.STATE] = record.STATE.HANDLED;
  answered[record.FIELD.REPLY] = {
    status: record.REPLY_STATUS.HANDLED,
    agent: "claude",
    at: new Date(NOW).toISOString(),
    files: []
  };
  rail.upsertCard(answered);
  assert.equal(rail.cardWait(item[record.FIELD.ID]).overdue, false, "answered is not waiting");

  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, listening: true, oldest_unanswered_at: null });
  assert.equal(rail.waitBanner().shown, false);
  rail.unmount();
});

test("the reviewer's words carry no tool jargon", () => {
  const P = LIVENESS.PROMINENT;
  const words = [P.BANNER.no_agent, P.BANNER.waiting, P.CHECK, P.HANDOFF_BUTTON, P.COPIED, P.COPY_FAILED, P.CARD]
    .join(" ")
    .toLowerCase();
  ["monitor", "heartbeat", "wake", "liveness", "token", "session"].forEach((jargon) => {
    assert.equal(words.includes(jargon), false, "the rail never says " + JSON.stringify(jargon));
  });
  // No em dashes, anywhere Ken reads.
  assert.equal(/—/.test(words), false);
});

// ---------------------------------------------------------------------------
// The handoff message
// ---------------------------------------------------------------------------

test("the handoff message names the session and the takeover command, in plain text", () => {
  const command = protocol.takeoverCommand("s_7f3a", null);
  assert.equal(command, "lahe session takeover s_7f3a");
  const message = LIVENESS.handoffMessage(command);
  assert.equal(typeof message, "string");
  assert.ok(message.includes("s_7f3a"), "the new agent is told which session");
  assert.ok(message.includes("lahe session takeover s_7f3a"), "and the command that takes it over");
  assert.equal(/<[a-z]/i.test(message), false, "plain text, no markup");
  assert.equal(/—/.test(message), false, "no em dashes");
  // Pasting it is the human's explicit request, which is what takeover needs.
  assert.match(message.toLowerCase(), /take over/);
});

test("the handoff message carries a custom state directory when there is one", () => {
  const command = protocol.takeoverCommand("s_7f3a", "/tmp/lahe state");
  assert.equal(command, "lahe session takeover s_7f3a --state-dir '/tmp/lahe state'");
  assert.ok(LIVENESS.handoffMessage(command).includes(command));
});

test("the handoff message holds no token or review secret", () => {
  const rail = railAt(NOW);
  const secret = "tok_do_not_leak_0123456789";
  rail.setAgentLiveness({
    state: STATE.NO_AGENT,
    unanswered: 1,
    listening: false,
    oldest_unanswered_at: agoIso(5 * 60000),
    takeover_command: protocol.takeoverCommand("s_7f3a", null),
    // Anything else on the wire object never reaches the message.
    token: secret,
    session_secret: secret
  });
  const message = rail.waitBanner().message;
  assert.ok(message.includes("lahe session takeover s_7f3a"));
  assert.equal(message.includes(secret), false);
  assert.equal(/token|secret/i.test(message), false);
  rail.unmount();
});

test("a review with no agent session still gets a message that works", () => {
  // Reviews from before sessions existed have no id to name. The new agent is
  // pointed at the list instead of handed a command with a hole in it.
  const message = LIVENESS.handoffMessage(null);
  assert.ok(message.includes("lahe session list"));
  assert.ok(message.includes("lahe session takeover"));
  assert.equal(message.includes("null"), false);
  assert.equal(message.includes("undefined"), false);
});

test("the copy button writes the handoff message to the clipboard", async () => {
  let written = null;
  const rail = overlay.createRail({
    document: null,
    now: () => NOW,
    clipboard: { writeText: (text) => { written = text; return Promise.resolve(); } }
  });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  rail.setAgentLiveness({
    state: STATE.NO_AGENT,
    unanswered: 1,
    listening: false,
    oldest_unanswered_at: agoIso(5 * 60000),
    takeover_command: "lahe session takeover s_7f3a"
  });
  const result = await rail.copyHandoff();
  assert.equal(result.ok, true);
  assert.equal(written, rail.waitBanner().message);

  const refusing = overlay.createRail({
    document: null,
    now: () => NOW,
    clipboard: { writeText: () => Promise.reject(new Error("denied")) }
  });
  refusing.mount();
  const failed = await refusing.copyHandoff();
  assert.equal(failed.ok, false, "no false success when the clipboard refused");
  rail.unmount();
  refusing.unmount();
});

// ---------------------------------------------------------------------------
// The helper sends the command, with the state directory already in it
// ---------------------------------------------------------------------------

test("the helper's liveness answer carries the takeover command for its session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-prominence-"));
  const store = agentSessions.createStore({
    dir: dir,
    watchers: watchersModule.createWatchers({
      probe: () => Promise.resolve({ listening: false, supported: true })
    })
  });
  store.create({ id: "s_hand" });
  const out = store.liveness("s_hand", { unanswered: 1, oldestUnansweredAt: agoIso(60000) });
  assert.equal(out[LIVENESS.FIELD.TAKEOVER], protocol.takeoverCommand("s_hand", stateDir.flagFor(dir)));
  assert.ok(out[LIVENESS.FIELD.TAKEOVER].startsWith("lahe session takeover s_hand"));

  // The pure half, with no store behind it, claims no command.
  const bare = agentSessions.livenessFrom({ session: { handoff_rev: 0 }, unanswered: 0, nowMs: NOW });
  assert.equal(bare[LIVENESS.FIELD.TAKEOVER], null);
});

// ---------------------------------------------------------------------------
// Which agent: the session's name
// ---------------------------------------------------------------------------

test("the banner names the agent to check when the session has a name, and says it plainly when not", () => {
  const rail = railAt(NOW);
  const base = {
    state: STATE.NO_AGENT,
    unanswered: 1,
    listening: false,
    oldest_unanswered_at: agoIso(5 * 60000),
    takeover_command: "lahe session takeover s_named"
  };
  rail.setAgentLiveness(base);
  assert.equal(rail.waitBanner().check, LIVENESS.PROMINENT.CHECK);

  rail.setAgentLiveness(Object.assign({}, base, { session_name: "lahe updates 9/16" }));
  const banner = rail.waitBanner();
  assert.equal(banner.check, LIVENESS.PROMINENT.CHECK_NAMED.replace("{name}", "lahe updates 9/16"));
  assert.match(banner.check, /^Check the agent named lahe updates 9\/16/);
  assert.match(rail.statusLine().title, /lahe updates 9\/16/, "the footer hover names it too");
  assert.match(banner.message, /lahe updates 9\/16/, "and so does the handoff message");
  rail.unmount();
});

test("the handoff message names the session being taken over, quoted", () => {
  const message = LIVENESS.handoffMessage("lahe session takeover s_1", 'lahe "updates"');
  assert.ok(message.includes('"lahe \\"updates\\""'), message);
  assert.equal(LIVENESS.handoffMessage("lahe session takeover s_1", null).includes("named"), false);
});

// ---------------------------------------------------------------------------
// The rail closed to its pill
// ---------------------------------------------------------------------------

test("the collapsed pill goes late on the same rule, shows the wait, and carries the banner's sentence", () => {
  const rail = railAt(NOW);
  const item = readyItem(12 * 60000);
  rail.upsertCard(item);
  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 1,
    listening: true,
    oldest_unanswered_at: item[record.FIELD.UPDATED_AT],
    session_name: "lahe updates 9/16"
  });
  const pill = rail.pillWait();
  assert.equal(pill.late, rail.statusLine().loud);
  assert.equal(pill.late, true);
  assert.equal(pill.text, "12m");
  assert.ok(pill.title.includes(rail.waitBanner().text));
  assert.ok(pill.title.includes("lahe updates 9/16"));

  // A working agent: same wait, and the pill is its ordinary self.
  rail.setAgentLiveness({
    state: STATE.WORKING,
    unanswered: 1,
    listening: true,
    oldest_unanswered_at: item[record.FIELD.UPDATED_AT],
    activity_at: agoIso(10000)
  });
  assert.equal(rail.pillWait().late, false);
  assert.equal(rail.pillWait().text, "");

  // A reply lands and nothing is waiting: back to normal.
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, listening: true, oldest_unanswered_at: null });
  assert.equal(rail.pillWait().late, false);
  rail.unmount();
});

// ---------------------------------------------------------------------------
// One toast per crossing
// ---------------------------------------------------------------------------

function overdueToasts(rail) {
  return rail.toastInfo().toasts.filter((t) => String(t.key).indexOf("overdue:") === 0);
}

test("crossing the rule raises one toast, keyed to the review and the oldest waiting item", () => {
  const rail = overlay.createRail({ document: null, now: () => NOW, reviewId: "r_toast" });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  const first = readyItem(12 * 60000);
  rail.upsertCard(first);
  const overdue = {
    state: STATE.WAITING,
    unanswered: 1,
    listening: true,
    oldest_unanswered_at: first[record.FIELD.UPDATED_AT],
    session_name: "lahe updates 9/16"
  };
  // Not yet over the line: nothing.
  rail.setAgentLiveness(Object.assign({}, overdue, { oldest_unanswered_at: agoIso(60000) }));
  assert.equal(overdueToasts(rail).length, 0);

  rail.setAgentLiveness(overdue);
  let raised = overdueToasts(rail);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].key, "overdue:r_toast:" + first[record.FIELD.ID]);
  assert.ok(raised[0].text.includes(rail.waitBanner().text));
  assert.ok(raised[0].text.includes("lahe updates 9/16"), "it names the agent");

  // The same wait, repainted by the clock and by the helper repeating itself.
  rail.setAgentLiveness(Object.assign({}, overdue));
  rail.setStatusLine(overlay.STATUS.STORED);
  assert.equal(overdueToasts(rail).length, 1, "no second toast for the same wait");

  // Dismissed: it does not come back for that same wait.
  rail.dismissToast(raised[0].id);
  rail.setAgentLiveness(Object.assign({}, overdue));
  assert.equal(overdueToasts(rail).length, 0);

  // The reply lands. Then a new comment waits too long: a new wait, a new toast.
  const answered = Object.assign({}, first, { state: record.STATE.HANDLED });
  answered[record.FIELD.REPLY] = { status: record.REPLY_STATUS.HANDLED, agent: "claude", at: agoIso(1000), files: [] };
  rail.upsertCard(answered);
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, listening: true, oldest_unanswered_at: null });
  assert.equal(overdueToasts(rail).length, 0, "a reply raises nothing");
  const second = readyItem(11 * 60000);
  rail.upsertCard(second);
  rail.setAgentLiveness(Object.assign({}, overdue, { oldest_unanswered_at: second[record.FIELD.UPDATED_AT] }));
  raised = overdueToasts(rail);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].key, "overdue:r_toast:" + second[record.FIELD.ID]);
  rail.unmount();
});
