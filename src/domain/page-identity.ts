/*
 * read-when: Records show up on the wrong page or vanish from the right one, or changing how a page is named.
 */

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

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function pageFrom(location: PageLocation | null | undefined, options?: PageOptions): PageView {
  throw notBuilt(location, options);
}
export function pageKey(item: ItemAddress): string {
  throw notBuilt(item);
}
export function pageKeyFor(page: PageAddress): string {
  throw notBuilt(page);
}
export function identityOrigin(origin: string | null): string {
  throw notBuilt(origin);
}
export function pageIdentityKey(item: ItemAddress): string {
  throw notBuilt(item);
}
export function pageIdentityKeyFor(page: PageAddress): string {
  throw notBuilt(page);
}
export function samePage(item: ItemAddress, page: PageTarget): boolean {
  throw notBuilt(item, page);
}
export function shortPath(path: string | null | undefined): string {
  throw notBuilt(path);
}
