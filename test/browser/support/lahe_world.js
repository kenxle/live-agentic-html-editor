// A real review for the seam specs (plan Task 3.4): `lahe review` or
// `lahe write` run from this checkout, with its own state folder and helper
// port, never Ken's shared helper on 7817.
//
// Walk rules (plan, "Rules every builder follows"):
//   - the checkout comes from LAHE_REPO or this file's location
//   - the CLI is `node <checkout>/bin/lahe.js`, never the lahe on PATH
//   - output goes to the OS temp folder, never into the repo
//
// Nothing here falls back to reloading the page by hand. A rebuild that does
// not reload the page on its own fails the test that asked for it.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { expect, pollPage, pollUntil } = require("../../helpers");

const REPO_ROOT = process.env.LAHE_REPO || path.join(__dirname, "..", "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

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

function labelled(output, label) {
  const match = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return match ? match[1] : null;
}

/**
 * Start a real review.
 *
 * @param {{file: string, text: string, command?: "review"|"write", create?: boolean}} spec
 *   file is the source's name, text its first contents. With command "write"
 *   and create false the file is not made first, so `lahe write` creates it.
 */
async function makeWorld(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-seams-"));
  const stateDir = path.join(root, "state");
  const work = path.join(root, "work");
  fs.mkdirSync(work, { recursive: true });
  const source = path.join(work, spec.file);
  if (spec.create !== false) fs.writeFileSync(source, spec.text || "");
  const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
  delete env.XDG_STATE_HOME;
  const port = await freePort();
  const cli = function (args) {
    return execFileSync(process.execPath, [CLI].concat(args), {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  };
  const out = cli([spec.command || "review", source, "--port", String(port)]);
  const world = {
    root: root,
    stateDir: stateDir,
    source: source,
    cli: cli,
    output: out,
    session: labelled(out, "session"),
    review: labelled(out, "review"),
    open: labelled(out, "open")
  };
  world.reviewDir = path.join(stateDir, "reviews", world.review);
  expect(world.open, "`lahe " + (spec.command || "review") + "` printed the page URL").toBeTruthy();
  return world;
}

function closeWorld(world) {
  if (!world) return;
  try {
    world.cli(["session", "close", world.session]);
  } catch (err) {
    // A session that already went down is not a test failure.
  }
}

function readSource(world) {
  return fs.readFileSync(world.source, "utf8");
}

function reviewJson(world) {
  try {
    return JSON.parse(fs.readFileSync(path.join(world.reviewDir, "review.json"), "utf8"));
  } catch (err) {
    return null; // mid-write, or not written yet; the caller polls
  }
}

function reviewJsonItem(world, id) {
  const json = reviewJson(world);
  if (!json) return null;
  for (const p of json.pages) for (const it of p.items) if (it.id === id) return it;
  return null;
}

/** The item as review.json holds it at exactly this rev (the committed revision). */
function helperHas(world, id, rev) {
  return pollUntil(
    () => {
      const it = reviewJsonItem(world, id);
      return it && it.rev === rev ? it : null;
    },
    { message: "review.json to hold " + id + " at rev " + rev, timeoutMs: 20000 }
  );
}

/** The drain command's item lines, parsed. The last line (ended_reviews, liveness) is left out. */
function drainLines(world) {
  const out = world.cli(["status", "--session", world.session, "--json", "--quiet"]);
  return out
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((l) => l.item || l.id);
}

/** Append one reply line with `lahe reply`, and wait for the helper to fold it. */
async function reply(world, it, status, extra) {
  const prior = reviewJsonItem(world, it.id);
  const priorAt = prior && prior.reply ? prior.reply.at : null;
  const out = world.cli(
    ["reply", "--review", world.review, "--item", it.id, "--rev", String(it.rev), "--status", status, "--agent", "seams", "--file", world.source].concat(
      extra || []
    )
  );
  const folded = await pollUntil(
    () => {
      const got = reviewJsonItem(world, it.id);
      return got && got.reply && got.reply.status === status && got.reply.at !== priorAt ? got : null;
    },
    { message: "the helper to fold the " + status + " reply on " + it.id, timeoutMs: 20000 }
  );
  folded.cliOutput = out;
  return folded;
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot",
    timeoutMs: 20000
  });
  await page.evaluate(() => window.__lahe.interactionBusy(50));
}

async function claim(page) {
  if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
    await page.evaluate(() => window.__lahe.handle.sync.takeover());
    await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
      message: "this window to take the review"
    });
  }
}

/** The page after a load: booted, the check ran, one replay pass. */
async function settled(page) {
  await booted(page);
  await pollPage(page, () => window.__lahe.counters.revertChecks >= 1, undefined, {
    message: "the page check to run on this load",
    timeoutMs: 20000
  });
  await page.evaluate(() => window.__lahe.replayNow());
}

async function mtimeBaseline(page) {
  await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
    message: "the page's mtime baseline",
    timeoutMs: 20000
  });
}

/** Write the source with a later mtime, so the helper and the page see a new file. */
function writeSource(world, text) {
  fs.writeFileSync(world.source, text);
  const later = new Date(Date.now() + 10000 + Math.floor(Math.random() * 1000));
  fs.utimesSync(world.source, later, later);
}

/** Count main-frame navigations from now on. */
function navCounter(page) {
  const state = { count: 0 };
  const onNav = (frame) => {
    if (frame === page.mainFrame()) state.count += 1;
  };
  page.on("framenavigated", onNav);
  state.stop = () => page.off("framenavigated", onNav);
  return state;
}

/**
 * The agent writes the source; the page must reload itself off it. There is
 * no fallback: a page that never reloads fails here.
 */
async function agentWrites(page, world, text) {
  await mtimeBaseline(page);
  const nav = navCounter(page);
  writeSource(world, text);
  try {
    await pollUntil(() => nav.count > 0, { message: "the page to reload itself after the rebuild", timeoutMs: 30000 });
  } finally {
    nav.stop();
  }
  await page.waitForLoadState("load");
  await settled(page);
}

/** A reload by the reviewer (the browser's own reload), then settle. */
async function reviewerReloads(page) {
  await page.reload();
  await settled(page);
}

function countOnPage(page, text, scope) {
  return page.evaluate(
    ([t, sel]) => {
      const root = document.querySelector(sel) || document.body;
      const words = root.innerText.replace(/\s+/g, " ");
      let n = 0;
      for (let at = words.indexOf(t); at !== -1; at = words.indexOf(t, at + 1)) n += 1;
      return n;
    },
    [text, scope || "main"]
  );
}

module.exports = {
  REPO_ROOT,
  CLI,
  makeWorld,
  closeWorld,
  readSource,
  writeSource,
  reviewJson,
  reviewJsonItem,
  helperHas,
  drainLines,
  reply,
  booted,
  claim,
  settled,
  mtimeBaseline,
  navCounter,
  agentWrites,
  reviewerReloads,
  countOnPage
};
