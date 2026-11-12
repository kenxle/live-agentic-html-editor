/*
 * read-when: Records show up on the wrong page or vanish from the right one, or changing how a page is named.
 */

import { isJsonObject } from "../contract/json-object.ts";
import { FILE_ORIGIN } from "../contract/record.ts";
import type { Item, SourceHint } from "../contract/record.ts";

export interface PageLocation {
  readonly origin?: string | null;
  readonly pathname?: string | null;
  readonly href?: string | null;
  readonly title?: unknown;
}
export interface PageOptions {
  readonly seq?: unknown;
  readonly source_hint?: SourceHint | null;
  readonly aliases?: unknown;
  readonly path_aliases?: unknown;
  readonly spellings?: unknown;
}
export interface PageView {
  readonly origin: string;
  readonly path: string | null;
  readonly title: string | null;
  readonly seq: number | null;
  readonly source_hint: SourceHint | null;
  readonly aliases: readonly string[];
  readonly path_aliases: readonly string[];
  readonly spellings: readonly string[];
}
export interface PageAddress {
  readonly origin: string | null;
  readonly path: string | null;
}
export interface PageTarget extends PageAddress {
  readonly aliases?: readonly string[];
  readonly path_aliases?: readonly string[];
  readonly spellings?: readonly string[];
}
export type ItemAddress = Pick<Item, "page_origin" | "page_path">;

const SITE_ORIGIN = /^http:\/\/([a-z0-9][a-z0-9.-]*?)\.lahe(?:\.localhost)?(?::\d{1,5})?$/;
const INDEX_DOCUMENT = "index.html";

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one: unknown): one is string => typeof one === "string") : [];
}

function segmentsOf(path: string | null | undefined): string[] {
  const raw = (path ?? "").split("?")[0]?.split("#")[0] ?? "";
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0 || raw.endsWith("/")) parts.push(INDEX_DOCUMENT);
  return parts;
}

export function shortPath(path: string | null | undefined): string {
  const raw = path ?? "";
  const parts = (raw.split("?")[0] ?? "").split("#")[0]?.split("/").filter(Boolean) ?? [];
  if (parts.length === 0) return raw;
  return parts.slice(Math.max(0, parts.length - 2)).join("/");
}

export function pageFrom(location: PageLocation | null | undefined, options: PageOptions = {}): PageView {
  const where = location ?? {};
  let origin = where.origin ?? null;
  let path = where.pathname ?? null;
  if (origin === null || origin === "" || origin === "null" || /^file:/i.test(where.href ?? "")) {
    origin = FILE_ORIGIN;
    path = shortPath(where.href || where.pathname || "") || "document";
  }
  return {
    origin,
    path: path === "" ? null : path,
    title: typeof where.title === "string" ? where.title : null,
    seq: typeof options.seq === "number" ? options.seq : null,
    source_hint: options.source_hint ?? null,
    aliases: stringsOf(options.aliases),
    path_aliases: stringsOf(options.path_aliases).filter((one) => one.startsWith("/")),
    spellings: stringsOf(options.spellings).filter((one) => one.indexOf(" ") > 0)
  };
}

export function pageKey(item: ItemAddress): string {
  if (!isJsonObject(item)) throw new TypeError("pageKey expects an item");
  return item.page_origin + "|" + item.page_path;
}

export function pageKeyFor(page: PageAddress): string {
  if (!isJsonObject(page)) throw new TypeError("pageKeyFor expects a page");
  return String(page.origin) + "|" + String(page.path);
}

export function identityOrigin(origin: string | null): string {
  const text = String(origin);
  const match = SITE_ORIGIN.exec(text);
  return match?.[1] === undefined ? text : "lahe-site:" + match[1];
}

export function pageIdentityKey(item: ItemAddress): string {
  if (!isJsonObject(item)) throw new TypeError("pageIdentityKey expects an item");
  return identityOrigin(item.page_origin) + "|" + item.page_path;
}

export function pageIdentityKeyFor(page: PageAddress): string {
  if (!isJsonObject(page)) throw new TypeError("pageIdentityKeyFor expects a page");
  return identityOrigin(page.origin) + "|" + String(page.path);
}

function sameSpelling(item: ItemAddress, spellings: readonly string[]): boolean {
  const mine = identityOrigin(item.page_origin) + " " + item.page_path;
  return spellings.some((one) => {
    const at = one.indexOf(" ");
    return identityOrigin(one.slice(0, at)) + " " + one.slice(at + 1) === mine;
  });
}

function sameTail(item: ItemAddress, page: PageTarget): boolean {
  const mine = segmentsOf(item.page_path);
  const theirs = segmentsOf(page.path);
  const depth = Math.min(mine.length, theirs.length);
  for (let i = 1; i <= depth; i += 1) {
    if (mine[mine.length - i] !== theirs[theirs.length - i]) return false;
  }
  return depth > 0;
}

export function samePage(item: ItemAddress, page: PageTarget): boolean {
  if (!isJsonObject(item)) throw new TypeError("samePage expects an item");
  if (!isJsonObject(page)) throw new TypeError("samePage expects a page");
  if (pageIdentityKey(item) === pageIdentityKeyFor(page)) return true;
  if (page.spellings !== undefined && sameSpelling(item, page.spellings)) return true;
  if (page.aliases?.includes(item.page_origin) === true) {
    if (item.page_path === page.path) return true;
    if (page.path_aliases?.includes(item.page_path) === true) return true;
  }
  if (item.page_origin !== FILE_ORIGIN && page.origin !== FILE_ORIGIN) return false;
  return sameTail(item, page);
}
