#!/usr/bin/env node
// Stub local helper, for the browser test harness only.
//
// This is NOT the real helper (src/service/). It exists so the service helpers
// in test/helpers/service.js have something to start, probe, suspend and kill -9
// before the real one lands, and so the second-origin assertion can be written
// now and pointed at the real thing later.
//
// It implements exactly the contract the helpers depend on and nothing else:
//
//   1. It binds an ephemeral port on 127.0.0.1.
//   2. It writes <stateDir>/service.json, mode 0600, containing
//      { port, pid, reviews: { "<id>": { token } } }. That file is the readiness
//      signal AND the way a test learns a review's token. The token is PER
//      REVIEW (architecture D11: loopback is not a boundary, so the page proves
//      itself), which is why this is a map and not one string.
//   3. GET  /health                       -> 200 {"ok":true}, no auth. Liveness.
//   4. POST /reviews/<id>/items           -> appends one line to
//      <stateDir>/reviews/<id>/events.jsonl, but only behind all of D11's
//      checks: that review's token, the origin allowlist, a JSON content type,
//      and a custom header so a simple request can never reach the handler.
//   5. Anything refused appends nothing. That is what "asserted on effect"
//      means: the test reads the log off disk, not a status code.
//
// Env: LAHE_STATE_DIR (required), LAHE_ALLOWED_ORIGINS (comma separated),
//      LAHE_REVIEWS (comma separated review ids, default review-1),
//      LAHE_TOKEN (optional; used for every review, for a test that wants a
//      token it can predict).

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const stateDir = process.env.LAHE_STATE_DIR;
if (!stateDir) {
  process.stderr.write("stub-service: LAHE_STATE_DIR is required\n");
  process.exit(2);
}
fs.mkdirSync(stateDir, { recursive: true });

const DEFAULT_REVIEW_ID = "review-1";
// Review ids are path components, so they are constrained here the same way the
// real helper constrains them. A stub that accepted anything would let a
// path-traversal test pass against the harness and fail against the helper.
const SAFE_REVIEW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const reviewIds = (process.env.LAHE_REVIEWS || DEFAULT_REVIEW_ID)
  .split(",")
  .map(function (value) {
    return value.trim();
  })
  .filter(Boolean);

const reviews = {};
reviewIds.forEach(function (id) {
  if (!SAFE_REVIEW_ID.test(id)) {
    process.stderr.write("stub-service: unsafe review id: " + id + "\n");
    process.exit(2);
  }
  reviews[id] = { token: process.env.LAHE_TOKEN || crypto.randomBytes(24).toString("hex") };
  fs.mkdirSync(path.join(stateDir, "reviews", id), { recursive: true, mode: 0o700 });
});

const allowedOrigins = (process.env.LAHE_ALLOWED_ORIGINS || "")
  .split(",")
  .map(function (value) {
    return value.trim();
  })
  .filter(Boolean);

const readyPath = path.join(stateDir, "service.json");

function eventLogPath(reviewId) {
  return path.join(stateDir, "reviews", reviewId, "events.jsonl");
}

function originAllowed(origin) {
  // No wildcard and no reflection. A page cannot forge its Origin header, which
  // is what makes this the control a readable token cannot be.
  return !!origin && allowedOrigins.indexOf(origin) !== -1;
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function appendEvent(reviewId, event) {
  fs.appendFileSync(eventLogPath(reviewId), JSON.stringify(event) + "\n", { mode: 0o600 });
}

function send(res, status, body, extraHeaders) {
  const headers = Object.assign(
    { "Content-Type": "application/json", "Cache-Control": "no-store" },
    extraHeaders || {}
  );
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on("data", function (chunk) {
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

// /reviews/<id>/items, and nothing else routes.
function itemsRoute(pathname) {
  const match = /^\/reviews\/([^/]+)\/items$/.exec(pathname);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    if (!originAllowed(origin)) {
      send(res, 403, { error: "origin_not_allowed" });
      return;
    }
    send(res, 204, null, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "content-type,x-lahe-token,x-lahe-request",
      "Access-Control-Allow-Methods": "POST",
      "Vary": "Origin"
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true, pid: process.pid, reviews: Object.keys(reviews) });
    return;
  }

  const reviewId = req.method === "POST" ? itemsRoute(url.pathname) : null;
  if (reviewId !== null) {
    const body = await readBody(req);
    const contentType = String(req.headers["content-type"] || "");
    const review = SAFE_REVIEW_ID.test(reviewId) ? reviews[reviewId] : null;
    const refusal =
      (!review && "unknown_review") ||
      (!originAllowed(origin) && "origin_not_allowed") ||
      (contentType.indexOf("application/json") !== 0 && "content_type_required") ||
      (!req.headers["x-lahe-request"] && "custom_header_required") ||
      (!constantTimeEquals(req.headers["x-lahe-token"] || "", review.token) && "bad_token") ||
      null;

    if (refusal) {
      // Nothing is appended. The whole point of the assertion is that the log is
      // unchanged, so a refusal must not leave a trace in it either. The real
      // helper names the failed check in its OWN log (D11); this stub has no
      // helper log, and 1A adds one when it builds the real thing.
      send(res, 403, { error: refusal });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      send(res, 400, { error: "bad_json" });
      return;
    }
    appendEvent(reviewId, {
      kind: "item",
      review: reviewId,
      at: new Date().toISOString(),
      payload: parsed
    });
    send(res, 200, { ok: true }, { "Access-Control-Allow-Origin": origin, "Vary": "Origin" });
    return;
  }

  send(res, 404, { error: "not_found" });
});

server.listen(0, "127.0.0.1", function () {
  const port = server.address().port;
  const payload = {
    port: port,
    pid: process.pid,
    reviews: reviews,
    startedAt: new Date().toISOString()
  };
  const temp = readyPath + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(payload), { mode: 0o600 });
  fs.renameSync(temp, readyPath);
  process.stdout.write("stub-service listening on 127.0.0.1:" + port + "\n");
});

// Match the real test helper's owner lease. Product processes never run this
// fixture, and a fixture started without IPC keeps its ordinary lifetime.
if (typeof process.send === "function") {
  process.once("disconnect", function () {
    server.close(function () {
      process.exit(0);
    });
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  });
}
