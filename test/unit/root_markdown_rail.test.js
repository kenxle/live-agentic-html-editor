// A Markdown file under a page server's own root gets the rail.
//
// Spec: docs/features/20261007.02_md_in_root_gets_rail/01_spec_md_in_root_gets_rail.md
//
// The forge's spec pages link to a sibling `.md` progress page. That file sits
// under the server's own root, not under a mount, and used to be rendered
// read-only with no rail even while the folder was under review. These tests
// pin the three answers a root `.md` gets:
//
//  - its own review in this session wins: a redirect, no token carried over
//  - otherwise the review that backs the root lends its rail
//  - otherwise (no review, `--only`, another session's review) read-only

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const staticServers = require("../../src/service/static_servers.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const scriptLine = require("../../src/shared/script_line.js");
const markdown = require("../../src/service/markdown.js");
const markdownLinks = require("../../src/service/markdown_links.js");

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function request(meta, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: meta.host, port: meta.port, path: pathname, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const PAGE = "<!doctype html>\n<html>\n<body>\n<h1>page</h1>\n</body>\n</html>\n";
const SESSION = "s_root_md";

/**
 * A folder with `hub.html` and `notes.md`, a server on it, and (unless
 * `backed` is false) a review of `hub.html` that backs the folder.
 */
async function fixture(t, options) {
  const opts = options || {};
  const root = tempDir("lahe-root-md-root-");
  const state = path.join(tempDir("lahe-root-md-state-"), "state");
  const hub = path.join(root, "hub.html");
  const notes = path.join(root, "notes.md");
  fs.writeFileSync(hub, PAGE);
  fs.writeFileSync(notes, "# Notes\n\nThe root words.\n");
  const log = logModule.createEventLog({ dir: state });
  const reviews = reviewsModule.createReviews({ dir: state, log: log });
  if (opts.backed !== false) {
    reviews.create({
      id: "r_root",
      origins: ["null"],
      target_path: hub,
      agent_session_id: opts.backingSession || SESSION,
      only_recorded_pages: !!opts.only
    });
  }
  const server = await staticServers.start({ dir: state, sessionId: SESSION, root: root });
  t.after(async () => {
    await staticServers.stopAll(state, SESSION);
    await staticServers.stopAll(state, "s_other");
  });
  return { root, state, hub, notes, reviews, server };
}

/** A review whose source is `notes.md`, as `lahe review notes.md` records it. */
function reviewNotes(f, sessionId) {
  const artifact = markdown.writeArtifact(f.state, sessionId, f.notes);
  f.reviews.create({
    id: "r_notes",
    origins: ["null"],
    target_path: artifact.target,
    source_path: f.notes,
    agent_session_id: sessionId
  });
  return artifact;
}

test("a root Markdown file with its own live review redirects to that review's page", async (t) => {
  const f = await fixture(t);
  const artifact = reviewNotes(f, SESSION);
  const own = await staticServers.start({ dir: f.state, sessionId: SESSION, root: path.dirname(artifact.target) });
  const res = await request(f.server.meta, "/notes.md");
  assert.equal(res.status, 302);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(
    res.headers.location,
    "http://" + own.meta.host + ":" + own.meta.port + "/" + encodeURIComponent(path.basename(artifact.target))
  );
  assert.equal(res.body.indexOf("r_notes"), -1, "no review id rides the redirect");
  assert.equal(res.body.indexOf(f.reviews.get("r_notes").token), -1, "no token rides the redirect");
});

test("a root Markdown file with no review of its own carries the root review's rail", async (t) => {
  const f = await fixture(t);
  const res = await request(f.server.meta, "/notes.md");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), "r_root");
  assert.ok(res.body.indexOf(f.reviews.get("r_root").token) !== -1);
  assert.match(res.body, /The root words\./);
  assert.doesNotMatch(res.body, /This document is not under review/, "the read-only note is gone once it has a rail");
});

test("a root Markdown file whose own review's server is stopped carries the root review's rail", async (t) => {
  const f = await fixture(t);
  reviewNotes(f, SESSION);
  const res = await request(f.server.meta, "/notes.md");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), "r_root");
});

test("a root Markdown file with no review behind the root stays read-only", async (t) => {
  const f = await fixture(t, { backed: false });
  const res = await request(f.server.meta, "/notes.md");
  assert.equal(res.status, 200);
  assert.equal(res.body.indexOf("data-lahe-review"), -1);
  assert.match(res.body, /This document is not under review/);
});

test("a root Markdown file stays read-only when the only root review is --only", async (t) => {
  const f = await fixture(t, { only: true });
  const res = await request(f.server.meta, "/notes.md");
  assert.equal(res.status, 200);
  assert.equal(res.body.indexOf("data-lahe-review"), -1);
  assert.match(res.body, /This document is not under review/);
});

test("another agent session's review is never used for a root Markdown file", async (t) => {
  const f = await fixture(t, { backingSession: "s_other" });
  const res = await request(f.server.meta, "/notes.md");
  assert.equal(res.status, 200);
  assert.equal(res.body.indexOf("data-lahe-review"), -1);
  assert.equal(res.body.indexOf(f.reviews.get("r_root").token), -1);
  assert.match(res.body, /This document is not under review/);
});

// On purpose: a root Markdown file that carries the rail is a hub like any
// reviewed page, so the rail follows its links too. A file nothing links to
// stays plain; see the security note in the spec.
test("a root Markdown file passes its rail on to a document it links to outside the root", async (t) => {
  const home = tempDir("lahe-root-md-home-");
  const previousHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  t.after(() => {
    if (previousHome === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = previousHome;
  });
  const root = path.join(home, "a");
  const outside = path.join(home, "b");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  const state = path.join(tempDir("lahe-root-md-state-"), "state");
  const hub = path.join(root, "hub.html");
  fs.writeFileSync(hub, PAGE);
  fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\n- [Plan](../b/plan.md)\n");
  fs.writeFileSync(path.join(outside, "plan.md"), "# Plan\n\nThe plan words.\n");
  const log = logModule.createEventLog({ dir: state });
  const reviews = reviewsModule.createReviews({ dir: state, log: log });
  reviews.create({ id: "r_root", origins: ["null"], target_path: hub, agent_session_id: SESSION });
  const server = await staticServers.start({ dir: state, sessionId: SESSION, root: root });
  t.after(async () => {
    await staticServers.stopAll(state, SESSION);
  });

  const notes = await request(server.meta, "/notes.md");
  assert.equal(scriptLine.reviewAlreadyInFile(notes.body), "r_root");
  const href = markdownLinks.mountPrefix(outside) + "plan.md";
  assert.ok(notes.body.indexOf(href) !== -1, "the link is translated to a mounted URL");

  const plan = await request(server.meta, href);
  assert.equal(plan.status, 200);
  assert.match(plan.body, /The plan words\./);
  assert.equal(scriptLine.reviewAlreadyInFile(plan.body), "r_root", "the linked document rides the root review");
});
