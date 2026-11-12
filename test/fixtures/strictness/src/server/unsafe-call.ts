/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export function run(text: string): void {
  JSON.parse(text)();
}
