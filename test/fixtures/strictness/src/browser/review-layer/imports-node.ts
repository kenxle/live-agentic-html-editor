/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

import { readFileSync } from "node:fs";

export function read(file: string): string {
  return readFileSync(file, "utf8");
}
