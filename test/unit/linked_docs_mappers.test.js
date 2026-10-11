// Linked-document behavior that is still live, restored from the retired
// test/retired/unit/linked_docs_rail.test.js for stable addresses: the reload
// and the handled check for a linked page read the linked file, a Markdown
// render lists the real files behind its links, and a path the site's mounts
// cannot vouch for names no file. The page servers those tests started are
// gone; each test here serves from an in-process helper on free ports, closed
// in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pageRoutes = require("../../src/service/page_routes.js");
const markdown = require("../../src/service/markdown.js");
const markdownLinks = require("../../src/service/markdown_links.js");
const handledCheck = require("../../src/service/handled_check.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

/** A hub Markdown page that links to doc.md in another folder, a review of it, and its mount. */
async function hubWorld(t) {
  const w = await sitesWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  const linked = path.join(w.home, "ws", "other");
  writeFile(linked, "doc.md", "# Linked doc\n\nThe linked words.\n");
  writeFile(linked, "sibling.html", "<!doctype html><p>sibling</p>");
  writeFile(linked, ".env", "SECRET=1\n");
  const hub = writeFile(notes, "hub.md", "# Hub\n\nThe hub words. [doc](../../other/doc.md)\n");
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(notes), mode: "folder", entry: "hub.md" });
  const review = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-hub.html"),
    source_path: hub,
    agent_session_id: "s_hub",
    origins: ["null"]
  });
  const page = await getPage(w, bound.name, "/hub.md");
  const mount = /href="(\/\.lahe-source\/[a-f0-9]+\/)doc\.md"/.exec(page.text);
  assert.ok(mount, "the hub's link is a mount");
  return Object.assign(w, {
    review,
    hub,
    prefix: mount[1],
    linked: fs.realpathSync.native(linked),
    origin: protocol.siteOrigin(bound.name, w.helper.pagesPort)
  });
}

test("the reload for a linked page stats the linked file, not the hub", async (t) => {
  const w = await hubWorld(t);
  const doc = path.join(w.linked, "doc.md");
  const past = new Date("2026-01-01T00:00:00.000Z");
  fs.utimesSync(doc, past, past);
  assert.equal(w.helper.reviews.targetMtime(w.review.id, w.prefix + "doc.md", w.origin), past.toISOString());
  assert.equal(w.helper.reviews.targetMtime(w.review.id, w.prefix + "sibling.html", w.origin), null, "an unvouched mount path reloads nothing");
  assert.equal(fs.readFileSync(doc, "utf8").indexOf("data-lahe-review"), -1, "nothing is healed into a linked file");
});

test("a handled check for a linked page reads the linked file", async (t) => {
  const w = await hubWorld(t);
  // Both files older than the item: the agent wrote nothing after it.
  const past = new Date("2026-01-01T00:00:00.000Z");
  fs.utimesSync(path.join(w.linked, "doc.md"), past, past);
  fs.utimesSync(w.hub, past, past);
  const checker = handledCheck.createHandledCheck({ dir: w.state });
  const edit = (after) => record.newItem({
    kind: record.KIND.EDIT,
    state: record.STATE.READY,
    before: "The linked words.",
    after,
    page_origin: w.origin,
    page_path: w.prefix + "doc.md",
    page_title: "Linked doc",
    page_seq: 1,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z"
  });
  assert.equal(checker.pageShows(w.review.id, edit("The linked words.")), true, "the words are in the linked file");
  assert.equal(checker.pageShows(w.review.id, edit("The hub words.")), false, "the hub's words are not the linked page's");
  assert.equal(checker.pageShows(w.review.id, edit("Words nobody wrote.")), false);
});

test("a render lists the real file behind every local link it translated", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-linked-render-")));
  const previousHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  try {
    fs.mkdirSync(path.join(home, "a", "refs"), { recursive: true });
    fs.mkdirSync(path.join(home, "b"));
    const source = path.join(home, "a", "hub.md");
    fs.writeFileSync(source, "# Hub\n\n- [Out](../b/out.md)\n- [Sibling](refs/near.md)\n- [Gone](../b/missing.md)\n");
    fs.writeFileSync(path.join(home, "b", "out.md"), "# Out\n");
    fs.writeFileSync(path.join(home, "a", "refs", "near.md"), "# Near\n");
    const registry = markdownLinks.createRegistry({});
    markdown.render(source, { links: registry });
    assert.deepEqual(registry.linked.slice().sort(), [
      path.join(home, "a", "refs", "near.md"),
      path.join(home, "b", "out.md")
    ]);
  } finally {
    if (previousHome === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = previousHome;
  }
});

test("a page path the site's mounts cannot vouch for names no file", async (t) => {
  const w = await hubWorld(t);
  assert.equal(pageRoutes.linkedFileForPage(w.state, w.review.id, w.prefix + "doc.md"), path.join(w.linked, "doc.md"), "the positive control");
  // A symlink inside the mount pointing outside it: even recorded as linked,
  // its real file is not inside the mount, so it names nothing.
  const outside = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-linked-outside-"))), "escape.md");
  fs.writeFileSync(outside, "# Outside\n");
  fs.symlinkSync(outside, path.join(w.linked, "escape.md"));
  const name = w.helper.sites.list()[0].name;
  w.helper.sites.addLinked(name, w.review.id, [outside, path.join(w.linked, "escape.md")]);
  const cases = [
    "/.lahe-source/0000000000000000/doc.md",
    w.prefix + "../repo/notes/hub.md",
    w.prefix + "..%2Fx.md",
    w.prefix + "sibling.html",
    w.prefix + ".env",
    w.prefix + "escape.md",
    "/hub.md"
  ];
  for (const pagePath of cases) assert.equal(pageRoutes.linkedFileForPage(w.state, w.review.id, pagePath), null, pagePath);
  assert.equal(pageRoutes.linkedFileForPage(w.state, "r_someone_else", w.prefix + "doc.md"), null);
});
