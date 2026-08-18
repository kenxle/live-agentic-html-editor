// One import point for the shared kernel.
//
// Owner: 0A-kernel. Node-side convenience only: it re-exports the modules that
// carry the actual contracts, so service and CLI code can write
//
//   const { record, lifecycle, normalize } = require("../shared/contracts.js");
//
// The layer does NOT use this file. In the browser every module registers
// itself on the global namespace during concatenation, and this barrel is not
// in the bundle. See src/shared/manifest.js.
//
// Nothing is DEFINED here. If a shape or a constant lives in this file, it has
// two homes and one of them is wrong.
//
// cli_contract.js is deliberately absent: the blocking next-and-ack exit-code
// contract is the dead send model, and it is on the Phase 4B cleanup batch.

"use strict";

module.exports = {
  markers: require("./markers.js"),
  normalize: require("./normalize.js"),
  failures: require("./failures.js"),
  record: require("./record.js"),
  lifecycle: require("./lifecycle.js"),
  merge: require("./merge.js"),
  regions: require("./regions.js"),
  uniqueness: require("./uniqueness.js"),
  gestures: require("./gestures.js"),
  epoch: require("./epoch.js"),
  elapsed: require("./elapsed.js"),
  protocol: require("./protocol.js"),
  review_format: require("./review_format.js"),
  record_fixtures: require("./record_fixtures.js"),
  manifest: require("./manifest.js")
};
