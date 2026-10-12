// A helper a test spawns never binds the real pages port 1483, even when the
// test file is run on its own, outside `npm run gate:unit` (which sets
// LAHE_PAGES_PORT=0 for the whole run).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { spawnEnv } = require("../helpers/spawned.js");

test("a spawned helper gets LAHE_PAGES_PORT=0 unless the run or the test names a port", () => {
  assert.equal(spawnEnv({}, {}).LAHE_PAGES_PORT, "0");
  assert.equal(spawnEnv({ LAHE_PAGES_PORT: "41234" }, {}).LAHE_PAGES_PORT, "41234");
  assert.equal(spawnEnv({}, { LAHE_PAGES_PORT: "41235" }).LAHE_PAGES_PORT, "41235");
  assert.equal(spawnEnv({ PATH: "/bin" }, { X: "1" }).X, "1");
  assert.equal(spawnEnv({ PATH: "/bin" }, {}).PATH, "/bin");
});
