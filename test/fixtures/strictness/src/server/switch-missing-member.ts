/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

export type Shape = "circle" | "square" | "triangle";

export function sides(shape: Shape): number {
  switch (shape) {
    case "circle":
      return 0;
    case "square":
      return 4;
    default:
      return 3;
  }
}
