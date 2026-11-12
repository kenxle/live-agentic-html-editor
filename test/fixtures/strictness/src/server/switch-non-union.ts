/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export function label(count: number): string {
  switch (count) {
    case 0:
      return "none";
    case 1:
      return "one";
  }
  return "many";
}
