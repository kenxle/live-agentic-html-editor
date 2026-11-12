/*
 * read-when: Adding or changing a route, a route's credential, or looking a route up by name.
 */

import { API_VERSION } from "./service-contract.ts";

export const BASE: string = "/lahe/" + API_VERSION;

export const AUTH = {
  NONE: "none",
  REVIEW_TOKEN: "review_token",
  CATALOG_TOKEN: "catalog_token",
  CLI_SECRET: "cli_secret",
  CLI_PROOF: "cli_proof"
} as const;
export type Auth = (typeof AUTH)[keyof typeof AUTH];
export type HttpMethod = "GET" | "POST";

interface RouteFields {
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly mutating: boolean;
}
export interface ReviewRoute extends RouteFields {
  readonly auth: "none" | "review_token";
}
export interface CatalogChecks {
  readonly sec_fetch_site: readonly ("none" | "same-origin")[];
  readonly top_level_navigation?: true;
  readonly token: boolean;
  readonly json_body: boolean;
  readonly origin: "exact" | null;
}
export interface CatalogRoute extends RouteFields {
  readonly auth: "catalog_token";
  readonly prefix?: true;
  readonly checks: CatalogChecks;
}
export interface SiteRoute extends RouteFields {
  readonly auth: "cli_secret";
}
export interface SummaryRoute extends RouteFields {
  readonly auth: "cli_proof";
  readonly refuse_origin?: true;
}

export const ROUTES = [
  { name: "health", method: "GET", path: "/lahe/v1/health", auth: "none", mutating: false },
  { name: "events.append", method: "POST", path: "/lahe/v1/events", auth: "review_token", mutating: true },
  { name: "library.get", method: "GET", path: "/lahe-layer.js", auth: "none", mutating: false },
  { name: "review.write", method: "POST", path: "/lahe/v1/review", auth: "review_token", mutating: true },
  { name: "review.read", method: "GET", path: "/lahe/v1/review", auth: "review_token", mutating: false },
  { name: "records.read", method: "GET", path: "/lahe/v1/records", auth: "review_token", mutating: false },
  { name: "replies.poll", method: "GET", path: "/lahe/v1/replies", auth: "review_token", mutating: false },
  { name: "window.claim", method: "POST", path: "/lahe/v1/window", auth: "review_token", mutating: true },
  { name: "window.release", method: "POST", path: "/lahe/v1/window/release", auth: "review_token", mutating: true },
  { name: "review.end", method: "POST", path: "/lahe/v1/end", auth: "review_token", mutating: true }
] as const;

export const CATALOG_PAGE_PATH = "/catalog";

export const CATALOG_ROUTES = [
  {
    name: "catalog.page",
    method: "GET",
    path: "/catalog",
    auth: "catalog_token",
    mutating: false,
    checks: { sec_fetch_site: ["none", "same-origin"], top_level_navigation: true, token: false, json_body: false, origin: null }
  },
  {
    name: "catalog.asset",
    method: "GET",
    path: "/catalog/assets/",
    prefix: true,
    auth: "catalog_token",
    mutating: false,
    checks: { sec_fetch_site: ["none", "same-origin"], token: false, json_body: false, origin: null }
  },
  {
    name: "catalog.list",
    method: "GET",
    path: "/lahe/v1/catalog/list",
    auth: "catalog_token",
    mutating: false,
    checks: { sec_fetch_site: ["same-origin"], token: true, json_body: false, origin: null }
  },
  {
    name: "catalog.open",
    method: "POST",
    path: "/lahe/v1/catalog/open",
    auth: "catalog_token",
    mutating: true,
    checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" }
  },
  {
    name: "catalog.star",
    method: "POST",
    path: "/lahe/v1/catalog/star",
    auth: "catalog_token",
    mutating: true,
    checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" }
  },
  {
    name: "catalog.rename",
    method: "POST",
    path: "/lahe/v1/catalog/rename",
    auth: "catalog_token",
    mutating: true,
    checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" }
  },
  {
    name: "catalog.request",
    method: "POST",
    path: "/lahe/v1/catalog/request",
    auth: "catalog_token",
    mutating: true,
    checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" }
  }
] as const;

export const SITE_ROUTES = [
  { name: "site.bind", method: "POST", path: "/lahe/v1/site/bind", auth: "cli_secret", mutating: true },
  { name: "review.retire", method: "POST", path: "/lahe/v1/review/retire", auth: "cli_secret", mutating: true }
] as const;

export const SUMMARY_ROUTES = [
  { name: "summary.read", method: "GET", path: "/lahe/v1/summary", auth: "cli_proof", mutating: false },
  { name: "summary.open", method: "POST", path: "/lahe/v1/summary/open", auth: "cli_proof", mutating: true, refuse_origin: true }
] as const;

type NameOf<Entry extends RouteFields, List extends readonly Entry[]> = List[number]["name"];

export type ReviewRouteName = NameOf<ReviewRoute, typeof ROUTES>;
export type CatalogRouteName = NameOf<CatalogRoute, typeof CATALOG_ROUTES>;
export type SiteRouteName = NameOf<SiteRoute, typeof SITE_ROUTES>;
export type SummaryRouteName = NameOf<SummaryRoute, typeof SUMMARY_ROUTES>;
export type RouteName = ReviewRouteName | CatalogRouteName | SiteRouteName | SummaryRouteName;
export type AnyRoute = (typeof ROUTES | typeof CATALOG_ROUTES | typeof SITE_ROUTES | typeof SUMMARY_ROUTES)[number];

const ALL_ROUTES: readonly AnyRoute[] = [...ROUTES, ...CATALOG_ROUTES, ...SITE_ROUTES, ...SUMMARY_ROUTES];

export function route<N extends RouteName>(name: N): Extract<AnyRoute, { readonly name: N }> {
  const found = ALL_ROUTES.find((entry): entry is Extract<AnyRoute, { readonly name: N }> => entry.name === name);
  if (found === undefined) throw new Error("unknown route: " + name + ". Routes are listed in src/contract/routes.ts");
  return found;
}

export const CATALOG_TOKEN_META = "lahe-catalog-token";

export const HEALTH_FIELD = { CATALOG_SEEN_AT: "catalog_seen_at" } as const;
