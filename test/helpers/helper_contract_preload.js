// Preloaded into a `lahe` CLI process (node --require) by
// test/unit/helper_contract_cli.test.js.
//
// The CLI reads the running helper's service_contract from its health answer.
// To test what the CLI DOES about an older or newer helper without keeping a
// second checkout of the tool around, this makes the health probe report the
// contract as one behind (or ahead) of the CLI's own SERVICE_CONTRACT. The
// process identity checks, the verdict and the restart itself are all real.
//
// LAHE_TEST_HELPER_CONTRACT_SKEW is -1 (older) or 1 (newer).

"use strict";

const path = require("node:path");

const protocol = require(path.join(__dirname, "..", "..", "src", "shared", "protocol.js"));
const service = require(path.join(__dirname, "..", "..", "src", "service", "index.js"));
const skew = Number(process.env.LAHE_TEST_HELPER_CONTRACT_SKEW || 0);
const real = service.probeHealth;

service.probeHealth = async function (host, port) {
  const health = await real(host, port);
  return health ? Object.assign({}, health, { service_contract: protocol.SERVICE_CONTRACT + skew }) : health;
};
