/*
 * read-when: Changing how two texts or two markups are compared for an edit, or how bold and italic runs are listed.
 */

import { textOf } from "./block-text.ts";
import { cleanMarkup } from "./clean-markup.ts";
import { isStructuralTag } from "./formatting.ts";
import type { StructuralTag } from "./formatting.ts";
import { breakOfTag, tokenizeMarkup } from "./html-syntax.ts";
import { normalizeText } from "./text.ts";

export const COMPARISON_MODE: { readonly TEXT: "text"; readonly STRUCTURE: "structure" } = {
  TEXT: "text",
  STRUCTURE: "structure"
};
export type ComparisonMode = (typeof COMPARISON_MODE)[keyof typeof COMPARISON_MODE];

export interface EmphasisRun {
  readonly tag: StructuralTag;
  readonly text: string;
}

interface OpenRun {
  readonly tag: StructuralTag;
  text: string;
}

const FORMAT_ONLY_KIND = "format_only";

export function modeFor(kind: string): ComparisonMode {
  return kind === FORMAT_ONLY_KIND ? COMPARISON_MODE.STRUCTURE : COMPARISON_MODE.TEXT;
}

export function structureOf(html: string): string {
  const parts: string[] = [];
  for (const token of tokenizeMarkup(cleanMarkup(html))) {
    if (token.kind === "text") {
      parts.push(token.text);
    } else if (isStructuralTag(token.tag.name)) {
      parts.push((token.tag.kind === "end" ? "</" : "<") + token.tag.name + ">");
    } else {
      parts.push(breakOfTag(token.tag.name));
    }
  }
  return normalizeText(parts.join(""));
}

export function equalsInMode(mode: ComparisonMode, a: string, b: string): boolean {
  switch (mode) {
    case COMPARISON_MODE.TEXT:
      return textOf(a) === textOf(b);
    case COMPARISON_MODE.STRUCTURE:
      return structureOf(a) === structureOf(b);
  }
}

function finishRun(runs: EmphasisRun[], run: OpenRun): void {
  const text = normalizeText(run.text);
  if (text !== "") runs.push({ tag: run.tag, text });
}

export function emphasisRuns(html: string): readonly EmphasisRun[] {
  const open: OpenRun[] = [];
  const runs: EmphasisRun[] = [];
  for (const token of tokenizeMarkup(structureOf(html))) {
    if (token.kind === "text") {
      for (const run of open) run.text += token.text;
      continue;
    }
    const name = token.tag.name;
    if (!isStructuralTag(name)) continue;
    if (token.tag.kind === "start") {
      open.push({ tag: name, text: "" });
      continue;
    }
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const run = open[i];
      if (run?.tag !== name) continue;
      open.splice(i, 1);
      finishRun(runs, run);
      break;
    }
  }
  return runs;
}
