// The menu bar app against the fake helper: every look and every change
// between looks (plan V29), the squatter case (V34, the app's half), opening
// through the allowlist (V30), and Stop and Start (V31).
//
// These need the built app, so they skip unless LAHE_MENUBAR_APP names a test
// build of it (compiled with -D LAHE_TEST_LABELS; see macos/menubar/README.md).
// The Stop and Start test also loads a real launchd job, under a lahe-test-<pid>
// label and a plist in its own temp state folder, so it runs only when
// LAHE_MENUBAR_LAUNCHD=1 as well. Nothing here touches lahe-helper,
// lahe-menubar, ~/Library/LaunchAgents or ~/.local/state/lahe.
//
// Every process and job a test starts is stopped in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const APP = process.env.LAHE_MENUBAR_APP || "";
const FAKE = path.join(__dirname, "..", "fixtures", "menubar", "fake_helper.js");
const skip = !APP || process.platform !== "darwin" ? "set LAHE_MENUBAR_APP to a test build of the menu bar app" : false;
const skipLaunchd = skip || (process.env.LAHE_MENUBAR_LAUNCHD === "1" ? false : "set LAHE_MENUBAR_LAUNCHD=1 to load a lahe-test launchd job");

// One poll is 5 seconds and a request gives up after 4, so any change shows
// within 5 + 4 seconds of the moment it happens. A little slack on top.
const ONE_POLL_MS = 10000;

/** A child process that speaks JSON lines; waits for a line matching a test. */
function lineProcess(command, args, options) {
  const child = spawn(command, args, Object.assign({ stdio: ["pipe", "pipe", "inherit"] }, options));
  const seen = [];
  let buffer = "";
  let waiter = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    buffer += text;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const raw = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      let line;
      try {
        line = JSON.parse(raw);
      } catch (e) {
        line = { text: raw };
      }
      seen.push(line);
      if (waiter) waiter();
    }
  });
  let from = 0;
  /** The next line (after the last one taken) that passes `match`, within `ms`. */
  function until(match, ms, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null;
        reject(new Error("no line for " + what + " within " + ms + " ms; saw " + JSON.stringify(seen.slice(from))));
      }, ms);
      const look = () => {
        while (from < seen.length) {
          const line = seen[from++];
          if (match(line)) {
            clearTimeout(timer);
            waiter = null;
            return resolve(line);
          }
        }
      };
      waiter = look;
      look();
    });
  }
  function send(line) {
    child.stdin.write(line + "\n");
  }
  function stop() {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.stdin.end();
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    });
  }
  return { child, seen, until, send, stop };
}

function tempState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-menubar-app-"));
}

async function startFake(stateDir, extra) {
  const fake = lineProcess(process.execPath, [FAKE, "--state-dir", stateDir].concat(extra || []));
  const ready = await fake.until((l) => l.ready, 5000, "the fake helper's ready line");
  fake.command = async (line) => {
    fake.send(line);
    return fake.until((l) => l.ok !== undefined, 3000, line);
  };
  fake.port = ready.port;
  return fake;
}

function runApp(args, env) {
  return lineProcess(APP, args, { env: Object.assign({}, process.env, env || {}) });
}

const isCount = (text) => (l) => l.look === "count" && l.text === text;
const isCantTell = (l) => l.look === "cant-tell";

test("every look and every change between looks, against the fake helper (V29, V34)", { skip }, async (t) => {
  const stateDir = tempState();
  const fake = await startFake(stateDir);
  t.after(() => fake.stop());
  const app = runApp(["--watch", "--state-dir", stateDir]);
  t.after(() => app.stop());

  await app.until(isCount("2"), ONE_POLL_MS, "the count from summary.json");

  // Each failure leaves "2" within one poll, and shows can't tell, never the count.
  const failures = [
    ["timeout", "Lahe did not answer in time"],
    ["401", "Lahe refused the request"],
    ["409", "Lahe was updated; rebuilding"],
    ["unsigned", "An answer on Lahe's port was not signed by Lahe"],
    ["badsig", "An answer on Lahe's port was not signed by Lahe"]
  ];
  for (const [mode, reason] of failures) {
    await fake.command("mode " + mode);
    const line = await app.until((l) => l.look !== "count", ONE_POLL_MS, "leaving the count on " + mode);
    assert.equal(line.look, "cant-tell", mode + " shows can't tell");
    assert.equal(line.reason, reason, mode + "'s reason");
    await fake.command("mode ok");
    await app.until(isCount("2"), ONE_POLL_MS, "back to the count after " + mode);
  }

  await fake.command("mode down");
  await app.until((l) => l.look === "not-running" && l.stopped === false, ONE_POLL_MS, "not running when nothing listens");
  await fake.command("mode ok");
  await app.until(isCount("2"), ONE_POLL_MS, "back up");

  // A wake shows can't tell at once, and holds it until a fresh answer.
  await fake.command("mode timeout");
  app.send("wake");
  const woke = await app.until(isCantTell, 2000, "can't tell right after a wake");
  assert.equal(woke.reason, "The Mac just woke");
  const held = await app.until((l) => l.look !== "cant-tell" || l.reason !== "The Mac just woke", ONE_POLL_MS, "the next look after the wake");
  assert.equal(held.look, "cant-tell", "no answer since the wake, so still can't tell");
  await fake.command("mode ok");
  await app.until(isCount("2"), ONE_POLL_MS, "the first fresh answer after the wake");

  // A replaced secret file: the next answers do not check, the app reads the
  // file again, and recovers by the poll after.
  fs.writeFileSync(path.join(stateDir, "cli-secret"), crypto.randomBytes(32).toString("hex") + "\n");
  app.send("poll");
  await app.until(isCantTell, ONE_POLL_MS, "can't tell while the key is stale");
  await app.until(isCount("2"), 2 * ONE_POLL_MS, "recovered with the new key");

  // The other two counts.
  await fake.command("fixture summary_empty.json");
  await app.until((l) => l.look === "clear" && l.waiting_on_you === 0, ONE_POLL_MS, "the plain mark with nothing waiting");
  await fake.command("fixture summary_many.json");
  await app.until(isCount("99+"), ONE_POLL_MS, "99+ for 120 waiting");

  // V34, the app's half: everything it sent was a proof, never the secret.
  const stats = await fake.command("stats");
  assert.ok(stats.requests > 10, "the fake helper saw the app's requests");
  assert.equal(stats.secret_seen, false, "the raw secret never arrived");

  const log = fs.readFileSync(path.join(stateDir, "menubar.log"), "utf8");
  assert.match(log, /x-lahe-proof-reply did not check/, "a dropped answer is logged");
});

test("a document opens only through the allowlist (V30)", { skip }, async (t) => {
  const stateDir = tempState();
  const fake = await startFake(stateDir);
  t.after(() => fake.stop());

  async function open(review) {
    const app = runApp(["--state-dir", stateDir, "--action", "open", review]);
    t.after(() => app.stop());
    const code = await new Promise((resolve) => app.child.once("exit", resolve));
    assert.equal(code, 0);
    return app.seen.filter((l) => typeof l.text === "string").map((l) => l.text);
  }

  assert.deepEqual(await open("r183d18583a43"), ["opened http://notes.lahe.localhost:1483/r183d18583a43.md"]);
  await fake.command("open-url null");
  assert.deepEqual(await open("r183d18583a46"), ["opened http://library.lahe.localhost:1483/"], "url null opens the Library");
  for (const bad of ["javascript:alert(1)", "http://127.0.0.1:1483/", "http://notes.lahe.localhost:9999/", "https://notes.lahe.localhost/"]) {
    await fake.command("open-url " + bad);
    assert.deepEqual(await open("r183d18583a43"), [], bad + " is not opened");
  }
  const log = fs.readFileSync(path.join(stateDir, "menubar.log"), "utf8");
  assert.match(log, /refused to open an address that is not a Lahe address/);
});

test("Hide exits with status 0 (V31)", { skip }, async (t) => {
  const stateDir = tempState();
  const fake = await startFake(stateDir);
  t.after(() => fake.stop());
  const app = runApp(["--state-dir", stateDir, "--action", "hide"]);
  t.after(() => app.stop());
  assert.equal(await new Promise((resolve) => app.child.once("exit", resolve)), 0);
});

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function launchctl(args) {
  try {
    execFileSync("/bin/launchctl", args, { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

function answers(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitFor(check, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("timed out waiting for " + what);
}

test("Stop writes the marker and unloads the helper; Start removes it, bootstraps and kickstarts (V31)", { skip: skipLaunchd }, async (t) => {
  const stateDir = tempState();
  const id = String(process.pid);
  const label = "lahe-test-" + id;
  const domain = "gui/" + process.getuid();
  const plistPath = path.join(stateDir, label + ".plist");
  const port = await freePort();
  // A fake helper as a launchd job, at a fixed port so service.json stays true
  // across a restart. RunAtLoad only: no KeepAlive, so a failed teardown
  // cannot leave launchd restarting it.
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    "<key>Label</key><string>" + label + "</string>",
    "<key>ProgramArguments</key><array>",
    [process.execPath, FAKE, "--state-dir", stateDir, "--port", String(port), "--no-stdin"].map((a) => "<string>" + a + "</string>").join(""),
    "</array>",
    "<key>RunAtLoad</key><true/>",
    "</dict></plist>"
  ].join("\n");
  fs.writeFileSync(plistPath, plist);
  t.after(() => launchctl(["bootout", domain + "/" + label]));

  assert.ok(launchctl(["bootstrap", domain, plistPath]), "the test job loads");
  await waitFor(() => answers(port), 10000, "the fake helper under launchd");
  const env = { LAHE_TEST_ID: id };

  const stop = runApp(["--state-dir", stateDir, "--action", "stop"], env);
  t.after(() => stop.stop());
  assert.equal(await new Promise((resolve) => stop.child.once("exit", resolve)), 0);
  const marker = JSON.parse(fs.readFileSync(path.join(stateDir, "stopped.json"), "utf8"));
  assert.equal(marker.by, "menu bar");
  assert.ok(!Number.isNaN(Date.parse(marker.at)), "the marker carries the time");
  // bootout can return while the job's process is still closing its server.
  await waitFor(async () => !launchctl(["print", domain + "/" + label]), 5000, "the job to be unloaded");
  await waitFor(async () => !(await answers(port)), 5000, "the helper to stop");

  const watching = runApp(["--watch", "--state-dir", stateDir], env);
  t.after(() => watching.stop());
  await watching.until((l) => l.look === "not-running" && l.stopped === true, ONE_POLL_MS, "not running, stopped by you");
  await watching.stop();

  const start = runApp(["--state-dir", stateDir, "--action", "start"], env);
  t.after(() => start.stop());
  assert.equal(await new Promise((resolve) => start.child.once("exit", resolve)), 0);
  assert.equal(fs.existsSync(path.join(stateDir, "stopped.json")), false, "Start removes the marker");
  assert.ok(launchctl(["print", domain + "/" + label]), "the job is loaded again");
  await waitFor(() => answers(port), 10000, "the helper to start again");

  const after = runApp(["--watch", "--state-dir", stateDir], env);
  t.after(() => after.stop());
  await after.until(isCount("2"), ONE_POLL_MS, "the count again after Start");
});
