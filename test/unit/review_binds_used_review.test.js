// `lahe review` binds the site to a review and stamps it as served. It used to
// pick the session's newest review that recorded the file, by created_at,
// while `add` may have reused a different one (`--review`, or a script line
// already on the page). The page then answered for the wrong review. It now
// binds the review `add` reports it used.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { freePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");
const { tempRoot, writeFile, raw } = require("../helpers/sites_world.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");
const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>reviewed page</p></body></html>";

function run(world, args) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [BIN].concat(args, ["--state-dir", world.state]), { env: world.env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }), stderr: "" };
  } catch (err) {
    return { code: err.status || 1, stdout: String(err.stdout || ""), stderr: String(err.stderr || "") };
  }
}

function reviewOf(out) {
  const m = /^\s*review\s+(r[A-Za-z0-9_-]+)/m.exec(out.stdout);
  return m ? m[1] : null;
}

async function answering(world, url) {
  const parsed = new URL(url);
  const res = await raw(Number(parsed.port), { path: parsed.pathname, headers: { host: parsed.host } });
  const m = /data-lahe-review="([^"]+)"/.exec(res.text);
  return m ? m[1] : null;
}

// One review per file means a second review of a file is never made, so the
// case is now the folder review that holds a page: `lahe review page` adds the
// page to that review (add --review), and the page must answer for it.
test("lahe review of a page a folder review holds binds the folder review, the one add used", async (t) => {
  const root = tempRoot("lahe-review-used-");
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const world = { state: path.join(root, "state"), port: await freePort(), sessions: [] };
  world.env = Object.assign({}, process.env, { LAHE_HOME_DIR: home, LAHE_PAGES_PORT: String(await freePort()) });
  t.after(async () => {
    for (const s of world.sessions) run(world, ["session", "close", s]);
    await stopTempHelpers(world.state);
  });
  const folder = path.join(home, "ws", "site", "pages");
  writeFile(folder, "index.html", PAGE);
  const file = writeFile(folder, "two.html", PAGE);
  const port = ["--port", String(world.port)];

  const first = run(world, ["review", folder].concat(port));
  assert.equal(first.code, 0, first.stderr);
  const session = /--session (s_[A-Za-z0-9_-]+)/.exec(first.stdout)[1];
  world.sessions.push(session);
  const folderReview = reviewOf(first);
  const origin = new URL(/^\s*open\s+(\S+)/m.exec(first.stdout)[1]).origin;

  // A committed comment on two.html, so the folder review holds it.
  const record = require("../../src/shared/record.js");
  const protocol = require("../../src/shared/protocol.js");
  const item = record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "x", page_origin: origin, page_path: "/two.html", page_title: "t", page_seq: 1 });
  require("../../src/service/log.js").createEventLog({ dir: world.state }).append(folderReview, [protocol.newEvent({
    event: protocol.EVENT.ITEM_READY, event_id: "ev_used_1", review: folderReview, item: item.id, rev: item.rev,
    page_path: "/two.html", page_title: "t", page_seq: 1, payload: { draft: false, record: item }
  })]);

  const second = run(world, ["review", file, "--session", session].concat(port));
  assert.equal(second.code, 0, second.stderr);
  assert.equal(reviewOf(second), folderReview, "add reused the folder review");
  const url = /^\s*open\s+(\S+)/m.exec(second.stdout)[1];
  assert.equal(await answering(world, url), folderReview, "and the page answers for it");
});
