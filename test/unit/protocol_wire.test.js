// The wire: the event log line, the reply line, the request checks, and the
// script tag.
//
// Owner: 0A-wire. Everything asserted here is read or written by something
// OUTSIDE this repo (an agent, a browser, a person typing a script tag), which
// is the whole reason these bytes are pinned rather than left to a builder.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const failures = require("../../src/shared/failures.js");

// ---------------------------------------------------------------------------
// The events.jsonl line (D5)
// ---------------------------------------------------------------------------

test("the event type vocabulary is closed and complete", () => {
  assert.deepEqual(protocol.EVENT_TYPES.slice().sort(), [
    "item.content",
    "item.created",
    "item.deleted",
    "item.ready",
    "item.reopened",
    "origin.registered",
    "page.visited",
    "reply.folded",
    "reply.rejected",
    "review.archived",
    "review.created"
  ]);
});

test("idempotence is by event_id, never by item and rev", () => {
  assert.equal(protocol.IDEMPOTENCE_KEY, "event_id");
  const base = { event: protocol.EVENT.ITEM_CONTENT, review: "rev_a", item: "itm_1", rev: 1 };
  const a = protocol.newEvent(Object.assign({ event_id: "e1", payload: { text: "half a sen" } }, base));
  const b = protocol.newEvent(Object.assign({ event_id: "e2", payload: { text: "half a sentence" } }, base));
  // Two legitimate events with the same item AND the same rev: drafts do not
  // bump rev, so keying idempotence on (item, rev) would drop the later one.
  assert.equal(a.item, b.item);
  assert.equal(a.rev, b.rev);
  assert.notEqual(a.event_id, b.event_id);
});

test("an event line is one line, whatever the page's text does", () => {
  const e = protocol.newEvent({
    event: protocol.EVENT.ITEM_CONTENT,
    event_id: "e3",
    review: "rev_a",
    payload: { text: 'a "quoted" line\nand another\ttab' }
  });
  const line = protocol.encodeEventLine(e);
  assert.equal(line.endsWith("\n"), true);
  assert.equal(line.slice(0, -1).includes("\n"), false, "one event is one line");
  const back = protocol.parseEventLine(line.slice(0, -1));
  assert.equal(back.ok, true);
  assert.equal(back.event.text, 'a "quoted" line\nand another\ttab');
});

test("an event without an event_id or with an unknown type is refused", () => {
  assert.throws(() => protocol.newEvent({ event: "item.invented", event_id: "e", review: "r" }), /must be one of/);
  assert.throws(() => protocol.newEvent({ event: protocol.EVENT.ITEM_READY, review: "r" }), /event_id/);
  assert.equal(protocol.parseEventLine("{not json").ok, false);
  assert.equal(protocol.parseEventLine(JSON.stringify({ event: "item.ready" })).ok, false);
});

// ---------------------------------------------------------------------------
// The draft flush policy (D5)
// ---------------------------------------------------------------------------

test("the flush policy is pinned, and sendBeacon is forbidden", () => {
  assert.equal(protocol.FLUSH.HELPER_DEBOUNCE_MS, 750);
  assert.deepEqual(protocol.FLUSH.IMMEDIATE_ON, ["blur", "ready", "navigation", "unload"]);
  assert.equal(protocol.FLUSH.TRANSPORT_ON_UNLOAD, "fetch keepalive");
  assert.equal(protocol.FLUSH.SEND_BEACON_IS_FORBIDDEN, true);
  assert.equal(protocol.FLUSH.KEEPALIVE_MAX_BYTES, 65536);
});

test("an oversize unload body is a delay, not a loss", () => {
  assert.equal(protocol.fitsKeepalive("x".repeat(1000)), true);
  assert.equal(protocol.fitsKeepalive("x".repeat(70000)), false);
  assert.match(protocol.FLUSH.OVERSIZE_FALLBACK, /next load/);
});

// ---------------------------------------------------------------------------
// The reply line (D6)
// ---------------------------------------------------------------------------

test("each status requires its own fields", () => {
  const ok = protocol.parseReplyLine('{"item":"c_7fa2","rev":2,"status":"handled","agent":"claude"}');
  assert.equal(ok.ok, true);
  assert.equal(ok.reply.status, "handled");
  assert.deepEqual(ok.reply.files, []);

  const noReason = protocol.parseReplyLine('{"item":"c_7fa2","rev":2,"status":"not_handled"}');
  assert.equal(noReason.ok, false);
  assert.match(noReason.reason, /reason/);

  const noText = protocol.parseReplyLine('{"item":"c_7fa2","rev":2,"status":"question"}');
  assert.equal(noText.ok, false);
  assert.match(noText.reason, /text/);

  const badStatus = protocol.parseReplyLine('{"item":"c_7fa2","rev":2,"status":"done"}');
  assert.equal(badStatus.ok, false);
  assert.match(badStatus.reason, /handled, not_handled, question/);
});

test("a malformed line is skipped with a reason, never thrown", () => {
  const bad = protocol.parseReplyLine("{oops");
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "REPLY_LINE_MALFORMED");
  assert.equal(typeof failures.describe(bad.code).message, "string");
  assert.equal(failures.describe(bad.code).persistent, true, "the chip stays until the reviewer dismisses it");
});

test("the line's agent beats the filename's agent", () => {
  const r = protocol.parseReplyLine('{"item":"c_1","rev":1,"status":"handled","agent":"codex"}', {
    filenameAgent: "claude"
  });
  assert.equal(r.reply.agent, "codex");
  const noAgent = protocol.parseReplyLine('{"item":"c_1","rev":1,"status":"handled"}', { filenameAgent: "claude" });
  assert.equal(noAgent.reply.agent, "claude");
});

test("the agent segment of a reply filename is a path component and is filtered", () => {
  assert.deepEqual(protocol.agentFromFilename("replies.jsonl"), { ok: true, agent: null, reason: null });
  assert.equal(protocol.agentFromFilename("replies-claude.jsonl").agent, "claude");
  assert.equal(protocol.agentFromFilename("replies-../../etc/passwd.jsonl").ok, false);
  assert.equal(protocol.agentFromFilename("replies-.jsonl").ok, false);
  assert.equal(protocol.agentFromFilename("notes.txt").ok, false);
});

test("the reply poll tracks a byte offset, resets on truncation, and holds a torn line", () => {
  assert.equal(protocol.REPLY_POLL.INTERVAL_MS, 250);
  assert.deepEqual(protocol.nextReadOffset(120, 400), { offset: 120, refold: false });
  assert.deepEqual(protocol.nextReadOffset(400, 120), { offset: 0, refold: true }, "a shorter file was rewritten, not appended to");
  const split = protocol.splitCompleteLines('{"a":1}\n{"b":2}\n{"c":3 half-written');
  assert.deepEqual(split.lines, ['{"a":1}', '{"b":2}']);
  assert.equal(split.remainder, '{"c":3 half-written', "the torn final line is held until it completes");
});

test("the library's reply cursor is a seq, not a timestamp", () => {
  assert.equal(protocol.REPLY_CURSOR_FIELD, "seq");
  assert.equal(protocol.route("replies.poll").request.includes("since=<seq>"), true);
});

// ---------------------------------------------------------------------------
// The request checks (D11)
// ---------------------------------------------------------------------------

const CONFIG = {
  reviews: {
    rev_a: { token: "tok_abc", origins: ["http://localhost:3000"] }
  }
};

function headers(overrides) {
  return Object.assign(
    {
      host: "127.0.0.1:7817",
      "x-lahe-client": "layer",
      "x-lahe-token": "tok_abc",
      "content-type": "application/json",
      origin: "http://localhost:3000"
    },
    overrides || {}
  );
}

test("a well-formed request from a registered origin passes every check", () => {
  const got = protocol.checkRequest({ routeName: "events.append", review: "rev_a", headers: headers() }, CONFIG);
  assert.equal(got.ok, true);
  assert.equal(got.review, "rev_a");
  assert.equal(got.origin, "http://localhost:3000");
});

test("every refusal names the check that failed", () => {
  const cases = [
    [{ host: "evil.example.com" }, protocol.CHECK.HOST, "PROTO_BAD_HOST"],
    [{ drop: "x-lahe-client" }, protocol.CHECK.CUSTOM_HEADER, "PROTO_MISSING_CUSTOM_HEADER"],
    [{ "content-type": "text/plain" }, protocol.CHECK.CONTENT_TYPE, "PROTO_UNSUPPORTED_MEDIA_TYPE"],
    [{ "x-lahe-token": "tok_wrong" }, protocol.CHECK.TOKEN, "PROTO_UNAUTHORIZED"],
    [{ origin: "https://attacker.example" }, protocol.CHECK.ORIGIN, "PROTO_FORBIDDEN_ORIGIN"]
  ];
  for (const [override, check, code] of cases) {
    const h = headers(override);
    if (override.drop) delete h[override.drop];
    delete h.drop;
    const got = protocol.checkRequest({ routeName: "events.append", review: "rev_a", headers: h }, CONFIG);
    assert.equal(got.ok, false, check + " should refuse");
    assert.equal(got.check, check);
    assert.equal(got.code, code);
    assert.equal(got.log.includes(check), true, "the log line names the failed check: " + got.log);
  }
});

test("the read routes are checked exactly like the write route", () => {
  // Finding 4: review.read and replies.poll are AUTH.REVIEW_TOKEN too. A fork
  // that let a read route skip the token, the custom header, or the origin would
  // let a page READ a review's feedback from anywhere, which is being driven from
  // outside just as surely as a forged write. Pinned at the unit layer so it
  // bites even where the browser cannot reach.
  ["review.read", "replies.poll"].forEach((routeName) => {
    // A well-formed read from the registered origin passes. Read routes are
    // non-mutating, so a JSON content type is not required and its absence here
    // (a GET carries no body) is fine.
    const ok = protocol.checkRequest({ routeName, review: "rev_a", headers: headers() }, CONFIG);
    assert.equal(ok.ok, true, routeName + " should pass a valid read");
    assert.equal(ok.review, "rev_a");

    const noHeaderH = headers();
    delete noHeaderH["x-lahe-client"];
    const noHeader = protocol.checkRequest({ routeName, review: "rev_a", headers: noHeaderH }, CONFIG);
    assert.equal(noHeader.ok, false, routeName + " must refuse a read with no custom header");
    assert.equal(noHeader.check, protocol.CHECK.CUSTOM_HEADER);

    const badToken = protocol.checkRequest(
      { routeName, review: "rev_a", headers: headers({ "x-lahe-token": "tok_wrong" }) },
      CONFIG
    );
    assert.equal(badToken.ok, false, routeName + " must refuse a read with a wrong token");
    assert.equal(badToken.check, protocol.CHECK.TOKEN);

    const noTokenH = headers();
    delete noTokenH["x-lahe-token"];
    const noToken = protocol.checkRequest({ routeName, review: "rev_a", headers: noTokenH }, CONFIG);
    assert.equal(noToken.ok, false, routeName + " must refuse a read with no token");
    assert.equal(noToken.check, protocol.CHECK.TOKEN);

    const badOrigin = protocol.checkRequest(
      { routeName, review: "rev_a", headers: headers({ origin: "https://attacker.example" }) },
      CONFIG
    );
    assert.equal(badOrigin.ok, false, routeName + " must refuse a read from an unregistered origin");
    assert.equal(badOrigin.check, protocol.CHECK.ORIGIN);
    assert.equal(badOrigin.log.includes(routeName), true, "the refusal names the read route: " + badOrigin.log);
  });
});

test("absent configuration fails closed", () => {
  const noConfig = protocol.checkRequest({ routeName: "events.append", review: "rev_a", headers: headers() }, null);
  assert.equal(noConfig.ok, false);
  assert.equal(noConfig.check, protocol.CHECK.REVIEW_KNOWN);
  const unknown = protocol.checkRequest({ routeName: "events.append", review: "rev_nope", headers: headers() }, CONFIG);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "PROTO_UNKNOWN_REVIEW");
});

test("the origin is read from the header, never from the body", () => {
  const forged = protocol.checkRequest(
    { routeName: "events.append", review: "rev_a", origin: "http://localhost:3000", headers: headers({ origin: "https://attacker.example" }) },
    CONFIG
  );
  assert.equal(forged.ok, false, "an origin in the request body cannot rescue a bad Origin header");
  assert.equal(forged.check, protocol.CHECK.ORIGIN);
});

test("a file page's null origin passes only when the review registered it", () => {
  const config = { reviews: { rev_f: { token: "t", origins: ["null"] } } };
  const h = { host: "localhost:7817", "x-lahe-client": "layer", "x-lahe-token": "t", "content-type": "application/json" };
  assert.equal(protocol.checkRequest({ routeName: "events.append", review: "rev_f", headers: h }, config).ok, true);
  assert.equal(
    protocol.checkRequest({ routeName: "events.append", review: "rev_f", headers: h }, { reviews: { rev_f: { token: "t", origins: [] } } }).ok,
    false
  );
});

// The two unauthenticated routes, and why each one is allowed to be: health
// carries liveness only, and library.get serves the tool's own public code (the
// same bytes as the file in the repo, no review data, no token). Anything else
// on the wire must ask for the per-review token.
const OPEN_ROUTES = ["health", "library.get"];

test("only health and the library route need no credential, and every other route does", () => {
  const h = { host: "127.0.0.1:7817" };
  OPEN_ROUTES.forEach((name) => {
    assert.equal(protocol.checkRequest({ routeName: name, headers: h }, null).ok, true, name + " needs no credential");
  });
  protocol.ROUTES.forEach((r) => {
    if (OPEN_ROUTES.includes(r.name)) return;
    assert.equal(r.auth, protocol.AUTH.REVIEW_TOKEN, r.name + " must require the per-review token");
    const required = protocol.requiredHeaders(r.name).map((x) => x.header);
    assert.equal(required.includes(protocol.HEADER.CLIENT), true);
    assert.equal(required.includes(protocol.HEADER.TOKEN), true);
    if (r.mutating) assert.equal(required.includes(protocol.HEADER.CONTENT_TYPE), true);
  });
});

test("the error body carries the code, the remedy, and the failed check", () => {
  const body = protocol.errorBody("PROTO_FORBIDDEN_ORIGIN", "https://attacker.example", "req_1", protocol.CHECK.ORIGIN);
  assert.equal(body.error.code, "PROTO_FORBIDDEN_ORIGIN");
  assert.equal(body.error.check, "origin");
  assert.equal(body.error.request_id, "req_1");
  assert.equal(protocol.statusFor("PROTO_FORBIDDEN_ORIGIN"), 403);
  assert.equal(protocol.statusFor("PROTO_UNAUTHORIZED"), 401);
  assert.equal(protocol.statusFor("SOMETHING_UNMAPPED"), 500);
});

// ---------------------------------------------------------------------------
// The script tag (D1)
// ---------------------------------------------------------------------------

test("the script tag has the pinned attributes and the fixed default port", () => {
  assert.equal(protocol.DEFAULT_PORT, 7817);
  assert.equal(protocol.DEFAULT_HELPER_ORIGIN, "http://127.0.0.1:7817");
  const tag = protocol.scriptTag({ src: "/lahe/lahe-layer.js", review: "rev_a", token: "tok_abc" });
  assert.equal(tag.includes('data-lahe-review="rev_a"'), true);
  assert.equal(tag.includes('data-lahe-token="tok_abc"'), true);
  assert.equal(tag.includes('data-lahe-helper="http://127.0.0.1:7817"'), true);
  assert.equal(/\sdefer>/.test(tag), true);
  assert.equal(protocol.SCRIPT_SELECTOR, "script[data-lahe-review]");
  // No fallback asked for, no fallback written: a caller serving the bundle
  // itself gets the plain line.
  assert.equal(tag.includes("onerror"), false);
  assert.equal(tag.includes(protocol.SCRIPT_ATTR.FALLBACK), false);
});

// R10: the offline half. The fallback is what makes a page opened with the
// helper down load the library at all, so the form it takes is pinned here.
test("the script tag carries the offline fallback when one is named", () => {
  const tag = protocol.scriptTag({
    src: "http://127.0.0.1:7817/lahe-layer.js",
    review: "rev_a",
    token: "tok_abc",
    fallback: "lahe-layer.js"
  });
  assert.equal(
    tag,
    '<script src="http://127.0.0.1:7817/lahe-layer.js"\n' +
      '        data-lahe-review="rev_a"\n' +
      '        data-lahe-token="tok_abc"\n' +
      '        data-lahe-helper="http://127.0.0.1:7817"\n' +
      '        data-lahe-fallback="lahe-layer.js"\n' +
      "        onerror=\"var s=document.createElement('script');s.src=this.getAttribute('data-lahe-fallback');document.head.appendChild(s)\"\n" +
      "        defer></script>"
  );
  assert.equal(tag.includes(protocol.SCRIPT_FALLBACK_ONERROR), true);

  // Two properties the onerror has to keep, because add.js's EXISTING_TAG scans
  // to the first ">" inside double quotes: no ">" in it, and no double quote.
  assert.equal(protocol.SCRIPT_FALLBACK_ONERROR.indexOf(">"), -1);
  assert.equal(protocol.SCRIPT_FALLBACK_ONERROR.indexOf('"'), -1);
});

test("the script tag refuses to be written without a token or with an unsafe review id", () => {
  assert.throws(() => protocol.scriptTag({ src: "x.js", review: "rev_a" }), /token/);
  assert.throws(() => protocol.scriptTag({ src: "x.js", review: "../etc", token: "t" }), /safe id/);
});

// ---------------------------------------------------------------------------
// The failure table
// ---------------------------------------------------------------------------

test("the new failure codes exist and the pruned ones are gone", () => {
  ["HELPER_UNREACHABLE", "CSP_REFUSED", "SECOND_WINDOW_REFUSED", "ANCHOR_LOST", "REPLAY_NEITHER_MATCHES", "REPLY_LINE_MALFORMED"].forEach(
    (code) => assert.equal(typeof failures.describe(code).message, "string", code)
  );
  ["VERIFY_NOT_FOUND", "VERIFY_NOT_VERIFIABLE", "PROTO_NOT_DELIVERED", "PROTO_TARGET_MISMATCH"].forEach((code) =>
    assert.equal(failures.CODE_NAMES.includes(code), false, code + " belonged to the send and ack model")
  );
});

test("an old spelling resolves to its canonical code and keeps its own name", () => {
  const f = failures.failure("SYNC_SERVICE_DOWN", null);
  assert.equal(f.code, "SYNC_SERVICE_DOWN");
  assert.equal(f.canonical_code, "HELPER_UNREACHABLE");
  assert.equal(failures.canonical("SECOND_TAB_REFUSED"), "SECOND_WINDOW_REFUSED");
  assert.equal(failures.canonical("ANCHOR_NOT_FOUND"), "ANCHOR_LOST");
});

test("telling a CSP refusal from a helper that is down is two codes, not one", () => {
  assert.notEqual(failures.describe("CSP_REFUSED").message, failures.describe("HELPER_UNREACHABLE").message);
  assert.match(failures.describe("CSP_REFUSED").message, /not the helper being down/);
});
