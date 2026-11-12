/*
 * read-when: Bumping the service contract, or deciding what to do about a helper whose contract differs from this clone's.
 */

import { isJsonObject } from "./json-object.ts";

export const API_VERSION = "v1";

export const SERVICE_CONTRACT = 17;

export const CONTRACT_VERDICT = { CURRENT: "current", OLDER: "older", NEWER: "newer" } as const;
export type ContractVerdict = (typeof CONTRACT_VERDICT)[keyof typeof CONTRACT_VERDICT];

export function helperContractVerdict(health: unknown): ContractVerdict {
  const reported = isJsonObject(health) ? health["service_contract"] : undefined;
  const live = typeof reported === "number" && Number.isInteger(reported) ? reported : 0;
  if (live > SERVICE_CONTRACT) return CONTRACT_VERDICT.NEWER;
  if (live < SERVICE_CONTRACT) return CONTRACT_VERDICT.OLDER;
  return CONTRACT_VERDICT.CURRENT;
}
