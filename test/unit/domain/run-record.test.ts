/*
 * read-when: Changing src/domain/run-record.ts, how a free-writing run is recorded, viewed by replay, sized or described to the agent, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { KIND, PLACEMENT, emptyContext, emptyRegion } from "../../../src/contract/record.ts";
import type { Item } from "../../../src/contract/record.ts";
import {
  anchorTagOf,
  anchorTypeName,
  anchorTypeOfTag,
  anchorView,
  blocksBytes,
  buildRunAfter,
  handedOverBlocks,
  recordBytes,
  runChangeText
} from "../../../src/domain/run-record.ts";
import { callUntyped } from "../contract/support/untyped.ts";
import { anItem } from "./support/items.ts";
import { CANARY, WORKED_BLOCKS, anchorRegion, handled, runItem, worked } from "./support/runs.ts";

test("a run's whole markup is the anchor's markup followed by each block as its own element, and its words are read from it", () => {
  assert.deepEqual(
    buildRunAfter("Anchor", [
      { tag: "p", html: "New" },
      { tag: "h2", html: "Head" }
    ]),
    { after_html: "Anchor<p>New</p><h2>Head</h2>", after: "Anchor\n\nNew\n\nHead" }
  );
  assert.equal(
    buildRunAfter("What changed", WORKED_BLOCKS).after_html,
    "What changed<h2>What the chat window cost me zqxcanary</h2><p>I lost my place <strong>every</strong> time zqxcanary</p><ul><li>scrolling</li><li>re-asking zqxcanary</li></ul>"
  );
  assert.equal(
    buildRunAfter("What changed", WORKED_BLOCKS).after,
    "What changed\n\nWhat the chat window cost me zqxcanary\n\nI lost my place every time zqxcanary\n\nscrolling\n\nre-asking zqxcanary"
  );
});

test("a run with no anchor markup or no blocks is built from what it has", () => {
  assert.deepEqual(buildRunAfter(null, [{ tag: "p", html: "x" }]), { after_html: "<p>x</p>", after: "x" });
  assert.deepEqual(buildRunAfter(undefined, null), { after_html: "", after: "" });
  assert.deepEqual(buildRunAfter("Anchor", []), { after_html: "Anchor", after: "Anchor" });
  assert.deepEqual(buildRunAfter("Anchor", undefined), { after_html: "Anchor", after: "Anchor" });
});

test("the anchor view of a run record carries anchor_after_html as its after_html and its words as its after", () => {
  const run = worked();
  const view = anchorView(run);
  assert.equal(view.after_html, "What changed");
  assert.equal(view.after, "What changed");
  assert.notEqual(view, run);
  assert.equal(run.after_html?.includes("<h2>"), true, "the record itself is untouched");
  assert.equal(run.after?.includes("What the chat window"), true);
});

test("the anchor view of an ordinary record, or of no record, is the record itself", () => {
  const plain = anItem();
  assert.equal(anchorView(plain), plain);
  assert.equal(callUntyped(anchorView, null), null);
  const nullAnchor = anItem({ anchor_after_html: null });
  assert.equal(anchorView(nullAnchor), nullAnchor);
});

test("a record's anchor is the tag its region reference fingerprinted, else the context's element, lowercased", () => {
  assert.equal(anchorTagOf(runItem({ region: anchorRegion("H2") })), "h2");
  assert.equal(anchorTagOf(anItem({ context: { ...emptyContext(), element: "UL" } })), "ul");
  assert.equal(anchorTagOf(anItem({ region: anchorRegion("p"), context: { ...emptyContext(), element: "ul" } })), "p", "the fingerprint first");
  assert.equal(anchorTagOf(anItem({ region: { ...emptyRegion(), ref: { fingerprint: { tag: "" } } }, context: { ...emptyContext(), element: "ol" } })), "ol", "an empty tag falls through");
  assert.equal(anchorTagOf(anItem()), null);
  assert.equal(anchorTagOf(null), null);
  assert.equal(anchorTagOf(undefined), null);
});

test("a tag is named for the person: paragraph, heading, list or block", () => {
  assert.equal(anchorTypeOfTag("p"), "paragraph");
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) assert.equal(anchorTypeOfTag(tag), "heading", tag);
  assert.equal(anchorTypeOfTag("ul"), "list");
  assert.equal(anchorTypeOfTag("ol"), "list");
  for (const tag of ["div", "main", "toString", "constructor", "", null, undefined]) assert.equal(anchorTypeOfTag(tag), "block", String(tag));
});

test("a record's anchor type is its anchor tag's, and block when it has none", () => {
  assert.equal(anchorTypeName(runItem({ region: anchorRegion("p") })), "paragraph");
  assert.equal(anchorTypeName(runItem({ region: anchorRegion("h3") })), "heading");
  assert.equal(anchorTypeName(runItem({ region: anchorRegion("ol") })), "list");
  assert.equal(anchorTypeName(runItem({ region: anchorRegion("main") })), "block");
  assert.equal(anchorTypeName(anItem()), "block");
  assert.equal(anchorTypeName(null), "block");
});

test("a record's size is the UTF-8 bytes of its JSON, not its characters", () => {
  const item = { a: "中" };
  assert.equal(recordBytes(item), new TextEncoder().encode(JSON.stringify(item)).length);
  assert.equal(recordBytes({}), 2);
  assert.equal(recordBytes({ a: "中" }), 11, "the three-byte character counts three");
});

test("a run's markup is measured in the UTF-8 bytes of its blocks' html, skipping a block with none", () => {
  assert.equal(blocksBytes([{ tag: "p", html: "abc" }, { tag: "p", html: "中" }]), 6);
  assert.equal(blocksBytes([{ tag: "p", html: 5 }, null, "x", { tag: "p" }]), 0);
  assert.equal(blocksBytes([]), 0);
  assert.equal(blocksBytes(null), 0);
  assert.equal(blocksBytes(undefined), 0);
  assert.equal(callUntyped(blocksBytes, "abc"), 0);
});

function placedRun(): Item {
  const item = runItem({
    new_blocks: [
      { tag: "h2", html: "Plan for the week" },
      { tag: "p", html: "Two things today." },
      { tag: "ol", html: "<li>First item</li><li>Second item</li>" }
    ],
    created_at: "2026-09-30T01:00:00.000Z"
  });
  return handled(item);
}

function laterListEdit(overrides: Partial<Item> = {}): Item {
  return {
    ...runItem({
      before: "First item\n\nSecond item",
      before_html: "<li>First item</li><li>Second item</li>",
      anchor_after_html: "<li>First item</li><li>Second item</li><li>Third item</li>",
      new_blocks: [{ tag: "p", html: "A paragraph after the list." }],
      created_at: "2026-09-30T01:05:00.000Z"
    }),
    ...overrides
  };
}

test("a later record whose anchor is a placed block takes that block over", () => {
  const placed = placedRun();
  const later = laterListEdit();
  const handed = handedOverBlocks(placed, [placed, later]);
  assert.deepEqual(Object.keys(handed), ["2"]);
  assert.equal(handed[2]?.id, later.id);
  assert.equal(handed[2].html, "<li>First item</li><li>Second item</li><li>Third item</li>");
  assert.equal(handed[2].tag, null, "the later record changed no tag");
  assert.equal(handed[0], undefined);
});

test("a take-back, an older record, a comment and the record itself take nothing over", () => {
  const placed = placedRun();
  const older = laterListEdit({ created_at: "2026-09-30T00:59:00.000Z" });
  const takeBack = laterListEdit({ reverts: "itm_someone" });
  const comment = anItem({ kind: KIND.COMMENT, before: "First item\n\nSecond item", created_at: "2026-09-30T01:05:00.000Z" });
  assert.deepEqual(handedOverBlocks(placed, [placed, older, takeBack, comment]), {});
  assert.deepEqual(handedOverBlocks(placed, [{ ...placed }]), {}, "a copy with the item's id is the item");
});

test("a later record takes a block over by its words before the sitting, markup read as words", () => {
  const placed = placedRun();
  const byBefore = laterListEdit({ before_html: null, before: "Two things today." });
  assert.equal(handedOverBlocks(placed, [byBefore])[1]?.id, byBefore.id, "the before text when it has no before markup");
  const none = laterListEdit({ before_html: null, before: null });
  assert.deepEqual(handedOverBlocks(placed, [none]), {});
  const empty = laterListEdit({ before_html: "", before: "" });
  assert.deepEqual(handedOverBlocks(placed, [empty]), {}, "empty words take nothing");
});

test("a later record's tag and html are its anchor's, else its after markup", () => {
  const placed = placedRun();
  const retagged = laterListEdit({ anchor_tag_after: "ul" });
  assert.equal(handedOverBlocks(placed, [retagged])[2]?.tag, "ul");
  const noAnchor: Record<string, unknown> = { ...laterListEdit(), after_html: "<li>after</li>" };
  delete noAnchor["anchor_after_html"];
  assert.deepEqual(callUntyped(handedOverBlocks, placed, [noAnchor]), { 2: { id: noAnchor["id"], tag: null, html: "<li>after</li>" } });
  const nothing: Record<string, unknown> = { ...noAnchor, after_html: null };
  assert.deepEqual(callUntyped(handedOverBlocks, placed, [nothing]), { 2: { id: nothing["id"], tag: null, html: null } });
});

test("a later record that rewords the run's own reworded anchor takes the anchor over, except at the start of a container", () => {
  const placed = handled(
    runItem({
      before: "What changed",
      before_html: "What changed",
      anchor_after_html: "What changed this week",
      new_blocks: [{ tag: "p", html: "Two things today." }],
      created_at: "2026-09-30T01:00:00.000Z"
    })
  );
  const later = runItem({
    before: "What changed this week",
    before_html: "What changed this week",
    anchor_after_html: "What changed today",
    new_blocks: [],
    created_at: "2026-09-30T01:05:00.000Z"
  });
  const handed = handedOverBlocks(placed, [placed, later]);
  assert.equal(handed.anchor?.id, later.id);
  assert.equal(handed.anchor.html, "What changed today");
  const atStart = { ...placed, placement: PLACEMENT.START_OF_CONTAINER };
  assert.equal(handedOverBlocks(atStart, [atStart, later]).anchor, undefined);
});

test("the first later record to take a block over keeps it", () => {
  const placed = placedRun();
  const first = laterListEdit();
  const second = { ...laterListEdit(), id: "itm_second", created_at: "2026-09-30T01:06:00.000Z" };
  assert.equal(handedOverBlocks(placed, [placed, first, second])[2]?.id, first.id);
});

test("an empty or missing list takes nothing over, and a record's created_at compares as strings", () => {
  const placed = placedRun();
  assert.deepEqual(handedOverBlocks(placed, []), {});
  assert.deepEqual(handedOverBlocks(placed, null), {});
  assert.deepEqual(handedOverBlocks(placed, undefined), {});
  const same = laterListEdit({ created_at: placed.created_at });
  assert.equal(handedOverBlocks(placed, [same])[2]?.id, same.id, "the same moment is not older");
});

test("a run that added blocks says how many and where, naming structure and never the words", () => {
  const two = runItem({ new_blocks: [{ tag: "p", html: "One zqxcanary" }, { tag: "h2", html: "Two zqxcanary" }], region: anchorRegion("p") });
  assert.equal(runChangeText(two), "Added 2 blocks after this paragraph: p, h2. Their words are in new_blocks.");
  const one = runItem({ new_blocks: [{ tag: "p", html: "One zqxcanary" }], region: anchorRegion("h2") });
  assert.equal(runChangeText(one), "Added 1 block after this heading: p. Its words are in new_blocks.");
  const start = runItem({
    placement: PLACEMENT.START_OF_CONTAINER,
    before: "",
    before_html: "",
    anchor_after_html: "",
    new_blocks: [{ tag: "h2", html: "Notes zqxcanary" }, { tag: "p", html: "First thought zqxcanary" }],
    region: anchorRegion("main")
  });
  assert.equal(runChangeText(start), "Added 2 blocks at the start of the page: h2, p. Their words are in new_blocks.");
  for (const item of [two, one, start]) assert.equal(runChangeText(item).includes(CANARY), false);
});

test("a run that split the anchor says where the second part went, by its first index", () => {
  const split = runItem({
    before: "First half zqxcanary. Second half zqxcanary.",
    before_html: "First half zqxcanary. Second half zqxcanary.",
    anchor_after_html: "First half zqxcanary.",
    new_blocks: [{ tag: "p", html: "Second half zqxcanary.", from_anchor: true }]
  });
  assert.equal(runChangeText(split), "Split this paragraph in two after the anchor's new end. The second part is new_blocks[0], marked from_anchor.");
  assert.equal(runChangeText(split).includes("Added"), false, "a split with no typing has no Added sentence");
  const typed = runItem({
    before: "First half zqxcanary. Second half zqxcanary.",
    before_html: "First half zqxcanary. Second half zqxcanary.",
    anchor_after_html: "First half zqxcanary.",
    new_blocks: [
      { tag: "p", html: "Second half zqxcanary.", from_anchor: true },
      { tag: "p", html: "Typed after the split zqxcanary" }
    ]
  });
  assert.equal(
    runChangeText(typed),
    "Split this paragraph in two after the anchor's new end. The second part is new_blocks[0], marked from_anchor. Added 1 block after this paragraph: p. Its words are in new_blocks."
  );
  const later = runItem({
    before: "x",
    before_html: "x",
    anchor_after_html: "x",
    new_blocks: [{ tag: "p", html: "Typed" }, { tag: "p", html: "Tail zqxcanary", from_anchor: true }]
  });
  assert.ok(runChangeText(later).includes("new_blocks[1], marked from_anchor"));
});

test("a run that reworded its anchor says so when the words or the emphasis moved, and not when they did not", () => {
  const reworded = runItem({ before: "Old words", before_html: "Old words", anchor_after_html: "New words", new_blocks: [] });
  assert.equal(runChangeText(reworded), "Reworded this paragraph; its new markup is in anchor_after_html.");
  const emphasis = runItem({ before: "Old words", before_html: "Old words", anchor_after_html: "Old <strong>words</strong>", new_blocks: [] });
  assert.equal(runChangeText(emphasis), "Reworded this paragraph; its new markup is in anchor_after_html.");
  const same = runItem({ before: "Same", before_html: "Same", anchor_after_html: "Same", new_blocks: [{ tag: "p", html: "Added" }] });
  assert.equal(runChangeText(same).includes("Reworded"), false);
  const noHtml = runItem({ before: "Plain", before_html: null, anchor_after_html: "Plain", new_blocks: [] });
  assert.equal(runChangeText(noHtml), "Edited this paragraph.", "with no before markup the before text is compared");
  const split = runItem({
    before: "First half. Second half.",
    before_html: "First half. Second half.",
    anchor_after_html: "First half.",
    new_blocks: [{ tag: "p", html: "Second half.", from_anchor: true }]
  });
  assert.equal(runChangeText(split).includes("Reworded"), false, "the anchor plus its tail is what is compared");
});

test("a run that changed the anchor's type says so, except at the start of a container", () => {
  const retag = runItem({ kind: KIND.FORMAT_ONLY, before: "Plain", before_html: "Plain", anchor_after_html: "Plain", anchor_tag_after: "h2", new_blocks: [] });
  assert.equal(runChangeText(retag), "Changed this paragraph to h2.");
  const both = runItem({ before: "Old words", before_html: "Old words", anchor_after_html: "New words", anchor_tag_after: "h3", new_blocks: [] });
  assert.equal(runChangeText(both), "Reworded this paragraph; its new markup is in anchor_after_html. Changed this paragraph to h3.");
  const start = runItem({ placement: PLACEMENT.START_OF_CONTAINER, anchor_after_html: "", before: "", before_html: "", anchor_tag_after: "h2", new_blocks: [{ tag: "p", html: "x" }] });
  assert.equal(runChangeText(start).includes("Changed this"), false);
  assert.equal(runChangeText(start).includes("Reworded"), false);
});

test("a run with nothing to say is edited", () => {
  const nothing = runItem({ before: "Same", before_html: "Same", anchor_after_html: "Same", new_blocks: [] });
  assert.equal(runChangeText(nothing), "Edited this paragraph.");
  assert.equal(runChangeText(runItem({ before: "Same", before_html: "Same", anchor_after_html: "Same", new_blocks: [], region: anchorRegion("div") })), "Edited this block.");
});
