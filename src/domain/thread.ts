/*
 * read-when: Changing follow-up, reopen, or how an answered turn becomes history.
 */

import type { FoldedReply, Item, ThreadRound } from "../contract/record.ts";

export interface NextTurn {
  readonly note?: string | null | undefined;
  readonly change?: string | null | undefined;
}

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function threadOf(item: { readonly thread?: readonly ThreadRound[] | undefined } | null | undefined): readonly ThreadRound[] {
  throw notBuilt(item);
}
export function chronologicalThread(item: { readonly thread?: readonly ThreadRound[] | undefined } | null | undefined): ThreadRound[] {
  throw notBuilt(item);
}
export function retainReplies(item: Pick<Item, "reply">, reply: FoldedReply): FoldedReply {
  throw notBuilt(item, reply);
}
export function completedRound(item: Item): ThreadRound {
  throw notBuilt(item);
}
export function continueThread(item: Item, nextTurn?: NextTurn): Item {
  throw notBuilt(item, nextTurn);
}
export function continueOnto(item: Item, base: Item, nextTurn?: NextTurn): Item {
  throw notBuilt(item, base, nextTurn);
}
export function followUp(item: Item, text: string): Item {
  throw notBuilt(item, text);
}
export function reopenIssue(item: Item): Item {
  throw notBuilt(item);
}
