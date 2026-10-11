// `lahe library` prints the Library's own address (stable addresses, Tasks 4.2
// and 4.3): its name, at the port the helper has proved, as service.json
// reports it. 80 once the port-80 forward is checked, else the pages port. The
// same port `lahe review` prints for a page (src/service/addresses.js).
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

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-library-sites-"));
}

test("lahe library prints the Library's address at the pages port, and that address loads", async (t) => {
  const dir = tempDir();
  agentSessions.createStore({ dir }).create({ id: "s_agent", name: "document index" });
  const prior = process.env.LAHE_PAGES_PORT;
  process.env.LAHE_PAGES_PORT = "0";
  t.after(() => {
    if (prior === undefined) delete process.env.LAHE_PAGES_PORT;
    else process.env.LAHE_PAGES_PORT = prior;
  });
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });
  const { port } = await onFreePort((p) => sessionCommand.startHelper(dir, p));
  const ready = JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8"));
  const pagesPort = ready.pages.port;
  assert.ok(Number.isInteger(pagesPort) && pagesPort !== port && pagesPort !== 1483);
  assert.equal(ready.pages.printed_port, pagesPort, "no forward is set up here, so the pages port is the printed one");

  const out = await run(["--session", "s_agent", "--state-dir", dir, "--port", String(port), "--json"]);
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  assert.equal(JSON.parse(out.stdout.trim()).url, "http://library.lahe.localhost:" + pagesPort + protocol.CATALOG_PAGE_PATH);

  const text = await run(["--session", "s_agent", "--state-dir", dir, "--port", String(port)]);
  assert.match(text.stdout, new RegExp("Library\\s+http://library\\.lahe\\.localhost:" + pagesPort + "/catalog"));
  assert.match(text.stdout, new RegExp("open it\\s+open http://library\\.lahe\\.localhost:" + pagesPort + "/catalog"));

  const page = await raw(pagesPort, {
    path: protocol.CATALOG_PAGE_PATH,
    headers: { host: "library.lahe.localhost:" + pagesPort, "sec-fetch-site": "none" }
  });
  assert.equal(page.status, 200, "the printed address is one the helper answers");
});

test("the Library's printed address uses the port the helper has proved: 80 once the forward is checked, else the pages port", () => {
  const ready = (pages) => ({ port: 7817, pages });
  assert.equal(
    library.libraryUrl(ready({ port: 1483, printed_port: 80 })),
    "http://library.lahe.localhost/catalog",
    "the forward is proved: no port"
  );
  assert.equal(library.libraryUrl(ready({ port: 1483, printed_port: 1483 })), "http://library.lahe.localhost:1483/catalog");
  assert.equal(
    library.libraryUrl(ready({ port: 51234, printed_port: 51234, port_free: { on: true, verified: false, reason: "not checked yet" } })),
    "http://library.lahe.localhost:51234/catalog",
    "installed but not yet proved: the pages port"
  );
  assert.equal(library.libraryUrl(ready({ port: 1483 })), "http://library.lahe.localhost:1483/catalog", "a report with no printed port falls back to the pages port");
});

test("a helper that reports no pages block is reached at its loopback address", () => {
  assert.equal(library.libraryUrl({ port: 7817 }), "http://127.0.0.1:7817/catalog");
  assert.equal(library.libraryUrl({ port: 7817, pages: {} }), "http://127.0.0.1:7817/catalog");
});
