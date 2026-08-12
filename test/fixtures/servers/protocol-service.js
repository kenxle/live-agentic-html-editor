#!/usr/bin/env node
// A helper that speaks the CURRENT wire, for 1B's browser specs only.
//
// Why this exists beside test/fixtures/servers/stub-service.js: that stub
// answers the archived send model's route (POST /reviews/<id>/items with an
// x-lahe-request header) and 0A-wire's protocol.js pins a different one
// (POST /lahe/v1/events, x-lahe-client, x-lahe-token, plus the reply poll).
// 1B's sync client is written against protocol.js, which is the contract, so it
// needs something on the other end that reads the same file. It imports
// src/shared/protocol.js rather than restating any of it.
//
// It is a STAND-IN, not a second implementation of the helper: 1A owns the real
// one (src/service/), and when it lands these specs point at it by changing the
// `entry` constant in test/browser/rail_sync.spec.js. On the cleanup list.
//
// It honors test/helpers/service.js's readiness contract exactly, so kill9(),
// suspend() and resume() work against it:
//
//   <stateDir>/service.json  {port, pid, reviews: {<id>: {token}}}, mode 0600
//   <stateDir>/reviews/<id>/events.jsonl   append only, one JSON object a line
//
// Env: LAHE_STATE_DIR (required), LAHE_ALLOWED_ORIGINS (comma separated),
//      LAHE_REVIEWS (comma separated, default review-1), LAHE_TOKEN (optional).

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const protocol = require("../../../src/shared/protocol.js");

const stateDir = process.env.LAHE_STATE_DIR;
if (!stateDir) {
  process.stderr.write("protocol-service: LAHE_STATE_DIR is required\n");
  process.exit(2);
}
fs.mkdirSync(stateDir, { recursive: true });

const reviewIds = (process.env.LAHE_REVIEWS || "review-1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const allowedOrigins = (process.env.LAHE_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const reviews = {};
reviewIds.forEach((id) => {
  if (!protocol.isSafeId(id)) {
    process.stderr.write("protocol-service: unsafe review id: " + id + "\n");
    process.exit(2);
  }
  reviews[id] = {
    token: process.env.LAHE_TOKEN || crypto.randomBytes(24).toString("hex"),
    origins: allowedOrigins.slice()
  };
  fs.mkdirSync(path.join(stateDir, "reviews", id), { recursive: true, mode: 0o700 });
});

// seq is HELPER assigned and monotonic per review; it is the cursor every
// reader uses. Rebuilt from the log so a restart continues rather than replays.
const seqOf = {};
// Idempotence is by event_id, never by (item, rev).
const seenEventIds = {};
// One window session per review (D5), so the separate-storage second window has
// something to be refused by.
const windowHolder = {};

function logPath(reviewId) {
  return path.join(stateDir, "reviews", reviewId, "events.jsonl");
}

function loadLog(reviewId) {
  let text = "";
  try {
    text = fs.readFileSync(logPath(reviewId), "utf8");
  } catch (err) {
    return [];
  }
  const out = [];
  text.split("\n").forEach((line) => {
    if (!line) return;
    const parsed = protocol.parseEventLine(line);
    if (parsed.ok) out.push(parsed.event);
  });
  return out;
}

reviewIds.forEach((id) => {
  const existing = loadLog(id);
  seqOf[id] = existing.reduce((max, event) => Math.max(max, event.seq || 0), 0);
  seenEventIds[id] = new Set(existing.map((event) => event.event_id));
});

function append(reviewId, event) {
  seqOf[reviewId] += 1;
  const stamped = Object.assign({}, event, { seq: seqOf[reviewId] });
  // Written whole, and flushed before the response goes out, because every
  // durability assertion in 1B's specs reads this file after a kill -9.
  const fd = fs.openSync(logPath(reviewId), "a", 0o600);
  try {
    fs.writeSync(fd, protocol.encodeEventLine(stamped));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  seenEventIds[reviewId].add(stamped.event_id);
  return stamped;
}

function corsHeaders(origin) {
  if (!origin || allowedOrigins.indexOf(origin) === -1) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": [
      protocol.HEADER.CLIENT,
      protocol.HEADER.TOKEN,
      protocol.HEADER.CONTENT_TYPE
    ].join(","),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin"
  };
}

function send(res, status, body, origin) {
  res.writeHead(
    status,
    Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(origin))
  );
  res.end(body === null ? "" : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function routeFor(method, pathname) {
  return protocol.ROUTES.filter((route) => route.method === method && route.path === pathname)[0] || null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const origin = req.headers.origin || null;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  const route = routeFor(req.method, url.pathname);
  if (!route) {
    send(res, 404, { error: { code: "PROTO_BAD_REQUEST", message: "no such route" } }, origin);
    return;
  }

  const body = req.method === "POST" ? await readBody(req) : "";
  let parsedBody = null;
  if (body) {
    try {
      parsedBody = JSON.parse(body);
    } catch (err) {
      send(res, 400, protocol.errorBody("PROTO_BAD_REQUEST", "not JSON", null, null), origin);
      return;
    }
  }

  const reviewId = (parsedBody && parsedBody.review) || url.searchParams.get("review");
  // The whole D11 check block, from protocol.js, so this stand-in refuses
  // exactly what the real helper refuses.
  const checked = protocol.checkRequest(
    { routeName: route.name, headers: req.headers, review: reviewId },
    { reviews: reviews }
  );
  if (!checked.ok) {
    process.stdout.write(checked.log + "\n");
    send(res, protocol.statusFor(checked.code), protocol.errorBody(checked.code, null, null, checked.check), origin);
    return;
  }

  if (route.name === "health") {
    send(res, 200, { ok: true, version: "stand-in", api: protocol.API_VERSION }, origin);
    return;
  }

  if (route.name === "events.append") {
    const events = (parsedBody && parsedBody.events) || [];
    const accepted = [];
    events.forEach((event) => {
      accepted.push(event.event_id);
      // EXACTLY ONCE: a re-post after a timeout, a reconnect, or a reload
      // carries the same event_id and is acknowledged without a second line.
      if (seenEventIds[reviewId].has(event.event_id)) return;
      append(reviewId, event);
    });
    send(res, 200, { accepted: accepted, seq: seqOf[reviewId] }, origin);
    return;
  }

  if (route.name === "replies.poll") {
    foldReplies(reviewId);
    const since = Number(url.searchParams.get("since") || 0);
    const events = loadLog(reviewId).filter(
      (event) => event.event === protocol.EVENT.REPLY_FOLDED && (event.seq || 0) > since
    );
    send(res, 200, { events: events, seq: seqOf[reviewId] }, origin);
    return;
  }

  if (route.name === "window.claim") {
    const windowId = parsedBody && parsedBody.window_id;
    const holder = windowHolder[reviewId];
    if (holder && holder.window_id !== windowId && parsedBody.takeover !== true) {
      send(
        res,
        protocol.statusFor("PROTO_SECOND_WINDOW"),
        protocol.errorBody("PROTO_SECOND_WINDOW", "held by " + holder.window_id + " since " + holder.since, null, null),
        origin
      );
      return;
    }
    windowHolder[reviewId] = { window_id: windowId, since: new Date().toISOString() };
    send(res, 200, { granted: true, holder: windowId, since: windowHolder[reviewId].since, heartbeat_seconds: 30 }, origin);
    return;
  }

  send(res, 404, protocol.errorBody("PROTO_BAD_REQUEST", "unimplemented in the stand-in", null, null), origin);
});

// Reply files, folded on demand rather than on a timer: a test writes the file
// and then polls, and a timer here would only add a race to that.
const foldedLines = {};
function foldReplies(reviewId) {
  const dir = path.join(stateDir, "reviews", reviewId);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return;
  }
  names.forEach((name) => {
    const parsed = protocol.agentFromFilename(name);
    if (!parsed.ok) return;
    const full = path.join(dir, name);
    const text = fs.readFileSync(full, "utf8");
    const split = protocol.splitCompleteLines(text);
    const key = reviewId + "|" + name;
    const already = foldedLines[key] || 0;
    split.lines.forEach((line, index) => {
      if (index < already) return;
      if (!line) return;
      const reply = protocol.parseReplyLine(line, { filenameAgent: parsed.agent });
      if (!reply.ok) {
        append(reviewId, {
          event: protocol.EVENT.REPLY_REJECTED,
          event_id: "rej_" + crypto.randomBytes(6).toString("hex"),
          ts: new Date().toISOString(),
          review: reviewId,
          file: name,
          line: index + 1,
          reason: reply.reason
        });
        return;
      }
      append(reviewId, {
        event: protocol.EVENT.REPLY_FOLDED,
        event_id: "fold_" + crypto.randomBytes(6).toString("hex"),
        ts: new Date().toISOString(),
        review: reviewId,
        item: reply.reply.item,
        rev: reply.reply.rev,
        reply: reply.reply
      });
    });
    foldedLines[key] = split.lines.length;
  });
}

// LAHE_PORT exists for one reason: a durability test kills the helper with
// kill -9 and restarts it, and the page it left behind has the old port baked
// into its script tag. An ephemeral port on the restart would test a page that
// could never have reconnected in the first place.
const requestedPort = Number(process.env.LAHE_PORT || 0);

server.listen(requestedPort, "127.0.0.1", () => {
  const port = server.address().port;
  const payload = {
    port: port,
    pid: process.pid,
    reviews: reviews,
    startedAt: new Date().toISOString()
  };
  const temp = path.join(stateDir, "service.json." + process.pid + ".tmp");
  fs.writeFileSync(temp, JSON.stringify(payload), { mode: 0o600 });
  fs.renameSync(temp, path.join(stateDir, "service.json"));
  process.stdout.write("protocol-service listening on 127.0.0.1:" + port + "\n");
});
