/*
 * read-when: Changing which origins and flags a review write accepts in its body.
 */

import { isJsonObject } from "./json-object.ts";

export const LOOPBACK_ORIGIN_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

export const ORIGIN_LIMIT = 16;

const DEFAULT_PORT_OF = { http: "80", https: "443" } as const;

const ORIGIN_PATTERN = new RegExp(
  "^(https?)://(" + LOOPBACK_ORIGIN_HOSTS.map((host) => host.replace(/[.[\]]/g, "\\$&")).join("|") + ")(?::(0|[1-9][0-9]{0,4}))?$"
);

export function isRegisterableOrigin(origin: unknown): boolean {
  if (typeof origin !== "string") return false;
  if (origin === "null") return true;
  const match = ORIGIN_PATTERN.exec(origin);
  const scheme = match?.[1];
  if (scheme !== "http" && scheme !== "https") return false;
  const port = match?.[3];
  if (port === undefined) return true;
  return Number(port) <= 65535 && port !== DEFAULT_PORT_OF[scheme];
}

export function acceptsNotesFlag(body: unknown): boolean {
  return isJsonObject(body) && body["notes"] === true;
}
