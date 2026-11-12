/*
 * read-when: Changing src/domain/revert.ts, or an undo of a handled edit, delete, format change or run asks the agent for the wrong thing, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { KIND, PLACEMENT, STATE, emptyContext, emptyRegion, isRevert } from "../../../src/contract/record.ts";
import { bumpRev, comparisonFields } from "../../../src/domain/item-revisions.ts";
import {
  REVERT_DELETE,
  REVERT_EDIT,
  REVERT_FORMAT,
  RUN_TAKEBACK_LINE,
  RUN_TAKEBACK_TAG_LINE,
  revertOf,
  takenBackIds
} from "../../../src/domain/revert.ts";
import { validateRun } from "../../../src/domain/run-check.ts";
import { anItem } from "./support/items.ts";
import { anchorRegion, handled, runItem, worked } from "./support/runs.ts";

test("the three take-back sentences are pinned", () => {
  assert.equal(REVERT_EDIT, "Undo: the reviewer took this change back. Remove it from the source, so the passage reads as it did before.");
  assert.equal(REVERT_DELETE, "Undo: the reviewer put this block back. Restore it in the source; it should not have been deleted.");
  assert.equal(REVERT_FORMAT, "Undo: the reviewer took this formatting change back. Put the markup back the way the source had it.");
  assert.equal(RUN_TAKEBACK_LINE, "Remove the blocks in remove_blocks from after this {type}; the reviewer undid them.");
  assert.equal(RUN_TAKEBACK_TAG_LINE, "Change this {type} back to {tag}, the tag in anchor_tag_after; the reviewer undid the type change.");
});

test("a take-back of an edit is an ordinary outstanding edit pointing the other way", () => {
  const edited = anItem({ state: STATE.HANDLED, before_html: "<p>old</p>", after_html: "<p>new</p>" });
  const back = revertOf(edited);
  assert.equal(back.kind, KIND.EDIT);
  assert.equal(back.state, STATE.READY, "it is work, not history");
  assert.equal(back.rev, 1);
  assert.equal(back.change, REVERT_EDIT);
  assert.equal(back.before, edited.after);
  assert.equal(back.after, edited.before);
  assert.equal(back.before_html, edited.after_html);
  assert.equal(back.after_html, edited.before_html);
  assert.equal(back.reverts, edited.id);
  assert.notEqual(back.id, edited.id, "a new item, so the handled record is kept");
  assert.equal(isRevert(back), true);
  assert.equal(isRevert(edited), false);
});

test("a take-back lands on the same page group, with the same page fields", () => {
  const edited = anItem({ state: STATE.HANDLED, source_hint: "a.html" });
  const back = revertOf(edited);
  assert.equal(back.page_origin, edited.page_origin);
  assert.equal(back.page_path, edited.page_path);
  assert.equal(back.page_title, edited.page_title);
  assert.equal(back.page_seq, edited.page_seq);
  assert.equal(back.source_hint, "a.html");
});

test("a take-back's region and context are the ones it is given, else empty, and its time is given or now", () => {
  const edited = anItem({ state: STATE.HANDLED, region: { ...emptyRegion(), label: "the edit's" } });
  const bare = revertOf(edited);
  assert.deepEqual(bare.region, emptyRegion());
  assert.deepEqual(bare.context, emptyContext());
  const region = { ...emptyRegion(), label: "given" };
  const context = { ...emptyContext(), quote: "given" };
  const given = revertOf(edited, { region, context, created_at: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(given.region, region);
  assert.deepEqual(given.context, context);
  assert.equal(given.created_at, "2026-01-01T00:00:00.000Z");
  assert.ok(Date.parse(bare.created_at) > Date.parse("2026-01-01T00:00:00.000Z"));
});

test("a take-back of an edit with no text reads an empty before and no markup", () => {
  const edited = { ...anItem({ state: STATE.HANDLED }), after: null, before: null, after_html: null, before_html: null };
  const back = revertOf(edited);
  assert.equal(back.before, "");
  assert.equal(back.after, "");
  assert.equal(back.before_html, null);
  assert.equal(back.after_html, null);
});

test("a reverted delete asks for the block back, and is an edit that puts the words back", () => {
  const deleted = anItem({ kind: KIND.DELETE, state: STATE.HANDLED, before: "The whole block.", after: null, before_html: "<p>The whole block.</p>", after_html: null });
  const back = revertOf(deleted);
  assert.equal(back.kind, KIND.EDIT);
  assert.equal(back.before, "");
  assert.equal(back.before_html, "");
  assert.equal(back.after, "The whole block.");
  assert.equal(back.after_html, "<p>The whole block.</p>");
  assert.equal(back.change, REVERT_DELETE);
});

test("a reverted format change stays format-only, so it compares on markup", () => {
  const formatted = anItem({
    kind: KIND.FORMAT_ONLY,
    state: STATE.HANDLED,
    before: "Warm up first.",
    after: "Warm up first.",
    before_html: "<p>Warm up first.</p>",
    after_html: "<p>Warm up <strong>first</strong>.</p>"
  });
  const back = revertOf(formatted);
  assert.equal(back.kind, KIND.FORMAT_ONLY);
  assert.equal(back.before_html, formatted.after_html);
  assert.equal(back.after_html, formatted.before_html);
  assert.deepEqual(comparisonFields(back), { before: "before_html", after: "after_html" });
  assert.equal(back.change, REVERT_FORMAT);
});

test("the take-back of a handled run lists the blocks in remove_blocks and has no new_blocks", () => {
  const run = handled(worked());
  const back = revertOf(run);
  assert.equal("new_blocks" in back, false);
  assert.deepEqual(back.remove_blocks, run.new_blocks);
  assert.notEqual(back.remove_blocks, run.new_blocks);
  assert.equal(back.reverts, run.id);
  assert.equal(back.change, REVERT_EDIT + " " + RUN_TAKEBACK_LINE.replace("{type}", "paragraph"));
  assert.equal(back.kind, KIND.EDIT);
  assert.equal(back.placement, PLACEMENT.AFTER_ANCHOR);
  assert.equal(validateRun(back), null);
});

test("a run take-back swaps the words and the markup, and keeps the run's region and context unless given others", () => {
  const run = handled(worked());
  const back = revertOf(run);
  assert.equal(back.before, run.after);
  assert.equal(back.after, run.before);
  assert.equal(back.before_html, run.after_html);
  assert.equal(back.after_html, run.before_html);
  assert.deepEqual(back.region, run.region);
  assert.deepEqual(back.context, run.context);
  const region = { ...emptyRegion(), label: "given" };
  assert.deepEqual(revertOf(run, { region }).region, region);
});

test("a run's placement rides back with its take-back, and a start-of-container run's sentence names the anchor's type", () => {
  const start = handled(runItem({ placement: PLACEMENT.START_OF_CONTAINER, anchor_after_html: "", before: "", before_html: "", region: anchorRegion("main") }));
  const back = revertOf(start);
  assert.equal(back.placement, PLACEMENT.START_OF_CONTAINER);
  assert.ok(back.change?.endsWith("Remove the blocks in remove_blocks from after this block; the reviewer undid them."), back.change ?? "");
});

test("a format-only run take-back is format-only, and any other kind of run is taken back as an edit", () => {
  assert.equal(revertOf(handled(runItem({ kind: KIND.FORMAT_ONLY }))).kind, KIND.FORMAT_ONLY);
  assert.equal(revertOf(handled(runItem({ kind: KIND.EDIT }))).kind, KIND.EDIT);
  assert.equal(revertOf(handled(runItem({ kind: KIND.FORMAT_ONLY }))).change?.startsWith(REVERT_FORMAT), true);
});

test("the take-back of a tag-only change goes back to the old tag", () => {
  const retag = handled(
    runItem({
      kind: KIND.FORMAT_ONLY,
      before: "Plain words zqxcanary",
      before_html: "Plain words zqxcanary",
      anchor_after_html: "Plain words zqxcanary",
      anchor_tag_after: "h2",
      new_blocks: [],
      region: anchorRegion("p")
    })
  );
  const back = revertOf(retag);
  assert.equal(back.reverts, retag.id);
  assert.equal(back.anchor_tag_after, "p", "the take-back names the anchor's old tag");
  assert.ok(back.change?.includes("Change this heading back to p"), back.change ?? "");
  assert.equal(back.change, REVERT_FORMAT + " " + RUN_TAKEBACK_TAG_LINE.replace("{type}", "heading").replace("{tag}", "p"));
  assert.deepEqual(back.remove_blocks, [], "the run had no blocks, so none are to be removed");
  assert.equal(validateRun(back), null);
});

test("the take-back of a run that also retagged the anchor restores the tag and removes the blocks", () => {
  const run = handled(
    runItem({
      before: "Words zqxcanary",
      before_html: "Words zqxcanary",
      anchor_after_html: "Words zqxcanary",
      anchor_tag_after: "h2",
      new_blocks: [{ tag: "p", html: "Below zqxcanary" }],
      region: anchorRegion("p")
    })
  );
  const back = revertOf(run);
  assert.equal(back.anchor_tag_after, "p");
  assert.deepEqual(back.remove_blocks, run.new_blocks);
  assert.ok(back.change?.includes("Change this heading back to p"), back.change ?? "");
  assert.ok(back.change?.includes("remove_blocks"), back.change ?? "");
  assert.equal(back.change, REVERT_EDIT + " Remove the blocks in remove_blocks from after this paragraph; the reviewer undid them. Change this heading back to p, the tag in anchor_tag_after; the reviewer undid the type change.");
  assert.equal(validateRun(back), null);
});

test("the take-back of a run with no tag change carries no tag", () => {
  const back = revertOf(handled(worked()));
  assert.equal("anchor_tag_after" in back, false);
  assert.equal(back.change?.includes("back to"), false);
});

test("a tag change is undone only when the old tag is a writable tag and differs from the new one", () => {
  const same = handled(runItem({ anchor_tag_after: "p", new_blocks: [], region: anchorRegion("p") }));
  assert.equal("anchor_tag_after" in revertOf(same), false);
  const notWritable = handled(runItem({ anchor_tag_after: "h2", new_blocks: [], region: anchorRegion("main") }));
  assert.equal("anchor_tag_after" in revertOf(notWritable), false, "main is not a tag the helper will write");
  const unknown = handled(runItem({ anchor_tag_after: "h2", new_blocks: [], region: { ...emptyRegion() } }));
  assert.equal("anchor_tag_after" in revertOf(unknown), false, "no anchor tag is known");
  const fromContext = handled(runItem({ anchor_tag_after: "ul", new_blocks: [], region: { ...emptyRegion() }, context: { ...emptyContext(), element: "H3" } }));
  assert.equal(revertOf(fromContext).anchor_tag_after, "h3", "the context's element, lowercased");
  assert.ok(revertOf(fromContext).change?.includes("Change this list back to h3"));
});

test("taken-back ids are the one definition of what a review has already withdrawn", () => {
  const first = anItem({ state: STATE.HANDLED });
  const other = anItem({ state: STATE.HANDLED });
  const back = revertOf(first);
  const taken = takenBackIds([first, other, back]);
  assert.equal(taken.has(first.id), true);
  assert.equal(taken.has(other.id), false);
  assert.equal(taken.size, 1);
});

test("an inherited name is not a taken-back id, because the set holds only ids", () => {
  const ids = takenBackIds([revertOf(anItem())]);
  assert.equal(ids.has("constructor"), false);
  assert.equal(ids.has("toString"), false);
  const odd = { ...anItem({ state: STATE.HANDLED }), id: "constructor" };
  assert.equal(takenBackIds([revertOf(odd)]).has("constructor"), true);
});

test("no list, or an empty one, has taken nothing back", () => {
  assert.equal(takenBackIds([]).size, 0);
  assert.equal(takenBackIds(null).size, 0);
  assert.equal(takenBackIds(undefined).size, 0);
  assert.equal(takenBackIds([bumpRev(anItem(), {})]).size, 0);
});
