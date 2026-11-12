/*
 * read-when: Changing how two texts or two markups are compared, or how emphasis runs are listed.
 */

import type { StructuralTag } from "./formatting.ts";

const NOT_BUILT = "C2: not built yet";

export const COMPARISON_MODE: { readonly TEXT: "text"; readonly STRUCTURE: "structure" } = {
  TEXT: "text",
  STRUCTURE: "structure"
};
export type ComparisonMode = (typeof COMPARISON_MODE)[keyof typeof COMPARISON_MODE];

export function modeFor(kind: string): ComparisonMode {
  throw new Error(NOT_BUILT + kind);
}
export function structureOf(html: string): string {
  throw new Error(NOT_BUILT + html);
}
export function equalsInMode(mode: ComparisonMode, a: string, b: string): boolean {
  throw new Error(NOT_BUILT + mode + a + b);
}

export interface EmphasisRun {
  readonly tag: StructuralTag;
  readonly text: string;
}
export function emphasisRuns(html: string): readonly EmphasisRun[] {
  throw new Error(NOT_BUILT + html);
}
