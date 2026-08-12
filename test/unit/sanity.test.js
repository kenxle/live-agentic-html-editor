// Trivial passing unit test. Proves the unit test harness (node:test, Node's
// built-in test runner) is wired up. Replace/extend once real modules land.

const test = require("node:test");
const assert = require("node:assert/strict");
const contracts = require("../../src/shared/contracts.js");

test("the shared contracts module loads and exports an object", () => {
  assert.equal(typeof contracts, "object");
});

test("sanity: arithmetic works", () => {
  assert.equal(1 + 1, 2);
});
