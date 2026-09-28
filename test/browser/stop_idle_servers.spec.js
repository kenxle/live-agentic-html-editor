// A page server nobody is looking at stops, and `lahe review` brings it back.
//
// Spec: docs/features/20260928.05_stop_idle_servers/01_spec_stop_idle_servers.md.
// The real `lahe review` walk: the real session, helper and page server. The
// helper runs with a short grace (LAHE_IDLE_GRACE_MS, test only) so "two
// minutes with no window open" is under two seconds here.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");

const GRACE_MS = 1500;
const SWEEP_MS = 200;

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

/** Does anything accept a connection on this port? */
function portOpen(port) {
  return new Promise(function (resolve) {
    const socket = net.connect({ host: "127.0.0.1", port: port });
    socket.once("connect", function () {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", function () {
      socket.destroy();
      resolve(false);
    });
  });
}

function labelled(output, label) {
  const match = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return match ? match[1] : null;
}

async function holding(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag",
    timeoutMs: 20000
  });
  await pollPage(page, () => window.__lahe.handle.sync.lockState().helperGranted === true, undefined, {
    message: "the helper to grant this window the review"
  });
}

test.describe("page servers stop when no window is open, and come back", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-idle-servers-"));
    const stateDir = path.join(root, "state");
    const work = path.join(root, "work");
    fs.mkdirSync(work, { recursive: true });
    const pagePath = path.join(work, "doc.html");
    fs.writeFileSync(
      pagePath,
      '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Idle</title></head>' +
        '<body><main><p id="p">A page nobody is looking at.</p></main></body></html>\n'
    );
    const env = Object.assign({}, process.env, {
      LAHE_STATE_DIR: stateDir,
      LAHE_IDLE_GRACE_MS: String(GRACE_MS),
      LAHE_IDLE_SWEEP_MS: String(SWEEP_MS)
    });
    delete env.XDG_STATE_HOME;
    const helperPort = await freePort();
    const run = function (args) {
      return execFileSync(process.execPath, [CLI].concat(args), {
        cwd: REPO_ROOT,
        env: env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    };
    const output = run(["review", pagePath, "--port", String(helperPort)]);
    const session = labelled(output, "session");
    const open = labelled(output, "open");
    expect(session).toBeTruthy();
    expect(open).toBeTruthy();
    world = { stateDir, pagePath, session, open, port: Number(new URL(open).port), helperPort, run };
  });

  test.afterAll(async () => {
    if (!world) return;
    try {
      world.run(["session", "close", world.session, "--port", String(world.helperPort)]);
    } catch (err) {
      // A session that already went down is not a test failure.
    }
  });

  test("a reload keeps the server; closing the last window stops it; lahe review brings it back", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(world.open);
    await holding(page);

    // A reload: a goodbye, then a fresh claim. The server answers throughout,
    // for several sweeps past the grace.
    await page.reload();
    await holding(page);
    const reloadedAt = Date.now();
    await pollUntil(
      async function () {
        expect(await portOpen(world.port), "the reloaded page is open, so its server answers").toBe(true);
        return Date.now() - reloadedAt > GRACE_MS + 5 * SWEEP_MS;
      },
      { timeoutMs: 20000, message: "several sweeps past the grace with the page open" }
    );

    // The last window closes. Its goodbye starts the grace, and then the
    // server stops.
    await page.close();
    await pollUntil(async () => !(await portOpen(world.port)), {
      timeoutMs: 20000,
      message: "the page server to stop after the grace"
    });

    // The session is still open: its agent keeps watching.
    const sessionFile = path.join(world.stateDir, "agent-sessions", world.session, "session.json");
    expect(JSON.parse(fs.readFileSync(sessionFile, "utf8")).closed_at).toBeNull();

    // `lahe status` says so and names the command.
    const said = world.run(["status", "--session", world.session]);
    expect(said).toContain("server    stopped");
    expect(said).toContain("lahe review " + world.pagePath + " --session " + world.session);

    // The agent runs it, and the same link works again.
    const again = world.run(["review", world.pagePath, "--session", world.session, "--port", String(world.helperPort)]);
    expect(labelled(again, "open")).toBe(world.open);
    const back = await context.newPage();
    await back.goto(world.open);
    await holding(back);
    expect(await back.evaluate(() => document.querySelector("#p").textContent)).toBe("A page nobody is looking at.");
    await back.close();
    await context.close();
  });
});
