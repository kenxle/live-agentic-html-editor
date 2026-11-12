/*
 * read-when: Changing src/contract/agent-commands.ts, a command an agent runs or an exit code, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLI_EXIT,
  WAKE,
  drainCommand,
  monitorCommand,
  stateDirFlag,
  takeoverCommand
} from "../../../src/contract/agent-commands.ts";
import { callUntyped } from "./support/untyped.ts";

test("the exit codes are exactly these", () => {
  assert.deepEqual(CLI_EXIT, { OK: 0, HELPER_UNREACHABLE: 2, UNKNOWN_REVIEW: 3, BAD_USAGE: 4, SESSION_CLOSED: 5, SESSION_TAKEN_OVER: 6 });
});

test("the wake feed is a file of this name with these kinds and fields", () => {
  assert.deepEqual(WAKE, {
    FILE: "wake.log",
    KIND: { WORK: "work", TAKEOVER: "takeover", CLOSED: "closed", ENDED: "ended" },
    FIELD: { AT: "at", KIND: "kind", REVIEW: "review", ITEM: "item", REV: "rev", DRAIN: "drain" }
  });
});

test("no state folder means no flag, whatever else was passed", () => {
  for (const dir of [undefined, null, ""]) assert.equal(stateDirFlag(dir), "", String(dir));
  for (const dir of [5, {}, ["/tmp/x"], true]) assert.equal(callUntyped(stateDirFlag, dir), "", String(dir));
});

test("a state folder is a --state-dir flag, bare when the shell needs no quoting, in single quotes when it does", () => {
  assert.equal(stateDirFlag("/tmp/lahe-state"), " --state-dir /tmp/lahe-state");
  assert.equal(stateDirFlag("/a/B_c@d%e+f=g:h,i.j/k-l"), " --state-dir /a/B_c@d%e+f=g:h,i.j/k-l");
  assert.equal(
    stateDirFlag("/Users/a b/Library/Application Support/lahe"),
    " --state-dir '/Users/a b/Library/Application Support/lahe'"
  );
  assert.equal(stateDirFlag("/tmp/it's"), " --state-dir '/tmp/it'\\''s'");
  assert.equal(stateDirFlag("~/state"), " --state-dir '~/state'");
  assert.equal(stateDirFlag("/tmp/a$b"), " --state-dir '/tmp/a$b'");
  assert.equal(stateDirFlag("/tmp/a;rm"), " --state-dir '/tmp/a;rm'");
  assert.equal(stateDirFlag("/tmp/é"), " --state-dir '/tmp/é'");
});

test("the drain command carries the state folder when it is not the default, quoted when the path needs it", () => {
  assert.equal(drainCommand("s_1"), "lahe status --session s_1 --json --quiet");
  assert.equal(drainCommand("s_1", null), "lahe status --session s_1 --json --quiet");
  assert.equal(drainCommand("s_1", "/tmp/lahe-state"), "lahe status --session s_1 --json --quiet --state-dir /tmp/lahe-state");
  assert.equal(
    drainCommand("s_1", "/Users/a b/lahe"),
    "lahe status --session s_1 --json --quiet --state-dir '/Users/a b/lahe'"
  );
});

test("the monitor command names every session in order, each with its own hand-off revision when it has one", () => {
  assert.equal(monitorCommand("s_1"), "lahe monitor --session s_1");
  assert.equal(monitorCommand("s_1", "/tmp/lahe-state"), "lahe monitor --session s_1 --state-dir /tmp/lahe-state");
  assert.equal(
    monitorCommand("s_1", "/Users/a b/Library/Application Support/lahe"),
    "lahe monitor --session s_1 --state-dir '/Users/a b/Library/Application Support/lahe'"
  );
  assert.equal(monitorCommand(["s_a", "s_b"], null), "lahe monitor --session s_a --session s_b");
  assert.equal(monitorCommand(["s_a"]), "lahe monitor --session s_a");
  assert.equal(
    monitorCommand(["s_a", "s_b"], "/tmp/x", { s_a: 3, s_b: 0 }),
    "lahe monitor --session s_a --handoff-rev 3 --session s_b --handoff-rev 0 --state-dir /tmp/x"
  );
  assert.equal(monitorCommand(["s_a", "s_b"], null, { s_b: 2 }), "lahe monitor --session s_a --session s_b --handoff-rev 2");
  assert.equal(monitorCommand("s_a", null, { s_a: 1.5 }), "lahe monitor --session s_a", "only a whole number is a revision");
  assert.equal(monitorCommand("s_a", null, null), "lahe monitor --session s_a");
});

test("a session id is written as given and not checked, so a placeholder survives", () => {
  assert.equal(monitorCommand("<agent-session-id>"), "lahe monitor --session <agent-session-id>");
  assert.equal(drainCommand("<agent-session-id>"), "lahe status --session <agent-session-id> --json --quiet");
  assert.equal(takeoverCommand("<agent-session-id>"), "lahe session takeover <agent-session-id>");
});

test("the takeover command carries the state folder and, only when it is a safe id, the Library request", () => {
  assert.equal(takeoverCommand("s_1"), "lahe session takeover s_1");
  assert.equal(takeoverCommand("s_1", "/tmp/lahe-state"), "lahe session takeover s_1 --state-dir /tmp/lahe-state");
  assert.equal(takeoverCommand("s_1", null, "req_9"), "lahe session takeover s_1 --request req_9");
  assert.equal(takeoverCommand("s_1", "/tmp/x y", "req_9"), "lahe session takeover s_1 --state-dir '/tmp/x y' --request req_9");
  for (const request of ["a b", "", "../x", null, undefined, "-x"]) {
    assert.equal(takeoverCommand("s_1", null, request), "lahe session takeover s_1", JSON.stringify(request));
  }
  for (const request of [5, {}]) assert.equal(callUntyped(takeoverCommand, "s_1", null, request), "lahe session takeover s_1");
});
