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
var dns = require("node:dns");
var http = require("node:http");

var protocol = require("../shared/protocol.js");
var nameServerModule = require("./name_server.js");

var CHECK_EVERY_MS = 5 * 60 * 1000;
var CHECK_TIMEOUT_MS = 3000;
var FORWARD_PATH = "/.lahe-forward-check/";
var NOT_SET_UP = "not set up";

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
  var forwardPort = typeof opts.forwardPort === "number" ? opts.forwardPort : 80;
  var lookup = opts.lookup || function (name) { return dns.promises.lookup(name, { family: 4 }); };
  var intervalMs = typeof opts.intervalMs === "number" ? opts.intervalMs : CHECK_EVERY_MS;

  var state = {
    port_free: { on: forwardOn, verified: false, reason: forwardOn ? "not checked yet" : installed.port_80_reason || NOT_SET_UP },
    lahe_names: { on: namesOn, verified: false, reason: namesOn ? "not checked yet" : NOT_SET_UP }
  };
  var server = null;
  var serverError = null;
  var seenNames = new Set();
  var seenPaths = new Set();
  var timer = null;
  var watched = [];

  function say(line) {
    if (typeof opts.log === "function") {
      try { opts.log(line); } catch (err) { /* keep going */ }
    }
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
    if (typeof req.url === "string" && req.url.indexOf(FORWARD_PATH) === 0) seenPaths.add(req.url);
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
    await sendThroughForward("127.0.0.1", pathName);
    var ok = seenPaths.has(pathName);
    seenPaths.clear();
    return set("port_free", ok, ok ? null : "port 80 does not reach the pages port " + opts.pagesPort + "; addresses keep :" + opts.pagesPort);
  }

  async function checkNames() {
    if (!namesOn) return false;
    if (!server) {
      return set("lahe_names", false, serverError || "the name server is not running");
    }
    var name = "check-" + fresh() + "." + nameServerModule.ENDING;
    var answered = null;
    try {
      answered = await withTimeout(Promise.resolve(lookup(name)), CHECK_TIMEOUT_MS);
    } catch (err) {
      answered = null;
    }
    var ok = seenNames.has(name);
    seenNames.clear();
    var reason = null;
    if (!ok) {
      reason = answered
        ? "another program answers .lahe lookups on this computer, not Lahe's name server"
        : "this computer does not send .lahe lookups to Lahe (" + (installed.resolver || "no resolver file") + ")";
    }
    return set("lahe_names", ok, reason);
  }

  async function verifyNow() {
    var changed = (await checkForward()) | (await checkNames());
    if (changed && typeof opts.onChange === "function") {
      try { opts.onChange(report()); } catch (err) { /* the report stands */ }
    }
    return report();
  }

  function report() {
    return { port_free: Object.assign({}, state.port_free), lahe_names: Object.assign({}, state.lahe_names) };
  }

  async function start() {
    if (namesOn) {
      var candidate = nameServerModule.createNameServer({
        port: installed.name_server_port,
        onQuery: function (name) { seenNames.add(name); },
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
    await verifyNow();
    if (intervalMs > 0 && (forwardOn || namesOn)) {
      timer = setInterval(function () {
        verifyNow().catch(function (err) { say("address check failed: " + err.message); });
      }, intervalMs);
      if (typeof timer.unref === "function") timer.unref();
    }
  }

  async function close() {
    if (timer) clearInterval(timer);
    timer = null;
    watched.forEach(function (s) { s.removeListener("request", onRequest); });
    watched = [];
    if (server) await server.close();
    server = null;
  }

  return {
    start: start,
    verifyNow: verifyNow,
    report: report,
    close: close,
    nameServerPort: function () { return server ? server.port() : null; },
    laheNamesVerified: function () { return state.lahe_names.verified; },
    printedPort: function () { return state.port_free.verified ? 80 : opts.pagesPort; }
  };
}

module.exports = {
  CHECK_EVERY_MS: CHECK_EVERY_MS,
  FORWARD_PATH: FORWARD_PATH,
  printedOrigin: printedOrigin,
  createAddresses: createAddresses
};
