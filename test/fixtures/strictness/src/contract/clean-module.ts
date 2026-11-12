/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export const STATES = ["open", "done"] as const;

export type State = (typeof STATES)[number];

export interface Item {
  readonly id: string;
  readonly state: State;
  readonly note?: string;
}

export function label(state: State): string {
  switch (state) {
    case "open":
      return "Open";
    case "done":
      return "Done";
  }
}

export function parseState(value: unknown): State | null {
  return value === "open" || value === "done" ? value : null;
}
