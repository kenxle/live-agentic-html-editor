// `lahe review` and `lahe write` on stable addresses (Task 1.4 and its step
// test), and the single writer (V6).
//
// These run the real command through bin/lahe.js, on free ports and a temp state folder and
// home. Each test closes its session and stops every helper its state folder
// names in teardown, even when it fails.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync, execFile } = require("node:child_process");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const { pollUntil } = require("../helpers/poll.js");
const { freePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");
const { tempRoot, writeFile, raw } = require("../helpers/sites_world.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");
const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>reviewed page</p></body></html>";

async function cliWorld(t) {
  const root = tempRoot("lahe-sites-cli-");
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  fs.mkdirSync(home);
  const port = await freePort();
  const pagesPort = await freePort();
  const env = Object.assign({}, process.env, {
    LAHE_HOME_DIR: home,
    LAHE_PAGES_PORT: String(pagesPort)
  });
  const world = { root, home, state, port, pagesPort, env, sessions: [] };
  t.after(async () => {
    for (const session of world.sessions) {
      try { run(world, ["session", "close", session]); } catch (err) { /* still stop the helper below */ }
    }
    await stopTempHelpers(state);
  });
  return world;
}

function run(world, args) {
  const out = { code: 0, stdout: "", stderr: "" };
  try {
    out.stdout = execFileSync(process.execPath, [BIN].concat(args).concat(["--state-dir", world.state]), {
      env: world.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
  } catch (err) {
    out.code = typeof err.status === "number" ? err.status : 1;
    out.stdout = err.stdout ? String(err.stdout) : "";
    out.stderr = err.stderr ? String(err.stderr) : "";
  }
  return out;
}

/** The same, without blocking this process: the V6 squatter has to answer. */
function runAsync(world, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN].concat(args).concat(["--state-dir", world.state]), { env: world.env, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function review(world, args) {
  const out = run(world, ["review"].concat(args).concat(["--port", String(world.port)]));
  const session = /--session (s_[A-Za-z0-9_-]+)/.exec(out.stdout) || /session\s+(s_[A-Za-z0-9_-]+)/.exec(out.stdout);
  if (session && world.sessions.indexOf(session[1]) === -1) world.sessions.push(session[1]);
  return out;
}

function write(world, args) {
  const out = run(world, ["write"].concat(args).concat(["--port", String(world.port)]));
  const session = /--session (s_[A-Za-z0-9_-]+)/.exec(out.stdout) || /session\s+(s_[A-Za-z0-9_-]+)/.exec(out.stdout);
  if (session && world.sessions.indexOf(session[1]) === -1) world.sessions.push(session[1]);
  return out;
}

function openUrl(out) {
  const match = /^\s*open\s+(\S+)/m.exec(out.stdout);
  return match ? match[1] : null;
}

/** GET a printed address, sending its Host as a browser would. */
function fetchAddress(world, url) {
  const parsed = new URL(url);
  return raw(Number(parsed.port), { path: parsed.pathname, headers: { host: parsed.host } });
}

function reviewMetas(world) {
  const dir = path.join(world.state, "reviews");
  return fs.readdirSync(dir).map((id) => Object.assign({ id }, JSON.parse(fs.readFileSync(path.join(dir, id, "meta.json"), "utf8"))));
}

function pageServerRecords(world) {
  const sessions = path.join(world.state, "agent-sessions");
  let count = 0;
  for (const s of fs.existsSync(sessions) ? fs.readdirSync(sessions) : []) {
    const dir = path.join(sessions, s, "static-servers");
    if (fs.existsSync(dir)) count += fs.readdirSync(dir).filter((n) => /^ss_.*\.json$/.test(n)).length;
  }
  return count;
}

const ADDRESS = /^http:\/\/[a-z0-9.-]+\.lahe\.localhost:\d+\//;

test("step test: lahe review on an HTML file prints a .lahe.localhost address that loads with its rail", async (t) => {
  const w = await cliWorld(t);
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  const out = review(w, [file]);
  assert.equal(out.code, 0, out.stderr);
  const url = openUrl(out);
  assert.match(url, ADDRESS);
  assert.equal(url, "http://ws.repo.docs.lahe.localhost:" + w.pagesPort + "/page.html");
  assert.doesNotMatch(out.stdout, /127\.0\.0\.1:\d+\/page\.html/);
  const res = await fetchAddress(w, url);
  assert.equal(res.status, 200);
  const meta = reviewMetas(w)[0];
  assert.match(res.text, new RegExp('data-lahe-review="' + meta.id + '"'));
  // No page server, no port origin, nothing written into the page.
  assert.equal(pageServerRecords(w), 0);
  assert.deepEqual(meta.origins, ["null"]);
  assert.equal(fs.readFileSync(file, "utf8"), PAGE);
});

test("step test: a Markdown file with an image and a link outside its folder", async (t) => {
  const w = await cliWorld(t);
  const folder = path.join(w.home, "ws", "repo", "notes");
  writeFile(folder, "pic.png", "PNG");
  writeFile(w.home, "ws/other/far.md", "# Far\n\nfar away\n");
  const doc = writeFile(folder, "doc.md", "# Doc\n\n![pic](pic.png)\n\n[far](../../other/far.md)\n");
  const out = review(w, [doc]);
  assert.equal(out.code, 0, out.stderr);
  const url = openUrl(out);
  assert.equal(url, "http://ws.repo.notes.lahe.localhost:" + w.pagesPort + "/doc.md");
  const res = await fetchAddress(w, url);
  assert.equal(res.status, 200);
  const meta = reviewMetas(w)[0];
  assert.match(res.text, new RegExp('data-lahe-review="' + meta.id + '"'));
  assert.equal((await fetchAddress(w, url.replace("/doc.md", "/pic.png"))).text, "PNG");
  const link = /href="(\/\.lahe-source\/[a-f0-9]+\/far\.md)"/.exec(res.text);
  assert.ok(link, "the outside link is a mount on this site");
  const far = await fetchAddress(w, url.replace("/doc.md", link[1]));
  assert.equal(far.status, 200);
  assert.match(far.text, /far away/);
  // The linked document rides this review's rail.
  assert.match(far.text, new RegExp('data-lahe-review="' + meta.id + '"'));
});

test("step test: a folder of pages prints its entry page at the folder's address", async (t) => {
  const w = await cliWorld(t);
  const folder = path.join(w.home, "ws", "site", "pages");
  writeFile(folder, "index.html", PAGE);
  writeFile(folder, "two.html", PAGE.replace("reviewed page", "page two"));
  const out = review(w, [folder]);
  assert.equal(out.code, 0, out.stderr);
  const url = openUrl(out);
  assert.equal(url, "http://ws.site.pages.lahe.localhost:" + w.pagesPort + "/index.html");
  const meta = reviewMetas(w)[0];
  const two = await fetchAddress(w, url.replace("index.html", "two.html"));
  assert.match(two.text, /page two/);
  assert.match(two.text, new RegExp('data-lahe-review="' + meta.id + '"'));
});

test("step test: lahe write prints a notes address that serves only that page", async (t) => {
  const w = await cliWorld(t);
  const folder = path.join(w.home, "ws", "notes", "today");
  fs.mkdirSync(folder, { recursive: true });
  writeFile(folder, "secret.md", "# private\n");
  const out = write(w, [path.join(folder, "today.md")]);
  assert.equal(out.code, 0, out.stderr);
  const url = openUrl(out);
  assert.equal(url, "http://ws.notes.today.lahe.localhost:" + w.pagesPort + "/today.md");
  const res = await fetchAddress(w, url);
  assert.equal(res.status, 200);
  const meta = reviewMetas(w)[0];
  assert.equal(meta.notes, true);
  assert.match(res.text, new RegExp('data-lahe-review="' + meta.id + '"'));
  assert.match(res.text, /data-lahe-notes/);
  assert.equal((await fetchAddress(w, url.replace("today.md", "secret.md"))).status, 404);
});

test("step test: a comment posted from the printed address reaches review.json", async (t) => {
  const w = await cliWorld(t);
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  const out = review(w, [file]);
  const url = openUrl(out);
  const page = await fetchAddress(w, url);
  const reviewId = /data-lahe-review="([^"]+)"/.exec(page.text)[1];
  const token = /data-lahe-token="([^"]+)"/.exec(page.text)[1];
  const origin = new URL(url).origin;
  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "a comment from the site",
    page_origin: origin,
    page_path: "/page.html",
    page_title: "t",
    page_seq: 1
  });
  const event = protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: "ev_sites_cli_1",
    review: reviewId,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    page_path: item[record.FIELD.PAGE_PATH],
    page_title: item[record.FIELD.PAGE_TITLE],
    page_seq: item[record.FIELD.PAGE_SEQ],
    payload: { draft: false, record: item }
  });
  const res = await raw(w.port, {
    method: "POST",
    path: protocol.route("events.append").path,
    headers: {
      host: "127.0.0.1:" + w.port,
      origin,
      "content-type": "application/json",
      "x-lahe-client": "layer",
      "x-lahe-token": token
    },
    body: { review: reviewId, events: [event] }
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers["access-control-allow-origin"], origin);
  const jsonPath = path.join(w.state, "reviews", reviewId, "review.json");
  const text = await pollUntil(() => {
    try {
      const body = fs.readFileSync(jsonPath, "utf8");
      return body.indexOf("a comment from the site") !== -1 ? body : null;
    } catch (err) {
      return null;
    }
  }, { timeoutMs: 10000, message: "the comment in review.json" });
  assert.match(text, /a comment from the site/);
});

test("the same file reviewed again prints the same address", async (t) => {
  const w = await cliWorld(t);
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  const first = openUrl(review(w, [file]));
  const second = openUrl(review(w, [file, "--new-session"]));
  assert.equal(first, second);
});

test("V6: review, write and status with the helper stopped leave sites.json and sites.log unchanged", async (t) => {
  const w = await cliWorld(t);
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  // A first review makes a name, through the helper.
  assert.equal(review(w, [file]).code, 0);
  for (const s of w.sessions) run(w, ["session", "close", s]);
  await stopTempHelpers(w.state);
  const before = {
    json: fs.readFileSync(path.join(w.state, "sites.json"), "utf8"),
    log: fs.readFileSync(path.join(w.state, "sites.log"), "utf8")
  };
  // Hold the helper's port with something that is not a helper, so no helper
  // can start: whatever these commands do on their own, they cannot reach one.
  const squatter = http.createServer((req, res) => { res.writeHead(503); res.end(); });
  await new Promise((r) => squatter.listen(w.port, "127.0.0.1", r));
  let outs;
  try {
    const other = writeFile(w.home, "ws/elsewhere/new/page.html", PAGE);
    const notes = path.join(w.home, "ws", "notes", "n1");
    fs.mkdirSync(notes, { recursive: true });
    const withPort = ["--port", String(w.port)];
    outs = await Promise.all([
      runAsync(w, ["review", file, "--new-session"].concat(withPort)),
      runAsync(w, ["review", other].concat(withPort)),
      runAsync(w, ["write", path.join(notes, "today.md")].concat(withPort)),
      runAsync(w, ["status"])
    ]);
  } finally {
    // Closed here, not in t.after: teardown runs commands that block this
    // process, and they would wait on a squatter that can no longer answer.
    await new Promise((r) => squatter.close(() => r()));
  }
  outs.slice(0, 3).forEach((o) => assert.notEqual(o.code, 0, "no helper could start, so the command failed: " + JSON.stringify(o)));
  assert.equal(fs.readFileSync(path.join(w.state, "sites.json"), "utf8"), before.json);
  assert.equal(fs.readFileSync(path.join(w.state, "sites.log"), "utf8"), before.log);
});
