// Replay of a run record against the flow walk's failures (fix builder G2),
// on a page with replay loaded straight from src/ (support/replay_run_page.js).
//
//   a block a later record took over  the run is outstanding again (reopened
//                                     for another reason, or before the reply
//                                     folds), and the reviewer's later record
//                                     changed one of its placed blocks: replay
//                                     raises no clash on it and never puts the
//                                     old block back beside the new one
//
// The full flows, with a real helper and a real agent, are in
// free_writing_flow_fix.spec.js.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer } = require("../helpers");
const { openReplayPage, setItems } = require("./support/replay_run_page");
const fixtures = require("../../src/shared/record_fixtures.js");

const FIXTURES = path.join(__dirname, "..", "fixtures");

let server = null;
test.beforeAll(async () => {
  server = await startStaticServer({ root: FIXTURES });
});
test.afterAll(async () => {
  if (server) await server.close();
});

function stamped(item, stamp, tag) {
  item.region = { ref: { id: "ref_" + stamp, probe: null, stamp: stamp, fingerprint: { tag: tag } }, label: "anchor", lost: null };
  return item;
}

test("a placed list a later record added an item to: the placed run raises no clash and does not put the old list back", async ({ page }) => {
  await openReplayPage(page, server, "free_writing/blog.html");
  const f = fixtures.createFixtures({ seed: "g2-replay" });
  const placed = stamped(
    f.runItem({
      before: "We stopped measuring motion and started measuring outcomes.",
      before_html: "We stopped <strong>measuring motion</strong> and started measuring outcomes.",
      anchor_after_html: "We stopped <strong>measuring motion</strong> and started measuring outcomes.",
      new_blocks: [
        { tag: "h2", html: "Plan for the week" },
        { tag: "p", html: "Two things today." },
        { tag: "ol", html: "<li>First item</li><li>Second item</li>" }
      ]
    }),
    "s-p2",
    "p"
  );
  placed.created_at = "2026-09-30T01:00:00.000Z";
  const later = stamped(
    f.runItem({
      before: "First item\n\nSecond item",
      before_html: "<li>First item</li><li>Second item</li>",
      anchor_after_html: "<li>First item</li><li>Second item</li><li>Third item</li>",
      new_blocks: [{ tag: "p", html: "A paragraph after the list." }]
    }),
    "s-ol",
    "ol"
  );
  later.created_at = "2026-09-30T01:05:00.000Z";
  // The page as the agent built it, with the later record already on it.
  await page.evaluate(() => {
    const p2 = document.getElementById("p2");
    p2.setAttribute("data-lahe-id", "s-p2");
    const h = document.createElement("h2");
    h.textContent = "Plan for the week";
    const p = document.createElement("p");
    p.textContent = "Two things today.";
    const ol = document.createElement("ol");
    ol.setAttribute("data-lahe-id", "s-ol");
    ol.innerHTML = "<li>First item</li><li>Second item</li><li>Third item</li>";
    const tail = document.createElement("p");
    tail.textContent = "A paragraph after the list.";
    p2.after(h, p, ol, tail);
  });
  await setItems(page, [placed, later]);
  await page.evaluate(() => window.__pass());
  await page.evaluate(() => window.__pass());
  const got = await page.evaluate(() => ({
    conflicts: window.LAHE.replay.conflictIds(),
    lists: document.querySelectorAll("#post ol").length,
    first: window.__count("First item"),
    third: window.__count("Third item"),
    para: window.__count("A paragraph after the list.")
  }));
  expect(got).toEqual({ conflicts: [], lists: 1, first: 1, third: 1, para: 1 });
});
