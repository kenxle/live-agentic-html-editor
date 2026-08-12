#!/usr/bin/env node
// Stub local service, for the browser test harness only.
//
// This is NOT the real service (src/service/). It exists so the service
// helpers in test/helpers/service.js have something to start, probe, and
// kill -9 before the real service lands, and so the cross-origin assertion can
// be written now and pointed at the real thing later.
//
// It implements exactly the contract the helpers depend on and nothing else:
//
//   1. It binds an ephemeral port on 127.0.0.1.
//   2. It writes <stateDir>/service.json, mode 0600, containing
//      { port, pid, token }. That file is the readiness signal AND the way a
//      test learns the token. The real service records the run token and port in
//      an owner only file per D9; the helper polls for exactly this shape.
//   3. GET  /health            -> 200 {"ok":true}, no auth. Liveness only.
//   4. POST /items             -> appends one line to <stateDir>/events.log,
//      but only behind all three of D9's layers: the token header, the origin
//      allowlist, and a JSON content type plus a custom header so a simple
//      request can never reach the handler.
//   5. Anything refused appends nothing. That is what "asserted on effect"
//      means: the test reads events.log off disk, not a status code.
//
// Env: LAHE_STATE_DIR (required), LAHE_ALLOWED_ORIGINS (comma separated),
//      LAHE_TOKEN (optional, otherwise generated).

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

const token = process.env.LAHE_TOKEN || crypto.randomBytes(24).toString("hex");
const allowedOrigins = (process.env.LAHE_ALLOWED_ORIGINS || "")
  .split(",")
  .map(function (value) {
    return value.trim();
  })
  .filter(Boolean);

const logPath = path.join(stateDir, "events.log");
const readyPath = path.join(stateDir, "service.json");

function originAllowed(origin) {
  // No wildcard and no reflection. A page cannot forge its Origin header, which
  // is what makes this the control that a readable token cannot be.
  return !!origin && allowedOrigins.indexOf(origin) !== -1;
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function appendEvent(event) {
  fs.appendFileSync(logPath, JSON.stringify(event) + "\n", { mode: 0o600 });
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
    send(res, 200, { ok: true, pid: process.pid });
    return;
  }

  if (req.method === "POST" && url.pathname === "/items") {
    const body = await readBody(req);
    const contentType = String(req.headers["content-type"] || "");
    const refusal =
      (!originAllowed(origin) && "origin_not_allowed") ||
      (contentType.indexOf("application/json") !== 0 && "content_type_required") ||
      (!req.headers["x-lahe-request"] && "custom_header_required") ||
      (!constantTimeEquals(req.headers["x-lahe-token"] || "", token) && "bad_token") ||
      null;

    if (refusal) {
      // Nothing is appended. The whole point of the assertion is that the log is
      // unchanged, so a refusal must not leave a trace either.
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
    appendEvent({ kind: "item", at: new Date().toISOString(), payload: parsed });
    send(res, 200, { ok: true }, { "Access-Control-Allow-Origin": origin, "Vary": "Origin" });
    return;
  }

  send(res, 404, { error: "not_found" });
});

server.listen(0, "127.0.0.1", function () {
  const port = server.address().port;
  const payload = { port: port, pid: process.pid, token: token, startedAt: new Date().toISOString() };
  const temp = readyPath + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(payload), { mode: 0o600 });
  fs.renameSync(temp, readyPath);
  process.stdout.write("stub-service listening on 127.0.0.1:" + port + "\n");
});
