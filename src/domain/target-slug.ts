/*
 * read-when: Changing how a review's target becomes the readable part of its file name.
 */

export const SLUG_MAX = 40;

const FALLBACK = "target";

function trimDashes(text: string): string {
  return text.replace(/^-+|-+$/g, "");
}

export function targetSlug(canonical: string): string {
  const query = canonical.indexOf("?");
  const path = query === -1 ? canonical : canonical.slice(0, query);
  const tail = path
    .split("/")
    .filter((segment) => segment !== "")
    .pop();
  const slug = trimDashes(trimDashes((tail ?? FALLBACK).toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, SLUG_MAX));
  return slug === "" ? FALLBACK : slug;
}
