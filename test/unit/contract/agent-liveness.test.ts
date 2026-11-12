/*
 * read-when: Changing src/contract/agent-liveness.ts, the words the rail says about an agent or the hand-off message, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_LIVENESS, MONITOR, handoffMessage, livenessOverdue } from "../../../src/contract/agent-liveness.ts";

test("the monitor's files, timings and fields are exactly these", () => {
  assert.deepEqual(MONITOR, {
    HEARTBEAT_FILE: "monitor.json",
    ACTIVITY_FILE: "activity.json",
    DELIVERED_FILE: "delivered.json",
    INTERVAL_SECONDS: 15,
    FRESH_INTERVALS: 3,
    HEARTBEAT_FIELD: { PID: "pid", HANDOFF_REV: "handoff_rev", AT: "at", PRIMARY: "primary" },
    ACTIVITY_FIELD: { AT: "at" },
    HEARTBEAT_FRESH_MS: 45000
  });
  assert.equal(MONITOR.HEARTBEAT_FRESH_MS, MONITOR.INTERVAL_SECONDS * MONITOR.FRESH_INTERVALS * 1000, "a heartbeat is fresh for three of the monitor's own loops");
});

test("the liveness states, fields and presence words are exactly these", () => {
  assert.deepEqual(AGENT_LIVENESS.STATE, { WORKING: "working", WAITING: "waiting", NO_AGENT: "no_agent", NONE: "none" });
  assert.deepEqual(AGENT_LIVENESS.FIELD, {
    STATE: "state",
    UNANSWERED: "unanswered",
    OLDEST_UNANSWERED_AT: "oldest_unanswered_at",
    LAST_REPLY_AT: "last_reply_at",
    LISTENING: "listening",
    MONITOR_AT: "monitor_at",
    ACTIVITY_AT: "activity_at",
    SESSION_ID: "session_id",
    STATE_DIR_FLAG: "state_dir_flag_needed",
    OLDEST_ITEM: "oldest_unanswered_item",
    NAME: "session_name",
    NAME_FROM_PAGE: "session_name_from_page",
    PRESENCE: "presence"
  });
  assert.deepEqual(AGENT_LIVENESS.PRESENCE, { LISTENING: "listening", WORKING: "working", AWAY: "away" });
});

test("the status line's words: one line per state that has words, and none for none", () => {
  assert.deepEqual(AGENT_LIVENESS.TEXT, {
    working: "agent is working, {age}",
    waiting: "nothing back yet, {age}",
    no_agent: "nobody has picked this up, {age}"
  });
  assert.equal(Object.hasOwn(AGENT_LIVENESS.TEXT, "none"), false);
  assert.deepEqual(AGENT_LIVENESS.CONNECTION, { connected: "agent listening", absent: "no agent listening" });
});

test("the hover text is exactly these sentences", () => {
  assert.deepEqual(AGENT_LIVENESS.DETAIL, {
    helper_up: "The helper is answering this page, so comments and edits reach it as you make them.",
    helper_down: "The helper is not answering right now, so your work is being kept in this browser until it is.",
    agent_connected: "An agent has this review open.",
    agent_absent: "No agent has this review open.",
    agent_unknown: "Whether an agent has this review open cannot be checked on this computer.",
    agent_named: "The agent on this review is named {name}.",
    replied: "The agent last replied {reply} ago.",
    never_replied: "The agent has not replied on this review yet.",
    waiting: "Your oldest unanswered item has been waiting {age}.",
    stored: "Your comments and edits are stored in this browser and in the helper's log on disk.",
    save: "You can get your own copy any time: use Copy review or Export review to file in the menu."
  });
});

test("the loud words are exactly these, and none of them is tool jargon or holds an em dash", () => {
  assert.deepEqual(AGENT_LIVENESS.PROMINENT, {
    BANNER: {
      no_agent: "Nobody has picked up your comments in {age}.",
      waiting: "Nothing has come back on your comments in {age}."
    },
    CHECK: "Check your agent's window first. It may have stopped, or it may be waiting on you.",
    CHECK_NAMED: "Check the agent named {name} first. It may have stopped, or it may be waiting on you.",
    HANDOFF_BUTTON: "Copy a message for a new agent",
    COPIED: "Copied. Paste it into a new agent and it will pick up your comments.",
    COPY_FAILED: "Could not copy. Select the message below and copy it yourself.",
    CARD: "waiting {age}",
    TOAST_LABEL: "Comments waiting",
    TOAST_CHECK: "Check your agent's window.",
    TOAST_CHECK_NAMED: "Check the agent named {name}.",
    TOAST_OPEN: "Open the rail to hand this doc to a new agent."
  });
  const words = [
    ...Object.values(AGENT_LIVENESS.PROMINENT.BANNER),
    AGENT_LIVENESS.PROMINENT.CHECK,
    AGENT_LIVENESS.PROMINENT.CHECK_NAMED,
    AGENT_LIVENESS.PROMINENT.HANDOFF_BUTTON,
    AGENT_LIVENESS.PROMINENT.COPIED,
    AGENT_LIVENESS.PROMINENT.COPY_FAILED,
    AGENT_LIVENESS.PROMINENT.CARD,
    AGENT_LIVENESS.PROMINENT.TOAST_LABEL,
    AGENT_LIVENESS.PROMINENT.TOAST_CHECK,
    AGENT_LIVENESS.PROMINENT.TOAST_CHECK_NAMED,
    AGENT_LIVENESS.PROMINENT.TOAST_OPEN
  ];
  assert.equal(words.length, 12);
  for (const word of words) {
    assert.equal(/monitor|heartbeat|wake|liveness|token|session/i.test(word), false, word);
    assert.equal(word.includes("—"), false, word);
  }
});

test("the timings are exactly these, and a working agent counts as recent for as long as a command counts as somebody there", () => {
  assert.equal(AGENT_LIVENESS.QUIET_MS, 30000);
  assert.equal(AGENT_LIVENESS.ACTIVE_MS, 600000);
  assert.equal(AGENT_LIVENESS.STALE_MS, 600000);
  assert.equal(AGENT_LIVENESS.RECENT_COMMAND_MS, 600000);
  assert.equal(AGENT_LIVENESS.NO_AGENT_LOUD_MS, 120000);
  assert.equal(AGENT_LIVENESS.ACTIVE_MS, AGENT_LIVENESS.RECENT_COMMAND_MS);
  assert.equal(Object.hasOwn(MONITOR, "ACTIVITY_FRESH_MS"), false);
});

test("AGENT_LIVENESS is data only: no function hangs on it", () => {
  assert.deepEqual(
    Object.keys(AGENT_LIVENESS),
    ["STATE", "FIELD", "PRESENCE", "TEXT", "CONNECTION", "DETAIL", "PROMINENT", "QUIET_MS", "ACTIVE_MS", "STALE_MS", "RECENT_COMMAND_MS", "NO_AGENT_LOUD_MS"]
  );
});

test("a wait is overdue at the quiet limit only for no_agent after 2 minutes and for waiting after 10 minutes, and never for working", () => {
  const { QUIET_MS, NO_AGENT_LOUD_MS, STALE_MS } = AGENT_LIVENESS;
  assert.equal(livenessOverdue("no_agent", QUIET_MS), false);
  assert.equal(livenessOverdue("no_agent", NO_AGENT_LOUD_MS - 1), false);
  assert.equal(livenessOverdue("no_agent", NO_AGENT_LOUD_MS), true);
  assert.equal(livenessOverdue("no_agent", STALE_MS * 10), true);
  assert.equal(livenessOverdue("waiting", QUIET_MS + 1000), false);
  assert.equal(livenessOverdue("waiting", STALE_MS - 1), false);
  assert.equal(livenessOverdue("waiting", STALE_MS), true);
  assert.equal(livenessOverdue("waiting", STALE_MS * 10), true);
  for (const waited of [0, QUIET_MS, STALE_MS, STALE_MS * 100, Number.MAX_SAFE_INTEGER]) {
    assert.equal(livenessOverdue("working", waited), false, "working at " + String(waited));
  }
});

test("a state with no words, or a wait that is not a number or is under the quiet limit, is never overdue", () => {
  for (const state of ["none", "unknown", "", null, undefined, 5, "toString", "constructor", "__proto__", ["waiting"]]) {
    assert.equal(livenessOverdue(state, AGENT_LIVENESS.STALE_MS * 10), false, String(state));
  }
  for (const waited of [null, undefined, "600000", NaN, Infinity, -Infinity, {}, 0, -1, AGENT_LIVENESS.QUIET_MS - 1]) {
    assert.equal(livenessOverdue("no_agent", waited), false, String(waited));
    assert.equal(livenessOverdue("waiting", waited), false, String(waited));
  }
});

const CONTINUE = "It prints the commands to catch up. Then work every comment that is waiting and reply to each one, and keep watching for new ones.";
const RAIL_WHY = "The agent that was working on it stopped answering my comments, and I am asking you to continue it.";
const LIBRARY_WHY = "I am handing it to you from the Lahe Library so you can continue it.";
const ELSEWHERE =
  "This review keeps its files outside Lahe's default folder, so add --state-dir with the folder the earlier agent's lahe commands used. If you cannot find it, ask me.";

function rail(sessionId: string | null, name: string | null, stateDirFlagNeeded: boolean): string {
  return handoffMessage({ from: "rail", sessionId, name, stateDirFlagNeeded });
}

function library(sessionId: string | null, name: string | null, stateDir: string | null, request: string | null): string {
  return handoffMessage({ from: "library", sessionId, name, stateDir, request });
}

test("from the rail, a session is taken over with its command, and the opener says the agent stopped answering", () => {
  assert.equal(
    rail("s_1", null, false),
    [
      "Please take over my live Lahe review. " + RAIL_WHY,
      "",
      "Run this command:",
      "",
      "    lahe session takeover s_1",
      "",
      CONTINUE
    ].join("\n")
  );
});

test("from the rail with a state folder outside the default, the message asks for the folder and names no path", () => {
  const message = rail("s_1", null, true);
  assert.equal(
    message,
    [
      "Please take over my live Lahe review. " + RAIL_WHY,
      "",
      "Run this command:",
      "",
      "    lahe session takeover s_1",
      "",
      ELSEWHERE,
      "",
      CONTINUE
    ].join("\n")
  );
  assert.equal(/\/(Users|home|tmp|var)\b/.test(message), false, "the page is never sent a filesystem path");
});

test("from the rail with no session to take over, the message points at the session list", () => {
  assert.equal(
    rail(null, null, false),
    [
      "Please take over my live Lahe review. " + RAIL_WHY,
      "",
      "Run `lahe session list` to find the session for this document, then take it over with:",
      "",
      "    lahe session takeover <session-id>",
      "",
      CONTINUE
    ].join("\n")
  );
  const asked = rail(null, null, true).split("\n");
  assert.deepEqual(asked.slice(-4), ["", ELSEWHERE, "", CONTINUE]);
  for (const message of [rail(null, null, false), rail(null, "coach", true), rail("a b", null, false)]) {
    assert.equal(message.includes("null"), false, message);
    assert.equal(message.includes("undefined"), false, message);
  }
});

test("a session id that is not a safe id is treated as no session", () => {
  assert.equal(rail("a b", null, false), rail(null, null, false));
  assert.equal(rail("", null, false), rail(null, null, false));
  assert.equal(rail("../x", "coach", false), rail(null, "coach", false));
});

test("a session's name is written quoted, with its own quotes escaped", () => {
  assert.equal(
    rail("s_1", "updates", false).split("\n")[0],
    'Please take over my live Lahe review, the session named "updates". ' + RAIL_WHY
  );
  assert.equal(
    rail("s_1", 'lahe "updates"', false).split("\n")[0],
    'Please take over my live Lahe review, the session named "lahe \\"updates\\"". ' + RAIL_WHY
  );
  assert.equal(rail("s_1", "", false).split("\n")[0], "Please take over my live Lahe review. " + RAIL_WHY);
});

test("from the Library, the opener blames nobody and the command carries the helper's state folder and the request", () => {
  const message = library("s_1", "updates", "/tmp/lahe-state", "req_1");
  assert.equal(
    message,
    [
      'Please take over my live Lahe review, the session named "updates". ' + LIBRARY_WHY,
      "",
      "Run this command:",
      "",
      "    lahe session takeover s_1 --state-dir /tmp/lahe-state --request req_1",
      "",
      CONTINUE
    ].join("\n")
  );
  assert.equal(message.includes("stopped answering"), false);
  assert.equal(message.includes("ask me"), false);
});

test("from the Library with the default state folder there is no --state-dir, and a human name is quoted", () => {
  const message = library("s_1", "coach activity", null, null);
  assert.equal(
    message,
    [
      'Please take over my live Lahe review, the session named "coach activity". ' + LIBRARY_WHY,
      "",
      "Run this command:",
      "",
      "    lahe session takeover s_1",
      "",
      CONTINUE
    ].join("\n")
  );
  assert.equal(message.includes("--state-dir"), false);
});

test("from the Library, a state folder with a space is quoted, and a request that is not a safe id is left out", () => {
  const message = library("s_1", null, "/Users/a b/lahe", "not a request");
  assert.equal(message.includes("    lahe session takeover s_1 --state-dir '/Users/a b/lahe'\n"), true, message);
  assert.equal(message.includes("--request"), false);
});

test("from the Library with no session to take, it points at the session list in the right state folder", () => {
  assert.equal(
    library(null, null, "/tmp/lahe-state", null),
    [
      "Please take over my live Lahe review. " + LIBRARY_WHY,
      "",
      "Run `lahe session list --state-dir /tmp/lahe-state` to find the session for this document, then take it over with:",
      "",
      "    lahe session takeover <session-id> --state-dir /tmp/lahe-state",
      "",
      CONTINUE
    ].join("\n")
  );
  assert.equal(
    library(null, null, null, "req_1"),
    [
      "Please take over my live Lahe review. " + LIBRARY_WHY,
      "",
      "Run `lahe session list` to find the session for this document, then take it over with:",
      "",
      "    lahe session takeover <session-id>",
      "",
      CONTINUE
    ].join("\n")
  );
});

test("the rail's question about the state folder is not asked in the Library, which writes the folder instead", () => {
  assert.equal(library("s_1", null, "/tmp/x", null).includes("add --state-dir"), false);
  assert.equal(library(null, null, "/tmp/x", null).includes("If you cannot find it"), false);
});

test("there is one hand-off builder: the Library's message is the rail's with only the opener's second sentence changed", () => {
  for (const [sessionId, name] of [["s_1", null], ["s_1", "coach"], [null, null], [null, "coach"]] as const) {
    const fromRail = rail(sessionId, name, false).split("\n");
    const fromLibrary = library(sessionId, name, null, null).split("\n");
    assert.deepEqual(fromLibrary.slice(1), fromRail.slice(1), String(sessionId) + " " + String(name));
    const first = (lines: readonly string[]): string => (lines[0] ?? "").split(". ")[0] ?? "";
    assert.equal(first(fromLibrary), first(fromRail));
    assert.notEqual(fromLibrary[0], fromRail[0]);
  }
});

test("the message is plain text with no token, no secret and no URL", () => {
  for (const message of [rail("s_1", "coach", true), library("s_1", "coach", "/tmp/x", "req_1")]) {
    assert.equal(/token|secret|http/i.test(message), false, message);
  }
});
