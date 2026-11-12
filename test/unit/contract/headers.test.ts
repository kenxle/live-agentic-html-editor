/*
 * read-when: Changing src/contract/headers.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLIENT_CATALOG,
  CLIENT_CLI,
  CLIENT_LAYER,
  HEADER,
  JSON_CONTENT_TYPE,
  PROOF,
  SUMMARY_VERSION
} from "../../../src/contract/headers.ts";

test("the header names are exactly these, all lowercase", () => {
  assert.deepEqual(HEADER, {
    CLIENT: "x-lahe-client",
    TOKEN: "x-lahe-token",
    REQUEST_ID: "x-lahe-request-id",
    CONTENT_TYPE: "content-type",
    ORIGIN: "origin",
    HOST: "host",
    SEC_FETCH_SITE: "sec-fetch-site",
    SEC_FETCH_MODE: "sec-fetch-mode",
    SEC_FETCH_DEST: "sec-fetch-dest",
    CLI_SECRET: "x-lahe-cli-secret",
    PROOF_TS: "x-lahe-proof-ts",
    PROOF_NONCE: "x-lahe-proof-nonce",
    PROOF: "x-lahe-proof",
    PROOF_REPLY: "x-lahe-proof-reply"
  });
  for (const name of Object.values(HEADER)) assert.equal(name, name.toLowerCase(), name);
});

test("the client values are layer, cli and catalog, and the content type is JSON", () => {
  assert.equal(CLIENT_LAYER, "layer");
  assert.equal(CLIENT_CLI, "cli");
  assert.equal(CLIENT_CATALOG, "catalog");
  assert.equal(JSON_CONTENT_TYPE, "application/json");
});

test("the signed-request wire has these prefixes, this window and this summary version", () => {
  assert.equal(PROOF.REQUEST_PREFIX, "lahe-proof-v1");
  assert.equal(PROOF.REPLY_PREFIX, "lahe-proof-reply-v1");
  assert.equal(PROOF.WINDOW_MS, 30000);
  assert.equal(SUMMARY_VERSION, 1);
  assert.deepEqual(Object.keys(PROOF).sort(), ["MAC_PATTERN", "NONCE_PATTERN", "REPLY_PREFIX", "REQUEST_PREFIX", "TS_PATTERN", "WINDOW_MS"]);
});

test("a proof timestamp is 1 to 16 ASCII digits and nothing else", () => {
  for (const ts of ["0", "1", "1700000000000", "1".repeat(16)]) assert.equal(PROOF.TS_PATTERN.test(ts), true, ts);
  for (const ts of ["", "1".repeat(17), "12a", "-1", "1.5", " 1", "1\n", "١٢"]) assert.equal(PROOF.TS_PATTERN.test(ts), false, JSON.stringify(ts));
});

test("a proof nonce is exactly 32 lowercase hex digits", () => {
  const nonce = "0123456789abcdef0123456789abcdef";
  assert.equal(nonce.length, 32);
  assert.equal(PROOF.NONCE_PATTERN.test(nonce), true);
  for (const bad of [nonce.slice(1), nonce + "0", nonce.toUpperCase(), "g" + nonce.slice(1), "", nonce + "\n"]) {
    assert.equal(PROOF.NONCE_PATTERN.test(bad), false, JSON.stringify(bad));
  }
});

test("a proof MAC is exactly 64 lowercase hex digits", () => {
  const mac = "0123456789abcdef".repeat(4);
  assert.equal(mac.length, 64);
  assert.equal(PROOF.MAC_PATTERN.test(mac), true);
  for (const bad of [mac.slice(1), mac + "0", mac.toUpperCase(), "g" + mac.slice(1), "", mac + "\n"]) {
    assert.equal(PROOF.MAC_PATTERN.test(bad), false, JSON.stringify(bad));
  }
});
