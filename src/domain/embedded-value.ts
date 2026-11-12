/*
 * read-when: Changing what counts as an embedded data: value, or the fixed-size name a comparison uses for one.
 */

const EMBEDDED_PREFIX = /^\s*data:/i;
const DATA_SCHEME_LENGTH = "data:".length;

const MIX_A = 2654435761;
const MIX_B = 1597334677;
const FINISH_A = 2246822507;
const FINISH_B = 3266489909;

function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function digestOf(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ unit, MIX_A);
    h2 = Math.imul(h2 ^ unit, MIX_B);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), FINISH_A) ^ Math.imul(h2 ^ (h2 >>> 13), FINISH_B);
  h2 = Math.imul(h2 ^ (h2 >>> 16), FINISH_A) ^ Math.imul(h1 ^ (h1 >>> 13), FINISH_B);
  return hex8(h2) + hex8(h1);
}

export function isEmbeddedValue(value: string): boolean {
  return EMBEDDED_PREFIX.test(value);
}

export function embeddedName(value: string): string {
  if (!isEmbeddedValue(value)) return value;
  const text = value.replace(/^\s+/, "");
  const comma = text.indexOf(",");
  const media = comma === -1 ? "" : text.slice(DATA_SCHEME_LENGTH, comma);
  return "embedded:" + media + ":" + String(text.length) + ":" + digestOf(text);
}
