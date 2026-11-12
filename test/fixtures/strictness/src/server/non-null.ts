/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export function first(values: readonly string[]): string {
  return values[0]!;
}
