// A fresh review on the same page, for specs whose tests each expect an empty
// rail.
//
// Each page carries its own comments: a fresh browser context shows every
// record the page's review holds (records.read at boot), so an earlier test's
// edits on the same page show in the next test, and a new edit on the same
// block is a rewording of the old one. A spec whose tests share one page and
// one review calls this at the start of every test after the first: it
// retires the review it used and starts a new one on the same page (one
// review per file: retire is how a file gets a new review).

"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

function labelled(output, label) {
  const match = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return match ? match[1] : null;
}

/**
 * @param {{env: object, session: string, review: string, pagePath: string,
 *          stateDir: string, port: number, open?: string, reviewDir?: string}} world
 *   updated in place: review, open, reviewDir
 */
function freshReview(world) {
  const run = (args) => execFileSync(process.execPath, [CLI].concat(args), {
    cwd: REPO_ROOT, env: world.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
  run(["review", "retire", world.review, "--session", world.session, "--port", String(world.port)]);
  const output = run(["review", world.pagePath, "--session", world.session, "--port", String(world.port)]);
  world.review = labelled(output, "review");
  world.open = labelled(output, "open");
  world.reviewDir = path.join(world.stateDir, "reviews", world.review);
  return world;
}

module.exports = { freshReview };
