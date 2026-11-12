/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export let counter: number = 0;

export function bump(): void {
  counter += 1;
}
