// `lahe library` and `lahe library answer` (LAHE Library, Task 1.4, architecture
// "Reaching the Library").
//
// Every helper these tests start runs on a free port and a temporary state
// dir: never 7817, never the real state dir.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const library = require("../../src/cli/commands/library.js");
const cli = require("../../src/cli/index.js");

const C = protocol.CATALOG;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-library-command-"));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function run(argv, extra) {
  const stdout = [];
  const stderr = [];
  const code = await library.run(argv, Object.assign({
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text)
  }, extra || {}));
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

test("lahe library is a routed command with its own help", async () => {
  assert.ok(cli.COMMAND_NAMES.includes("library"));
  const help = await run(["--help"]);
  assert.equal(help.code, protocol.CLI_EXIT.OK);
  assert.match(help.stdout, /usage: lahe library/);
  assert.match(help.stdout, /lahe library answer <request-id> --session <id> --status done\|refused --text/);
});

test("lahe library rejects bad usage without starting anything", async () => {
  const dir = tempDir();
  assert.equal((await run(["--session", "../x", "--state-dir", dir])).code, protocol.CLI_EXIT.BAD_USAGE);
  assert.equal((await run(["--bogus", "--state-dir", dir])).code, protocol.CLI_EXIT.BAD_USAGE);
  assert.equal((await run(["--port", "nope", "--state-dir", dir])).code, protocol.CLI_EXIT.BAD_USAGE);
  const unknown = await run(["--session", "s_ghost", "--state-dir", dir, "--port", "1"]);
  assert.equal(unknown.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(unknown.stderr, /unknown agent session "s_ghost"/);
  assert.equal(fs.existsSync(stateDir.readyPath(dir)), false, "no helper was started");
  assert.equal(fs.existsSync(stateDir.catalogAttachPath(dir)), false);
});

test("lahe library starts the helper, attaches the session, and prints the helper's own /catalog URL", async (t) => {
  const dir = tempDir();
  const port = await freePort();
  assert.notEqual(port, protocol.DEFAULT_PORT);
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_agent", name: "document index" });
  store.create({ id: "s_second" });
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });

  const first = await run(["--session", "s_agent", "--state-dir", dir, "--port", String(port), "--json"]);
  assert.equal(first.code, protocol.CLI_EXIT.OK, first.stderr);
  assert.ok(fs.existsSync(stateDir.readyPath(dir)), "the readiness file appeared in the temporary state dir");
  const printed = JSON.parse(first.stdout.trim());
  assert.deepEqual(Object.keys(printed).sort(), ["attached", "helper_started", "url"]);
  assert.equal(printed.url, "http://127.0.0.1:" + port + protocol.CATALOG_PAGE_PATH);
  assert.equal(new URL(printed.url).port, String(port));
  assert.equal(printed.helper_started, true);
  assert.equal(printed.attached.session, "s_agent");
  assert.equal(printed.attached.name, "document index");
  const attach = JSON.parse(fs.readFileSync(stateDir.catalogAttachPath(dir), "utf8"));
  assert.equal(attach.session, "s_agent");

  // No --session: the attach is left as it is, and the command says who it is.
  const second = await run(["--state-dir", dir, "--port", String(port)]);
  assert.equal(second.code, protocol.CLI_EXIT.OK, second.stderr);
  assert.match(second.stdout, new RegExp("http://127\\.0\\.0\\.1:" + port + "/catalog"));
  assert.match(second.stdout, /attached\s+document index \(s_agent\)/);
  assert.equal(JSON.parse(fs.readFileSync(stateDir.catalogAttachPath(dir), "utf8")).session, "s_agent");
  const json = JSON.parse((await run(["--state-dir", dir, "--port", String(port), "--json"])).stdout.trim());
  assert.equal(json.helper_started, false, "an answering helper is left where it is");
  assert.equal(json.attached.session, "s_agent");

  // A later --session replaces the attach: the last agent to run it is attached.
  const later = await run(["--session", "s_second", "--state-dir", dir, "--port", String(port)]);
  assert.equal(later.code, protocol.CLI_EXIT.OK, later.stderr);
  assert.match(later.stdout, /attached\s+s_second/);
});

test("lahe library with nobody attached says so", async (t) => {
  const dir = tempDir();
  const port = await freePort();
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });
  const out = await run(["--state-dir", dir, "--port", String(port)]);
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  assert.match(out.stdout, /attached\s+no agent/);
  const json = JSON.parse((await run(["--state-dir", dir, "--port", String(port), "--json"])).stdout.trim());
  assert.equal(json.attached, null);
});

// ---------------------------------------------------------------------------
// lahe library answer
// ---------------------------------------------------------------------------

function answerWorld() {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_agent" });
  store.create({ id: "s_doc" });
  store.create({ id: "s_other" });
  store.writeMonitor("s_agent", { pid: process.pid, handoff_rev: 0 });
  catalogRequests.writeAttach(dir, "s_agent", Date.now());
  const queue = catalogRequests.createQueue({ dir });
  const request = queue.append({ action: "pickup", review: "r_doc", session: "s_doc", for: "s_agent" }, Date.now()).request;
  return { dir, store, queue, request };
}

function answerArgs(w, id, extra) {
  return ["answer", id, "--session", "s_agent", "--status", "done", "--text", "watching it", "--state-dir", w.dir]
    .concat(extra || []);
}

test("lahe library answer marks the request answered", async () => {
  const w = answerWorld();
  const out = await run(answerArgs(w, w.request.id));
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  assert.match(out.stdout, new RegExp("answered " + w.request.id + ": done"));
  const state = w.queue.requestFor("r_doc", Date.now());
  assert.equal(state.state, "done");
  assert.equal(state.text, "watching it");
});

test("lahe library answer refuses an unknown id with BAD_USAGE", async () => {
  const w = answerWorld();
  const out = await run(answerArgs(w, "cq_0000000000000000"));
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(out.stderr, /no Library request cq_0000000000000000/);
});

test("lahe library answer refuses a --session that is not the request's `for`", async () => {
  const w = answerWorld();
  const args = answerArgs(w, w.request.id);
  args[args.indexOf("s_agent")] = "s_other";
  const out = await run(args);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(out.stderr, /for agent session s_agent, not s_other/);
  assert.equal(w.queue.requestFor("r_doc", Date.now()).state, "waiting");
});

test("lahe library answer refuses an expired request", async () => {
  const w = answerWorld();
  const out = await run(answerArgs(w, w.request.id), { now: Date.parse(w.request.at) + C.REQUEST_EXPIRY_MS });
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(out.stderr, /has expired/);
});

test("lahe library answer refuses a second answer and prints the first", async () => {
  const w = answerWorld();
  assert.equal((await run(answerArgs(w, w.request.id))).code, protocol.CLI_EXIT.OK);
  const again = answerArgs(w, w.request.id);
  again[again.indexOf("watching it")] = "second thoughts";
  const out = await run(again);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(out.stderr, /already answered/);
  assert.match(out.stderr, /done: watching it/);
});

test("lahe library answer takes ANSWER_TEXT_MAX characters and refuses one more", async () => {
  const w = answerWorld();
  const long = answerArgs(w, w.request.id);
  long[long.indexOf("watching it")] = "x".repeat(C.ANSWER_TEXT_MAX + 1);
  const over = await run(long);
  assert.equal(over.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(over.stderr, new RegExp("at most " + C.ANSWER_TEXT_MAX + " characters"));
  long[long.indexOf("x".repeat(C.ANSWER_TEXT_MAX + 1))] = "x".repeat(C.ANSWER_TEXT_MAX);
  assert.equal((await run(long)).code, protocol.CLI_EXIT.OK);
});

test("lahe library answer needs its id, --session, --status and --text", async () => {
  const w = answerWorld();
  const cases = [
    ["answer", "--session", "s_agent", "--status", "done", "--text", "x", "--state-dir", w.dir],
    ["answer", w.request.id, "--status", "done", "--text", "x", "--state-dir", w.dir],
    ["answer", w.request.id, "--session", "s_agent", "--text", "x", "--state-dir", w.dir],
    ["answer", w.request.id, "--session", "s_agent", "--status", "maybe", "--text", "x", "--state-dir", w.dir],
    ["answer", w.request.id, "--session", "s_agent", "--status", "done", "--state-dir", w.dir]
  ];
  for (const argv of cases) {
    const out = await run(argv);
    assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE, argv.join(" "));
  }
  assert.equal(w.queue.requestFor("r_doc", Date.now()).state, "waiting");
});
