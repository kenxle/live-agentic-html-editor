/*
 * read-when: A collision the reviewer already answered with Keep mine comes back.
 */

import { isJsonObject } from "../contract/json-object.ts";
import { emptyRegion } from "../contract/record.ts";
import type { Item } from "../contract/record.ts";

export const ACCEPTED_PAGE_TEXTS_MAX = 8;

function isTextList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((one: unknown) => typeof one === "string");
}

export function acceptedPageTexts(item: Pick<Item, "region"> | null | undefined): readonly string[] {
  const region = item?.region;
  if (!isJsonObject(region)) return [];
  const list = region.accepted_page_texts;
  return isTextList(list) ? list : [];
}

export function acceptPageText(item: Item | null | undefined, text: string): readonly string[] {
  if (!item || typeof text !== "string" || text === "") return acceptedPageTexts(item);
  const region = isJsonObject(item.region) ? item.region : emptyRegion();
  const list = [...acceptedPageTexts(item)];
  if (!list.includes(text)) list.push(text);
  const kept = list.slice(Math.max(0, list.length - ACCEPTED_PAGE_TEXTS_MAX));
  item.region = { ...region, accepted_page_texts: kept };
  return kept;
}
