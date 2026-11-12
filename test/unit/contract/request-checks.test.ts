/*
 * read-when: Changing src/contract/request-checks.ts, the order of the per-request checks, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK, CHECKS, checkRequest } from "../../../src/contract/request-checks.ts";
import type { CheckCode, CheckName, CheckResult, RequestHeaders, ReviewAuthConfig } from "../../../src/contract/request-checks.ts";
import { ROUTES } from "../../../src/contract/routes.ts";
import type { ReviewRouteName } from "../../../src/contract/routes.ts";
import { callUntyped } from "./support/untyped.ts";

const CONFIG: ReviewAuthConfig = {
  reviews: {
    rev_a: { token: "tok_abc", origins: ["http://localhost:3000"] },
    rev_f: { token: "t", origins: ["null"] },
    rev_none: { token: "t", origins: [] },
    rev_blank: { token: "", origins: ["http://localhost:3000"] }
  }
};

type Overrides = Readonly<Record<string, string | undefined>>;

function headers(overrides?: Overrides): RequestHeaders {
  const merged: Record<string, string | undefined> = {
    host: "127.0.0.1:7817",
    "x-lahe-client": "layer",
    "x-lahe-token": "tok_abc",
    "content-type": "application/json",
    origin: "http://localhost:3000",
    ...overrides
  };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

function run(routeName: ReviewRouteName, requestHeaders: RequestHeaders, review: unknown = "rev_a", config: ReviewAuthConfig | null = CONFIG): CheckResult {
  return checkRequest({ routeName, headers: requestHeaders, review }, config);
}

function refused(routeName: string, name: CheckName, code: CheckCode, detail?: string): CheckResult {
  const log = "refused " + routeName + ": check " + name + " failed" + (detail === undefined ? "" : " (" + detail + ")");
  return { ok: false, check: name, code, log };
}

test("the nine checks, in order, with the failure code each one raises", () => {
  assert.deepEqual(CHECK, {
    HOST: "host",
    CUSTOM_HEADER: "custom_header",
    CONTENT_TYPE: "content_type",
    REVIEW_KNOWN: "review_known",
    TOKEN: "token",
    ORIGIN: "origin",
    SEC_FETCH_SITE: "sec_fetch_site",
    SEC_FETCH: "sec_fetch",
    PROOF: "proof"
  });
  assert.deepEqual(CHECKS, [
    { name: "host", code: "PROTO_BAD_HOST" },
    { name: "custom_header", code: "PROTO_MISSING_CUSTOM_HEADER" },
    { name: "content_type", code: "PROTO_UNSUPPORTED_MEDIA_TYPE" },
    { name: "review_known", code: "PROTO_UNKNOWN_REVIEW" },
    { name: "token", code: "PROTO_UNAUTHORIZED" },
    { name: "origin", code: "PROTO_FORBIDDEN_ORIGIN" },
    { name: "sec_fetch_site", code: "PROTO_CROSS_SITE" },
    { name: "sec_fetch", code: "AUTH_REFUSED" },
    { name: "proof", code: "AUTH_REFUSED" }
  ]);
});

test("a well-formed request from a registered origin passes every check", () => {
  assert.deepEqual(run("events.append", headers()), { ok: true, review: "rev_a", origin: "http://localhost:3000" });
});

test("every refusal names the check that failed, with its code, and a log line that names the route and the check", () => {
  assert.deepEqual(run("events.append", headers({ host: "evil.example.com" })), refused("events.append", "host", "PROTO_BAD_HOST", "evil.example.com"));
  assert.deepEqual(run("events.append", headers({ "x-lahe-client": undefined })), refused("events.append", "custom_header", "PROTO_MISSING_CUSTOM_HEADER"));
  assert.deepEqual(
    run("events.append", headers({ "content-type": "text/plain" })),
    refused("events.append", "content_type", "PROTO_UNSUPPORTED_MEDIA_TYPE", "text/plain")
  );
  assert.deepEqual(run("events.append", headers(), "rev_nope"), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "rev_nope"));
  assert.deepEqual(run("events.append", headers({ "x-lahe-token": "tok_wrong" })), refused("events.append", "token", "PROTO_UNAUTHORIZED"));
  assert.deepEqual(
    run("events.append", headers({ origin: "https://attacker.example" })),
    refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "https://attacker.example")
  );
});

test("a request that fails several checks reports the first, in the order host, custom header, content type, review, token, origin", () => {
  const route = "events.append";
  assert.deepEqual(
    run(route, headers({ host: "evil.example.com", "x-lahe-client": undefined })),
    refused(route, "host", "PROTO_BAD_HOST", "evil.example.com")
  );
  assert.deepEqual(
    run(route, headers({ "x-lahe-client": undefined, "content-type": "text/plain" }), "rev_nope"),
    refused(route, "custom_header", "PROTO_MISSING_CUSTOM_HEADER")
  );
  assert.deepEqual(
    run(route, headers({ "content-type": "text/plain", "x-lahe-token": undefined }), "rev_nope"),
    refused(route, "content_type", "PROTO_UNSUPPORTED_MEDIA_TYPE", "text/plain")
  );
  assert.deepEqual(
    run(route, headers({ "x-lahe-token": "tok_wrong", origin: "https://attacker.example" }), "rev_nope"),
    refused(route, "review_known", "PROTO_UNKNOWN_REVIEW", "rev_nope")
  );
  assert.deepEqual(
    run(route, headers({ "x-lahe-token": "tok_wrong", origin: "https://attacker.example" })),
    refused(route, "token", "PROTO_UNAUTHORIZED")
  );
});

test("the host and origin of an open route: once the host passes, the origin header or null comes back and nothing else runs", () => {
  for (const name of ["health", "library.get"] as const) {
    assert.deepEqual(checkRequest({ routeName: name, headers: { host: "127.0.0.1:7817" } }, null), { ok: true, review: null, origin: null }, name);
    assert.deepEqual(
      checkRequest({ routeName: name, headers: { host: "localhost", origin: "https://anywhere.example" } }, null),
      { ok: true, review: null, origin: "https://anywhere.example" },
      name
    );
    assert.deepEqual(checkRequest({ routeName: name, headers: { host: "localhost", origin: "" } }, null), { ok: true, review: null, origin: null }, name);
    assert.deepEqual(
      checkRequest({ routeName: name, headers: { host: "evil.example.com" } }, null),
      refused(name, "host", "PROTO_BAD_HOST", "evil.example.com"),
      name
    );
  }
});

test("the host check's detail is the header as text, and a missing header is the word null", () => {
  assert.deepEqual(run("events.append", headers({ host: undefined })), refused("events.append", "host", "PROTO_BAD_HOST", "null"));
  assert.deepEqual(checkRequest({ routeName: "health", headers: {} }, null), refused("health", "host", "PROTO_BAD_HOST", "null"));
  assert.deepEqual(run("events.append", headers({ host: "::1" })), refused("events.append", "host", "PROTO_BAD_HOST", "::1"));
  assert.deepEqual(
    checkRequest({ routeName: "events.append", headers: { host: ["localhost", "evil.example"] }, review: "rev_a" }, CONFIG),
    refused("events.append", "host", "PROTO_BAD_HOST", "localhost,evil.example")
  );
});

test("the custom header must be exactly layer or cli: catalog, another value, other case, a list, or none is refused with no detail", () => {
  for (const client of ["layer", "cli"]) {
    assert.equal(run("review.read", headers({ "x-lahe-client": client })).ok, true, client);
  }
  for (const client of ["catalog", "Layer", "LAYER", "layer ", "", "browser"]) {
    assert.deepEqual(
      run("review.read", headers({ "x-lahe-client": client })),
      refused("review.read", "custom_header", "PROTO_MISSING_CUSTOM_HEADER"),
      JSON.stringify(client)
    );
  }
  assert.deepEqual(
    checkRequest({ routeName: "review.read", headers: { host: "localhost", "x-lahe-client": ["layer"] }, review: "rev_a" }, CONFIG),
    refused("review.read", "custom_header", "PROTO_MISSING_CUSTOM_HEADER")
  );
});

test("a mutating route takes a JSON content type: parameters and other case pass, anything else is refused with the media type or none", () => {
  for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON", " application/json ;x=1", "APPLICATION/JSON;charset=UTF-8"]) {
    assert.equal(run("events.append", headers({ "content-type": type })).ok, true, type);
  }
  assert.deepEqual(run("events.append", headers({ "content-type": "text/plain; charset=utf-8" })), refused("events.append", "content_type", "PROTO_UNSUPPORTED_MEDIA_TYPE", "text/plain"));
  assert.deepEqual(run("events.append", headers({ "content-type": "Text/Plain" })), refused("events.append", "content_type", "PROTO_UNSUPPORTED_MEDIA_TYPE", "text/plain"));
  assert.deepEqual(run("events.append", headers({ "content-type": undefined })), refused("events.append", "content_type", "PROTO_UNSUPPORTED_MEDIA_TYPE", "none"));
  assert.deepEqual(run("events.append", headers({ "content-type": "" })), refused("events.append", "content_type", "PROTO_UNSUPPORTED_MEDIA_TYPE", "none"));
  assert.deepEqual(run("events.append", headers({ "content-type": "application/jsonp" })), refused("events.append", "content_type", "PROTO_UNSUPPORTED_MEDIA_TYPE", "application/jsonp"));
});

test("a GET route skips the content type check, with a body type or without one", () => {
  for (const type of [undefined, "text/plain", "application/json"]) {
    assert.equal(run("review.read", headers({ "content-type": type })).ok, true, String(type));
    assert.equal(run("replies.poll", headers({ "content-type": type })).ok, true, String(type));
  }
});

test("the review must be known: no configuration, no reviews, an unsafe id, an unregistered id and an inherited property name are all refused", () => {
  assert.deepEqual(run("events.append", headers(), "rev_a", null), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "rev_a"));
  assert.deepEqual(callUntyped(checkRequest, { routeName: "events.append", headers: headers(), review: "rev_a" }, {}), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "rev_a"));
  assert.deepEqual(run("events.append", headers(), "rev_nope"), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "rev_nope"));
  assert.deepEqual(run("events.append", headers(), "../etc"), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "../etc"));
  assert.deepEqual(run("events.append", headers(), "constructor"), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "constructor"));
  assert.deepEqual(run("events.append", headers(), "toString"), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "toString"));
  assert.deepEqual(run("events.append", headers(), "__proto__"), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "__proto__"));
  assert.deepEqual(
    checkRequest({ routeName: "events.append", headers: headers() }, CONFIG),
    refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "undefined")
  );
  assert.deepEqual(run("events.append", headers(), 7), refused("events.append", "review_known", "PROTO_UNKNOWN_REVIEW", "7"));
});

test("the token must be present, non-empty, a string and equal in full: a prefix, a longer token, other case and a list are refused with no detail", () => {
  const wrong = refused("events.append", "token", "PROTO_UNAUTHORIZED");
  for (const presented of ["tok_wrong", "tok_ab", "tok_abcd", "TOK_ABC", "tok_abc ", " tok_abc", "", "tok_abc\u0000"]) {
    assert.deepEqual(run("events.append", headers({ "x-lahe-token": presented })), wrong, JSON.stringify(presented));
  }
  assert.deepEqual(run("events.append", headers({ "x-lahe-token": undefined })), wrong);
  assert.deepEqual(
    checkRequest({ routeName: "events.append", headers: { ...headers(), "x-lahe-token": ["tok_abc"] }, review: "rev_a" }, CONFIG),
    wrong
  );
  assert.deepEqual(run("events.append", headers({ "x-lahe-token": "" }), "rev_blank"), wrong, "a review registered with an empty token fails closed");
  assert.deepEqual(run("events.append", headers({ "x-lahe-token": undefined }), "rev_blank"), wrong);
});

test("the origin comes from the header, or is the word null when the header is missing or empty, and must be registered", () => {
  assert.deepEqual(
    run("events.append", headers({ origin: "https://attacker.example" })),
    refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "https://attacker.example")
  );
  assert.deepEqual(run("events.append", headers({ origin: undefined })), refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "null"));
  assert.deepEqual(run("events.append", headers({ origin: "" })), refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "null"));
  assert.deepEqual(run("events.append", headers({ origin: "http://localhost:3000/" })), refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "http://localhost:3000/"));
});

test("a file page's null origin passes only when the review registered it", () => {
  const file = headers({ "x-lahe-token": "t", host: "localhost:7817", origin: undefined });
  assert.deepEqual(run("events.append", file, "rev_f"), { ok: true, review: "rev_f", origin: "null" });
  assert.deepEqual(run("events.append", headers({ "x-lahe-token": "t", origin: "null" }), "rev_f"), { ok: true, review: "rev_f", origin: "null" });
  assert.deepEqual(run("events.append", file, "rev_none"), refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "null"));
  assert.deepEqual(
    run("events.append", headers({ "x-lahe-token": "t", origin: undefined }), "rev_none"),
    refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "null")
  );
});

test("the origin is read from the header, never from the request's body", () => {
  const forged = callUntyped(
    checkRequest,
    { routeName: "events.append", review: "rev_a", origin: "http://localhost:3000", headers: headers({ origin: "https://attacker.example" }) },
    CONFIG
  );
  assert.deepEqual(forged, refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "https://attacker.example"));
  const absent = callUntyped(checkRequest, { routeName: "events.append", review: "rev_a", origin: "http://localhost:3000", headers: headers({ origin: undefined }) }, CONFIG);
  assert.deepEqual(absent, refused("events.append", "origin", "PROTO_FORBIDDEN_ORIGIN", "null"));
});

test("header names match in any letter case", () => {
  const mixed: RequestHeaders = {
    Host: "127.0.0.1:7817",
    "X-Lahe-Client": "layer",
    "X-Lahe-Token": "tok_abc",
    "CONTENT-TYPE": "application/json",
    Origin: "http://localhost:3000"
  };
  assert.deepEqual(run("events.append", mixed), { ok: true, review: "rev_a", origin: "http://localhost:3000" });
  assert.deepEqual(checkRequest({ routeName: "health", headers: { HOST: "localhost" } }, null), { ok: true, review: null, origin: null });
});

test("the read routes are checked exactly like the write route", () => {
  for (const name of ["review.read", "records.read", "replies.poll"] as const) {
    assert.deepEqual(run(name, headers({ "content-type": undefined })), { ok: true, review: "rev_a", origin: "http://localhost:3000" }, name);
    assert.deepEqual(run(name, headers({ "x-lahe-client": undefined })), refused(name, "custom_header", "PROTO_MISSING_CUSTOM_HEADER"), name);
    assert.deepEqual(run(name, headers({ "x-lahe-token": "tok_wrong" })), refused(name, "token", "PROTO_UNAUTHORIZED"), name);
    assert.deepEqual(run(name, headers({ "x-lahe-token": undefined })), refused(name, "token", "PROTO_UNAUTHORIZED"), name);
    assert.deepEqual(
      run(name, headers({ origin: "https://attacker.example" })),
      refused(name, "origin", "PROTO_FORBIDDEN_ORIGIN", "https://attacker.example"),
      name
    );
  }
});

test("every route but health and library.get refuses a request with no custom header and one with no token, and every mutating one refuses text/plain", () => {
  const open = ["health", "library.get"];
  for (const entry of ROUTES) {
    if (open.includes(entry.name)) continue;
    assert.equal(entry.auth, "review_token", entry.name + " must require the per-review token");
    const noClient = run(entry.name, headers({ "x-lahe-client": undefined }));
    assert.equal(noClient.ok ? "" : noClient.check, "custom_header", entry.name);
    const noToken = run(entry.name, headers({ "x-lahe-token": undefined }));
    assert.equal(noToken.ok ? "" : noToken.check, "token", entry.name);
    if (entry.mutating) {
      const plain = run(entry.name, headers({ "content-type": "text/plain" }));
      assert.equal(plain.ok ? "" : plain.check, "content_type", entry.name);
    }
  }
});

test("checkRequest throws for a route that is not a review route, including the Library, site and summary routes", () => {
  for (const name of ["nope", "catalog.list", "site.bind", "review.retire", "summary.read", undefined]) {
    assert.throws(() => callUntyped(checkRequest, { routeName: name, headers: headers(), review: "rev_a" }, CONFIG), /unknown route/, String(name));
  }
});
