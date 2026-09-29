// The catalog store: the only code that reads or writes <state>/catalog.json.
//
// Owner: LAHE Library 1.1 (docs/features/20260922.02_lahe_library, architecture
// "Files"). The file holds two things the helper remembers across restarts:
//
//   { "schema": 1,
//     "stars":    { "<review-id>": "<when it was starred>" },
//     "reopened": { "<session-id>": { "at": "<when>", "handoff_rev": <n> } },
//     "names":    { "<review-id>": "<the reviewer's own name for it>" } }
//
// `names` came later; a file without it reads as no names. A name is the
// reviewer's display text for the Library only. It is never put in a drain
// entry, a hand-off message, or anything an agent reads.
//
// ONE WRITER. Only the helper writes this file, through this module, with the
// state dir's write-beside-and-rename. The CLI's attach record lives in its own
// file (catalog-attach.json) so a star and an attach can never overwrite each
// other.
//
// A CORRUPT FILE IS NEVER OVERWRITTEN. If the bytes on disk do not parse into
// the shape above, read() says so and every write is refused with
// PROTO_CATALOG_UNREADABLE. Rewriting it from empty would silently throw away
// every star Ken has made; leaving it lets him (or an agent) look at it.
//
// Node-only.

"use strict";

var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var agentSessions = require("./agent_sessions.js");
var stateDir = require("./state_dir.js");

var SCHEMA = 1;
var FILE = "catalog.json";
var UNREADABLE = "PROTO_CATALOG_UNREADABLE";
// The longest name a rename keeps, in characters: the session name's cap.
var NAME_MAX = 80;

function catalogPath(dir) {
  return stateDir.resolveWithin(dir, [FILE]);
}

function empty() {
  return { schema: SCHEMA, stars: {}, reopened: {}, names: {} };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The parsed file, or null when its shape is not the one this module writes. */
function validate(parsed) {
  if (!isPlainObject(parsed) || parsed.schema !== SCHEMA) return null;
  if (!isPlainObject(parsed.stars) || !isPlainObject(parsed.reopened)) return null;
  if (parsed.names !== undefined && !isPlainObject(parsed.names)) return null;
  return {
    schema: SCHEMA,
    stars: Object.assign({}, parsed.stars),
    reopened: Object.assign({}, parsed.reopened),
    names: Object.assign({}, parsed.names || {})
  };
}

function assertSafe(kind, id) {
  if (!protocol.isSafeId(id)) throw new Error("catalog store: refusing an unsafe " + kind + " id " + JSON.stringify(id));
  return id;
}

/**
 * @param {{dir: string, readFile?: function}} options
 *   `readFile` defaults to fs.readFileSync; the reader's tests pass a counting one.
 */
function createCatalogStore(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("catalog_store.createCatalogStore: dir is required");
  var dir = opts.dir;
  var readFile = typeof opts.readFile === "function" ? opts.readFile : fs.readFileSync;

  /**
   * @returns {{ok: true, data: object} | {ok: false, code: string, error: string}}
   */
  function read() {
    var text;
    try {
      // Inside the try: a symlinked catalog.json is refused by the path rules,
      // and for a reader that is one more way of being unreadable.
      text = readFile(catalogPath(dir), "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return { ok: true, data: empty() };
      return { ok: false, code: UNREADABLE, error: err.message };
    }
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, code: UNREADABLE, error: "not JSON: " + err.message };
    }
    var data = validate(parsed);
    if (!data) return { ok: false, code: UNREADABLE, error: "not the catalog.json shape (schema " + SCHEMA + ")" };
    return { ok: true, data: data };
  }

  /** Read, change, write whole. A corrupt file is left exactly as it is. */
  function update(change) {
    var current = read();
    if (!current.ok) return current;
    var data = current.data;
    change(data);
    stateDir.ensureDir(dir);
    stateDir.writeAtomic(catalogPath(dir), JSON.stringify(data, null, 2) + "\n");
    return { ok: true, data: data };
  }

  function setStar(reviewId, starred, at) {
    assertSafe("review", reviewId);
    return update(function (data) {
      if (starred) data.stars[reviewId] = String(at);
      else delete data.stars[reviewId];
    });
  }

  /**
   * Set the reviewer's name for a review, or clear it with an empty one.
   * Control and invisible characters are dropped and it is cut to NAME_MAX,
   * by the same rule session names use. Returns the name kept, or null.
   */
  function setName(reviewId, name) {
    assertSafe("review", reviewId);
    var clean = agentSessions.cleanName(name);
    if (clean && Array.from(clean).length > NAME_MAX) clean = Array.from(clean).slice(0, NAME_MAX).join("").trim();
    var out = update(function (data) {
      if (clean) data.names[reviewId] = clean;
      else delete data.names[reviewId];
    });
    if (out.ok) out.name = clean || null;
    return out;
  }

  function setReopened(sessionId, entry) {
    assertSafe("session", sessionId);
    var e = entry || {};
    return update(function (data) {
      data.reopened[sessionId] = {
        at: String(e.at),
        handoff_rev: Number.isInteger(e.handoff_rev) && e.handoff_rev >= 0 ? e.handoff_rev : 0
      };
    });
  }

  function clearReopened(sessionId) {
    assertSafe("session", sessionId);
    return update(function (data) {
      delete data.reopened[sessionId];
    });
  }

  return {
    read: read,
    setStar: setStar,
    setName: setName,
    setReopened: setReopened,
    clearReopened: clearReopened
  };
}

module.exports = {
  SCHEMA: SCHEMA,
  FILE: FILE,
  NAME_MAX: NAME_MAX,
  catalogPath: catalogPath,
  createCatalogStore: createCatalogStore
};
