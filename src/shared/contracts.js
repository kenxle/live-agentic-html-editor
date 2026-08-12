// One import point for the shared kernel.
//
// Owner: Task 0a. Node-side convenience only: it re-exports the modules that
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

"use strict";

module.exports = {
  markers: require("./markers.js"),
  normalize: require("./normalize.js"),
  failures: require("./failures.js"),
  record: require("./record.js"),
  lifecycle: require("./lifecycle.js"),
  regions: require("./regions.js"),
  uniqueness: require("./uniqueness.js"),
  gestures: require("./gestures.js"),
  epoch: require("./epoch.js"),
  protocol: require("./protocol.js"),
  review_format: require("./review_format.js"),
  cli_contract: require("./cli_contract.js"),
  manifest: require("./manifest.js")
};
