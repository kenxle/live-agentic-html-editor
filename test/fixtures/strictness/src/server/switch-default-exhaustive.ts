/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export type Light = "red" | "green";

export function go(light: Light): boolean {
  switch (light) {
    case "red":
      return false;
    case "green":
      return true;
    default:
      return false;
  }
}
