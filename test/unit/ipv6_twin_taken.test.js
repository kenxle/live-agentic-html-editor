// The helper listens on 127.0.0.1 and on [::1] for each port. When [::1] could
// not bind because another program held it, the helper went on serving on
// 127.0.0.1 alone, and a browser that tries ::1 first would load that other
// program at a Lahe address. A taken [::1] twin now stops the start. A machine
// with no IPv6 loopback (EADDRNOTAVAIL, EAFNOSUPPORT) still serves on
// 127.0.0.1, as before.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const service = require("../../src/service/index.js");
const { tempRoot } = require("../helpers/sites_world.js");

/** A server holding [::1] on a port whose 127.0.0.1 side is free, or null. */
async function holdIpv6Only() {
  for (let tries = 0; tries < 20; tries++) {
    const squatter = net.createServer();
    const ok = await new Promise((resolve) => {
      squatter.once("error", () => resolve(false));
      squatter.listen({ port: 0, host: "::1", ipv6Only: true }, () => resolve(true));
    });
    if (!ok) return null;
    const port = squatter.address().port;
    const probe = net.createServer();
    const free = await new Promise((resolve) => {
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return { squatter, port };
    await new Promise((resolve) => squatter.close(resolve));
  }
  return null;
}

function stateDir() {
  const dir = path.join(tempRoot("lahe-ipv6-twin-"), "state");
  fs.mkdirSync(dir);
  return dir;
}

test("a taken [::1] pages port stops the helper from starting", async (t) => {
  const held = await holdIpv6Only();
  if (!held) return t.skip("no IPv6 loopback here");
  t.after(() => new Promise((resolve) => held.squatter.close(resolve)));
  let helper = null;
  t.after(() => helper && helper.close());
  await assert.rejects(async () => {
    helper = await service.serve({ port: 0, pagesPort: held.port, stateDir: stateDir(), quiet: true });
  }, /\[::1\]:\d+.*taken/);
});

test("a taken [::1] API port stops the helper from starting", async (t) => {
  const held = await holdIpv6Only();
  if (!held) return t.skip("no IPv6 loopback here");
  t.after(() => new Promise((resolve) => held.squatter.close(resolve)));
  let helper = null;
  t.after(() => helper && helper.close());
  await assert.rejects(async () => {
    helper = await service.serve({ port: held.port, pagesPort: 0, stateDir: stateDir(), quiet: true });
  }, /\[::1\]:\d+.*taken/);
});
