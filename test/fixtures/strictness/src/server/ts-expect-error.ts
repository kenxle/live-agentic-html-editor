/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export function count(): number {
  // @ts-expect-error the string is the point of this fixture
  return "three";
}
