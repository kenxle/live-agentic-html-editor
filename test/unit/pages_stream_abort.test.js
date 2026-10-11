// An aborted transfer of a large file left the file open: the read stream was
// piped with .pipe(), which does not close the source when the response
// closes early. It is now piped with stream.pipeline, which does.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { sitesWorld, writeFile } = require("../helpers/sites_world.js");

test("an aborted download closes the file it was reading", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "docs");
  writeFile(folder, "page.html", "<p>x</p>");
  const big = path.join(folder, "big.bin");
  fs.writeFileSync(big, Buffer.alloc(32 * 1024 * 1024, 7));
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "page.html" });

  const opened = [];
  const real = fs.createReadStream;
  fs.createReadStream = function (file) {
    const s = real.apply(fs, arguments);
    if (String(file) === big || /big\.bin$/.test(String(file))) opened.push(s);
    return s;
  };
  t.after(() => { fs.createReadStream = real; });

  await new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: w.helper.pagesPort, path: "/big.bin", headers: { host: bound.name + ".lahe.localhost:" + w.helper.pagesPort } }, (res) => {
      res.once("data", () => { req.destroy(); resolve(); });
    });
    req.on("error", () => resolve());
  });
  assert.equal(opened.length, 1);
  const stream = opened[0];
  const deadline = Date.now() + 5000;
  while (!stream.destroyed && Date.now() < deadline) await new Promise((r) => setImmediate(r));
  assert.equal(stream.destroyed, true, "the read stream is closed after the client went away");
});
