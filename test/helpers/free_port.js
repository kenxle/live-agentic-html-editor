// A free loopback port for a helper a test starts on its own port, and one
// retry when something else took it first.
//
// freePort() binds port 0, reads the port the OS gave, and closes it. Between
// that close and the helper's own bind, another test running in parallel can
// take the same port. That is a race in the harness, not a product bug, so a
// start that fails while the port is held by someone else is tried once more on
// a new port. A start that fails with the port still free is a real failure
// and is thrown as it is.

"use strict";

const net = require("node:net");
const protocol = require("../../src/shared/protocol.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/** Is something listening on this loopback port now? True on EADDRINUSE. */
function portInUse(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") resolve(true);
      else reject(err);
    });
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(false)));
  });
}

/**
 * Run `start(port)` on a free port. If it fails and the port turns out to be
 * held (EADDRINUSE on a bind), run it once more on a new free port.
 *
 * `start` throws, or returns a result that `failed(result)` calls a failure.
 *
 * @returns {Promise<{port: number, result: *}>}
 */
async function onFreePort(start, failed) {
  const isFailure = typeof failed === "function" ? failed : () => false;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const port = await freePort();
    if (port === protocol.DEFAULT_PORT) throw new Error("the free port came back as the product's own port");
    let result;
    try {
      result = await start(port);
      if (!isFailure(result)) return { port, result };
      lastError = new Error("start on port " + port + " failed: " + JSON.stringify(result));
    } catch (err) {
      lastError = err;
    }
    if (!(await portInUse(port))) break;
  }
  throw lastError;
}

module.exports = { freePort, portInUse, onFreePort };
