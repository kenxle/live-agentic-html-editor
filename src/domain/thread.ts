/*
 * read-when: Changing follow-up, reopen, or how an answered turn becomes history.
 */

import { STATE } from "../contract/record.ts";
import type { ArchivedReply, FoldedReply, Item, ThreadRound } from "../contract/record.ts";
import { bumpRev } from "./item-revisions.ts";
import { toolRoundOf } from "./tool-round.ts";

export interface NextTurn {
  readonly note?: string | null | undefined;
  readonly change?: string | null | undefined;
}

type Threaded = { readonly thread?: readonly ThreadRound[] | undefined } | null | undefined;

function isList<T>(value: readonly T[] | null | undefined): value is readonly T[] {
  return Array.isArray(value);
}

export function threadOf(item: Threaded): readonly ThreadRound[] {
  const thread = item?.thread;
  return isList(thread) ? thread : [];
}

function timeOf(round: ThreadRound): number {
  return Date.parse(round.reviewer.at || round.agent.at || "");
}

export function chronologicalThread(item: Threaded): ThreadRound[] {
  return threadOf(item)
    .map((round, index) => ({ round, index, time: timeOf(round) }))
    .sort((a, b) => {
      const aKnown = Number.isFinite(a.time);
      const bKnown = Number.isFinite(b.time);
      if (aKnown && bKnown && a.time !== b.time) return a.time - b.time;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.round);
}

function archive(reply: FoldedReply | ArchivedReply, withPrevious: boolean): ArchivedReply {
  return {
    status: reply.status || null,
    agent: reply.agent || null,
    reason: reply.reason || null,
    text: reply.text || null,
    files: isList(reply.files) ? [...reply.files] : [],
    at: reply.at || null,
    ...(reply.proofread === true
      ? {
          proofread: true,
          suggestions: (isList(reply.suggestions) ? reply.suggestions : []).map((fix) => ({
            block: fix.block,
            from: fix.from,
            to: fix.to
          }))
        }
      : {}),
    ...(withPrevious && isList(reply.previous) ? { previous: reply.previous.map((earlier) => archive(earlier, true)) } : {})
  };
}

export function retainReplies(item: Pick<Item, "reply">, reply: FoldedReply): FoldedReply {
  const prior = item.reply;
  if (!prior) return { ...reply };
  const earlier = archive(prior, false);
  if (JSON.stringify(earlier) === JSON.stringify(archive(reply, true))) return prior;
  return { ...reply, previous: [...(prior.previous ?? []), earlier] };
}

export function completedRound(item: Item): ThreadRound {
  if (!item.reply) {
    throw new Error("completedRound: an item needs an agent reply before it can be archived");
  }
  const tool = toolRoundOf(item);
  return {
    rev: item.rev,
    reviewer: {
      note: typeof item.note === "string" ? item.note : null,
      change: typeof item.change === "string" ? item.change : null,
      at: item.updated_at || item.created_at || null
    },
    agent: archive(item.reply, true),
    ...(tool === null ? {} : { tool })
  };
}

export function continueThread(item: Item, nextTurn: NextTurn = {}): Item {
  const history = chronologicalThread(item);
  history.push(completedRound(item));
  const next = bumpRev(item, {
    note: typeof nextTurn.note === "string" ? nextTurn.note : null,
    change: typeof nextTurn.change === "string" ? nextTurn.change : null,
    thread: history
  });
  next.state = STATE.READY;
  next.reply = null;
  return next;
}

export function continueOnto(item: Item, base: Item, nextTurn: NextTurn = {}): Item {
  const change = typeof nextTurn.change === "string" ? nextTurn.change : typeof item.change === "string" ? item.change : null;
  if (base === item) return continueThread(item, { note: nextTurn.note, change });
  const next: Item = { ...base };
  next.thread = [...chronologicalThread(item), completedRound(item)];
  next.note = typeof nextTurn.note === "string" ? nextTurn.note : null;
  if (typeof base.change !== "string") next.change = change;
  next.state = STATE.READY;
  next.reply = null;
  return next;
}

export function followUp(item: Item, text: string): Item {
  const note = typeof text === "string" ? text : "";
  if (note.trim() === "") return item;
  return continueThread(item, { note, change: typeof item.change === "string" ? item.change : null });
}

export function reopenIssue(item: Item): Item {
  return continueThread(item, {
    note: typeof item.note === "string" ? item.note : null,
    change: typeof item.change === "string" ? item.change : null
  });
}
