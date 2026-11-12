/*
 * read-when: Changing src/contract/protocol.ts, the forwarder at src/shared/protocol.js, or the protocol's place in the layer and Library bundles, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
const manifest: unknown = load("../../../src/shared/manifest.js");
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function callExport(module: unknown, name: string, ...args: unknown[]): unknown {
  assert.ok(isJsonObject(module));
  const found = module[name];
  assert.ok(typeof found === "function", name);
  return Reflect.apply(found, module, args);
}

function entriesOf(list: unknown): readonly unknown[] {
  assert.ok(Array.isArray(list));
  return list;
}

function entryPath(entry: unknown): unknown {
  assert.ok(isJsonObject(entry));
  return entry["path"];
}

async function runProtocolBundle(entries: readonly unknown[], namespace: boolean): Promise<Readonly<Record<string, unknown>>> {
  const code: unknown = await callExport(buildModule, "bundle", {
    root: ROOT,
    entries,
    title: "the protocol, as the manifest places it",
    namespace
  });
  assert.ok(typeof code === "string");
  const page = { document: {} };
  Object.assign(page, { window: page });
  vm.createContext(page);
  vm.runInContext(code, page);
  const lahe: unknown = Reflect.get(page, "LAHE");
  assert.ok(isJsonObject(lahe));
  const protocol = lahe["protocol"];
  assert.ok(isJsonObject(protocol));
  return protocol;
}

after(async () => {
  await callExport(buildModule, "stop");
});

test("window.LAHE.protocol, built from the layer's and the Library's own manifest entries, is the same set of names", async () => {
  const layerEntries = entriesOf(callExport(manifest, "builtFiles"));
  const upToProtocol = layerEntries.findIndex((entry) => entryPath(entry) === "src/contract/protocol.ts");
  assert.ok(upToProtocol >= 0, "the layer's manifest registers src/contract/protocol.ts");
  const libraryEntries = entriesOf(callExport(manifest, "libraryFiles"));
  assert.equal(entryPath(libraryEntries[0]), "src/contract/protocol.ts", "the Library page loads the same protocol entry first");

  const inLayer = await runProtocolBundle(layerEntries.slice(0, upToProtocol + 1), true);
  const inLibrary = await runProtocolBundle(libraryEntries.slice(0, 1), false);
  assert.deepEqual(sorted(inLayer), NAMES);
  assert.deepEqual(sorted(inLibrary), NAMES);
  for (const name of NAMES) assert.equal(typeof inLayer[name], typeof inLibrary[name], name);
});
