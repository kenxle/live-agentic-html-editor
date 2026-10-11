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

test("lahe review --review <older> binds the review add reused, not the session's newest", async (t) => {
  const root = tempRoot("lahe-review-used-");
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const world = { state: path.join(root, "state"), port: await freePort(), sessions: [] };
  world.env = Object.assign({}, process.env, { LAHE_HOME_DIR: home, LAHE_PAGES_PORT: String(await freePort()) });
  t.after(async () => {
    for (const s of world.sessions) run(world, ["session", "close", s]);
    await stopTempHelpers(world.state);
  });
  const file = writeFile(home, "ws/repo/docs/page.html", PAGE);
  const port = ["--port", String(world.port)];

  const first = run(world, ["review", file].concat(port));
  assert.equal(first.code, 0, first.stderr);
  const session = /--session (s_[A-Za-z0-9_-]+)/.exec(first.stdout)[1];
  world.sessions.push(session);
  const older = reviewOf(first);
  const url = /^\s*open\s+(\S+)/m.exec(first.stdout)[1];

  const second = run(world, ["review", file, "--session", session, "--new"].concat(port));
  assert.equal(second.code, 0, second.stderr);
  const newer = reviewOf(second);
  assert.notEqual(newer, older);
  assert.equal(await answering(world, url), newer);

  const third = run(world, ["review", file, "--session", session, "--review", older].concat(port));
  assert.equal(third.code, 0, third.stderr);
  assert.equal(reviewOf(third), older, "add reused the older review");
  assert.equal(await answering(world, url), older, "and the page answers for it");
});
