/*
 * read-when: The page check asks for a data-lahe-id on a source that cannot carry one, or adding a template language.
 */

import { isJsonObject } from "../contract/json-object.ts";
import type { SourceHint } from "../contract/record.ts";

export const STAMP_SOURCE_EXTENSIONS = [
  "html",
  "htm",
  "xhtml",
  "svg",
  "vue",
  "svelte",
  "astro",
  "jsx",
  "tsx",
  "erb",
  "ejs",
  "njk",
  "hbs",
  "liquid",
  "php",
  "mustache",
  "twig",
  "jinja",
  "j2"
] as const;
export type StampSourceExtension = (typeof STAMP_SOURCE_EXTENSIONS)[number];

export interface StampPage {
  readonly path?: string | null;
  readonly source_hint?: SourceHint | null;
}

function extensionOf(path: string | null | undefined): string {
  if (typeof path !== "string" || path === "") return "";
  const last = (path.split("#")[0] ?? "").split("?")[0]?.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) return "";
  return last.slice(dot + 1).toLowerCase();
}

export function sourceCanCarryStamp(path: string | null | undefined): boolean {
  const extension = extensionOf(path);
  return STAMP_SOURCE_EXTENSIONS.some((known) => known === extension);
}

export function pageCanCarryStamp(page: StampPage | null | undefined): boolean {
  if (!isJsonObject(page)) return false;
  const hint = page["source_hint"];
  const hinted = isJsonObject(hint) ? hint["path"] : hint;
  if (typeof hinted === "string" && hinted !== "") return sourceCanCarryStamp(hinted);
  const own = page["path"];
  return typeof own === "string" && sourceCanCarryStamp(own);
}
