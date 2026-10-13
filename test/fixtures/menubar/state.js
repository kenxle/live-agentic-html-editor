// A made-up state folder for the menu bar summary's tests.
//
// Everything is written through the helper's own modules (the event log, the
// projection, the session store), so a review here has the same files a real
// one has: meta.json, events.jsonl and a review.json regenerated from the log.
// Every folder is under the OS temp folder; nothing touches the real state
// folder or port 7817, and nothing here starts a process.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var protocol = require("../../../src/shared/protocol.js");
var record = require("../../../src/shared/record.js");
var stateDir = require("../../../src/service/state_dir.js");
var logModule = require("../../../src/service/log.js");
var projection = require("../../../src/service/projection.js");
var agentSessions = require("../../../src/service/agent_sessions.js");
var catalogReader = require("../../../src/service/catalog_reader.js");

// Comment text in this fixture carries this; nothing in a summary may.
var MARKER = "MARKER-menubar-comment-text-never-in-the-summary";

var counter = 0;
function nextId(prefix) {
  counter += 1;
  return prefix + "_" + counter;
}

/**
 * A fresh state folder and home folder.
 *
 * @returns {object} with dir, home, log and the builders below
 */
function createState() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-menubar-state-"));
  var home = path.join(root, "home");
  var dir = path.join(root, "state");
  fs.mkdirSync(home, { recursive: true });
  stateDir.ensureDir(dir);
  // Every append is told to whoever listens, the way the helper tells its
  // summary which review it wrote to (src/service/index.js).
  var listeners = [];
  var log = logModule.createEventLog({
    dir: dir,
    onAppend: function (reviewId) {
      listeners.forEach(function (fn) { fn(reviewId); });
    }
  });
  var clock = { iso: null };
  var sessions = agentSessions.createStore({
    dir: dir,
    now: function () { return clock.iso || new Date().toISOString(); }
  });

  /** A document under the made-up home folder, with a title line. */
  function doc(rel, title) {
    var file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# " + (title || path.basename(rel)) + "\n\nBody.\n");
    return file;
  }

  /**
   * A review of `docRel`, owned by `session`. Its first item names the page
   * title, which is what the Library titles a row by.
   */
  function review(id, spec) {
    var s = spec || {};
    var file = s.file || doc(s.doc || id + ".md", s.title);
    stateDir.ensureReviewDir(dir, id);
    var meta = {
      id: id,
      token: "tok_" + id,
      origins: [],
      target_path: file,
      target_paths: [file],
      source_path: null,
      agent_session_id: s.session || "legacy",
      only_recorded_pages: false,
      notes: false,
      created_at: s.created_at || "2026-10-20T08:00:00.000Z"
    };
    if (s.retired_at) meta.retired_at = s.retired_at;
    stateDir.writeAtomic(stateDir.metaPath(dir, id), JSON.stringify(meta, null, 2) + "\n");
    log.append(id, [
      protocol.newEvent({
        event: protocol.EVENT.REVIEW_CREATED,
        event_id: nextId("evt_created"),
        review: id,
        ts: meta.created_at,
        payload: { token: meta.token, agent_session_id: meta.agent_session_id }
      })
    ]);
    regenerate(id);
    return { id: id, file: file, title: s.title || null };
  }

  /** A ready comment on a review's page. */
  function item(reviewId, spec) {
    var s = spec || {};
    var it = record.newItem({
      id: s.id || nextId("itm"),
      kind: record.KIND.COMMENT,
      state: record.STATE.READY,
      note: (s.note || "a comment") + " " + MARKER,
      page_origin: "http://127.0.0.1:4321",
      page_path: s.page_path || "/" + reviewId + ".html",
      page_title: s.page_title || null,
      page_seq: 1
    });
    if (s.rev) it.rev = s.rev;
    log.append(reviewId, [
      protocol.newEvent({
        event: protocol.EVENT.ITEM_READY,
        event_id: nextId("evt_item"),
        review: reviewId,
        item: it.id,
        rev: it.rev,
        page_path: it.page_path,
        page_title: it.page_title,
        page_seq: 1,
        ts: s.ts,
        payload: { draft: false, record: it }
      })
    ]);
    regenerate(reviewId);
    return it;
  }

  /**
   * An agent's reply folded onto an item, at `ts`. The state follows the
   * status the way the folder sets it.
   */
  function reply(reviewId, it, spec) {
    var s = spec || {};
    var status = s.status || "question";
    var state = status === "handled" ? record.STATE.HANDLED : status === "not_handled" ? record.STATE.NOT_HANDLED : record.STATE.READY;
    log.append(reviewId, [
      protocol.newEvent({
        event: protocol.EVENT.REPLY_FOLDED,
        event_id: nextId("evt_fold"),
        review: reviewId,
        item: it.id,
        rev: s.rev || it.rev,
        ts: s.ts,
        payload: {
          accepted: true,
          state: state,
          file: "replies-claude.jsonl",
          reply: {
            status: status,
            agent: "claude",
            text: s.text === undefined ? "a reply " + MARKER : s.text,
            reason: status === "not_handled" ? "no such file " + MARKER : null,
            files: [],
            user_needs_to_see_reply: s.flagged === true
          }
        }
      })
    ]);
    regenerate(reviewId);
  }

  /** The current projected record of an item. */
  function current(reviewId, itemId) {
    return projection.itemsFrom(log.read(reviewId)).find(function (it) { return it.id === itemId; }) || null;
  }

  /** The rail opened the card: a reply.seen naming the item's current reply. */
  function seen(reviewId, itemId) {
    var stamp = record.replyStamp(current(reviewId, itemId));
    log.append(reviewId, [
      protocol.newEvent({ event: protocol.EVENT.REPLY_SEEN, event_id: nextId("evt_seen"), review: reviewId, item: itemId, payload: { stamp: stamp } })
    ]);
    regenerate(reviewId);
  }

  /** Any other event, appended as given. */
  function append(reviewId, type, fields) {
    log.append(reviewId, [protocol.newEvent(Object.assign({ event: type, event_id: nextId("evt"), review: reviewId }, fields || {}))]);
    regenerate(reviewId);
  }

  function regenerate(reviewId) {
    projection.regenerate({ dir: dir, log: log, review: reviewId });
  }

  /** The day-one cutoff, as the first summary.read would have written it. */
  function seed(ms) {
    stateDir.writeAtomic(path.join(dir, "summary.json"), JSON.stringify({ version: 1, seeded_at: new Date(ms).toISOString() }) + "\n");
  }

  /** catalog.json: Library renames of rows and sessions. */
  function catalog(spec) {
    var s = spec || {};
    stateDir.writeAtomic(path.join(dir, "catalog.json"), JSON.stringify({
      schema: 1,
      stars: {},
      names: s.names || {},
      session_names: s.session_names || {}
    }, null, 2) + "\n");
  }

  /** A reader over this folder, with every monitor pid alive. */
  function reader() {
    return catalogReader.createReader({ dir: dir, home: home, pidAlive: function () { return true; } });
  }

  return {
    root: root,
    dir: dir,
    home: home,
    log: log,
    sessions: sessions,
    clock: clock,
    doc: doc,
    review: review,
    item: item,
    reply: reply,
    current: current,
    seen: seen,
    append: append,
    seed: seed,
    catalog: catalog,
    reader: reader,
    listen: function (fn) { listeners.push(fn); }
  };
}

/** The window holders the summary reads, from a plain map: id -> {quiet}. */
function holders(map) {
  var held = map || {};
  return {
    openWindowReviews: function () { return Object.keys(held); },
    holderOf: function (id) { return held[id] ? { window_id: "w_" + id, since: null, stale: false, quiet: held[id].quiet === true } : null; }
  };
}

module.exports = { createState: createState, holders: holders, MARKER: MARKER };
