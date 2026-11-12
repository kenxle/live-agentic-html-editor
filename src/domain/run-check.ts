/*
 * read-when: The helper refuses a free-writing event, or changing what a run record may hold.
 */

import type { FailureCode } from "../contract/failures.ts";

export type RunRefusalCode = Extract<
  FailureCode,
  "RUN_BLOCK_REFUSED" | "RUN_OVER_CEILING" | "RUN_PLACEMENT_REFUSED" | "RUN_TAKEBACK_CARRIES_RUN"
>;
export interface RunRefusal {
  readonly code: RunRefusalCode;
  readonly reason: string;
}

export function validateRun(value: unknown): RunRefusal | null {
  throw new Error("C3: not built yet " + typeof value);
}
