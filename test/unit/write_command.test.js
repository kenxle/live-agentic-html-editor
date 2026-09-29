// `lahe write <path>`: notes on a blank page (free-writing plan Task 2.10,
// architecture Security & Privacy Notes, the `lahe write` bullets).
//
// Every run goes through the real entry point (`node bin/lahe.js write ...`),
// with its own state folder and helper port, so nothing here touches the
// shared helper. Each test closes its session afterwards.
//
// The path rules under test: .md or .markdown only, the parent must exist,
// lstat before anything so any symlink is refused, exclusive create, never an
// overwrite, and the parent's real path printed. The server rules: one page per
// server, never a folder server, so a sibling file, a dotfile, and another
// review's rendered page are all 404s.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const protocol = require("../../src/shared/protocol.js");
const markdown = require("../../src/service/markdown.js");
const logModule = require("../../src/service/log.js");
const projectionModule = require("../../src/service/projection.js");

// The review.json body for a review, folded from its log the way the helper
// and lahe status fold it.
function projected(state, reviewId) {
  return projectionModule.project(reviewId, logModule.createEventLog({ dir: state }).read(reviewId));
}

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      server.close(function () {
        resolve(port);
      });
    });
  });
}

function lahe(command, args) {
  const result = { code: 0, stdout: "", stderr: "" };
  try {
    result.stdout = execFileSync(process.execPath, [BIN, command].concat(args), {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
  } catch (err) {
    result.code = typeof err.status === "number" ? err.status : 1;
    result.stdout = err.stdout ? String(err.stdout) : "";
    result.stderr = err.stderr ? String(err.stderr) : "";
  }
  return result;
}

function get(url) {
  return new Promise(function (resolve, reject) {
    http
      .get(url, function (res) {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      })
      .on("error", reject);
  });
}

// A state folder, a helper port, and the sessions to close afterwards.
async function rig(t) {
  const state = path.join(tempDir("lahe-write-state-"), "state");
  const port = await freePort();
  const sessions = [];
  t.after(() => {
    sessions.forEach((id) => lahe("session", ["close", id, "--state-dir", state, "--port", String(port)]));
  });
  function run(command, args) {
    const r = lahe(command, args.concat(["--state-dir", state, "--port", String(port)]));
    const m = r.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m);
    if (m && sessions.indexOf(m[1]) === -1) sessions.push(m[1]);
    return r;
  }
  return { state, port, run };
}

function openUrl(stdout) {
  const m = stdout.match(/^\s*open\s+(http:\/\/\S+)/m);
  return m ? new URL(m[1]) : null;
}

function reviewIdOf(stdout) {
  return stdout.match(/^\s*review\s+(r[a-f0-9]+)/m)[1];
}

test("lahe write creates a new, empty Markdown file and serves it", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-new-");
  const file = path.join(folder, "2026-09-28.md");
  const out = r.run("write", [file]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), "", "an empty file was created");
  const url = openUrl(out.stdout);
  assert.ok(url, "an open line:\n" + out.stdout);
  const page = await get(url.href);
  assert.equal(page.status, 200);
  assert.ok(page.body.indexOf('data-lahe-file-title="file-name"') !== -1, "the rendered empty page");
  assert.ok(page.body.indexOf("data-lahe-review") !== -1 || page.body.indexOf("lahe-library") !== -1, "the rail's script line is in the response");
  assert.match(out.stdout, /lahe status --session/, "the drain command is printed, as lahe review prints it");
});

test("on an existing .md, lahe write exits 0, serves it, and leaves its bytes unchanged", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-existing-");
  const file = path.join(folder, "notes.md");
  const bytes = "# My notes\n\nAlready here.\n";
  fs.writeFileSync(file, bytes);
  const out = r.run("write", [file]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const page = await get(openUrl(out.stdout).href);
  assert.equal(page.status, 200);
  assert.ok(page.body.indexOf("Already here.") !== -1);
  assert.equal(fs.readFileSync(file, "utf8"), bytes);
});

test("lahe write refuses a directory named x.md, a missing parent folder, and a non-Markdown name", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-refuse-");
  fs.mkdirSync(path.join(folder, "x.md"));
  const dirCase = r.run("write", [path.join(folder, "x.md")]);
  assert.equal(dirCase.code, protocol.CLI_EXIT.BAD_USAGE, dirCase.stdout + dirCase.stderr);
  assert.match(dirCase.stderr, /not a regular file/);

  const missing = path.join(folder, "nope", "n.md");
  const parentCase = r.run("write", [missing]);
  assert.equal(parentCase.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(parentCase.stderr, /folder/);
  assert.equal(fs.existsSync(path.join(folder, "nope")), false, "no folder was made");

  const txt = path.join(folder, "notes.txt");
  const nameCase = r.run("write", [txt]);
  assert.equal(nameCase.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(nameCase.stderr, /\.md or \.markdown/);
  assert.equal(fs.existsSync(txt), false);
});

test("lahe write refuses a dangling symlink and creates nothing at its target", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-dangling-");
  const target = path.join(folder, "elsewhere.md");
  const link = path.join(folder, "link.md");
  fs.symlinkSync(target, link);
  const out = r.run("write", [link]);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE, out.stdout + out.stderr);
  assert.match(out.stderr, /symlink/);
  assert.equal(fs.existsSync(target), false, "nothing was created at the link's target");
});

test("lahe write refuses a symlink to an existing .md, and a symlink to a non-Markdown file", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-link-");
  const real = path.join(folder, "real.md");
  fs.writeFileSync(real, "real\n");
  const toMd = path.join(folder, "alias.md");
  fs.symlinkSync(real, toMd);
  const a = r.run("write", [toMd]);
  assert.equal(a.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(a.stderr, /symlink/);
  assert.equal(fs.readFileSync(real, "utf8"), "real\n");

  const secret = path.join(folder, "secret.txt");
  fs.writeFileSync(secret, "secret\n");
  const toTxt = path.join(folder, "looks.md");
  fs.symlinkSync(secret, toTxt);
  const b = r.run("write", [toTxt]);
  assert.equal(b.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(b.stderr, /symlink/);
  assert.equal(fs.readFileSync(secret, "utf8"), "secret\n");
});

test("the printed folder is the real path when the parent is reached through a symlinked folder", async (t) => {
  const r = await rig(t);
  const base = tempDir("lahe-write-realparent-");
  const realFolder = path.join(base, "real");
  fs.mkdirSync(realFolder);
  const linkedFolder = path.join(base, "linked");
  fs.symlinkSync(realFolder, linkedFolder);
  const out = r.run("write", [path.join(linkedFolder, "n.md")]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const line = out.stdout.split("\n").find((l) => /^\s*notes in\s/.test(l));
  assert.ok(line, "a notes-in line:\n" + out.stdout);
  assert.equal(line.replace(/^\s*notes in\s+/, "").trim(), fs.realpathSync(realFolder));
  assert.ok(fs.existsSync(path.join(realFolder, "n.md")));
});

test("the one-page server 404s a sibling file, a dotfile sibling, and another review's rendered page", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-onepage-");
  fs.writeFileSync(path.join(folder, "sibling.html"), "<p>not for you</p>");
  fs.writeFileSync(path.join(folder, "other.md"), "# Other\n\nPrivate.\n");
  fs.writeFileSync(path.join(folder, ".env"), "SECRET=1\n");
  const out = r.run("write", [path.join(folder, "notes.md")]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const url = openUrl(out.stdout);
  const sessionId = out.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];

  // Another review in the same session, whose render sits beside this one.
  const other = r.run("review", [path.join(folder, "other.md"), "--session", sessionId]);
  assert.equal(other.code, 0, other.stdout + other.stderr);
  const otherPage = openUrl(other.stdout).pathname;

  assert.equal((await get(url.href)).status, 200);
  for (const p of ["/sibling.html", "/other.md", "/.env", otherPage, "/", "/index.html", "/../notes.md"]) {
    assert.equal((await get(url.origin + p)).status, 404, p + " is a 404");
  }
  assert.equal((await get(url.origin + "/" + markdown.DOC_STYLE_ASSET)).status, 200, "the style the page names");
  for (const font of markdown.FONT_ASSETS) {
    assert.equal((await get(url.origin + "/" + markdown.FONT_ASSET_DIR + "/" + font)).status, 200, font);
  }
});

test("with --session, write starts its own server beside the session's Markdown server", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-session-");
  fs.writeFileSync(path.join(folder, "doc.md"), "# Doc\n\nWords.\n");
  fs.writeFileSync(path.join(folder, "sibling.html"), "<p>not for you</p>");
  const first = r.run("review", [path.join(folder, "doc.md")]);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const sessionId = first.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const reviewServer = openUrl(first.stdout);
  assert.equal((await get(reviewServer.href)).status, 200, "the session's Markdown review has a live server");

  const out = r.run("write", [path.join(folder, "notes.md"), "--session", sessionId]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, new RegExp("session\\s+" + sessionId));
  const url = openUrl(out.stdout);
  assert.notEqual(url.origin, reviewServer.origin, "its own server, never the session's folder server");
  assert.match(out.stdout, /started for this agent session/);
  assert.equal((await get(url.href)).status, 200);
  assert.equal((await get(url.origin + "/sibling.html")).status, 404);
  assert.equal((await get(url.origin + reviewServer.pathname)).status, 404, "the other review's page");
});

test("the review carries notes: true in review.json", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-notes-");
  const out = r.run("write", [path.join(folder, "n.md")]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(projected(r.state, reviewIdOf(out.stdout)).review.notes, true);
});

test("an ordinary lahe review is not a notes review", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-notnotes-");
  fs.writeFileSync(path.join(folder, "d.md"), "# D\n");
  const out = r.run("review", [path.join(folder, "d.md")]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(projected(r.state, reviewIdOf(out.stdout)).review.notes, false);
});

test("a one-page server restarted from its record, as the idle sweep does, is still a one-page server", async (t) => {
  const staticServers = require("../../src/service/static_servers.js");
  const r = await rig(t);
  const folder = tempDir("lahe-write-restart-");
  fs.writeFileSync(path.join(folder, "sibling.html"), "<p>not for you</p>");
  const out = r.run("write", [path.join(folder, "n.md")]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const sessionId = out.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const url = openUrl(out.stdout);
  const meta = staticServers.list(r.state, sessionId).find((m) => String(m.port) === url.port);
  assert.ok(meta && staticServers.isPageRoot(meta.root), "the record's root is the page itself");
  await staticServers.stopOne(r.state, sessionId, meta, staticServers.IDLE_REASON);
  const again = await staticServers.start({ dir: r.state, sessionId: sessionId, root: meta.root, logicalRoot: meta.logical_root, preferredPort: meta.port });
  const origin = "http://" + again.meta.host + ":" + again.meta.port;
  assert.equal((await get(origin + url.pathname)).status, 200);
  assert.equal((await get(origin + "/sibling.html")).status, 404);
  await assert.rejects(staticServers.registerMount(r.state, sessionId, again.meta, "/.lahe-source/abc/", folder), /no mounts/);
});

test("write.js exists, so the manifest no longer lists it as planned", () => {
  const manifest = require("../../src/shared/manifest.js");
  assert.equal(manifest.plannedFiles().some((entry) => entry.path === "src/cli/commands/write.js"), false);
});

// --- Fix round F3 -----------------------------------------------------------

function getWithHost(url, host) {
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    http
      .request({ host: u.hostname, port: u.port, path: u.pathname, method: "GET", headers: { host: host } }, function (res) {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      })
      .on("error", reject)
      .end();
  });
}

// Adversary review 5 / design call 7.
test("lahe review on a notes file keeps the one-page server: .env beside it is a 404", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-review-");
  const file = path.join(folder, "notes.md");
  fs.writeFileSync(path.join(folder, ".env"), "SECRET=zqxcanary\n");
  fs.writeFileSync(path.join(folder, "diary.txt"), "private zqxcanary\n");
  const first = r.run("write", [file]);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const sessionId = first.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const again = r.run("review", [file, "--session", sessionId]);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /scope\s+this page only/);
  assert.doesNotMatch(again.stdout, /^\s*root\s/m);
  assert.equal(reviewIdOf(again.stdout), reviewIdOf(first.stdout), "the notes review is reused");
  const url = openUrl(again.stdout);
  const prefix = markdown.assetPrefix(file);
  assert.equal((await get(url.origin + prefix + ".env")).status, 404);
  assert.equal((await get(url.origin + prefix + "diary.txt")).status, 404);
  assert.equal((await get(url.origin + "/.env")).status, 404);
  assert.equal((await get(url.href)).status, 200);
  assert.equal(projected(r.state, reviewIdOf(again.stdout)).review.notes, true);
});

// Security review 6.
test("the one-page server refuses a Host that is not its own loopback address", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-host-");
  const out = r.run("write", [path.join(folder, "n.md")]);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const url = openUrl(out.stdout);
  assert.equal((await getWithHost(url.href, "attacker.example:" + url.port)).status, 404);
  assert.equal((await getWithHost(url.href, "127.0.0.1:" + url.port)).status, 200);
  assert.equal((await getWithHost(url.href, "localhost:" + url.port)).status, 200);
});

// Code lead 23: the record says it is a one-page server.
test("a one-page server's record carries page: true", async (t) => {
  const staticServers = require("../../src/service/static_servers.js");
  const r = await rig(t);
  const out = r.run("write", [path.join(tempDir("lahe-write-pagerec-"), "n.md")]);
  const sessionId = out.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const url = openUrl(out.stdout);
  const meta = staticServers.list(r.state, sessionId).find((m) => String(m.port) === url.port);
  assert.equal(meta.page, true);
});

// Security review 5.
test("lahe write refuses a file with more than one hard link", async (t) => {
  const r = await rig(t);
  const folder = tempDir("lahe-write-hardlink-");
  const other = path.join(folder, "other.md");
  fs.writeFileSync(other, "# Someone else's file\n");
  const linked = path.join(folder, "notes.md");
  fs.linkSync(other, linked);
  const out = r.run("write", [linked]);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE, out.stdout + out.stderr);
  assert.match(out.stderr, /hard link/);
});

test("a notes render reads its source without following a symlink", () => {
  const folder = tempDir("lahe-write-nofollow-");
  const real = path.join(folder, "real.md");
  fs.writeFileSync(real, "# Real\n");
  const link = path.join(folder, "link.md");
  fs.symlinkSync(real, link);
  assert.throws(() => markdown.render(link, { noFollow: true }), /symlink|ELOOP|link/i);
  assert.ok(markdown.render(real, { noFollow: true }).indexOf("Real") !== -1);
  assert.ok(markdown.render(link).indexOf("Real") !== -1, "an ordinary render still follows it");
});
