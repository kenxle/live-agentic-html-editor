/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

import { readFileSync } from "node:fs";
import { label, parseState } from "../contract/clean-module.ts";
import type { State } from "../contract/clean-module.ts";

export function stateOfFile(file: string): State | null {
  return parseState(readFileSync(file, "utf8").trim());
}

export function labelOfFile(file: string): string {
  const state = stateOfFile(file);
  return state === null ? "Unknown" : label(state);
}
