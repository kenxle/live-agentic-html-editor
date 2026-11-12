/*
 * read-when: Changing which checks a review request must pass, their order, or the refusal a failed check gives.
 */

import type { FailureCode } from "./failures.ts";
import { hostAllowed } from "./helper-address.ts";
import { CLIENT_CLI, CLIENT_LAYER, HEADER, JSON_CONTENT_TYPE } from "./headers.ts";
import type { ReviewClient } from "./headers.ts";
import { isJsonObject } from "./json-object.ts";
import { ROUTES } from "./routes.ts";
import type { ReviewRouteName } from "./routes.ts";
import { isSafeId } from "./safe-id.ts";
import type { SafeId } from "./safe-id.ts";

export const CHECK = {
  HOST: "host",
  CUSTOM_HEADER: "custom_header",
  CONTENT_TYPE: "content_type",
  REVIEW_KNOWN: "review_known",
  TOKEN: "token",
  ORIGIN: "origin",
  SEC_FETCH_SITE: "sec_fetch_site",
  SEC_FETCH: "sec_fetch",
  PROOF: "proof"
} as const;
export type CheckName = (typeof CHECK)[keyof typeof CHECK];

export const CHECKS = [
  { name: "host", code: "PROTO_BAD_HOST" },
  { name: "custom_header", code: "PROTO_MISSING_CUSTOM_HEADER" },
  { name: "content_type", code: "PROTO_UNSUPPORTED_MEDIA_TYPE" },
  { name: "review_known", code: "PROTO_UNKNOWN_REVIEW" },
  { name: "token", code: "PROTO_UNAUTHORIZED" },
  { name: "origin", code: "PROTO_FORBIDDEN_ORIGIN" },
  { name: "sec_fetch_site", code: "PROTO_CROSS_SITE" },
  { name: "sec_fetch", code: "AUTH_REFUSED" },
  { name: "proof", code: "AUTH_REFUSED" }
] as const;

type CodeOf<List extends readonly { readonly name: CheckName; readonly code: FailureCode | "AUTH_REFUSED" }[]> = List[number]["code"];
export type CheckCode = CodeOf<typeof CHECKS>;

export type HeaderValue = string | readonly string[] | undefined;
export type RequestHeaders = Readonly<Record<string, HeaderValue>>;

export interface CheckInput {
  readonly routeName: ReviewRouteName;
  readonly headers: RequestHeaders;
  readonly review?: unknown;
}

export interface RegisteredReview {
  readonly token: string;
  readonly origins: readonly string[];
}

export interface ReviewAuthConfig {
  readonly reviews: Readonly<Record<string, RegisteredReview>>;
}

export interface CheckRefusal {
  readonly ok: false;
  readonly check: CheckName;
  readonly code: CheckCode;
  readonly log: string;
}

export type CheckResult =
  | { readonly ok: true; readonly review: null; readonly origin: string | null }
  | { readonly ok: true; readonly review: SafeId; readonly origin: string }
  | CheckRefusal;

const REVIEW_CLIENTS: readonly ReviewClient[] = [CLIENT_LAYER, CLIENT_CLI];

interface Registered {
  readonly id: SafeId;
  readonly token: string;
  readonly origins: readonly unknown[];
}

function headerValue(headers: RequestHeaders, name: string): HeaderValue {
  if (Object.hasOwn(headers, name)) return headers[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function textOf(value: HeaderValue): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? value : value.join(",");
}

function reviewRoute(name: ReviewRouteName): (typeof ROUTES)[number] {
  const found = ROUTES.find((entry) => entry.name === name);
  if (found === undefined) throw new Error("unknown route: " + name + ". Review routes are listed in src/contract/routes.ts");
  return found;
}

function registeredReview(config: ReviewAuthConfig | null, review: unknown): Registered | null {
  const reviews: unknown = config === null ? null : Reflect.get(config, "reviews");
  if (!isJsonObject(reviews) || !isSafeId(review) || !Object.hasOwn(reviews, review)) return null;
  const entry = reviews[review];
  if (!isJsonObject(entry)) return null;
  const token = entry["token"];
  const origins = entry["origins"];
  return { id: review, token: typeof token === "string" ? token : "", origins: Array.isArray(origins) ? origins : [] };
}

function tokensEqual(presented: string, registered: string): boolean {
  const longest = Math.max(presented.length, registered.length);
  let difference = presented.length === registered.length ? 0 : 1;
  for (let index = 0; index < longest; index += 1) {
    difference |= (presented.charCodeAt(index) || 0) ^ (registered.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function refusal(routeName: string, name: CheckName, detail: string | null): CheckRefusal {
  const entry = CHECKS.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error("unknown check: " + name);
  const log = "refused " + routeName + ": check " + name + " failed" + (detail === null || detail === "" ? "" : " (" + detail + ")");
  return { ok: false, check: name, code: entry.code, log };
}

export function checkRequest(request: CheckInput, config: ReviewAuthConfig | null): CheckResult {
  const route = reviewRoute(request.routeName);
  const headers = request.headers;
  const refuse = (name: CheckName, detail: string | null): CheckRefusal => refusal(route.name, name, detail);

  const host = headerValue(headers, HEADER.HOST);
  if (!hostAllowed(host)) return refuse(CHECK.HOST, textOf(host) ?? "null");

  const origin = textOf(headerValue(headers, HEADER.ORIGIN));
  if (route.auth === "none") return { ok: true, review: null, origin: origin === "" ? null : origin };

  const client = headerValue(headers, HEADER.CLIENT);
  if (typeof client !== "string" || !REVIEW_CLIENTS.some((allowed) => allowed === client)) return refuse(CHECK.CUSTOM_HEADER, null);

  if (route.mutating) {
    const [mediaType = ""] = (textOf(headerValue(headers, HEADER.CONTENT_TYPE)) ?? "").split(";");
    const type = mediaType.trim().toLowerCase();
    if (type !== JSON_CONTENT_TYPE) return refuse(CHECK.CONTENT_TYPE, type === "" ? "none" : type);
  }

  const registered = registeredReview(config, request.review);
  if (registered === null) return refuse(CHECK.REVIEW_KNOWN, String(request.review));

  const presented = headerValue(headers, HEADER.TOKEN);
  if (registered.token === "" || typeof presented !== "string" || !tokensEqual(presented, registered.token)) {
    return refuse(CHECK.TOKEN, null);
  }

  const effective = origin === null || origin === "" ? "null" : origin;
  if (!registered.origins.some((allowed) => allowed === effective)) return refuse(CHECK.ORIGIN, effective);

  return { ok: true, review: registered.id, origin: effective };
}
