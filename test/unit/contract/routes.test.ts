/*
 * read-when: Changing src/contract/routes.ts, adding or changing a route, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH,
  BASE,
  CATALOG_PAGE_PATH,
  CATALOG_ROUTES,
  CATALOG_TOKEN_META,
  HEALTH_FIELD,
  ROUTES,
  SITE_ROUTES,
  SUMMARY_ROUTES,
  route
} from "../../../src/contract/routes.ts";
import { callUntyped } from "./support/untyped.ts";

test("the base path is /lahe/v1 and there are five auth modes", () => {
  assert.equal(BASE, "/lahe/v1");
  assert.deepEqual(AUTH, {
    NONE: "none",
    REVIEW_TOKEN: "review_token",
    CATALOG_TOKEN: "catalog_token",
    CLI_SECRET: "cli_secret",
    CLI_PROOF: "cli_proof"
  });
});

test("the review routes are exactly these ten, in this order", () => {
  assert.deepEqual(ROUTES, [
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
  ]);
});

const OPEN_CHECKS = {
  sec_fetch_site: ["same-origin"],
  token: true,
  json_body: true,
  origin: "exact"
};

test("the Library routes are exactly these seven, in this order, each with its own check table", () => {
  assert.deepEqual(CATALOG_ROUTES, [
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
    { name: "catalog.open", method: "POST", path: "/lahe/v1/catalog/open", auth: "catalog_token", mutating: true, checks: OPEN_CHECKS },
    { name: "catalog.star", method: "POST", path: "/lahe/v1/catalog/star", auth: "catalog_token", mutating: true, checks: OPEN_CHECKS },
    { name: "catalog.rename", method: "POST", path: "/lahe/v1/catalog/rename", auth: "catalog_token", mutating: true, checks: OPEN_CHECKS },
    { name: "catalog.request", method: "POST", path: "/lahe/v1/catalog/request", auth: "catalog_token", mutating: true, checks: OPEN_CHECKS }
  ]);
});

test("only the Library page carries top_level_navigation and only its asset route is a prefix", () => {
  const withNavigation = CATALOG_ROUTES.filter((entry) => Object.hasOwn(entry.checks, "top_level_navigation"));
  assert.deepEqual(withNavigation.map((entry) => entry.name), ["catalog.page"]);
  const prefixes = CATALOG_ROUTES.filter((entry) => Object.hasOwn(entry, "prefix"));
  assert.deepEqual(prefixes.map((entry) => entry.name), ["catalog.asset"]);
});

test("the site routes and the summary routes are exactly these, with their own credentials", () => {
  assert.deepEqual(SITE_ROUTES, [
    { name: "site.bind", method: "POST", path: "/lahe/v1/site/bind", auth: "cli_secret", mutating: true },
    { name: "review.retire", method: "POST", path: "/lahe/v1/review/retire", auth: "cli_secret", mutating: true }
  ]);
  assert.deepEqual(SUMMARY_ROUTES, [
    { name: "summary.read", method: "GET", path: "/lahe/v1/summary", auth: "cli_proof", mutating: false },
    { name: "summary.open", method: "POST", path: "/lahe/v1/summary/open", auth: "cli_proof", mutating: true, refuse_origin: true }
  ]);
  const refusing = SUMMARY_ROUTES.filter((entry) => Object.hasOwn(entry, "refuse_origin"));
  assert.deepEqual(refusing.map((entry) => entry.name), ["summary.open"]);
});

test("route names are unique across the four lists", () => {
  const names = [...ROUTES, ...CATALOG_ROUTES, ...SITE_ROUTES, ...SUMMARY_ROUTES].map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 21);
});

test("route finds an entry in whichever list holds it", () => {
  assert.equal(route("health"), ROUTES[0]);
  assert.equal(route("catalog.open"), CATALOG_ROUTES[3]);
  assert.equal(route("site.bind"), SITE_ROUTES[0]);
  assert.equal(route("summary.open"), SUMMARY_ROUTES[1]);
  assert.equal(route("review.end").path, "/lahe/v1/end");
});

test("route throws for a name no list holds, naming the file that lists the routes", () => {
  assert.throws(() => callUntyped(route, "nope"), {
    name: "Error",
    message: "unknown route: nope. Routes are listed in src/contract/routes.ts"
  });
  for (const value of [undefined, null, 7, "toString", "__proto__", ""]) {
    assert.throws(() => callUntyped(route, value), /^Error: unknown route: /, String(value));
  }
});

test("the Library page path, its token meta name and the health field it reads are these", () => {
  assert.equal(CATALOG_PAGE_PATH, "/catalog");
  assert.equal(CATALOG_TOKEN_META, "lahe-catalog-token");
  assert.deepEqual(HEALTH_FIELD, { CATALOG_SEEN_AT: "catalog_seen_at" });
});
