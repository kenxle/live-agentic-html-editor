"use strict";

// The worktree candidate (Library fix round, SEC2 and SEC5): the main-repo copy
// of a gone worktree's document, which an agent is told to serve. A candidate
// path is page-derived, so:
//
//   - a path holding a quote or a control character is never a candidate
//     (SEC2: nothing an agent might paste into a shell string);
//   - the extension checked is the REAL path's, and the real path is what is
//     returned (SEC5: a symlink `x.md` to a `.json` is not a page).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const catalogReader = require("../../src/service/catalog_reader.js");
const fixture = require("../fixtures/catalog_state.js");

/** Point r_wt_gone at `<alpha>/.claude/worktrees/wt-gone/<rel>` and describe it. */
function candidateFor(installed, rel) {
  const alpha = path.join(installed.home, "projects/alpha");
  const target = path.join(alpha, ".claude/worktrees/wt-gone", rel);
  const metaFile = path.join(installed.dir, "reviews", "r_wt_gone", "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  meta.target_path = target;
  meta.target_paths = [target];
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");
  const reader = catalogReader.createReader({
    dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false
  });
  return reader.describeReview("r_wt_gone", installed.nowMs).candidate;
}

test("a candidate whose path holds a quote or a control character is null", () => {
  const installed = fixture.install();
  const alpha = path.join(installed.home, "projects/alpha");
  ["docs/a'$(touch pwned)'.md", "docs/say\"hi\".html", "docs/tab\there.html", "docs/nl\nhere.html"].forEach((rel) => {
    fs.writeFileSync(path.join(alpha, rel), "<p>page</p>");
    assert.equal(candidateFor(installed, rel), null, JSON.stringify(rel));
  });
});

test("a symlink named like a page whose real file is not a page is null", () => {
  const installed = fixture.install();
  const alpha = path.join(installed.home, "projects/alpha");
  fs.writeFileSync(path.join(alpha, "docs/data.json"), "{}");
  fs.symlinkSync(path.join(alpha, "docs/data.json"), path.join(alpha, "docs/x.md"));
  assert.equal(candidateFor(installed, "docs/x.md"), null);
});

test("a symlink to a real page inside the repository gives the real path", () => {
  const installed = fixture.install();
  const alpha = path.join(installed.home, "projects/alpha");
  fs.writeFileSync(path.join(alpha, "docs/real.html"), "<p>real</p>");
  fs.symlinkSync(path.join(alpha, "docs/real.html"), path.join(alpha, "docs/alias.html"));
  assert.equal(candidateFor(installed, "docs/alias.html"), fs.realpathSync(path.join(alpha, "docs/real.html")));
});
