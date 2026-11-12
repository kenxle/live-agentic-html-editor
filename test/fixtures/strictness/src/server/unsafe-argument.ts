/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

function double(value: number): number {
  return value * 2;
}

export function doubled(text: string): number {
  return double(JSON.parse(text));
}
