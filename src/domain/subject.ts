/*
 * read-when: A comment on a whole element is weighed against the wrong text, or an agent gets an image tag without its source.
 */

import type { Item, Subject } from "../contract/record.ts";

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function paintQuoteOf(item: Pick<Item, "context"> | null | undefined): string | null {
  throw notBuilt(item);
}
export function subjectHtmlOf(subject: Subject | null | undefined): string | null {
  throw notBuilt(subject);
}
