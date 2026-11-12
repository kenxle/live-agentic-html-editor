/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export function first(text: string): unknown {
  const parsed: unknown = JSON.parse(text).items;
  return parsed;
}
