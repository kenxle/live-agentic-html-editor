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
const protocol = require("../../src/shared/protocol.js");
const scriptLine = require("../../src/shared/script_line.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(meta, pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: meta.host, port: meta.port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a session-owned static server is reusable, read-only, contained, and stoppable", async (t) => {
  const root = tempDir("lahe-static-root-");
  const state = path.join(tempDir("lahe-static-state-"), "state");
  const outside = path.join(tempDir("lahe-static-outside-"), "secret.txt");
  fs.writeFileSync(path.join(root, "page.html"), "<!doctype html><p>review page</p>");
  fs.writeFileSync(outside, "do not serve");
  fs.symlinkSync(outside, path.join(root, "outside.txt"));

  const first = await staticServers.start({ dir: state, sessionId: "s_static", root });
  t.after(async () => { await staticServers.stopAll(state, "s_static"); });
  assert.equal(first.started, true);
  assert.equal(await staticServers.isExactServer(first.meta), true);

  const page = await request(first.meta, "/page.html");
  assert.equal(page.status, 200);
  assert.equal(page.body, "<!doctype html><p>review page</p>");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.match(page.headers["content-type"], /^text\/html/);

  assert.equal((await request(first.meta, "/outside.txt")).status, 403);
  assert.equal((await request(first.meta, "/page.html", "POST")).status, 405);

  const second = await staticServers.start({ dir: state, sessionId: "s_static", root });
  assert.equal(second.started, false);
  assert.equal(second.meta.instance, first.meta.instance);

  assert.equal(await staticServers.stopOne(state, "s_static", first.meta), true);
  assert.equal(await staticServers.isExactServer(first.meta), false);
  assert.ok(staticServers.list(state, "s_static")[0].stopped_at);
});

test("corrupt static-server metadata fails loud instead of losing process ownership", async () => {
  const state = path.join(tempDir("lahe-static-corrupt-"), "state");
  const root = path.join(state, "agent-sessions", "s_corrupt", "static-servers");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "ss_broken.json"), "not json");
  assert.throws(
    () => staticServers.list(state, "s_corrupt"),
    /metadata is corrupt/
  );
});

test("two agent sessions in the same project root own independent server leases", async (t) => {
  const root = tempDir("lahe-static-shared-root-");
  const state = path.join(tempDir("lahe-static-shared-state-"), "state");
  fs.writeFileSync(path.join(root, "page.html"), "<!doctype html><p>shared root</p>");
  const alpha = await staticServers.start({ dir: state, sessionId: "s_alpha", root });
  const beta = await staticServers.start({ dir: state, sessionId: "s_beta", root });
  t.after(async () => {
    await staticServers.stopAll(state, "s_alpha");
    await staticServers.stopAll(state, "s_beta");
  });

  assert.notEqual(alpha.meta.instance, beta.meta.instance);
  assert.notEqual(alpha.meta.port, beta.meta.port);
  await staticServers.stopAll(state, "s_alpha");
  assert.equal(await staticServers.isExactServer(alpha.meta), false);
  assert.equal(await staticServers.isExactServer(beta.meta), true);
});

test("one agent session can own static reviews in different project roots", async (t) => {
  const firstRoot = tempDir("lahe-static-first-root-");
  const secondRoot = tempDir("lahe-static-second-root-");
  const state = path.join(tempDir("lahe-static-many-state-"), "state");
  fs.writeFileSync(path.join(firstRoot, "one.html"), "one");
  fs.writeFileSync(path.join(secondRoot, "two.html"), "two");
  const first = await staticServers.start({ dir: state, sessionId: "s_many", root: firstRoot });
  const second = await staticServers.start({ dir: state, sessionId: "s_many", root: secondRoot });
  t.after(async () => { await staticServers.stopAll(state, "s_many"); });

  assert.equal(staticServers.list(state, "s_many").length, 2);
  assert.equal(await staticServers.isExactServer(first.meta), true);
  assert.equal(await staticServers.isExactServer(second.meta), true);
  assert.equal(await staticServers.stopAll(state, "s_many"), 2);
  assert.equal(await staticServers.isExactServer(first.meta), false);
  assert.equal(await staticServers.isExactServer(second.meta), false);
});

// ---------------------------------------------------------------------------
// Serve-time injection.
//
// heal.js only repairs a page something is already polling. If the reviewer's
// tab is closed, or they reload in the gap between an agent overwriting the
// file and the next poll, nothing was ever polling and nothing repairs it.
// This is the second, stronger path: the server that answers the request puts
// the tag in the RESPONSE, so even the very first load after an overwrite
// carries the rail.

const PAGE_WITHOUT_LINE = "<!doctype html>\n<html>\n<body>\n<h1>hello</h1>\n</body>\n</html>\n";

/** A review recording `root/page.html` as its target, and a server rooted there. */
function injectFixture(options) {
  const opts = options || {};
  const root = tempDir("lahe-static-inject-root-");
  const state = path.join(tempDir("lahe-static-inject-state-"), "state");
  const page = path.join(root, opts.filename || "page.html");
  fs.writeFileSync(page, opts.html === undefined ? PAGE_WITHOUT_LINE : opts.html);
  const log = logModule.createEventLog({ dir: state });
  const reviews = reviewsModule.createReviews({ dir: state, log: log });
  const review = reviews.create({ id: opts.reviewId || "r_inject", origins: ["null"], target_path: page });
  return { root: root, state: state, page: page, review: review };
}

test("a target file whose on-disk tag was stripped is served carrying the tag", async (t) => {
  const f = injectFixture();
  const server = await staticServers.start({ dir: f.state, sessionId: "s_inject_missing", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_inject_missing"); });

  const res = await request(server.meta, "/page.html");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), f.review.id, "the served page now carries this review's tag");
  assert.ok(res.body.indexOf(f.review.token) !== -1, "and it is this review's own token");
  assert.equal(
    Number(res.headers["content-length"]),
    Buffer.byteLength(res.body, "utf8"),
    "content-length was recalculated for the injected body"
  );
  assert.match(res.body, /<h1>hello<\/h1>/, "the page's own content survives the injection");
  assert.equal(
    fs.readFileSync(f.page, "utf8").indexOf("data-lahe-review"),
    -1,
    "the static server stayed read-only: the file on disk is untouched"
  );
});

test("a file that already carries this review's tag is served with exactly one, not two", async (t) => {
  const f = injectFixture();
  const tag = protocol.scriptTag({
    src: "http://" + protocol.DEFAULT_HOST + ":" + protocol.DEFAULT_PORT + protocol.route("library.get").path,
    review: f.review.id,
    token: f.review.token,
    helper: "http://" + protocol.DEFAULT_HOST + ":" + protocol.DEFAULT_PORT
  });
  fs.writeFileSync(f.page, scriptLine.placeScriptLine(PAGE_WITHOUT_LINE, tag).html);
  const onDiskBefore = fs.readFileSync(f.page, "utf8");

  const server = await staticServers.start({ dir: f.state, sessionId: "s_inject_present", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_inject_present"); });

  const res = await request(server.meta, "/page.html");
  assert.equal(res.status, 200);
  const occurrences = (res.body.match(/data-lahe-review="/g) || []).length;
  assert.equal(occurrences, 1, "the tag was not injected a second time");
  assert.equal(res.body, onDiskBefore, "an already-tagged page is served byte for byte unchanged");
});

test("injection still matches after restartAll, which re-derives root from meta rather than the original call", async (t) => {
  const f = injectFixture();
  const first = await staticServers.start({ dir: f.state, sessionId: "s_inject_restart", root: f.root });
  await staticServers.stopAll(f.state, "s_inject_restart");
  assert.equal(await staticServers.isExactServer(first.meta), false, "stopped before the restart");

  const restarted = await staticServers.restartAll(f.state, "s_inject_restart");
  t.after(async () => { await staticServers.stopAll(f.state, "s_inject_restart"); });
  assert.equal(restarted, 1);

  const servers = staticServers.list(f.state, "s_inject_restart").filter((m) => !m.stopped_at);
  assert.equal(servers.length, 1);
  const res = await request(servers[0], "/page.html");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), f.review.id, "the restarted server still injects the tag");
});

// THE LIBRARY COMES FROM THIS SERVER NOW.
//
// `add` used to drop a copy of the built bundle beside the reviewed page so the
// script line's onerror had something relative to load with the helper down.
// That folder is usually a git checkout, `git add -A` committed the bundle and
// the tagged page together, and the deployed site then brought the review rail
// up for every visitor. Nothing is written beside the page any more, so this
// route is what keeps the helper-is-down case working: the server that answered
// the request for the page answers for the library too.
test("the static server publishes the built library at its own reserved route", async (t) => {
  const f = injectFixture();
  const server = await staticServers.start({ dir: f.state, sessionId: "s_inject_library", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_inject_library"); });

  const res = await request(server.meta, staticServers.LIBRARY_PATH);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/javascript/);
  assert.equal(
    res.body,
    fs.readFileSync(path.join(__dirname, "..", "..", "dist", "lahe-layer.js"), "utf8"),
    "byte for byte the bundle this clone built"
  );
  assert.equal(
    fs.existsSync(path.join(f.root, "lahe-layer.js")),
    false,
    "and no copy of it was written into the reviewed page's own folder"
  );
});

test("the injected tag loads the library from this server and keeps the helper as the fallback", async (t) => {
  const f = injectFixture();
  const server = await staticServers.start({ dir: f.state, sessionId: "s_inject_src", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_inject_src"); });

  const res = await request(server.meta, "/page.html");
  const src = /<script src="([^"]+)"/.exec(res.body);
  assert.ok(src, "the injected tag is there:\n" + res.body);
  assert.equal(
    src[1],
    staticServers.LIBRARY_PATH,
    "a root-absolute path, so it resolves back to this server whatever host name the reviewer typed"
  );

  const fallback = /data-lahe-fallback="([^"]+)"/.exec(res.body);
  assert.ok(fallback, "and it still carries a fallback");
  assert.match(
    fallback[1],
    /^http:\/\/127\.0\.0\.1:\d+\/lahe-layer\.js$/,
    "the helper's own URL, not a relative sibling name nothing writes any more"
  );

  // The relative form is the one that shipped to a deployed site and loaded the
  // rail for every visitor. It must not be what an injected page carries.
  assert.equal(fallback[1].indexOf("http://"), 0, "absolute, so it can only ever mean this machine's helper");
});

test("a non-target HTML file in the same folder is served untouched", async (t) => {
  const f = injectFixture();
  const otherHtml = "<!doctype html>\n<html>\n<body>\n<p>not part of any review</p>\n</body>\n</html>\n";
  fs.writeFileSync(path.join(f.root, "other.html"), otherHtml);

  const server = await staticServers.start({ dir: f.state, sessionId: "s_inject_other", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_inject_other"); });

  const res = await request(server.meta, "/other.html");
  assert.equal(res.status, 200);
  assert.equal(res.body, otherHtml, "a file no review recorded as a target is served exactly as it is on disk");
  assert.equal(res.body.indexOf("data-lahe-review"), -1);
});
