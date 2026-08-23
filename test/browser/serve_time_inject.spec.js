// The rail survives a rebuild that stripped the script line even when NOBODY
// ever had the page open in between.
//
// heal.js only runs off a live page's reply poll (reviews.targetMtime, called
// from replies.poll), so it can only repair a page something is already
// polling. Twice in live use an agent rebuilt a reviewed page wholesale and the
// comments module disappeared: the reviewer's tab was closed, or they
// hard-reloaded in the exact window between the overwrite and the next poll, so
// nothing was polling and nothing repaired it. src/service/static_servers.js
// closes that window by injecting the script tag into the HTTP RESPONSE for a
// recorded target, so the very first load after an overwrite is already
// carrying the rail, before the library has ever had a chance to poll anything.
//
// Nothing here is simulated: it is the real `lahe review` walk, so the
// session, the helper, and the static server are the real ones, and the file
// rewrite is exactly what an ad hoc script (a template render, a report dump)
// does when it overwrites a reviewed page in one shot.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

const FIRST_BODY = "The reviewed page, as the walk first wrote it.";
const REBUILT_BODY = "The reviewed page, rewritten wholesale with no script line at all.";

function docHtml(body, scriptLine) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Steady Pace</title></head>',
    "<body>",
    "<main>",
    '<p id="p">' + body + "</p>",
    "</main>",
    scriptLine,
    "</body>",
    "</html>",
    ""
  ].join("\n");
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

/** Has this port stopped accepting connections? */
function portClosed(port) {
  return new Promise(function (resolve) {
    const socket = net.connect({ host: "127.0.0.1", port: port });
    socket.once("connect", function () {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", function () {
      socket.destroy();
      resolve(true);
    });
  });
}

function labelled(output, label) {
  const match = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return match ? match[1] : null;
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag",
    timeoutMs: 20000
  });
}

test.describe("a rebuild that drops the line before anyone ever polls still lands the rail", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-serve-inject-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const pagePath = path.join(work, "doc.html");
    fs.writeFileSync(pagePath, docHtml(FIRST_BODY, ""));

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    const port = await freePort();

    const output = execFileSync(process.execPath, [CLI, "review", pagePath, "--port", String(port)], {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const session = labelled(output, "session");
    const review = labelled(output, "review");
    const open = labelled(output, "open");
    expect(session, "`lahe review` printed the agent session id").toBeTruthy();
    expect(review, "`lahe review` printed the review id").toBeTruthy();
    expect(open, "`lahe review` printed the URL its own static server publishes the page at").toBeTruthy();

    world = { root, stateDir, pagePath, env, session, review, open };
  });

  test.afterAll(async () => {
    if (!world) return;
    try {
      execFileSync(process.execPath, [CLI, "session", "close", world.session], {
        cwd: REPO_ROOT,
        env: world.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      // A session that already went down is not a test failure.
    }
  });

  test("a fresh load lands the rail, even though the file on disk never carried the line", async ({ page }) => {
    // The failure this covers: an ad hoc rebuild script overwrites the whole
    // file in one shot, carrying no lahe line at all, and NOBODY has the page
    // open when it happens. heal.js cannot have run yet, because nothing has
    // ever polled this review: this is the page's very first load.
    fs.writeFileSync(world.pagePath, docHtml(REBUILT_BODY, ""));
    expect(
      fs.readFileSync(world.pagePath, "utf8").indexOf("data-lahe-review"),
      "the file on disk really does carry no script line"
    ).toBe(-1);

    await page.goto(world.open);
    await booted(page);

    expect(await page.evaluate(() => window.__lahe.review), "the rail is on the review the walk minted").toBe(
      world.review
    );
    expect(await page.evaluate(() => document.querySelector("#p").textContent)).toBe(REBUILT_BODY);

    // And the walk left the reviewer's own folder alone: no tag was ever
    // written into the page, and no copy of the library sits beside it. Both
    // used to be written there, both got committed by an ordinary `git add -A`,
    // and a deployed copy of the pair brought this rail up for every visitor.
    expect(fs.readdirSync(path.dirname(world.pagePath)), "the folder holds only the reviewer's page").toEqual([
      "doc.html"
    ]);
    expect(
      fs.readFileSync(world.pagePath, "utf8").indexOf("data-lahe-review"),
      "the file on disk still carries no tag, even now that the rail is up"
    ).toBe(-1);
  });
});

// THE STATIC SERVER IS THE ONE THAT CANNOT BE DOWN.
//
// The helper and this server are separate processes, and the helper really does
// go down while the server keeps answering. When a copy of the bundle sat beside
// the page, the script line's onerror loaded it relatively and covered that
// case. Nothing is written beside the page any more, so the injected line points
// its src at the server's own reserved library route instead: the process that
// just answered the request for the page answers for the library too.
test.describe("the helper is down and the rail still loads, from the server that served the page", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-serve-nohelper-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const pagePath = path.join(work, "doc.html");
    fs.writeFileSync(pagePath, docHtml(FIRST_BODY, ""));

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    const port = await freePort();

    const output = execFileSync(process.execPath, [CLI, "review", pagePath, "--port", String(port)], {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const session = labelled(output, "session");
    const review = labelled(output, "review");
    const open = labelled(output, "open");
    expect(open, "`lahe review` printed the served URL").toBeTruthy();

    // Stop the HELPER and nothing else. `session close` would take the static
    // server with it, and the static server staying up is the whole point.
    const ready = JSON.parse(fs.readFileSync(path.join(stateDir, "service.json"), "utf8"));
    process.kill(ready.pid, "SIGTERM");
    await pollUntil(() => portClosed(ready.port), {
      timeoutMs: 15000,
      message: "the helper's port to stop accepting connections"
    });

    world = { root, stateDir, pagePath, env, session, review, open };
  });

  test.afterAll(async () => {
    if (!world) return;
    try {
      execFileSync(process.execPath, [CLI, "session", "close", world.session], {
        cwd: REPO_ROOT,
        env: world.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      // The helper is already gone; a close that complains about it is not a
      // test failure.
    }
  });

  test("the library comes off the static server's own route, with no helper and no file beside the page", async ({ page }) => {
    expect(
      fs.existsSync(path.join(path.dirname(world.pagePath), "lahe-layer.js")),
      "there is no sibling copy of the bundle to fall back to"
    ).toBe(false);

    await page.goto(world.open);
    await booted(page);

    expect(await page.evaluate(() => window.__lahe.review), "the rail is on this review").toBe(world.review);

    // It came from the primary src, which is this server's reserved route. The
    // onerror fallback names the helper, and the helper is down, so if the route
    // had not answered nothing would have booted at all.
    const srcs = await page.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll("script"), (s) => s.getAttribute("src"))
    );
    expect(srcs, "the page loaded the library from the static server: " + JSON.stringify(srcs)).toContain(
      "/.lahe-library/lahe-layer.js"
    );

    // And it tells the reviewer the truth about the helper rather than pretending.
    await pollPage(page, () => window.__lahe.status() === "kept_locally", undefined, {
      timeoutMs: 20000,
      message: "the rail to say the work is kept in this browser"
    });
    const chips = await page.evaluate(() => window.__lahe.failures().map((chip) => chip.code));
    expect(chips, "the reviewer is told the helper is unreachable").toContain("HELPER_UNREACHABLE");
  });
});
