/*
 * read-when: The page check asks for a data-lahe-id on a source that cannot carry one, or adding a template language.
 */

import type { SourceHint } from "../contract/record.ts";

export const STAMP_SOURCE_EXTENSIONS: readonly [
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
] = ["html", "htm", "xhtml", "svg", "vue", "svelte", "astro", "jsx", "tsx", "erb", "ejs", "njk", "hbs", "liquid", "php", "mustache", "twig", "jinja", "j2"];
export type StampSourceExtension = (typeof STAMP_SOURCE_EXTENSIONS)[number];
export interface StampPage {
  readonly path?: string | null;
  readonly source_hint?: SourceHint | null;
}

export function sourceCanCarryStamp(path: string | null | undefined): boolean {
  throw new Error("C3: not built yet " + String(path));
}
export function pageCanCarryStamp(page: StampPage | null | undefined): boolean {
  throw new Error("C3: not built yet " + typeof page);
}
