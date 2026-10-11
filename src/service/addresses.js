// Which address options the helper may use right now, proved, not assumed.
//
// Owner: stable addresses, lahe-names workstream. Two options exist, each set
// up by `lahe install` on macOS and recorded in install.json:
//
//   port_80     a loopback forward from port 80 to the pages port, so an
//               address prints without `:1483`.
//   lahe_names  /etc/resolver/lahe, so `<name>.lahe` reaches this computer
//               and the helper's own name server (src/service/name_server.js).
//
// NEITHER IS TRUSTED BECAUSE A FILE SAYS SO. At start and every five minutes:
//
//   - the forward: the helper sends itself a request through port 80 with a
//     fresh random path, and counts it only when that request arrives on its
//     own pages listener. Until then, and again once it stops arriving,
//     addresses print with the pages port.
//   - `.lahe`: the helper asks the system resolver for a fresh random name
//     under `.lahe`, and counts it only when its own name server saw that exact
//     query. Another program answering `.lahe` (a squatter on the port, a
//     different resolver) fails. Until then, `.lahe` Hosts are refused.
//
// The printed ending is always `.lahe.localhost`; `.lahe` is an alias a person
// may type. Only the port changes.
//
// Node-only. Timers are unref'd, so they never hold the helper open.

"use strict";

var crypto = require("node:crypto");
var dgram = require("node:dgram");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var dns = require("node:dns");
var http = require("node:http");

var protocol = require("../shared/protocol.js");
var nameServerModule = require("./name_server.js");

var CHECK_EVERY_MS = 5 * 60 * 1000;
var CHECK_TIMEOUT_MS = 3000;
var FORWARD_PATH = "/.lahe-forward-check/";
var NOT_SET_UP = "not set up";

/**
 * Test seams, for a helper a test starts as its own process, honored only when
 * its state folder is under the temp folder. Unit tests never
 * send a request to the real port 80 or ask the system resolver about `.lahe`:
 *
 *   LAHE_FORWARD_CHECK_PORT  the port the forward check sends to, in place of 80
 *   LAHE_NAME_CHECK_SERVER   127.0.0.1:<port>: ask that name server directly,
 *                            in place of the system resolver
 */
function envSeams(env, stateDir) {
  var out = { ignored: [] };
  var wanted = {};
  var forward = Number(env.LAHE_FORWARD_CHECK_PORT);
  if (Number.isInteger(forward) && forward > 0 && forward < 65536) wanted.forwardPort = forward;
  var direct = /^127\.0\.0\.1:(\d{1,5})$/.exec(String(env.LAHE_NAME_CHECK_SERVER || ""));
  if (direct) wanted.lookup = directLookup(Number(direct[1]));
  // Only a test's helper: one whose state folder is under the temp folder. A
  // real helper ignores them, because a check that passes without the system
  // routing .lahe to Lahe reopens DNS rebinding (security review S6).
  var testHelper = underTemp(stateDir);
  if (wanted.forwardPort !== undefined) {
    if (testHelper) out.forwardPort = wanted.forwardPort;
    else out.ignored.push("LAHE_FORWARD_CHECK_PORT");
  }
  if (wanted.lookup) {
    if (testHelper) out.lookup = wanted.lookup;
    else out.ignored.push("LAHE_NAME_CHECK_SERVER");
  }
  return out;
}

function realOrSame(p) {
  try { return fs.realpathSync(p); } catch (err) { return path.resolve(p); }
}

/** Is this folder inside the operating system's temp folder? */
function underTemp(dir) {
  if (typeof dir !== "string" || !dir) return false;
  var real = realOrSame(dir);
  return [os.tmpdir(), realOrSame(os.tmpdir())].some(function (root) {
    var base = root.replace(/[\\/]+$/, "");
    return real.indexOf(base + path.sep) === 0;
  });
}

/** A lookup that sends one A query straight to a name server on 127.0.0.1. */
function directLookup(port) {
  return function (name) {
    return new Promise(function (resolve, reject) {
      var labels = String(name).split(".");
      var header = Buffer.alloc(12);
      header.writeUInt16BE(crypto.randomBytes(2).readUInt16BE(0), 0);
      header.writeUInt16BE(0x0100, 2);
      header.writeUInt16BE(1, 4);
      var parts = [header];
      labels.forEach(function (label) { parts.push(Buffer.from([label.length]), Buffer.from(label, "latin1")); });
      parts.push(Buffer.from([0, 0, 1, 0, 1]));
      var socket = dgram.createSocket("udp4");
      var timer = setTimeout(function () { finish(new Error("no answer from 127.0.0.1:" + port)); }, CHECK_TIMEOUT_MS);
      function finish(err) {
        clearTimeout(timer);
        try { socket.close(); } catch (e) { /* already closed */ }
        if (err) reject(err);
        else resolve({ address: "127.0.0.1", family: 4 });
      }
      socket.once("error", finish);
      socket.once("message", function () { finish(null); });
      socket.send(Buffer.concat(parts), port, "127.0.0.1");
    });
  };
}

/** The origin `lahe review` prints for a site, given the helper's report. */
function printedOrigin(name, pagesPort, report) {
  var free = !!(report && report.port_free && report.port_free.verified);
  return protocol.siteOrigin(name, free ? 80 : pagesPort);
}

function fresh() {
  return crypto.randomBytes(8).toString("hex");
}

function withTimeout(promise, ms) {
  var timer;
  return Promise.race([
    promise,
    new Promise(function (resolve, reject) {
      timer = setTimeout(function () { reject(new Error("no answer within " + ms + "ms")); }, ms);
    })
  ]).finally(function () { clearTimeout(timer); });
}

/**
 * @param {{installed: object|null, pagesPort: number|null, pagesServers: Array,
 *          forwardPort?: number, lookup?: function(string): Promise<{address: string}>,
 *          intervalMs?: number, log?: function(string): void,
 *          onChange?: function(object): void}} options
 *   `forwardPort` and `lookup` are 80 and the system resolver; tests pass stand-ins.
 *   `intervalMs` 0 means check only when asked.
 */
function createAddresses(options) {
  var opts = options || {};
  var installed = opts.installed || {};
  var forwardOn = installed.port_80 === true;
  var namesOn = installed.lahe_names === true && !!installed.resolver;
  var seams = envSeams(process.env, opts.stateDir);
  var forwardPort = typeof opts.forwardPort === "number" ? opts.forwardPort : seams.forwardPort || 80;
  var lookup = opts.lookup || seams.lookup || function (name) { return dns.promises.lookup(name, { family: 4 }); };
  var intervalMs = typeof opts.intervalMs === "number" ? opts.intervalMs : CHECK_EVERY_MS;

  var state = {
    port_free: { on: forwardOn, verified: false, reason: forwardOn ? "not checked yet" : installed.port_80_reason || NOT_SET_UP },
    lahe_names: { on: namesOn, verified: false, reason: namesOn ? "not checked yet" : NOT_SET_UP }
  };
  var server = null;
  var serverError = null;
  // The one value each check waits for, set just before it sends and cleared
  // after. An arrival counts only when it equals that value; nothing else
  // anyone sends is kept, so the helper's memory does not grow with traffic.
  var expectedPath = null;
  var pathArrived = false;
  var expectedName = null;
  var nameArrived = false;
  var timer = null;
  var watched = [];
  var closed = false;

  function say(line) {
    if (typeof opts.log === "function") {
      try { opts.log(line); } catch (err) { /* keep going */ }
    }
  }  if (seams.ignored.length) {
    say("ignoring " + seams.ignored.join(" and ") + ": test settings, honored only for a state folder under the temp folder");
  }


  function set(key, verified, reason) {
    var before = state[key];
    if (before.verified === verified && before.reason === reason) return false;
    state[key] = { on: before.on, verified: verified, reason: reason };
    say((key === "port_free" ? "port-free addresses: " : ".lahe names: ") + (verified ? "verified" : "off, " + reason));
    return true;
  }

  // Every pages listener reports the forward checks that reach it.
  function onRequest(req) {
    if (expectedPath !== null && req.url === expectedPath) pathArrived = true;
  }
  (opts.pagesServers || []).forEach(function (s) {
    if (s && typeof s.prependListener === "function") {
      s.prependListener("request", onRequest);
      watched.push(s);
    }
  });

  function sendThroughForward(host, pathName) {
    return new Promise(function (resolve) {
      var req = http.get({ host: host, port: forwardPort, path: pathName, headers: { host: "127.0.0.1" }, timeout: CHECK_TIMEOUT_MS }, function (res) {
        res.resume();
        res.on("end", resolve);
      });
      req.on("timeout", function () { req.destroy(); });
      req.on("error", function () { resolve(); });
    });
  }

  async function checkForward() {
    if (!forwardOn) return false;
    var pathName = FORWARD_PATH + fresh();
    expectedPath = pathName;
    pathArrived = false;
    await sendThroughForward("127.0.0.1", pathName);
    var ok = pathArrived;
    expectedPath = null;
    pathArrived = false;
    return set("port_free", ok, ok ? null : "port 80 does not reach the pages port " + opts.pagesPort + "; addresses keep :" + opts.pagesPort);
  }

  async function checkNames() {
    if (!namesOn) return false;
    if (!server) {
      return set("lahe_names", false, serverError || "the name server is not running");
    }
    var name = "check-" + fresh() + "." + nameServerModule.ENDING;
    expectedName = name;
    nameArrived = false;
    var answered = null;
    try {
      answered = await withTimeout(Promise.resolve(lookup(name)), CHECK_TIMEOUT_MS);
    } catch (err) {
      answered = null;
    }
    var ok = nameArrived;
    expectedName = null;
    nameArrived = false;
    var reason = null;
    if (!ok) {
      reason = answered
        ? "another program answers .lahe lookups on this computer, not Lahe's name server"
        : "this computer does not send .lahe lookups to Lahe (" + (installed.resolver || "no resolver file") + ")";
    }
    return set("lahe_names", ok, reason);
  }

  // One check at a time: each holds a single expected value, and a second
  // run would overwrite the first one's.
  var running = null;
  function verifyNow() {
    if (!running) {
      running = runChecks().finally(function () { running = null; });
    }
    return running;
  }

  async function runChecks() {
    if (closed) return report();
    var changed = (await checkForward()) | (await checkNames());
    // A check that finishes after close says nothing: a stopped helper must
    // not write service.json again.
    if (changed && !closed && typeof opts.onChange === "function") {
      try { opts.onChange(report()); } catch (err) { /* the report stands */ }
    }
    return report();
  }

  function report() {
    return { port_free: Object.assign({}, state.port_free), lahe_names: Object.assign({}, state.lahe_names) };
  }

  /** Bind the name server, when install.json records the resolver. Quick. */
  async function listen() {
    if (!namesOn || server) return;
    var candidate = nameServerModule.createNameServer({
      port: installed.name_server_port,
      onQuery: function (name) { if (expectedName !== null && name === expectedName) nameArrived = true; },
      log: say
    });
    try {
      await candidate.start();
      server = candidate;
    } catch (err) {
      serverError = "the name server could not answer on port " + installed.name_server_port + " (" + (err.code || err.message) + ")";
      await candidate.close();
    }
  }

  /** Check again every interval, from now on. */
  function schedule() {
    if (timer || !(intervalMs > 0) || !(forwardOn || namesOn)) return;
    timer = setInterval(function () {
      verifyNow().catch(function (err) { say("address check failed: " + err.message); });
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  /** Everything, waiting for the first checks. The helper does not wait (see index.js). */
  async function start() {
    await listen();
    await verifyNow();
    schedule();
  }

  async function close() {
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    watched.forEach(function (s) { s.removeListener("request", onRequest); });
    watched = [];
    if (server) await server.close();
    server = null;
  }

  return {
    start: start,
    listen: listen,
    schedule: schedule,
    verifyNow: verifyNow,
    report: report,
    close: close,
    nameServerPort: function () { return server ? server.port() : null; },
    // How many arrival values are held, for a test to bound. Tests only.
    heldCount: function () { return (expectedPath !== null ? 1 : 0) + (expectedName !== null ? 1 : 0); },
    laheNamesVerified: function () { return state.lahe_names.verified; },
    printedPort: function () { return state.port_free.verified ? 80 : opts.pagesPort; }
  };
}

module.exports = {
  CHECK_EVERY_MS: CHECK_EVERY_MS,
  FORWARD_PATH: FORWARD_PATH,
  printedOrigin: printedOrigin,
  envSeams: envSeams,
  createAddresses: createAddresses
};
