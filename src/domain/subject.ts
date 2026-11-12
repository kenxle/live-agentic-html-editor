/*
 * read-when: A comment on a whole element is weighed against the wrong text, or an agent gets an image tag without its source.
 */

import { SUBJECT_SRC_REF } from "../contract/record.ts";
import type { Item, Subject } from "../contract/record.ts";
import { escapeAttrValue } from "./html-syntax.ts";

const SRC_POINTER = ' src="' + SUBJECT_SRC_REF + '"';

export function paintQuoteOf(item: Pick<Item, "context"> | null | undefined): string | null {
  const context = item?.context;
  if (!context || context.subject) return null;
  return typeof context.quote === "string" ? context.quote : null;
}

export function subjectHtmlOf(subject: Subject | null | undefined): string | null {
  if (!subject || typeof subject.html !== "string") return null;
  if (!subject.html.includes(SRC_POINTER) || typeof subject.src !== "string") return subject.html;
  return subject.html.split(SRC_POINTER).join(' src="' + escapeAttrValue(subject.src) + '"');
}
