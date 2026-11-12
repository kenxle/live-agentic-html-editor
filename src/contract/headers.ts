/*
 * read-when: Changing a header name or value on the wire, or the signed-request format the menu bar app uses.
 */

export const HEADER = {
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
} as const;

export const CLIENT_LAYER = "layer";
export const CLIENT_CLI = "cli";
export const CLIENT_CATALOG = "catalog";
export type ReviewClient = typeof CLIENT_LAYER | typeof CLIENT_CLI;

export const JSON_CONTENT_TYPE = "application/json";

export const PROOF: {
  readonly REQUEST_PREFIX: "lahe-proof-v1";
  readonly REPLY_PREFIX: "lahe-proof-reply-v1";
  readonly WINDOW_MS: 30000;
  readonly TS_PATTERN: RegExp;
  readonly NONCE_PATTERN: RegExp;
  readonly MAC_PATTERN: RegExp;
} = {
  REQUEST_PREFIX: "lahe-proof-v1",
  REPLY_PREFIX: "lahe-proof-reply-v1",
  WINDOW_MS: 30000,
  TS_PATTERN: /^[0-9]{1,16}$/,
  NONCE_PATTERN: /^[0-9a-f]{32}$/,
  MAC_PATTERN: /^[0-9a-f]{64}$/
};

export const SUMMARY_VERSION = 1;
