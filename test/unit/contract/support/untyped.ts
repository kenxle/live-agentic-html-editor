/*
 * read-when: Calling a typed contract function the way a JavaScript caller can, with a value its signature refuses.
 */

import { isSafeId } from "../../../../src/contract/safe-id.ts";
import type { SafeId } from "../../../../src/contract/safe-id.ts";

export function callUntyped(fn: (...args: never[]) => unknown, ...args: unknown[]): unknown {
  return Reflect.apply(fn, undefined, args);
}

export function safeId(value: string): SafeId {
  if (!isSafeId(value)) throw new Error("not a safe id: " + value);
  return value;
}

export function jsonMessage(text: string): string {
  try {
    JSON.parse(text);
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  throw new Error("expected JSON.parse to refuse " + text);
}
