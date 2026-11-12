/*
 * read-when: Changing how often the layer posts to the helper, what flushes at once, or the size of an unload body.
 */

export const FLUSH = {
  HELPER_DEBOUNCE_MS: 750,
  DRAFT_FLOOR_MS: 10000,
  RUN_DRAFT_FLOOR_MS: 30000,
  PRESS_QUIET_MS: 3000,
  PRESS_CAP_MS: 10000,
  IMMEDIATE_ON: ["blur", "hide", "ready", "navigation", "unload"],
  KEEPALIVE_MAX_BYTES: 65536
} as const;
export type ImmediateFlushReason = (typeof FLUSH.IMMEDIATE_ON)[number];

function jsonOf(value: unknown): string | undefined {
  return JSON.stringify(value);
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function fitsKeepalive(body: unknown): boolean {
  const text = typeof body === "string" ? body : (jsonOf(body) ?? "");
  return utf8Length(text) <= FLUSH.KEEPALIVE_MAX_BYTES;
}
