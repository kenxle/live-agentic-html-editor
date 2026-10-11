// When the pages port was taken, `lahe serve` said the API port was taken,
// which sent the reader after the wrong port. It now names the pages port.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { execFile } = require("node:child_process");

const { tempRoot } = require("../helpers/sites_world.js");
const { freePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");

test("lahe serve names the pages port when the pages port is the one taken", async (t) => {
  const dir = path.join(tempRoot("lahe-pages-taken-"), "state");
  fs.mkdirSync(dir);
  t.after(() => stopTempHelpers(dir));
  const squatter = net.createServer();
  await new Promise((resolve) => squatter.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => squatter.close(resolve)));
  const pagesPort = squatter.address().port;
  const apiPort = await freePort();
  const env = Object.assign({}, process.env, { LAHE_PAGES_PORT: String(pagesPort) });
  const out = await new Promise((resolve) => {
    execFile(process.execPath, [BIN, "serve", "--port", String(apiPort), "--state-dir", dir], { env, encoding: "utf8", timeout: 20000 },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  assert.equal(out.code, 1);
  assert.match(out.stderr, new RegExp("pages port " + pagesPort + " is taken"));
  assert.doesNotMatch(out.stderr + out.stdout, new RegExp("port " + apiPort + " is taken"));
  assert.doesNotMatch(out.stdout, /already answering/);
});
