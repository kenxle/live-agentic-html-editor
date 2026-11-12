/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export function size(text: string): number {
  const parsed = JSON.parse(text);
  return parsed.length;
}
