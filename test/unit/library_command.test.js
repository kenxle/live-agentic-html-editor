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
  assert.deepEqual(Object.keys(printed).sort(), ["attached", "helper_started", "session", "session_created", "url"]);
  assert.equal(printed.session, "s_agent");
  assert.equal(printed.session_created, false);
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

// ---------------------------------------------------------------------------
// lahe library with no --session: mint or reuse an agent session
// ---------------------------------------------------------------------------

function sessionIds(dir) {
  return agentSessions.createStore({ dir }).list().map((session) => session.id);
}

function reviewCount(dir) {
  const root = stateDir.reviewsRoot(dir);
  return fs.existsSync(root) ? fs.readdirSync(root).length : 0;
}

test("lahe library with nobody attached mints a session with no reviews, attaches it, and prints its commands", async (t) => {
  const dir = tempDir();
  const port = await freePort();
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });

  const out = await run(["--name", "library bot", "--state-dir", dir, "--port", String(port)]);
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  const ids = sessionIds(dir);
  assert.equal(ids.length, 1, "exactly one session was made");
  const id = ids[0];
  const session = agentSessions.createStore({ dir }).requireOpen(id);
  assert.equal(session.name, "library bot");
  assert.equal(reviewCount(dir), 0, "the session is not a review");
  assert.equal(JSON.parse(fs.readFileSync(stateDir.catalogAttachPath(dir), "utf8")).session, id);
  assert.ok(fs.existsSync(stateDir.wakeLogPath(dir, id)), "the wake feed exists before its path is printed");

  assert.match(out.stdout, new RegExp("session\\s+" + id + "\\s+\\(started for this agent\\)"));
  assert.match(out.stdout, new RegExp("Library\\s+http://127\\.0\\.0\\.1:" + port + "/catalog"));
  assert.match(out.stdout, /attached\s+library bot \(/);
  assert.ok(out.stdout.includes(agentSessions.commandBlock({ dir, session: id })), "the same block lahe review prints");
  assert.ok(out.stdout.includes(protocol.monitorCommand(id, stateDir.flagFor(dir))));
  assert.ok(out.stdout.includes(protocol.drainCommand(id, stateDir.flagFor(dir))));
  assert.ok(out.stdout.includes("lahe session close " + id));
});

test("lahe library run again reuses the attached open session instead of minting another", async (t) => {
  const dir = tempDir();
  const port = await freePort();
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });

  const first = JSON.parse((await run(["--state-dir", dir, "--port", String(port), "--json"])).stdout.trim());
  assert.equal(first.session_created, true);
  assert.equal(first.attached.session, first.session);

  const again = await run(["--name", "someone else", "--state-dir", dir, "--port", String(port)]);
  assert.equal(again.code, protocol.CLI_EXIT.OK, again.stderr);
  assert.deepEqual(sessionIds(dir), [first.session], "no second session");
  assert.match(again.stdout, new RegExp("session\\s+" + first.session + "\\s+\\(reused: the Library's attached session"));
  assert.match(again.stdout, /--new-session/);
  assert.ok(again.stdout.includes(agentSessions.commandBlock({ dir, session: first.session })));
  // A reused session may be another agent's, so its name is not this call's to change.
  assert.equal(agentSessions.createStore({ dir }).read(first.session).name, undefined);
  assert.match(again.stderr, /--name was not applied/);

  const json = JSON.parse((await run(["--state-dir", dir, "--port", String(port), "--json"])).stdout.trim());
  assert.equal(json.session, first.session);
  assert.equal(json.session_created, false);
});

test("lahe library mints a new session when the attached one is closed", async (t) => {
  const dir = tempDir();
  const port = await freePort();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_old" });
  store.create({ id: "s_keepalive" });
  catalogRequests.writeAttach(dir, "s_old", Date.now());
  store.close("s_old");
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });

  const json = JSON.parse((await run(["--state-dir", dir, "--port", String(port), "--json"])).stdout.trim());
  assert.equal(json.session_created, true);
  assert.notEqual(json.session, "s_old");
  assert.equal(json.attached.session, json.session);
  assert.equal(sessionIds(dir).length, 3);
});

test("lahe library --new-session mints and attaches even when an open session is attached", async (t) => {
  const dir = tempDir();
  const port = await freePort();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_first" });
  catalogRequests.writeAttach(dir, "s_first", Date.now());
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });

  const out = await run(["--new-session", "--name", "second agent", "--state-dir", dir, "--port", String(port), "--json"]);
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  const json = JSON.parse(out.stdout.trim());
  assert.equal(json.session_created, true);
  assert.notEqual(json.session, "s_first");
  assert.equal(json.attached.session, json.session);
  assert.equal(json.attached.name, "second agent");
});

test("lahe library --session with --name names that session; --new-session with --session is bad usage", async (t) => {
  const dir = tempDir();
  const port = await freePort();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_agent" });
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });

  const both = await run(["--session", "s_agent", "--new-session", "--state-dir", dir, "--port", String(port)]);
  assert.equal(both.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.equal(fs.existsSync(stateDir.catalogAttachPath(dir)), false);
  assert.equal((await run(["--name", "--state-dir", dir])).code, protocol.CLI_EXIT.BAD_USAGE);

  const named = await run(["--session", "s_agent", "--name", "doc agent", "--state-dir", dir, "--port", String(port)]);
  assert.equal(named.code, protocol.CLI_EXIT.OK, named.stderr);
  assert.equal(store.read("s_agent").name, "doc agent");
  assert.deepEqual(sessionIds(dir), ["s_agent"]);
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
