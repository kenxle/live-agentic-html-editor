// The helper proves each address option works before it is used
// (src/service/addresses.js).
//
//   V55  The name server starts only when install.json records the resolver.
//   V57  `.lahe` counts as working only once our own name server saw a fresh
//        random query that the test sent through "the system resolver".
//   V58  Another program answering `.lahe` fails that proof.
//   V76  Addresses print with the pages port until the helper sees its own
//        random request arrive through the forward, and again once the forward
//        is gone.
//
// The system resolver is a stub the test passes in, and "port 80" is a free
// port with a small TCP relay standing in for the pf forward. Nothing here
// runs sudo, writes /etc/resolver, or loads a pf rule. Every server and relay
// is closed in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const http = require("node:http");
const net = require("node:net");

const addressesModule = require("../../src/service/addresses.js");
const nameServer = require("../../src/service/name_server.js");
const { freePort } = require("../helpers/free_port.js");

function freeUdpPort() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    socket.bind(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

/** A DNS A query for one name. */
function query(name) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(7, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  const parts = [header];
  name.split(".").forEach((label) => parts.push(Buffer.from([label.length]), Buffer.from(label)));
  parts.push(Buffer.from([0, 0, 1, 0, 1]));
  return Buffer.concat(parts);
}

/** A stand-in system resolver that sends the lookup to a name server on this port. */
function resolverTo(port, rename) {
  return (name) => new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("message", () => {
      socket.close();
      resolve({ address: "127.0.0.1", family: 4 });
    });
    socket.send(query(rename ? rename(name) : name), port, "127.0.0.1", (err) => { if (err) reject(err); });
  });
}

function installed(extra) {
  return Object.assign({ system: "macos", label: "lahe-test", port: 1, lahe_names: false, port_80: false }, extra || {});
}

async function pagesServer(t) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return server;
}

/** A TCP relay from a free port to the pages port: the pf forward, played by the test. */
async function relay(t, toPort) {
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(toPort, "127.0.0.1");
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);
    const end = () => { client.destroy(); upstream.destroy(); };
    client.on("error", end);
    upstream.on("error", end);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = () => new Promise((resolve) => {
    sockets.forEach((s) => s.destroy());
    server.close(() => resolve());
  });
  t.after(close);
  return { port: server.address().port, close };
}

// --- V55 -------------------------------------------------------------------

test("V55: with no resolver recorded, no name server starts and .lahe is off", async (t) => {
  const udp = await freeUdpPort();
  const a = addressesModule.createAddresses({ installed: installed({ name_server_port: udp }), pagesPort: 1483, pagesServers: [] });
  t.after(() => a.close());
  await a.start();
  assert.equal(a.nameServerPort(), null);
  assert.deepEqual(a.report().lahe_names, { on: false, verified: false, reason: "not set up" });

  const none = addressesModule.createAddresses({ installed: null, pagesPort: 1483, pagesServers: [] });
  t.after(() => none.close());
  await none.start();
  assert.equal(none.nameServerPort(), null);
});

test("V55: with the resolver recorded, the name server answers on the recorded port", async (t) => {
  const udp = await freeUdpPort();
  const a = addressesModule.createAddresses({
    installed: installed({ lahe_names: true, resolver: "/etc/resolver/lahe", name_server_port: udp }),
    pagesPort: 1483,
    pagesServers: [],
    lookup: resolverTo(udp)
  });
  t.after(() => a.close());
  await a.start();
  assert.equal(a.nameServerPort(), udp);
});

// --- V57, V58 ----------------------------------------------------------------

test("V57: .lahe is refused until our own name server sees the fresh random query", async (t) => {
  const udp = await freeUdpPort();
  const asked = [];
  const lookup = (name) => { asked.push(name); return resolverTo(udp)(name); };
  const a = addressesModule.createAddresses({
    installed: installed({ lahe_names: true, resolver: "/etc/resolver/lahe", name_server_port: udp }),
    pagesPort: 1483,
    pagesServers: [],
    lookup,
    intervalMs: 0
  });
  t.after(() => a.close());
  assert.equal(a.laheNamesVerified(), false, "before any proof");
  await a.start();
  assert.equal(a.laheNamesVerified(), true);
  assert.deepEqual(a.report().lahe_names, { on: true, verified: true, reason: null });
  await a.verifyNow();
  assert.equal(asked.length, 2);
  assert.notEqual(asked[0], asked[1], "each proof asks a fresh name");
  assert.ok(asked.every((name) => nameServer.isLaheName(name)));
});

test("V57: a query for some other name does not count as the proof", async (t) => {
  const udp = await freeUdpPort();
  const a = addressesModule.createAddresses({
    installed: installed({ lahe_names: true, resolver: "/etc/resolver/lahe", name_server_port: udp }),
    pagesPort: 1483,
    pagesServers: [],
    lookup: resolverTo(udp, () => "someone-else.lahe")
  });
  t.after(() => a.close());
  await a.start();
  assert.equal(a.laheNamesVerified(), false);
});

test("V58: another program answering .lahe fails the proof, and the reason says so", async (t) => {
  const udp = await freeUdpPort();
  const a = addressesModule.createAddresses({
    installed: installed({ lahe_names: true, resolver: "/etc/resolver/lahe", name_server_port: udp }),
    pagesPort: 1483,
    pagesServers: [],
    lookup: async () => ({ address: "127.0.0.1", family: 4 })
  });
  t.after(() => a.close());
  await a.start();
  assert.equal(a.laheNamesVerified(), false);
  assert.match(a.report().lahe_names.reason, /another program answers \.lahe lookups/);
});

test("V58: when the system does not send .lahe to Lahe, the reason says that instead", async (t) => {
  const udp = await freeUdpPort();
  const a = addressesModule.createAddresses({
    installed: installed({ lahe_names: true, resolver: "/etc/resolver/lahe", name_server_port: udp }),
    pagesPort: 1483,
    pagesServers: [],
    lookup: async () => { const e = new Error("getaddrinfo ENOTFOUND"); e.code = "ENOTFOUND"; throw e; }
  });
  t.after(() => a.close());
  await a.start();
  assert.equal(a.laheNamesVerified(), false);
  assert.match(a.report().lahe_names.reason, /this computer does not send \.lahe lookups to Lahe/);
});

test("V58: a name server port another program holds turns .lahe off with a reason", async (t) => {
  const squatter = dgram.createSocket("udp4");
  await new Promise((resolve) => squatter.bind(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => squatter.close(resolve)));
  const udp = squatter.address().port;
  const a = addressesModule.createAddresses({
    installed: installed({ lahe_names: true, resolver: "/etc/resolver/lahe", name_server_port: udp }),
    pagesPort: 1483,
    pagesServers: [],
    lookup: resolverTo(udp)
  });
  t.after(() => a.close());
  await a.start();
  assert.equal(a.laheNamesVerified(), false);
  assert.match(a.report().lahe_names.reason, new RegExp("could not answer on port " + udp));
});

// --- V76 -------------------------------------------------------------------

test("V76: addresses print with the pages port until the forward is proved, and again once it is gone", async (t) => {
  const pages = await pagesServer(t);
  const pagesPort = pages.address().port;
  const forward = await relay(t, pagesPort);
  const changes = [];
  const a = addressesModule.createAddresses({
    installed: installed({ port_80: true, forward_rule: "/etc/pf.anchors/lahe" }),
    pagesPort,
    pagesServers: [pages],
    forwardPort: forward.port,
    onChange: (report) => changes.push(report.port_free.verified)
  });
  t.after(() => a.close());
  assert.equal(a.printedPort(), pagesPort, "nothing proved yet");
  await a.start();
  assert.equal(a.report().port_free.verified, true);
  assert.equal(a.printedPort(), 80);

  await forward.close();
  await a.verifyNow();
  assert.equal(a.report().port_free.verified, false);
  assert.equal(a.printedPort(), pagesPort);
  assert.match(a.report().port_free.reason, /port 80 does not reach/);
  assert.deepEqual(changes, [true, false]);
});

test("V76: another server answering on port 80 is not the forward", async (t) => {
  const pages = await pagesServer(t);
  const squatter = await pagesServer(t);
  const a = addressesModule.createAddresses({
    installed: installed({ port_80: true, forward_rule: "/etc/pf.anchors/lahe" }),
    pagesPort: pages.address().port,
    pagesServers: [pages],
    forwardPort: squatter.address().port
  });
  t.after(() => a.close());
  await a.start();
  assert.equal(a.report().port_free.verified, false);
  assert.equal(a.printedPort(), pages.address().port);
});

test("V76: with the forward not installed, nothing is tried and the reason install gave is kept", async (t) => {
  const pages = await pagesServer(t);
  const a = addressesModule.createAddresses({
    installed: installed({ port_80: false, port_80_reason: "port 80 is held by httpd (pid 412)" }),
    pagesPort: pages.address().port,
    pagesServers: [pages],
    forwardPort: await freePort()
  });
  t.after(() => a.close());
  await a.start();
  assert.deepEqual(a.report().port_free, { on: false, verified: false, reason: "port 80 is held by httpd (pid 412)" });
});

test("printedOrigin: port-free only when proved; the ending is always .lahe.localhost", () => {
  assert.equal(addressesModule.printedOrigin("docs.ongoing", 1483, { port_free: { verified: false } }), "http://docs.ongoing.lahe.localhost:1483");
  assert.equal(addressesModule.printedOrigin("docs.ongoing", 1483, { port_free: { verified: true } }), "http://docs.ongoing.lahe.localhost");
});

// --- in the helper -------------------------------------------------------------

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const stateDir = require("../../src/service/state_dir.js");
const loginItem = require("../../src/service/login_item.js");
const { pollUntil } = require("../helpers/poll.js");

function tempState() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-addresses-")));
  const dir = path.join(root, "state");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pagesBlock(dir) {
  return JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8")).pages;
}

test("V55, V57 in the helper: the name server starts from install.json, and service.json says .lahe is proved", async (t) => {
  const dir = tempState();
  const port = await freePort();
  const udp = await freeUdpPort();
  loginItem.writeInstall(dir, installed({ port, lahe_names: true, resolver: "/etc/resolver/lahe", name_server_port: udp }));
  const helper = await service.serve({
    port, stateDir: dir, quiet: true, alwaysOn: true, pages: protocol.PAGES.SWITCH_ON, pagesPort: 0,
    addresses: { lookup: resolverTo(udp), intervalMs: 0 }
  });
  t.after(() => helper.close());
  assert.equal(helper.addresses().nameServerPort(), udp);
  // The check runs after the helper is ready, and rewrites service.json when
  // it lands.
  await pollUntil(() => pagesBlock(dir).lahe_names.verified === true, { timeoutMs: 5000, message: ".lahe to be proved" });
  assert.deepEqual(pagesBlock(dir).lahe_names, { on: true, verified: true, reason: null });
  assert.match(fs.readFileSync(stateDir.helperLogPath(dir), "utf8"), /\.lahe names: verified/);
});

test("V76 in the helper: service.json prints port 80 once the forward is proved, and the pages port once it is gone", async (t) => {
  const dir = tempState();
  const port = await freePort();
  const pagesPort = await freePort();
  const forward = await relay(t, pagesPort);
  loginItem.writeInstall(dir, installed({ port, port_80: true, forward_rule: "/etc/pf.anchors/lahe" }));
  const helper = await service.serve({
    port, stateDir: dir, quiet: true, alwaysOn: true, pages: protocol.PAGES.SWITCH_ON, pagesPort,
    addresses: { forwardPort: forward.port, intervalMs: 0 }
  });
  t.after(() => helper.close());
  await pollUntil(() => pagesBlock(dir).printed_port === 80, { timeoutMs: 5000, message: "the forward to be proved" });
  assert.equal(pagesBlock(dir).port_free.verified, true);
  await forward.close();
  await helper.addresses().verifyNow();
  assert.equal(pagesBlock(dir).printed_port, pagesPort, "service.json is rewritten when the proof changes");
  assert.equal(pagesBlock(dir).port_free.verified, false);
});

test("a helper with no install prints the pages port and has both options off", async (t) => {
  const dir = tempState();
  const port = await freePort();
  const helper = await service.serve({ port, stateDir: dir, quiet: true, pages: protocol.PAGES.SWITCH_ON, pagesPort: 0 });
  t.after(() => helper.close());
  const pages = pagesBlock(dir);
  assert.equal(pages.printed_port, helper.pagesPort);
  assert.deepEqual(pages.port_free, { on: false, verified: false, reason: "not set up" });
  assert.deepEqual(pages.lahe_names, { on: false, verified: false, reason: "not set up" });
});

// The helper is ready, and says so in service.json, before a slow address
// check finishes. A CLI that waits for /health and then reads service.json (to
// stop the helper by its pid, say) must never find /health up with no
// service.json: under load, `lahe install` did, and refused its own helper as
// "not this state folder's helper".
test("service.json is written as soon as the helper answers, before a slow .lahe check finishes", async (t) => {
  const dir = tempState();
  const port = await freePort();
  const udp = await freeUdpPort();
  loginItem.writeInstall(dir, installed({ port, lahe_names: true, resolver: "/etc/resolver/lahe", name_server_port: udp }));
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  // The system resolver, slow: it answers only when the test lets it.
  const lookup = (name) => held.then(() => resolverTo(udp)(name));
  const starting = service.serve({
    port, stateDir: dir, quiet: true, alwaysOn: true, pages: protocol.PAGES.SWITCH_ON, pagesPort: 0,
    addresses: { lookup, intervalMs: 0 }
  });
  t.after(async () => { release(); (await starting).close(); });
  await pollUntil(() => fs.existsSync(stateDir.readyPath(dir)), {
    timeoutMs: 2000,
    message: "service.json while the .lahe check is still waiting on the resolver"
  });
  assert.equal(pagesBlock(dir).lahe_names.verified, false, "not proved yet");
  const helper = await starting;
  assert.equal(helper.addresses().nameServerPort(), udp, "the name server is already up");
  release();
  await pollUntil(() => pagesBlock(dir).lahe_names.verified === true, {
    timeoutMs: 5000,
    message: "service.json to say .lahe is proved once the check finishes"
  });
});

test("the test seams take only a port, and a name server on 127.0.0.1", async (t) => {
  assert.deepEqual(addressesModule.envSeams({}), {});
  assert.equal(addressesModule.envSeams({ LAHE_FORWARD_CHECK_PORT: "5123" }).forwardPort, 5123);
  assert.equal(addressesModule.envSeams({ LAHE_FORWARD_CHECK_PORT: "80; rm" }).forwardPort, undefined);
  assert.equal(addressesModule.envSeams({ LAHE_NAME_CHECK_SERVER: "8.8.8.8:53" }).lookup, undefined);
  // The direct lookup reaches a name server the test owns.
  const seen = [];
  const server = nameServer.createNameServer({ port: 0, onQuery: (name) => seen.push(name) });
  await server.start();
  t.after(() => server.close());
  const { lookup } = addressesModule.envSeams({ LAHE_NAME_CHECK_SERVER: "127.0.0.1:" + server.port() });
  assert.deepEqual(await lookup("check-1.lahe"), { address: "127.0.0.1", family: 4 });
  assert.deepEqual(seen, ["check-1.lahe"]);
});
