/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export function later(): void {
  Promise.resolve(1);
}
