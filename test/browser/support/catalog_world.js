// A Library world built with the real CLI, for the Library's browser specs.
//
// Owner: LAHE Library, Task 3.2. Used by catalog_library.spec.js and
// catalog_cross_site.spec.js.
//
// Everything here is the CLI an agent runs, on a free port (never 7817) and a
// temporary state dir (never the real one):
//
//   - `lahe review` opens each document, in its own agent session unless the
//     spec names another doc's session
//   - `lahe session close` closes the ones the spec marks
//   - `lahe library --session` attaches the stub agent
//   - one `lahe status` drain, which the helper reads as the stub agent
//     "listening", exactly as for a real agent
//
// The stub agent's two verbs are the real `lahe status --session <id> --json
// --quiet` and the real `lahe library answer`. Nothing else.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const protocol = require("../../../src/shared/protocol.js");
const { freePort, portInUse } = require("../../helpers/free_port.js");
const { stopTempHelpers } = require("../../helpers/temp_helpers.js");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");


function labelled(output, label) {
  const match = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return match ? match[1] : null;
}

function docHtml(title, body, colorScheme) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    colorScheme ? '<meta name="color-scheme" content="' + colorScheme + '" />' : "",
    "<title>" + title + "</title>",
    "</head>",
    "<body>",
    "<main>",
    "<h1>" + title + "</h1>",
    '<p id="p">' + body + "</p>",
    '<p id="other">The second paragraph, so the page reads like a document and not a stub.</p>',
    "</main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

/**
 * Build the world.
 *
 * @param {{agentName: string,
 *          docs: Array<{key: string, folder: string, file: string, title: string,
 *                       body: string, name?: string, sessionOf?: string,
 *                       close?: boolean, colorScheme?: string}>}} spec
 *   `sessionOf` names an earlier doc's key: this one joins that doc's session.
 *   `close` closes the doc's session once every doc is reviewed.
 * @returns {Promise<object>} the world: stateDir, port, env, libraryUrl,
 *   docs[key] = {session, review, open, file}, agent, and the methods lahe,
 *   drainRequests, requestsFileText, catalogFileText, helperLog, teardown
 */
async function buildWorld(spec) {
  const w = { docs: {} };
  w.root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-library-world-"));
  w.stateDir = path.join(w.root, "state");
  w.work = path.join(w.root, "work");
  w.env = Object.assign({}, process.env, { LAHE_STATE_DIR: w.stateDir });
  delete w.env.XDG_STATE_HOME;
  w.port = await freePort();
  if (w.port === protocol.DEFAULT_PORT) throw new Error("the free port came back as the product's own port");
  w.helperOrigin = "http://127.0.0.1:" + w.port;
  let portArgs = ["--port", String(w.port)];

  w.lahe = function (args) {
    return execFileSync(process.execPath, [CLI].concat(args), {
      cwd: REPO_ROOT,
      env: w.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  };

  /** The stub agent's drain: the catalog_requests section of the real drain. */
  w.drainRequests = function () {
    const out = w.lahe(["status", "--session", w.agent.session, "--json", "--quiet"]);
    const lines = out.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    const summary = lines.filter((line) => Array.isArray(line.catalog_requests))[0];
    return summary ? summary.catalog_requests : [];
  };

  /** The stub agent's answer. */
  w.answer = function (requestId, status, text) {
    return w.lahe(["library", "answer", requestId, "--session", w.agent.session, "--status", status, "--text", text]);
  };

  function readOrAbsent(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "<absent>";
  }
  w.catalogFileText = () => readOrAbsent(path.join(w.stateDir, "catalog.json"));
  w.requestsFileText = () => readOrAbsent(path.join(w.stateDir, "catalog-requests.jsonl"));
  w.helperLog = () => readOrAbsent(path.join(w.stateDir, "helper.log"));
  w.eventsText = (review) => readOrAbsent(path.join(w.stateDir, "reviews", review, "events.jsonl"));

  /** Is this agent session closed, read from the real `lahe session list`. */
  w.sessionClosed = function (session) {
    const line = w
      .lahe(["session", "list", "--json"])
      .split("\n")
      .filter((l) => l.indexOf('"' + session + '"') !== -1)[0];
    if (!line) throw new Error("lahe session list has no " + session);
    return !!JSON.parse(line).closed_at;
  };

  const all = [
    { key: "agent", folder: "agent", file: "notes.html", title: "Stub Agent Notes", body: "The agent's own page.", name: spec.agentName }
  ].concat(spec.docs);
  for (const d of all) {
    const dir = path.join(w.work, d.folder);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, d.file);
    fs.writeFileSync(file, docHtml(d.title, d.body, d.colorScheme));
    const extra = [];
    if (d.name) extra.push("--name", d.name);
    if (d.sessionOf) extra.push("--session", w.docs[d.sessionOf].session);
    let output;
    try {
      output = w.lahe(["review", file].concat(portArgs, extra));
    } catch (err) {
      // The first review starts the helper. If another test took the free
      // port first, retry once on a new one (test/helpers/free_port.js).
      if (d !== all[0] || !(await portInUse(w.port))) throw err;
      w.port = await freePort();
      w.helperOrigin = "http://127.0.0.1:" + w.port;
      portArgs = ["--port", String(w.port)];
      output = w.lahe(["review", file].concat(portArgs, extra));
    }
    const got = { session: labelled(output, "session"), review: labelled(output, "review"), open: labelled(output, "open"), file: file };
    if (!got.session || !got.review) throw new Error("lahe review printed no session or review:\n" + output);
    w.docs[d.key] = got;
  }
  w.agent = w.docs.agent;
  for (const d of spec.docs) if (d.close) w.lahe(["session", "close", w.docs[d.key].session].concat(portArgs));

  const printed = JSON.parse(w.lahe(["library", "--session", w.agent.session, "--json"].concat(portArgs)));
  w.libraryUrl = printed.url;
  w.attachedAtStart = printed.attached;
  w.drainRequests();

  /** Every session this world opened, closed; then the helper, by its pid. Await it. */
  w.teardown = async function () {
    const seen = new Set();
    for (const key of Object.keys(w.docs)) {
      const session = w.docs[key].session;
      if (seen.has(session)) continue;
      seen.add(session);
      try {
        w.lahe(["session", "close", session].concat(portArgs));
      } catch (err) {
        // Already closed is not a failure.
      }
    }
    // The last close leaves the helper up while the Library polled recently
    // (the R10a lifetime rule this feature added), so it is stopped by the
    // pids its own state dir records, and waited for.
    await stopTempHelpers(w.stateDir);
  };

  return w;
}

module.exports = { REPO_ROOT, CLI, buildWorld, freePort };
