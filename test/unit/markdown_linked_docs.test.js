"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const reviewCommand = require("../../src/cli/commands/review.js");
const sessionCommand = require("../../src/cli/commands/session.js");

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
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
      res.on("end", () => resolve({
        status: res.statusCode,
        type: res.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8")
      }));
    }).on("error", reject);
  });
}

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

test("a reviewed Markdown document's local links serve rendered documents, hop to hop", async (t) => {
  const home = tempDir("lahe-linked-home-");
  const state = path.join(tempDir("lahe-linked-state-"), "state");
  const previousHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  t.after(() => {
    if (previousHome === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = previousHome;
  });

  const skills = path.join(home, "skills");
  const source = write(path.join(skills, "lahe", "SKILL.md"), [
    "# Lahe",
    "",
    "- [Template](references/document-templates.md)",
    "- [Crucible](../crucible/SKILL.md)",
    "- [Outside](/nowhere-at-all/GONE.md)",
    ""
  ].join("\n"));
  const original = fs.readFileSync(source, "utf8");
  write(path.join(skills, "lahe", "references", "document-templates.md"), "# Templates\n\nA sibling template.\n");
  write(path.join(skills, "crucible", "SKILL.md"), [
    "# Crucible",
    "",
    "- [Sub-template](../templates/SUB.md)",
    "- [Picture](picture.txt)",
    ""
  ].join("\n"));
  write(path.join(skills, "crucible", "picture.txt"), "raw asset bytes");
  write(path.join(skills, "templates", "SUB.md"), "# Sub\n\nThe third hop.\n");

  const port = await freePort();
  const first = await capture(() => reviewCommand.run([source, "--state-dir", state, "--port", String(port)]));
  assert.equal(first.code, 0, first.stderr);
  const sessionId = first.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const open = first.stdout.match(/^\s*open\s+(http:\/\/\S+)/m)[1];
  t.after(async () => {
    await capture(() => sessionCommand.run(["close", sessionId, "--state-dir", state, "--port", String(port)]));
  });
  assert.match(first.stdout, /links\s+1 linked folder served read-only for this session/);
  assert.equal(fs.readFileSync(source, "utf8"), original, "the Markdown source keeps the links its author wrote");

  const page = await request(open);
  assert.equal(page.status, 200);
  // A link out of the document's folder became a mounted URL; a link LAHE
  // cannot serve became inert text naming the path on disk.
  const crucibleHref = page.body.match(/href="(\/\.lahe-source\/[a-f0-9]+\/SKILL\.md)"/)[1];
  const templateHref = page.body.match(/href="(\/\.lahe-source\/[a-f0-9]+\/references\/document-templates\.md)"/)[1];
  assert.match(page.body, /<span class="lahe-local-link" title="local file, open it on disk: [^"]*GONE\.md">Outside<\/span>/);

  const template = await request(new URL(templateHref, open).href);
  assert.equal(template.status, 200, "the sibling template inside the document's own folder resolves");
  assert.match(template.type, /text\/html/);
  assert.match(template.body, /A sibling template\./);
  assert.match(template.body, /Read-only rendered view of <code>[^<]*document-templates\.md<\/code>\. This document is not under review\./);

  const crucible = await request(new URL(crucibleHref, open).href);
  assert.equal(crucible.status, 200, "hop one renders");
  assert.match(crucible.body, /Read-only rendered view of/);
  assert.doesNotMatch(crucible.body, /lahe-layer\.js/, "a rendered linked document is not enrolled in the review");

  const subHref = crucible.body.match(/href="(\/\.lahe-source\/[a-f0-9]+\/SUB\.md)"/)[1];
  const sub = await request(new URL(subHref, open).href);
  assert.equal(sub.status, 200, "hop two renders behind a mount the server registered for itself");
  assert.match(sub.body, /The third hop\./);

  const pictureHref = crucible.body.match(/src="([^"]*picture\.txt)"|href="([^"]*picture\.txt)"/);
  const picture = await request(new URL(pictureHref[1] || pictureHref[2], open).href);
  assert.equal(picture.status, 200);
  assert.equal(picture.body, "raw asset bytes", "a non-Markdown file still serves its bytes");
});
