/*
 * read-when: Changing where the helper listens or which Host headers count as naming it.
 */

export const DEFAULT_PORT = 7817;

export const DEFAULT_HOST = "127.0.0.1";

export const DEFAULT_HELPER_ORIGIN: string = "http://" + DEFAULT_HOST + ":" + String(DEFAULT_PORT);

const ALLOWED_HOST_NAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

export function hostAllowed(hostHeader: unknown): boolean {
  if (typeof hostHeader !== "string" || hostHeader === "") return false;
  const name = hostHeader.replace(/:\d+$/, "");
  return ALLOWED_HOST_NAMES.some((allowed) => allowed === name);
}
