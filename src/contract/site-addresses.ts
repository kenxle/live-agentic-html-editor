/*
 * read-when: Changing site names, the pages port, how a Host or Origin header is classified, or the address a site is served at.
 */

import { hostAllowed } from "./helper-address.ts";

declare const siteNameBrand: unique symbol;

export type SiteName = string & { readonly [siteNameBrand]: true };

export const PAGES = {
  PORT: 1483,
  PORT_ENV: "LAHE_PAGES_PORT",
  SUFFIX: "lahe.localhost",
  PRINTED_ENDING: "lahe.localhost",
  PRINTED_ENDING_REASON: "every browser treats .localhost names as this computer and as secure, with no setup",
  PORT_FREE_OFF_REASON: "the port-80 forward is not set up",
  LAHE_NAMES_OFF_REASON: "the .lahe option is not set up",
  LIBRARY_NAME: "library",
  MAX_LABELS: 4,
  LABEL_MAX: 63,
  NAME_MAX: 150,
  RESERVED_NAMES: ["library", "lahe", "www", "api"],
  MODE_SITES: "sites",
  CORP: "same-origin"
} as const;

const SITE_LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SITE_HOST = /^([a-z0-9.-]+)\.lahe\.localhost(?::(\d{1,5}))?$/;
const SHORT_HOST = /^([a-z0-9.-]+)\.lahe(?::(\d{1,5}))?$/;

export function isSiteLabel(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= PAGES.LABEL_MAX && SITE_LABEL.test(value);
}

export function isSiteName(value: unknown): value is SiteName {
  if (typeof value !== "string" || value === "" || value.length > PAGES.NAME_MAX) return false;
  const labels = value.split(".");
  return labels.length <= PAGES.MAX_LABELS && labels.every((label) => isSiteLabel(label));
}

export const HOST_FAMILY = { API: "api", LIBRARY: "library", PAGE: "page", BAD: "bad" } as const;

export type HostClass =
  | { readonly family: "api" }
  | { readonly family: "library"; readonly name: "library" }
  | { readonly family: "page"; readonly name: SiteName }
  | { readonly family: "bad" };

export interface HostOptions {
  readonly pagesPort?: number;
  readonly laheNames?: boolean;
}

interface SiteAddress {
  readonly name: string;
  readonly port: string | undefined;
  readonly short: boolean;
}

function readSiteAddress(address: string, laheNames: boolean): SiteAddress | null {
  const full = SITE_HOST.exec(address);
  const short = full === null && laheNames ? SHORT_HOST.exec(address) : null;
  const match = full ?? short;
  const name = match?.[1];
  if (name === undefined) return null;
  return { name, port: match?.[2], short: full === null };
}

function portMatches(port: string | undefined, pagesPort: number | undefined): boolean {
  return port === undefined || Number(port) === pagesPort;
}

export function classifyHost(hostHeader: unknown, options?: HostOptions): HostClass {
  if (typeof hostHeader !== "string" || hostHeader === "") return { family: HOST_FAMILY.BAD };
  if (hostAllowed(hostHeader)) return { family: HOST_FAMILY.API };
  const address = readSiteAddress(hostHeader, options?.laheNames === true);
  if (address === null || !portMatches(address.port, options?.pagesPort)) return { family: HOST_FAMILY.BAD };
  const name = address.name;
  if (name === PAGES.LIBRARY_NAME) {
    return address.short ? { family: HOST_FAMILY.BAD } : { family: HOST_FAMILY.LIBRARY, name: PAGES.LIBRARY_NAME };
  }
  return isSiteName(name) ? { family: HOST_FAMILY.PAGE, name } : { family: HOST_FAMILY.BAD };
}

export function siteOrigin(name: string, port: number): string {
  return "http://" + name + "." + PAGES.SUFFIX + (port === 80 ? "" : ":" + String(port));
}

export function siteNameFromOrigin(origin: unknown, pagesPort: number, laheNames?: boolean): SiteName | null {
  const scheme = "http://";
  if (typeof origin !== "string" || !origin.startsWith(scheme)) return null;
  const address = readSiteAddress(origin.slice(scheme.length), laheNames === true);
  if (address === null || address.name === PAGES.LIBRARY_NAME) return null;
  const name = address.name;
  return isSiteName(name) && portMatches(address.port, pagesPort) ? name : null;
}
