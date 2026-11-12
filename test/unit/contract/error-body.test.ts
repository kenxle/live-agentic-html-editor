/*
 * read-when: Changing src/contract/error-body.ts, the HTTP status a failure code answers with, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { errorBody, statusFor } from "../../../src/contract/error-body.ts";
import { CODES } from "../../../src/contract/failures.ts";
import { callUntyped } from "./support/untyped.ts";

const STATUSES: readonly (readonly [number, readonly string[]])[] = [
  [400, ["PROTO_BAD_REQUEST", "PROTO_BAD_HOST", "PROTO_MISSING_CUSTOM_HEADER"]],
  [415, ["PROTO_UNSUPPORTED_MEDIA_TYPE"]],
  [401, ["PROTO_UNAUTHORIZED", "AUTH_REFUSED"]],
  [403, ["PROTO_FORBIDDEN_ORIGIN", "PROTO_NOT_OWNER", "PROTO_CROSS_SITE"]],
  [404, ["PROTO_UNKNOWN_REVIEW", "PROTO_UNKNOWN_ITEM"]],
  [
    409,
    [
      "PROTO_STALE_REV",
      "PROTO_SECOND_WINDOW",
      "PROTO_SECOND_INSTANCE",
      "PROTO_NOT_OPENABLE",
      "PROTO_REQUEST_PENDING",
      "PROTO_NO_AGENT",
      "PROTO_CONFIRM_NEEDED",
      "PROTO_NO_LAUNCH",
      "SUMMARY_VERSION"
    ]
  ],
  [410, ["PROTO_REVIEW_RETIRED"]],
  [429, ["PROTO_QUEUE_FULL"]],
  [500, ["PROTO_CATALOG_UNREADABLE"]]
];

test("each code answers with its own HTTP status", () => {
  for (const [status, codes] of STATUSES) {
    for (const code of codes) assert.equal(statusFor(code), status, code);
  }
});

test("a code with no status is a 500, including an unmapped name and an inherited property name", () => {
  for (const code of ["SOMETHING_UNMAPPED", "toString", "constructor", "__proto__", "hasOwnProperty", "", "proto_bad_host"]) {
    assert.equal(statusFor(code), 500, JSON.stringify(code));
  }
});

test("every status the table names is for a code the failure table knows, or for the two the server signs itself", () => {
  const signed = ["AUTH_REFUSED", "SUMMARY_VERSION"];
  for (const [, codes] of STATUSES) {
    for (const code of codes) {
      if (signed.includes(code)) assert.equal(Object.hasOwn(CODES, code), false, code + " is signed by the server, not worded here");
      else assert.equal(Object.hasOwn(CODES, code), true, code);
    }
  }
});

test("the error body carries the code, the message, the remedy, the detail, the failed check and the request id", () => {
  const body = errorBody("PROTO_FORBIDDEN_ORIGIN", "https://attacker.example", "req_1", "origin");
  assert.equal(body.error.code, "PROTO_FORBIDDEN_ORIGIN");
  assert.equal(body.error.message, CODES.PROTO_FORBIDDEN_ORIGIN.message);
  assert.equal(body.error.remedy, CODES.PROTO_FORBIDDEN_ORIGIN.remedy);
  assert.equal(body.error.detail, "https://attacker.example");
  assert.equal(body.error.check, "origin");
  assert.equal(body.error.request_id, "req_1");
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error), ["code", "message", "remedy", "detail", "check", "request_id"]);
});

test("a remedy the failure table has comes through, and what is not given is null", () => {
  const bare = errorBody("PROTO_UNAUTHORIZED");
  assert.deepEqual(bare, {
    error: {
      code: "PROTO_UNAUTHORIZED",
      message: CODES.PROTO_UNAUTHORIZED.message,
      remedy: CODES.PROTO_UNAUTHORIZED.remedy,
      detail: null,
      check: null,
      request_id: null
    }
  });
  const withRemedy = errorBody("PROTO_NO_LAUNCH", null, null, null);
  assert.equal(withRemedy.error.remedy, CODES.PROTO_NO_LAUNCH.remedy);
  assert.equal(typeof withRemedy.error.remedy, "string");
  assert.equal(withRemedy.error.detail, null);
});

test("an old spelling of a code stays that spelling in the body, with the words of its canonical code", () => {
  const body = callUntyped(errorBody, "SYNC_SERVICE_DOWN", null, "req_9", null);
  assert.deepEqual(body, {
    error: {
      code: "SYNC_SERVICE_DOWN",
      message: CODES.HELPER_UNREACHABLE.message,
      remedy: CODES.HELPER_UNREACHABLE.remedy,
      detail: null,
      check: null,
      request_id: "req_9"
    }
  });
});

test("a code the failure table does not know throws the failure table's own error", () => {
  for (const code of ["NOT_A_CODE", "AUTH_REFUSED", "SUMMARY_VERSION", "toString"]) {
    assert.throws(() => callUntyped(errorBody, code), { message: "unknown failure code: " + code + ". Add it to src/contract/failures.ts" }, code);
  }
});
