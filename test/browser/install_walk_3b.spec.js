// 3B's done bar: a clean clone in a temporary HOME with no existing state runs
// the ONE documented command path, adds the library to a page, and completes a
// review that lands in events.jsonl.
//
// What is real here and what is not:
//
//   REAL  the install. `npm link` from the clone, then `lahe` resolved off PATH,
//         exactly as the README documents it. Nothing calls run() in process.
//   REAL  the HOME. A fresh temporary directory, so the helper's state directory
//         is created from nothing: no review, no token, no log.
//   REAL  the page. A static .html file opened with file://, which is the case
//         `add` is written for and the case 1A's spike proved reaches a helper.
//   REAL  the review. The reviewer's own gestures on a real browser, through the
//         real built bundle, ending in the helper's append-only log.
//
//   NOT   the port. The default is fixed (7817) because a page carries it in its
//         script tag, and a parallel Playwright run would collide on it, so this
//         spec passes --port. That is the same deviation every one of 1A's specs
//         takes and the only one this walk takes.
//
// The fresh USER ACCOUNT version of this walk is 4A's (AC6). It cannot run
// inside a builder's worktree, which is why this one settles for a fresh HOME.
//
// NOTHING IS DELETED HERE. The temporary HOME, the sandboxed npm prefix and the
// page are left in the OS temp directory and listed for the cleanup batch.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollUntil, pollPage, readEventLog } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

// One walk, one helper, one port. Serial because the whole file is one story.
test.describe.configure({ mode: "serial" });

const PAGE = [
  "<!doctype html>",
  "<html>",
  "  <head><meta charset='utf-8'><title>The quarterly note</title></head>",
  "  <body>",
  "    <h1 id='title'>The quarterly note</h1>",
  "    <p id='lede'>Revenue grew, and the team grew with it.</p>",
  "  </body>",
  "</html>",
  ""
].join("\n");

const SAID = "This paragraph promises a number and never gives one.";

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

/** Run a command as a user would type it, with only the environment given. */
function shell(command, env, cwd) {
  return execFileSync("/bin/sh", ["-c", command], {
    cwd: cwd || REPO_ROOT,
    env: env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

test.describe("AC6: the install is one documented command path", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-install-walk-"));
    const home = path.join(root, "home");
    const prefix = path.join(root, "npm-global");
    const work = path.join(home, "work");
    fs.mkdirSync(work, { recursive: true });
    fs.mkdirSync(prefix, { recursive: true });

    const pagePath = path.join(work, "quarterly.html");
    fs.writeFileSync(pagePath, PAGE);

    // The state directory is DERIVED, not passed: with HOME pointed at a fresh
    // directory and nothing in the environment overriding it, the helper puts
    // its data in ~/.local/state/lahe, which is where a new user's would go.
    const stateDir = path.join(home, ".local", "state", "lahe");
    expect(fs.existsSync(stateDir), "no state exists before the walk starts").toBe(false);

    const env = Object.assign({}, process.env, {
      HOME: home,
      // The sandbox: npm's global prefix is inside the temporary HOME, so
      // `npm link` writes its bin into a throwaway directory and never touches
      // the real global one.
      npm_config_prefix: prefix,
      PATH: path.join(prefix, "bin") + path.delimiter + process.env.PATH
    });
    delete env.XDG_STATE_HOME;
    delete env.LAHE_STATE_DIR;

    world = { root, home, prefix, work, pagePath, stateDir, env, port: await freePort() };
  });

  test.afterAll(async () => {
    if (!world) return;
    const readyPath = path.join(world.stateDir, "service.json");
    if (!fs.existsSync(readyPath)) return;
    let ready = null;
    try {
      ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    } catch (err) {
      return;
    }
    if (!ready || typeof ready.pid !== "number") return;
    try {
      process.kill(ready.pid, "SIGTERM");
    } catch (err) {
      if (err.code !== "ESRCH") throw err;
    }
  });

  test("npm link once, then `lahe add`, and the page is ready to review", async () => {
    // The clone is already installed: `npm install` is the first documented
    // command and it is what put node_modules here.
    expect(fs.existsSync(path.join(REPO_ROOT, "node_modules")), "npm install has been run").toBe(true);

    shell("npm link --loglevel=error", world.env);

    const laheOnPath = shell("command -v lahe", world.env).trim();
    expect(laheOnPath, "`lahe` is an installed command, found on PATH").toBe(
      path.join(world.prefix, "bin", "lahe")
    );

    const added = shell(
      "lahe add " + JSON.stringify(world.pagePath) + " --port " + world.port,
      world.env
    );

    // What it said it did, said in words a person can act on.
    expect(added).toContain("review");
    expect(added).toContain("committed and shared");
    expect(added).toContain("file://" + world.pagePath);

    // What it actually did.
    const html = fs.readFileSync(world.pagePath, "utf8");
    const reviewId = /data-lahe-review="([^"]+)"/.exec(html);
    expect(reviewId, "the script line is in the page").toBeTruthy();
    world.review = reviewId[1];

    const protocol = require("../../src/shared/protocol.js");
    const expected = protocol.scriptTag({
      src: /src="([^"]+)"/.exec(html)[1],
      review: world.review,
      token: /data-lahe-token="([^"]+)"/.exec(html)[1],
      helper: "http://127.0.0.1:" + world.port
    });
    const indented = expected
      .split("\n")
      .map((line, i) => (i === 0 ? line : "  " + line))
      .join("\n");
    expect(html, "the line is protocol.scriptTag's pinned form, attribute for attribute").toContain(
      indented
    );

    // The helper is up, from that one command, with no second command typed.
    const ready = await pollUntil(
      () => {
        const readyPath = path.join(world.stateDir, "service.json");
        if (!fs.existsSync(readyPath)) return null;
        try {
          return JSON.parse(fs.readFileSync(readyPath, "utf8"));
        } catch (err) {
          return null;
        }
      },
      { message: "the helper add started to write its readiness file into the fresh HOME" }
    );
    expect(ready.port).toBe(world.port);
    expect(ready.reviews[world.review], "the helper holds the review add minted").toBeTruthy();
    expect(ready.reviews[world.review].origins, "and the file origin is registered").toContain("null");
  });

  test("the reviewer's comment on that page lands in events.jsonl", async ({ page }) => {
    await page.goto("file://" + world.pagePath);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the library to boot from the script line add wrote"
    });

    // The reviewer's own gestures: drag over a paragraph, Cmd-Shift-C, type,
    // Cmd-Enter. Nothing is injected and no harness stands in for the library.
    await page.evaluate(() => {
      const el = document.querySelector("#lede");
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
      message: "the comment box to open on the passage"
    });
    await page.keyboard.type(SAID);
    await page.keyboard.press("ControlOrMeta+Enter");

    const ready = await pollUntil(
      () => {
        const lines = readEventLog(world.stateDir, world.review);
        const found = lines.filter((event) => event.record && event.record.note === SAID);
        return found.length > 0 ? found : null;
      },
      {
        message: "the finished comment to reach the helper's events.jsonl",
        describe: () => ({ stateDir: world.stateDir, review: world.review })
      }
    );

    const last = ready[ready.length - 1];
    expect(last.record.note, "the reviewer's words, exactly as typed").toBe(SAID);
    expect(last.record.state, "a comment finished with Cmd-Enter is ready, not a draft").toBe("ready");
    expect(last.review).toBe(world.review);
  });
});
