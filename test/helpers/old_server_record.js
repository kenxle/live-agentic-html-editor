// What an old review had: the record of the page server that served its
// folder, in <state>/agent-sessions/<session>/static-servers/. Page servers
// are retired, so no test starts one; the record is what is left of one, and
// the Library reads it as evidence that a root was served (catalog_sites.js).
// The CLI wrote these, never a page, so the Library trusts them.
//
// Nothing here starts a process.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const stateDirModule = require("../../src/service/state_dir.js");
const staticServers = require("../../src/service/static_servers.js");

/**
 * @param {string} dir the state folder
 * @param {string} sessionId
 * @param {string} root the folder the old server served (a real path)
 * @param {{mounts?: object, id?: string, stopped?: boolean, port?: number}} [options]
 * @returns {string} the record's file
 */
function writeOldServerRecord(dir, sessionId, root, options) {
  const opts = options || {};
  const recordDir = stateDirModule.staticServersRoot(dir, sessionId);
  fs.mkdirSync(recordDir, { recursive: true });
  const id = opts.id || "ss_" + path.basename(root).replace(/[^A-Za-z0-9]/g, "");
  const file = path.join(recordDir, id + ".json");
  fs.writeFileSync(file, JSON.stringify({
    schema: staticServers.SCHEMA,
    id,
    session_id: sessionId,
    root,
    port: typeof opts.port === "number" ? opts.port : 1,
    host: "127.0.0.1",
    started_at: "2026-10-01T00:00:00.000Z",
    stopped_at: opts.stopped === false ? null : "2026-10-02T00:00:00.000Z",
    mounts: opts.mounts || {}
  }));
  return file;
}

module.exports = { writeOldServerRecord };
