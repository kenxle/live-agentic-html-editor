// Binding a review to a site, and which review answers on a page (stable
// addresses, Task 1.4).
//
// Plan rows: V21 (the rail rule, without the session filter), V22 (binding
// authority), V24 (the Origin check reads the registry), V25 (old origins go
// at bind), V65 (same file, same address), V66 (bind target, over the route).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const pageRoutes = require("../../src/service/page_routes.js");
const sitesModule = require("../../src/service/sites.js");
const { sitesWorld, raw, writeFile, getPage } = require("../helpers/sites_world.js");

const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>";
const BIND = protocol.route("site.bind");

// --- V21: the page rule --------------------------------------------------------

/** A review straight onto disk, with the times the test chooses. */
function writeReview(state, id, meta) {
  const folder = path.join(state, "reviews", id);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(folder, "meta.json"), JSON.stringify(Object.assign({ token: "tok-" + id, origins: [] }, meta)));
}

function ruleWorld() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "lahe-rule-")));
  const state = path.join(root, "state");
  const folder = path.join(root, "docs");
  writeFile(folder, "a.html", PAGE);
  writeFile(folder, "b.html", PAGE);
  writeFile(folder, "c.md", "# c\n");
  const site = { root: folder, mode: "folder", mounts: {}, linked_files: {} };
  return { root, state, folder, site };
}

function pick(w, file, extra) {
  const full = path.join(w.folder, file);
  return pageRoutes.pickReview(w.state, Object.assign({}, w.site, extra || {}), {
    filePaths: [full],
    realFile: full,
    mounted: false
  });
}

test("V21: a review that recorded the exact file wins, the newest one first", () => {
  const w = ruleWorld();
  writeReview(w.state, "r-old", { target_path: path.join(w.folder, "a.html"), created_at: "2026-10-01T00:00:00.000Z", agent_session_id: "s1" });
  writeReview(w.state, "r-new", { target_path: path.join(w.folder, "a.html"), created_at: "2026-10-02T00:00:00.000Z", agent_session_id: "s2" });
  writeReview(w.state, "r-folder", { target_path: w.folder, created_at: "2026-10-03T00:00:00.000Z", agent_session_id: "s3" });
  assert.equal(pick(w, "a.html").review, "r-new");
});

test("V21: re-serving stamps a review newer, so the most recent explicit act decides", () => {
  const w = ruleWorld();
  writeReview(w.state, "r-old", { target_path: path.join(w.folder, "a.html"), created_at: "2026-10-01T00:00:00.000Z", served_at: "2026-10-05T00:00:00.000Z" });
  writeReview(w.state, "r-new", { target_path: path.join(w.folder, "a.html"), created_at: "2026-10-02T00:00:00.000Z" });
  assert.equal(pick(w, "a.html").review, "r-old");
  // And a review created after that Open still wins over it.
  writeReview(w.state, "r-later", { target_path: path.join(w.folder, "a.html"), created_at: "2026-10-06T00:00:00.000Z" });
  assert.equal(pick(w, "a.html").review, "r-later");
});

test("V21: a tie on time is broken by the id, the same way every time", () => {
  const w = ruleWorld();
  const at = "2026-10-01T00:00:00.000Z";
  writeReview(w.state, "r-a", { target_path: path.join(w.folder, "a.html"), created_at: at });
  writeReview(w.state, "r-b", { target_path: path.join(w.folder, "a.html"), created_at: at });
  assert.equal(pick(w, "a.html").review, "r-b");
});

test("V21: else the newest review whose served root is this site's root, with no session filter", () => {
  const w = ruleWorld();
  writeReview(w.state, "r-page", { target_path: path.join(w.folder, "a.html"), created_at: "2026-10-01T00:00:00.000Z", agent_session_id: "s1" });
  writeReview(w.state, "r-other-session", { target_path: path.join(w.folder, "a.html"), created_at: "2026-10-02T00:00:00.000Z", agent_session_id: "s2" });
  // b.html was recorded by nobody: a single-page review of a.html lends its rail.
  assert.equal(pick(w, "b.html").review, "r-other-session");
});

test("V21: a Markdown review's served root is its source folder", () => {
  const w = ruleWorld();
  writeReview(w.state, "r-md", {
    target_path: path.join(w.state, "artifact.html"),
    source_path: path.join(w.folder, "c.md"),
    created_at: "2026-10-01T00:00:00.000Z"
  });
  assert.equal(pick(w, "c.md").review, "r-md");
  assert.equal(pick(w, "b.html").review, "r-md");
});

test("V21: --only opts out of lending the rail", () => {
  const w = ruleWorld();
  writeReview(w.state, "r-only", { target_path: path.join(w.folder, "a.html"), created_at: "2026-10-01T00:00:00.000Z", only_recorded_pages: true });
  assert.equal(pick(w, "a.html").review, "r-only");
  assert.equal(pick(w, "b.html"), null);
});

test("V21: else the newest review that linked to this file", () => {
  const w = ruleWorld();
  const elsewhere = path.join(w.root, "elsewhere");
  writeFile(elsewhere, "hub.html", PAGE);
  writeReview(w.state, "r-hub", { target_path: path.join(elsewhere, "hub.html"), created_at: "2026-10-01T00:00:00.000Z" });
  writeReview(w.state, "r-hub-only", { target_path: path.join(elsewhere, "hub.html"), created_at: "2026-10-03T00:00:00.000Z", only_recorded_pages: true });
  const linked = {};
  linked[path.join(w.folder, "b.html")] = ["r-hub", "r-hub-only"];
  assert.equal(pick(w, "b.html", { linked_files: linked }).review, "r-hub");
  assert.equal(pick(w, "a.html", { linked_files: linked }), null);
});

test("V21: with no review at all the page is read-only", () => {
  const w = ruleWorld();
  assert.equal(pick(w, "a.html"), null);
});

// --- binding over the route ------------------------------------------------------

function bindRequest(w, body, headers) {
  return raw(w.helper.port, {
    method: "POST",
    path: BIND.path,
    headers: Object.assign({
      host: "127.0.0.1:" + w.helper.port,
      "content-type": "application/json",
      "x-lahe-client": "cli",
      "x-lahe-cli-secret": sitesModule.readCliSecret(w.state)
    }, headers || {}),
    body: body
  });
}

async function boundWorld(t) {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  const page = writeFile(folder, "page.html", PAGE);
  return Object.assign(w, { folder, page });
}

// --- V22: binding authority ----------------------------------------------------

test("V22: site.bind refuses a request without the CLI secret", async (t) => {
  const w = await boundWorld(t);
  const review = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s1" });
  const body = { review: review.id, root: w.folder, mode: "folder", entry: "page.html" };
  for (const secret of [undefined, "", "0".repeat(64)]) {
    const res = await bindRequest(w, body, { "x-lahe-cli-secret": secret });
    assert.equal(res.status, 401, String(secret));
  }
  assert.equal(w.helper.sites.list().length, 0);
  // The positive control.
  assert.equal((await bindRequest(w, body)).status, 200);
  assert.equal(w.helper.sites.list().length, 1);
});

test("V22: site.bind refuses any request carrying an Origin, even with the secret", async (t) => {
  const w = await boundWorld(t);
  const review = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s1", origins: ["null"] });
  const body = { review: review.id, root: w.folder, mode: "folder", entry: "page.html" };
  for (const origin of ["null", "http://127.0.0.1:" + w.helper.port, "http://evil.example"]) {
    const res = await bindRequest(w, body, { origin });
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  }
  assert.equal(w.helper.sites.list().length, 0);
});

test("V22: the CLI secret file is owner-only", async (t) => {
  const w = await boundWorld(t);
  assert.equal(fs.statSync(sitesModule.secretPath(w.state)).mode & 0o777, 0o600);
});

// --- V66 over the route --------------------------------------------------------

test("V66: site.bind refuses the filesystem root, the state folder, and a root that is not a folder", async (t) => {
  const w = await boundWorld(t);
  const review = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s1" });
  const cases = [
    { root: path.parse(w.folder).root, mode: "folder" },
    { root: w.state, mode: "folder" },
    { root: path.join(w.state, "reviews"), mode: "folder" },
    { root: w.page, mode: "folder" }
  ];
  for (const c of cases) {
    const res = await bindRequest(w, Object.assign({ review: review.id, entry: "page.html" }, c));
    assert.equal(res.status, 400, c.root);
  }
  assert.equal(w.helper.sites.list().length, 0);
});

// --- V25: old origins -----------------------------------------------------------

test("V25: binding removes the review's old 127.0.0.1:<port> origins and keeps the rest", async (t) => {
  const w = await boundWorld(t);
  const review = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s1" });
  for (const o of ["null", "http://127.0.0.1:51234", "http://localhost:51234", "https://localhost:8443", "http://127.0.0.1:3000"]) {
    w.helper.reviews.registerOrigin(review.id, o);
  }
  const res = await bindRequest(w, { review: review.id, root: w.folder, mode: "folder", entry: "page.html" });
  assert.equal(res.status, 200);
  assert.deepEqual(w.helper.reviews.get(review.id).origins.sort(), ["https://localhost:8443", "null"]);
  const meta = JSON.parse(fs.readFileSync(path.join(w.state, "reviews", review.id, "meta.json"), "utf8"));
  assert.deepEqual(meta.origins.sort(), ["https://localhost:8443", "null"]);
  assert.ok(meta.served_at, "the bind stamped the review as re-served");
});

// --- V65: same file, same address --------------------------------------------------

test("V65: two reviews of one file, in two sessions, print the same address", async (t) => {
  const w = await boundWorld(t);
  const one = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s1" });
  const two = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s2" });
  const a = await bindRequest(w, { review: one.id, root: w.folder, mode: "folder", entry: "page.html" });
  const b = await bindRequest(w, { review: two.id, root: w.folder, mode: "folder", entry: "page.html" });
  assert.equal(a.status, 200);
  assert.equal(a.json.url, b.json.url);
  assert.equal(a.json.url, "http://ws.repo.docs.lahe.localhost:" + w.helper.pagesPort + "/page.html");
  assert.equal(a.json.printed_ending, "lahe.localhost");
});

// --- V24: the Origin check reads the registry ----------------------------------------

async function readReview(w, reviewId, token, origin) {
  return raw(w.helper.port, {
    path: protocol.route("review.read").path + "?review=" + reviewId,
    headers: {
      host: "127.0.0.1:" + w.helper.port,
      "x-lahe-client": "layer",
      "x-lahe-token": token,
      origin: origin
    }
  });
}

test("V24: a page request's Origin is accepted only from the site the rule maps to that review", async (t) => {
  const w = await boundWorld(t);
  const otherFolder = path.join(w.home, "ws", "other", "notes");
  const otherPage = writeFile(otherFolder, "x.html", PAGE);
  const mine = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s1" });
  const theirs = w.helper.reviews.create({ target_path: otherPage, agent_session_id: "s1" });
  const a = await bindRequest(w, { review: mine.id, root: w.folder, mode: "folder", entry: "page.html" });
  const b = await bindRequest(w, { review: theirs.id, root: otherFolder, mode: "folder", entry: "x.html" });
  // The positive control: the review's own site.
  const ok = await readReview(w, mine.id, mine.token, a.json.origin);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["access-control-allow-origin"], a.json.origin);
  // Site B's page holding site A's review token is refused.
  const refused = await readReview(w, mine.id, mine.token, b.json.origin);
  assert.equal(refused.status, 403);
  // An unregistered name, and a registered name on the wrong port, too.
  assert.equal((await readReview(w, mine.id, mine.token, "http://no.such.lahe.localhost:" + w.helper.pagesPort)).status, 403);
  assert.equal((await readReview(w, mine.id, mine.token, a.json.origin.replace(/:\d+$/, ":1"))).status, 403);
});

test("V24: a site origin passes the preflight only when it is a registered site", async (t) => {
  const w = await boundWorld(t);
  const review = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s1" });
  const a = await bindRequest(w, { review: review.id, root: w.folder, mode: "folder", entry: "page.html" });
  async function preflight(origin) {
    return raw(w.helper.port, {
      method: "OPTIONS",
      path: protocol.route("review.read").path,
      headers: { host: "127.0.0.1:" + w.helper.port, origin, "access-control-request-method": "GET" }
    });
  }
  const ok = await preflight(a.json.origin);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers["access-control-allow-origin"], a.json.origin);
  assert.equal((await preflight("http://no.such.lahe.localhost:" + w.helper.pagesPort)).status, 403);
});

test("the address site.bind returns serves the page with the bound review's rail", async (t) => {
  const w = await boundWorld(t);
  const review = w.helper.reviews.create({ target_path: w.page, agent_session_id: "s1" });
  const a = await bindRequest(w, { review: review.id, root: w.folder, mode: "folder", entry: "page.html" });
  const name = /^http:\/\/(.+)\.lahe\.localhost:\d+$/.exec(a.json.origin)[1];
  const res = await getPage(w, name, "/page.html");
  assert.match(res.text, new RegExp('data-lahe-review="' + review.id + '"'));
});
