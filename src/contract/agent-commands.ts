/*
 * read-when: Changing a CLI exit code, a line of the wake feed, or the spelling of a command printed for an agent to run.
 */

import { isSafeId } from "./safe-id.ts";

export const CLI_EXIT = {
  OK: 0,
  HELPER_UNREACHABLE: 2,
  UNKNOWN_REVIEW: 3,
  BAD_USAGE: 4,
  SESSION_CLOSED: 5,
  SESSION_TAKEN_OVER: 6
} as const;
export type CliExitCode = (typeof CLI_EXIT)[keyof typeof CLI_EXIT];

export const WAKE = {
  FILE: "wake.log",
  KIND: {
    WORK: "work",
    TAKEOVER: "takeover",
    CLOSED: "closed",
    ENDED: "ended"
  },
  FIELD: {
    AT: "at",
    KIND: "kind",
    REVIEW: "review",
    ITEM: "item",
    REV: "rev",
    DRAIN: "drain"
  }
} as const;
export type WakeKind = (typeof WAKE.KIND)[keyof typeof WAKE.KIND];

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellWord(value: string): string {
  return SHELL_SAFE.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
}

export function stateDirFlag(stateDir: string | null | undefined): string {
  const dir: unknown = stateDir;
  return typeof dir !== "string" || dir === "" ? "" : " --state-dir " + shellWord(dir);
}

export function drainCommand(sessionId: string, stateDir?: string | null): string {
  return "lahe status --session " + sessionId + " --json --quiet" + stateDirFlag(stateDir);
}

export function monitorCommand(
  sessions: string | readonly string[],
  stateDir?: string | null,
  handoffRevisions?: Readonly<Record<string, number>> | null
): string {
  const ids = typeof sessions === "string" ? [sessions] : sessions;
  const watched = ids.map((id) => {
    const revision = handoffRevisions?.[id];
    return " --session " + id + (revision !== undefined && Number.isInteger(revision) ? " --handoff-rev " + String(revision) : "");
  });
  return "lahe monitor" + watched.join("") + stateDirFlag(stateDir);
}

export function takeoverCommand(sessionId: string, stateDir?: string | null, requestId?: string | null): string {
  return "lahe session takeover " + sessionId + stateDirFlag(stateDir) + (isSafeId(requestId) ? " --request " + requestId : "");
}
