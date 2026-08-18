"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const markdown = require("../../src/service/markdown.js");
const reviewCommand = require("../../src/cli/commands/review.js");
const sessionCommand = require("../../src/cli/commands/session.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function capture(run) {
  const stdout = [];
  const stderr = [];
  const oldOut = process.stdout.write;
  const oldErr = process.stderr.write;
  process.stdout.write = (chunk) => { stdout.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  try { return { code: await run(), stdout: stdout.join(""), stderr: stderr.join("") }; }
  finally { process.stdout.write = oldOut; process.stderr.write = oldErr; }
}

function request(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", reject);
  });
}

test("lahe review renders Markdown without touching it, serves assets, and reuses ownership", async (t) => {
  const root = tempDir("lahe-markdown-review-");
  const state = path.join(tempDir("lahe-markdown-state-"), "state");
  const assets = path.join(root, "assets");
  const source = path.join(root, "guide.md");
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, "pixel.txt"), "asset bytes");
  fs.writeFileSync(source, "# Guide\n\n- One\n\nA separate paragraph.\n\n![Asset](assets/pixel.txt)\n\n```mermaid\nflowchart TD\n  A --> B\n```\n");
  const original = fs.readFileSync(source, "utf8");
  const port = await freePort();

  const first = await capture(() => reviewCommand.run([source, "--state-dir", state, "--port", String(port)]));
  assert.equal(first.code, 0, first.stderr);
  const sessionId = first.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const reviewId = first.stdout.match(/^\s*review\s+(r[a-f0-9]+)/m)[1];
  const open = first.stdout.match(/^\s*open\s+(http:\/\/\S+)/m)[1];
  assert.match(first.stdout, /rebuild\s+rerun this same review command after editing the Markdown, before replying handled/);
  // The wake line comes first and names the real path, so a Claude Code Monitor
  // can be armed by copying it rather than by assembling it from a doc.
  const wakePath = first.stdout.match(/^\s*wake\s+tail -n 0 -f (\S+)$/m);
  assert.ok(wakePath, "the wake command is printed with a real path");
  assert.match(wakePath[1], new RegExp("/agent-sessions/" + sessionId + "/wake\\.log$"));
  // The path has to EXIST when it is printed. A `tail -f` on a file that is not
  // there yet is a race, and losing it is a session that never wakes.
  assert.ok(fs.existsSync(wakePath[1]), "the wake feed is on disk before the agent is told to tail it");
  assert.equal(fs.readFileSync(wakePath[1], "utf8"), "", "and it starts empty");
  assert.match(first.stdout, new RegExp("monitor\\s+lahe monitor --session " + sessionId + "$", "m"));
  assert.match(first.stdout, new RegExp("drain\\s+lahe status --session " + sessionId + " --json --quiet"));
  assert.match(first.stdout, /exits\s+monitor: 0 work printed, 5 session closed, 6 taken over/);
  t.after(async () => {
    await capture(() => sessionCommand.run(["close", sessionId, "--state-dir", state, "--port", String(port)]));
  });

  assert.equal(fs.readFileSync(source, "utf8"), original, "the Markdown source was not given a script tag");
  const page = await request(open);
  assert.equal(page.status, 200);
  assert.match(page.body, /<ul>\s*<li>One<\/li>\s*<\/ul>\s*<p>A separate paragraph\.<\/p>/);
  const assetPath = page.body.match(/src="(\/\.lahe-source\/[a-f0-9]+\/assets\/pixel\.txt)"/)[1];
  const asset = await request(new URL(assetPath, open).href);
  assert.equal(asset.status, 200);
  assert.equal(asset.body, "asset bytes");
  const mermaidAsset = await request(new URL("./" + markdown.MERMAID_ASSET, open).href);
  assert.equal(mermaidAsset.status, 200);
  assert.match(mermaidAsset.body, /globalThis\["mermaid"\]/);

  const meta = JSON.parse(fs.readFileSync(path.join(state, "reviews", reviewId, "meta.json"), "utf8"));
  assert.equal(meta.source_path, source);
  assert.match(meta.target_path, /agent-sessions\/s_[a-f0-9]+\/review-artifacts\/guide-[a-f0-9]+\.html$/);

  fs.writeFileSync(source, original.replace("A separate paragraph.", "A newly rendered paragraph."));
  const second = await capture(() => reviewCommand.run([source, "--state-dir", state, "--port", String(port)]));
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, new RegExp("session\\s+" + sessionId));
  assert.match(second.stdout, new RegExp("review\\s+" + reviewId));
  assert.match((await request(open)).body, /A newly rendered paragraph\./);
});
