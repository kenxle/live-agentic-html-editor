// A review can hold more than one Markdown source. One review per file adds a
// linked document to the linking review that holds a comment on it
// (`lahe review far.md --session S` runs add --review L --source far.md). That
// used to replace L's source_path, so the hub lost its rail and stopped
// re-rendering, and a later `lahe review hub.md` made a split. Now a review
// keeps every source: source_path stays the first, and source_paths lists all
// of them for the page pick, the served roots, the handled check and rebuild.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const markdown = require("../../src/service/markdown.js");
const rebuildModule = require("../../src/service/rebuild.js");
const pageRoutes = require("../../src/service/page_routes.js");
const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

const SESSION = "s_many";

test("adding a second Markdown source keeps the first, and both pages keep the review's rail and re-render", async (t) => {
  const w = await sitesWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  const other = path.join(w.home, "ws", "other");
  const hub = writeFile(notes, "hub.md", "# Hub\n\n[far](../../other/far.md)\n");
  const far = writeFile(other, "far.md", "# Far\n\nThe far words.\n");
  const hubArtifact = markdown.writeArtifact(w.state, SESSION, hub).target;
  const review = w.helper.reviews.create({ target_path: hubArtifact, source_path: hub, agent_session_id: SESSION, origins: ["null"] });
  const hubSite = w.helper.sites.bind({ root: fs.realpathSync.native(notes), mode: "folder", entry: "hub.md" });

  // What `lahe review far.md --session S` does through add --review --source.
  const farArtifact = markdown.writeArtifact(w.state, SESSION, far).target;
  w.helper.reviews.recordPaths(review.id, { target_path: farArtifact, source_path: far });
  const held = w.helper.reviews.get(review.id);
  assert.equal(held.source_path, hub, "the first source stays");
  assert.deepEqual(held.source_paths, [hub, far]);
  const farSite = w.helper.sites.bind({ root: fs.realpathSync.native(other), mode: "folder", entry: "far.md" });

  const hubPage = await getPage(w, hubSite.name, "/hub.md");
  assert.match(hubPage.text, new RegExp('data-lahe-review="' + review.id + '"'), "the hub keeps its rail");
  const farPage = await getPage(w, farSite.name, "/far.md");
  assert.match(farPage.text, new RegExp('data-lahe-review="' + review.id + '"'));

  // Both sources change; one refresh re-renders both artifacts.
  const later = new Date(Date.now() + 60000);
  fs.writeFileSync(hub, "# Hub\n\nThe hub changed.\n");
  fs.writeFileSync(far, "# Far\n\nThe far changed.\n");
  fs.utimesSync(hub, later, later);
  fs.utimesSync(far, later, later);
  const rebuilder = rebuildModule.createRebuilder({ dir: w.state, ttlMs: 0 });
  const meta = rebuildModule.readMeta(w.state, review.id);
  rebuilder.refresh(Object.assign({ id: review.id }, meta));
  assert.match(fs.readFileSync(hubArtifact, "utf8"), /The hub changed/);
  assert.match(fs.readFileSync(farArtifact, "utf8"), /The far changed/);
  assert.equal(pageRoutes.holderOfFile(w.state, hub).review, review.id, "the hub is still this review's file");
});
