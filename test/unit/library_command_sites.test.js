// `lahe library` with stable addresses on (Task 4.2): it prints the Library's
// own stable address when the running helper serves pages, and the 127.0.0.1
// address it always printed when it does not.
//
// The helper runs on free ports and a temp state folder (never 7817 or 1483),
// and is stopped by the pids its own state folder records.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const library = require("../../src/cli/commands/library.js");
const { onFreePort } = require("../helpers/free_port.js");
const { raw } = require("../helpers/sites_world.js");

async function run(argv) {
  const stdout = [];
  const stderr = [];
  const code = await library.run(argv, { stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

/** Start a helper on a free port with the pages switch set the way the test says. */
async function startHelperWith(t, dir, env) {
  const prior = {};
  Object.keys(env).forEach((key) => {
    prior[key] = process.env[key];
    if (env[key] === null) delete process.env[key];
    else process.env[key] = env[key];
  });
  t.after(() => {
    Object.keys(prior).forEach((key) => {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    });
  });
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });
  return onFreePort((p) => sessionCommand.startHelper(dir, p));
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-library-sites-"));
}

test("lahe library prints the Library's stable address when the helper serves pages, and that address loads", async (t) => {
  const dir = tempDir();
  agentSessions.createStore({ dir }).create({ id: "s_agent", name: "document index" });
  const { port } = await startHelperWith(t, dir, { LAHE_PAGES: "sites", LAHE_PAGES_PORT: "0" });
  const ready = JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8"));
  assert.equal(ready.pages.mode, "sites");
  const pagesPort = ready.pages.port;
  assert.ok(Number.isInteger(pagesPort) && pagesPort !== port && pagesPort !== 1483);

  const out = await run(["--session", "s_agent", "--state-dir", dir, "--port", String(port), "--json"]);
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  const printed = JSON.parse(out.stdout.trim());
  assert.equal(printed.url, "http://library.lahe.localhost:" + pagesPort + protocol.CATALOG_PAGE_PATH);

  const text = await run(["--session", "s_agent", "--state-dir", dir, "--port", String(port)]);
  assert.match(text.stdout, new RegExp("Library\\s+http://library\\.lahe\\.localhost:" + pagesPort + "/catalog"));
  assert.match(text.stdout, new RegExp("open it\\s+open http://library\\.lahe\\.localhost:" + pagesPort + "/catalog"));

  const page = await raw(pagesPort, {
    path: protocol.CATALOG_PAGE_PATH,
    headers: { host: "library.lahe.localhost:" + pagesPort, "sec-fetch-site": "none" }
  });
  assert.equal(page.status, 200, "the printed address is one the helper answers");
});

test("lahe library keeps printing the 127.0.0.1 address when the helper does not serve pages", async (t) => {
  const dir = tempDir();
  agentSessions.createStore({ dir }).create({ id: "s_agent", name: "document index" });
  const { port } = await startHelperWith(t, dir, { LAHE_PAGES: null, LAHE_PAGES_PORT: null });
  const out = await run(["--session", "s_agent", "--state-dir", dir, "--port", String(port), "--json"]);
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  assert.equal(JSON.parse(out.stdout.trim()).url, "http://127.0.0.1:" + port + protocol.CATALOG_PAGE_PATH);
});
