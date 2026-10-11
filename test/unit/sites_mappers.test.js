// Helper modules ask the registry when the switch is on (stable addresses,
// Step 2, Tasks 2.1 and 2.2).
//
// Plan rows: V26 (healer), V27 (reload, unit half), V28 (handled check), V30
// (rebuild), each run with the switch on and off; V32 (review.json groups old
// and new origins of one page); V70 (aliases are escaped, capped, and come
// only from the helper's records).
//
// "On" means the helper has activated the registry for this state folder
// (page_routes.activate), which is what serve() does with LAHE_PAGES=sites.
// "Off" means a real page server of the session serves the folder, as today.
// Both are stopped or deactivated in teardown, even on failure.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const reviewFormat = require("../../src/shared/review_format.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const routes = require("../../src/service/routes.js");
const sitesModule = require("../../src/service/sites.js");
const pageRoutes = require("../../src/service/page_routes.js");
const staticServers = require("../../src/service/static_servers.js");
const handledCheck = require("../../src/service/handled_check.js");
const rebuildModule = require("../../src/service/rebuild.js");
const markdown = require("../../src/service/markdown.js");
const stateDir = require("../../src/service/state_dir.js");
const { tempRoot, writeFile } = require("../helpers/sites_world.js");

const PAGES_PORT = 61483;
const SESSION = "s_mappers";
const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>first words</p></body></html>";

/**
 * A state folder, a home, a clock, and the review store, with the switch on
 * (the registry active) or off (nothing active; a page server started when a
 * test asks for one).
 */
function world(t, mode) {
  const root = tempRoot("lahe-mappers-");
  const home = path.join(root, "home");
  const dir = path.join(root, "state");
  fs.mkdirSync(home);
  fs.mkdirSync(dir);
  let now = Date.parse("2026-10-11T12:00:00.000Z");
  const clock = () => now;
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log, now: clock });
  const sites = sitesModule.createSites({ dir, home });
  sites.load();
  const priorHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  pageRoutes.activate(dir, { sites, pagesPort: PAGES_PORT });
  t.after(async () => {
    pageRoutes.deactivate(dir);
    if (priorHome === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = priorHome;
  });
  return {
    root, home, dir, log, reviews, sites, mode,
    advance(ms) { now += ms; },
    /** Bind `folder` as a site, and return its page origin. */
    async serve(folder, entry) {
      const bound = sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry });
      return protocol.siteOrigin(bound.name, PAGES_PORT);
    }
  };
}

function poll(w, reviewId, pagePath, origin) {
  return routes.handlerFor("replies.poll")(
    { review: reviewId, origin: origin, query: { since: 0, page_path: pagePath } },
    { log: w.log, reviews: w.reviews }
  ).body;
}

// The switch is gone (Step 3): every run is the helper serving pages. The
// "switch off" runs these rows had in Step 2 are retired with page servers.
for (const mode of ["on"]) {
  // --- V26: the healer ----------------------------------------------------------

  test("V26 (switch " + mode + "): after a poll, a served HTML file's bytes on disk are unchanged", async (t) => {
    const w = world(t, mode);
    const folder = path.join(w.home, "ws", "repo", "docs");
    const page = writeFile(folder, "page.html", PAGE);
    const origin = await w.serve(folder, "page.html");
    const review = w.reviews.create({ target_path: page, agent_session_id: SESSION, origins: ["null"] });
    for (let i = 0; i < 4; i += 1) {
      poll(w, review.id, "/page.html", origin);
      w.advance(1000);
    }
    assert.equal(fs.readFileSync(page, "utf8"), PAGE);
  });

  // --- V27: reload, unit half ----------------------------------------------------

  test("V27 (switch " + mode + "): a poll from one page of a folder review reports that page's own file", async (t) => {
    const w = world(t, mode);
    const folder = path.join(w.home, "ws", "site", "pages");
    writeFile(folder, "index.html", PAGE);
    const two = writeFile(folder, "two.html", PAGE);
    const origin = await w.serve(folder, "index.html");
    const review = w.reviews.create({ target_path: folder, agent_session_id: SESSION, origins: ["null"] });
    const old = new Date("2026-01-01T00:00:00.000Z");
    fs.utimesSync(path.join(folder, "index.html"), old, old);
    assert.equal(poll(w, review.id, "/two.html", origin).target_mtime, fs.statSync(two).mtime.toISOString());
    assert.equal(poll(w, review.id, "/index.html", origin).target_mtime, old.toISOString());
  });

  // --- V28: the handled check -----------------------------------------------------

  test("V28 (switch " + mode + "): a handled claim on a folder review page is checked against that page's file", async (t) => {
    const w = world(t, mode);
    const folder = path.join(w.home, "ws", "site", "pages");
    writeFile(folder, "index.html", PAGE);
    const sub = writeFile(folder, "sub/b.html", "<!doctype html><body><p>the old sentence here</p></body>");
    const origin = await w.serve(folder, "index.html");
    const review = w.reviews.create({ target_path: folder, agent_session_id: SESSION, origins: ["null"] });
    const item = editItem(origin, "/sub/b.html", "the old sentence here", "the new sentence here");
    const check = handledCheck.createHandledCheck({ dir: w.dir });
    assert.equal(check.pageShows(review.id, item), false, "before the edit the page does not show it");
    fs.writeFileSync(sub, "<!doctype html><body><p>the new sentence here</p></body>");
    assert.equal(check.pageShows(review.id, item), true, "after the edit the right file shows it");
  });

  // --- V30: rebuild -----------------------------------------------------------------

  test("V30 (switch " + mode + "): a newer Markdown source re-renders on the next poll", async (t) => {
    const w = world(t, mode);
    const folder = path.join(w.home, "ws", "repo", "notes");
    const doc = writeFile(folder, "doc.md", "# Doc\n\nfirst version\n");
    const artifact = markdown.writeArtifact(w.dir, SESSION, doc).target;
    const origin = await w.serve(folder, "doc.md");
    const review = w.reviews.create({ target_path: artifact, source_path: doc, agent_session_id: SESSION, origins: ["null"] });
    const pagePath = "/doc.md";
    const first = poll(w, review.id, pagePath, origin).target_mtime;
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(doc, "# Doc\n\nsecond version\n");
    fs.utimesSync(doc, later, later);
    w.advance(1000);
    const second = poll(w, review.id, pagePath, origin).target_mtime;
    assert.notEqual(second, first, "the poll reports the new render");
    const rendered = pageRoutes.renderForFile(w.dir, fs.realpathSync(doc));
    assert.match(rendered, /second version/);
  });
}

test("V29 (unit half, switch on): a link an agent adds to a Markdown page gets a mount and this review's rail on the next poll", async (t) => {
  const w = world(t, "on");
  const folder = path.join(w.home, "ws", "repo", "notes");
  const doc = writeFile(folder, "doc.md", "# Doc\n\nno links yet\n");
  const far = writeFile(w.home, "ws/other/far.md", "# Far\n");
  const artifact = markdown.writeArtifact(w.dir, SESSION, doc).target;
  const origin = await w.serve(folder, "doc.md");
  const review = w.reviews.create({ target_path: artifact, source_path: doc, agent_session_id: SESSION, origins: ["null"] });
  poll(w, review.id, "/doc.md", origin);
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(doc, "# Doc\n\nSee [far](../../other/far.md).\n");
  fs.utimesSync(doc, later, later);
  w.advance(1000);
  poll(w, review.id, "/doc.md", origin);
  const name = /^http:\/\/(.+)\.lahe\.localhost/.exec(origin)[1];
  const site = w.sites.get(name);
  const prefix = Object.keys(site.mounts).find((p) => site.mounts[p] === fs.realpathSync(path.dirname(far)));
  assert.ok(prefix, "the new folder is mounted on the site");
  assert.deepEqual(site.linked_files[fs.realpathSync(far)], [review.id]);
  assert.equal(pageRoutes.linkedFileForPage(w.dir, review.id, prefix + "far.md"), fs.realpathSync(far));
});

function editItem(origin, pagePath, before, after) {
  const item = record.newItem({
    kind: record.KIND.EDIT,
    state: record.STATE.READY,
    page_origin: origin,
    page_path: pagePath,
    page_title: "t",
    page_seq: 1
  });
  item[record.FIELD.BEFORE] = before;
  item[record.FIELD.AFTER] = after;
  // Committed after every write in these tests, so the check reads the
  // words on the page rather than standing down on "something was written".
  item[record.FIELD.UPDATED_AT] = "2099-01-01T00:00:00.000Z";
  return item;
}

// --- the registry's own page-to-file mapping ----------------------------------------

test("on: a single-page review lending its rail is checked against the sibling the item was made on", async (t) => {
  const w = world(t, "on");
  const folder = path.join(w.home, "ws", "repo", "docs");
  const a = writeFile(folder, "a.html", "<!doctype html><body><p>page a words</p></body>");
  const b = writeFile(folder, "b.html", "<!doctype html><body><p>the old b sentence</p></body>");
  const origin = await w.serve(folder, "a.html");
  const review = w.reviews.create({ target_path: a, agent_session_id: SESSION, origins: ["null"] });
  const item = editItem(origin, "/b.html", "the old b sentence", "the new b sentence");
  fs.writeFileSync(b, "<!doctype html><body><p>the new b sentence</p></body>");
  assert.equal(handledCheck.createHandledCheck({ dir: w.dir }).pageShows(review.id, item), true);
});

test("V26 (switch on): a poll from an old address, with no site origin, still leaves a site's file alone", async (t) => {
  const w = world(t, "on");
  const folder = path.join(w.home, "ws", "repo", "docs");
  const page = writeFile(folder, "page.html", PAGE);
  await w.serve(folder, "page.html");
  const review = w.reviews.create({ target_path: page, agent_session_id: SESSION, origins: ["null"] });
  for (let i = 0; i < 4; i += 1) {
    poll(w, review.id, "/page.html", "http://127.0.0.1:51234");
    w.advance(1000);
  }
  assert.equal(fs.readFileSync(page, "utf8"), PAGE);
});

test("V27 (switch on): a sibling page a single-page review lends its rail to reloads on its own file", async (t) => {
  const w = world(t, "on");
  const folder = path.join(w.home, "ws", "repo", "docs");
  const a = writeFile(folder, "a.html", PAGE);
  const b = writeFile(folder, "b.html", PAGE);
  const origin = await w.serve(folder, "a.html");
  const review = w.reviews.create({ target_path: a, agent_session_id: SESSION, origins: ["null"] });
  const old = new Date("2026-01-01T00:00:00.000Z");
  fs.utimesSync(a, old, old);
  assert.equal(poll(w, review.id, "/b.html", origin).target_mtime, fs.statSync(b).mtime.toISOString());
});

test("on: fileForPage maps a site origin and path to the file, and refuses what the server refuses", async (t) => {
  const w = world(t, "on");
  const folder = path.join(w.home, "ws", "repo", "docs");
  const page = writeFile(folder, "sub/page.html", PAGE);
  writeFile(folder, ".secret.html", PAGE);
  const origin = await w.serve(folder, "sub/page.html");
  assert.equal(pageRoutes.fileForPage(w.dir, origin, "/sub/page.html"), page);
  assert.equal(pageRoutes.fileForPage(w.dir, origin, "/sub/"), path.join(folder, "sub", "index.html"));
  for (const bad of ["/../x.html", "/.secret.html", "/sub/%2e%2e/%2e%2e/x.html"]) {
    assert.equal(pageRoutes.fileForPage(w.dir, origin, bad), null, bad);
  }
  assert.equal(pageRoutes.fileForPage(w.dir, "http://127.0.0.1:5555", "/sub/page.html"), null);
  assert.equal(pageRoutes.fileForPage(w.dir, "http://no.such.lahe.localhost:" + PAGES_PORT, "/sub/page.html"), null);
});

test("on: linkedFileForPage answers only for a file this review linked, under one of the site's mounts", async (t) => {
  const w = world(t, "on");
  const folder = path.join(w.home, "ws", "repo", "notes");
  writeFile(folder, "doc.md", "# d\n");
  const far = writeFile(w.home, "ws/other/far.md", "# far\n");
  writeFile(w.home, "ws/other/unlinked.md", "# u\n");
  const prefix = "/.lahe-source/00112233445566ff/";
  const bound = w.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "doc.md", mounts: { [prefix]: fs.realpathSync(path.dirname(far)) } });
  w.sites.addLinked(bound.name, "rev-1", [fs.realpathSync(far)]);
  assert.equal(pageRoutes.linkedFileForPage(w.dir, "rev-1", prefix + "far.md"), fs.realpathSync(far));
  assert.equal(pageRoutes.linkedFileForPage(w.dir, "rev-2", prefix + "far.md"), null);
  assert.equal(pageRoutes.linkedFileForPage(w.dir, "rev-1", prefix + "unlinked.md"), null);
  assert.equal(pageRoutes.linkedFileForPage(w.dir, "rev-1", "/%2Elahe-source/00112233445566ff/far.md"), null);
});

test("on: the Markdown render is cached by file time and shared", async (t) => {
  const w = world(t, "on");
  const folder = path.join(w.home, "ws", "repo", "notes");
  const doc = writeFile(folder, "doc.md", "# Doc\n\nversion one\n");
  await w.serve(folder, "doc.md");
  const real = fs.realpathSync(doc);
  const a = pageRoutes.renderForFile(w.dir, real);
  assert.strictEqual(pageRoutes.renderForFile(w.dir, real), a, "a second ask is the same render");
  fs.writeFileSync(doc, "# Doc\n\nversion two\n");
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(doc, later, later);
  assert.match(pageRoutes.renderForFile(w.dir, real), /version two/);
});

// --- V32: grouping old and new origins of one page ------------------------------------

test("V32: review.json groups old-origin and new-origin items of one page together", () => {
  const site = "http://ws.repo.docs.lahe.localhost:1483";
  const old = "http://127.0.0.1:51234";
  const items = [
    record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "old", page_origin: old, page_path: "/page.html", page_title: "P", page_seq: 1 }),
    record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "new", page_origin: site, page_path: "/page.html", page_title: "P", page_seq: 2 }),
    record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "other page", page_origin: old, page_path: "/other.html", page_title: "O", page_seq: 3 }),
    record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "unrelated server", page_origin: "http://127.0.0.1:9999", page_path: "/page.html", page_title: "P", page_seq: 4 })
  ];
  const aliases = {};
  aliases[old] = site;
  const projected = reviewFormat.projectReview({ id: "r1", items, origin_aliases: aliases });
  const page = projected.pages.find((p) => p.path === "/page.html" && p.origin === site);
  assert.ok(page, JSON.stringify(projected.pages.map((p) => p.key)));
  assert.equal(page.items.length, 2);
  assert.equal(projected.pages.length, 3);
  // Without the aliases, today's grouping is unchanged.
  assert.equal(reviewFormat.projectReview({ id: "r1", items }).pages.length, 4);
});

test("V31 (unit half): samePage matches an item made on an alias origin, at the same path only", () => {
  const site = "http://ws.repo.docs.lahe.localhost:1483";
  const old = "http://127.0.0.1:51234";
  const item = record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "x", page_origin: old, page_path: "/page.html", page_title: "P", page_seq: 1 });
  const page = record.pageFrom({ origin: site, pathname: "/page.html", href: site + "/page.html" }, { seq: 1, aliases: [old] });
  assert.equal(record.samePage(item, page), true);
  const otherPath = record.pageFrom({ origin: site, pathname: "/b.html", href: site + "/b.html" }, { seq: 1, aliases: [old] });
  assert.equal(record.samePage(item, otherPath), false);
  const noAlias = record.pageFrom({ origin: site, pathname: "/page.html", href: site + "/page.html" }, { seq: 1 });
  assert.equal(record.samePage(item, noAlias), false);
});

// --- V70: aliases -----------------------------------------------------------------

function oldRecord(dir, session, root, ports, extra) {
  const id = staticServers.serverId(root);
  stateDir.ensureStaticServersRoot(dir, session);
  fs.writeFileSync(stateDir.staticServerPath(dir, session, id), JSON.stringify(Object.assign({
    schema: 1, id, session_id: session, instance: "x", root, logical_root: root, host: "127.0.0.1",
    port: ports[ports.length - 1], ports, pid: 999999, started_at: "2026-01-01T00:00:00.000Z",
    stopped_at: "2026-01-02T00:00:00.000Z", mounts: {}, linked_files: {}
  }, extra || {})));
}

test("V70: aliases are this site's root's old loopback origins, from the helper's own records", async (t) => {
  const w = world(t, "on");
  const folder = fs.realpathSync(path.dirname(writeFile(path.join(w.home, "ws", "repo", "docs"), "page.html", PAGE)));
  const other = fs.realpathSync(path.dirname(writeFile(path.join(w.home, "ws", "repo", "elsewhere"), "x.html", PAGE)));
  oldRecord(w.dir, "s_one", folder, [51001, 51002]);
  oldRecord(w.dir, "s_two", folder, [51003]);
  oldRecord(w.dir, "s_one", other, [52000]);
  const origin = await w.serve(folder, "page.html");
  const site = w.sites.get(/^http:\/\/(.+)\.lahe\.localhost/.exec(origin)[1]);
  const aliases = pageRoutes.aliasesFor(w.dir, site);
  assert.deepEqual(aliases.slice().sort(), [
    "http://127.0.0.1:51001", "http://127.0.0.1:51002", "http://127.0.0.1:51003",
    "http://localhost:51001", "http://localhost:51002", "http://localhost:51003"
  ]);
  assert.equal(pageRoutes.aliasMap(w.dir)["http://127.0.0.1:51001"], origin);
  assert.equal(pageRoutes.aliasMap(w.dir)["http://127.0.0.1:52000"], undefined);
});

test("V70: at most 16 aliases, the newest ports first", async (t) => {
  const w = world(t, "on");
  const folder = fs.realpathSync(path.dirname(writeFile(path.join(w.home, "ws", "repo", "docs"), "page.html", PAGE)));
  const ports = [];
  for (let p = 53000; p < 53020; p += 1) ports.push(p);
  oldRecord(w.dir, "s_one", folder, ports);
  const origin = await w.serve(folder, "page.html");
  const site = w.sites.get(/^http:\/\/(.+)\.lahe\.localhost/.exec(origin)[1]);
  const aliases = pageRoutes.aliasesFor(w.dir, site);
  assert.equal(aliases.length, 16);
  assert.ok(aliases.includes("http://127.0.0.1:53019"));
  assert.ok(!aliases.includes("http://127.0.0.1:53000"));
});

test("V70: a record's odd root or port never becomes an alias", async (t) => {
  const w = world(t, "on");
  const folder = fs.realpathSync(path.dirname(writeFile(path.join(w.home, "ws", "repo", "docs"), "page.html", PAGE)));
  oldRecord(w.dir, "s_one", folder, [51001, "51002\"><script>", 0, 70000, -1], { host: "evil.example" });
  const origin = await w.serve(folder, "page.html");
  const site = w.sites.get(/^http:\/\/(.+)\.lahe\.localhost/.exec(origin)[1]);
  assert.deepEqual(pageRoutes.aliasesFor(w.dir, site).sort(), ["http://127.0.0.1:51001", "http://localhost:51001"]);
});

test("V70: the script tag carries the aliases as escaped JSON, and only when there are some", () => {
  const tag = protocol.scriptTag({ src: "/x.js", review: "r1", token: "t", aliases: ["http://127.0.0.1:51001", "http://localhost:51001"] });
  assert.match(tag, /data-lahe-aliases="\[&quot;http:\/\/127\.0\.0\.1:51001&quot;,&quot;http:\/\/localhost:51001&quot;\]"/);
  assert.doesNotMatch(protocol.scriptTag({ src: "/x.js", review: "r1", token: "t" }), /data-lahe-aliases/);
  assert.throws(() => protocol.scriptTag({ src: "/x.js", review: "r1", token: "t", aliases: ["http://evil.example:1"] }), /alias/);
  const many = [];
  for (let p = 1; p <= 17; p += 1) many.push("http://127.0.0.1:" + p);
  assert.throws(() => protocol.scriptTag({ src: "/x.js", review: "r1", token: "t", aliases: many }), /16/);
});
