// reviews.removeOrigin, carried over from the retired static_restart.test.js
// (stable addresses Step 3). It stays because site.bind drops a review's old
// 127.0.0.1:<port> origins through it (V25), and only plain loopback http
// origins may ever be removed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const stateDirModule = require("../../src/service/state_dir.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("an origin removed and then registered again is held after a rebuild from the log", () => {
  const state = path.join(tempDir("lahe-restart-order-"), "state");
  const reviews = reviewsModule.createReviews({ dir: state, log: logModule.createEventLog({ dir: state }) });
  reviews.create({ id: "r_order", origins: ["http://127.0.0.1:40001"] });
  reviews.removeOrigin("r_order", "http://127.0.0.1:40001");
  assert.ok(!reviews.get("r_order").origins.includes("http://127.0.0.1:40001"));
  reviews.registerOrigin("r_order", "http://127.0.0.1:40001");
  fs.unlinkSync(stateDirModule.metaPath(state, "r_order"));
  const recovered = reviewsModule.createReviews({ dir: state, log: logModule.createEventLog({ dir: state }) });
  recovered.loadFromDisk();
  assert.deepEqual(recovered.get("r_order").origins, ["http://127.0.0.1:40001"]);
});

test("removeOrigin refuses anything but a plain loopback http origin", () => {
  const state = path.join(tempDir("lahe-restart-guard-"), "state");
  const reviews = reviewsModule.createReviews({ dir: state, log: logModule.createEventLog({ dir: state }) });
  const held = ["http://localhost:3000", "https://docs.example.test", "null", "https://localhost:4443"];
  reviews.create({ id: "r_guard", origins: held });
  ["https://docs.example.test", "null", "https://localhost:4443"].forEach((origin) => {
    assert.throws(() => reviews.removeOrigin("r_guard", origin), /loopback/);
  });
  assert.deepEqual(reviews.get("r_guard").origins, held);
});

// site.bind and the Library's Open both stamp a review as served by the helper
// and drop its old page-server origins. One function does both now, with the
// one spelling of "an old page-server origin" (protocol.isLoopbackPortOrigin).
test("stampServedByHelper stamps the review and drops only its old page-server origins", () => {
  const state = path.join(tempDir("lahe-served-by-helper-"), "state");
  const reviews = reviewsModule.createReviews({ dir: state, log: logModule.createEventLog({ dir: state }) });
  reviews.create({ id: "r_served", origins: ["http://127.0.0.1:40001", "http://localhost:40002", "null", "https://localhost:4443", "http://localhost:3000"] });
  const review = reviews.stampServedByHelper("r_served", "2026-10-11T12:00:00.000Z");
  assert.equal(review.served_at, "2026-10-11T12:00:00.000Z");
  assert.deepEqual(reviews.get("r_served").origins, ["null", "https://localhost:4443"]);
});
