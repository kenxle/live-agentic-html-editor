/*
 * read-when: Changing src/contract/service-contract.ts, bumping the service contract, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  API_VERSION,
  CONTRACT_VERDICT,
  SERVICE_CONTRACT,
  helperContractVerdict
} from "../../../src/contract/service-contract.ts";

test("the API version is v1 and the service contract is 17", () => {
  assert.equal(API_VERSION, "v1");
  assert.equal(SERVICE_CONTRACT, 17);
});

test("the three verdicts are current, older and newer", () => {
  assert.deepEqual(CONTRACT_VERDICT, { CURRENT: "current", OLDER: "older", NEWER: "newer" });
});

test("a helper below the contract is older, on it is current, above it is newer", () => {
  for (const number of [13, 14, 15, 16]) {
    assert.equal(helperContractVerdict({ service_contract: number }), "older", String(number));
  }
  assert.equal(helperContractVerdict({ service_contract: 17 }), "current");
  assert.equal(helperContractVerdict({ service_contract: 18 }), "newer");
  assert.equal(helperContractVerdict({ service_contract: 400 }), "newer");
  assert.equal(helperContractVerdict({ service_contract: 0 }), "older");
});

test("a helper that names no contract, or names one that is not an integer, is older", () => {
  const bad: readonly unknown[] = [{}, { service_contract: "17" }, { service_contract: 16.5 }, { service_contract: 17.5 }, { service_contract: null }, { service_contract: NaN }, { service_contract: undefined }];
  for (const health of bad) assert.equal(helperContractVerdict(health), "older", JSON.stringify(health));
});

test("an answer that is not an object at all is older", () => {
  for (const health of [null, undefined, "x", 17, true, [17]]) {
    assert.equal(helperContractVerdict(health), "older", String(health));
  }
});

test("the current service contract has a row in the contract history table, saying what an older helper lacks", () => {
  const doc = readFileSync(new URL("../../../docs/ongoing/code/contract.md", import.meta.url), "utf8");
  const row = new RegExp("^\\| " + String(SERVICE_CONTRACT) + " \\| \\S", "m");
  assert.match(doc, row, "docs/ongoing/code/contract.md has no `| " + String(SERVICE_CONTRACT) + " | ...` row: a bump needs its row in the same commit");
});
