/*
 * read-when: Writing a unit test that needs a free-writing run record or its take-back built the way the layer builds them.
 */

import { KIND, PLACEMENT, STATE, emptyRegion } from "../../../../src/contract/record.ts";
import type { Item, Region, RunBlock } from "../../../../src/contract/record.ts";
import { newItem } from "../../../../src/domain/item-revisions.ts";
import type { NewItemInput } from "../../../../src/domain/item-revisions.ts";
import { buildRunAfter, runChangeText } from "../../../../src/domain/run-record.ts";
import { PAGE } from "./items.ts";

export const CANARY = "zqxcanary";

export const WORKED_BLOCKS: readonly RunBlock[] = [
  { tag: "h2", html: "What the chat window cost me zqxcanary" },
  { tag: "p", html: "I lost my place <strong>every</strong> time zqxcanary" },
  { tag: "ul", html: "<li>scrolling</li><li>re-asking zqxcanary</li>" }
];

export function anchorRegion(tag: string, label = "Fixture anchor"): Region {
  return { ...emptyRegion(), ref: { fingerprint: { tag } }, label };
}

export function runItem(overrides: Partial<NewItemInput> = {}): Item {
  const fields: NewItemInput = {
    kind: KIND.EDIT,
    state: STATE.READY,
    before: "What changed",
    before_html: "What changed",
    anchor_after_html: "What changed",
    anchor_tag_after: null,
    placement: PLACEMENT.AFTER_ANCHOR,
    new_blocks: [{ tag: "p", html: "A new paragraph zqxcanary" }],
    region: anchorRegion("p"),
    ...PAGE,
    ...overrides
  };
  const built = buildRunAfter(fields.anchor_after_html, fields.new_blocks);
  const draft = newItem({ ...fields, after_html: overrides.after_html ?? built.after_html, after: overrides.after ?? built.after });
  return overrides.change === undefined ? { ...draft, change: runChangeText(draft) } : draft;
}

export function worked(overrides: Partial<NewItemInput> = {}): Item {
  return runItem({ new_blocks: WORKED_BLOCKS, ...overrides });
}

export function handled(item: Item): Item {
  return { ...item, state: STATE.HANDLED };
}
