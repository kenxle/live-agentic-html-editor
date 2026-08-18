// Durable routing ownership for independent top-level agent workstreams.
// One machine may have many sessions and one shared helper, but one review has
// exactly one immutable agent-session owner. Stewardship of that whole session
// may move explicitly between top-level agents through a handoff revision.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");

var SCHEMA = 1;
var LEGACY_ID = "legacy";

function mintId() {
  return "s_" + crypto.randomBytes(8).toString("hex");
}

function handoffRev(session) {
  return session && Number.isInteger(session.handoff_rev) && session.handoff_rev >= 0
    ? session.handoff_rev
    : 0;
}

function createStore(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("agent_sessions.createStore: dir is required");
  var dir = opts.dir;
  var now = typeof opts.now === "function" ? opts.now : function () { return new Date().toISOString(); };

  function read(id) {
    if (id === LEGACY_ID) return { schema: SCHEMA, id: LEGACY_ID, created_at: null, closed_at: null, synthetic: true };
    if (!protocol.isSafeId(id)) throw new Error("invalid agent session id " + JSON.stringify(id));
    var file = stateDir.agentSessionPath(dir, id);
    if (!fs.existsSync(file)) return null;
    var parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      throw new Error("agent session " + id + " has unreadable session.json: " + err.message);
    }
    if (!parsed || parsed.schema !== SCHEMA || parsed.id !== id) {
      throw new Error("agent session " + id + " has invalid session.json");
    }
    return parsed;
  }

  function write(session) {
    stateDir.ensureAgentSessionDir(dir, session.id);
    stateDir.writeAtomic(stateDir.agentSessionPath(dir, session.id), JSON.stringify(session, null, 2) + "\n");
    return session;
  }

  function create(input) {
    var spec = input || {};
    var id = spec.id || mintId();
    if (id === LEGACY_ID || !protocol.isSafeId(id)) throw new Error("invalid agent session id " + JSON.stringify(id));
    var existing = read(id);
    if (existing) return existing;
    return write({ schema: SCHEMA, id: id, created_at: now(), closed_at: null, handoff_rev: 0 });
  }

  function list() {
    var root = stateDir.agentSessionsRoot(dir);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(function (entry) { return entry.isDirectory() && protocol.isSafeId(entry.name); })
      .map(function (entry) { return read(entry.name); })
      .sort(function (a, b) { return a.id.localeCompare(b.id); });
  }

  function requireOpen(id) {
    var session = read(id);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(id));
    if (session.closed_at) throw new Error("agent session " + id + " is closed; run `lahe session reopen " + id + "`");
    return session;
  }

  function close(id) {
    var session = read(id);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(id));
    if (!session.closed_at) {
      session.closed_at = now();
      write(session);
    }
    return session;
  }

  function reopen(id) {
    var session = read(id);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(id));
    if (session.closed_at) {
      session.closed_at = null;
      write(session);
    }
    return session;
  }

  function takeover(id) {
    var session = read(id);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(id));
    session.closed_at = null;
    session.handoff_rev = handoffRev(session) + 1;
    session.taken_over_at = now();
    return write(session);
  }

  function openSessions() {
    return list().filter(function (session) { return !session.closed_at; });
  }

  return {
    create: create,
    read: read,
    list: list,
    requireOpen: requireOpen,
    close: close,
    reopen: reopen,
    takeover: takeover,
    handoffRev: handoffRev,
    openSessions: openSessions
  };
}

module.exports = {
  SCHEMA: SCHEMA,
  LEGACY_ID: LEGACY_ID,
  mintId: mintId,
  handoffRev: handoffRev,
  createStore: createStore
};
