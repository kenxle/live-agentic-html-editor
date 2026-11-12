/*
 * read-when: Accepting a review id, session id, agent name or request id that becomes a path component or a command argument.
 */

declare const safeIdBrand: unique symbol;

export type SafeId = string & { readonly [safeIdBrand]: true };

export const SAFE_ID: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isSafeId(value: unknown): value is SafeId {
  return typeof value === "string" && SAFE_ID.test(value);
}
