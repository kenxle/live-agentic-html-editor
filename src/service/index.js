// The helper: `lahe serve`.
//
// Owner: 1A. Architecture D5 (the append-only log), D11 (loopback is not a
// boundary, so the page proves itself), and the Data and state section.
//
// ZERO RUNTIME DEPENDENCIES. node:http and node:fs and nothing else, because a
// user installs this by cloning a repo and the install promise is one command.
//
// THE PORT IS FIXED BY DEFAULT (7817, configurable with --port). An ephemeral
// port makes the reconnect promise false the first time the helper restarts: the
// page has a port baked into its script tag and no way to learn a new one.
//
// EVERY REQUEST GOES THROUGH auth.check. There is one call site below and no
// branch around it. Two routes ask for no credential, health and library.get
// (the built library, which is public code with no review data in it), and both
// exemptions are protocol.js's (AUTH.NONE), not this file's.
//
// ORDER OF WORK IN A REQUEST:
//
//   1. Match the method and path to a route on the wire. No match, 404.
//   2. OPTIONS is answered as a preflight, and it is allowed only for an origin
//      some review has registered. A preflight gates the browser and nothing
//      else, so the real request behind it is still fully checked.
//   3. Read the body, under a hard cap.
//   4. Resolve the review id from the query string, falling back to the body.
//   5. ONE call to auth.check. It either passed or the request is refused with a
//      line in the helper log naming the check that failed.
//   6. Dispatch to the handler, which receives the VERIFIED review id.
//
// Node-only.

"use strict";

var http = require("node:http");
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var manifest = require("../shared/manifest.js");
var stateDirModule = require("./state_dir.js");
var logModule = require("./log.js");
var reviewsModule = require("./reviews.js");
var authModule = require("./auth.js");
var routes = require("./routes.js");
var projection = require("./projection.js");
var agentSessionsModule = require("./agent_sessions.js");

var VERSION = "0.0.0";

// A body larger than this is refused before it is parsed. The library's own
// largest post is an unload flush, which the browser already caps near 64KB
// (protocol.FLUSH.KEEPALIVE_MAX_BYTES); a megabyte is generous for a re-post
// backlog and still bounded.
var MAX_BODY_BYTES = 8 * 1024 * 1024;

// The built library, which the helper serves at GET /lahe-layer.js so the
// script line on a page can be one absolute URL rather than a relative path
// that 404s the moment the page is served from another folder.
var BUNDLE_PATH = path.join(__dirname, "..", "..", manifest.BUNDLE_OUTPUT);

/**
 * The built library, re-read whenever the file on disk changes.
 *
 * FAIL LOUD AT START: a helper with no library to serve would hand every page a
 * 404 that looks like a broken page rather than a missing build, so it refuses
 * to start and says which command builds it.
 *
 * AFTER START IT FOLLOWS THE FILE. The bytes used to be read once, so a rebuilt
 * bundle was not served until somebody restarted the helper, and the whole point
 * of the review.write route is that helpers do not restart mid-review. One stat
 * per request is the same cheap trigger targetMtime uses.
 *
 * A file that goes missing later keeps serving the last good bytes rather than
 * failing a page that is in the middle of a review: the build is momentarily
 * absent during a rebuild, and a reviewer's page must not die on that window.
 */
function loadLibrary(bundlePath) {
  // The parameter is for the unit test, which must not rewrite the real dist
  // file to prove the helper follows it. serve() always passes nothing.
  var file = bundlePath || BUNDLE_PATH;
  var source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(
      "the built library is missing (" + file + "). Build it once with `npm run build:layer`, then serve again."
    );
  }
  var signature = bundleSignature();

  function bundleSignature() {
    try {
      var stat = fs.statSync(file);
      return String(stat.mtimeMs) + ":" + String(stat.size);
    } catch (err) {
      return null;
    }
  }

  function current() {
    var now = bundleSignature();
    if (now === null || now === signature) return source;
    try {
      source = fs.readFileSync(file, "utf8");
      signature = now;
    } catch (err) {
      // Mid-rewrite, or gone. Keep what we have.
    }
    return source;
  }

  var library = { path: file };
  Object.defineProperty(library, "source", {
    enumerable: true,
    get: current
  });
  Object.defineProperty(library, "bytes", {
    enumerable: true,
    get: function () {
      return Buffer.byteLength(current(), "utf8");
    }
  });
  return library;
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var done = false;
    req.on("data", function (chunk) {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(Object.assign(new Error("body too large"), { code: "BODY_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      if (!done) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", function (err) {
      if (!done) reject(err);
    });
  });
}

/**
 * Start the helper.
 *
 * @param {{port?: number, host?: string, stateDir?: string, reviews?: string[],
 *          origins?: string[], quiet?: boolean}} [options]
 * @returns {Promise<object>} a handle with port, url, close, and the pieces the
 *   tests and `add` reach for: log, reviews, dir.
 */
async function serve(options) {
  var opts = options || {};
  var host = opts.host || protocol.DEFAULT_HOST;
  var port = typeof opts.port === "number" ? opts.port : protocol.DEFAULT_PORT;
  // An explicit stateDir runs through the same in-checkout refusal as the
  // env-derived default (finding 19). allowInsideCheckout is reserved for the
  // test harness, which serves from a temp directory it controls.
  var dir = opts.stateDir
    ? stateDirModule.stateDir({ dir: opts.stateDir, allowInsideCheckout: opts.allowInsideCheckout })
    : stateDirModule.stateDir();
  var startedAt = new Date().toISOString();

  stateDirModule.ensureDir(dir);

  var log = logModule.createEventLog({ dir: dir });
  var reviews = reviewsModule.createReviews({ dir: dir, log: log });
  reviews.loadFromDisk();
  var auth = authModule.createAuth({ log: log, reviews: reviews });

  // Reviews named on the command line (or by the harness) exist before the
  // listener does, so a page that loads the instant the port answers already has
  // a review to post to.
  (opts.reviews || []).forEach(function (id) {
    reviews.create({ id: id, origins: opts.origins || [] });
  });
  // Origins named without a review are registered on every review the helper
  // holds. This is what `add` does when it points a second dev-server origin at
  // a review that already exists.
  if ((opts.origins || []).length > 0 && (opts.reviews || []).length === 0) {
    reviews.list().forEach(function (id) {
      (opts.origins || []).forEach(function (origin) {
        reviews.registerOrigin(id, origin);
      });
    });
  }

  var deps = {
    log: log,
    reviews: reviews,
    projection: projection,
    // The session store, so a route can answer two questions server-side: which
    // agent session owns this review, and is that session's monitor alive. Both
    // used to be things the reviewer could only get by asking the agent.
    agentSessions: agentSessionsModule.createStore({ dir: dir }),
    library: loadLibrary(),
    version: VERSION,
    startedAt: startedAt
  };

  // 3A's projector: it folds every review's reply files on protocol.REPLY_POLL's
  // interval and rewrites review.json whenever a review's log moves. One line,
  // here, because the agent loop has to run for the life of the helper rather
  // than only while a page happens to be asking something.
  projection.startWatching(deps);

  var server = http.createServer(function (req, res) {
    handle(req, res).catch(function (err) {
      log.helperLog("unhandled error serving " + req.method + " " + req.url + ": " + err.message);
      respond(res, 500, protocol.errorBody("PROTO_BAD_REQUEST", err.message, null, null), null);
    });
  });

  function respond(res, status, body, origin, requestId) {
    var headers = {
      "Content-Type": protocol.JSON_CONTENT_TYPE,
      "Cache-Control": "no-store",
      Vary: "Origin"
    };
    if (requestId) headers[protocol.HEADER.REQUEST_ID] = requestId;
    if (origin) {
      // The exact origin, echoed. No wildcard and no reflection of whatever
      // asked: this is only ever set from an origin the check block already
      // matched against the review's registered set. The literal string "null"
      // is what a page opened from disk sends, and it is a legitimate value here
      // (see the 1A file:// spike, architecture D11).
      headers["Access-Control-Allow-Origin"] = origin;
    }
    res.writeHead(status, headers);
    res.end(body === null || body === undefined ? "" : JSON.stringify(body));
  }

  // A handler that answers with bytes rather than JSON (the library route).
  // Separate from respond() so the JSON content type stays the one thing every
  // other route can count on. Any origin may load it: it is a script tag on a
  // page, it carries no review data, and a browser loading a <script> does not
  // send an Origin header at all.
  function respondRaw(res, status, raw, requestId) {
    var headers = {
      "Content-Type": raw.contentType,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    };
    if (requestId) headers[protocol.HEADER.REQUEST_ID] = requestId;
    res.writeHead(status, headers);
    res.end(raw.text);
  }

  /** Every origin any review has registered, for the preflight answer. */
  function anyReviewRegistered(origin) {
    if (!origin) return false;
    var config = reviews.config();
    return Object.keys(config.reviews).some(function (id) {
      return config.reviews[id].origins.indexOf(origin) !== -1;
    });
  }

  async function handle(req, res) {
    var requestId = crypto.randomBytes(8).toString("hex");
    var url = new URL(req.url, "http://" + protocol.DEFAULT_HOST);
    var origin = req.headers[protocol.HEADER.ORIGIN];
    var effectiveOrigin = origin === undefined || origin === null || origin === "" ? "null" : String(origin);

    // The preflight. It carries no token and names no review by design, so the
    // only thing it can be judged on is whether some review registered the
    // origin. It grants the browser permission to SEND the real request; the
    // real request is then checked in full, which is where a refusal happens.
    if (req.method === "OPTIONS") {
      if (!anyReviewRegistered(effectiveOrigin)) {
        log.helperLog(
          "refused preflight: origin " + effectiveOrigin + " is registered on no review [request " + requestId + "]"
        );
        respond(res, protocol.statusFor("PROTO_FORBIDDEN_ORIGIN"), protocol.errorBody("PROTO_FORBIDDEN_ORIGIN", effectiveOrigin, requestId, protocol.CHECK.ORIGIN), null, requestId);
        return;
      }
      res.writeHead(204, {
        "Access-Control-Allow-Origin": effectiveOrigin,
        "Access-Control-Allow-Headers": [
          protocol.HEADER.CONTENT_TYPE,
          protocol.HEADER.CLIENT,
          protocol.HEADER.TOKEN
        ].join(","),
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Max-Age": "600",
        Vary: "Origin"
      });
      res.end();
      return;
    }

    var route = routes.matchRoute(req.method, url.pathname);
    if (!route) {
      respond(res, 404, protocol.errorBody("PROTO_BAD_REQUEST", "no route for " + req.method + " " + url.pathname, requestId, null), null, requestId);
      return;
    }

    var rawBody = "";
    if (req.method === "POST") {
      try {
        rawBody = await readBody(req, MAX_BODY_BYTES);
      } catch (err) {
        auth.refuse({ routeName: route.name, requestId: requestId }, "PROTO_BAD_REQUEST", err.message);
        respond(res, 400, protocol.errorBody("PROTO_BAD_REQUEST", err.message, requestId, null), null, requestId);
        return;
      }
    }

    var body = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch (err) {
        // Left as null. The check block runs first either way, so a hostile page
        // never learns the difference between bad JSON and a bad token.
        body = null;
      }
    }

    // The review id: the query string, then the body. The ORIGIN is never read
    // from either one; it comes from the request's own header, which a page
    // cannot forge, and that is what makes the allowlist the real control.
    var reviewId = url.searchParams.get("review");
    if (!reviewId && body && typeof body.review === "string") reviewId = body.review;

    // THE ONE CALL SITE.
    var checked = auth.check({
      routeName: route.name,
      headers: req.headers,
      review: reviewId,
      method: req.method,
      path: url.pathname,
      requestId: requestId
    });

    if (!checked.ok) {
      respond(
        res,
        checked.status,
        protocol.errorBody(checked.code, null, requestId, checked.check),
        null,
        requestId
      );
      return;
    }

    // The page checked in. Any authenticated route from the LIBRARY counts (a
    // read, an event post, a reply poll), which is what lets `lahe status` tell
    // an agent truthfully whether the reviewer's page is connected. A CLI
    // request never counts; see reviews.touch.
    if (checked.review) reviews.touch(checked.review, req.headers[protocol.HEADER.CLIENT]);

    var query = {};
    url.searchParams.forEach(function (value, key) {
      query[key] = value;
    });

    var handler = routes.handlerFor(route.name);
    var outcome;
    try {
      outcome = await handler(
        {
          routeName: route.name,
          review: checked.review,
          origin: checked.origin,
          query: query,
          body: body,
          requestId: requestId
        },
        deps
      );
    } catch (err) {
      var status = err.code === "NOT_IMPLEMENTED" ? 501 : 500;
      log.helperLog("route " + route.name + " failed: " + err.message + " [request " + requestId + "]");
      respond(res, status, protocol.errorBody("PROTO_BAD_REQUEST", err.message, requestId, null), checked.origin, requestId);
      return;
    }

    if (outcome && outcome.raw) {
      respondRaw(res, outcome.status || 200, outcome.raw, requestId);
      return;
    }

    if (outcome && outcome.error) {
      respond(
        res,
        outcome.status || protocol.statusFor(outcome.error.code),
        protocol.errorBody(outcome.error.code, outcome.error.detail, requestId, null),
        checked.origin,
        requestId
      );
      return;
    }
    respond(res, (outcome && outcome.status) || 200, outcome ? outcome.body : null, checked.origin, requestId);
  }

  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(port, host, function () {
      server.removeListener("error", reject);
      resolve();
    });
  });

  var boundPort = server.address().port;

  // The readiness file goes out AFTER the listener is bound. A readiness file
  // that arrives before the socket is a lie, and the durability tests race it.
  reviews.writeReadyFile({ port: boundPort, started_at: startedAt });
  log.helperLog(
    "serving on http://" + host + ":" + boundPort + ", state directory " + dir + ", reviews " + (reviews.list().join(", ") || "none")
  );
  if (!opts.quiet) {
    process.stdout.write("lahe serve listening on http://" + host + ":" + boundPort + "\n");
  }

  return {
    port: boundPort,
    host: host,
    url: "http://" + host + ":" + boundPort,
    dir: dir,
    log: log,
    reviews: reviews,
    server: server,
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () {
          resolve();
        });
        // server.close() stops accepting and then waits for every open
        // connection to end on its own. The library polls on keep-alive
        // connections, so a page left open holds the socket and close() never
        // calls back: SIGTERM hung, `add`'s restart fallback timed out after ten
        // seconds, and the unit suite flaked on teardown. Node 18.2+ has the one
        // API that ends them, which is why engines.node is >=18.2.0.
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      });
    }
  };
}

/**
 * Is a helper already answering on this port?
 *
 * `serve` is idempotent (0A-wire's Q1: `add` starts the helper when it is not
 * already up), and idempotent means the second call reports the running one
 * rather than dying on EADDRINUSE.
 */
async function probeHealth(host, port) {
  try {
    var res = await fetch("http://" + host + ":" + port + protocol.BASE + "/health", {
      headers: { host: host + ":" + port }
    });
    if (!res.ok) return null;
    var body = await res.json();
    return body && body.ok ? body : null;
  } catch (err) {
    return null;
  }
}

// Started directly (the harness spawns this file), so read the environment the
// harness sets and serve. `LAHE_PORT` and `--port` both work; 0 means "any", and
// only tests ask for that.
if (require.main === module) {
  var argv = process.argv.slice(2);
  var portArg = null;
  for (var i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port" && argv[i + 1] !== undefined) portArg = Number(argv[i + 1]);
    else if (argv[i].indexOf("--port=") === 0) portArg = Number(argv[i].slice("--port=".length));
  }
  if (portArg === null && process.env.LAHE_PORT) portArg = Number(process.env.LAHE_PORT);

  var splitList = function (value) {
    return String(value || "")
      .split(",")
      .map(function (entry) {
        return entry.trim();
      })
      .filter(Boolean);
  };

  serve({
    port: portArg === null || Number.isNaN(portArg) ? protocol.DEFAULT_PORT : portArg,
    stateDir: process.env.LAHE_STATE_DIR,
    reviews: splitList(process.env.LAHE_REVIEWS),
    origins: splitList(process.env.LAHE_ALLOWED_ORIGINS)
  })
    .then(function (helper) {
      // Test workers spawn the service with one IPC descriptor. That channel
      // is the worker's ownership lease: when the worker is interrupted or
      // crashes, close this test-only helper too. Ordinary product helpers are
      // launched without IPC, so their lifetime remains controlled by agent
      // sessions and explicit shutdown.
      if (typeof process.send === "function") {
        process.once("disconnect", function () {
          helper.close().then(function () {
            process.exit(0);
          });
        });
      }
    })
    .catch(function (err) {
      process.stderr.write("lahe serve: " + (err && err.stack ? err.stack : String(err)) + "\n");
      process.exit(1);
    });
}

module.exports = {
  VERSION: VERSION,
  loadLibrary: loadLibrary,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
  serve: serve,
  probeHealth: probeHealth
};
