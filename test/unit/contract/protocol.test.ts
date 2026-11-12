/*
 * read-when: Changing src/contract/protocol.ts, the forwarder at src/shared/protocol.js, or the protocol's place in the layer and Library bundles, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import vm from "node:vm";
import * as agentCommands from "../../../src/contract/agent-commands.ts";
import * as agentLiveness from "../../../src/contract/agent-liveness.ts";
import * as errorBody from "../../../src/contract/error-body.ts";
import * as events from "../../../src/contract/events.ts";
import * as flush from "../../../src/contract/flush.ts";
import * as headers from "../../../src/contract/headers.ts";
import * as helperAddress from "../../../src/contract/helper-address.ts";
import * as jsonObject from "../../../src/contract/json-object.ts";
import * as library from "../../../src/contract/library.ts";
import * as replies from "../../../src/contract/replies.ts";
import * as requestChecks from "../../../src/contract/request-checks.ts";
import * as reviewWrite from "../../../src/contract/review-write.ts";
import * as routes from "../../../src/contract/routes.ts";
import * as safeId from "../../../src/contract/safe-id.ts";
import * as scriptTag from "../../../src/contract/script-tag.ts";
import * as serviceContract from "../../../src/contract/service-contract.ts";
import * as siteAddresses from "../../../src/contract/site-addresses.ts";
import { isJsonObject } from "../../../src/contract/json-object.ts";

const MODULES: readonly Readonly<Record<string, unknown>>[] = [
  agentCommands,
  agentLiveness,
  errorBody,
  events,
  flush,
  headers,
  helperAddress,
  jsonObject,
  library,
  replies,
  requestChecks,
  reviewWrite,
  routes,
  safeId,
  scriptTag,
  serviceContract,
  siteAddresses
];

const NAMES = [
  "AGENT_LIVENESS", "ALIAS_MAX", "API_VERSION", "AUTH", "BASE", "CATALOG", "CATALOG_LOG", "CATALOG_PAGE_PATH",
  "CATALOG_ROUTES", "CATALOG_TOKEN_META", "CHECK", "CHECKS", "CLIENT_CATALOG", "CLIENT_CLI", "CLIENT_LAYER",
  "CLI_EXIT", "CONTRACT_VERDICT", "DEFAULT_HELPER_ORIGIN", "DEFAULT_HOST", "DEFAULT_PORT", "DOCUMENT_ON", "EVENT",
  "EVENT_FIELD", "EVENT_TYPES", "FLUSH", "FRAMES_ALLOW", "HEADER", "HEALTH_FIELD", "HOST_FAMILY", "IDEMPOTENCE_KEY",
  "JSON_CONTENT_TYPE", "LOOPBACK_ORIGIN_HOSTS", "MONITOR", "NOTES_ON", "ORIGIN_LIMIT", "PAGES", "PROOF",
  "REPLY_CURSOR_FIELD", "REPLY_FIELD", "REPLY_FILE", "REPLY_POLL", "REPLY_STATUS", "REPLY_STATUSES", "ROUTES",
  "SAFE_ID", "SCRIPT_ATTR", "SCRIPT_FALLBACK_ONERROR", "SCRIPT_SELECTOR", "SERVICE_CONTRACT", "SITE_ROUTES",
  "START_HIDDEN", "SUGGESTIONS_MAX", "SUGGESTION_TEXT_MAX", "SUMMARY_ROUTES", "SUMMARY_VERSION", "WAKE",
  "acceptsNotesFlag", "agentFromFilename", "catalogLogLine", "checkRequest", "classifyHost", "drainCommand",
  "encodeEventLine", "errorBody", "fitsKeepalive", "handoffMessage", "helperContractVerdict", "hostAllowed",
  "isJsonObject", "isLoopbackPortOrigin", "isPathAlias", "isRegisterableOrigin", "isSafeId", "isSiteLabel",
  "isSiteName", "isSpelling", "isSpellingOrigin", "legacyPickupNote", "livenessOverdue", "monitorCommand",
  "newEvent", "nextReadOffset", "parseEventLine", "parseReplyLine", "route", "scriptTag", "siteNameFromOrigin",
  "siteOrigin", "splitCompleteLines", "stateDirFlag", "statusFor", "takeoverCommand"
];

const GONE = [
  "ALLOWED_HOST_NAMES",
  "CLIENTS",
  "CATALOG_API_BASE",
  "STATUS_FOR_CODE",
  "REPLY_REQUIRED",
  "byteLength",
  "checkNamed",
  "reviewCommand",
  "requiredHeaders",
  "CATALOG_LEGACY_NOTE",
  "overdue"
];

const load = createRequire(import.meta.url);

function forwarded(): Readonly<Record<string, unknown>> {
  const old: unknown = load("../../../src/shared/protocol.js");
  assert.ok(isJsonObject(old));
  return old;
}

function sorted(object: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(object).sort();
}

test("the old path hands back every export of the seventeen modules under its own name, and the same values", () => {
  const old = forwarded();
  const union = new Set(MODULES.flatMap((module) => Object.keys(module)));
  assert.deepEqual(sorted(old), [...union].sort());
  assert.deepEqual(sorted(old), NAMES);
  for (const module of MODULES) {
    for (const [name, value] of Object.entries(module)) assert.equal(old[name], value, name);
  }
});

test("no module exports a name another one already exports", () => {
  const seen = new Map<string, number>();
  MODULES.forEach((module, index) => {
    for (const name of Object.keys(module)) {
      assert.equal(seen.has(name), false, name + " is exported by two modules");
      seen.set(name, index);
    }
  });
});

test("the names removed or moved off the protocol are gone, including the two functions that hung on AGENT_LIVENESS", () => {
  const old = forwarded();
  for (const name of GONE) assert.equal(Object.hasOwn(old, name), false, name);
  const liveness = old["AGENT_LIVENESS"];
  assert.ok(isJsonObject(liveness));
  assert.equal(Object.hasOwn(liveness, "handoffMessage"), false);
  assert.equal(Object.hasOwn(liveness, "overdue"), false);
  assert.equal(typeof old["handoffMessage"], "function");
  assert.equal(typeof old["livenessOverdue"], "function");
  assert.equal(typeof old["legacyPickupNote"], "function");
});

test("the old path is an ordinary object old code and tests may write to", () => {
  const old = forwarded();
  const original = old["isSafeId"];
  const replacement = (): boolean => true;
  Reflect.set(old, "isSafeId", replacement);
  assert.equal(Reflect.get(old, "isSafeId"), replacement);
  Reflect.set(old, "isSafeId", original);
  assert.equal(Reflect.get(old, "isSafeId"), original);
});

const buildModule: unknown = load("../../../scripts/build-layer.js");

interface BuiltFile {
  readonly output: string;
  readonly contents: string;
}

async function buildBoth(): Promise<readonly BuiltFile[]> {
  assert.ok(isJsonObject(buildModule));
  const buildAll = buildModule["buildAll"];
  assert.ok(typeof buildAll === "function");
  const built: unknown = await Reflect.apply(buildAll, buildModule, []);
  assert.ok(Array.isArray(built));
  const files: BuiltFile[] = [];
  for (const entry of built) {
    assert.ok(isJsonObject(entry));
    const output = entry["output"];
    const contents = entry["contents"];
    assert.ok(typeof output === "string" && typeof contents === "string");
    files.push({ output, contents });
  }
  return files;
}

after(async () => {
  assert.ok(isJsonObject(buildModule));
  const stop = buildModule["stop"];
  assert.ok(typeof stop === "function");
  await Reflect.apply(stop, buildModule, []);
});

test("window.LAHE.protocol in the layer bundle and in the Library bundle is the same set of names", async () => {
  const files = await buildBoth();
  assert.deepEqual(
    files.map((file) => file.output),
    ["dist/lahe-layer.js", "dist/lahe-library.js"]
  );
  for (const file of files) {
    const page = { document: {} };
    Object.assign(page, { window: page });
    vm.createContext(page);
    vm.runInContext(file.contents, page);
    const namespace: unknown = Reflect.get(page, "LAHE");
    assert.ok(isJsonObject(namespace), file.output);
    const protocol = namespace["protocol"];
    assert.ok(isJsonObject(protocol), file.output);
    assert.deepEqual(sorted(protocol), NAMES, file.output);
  }
});
