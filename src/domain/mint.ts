/*
 * read-when: Minting an id for a record or an event, or when two records share an id.
 */

interface Csprng {
  getRandomValues(array: Uint8Array): unknown;
}

function isCsprng(value: unknown): value is Csprng {
  return typeof value === "object" && value !== null && "getRandomValues" in value && typeof value.getRandomValues === "function";
}

const ID_BYTES = 12;

export function randomId(prefix?: string): string {
  const generator: unknown = Reflect.get(globalThis, "crypto");
  if (!isCsprng(generator)) throw new Error("randomId: no CSPRNG available (globalThis.crypto.getRandomValues)");
  const bytes = new Uint8Array(ID_BYTES);
  generator.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return prefix === undefined || prefix === "" ? hex : prefix + "_" + hex;
}

export function nowIso(): string {
  return new Date().toISOString();
}
