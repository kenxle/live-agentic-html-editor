/*
 * read-when: Changing what the rail or the Library may say about an agent, how overdue a wait is judged, or the hand-off message.
 */

import { stateDirFlag, takeoverCommand } from "./agent-commands.ts";
import { isSafeId } from "./safe-id.ts";

const INTERVAL_SECONDS = 15;
const FRESH_INTERVALS = 3;

export const MONITOR: {
  readonly HEARTBEAT_FILE: "monitor.json";
  readonly ACTIVITY_FILE: "activity.json";
  readonly DELIVERED_FILE: "delivered.json";
  readonly INTERVAL_SECONDS: 15;
  readonly FRESH_INTERVALS: 3;
  readonly HEARTBEAT_FIELD: {
    readonly PID: "pid";
    readonly HANDOFF_REV: "handoff_rev";
    readonly AT: "at";
    readonly PRIMARY: "primary";
  };
  readonly ACTIVITY_FIELD: { readonly AT: "at" };
  readonly HEARTBEAT_FRESH_MS: number;
} = {
  HEARTBEAT_FILE: "monitor.json",
  ACTIVITY_FILE: "activity.json",
  DELIVERED_FILE: "delivered.json",
  INTERVAL_SECONDS,
  FRESH_INTERVALS,
  HEARTBEAT_FIELD: { PID: "pid", HANDOFF_REV: "handoff_rev", AT: "at", PRIMARY: "primary" },
  ACTIVITY_FIELD: { AT: "at" },
  HEARTBEAT_FRESH_MS: INTERVAL_SECONDS * FRESH_INTERVALS * 1000
};

export const AGENT_LIVENESS = {
  STATE: {
    WORKING: "working",
    WAITING: "waiting",
    NO_AGENT: "no_agent",
    NONE: "none"
  },
  FIELD: {
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
  },
  PRESENCE: { LISTENING: "listening", WORKING: "working", AWAY: "away" },
  TEXT: {
    working: "agent is working, {age}",
    waiting: "nothing back yet, {age}",
    no_agent: "nobody has picked this up, {age}"
  },
  CONNECTION: {
    connected: "agent listening",
    absent: "no agent listening"
  },
  DETAIL: {
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
  },
  PROMINENT: {
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
  },
  QUIET_MS: 30000,
  ACTIVE_MS: 600000,
  STALE_MS: 600000,
  RECENT_COMMAND_MS: 600000,
  NO_AGENT_LOUD_MS: 120000
} as const;
export type LivenessState = (typeof AGENT_LIVENESS.STATE)[keyof typeof AGENT_LIVENESS.STATE];
export type Presence = (typeof AGENT_LIVENESS.PRESENCE)[keyof typeof AGENT_LIVENESS.PRESENCE];

export function livenessOverdue(state: unknown, waitedMs: unknown): boolean {
  if (typeof state !== "string" || !Object.hasOwn(AGENT_LIVENESS.TEXT, state)) return false;
  if (typeof waitedMs !== "number" || !Number.isFinite(waitedMs) || waitedMs < AGENT_LIVENESS.QUIET_MS) return false;
  if (state === AGENT_LIVENESS.STATE.WORKING) return false;
  if (state === AGENT_LIVENESS.STATE.NO_AGENT) return waitedMs >= AGENT_LIVENESS.NO_AGENT_LOUD_MS;
  return waitedMs >= AGENT_LIVENESS.STALE_MS;
}

export type Handoff =
  | {
      readonly from: "rail";
      readonly sessionId: string | null;
      readonly name: string | null;
      readonly stateDirFlagNeeded: boolean;
    }
  | {
      readonly from: "library";
      readonly sessionId: string | null;
      readonly name: string | null;
      readonly stateDir: string | null;
      readonly request: string | null;
    };

const RAIL_REASON = "The agent that was working on it stopped answering my comments, and I am asking you to continue it.";
const LIBRARY_REASON = "I am handing it to you from the Lahe Library so you can continue it.";
const STATE_DIR_QUESTION =
  "This review keeps its files outside Lahe's default folder, so add --state-dir with the folder the earlier agent's lahe commands used. If you cannot find it, ask me.";

export function handoffMessage(handoff: Handoff): string {
  const stateDir = handoff.from === "library" ? handoff.stateDir : null;
  const requestId = handoff.from === "library" ? handoff.request : null;
  const flag = stateDirFlag(stateDir);
  const sessionId = handoff.sessionId;
  const run = isSafeId(sessionId)
    ? ["Run this command:", "", "    " + takeoverCommand(sessionId, stateDir, requestId), ""]
    : ["Run `lahe session list" + flag + "` to find the session for this document, then take it over with:", "", "    lahe session takeover <session-id>" + flag, ""];
  const asksForStateDir = handoff.from === "rail" && handoff.stateDirFlagNeeded;
  const named = handoff.name === null || handoff.name === "" ? "" : ", the session named " + JSON.stringify(handoff.name);
  return [
    "Please take over my live Lahe review" + named + ". " + (handoff.from === "rail" ? RAIL_REASON : LIBRARY_REASON),
    "",
    ...run,
    ...(asksForStateDir ? [STATE_DIR_QUESTION, ""] : []),
    "It prints the commands to catch up. Then work every comment that is waiting and reply to each one, and keep watching for new ones."
  ].join("\n");
}
