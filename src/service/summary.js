// The menu bar's summary: the `summary.read` answer.
//
// Owner: menu-bar summary (docs/features/20261012.01_menu_bar_app, plan Step 1;
// the answer's shape is docs/CONTRACTS.md, "The summary routes and the
// signed-request wire"). Plain helper code that runs on every system: only the
// app that reads it is Mac code.
//
// WHAT IT ANSWERS, AND FROM WHERE
//
//   waiting on you    documents with a reply the reviewer has not read, by the
//                     rail's own rule (record.isUnreadReply), counting only
//                     replies after the day-one cutoff in summary.json
//   waiting on agents the Library's waiting counts
//   open documents    reviews whose window holder is current (reviews.js)
//   sessions          agent sessions not closed, and the ones whose agent the
//                     Library calls listening or working
//   recent            the Library's rows, newest first
//
// Every document is a Library row: reviews are folded with the Library's own
// rule (catalog_reader.foldParts), so a document reviewed twice counts once.
//
// LIGHT WHEN IDLE (R21). The app asks every five seconds. Each review's part is
// cached on the size, modified time and inode of its events.jsonl, review.json
// and meta.json, plus the reviewed document while it has an unread reply, so
// an idle request is three stat calls per review and one read of
// catalog.json, which is where a Library rename lives. Inode is in the key
// because a same-size rewrite in the same millisecond (an atomic rename)
// changes nothing else. See stateKeyOf and partOf.
//
// NEVER IN THE ANSWER: comment text, a token, a session secret, or an absolute
// path. Titles and path hints go through catalog_reader.menuText.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");
var catalogReader = require("./catalog_reader.js");

// The answer's version. The app sends the one it was built for; a mismatch is
// a signed 409 (routes.js).
var SUMMARY_VERSION = protocol.SUMMARY_VERSION;

// The day-one cutoff, helper-only writer: {version, seeded_at}.
var SUMMARY_FILE = "summary.json";

// Every list but waiting on you shows this many items and counts the rest.
var LIST_MAX = 8;

var TITLE_MAX = catalogReader.MENU_TITLE_MAX;
var PATH_HINT_MAX = catalogReader.MENU_PATH_HINT_MAX;

function iso(ms) {
  return new Date(ms).toISOString();
}

/** size:mtime:inode, or "-" for a file that is not there. */
function statKey(file) {
  if (typeof file !== "string" || !file) return "-";
  var stat;
  try {
    stat = fs.statSync(file, { throwIfNoEntry: false });
  } catch (err) {
    stat = null;
  }
  return stat ? stat.size + ":" + stat.mtimeMs + ":" + stat.ino : "-";
}

/** At most LIST_MAX items, and how many more there are. */
function capped(list) {
  return { items: list.slice(0, LIST_MAX), more: Math.max(0, list.length - LIST_MAX) };
}

function newestFirst(a, b) {
  if (a.lastMs !== b.lastMs) return b.lastMs - a.lastMs;
  return a.review < b.review ? 1 : -1;
}

/**
 * @param {{dir: string, reader: object, reviews: object, now?: function(): number,
 *          version: string, startedAt: string, alwaysOn?: boolean,
 *          libraryUrl: function(): string, log?: function(string)}} options
 *   `reader` is the helper's catalog_reader.createReader. `reviews` is the
 *   helper's registry, for its window holders (openWindowReviews, holderOf).
 */
function createSummary(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("summary.createSummary: dir is required");
  if (!opts.reader) throw new Error("summary.createSummary: reader is required");
  if (!opts.reviews) throw new Error("summary.createSummary: reviews is required");
  // Strings the app decodes as strings: never null in the answer.
  if (typeof opts.version !== "string" || typeof opts.startedAt !== "string") {
    throw new Error("summary.createSummary: version and startedAt are required strings");
  }
  if (typeof opts.libraryUrl !== "function") throw new Error("summary.createSummary: libraryUrl is required");
  var dir = opts.dir;
  var reader = opts.reader;
  var reviews = opts.reviews;
  var now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
  var libraryUrl = opts.libraryUrl;
  var log = typeof opts.log === "function" ? opts.log : function () {};
  // review id -> true while it cannot be read, so the log says so once.
  var unreadable = Object.create(null);

  // review id -> {stateKey, docKey, part}
  var cache = Object.create(null);
  // The reviews the last answer had to rebuild, for the cache's own test.
  var lastRebuilt = [];

  // -------------------------------------------------------------------------
  // The day-one cutoff
  // -------------------------------------------------------------------------

  /**
   * `seeded_at` in ms, written on the first summary.read rather than at helper
   * start: seeding at start would count every reply between this code landing
   * and the app being installed. A missing or unreadable file starts fresh at
   * `nowMs`, which can only make the count smaller.
   */
  function seededAt(nowMs) {
    var file = path.join(dir, SUMMARY_FILE);
    try {
      var held = JSON.parse(fs.readFileSync(file, "utf8"));
      var ms = held && held.version === SUMMARY_VERSION && typeof held.seeded_at === "string" ? Date.parse(held.seeded_at) : NaN;
      if (!Number.isNaN(ms)) return ms;
    } catch (err) {
      // Missing or corrupt: seeded fresh below.
    }
    stateDir.writeAtomic(file, JSON.stringify({ version: SUMMARY_VERSION, seeded_at: iso(nowMs) }, null, 2) + "\n");
    return nowMs;
  }

  // -------------------------------------------------------------------------
  // One review, cached
  // -------------------------------------------------------------------------

  // review id -> the three files its key stats. Resolved once: resolving
  // checks every folder on the way for a symlink, three lstat calls a file,
  // and an idle request would otherwise spend most of its time there. Only
  // stat reads these paths; a rebuild reads the files through the reader,
  // which resolves and checks them afresh.
  var pathsOf = Object.create(null);

  /**
   * The review's own three files, each by size, modified time and inode (a
   * rename gives a new inode, so a same-size rewrite in the same millisecond
   * still moves the key), and the cutoff the part was counted with. The
   * files, not their folder: a rename into a folder changes neither its inode
   * nor, on ext4, its size, and Linux stamps its time from a coarse clock.
   */
  function stateKeyOf(reviewId, sinceMs) {
    var paths = pathsOf[reviewId];
    if (!paths) {
      paths = pathsOf[reviewId] = [
        stateDir.eventsPath(dir, reviewId),
        stateDir.reviewJsonPath(dir, reviewId),
        stateDir.metaPath(dir, reviewId)
      ];
    }
    return statKey(paths[0]) + "|" + statKey(paths[1]) + "|" + statKey(paths[2]) + "|" + sinceMs;
  }

  /**
   * The review's part, rebuilt only when its key moved. The state files are
   * stat'ed before the rebuild reads them, so a write landing during the
   * rebuild moves the key for the next request.
   *
   * THE REVIEWED DOCUMENT is stat'ed only while the review has an unread
   * reply: a deleted file must drop out of waiting on you at once (R7), and no
   * other section changes when a file goes. A changed meta.json, which is
   * where the document's path lives, moves the key on its own.
   *
   * ONE UNREADABLE REVIEW IS LEFT OUT, never the whole answer: null, and one
   * line in the helper log until it reads again.
   */
  function partOf(reviewId, sinceMs, rebuilt) {
    try {
      var hit = cache[reviewId];
      var stateKey = stateKeyOf(reviewId, sinceMs);
      if (hit && hit.stateKey === stateKey && (hit.part.unread.count === 0 || hit.docKey === statKey(hit.part.info.docPath))) {
        return hit.part;
      }
      var part = reader.reviewPart(reviewId, { since: sinceMs });
      cache[reviewId] = { stateKey: stateKey, docKey: statKey(part.info.docPath), part: part };
      rebuilt.push(reviewId);
      delete unreadable[reviewId];
      return part;
    } catch (err) {
      delete cache[reviewId];
      delete pathsOf[reviewId];
      if (!unreadable[reviewId]) {
        unreadable[reviewId] = true;
        log("summary: left out review " + reviewId + ", which could not be read: " + err.message);
      }
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------

  /** A row's path for the menu: ~ for the home folder, else just its name. */
  function hintOf(row) {
    var hint = row.docHint;
    var shownHint = typeof hint === "string" && hint.charAt(0) === "~" ? catalogReader.menuText(hint, PATH_HINT_MAX) : null;
    return shownHint || baseNameOf(row) || "";
  }

  /** The row's file (or folded folder) by name, cleaned, or null with none on record. */
  function baseNameOf(row) {
    var own = row.folder || row.lead.info.docPath;
    return own ? catalogReader.menuText(path.basename(own), TITLE_MAX) : null;
  }

  /**
   * A row's title and path as the menu shows them, cleaned once and only for
   * a row the answer lists: most rows are in no list, and an idle request
   * should not clean seven hundred titles to show eight.
   */
  function shown(r) {
    if (!r.shown) {
      // Never null: the app decodes both as strings. A title that cleans to
      // nothing falls back to the file's name, then to the review id.
      r.shown = {
        title: catalogReader.menuText(r.row.customName || r.row.displayName, TITLE_MAX) || baseNameOf(r.row) || r.review,
        path_hint: hintOf(r.row)
      };
    }
    return r.shown;
  }

  /** Whose window holds each review now: id -> {focused}. */
  function holders() {
    var out = Object.create(null);
    reviews.openWindowReviews().forEach(function (id) {
      var holder = reviews.holderOf(id);
      out[id] = { focused: !(holder && holder.quiet) };
    });
    return out;
  }

  /**
   * One Library row as the summary needs it. Unread replies count only from
   * the parts a reviewer can act on: never a review that ended, or whose file
   * is gone (R7).
   */
  function describeRow(row, held) {
    var lead = row.lead.info;
    var out = {
      review: lead.id,
      sessionId: lead.sessionId,
      row: row,
      shown: null,
      lastMs: lead.lastMs,
      waiting: 0,
      unread: 0,
      questions: 0,
      newestMs: null,
      open: false,
      focused: false
    };
    row.parts.forEach(function (part) {
      var info = part.info;
      out.waiting += info.summary.waiting;
      if (held[info.id]) {
        out.open = true;
        if (held[info.id].focused) out.focused = true;
      }
      if (info.summary.ended || part.openable === "missing") return;
      var unread = part.unread;
      out.unread += unread.count;
      out.questions += unread.questions;
      var atMs = unread.newest_at ? Date.parse(unread.newest_at) : null;
      if (atMs !== null && (out.newestMs === null || atMs > out.newestMs)) out.newestMs = atMs;
    });
    return out;
  }

  // -------------------------------------------------------------------------
  // The answer
  // -------------------------------------------------------------------------

  /**
   * The summary.read answer, exactly the fields docs/CONTRACTS.md lists.
   *
   * @returns {object}
   */
  function read() {
    var nowMs = now();
    var sinceMs = seededAt(nowMs);
    var rebuilt = [];
    var ids = reader.reviewIds();
    var present = Object.create(null);
    var parts = [];
    ids.forEach(function (id) {
      present[id] = true;
      var part = partOf(id, sinceMs, rebuilt);
      // A retired review answers on no page: it is in no section at all.
      if (part && !part.info.retired) parts.push(part);
    });
    Object.keys(cache).forEach(function (id) {
      if (present[id]) return;
      delete cache[id];
      delete pathsOf[id];
    });
    lastRebuilt = rebuilt;

    var folded = reader.foldParts(parts);
    var held = holders();
    var rows = [];
    folded.sessions.forEach(function (s) {
      s.rows.forEach(function (row) {
        rows.push(describeRow(row, held));
      });
    });
    rows.sort(newestFirst);

    return {
      summary_version: SUMMARY_VERSION,
      generated_at: iso(nowMs),
      helper: { version: opts.version, started_at: opts.startedAt, always_on: opts.alwaysOn === true },
      waiting_on_you: waitingOnYou(rows),
      waiting_on_agents: waitingOnAgents(rows),
      open_documents: openDocuments(rows),
      sessions: sessionsSection(rows, folded.sessionNames, nowMs),
      recent: recent(rows),
      library_url: String(libraryUrl())
    };
  }

  /** Never capped: every document is one click. Open documents first, then newest. */
  function waitingOnYou(rows) {
    var documents = rows
      .filter(function (r) { return r.unread > 0; })
      .sort(function (a, b) {
        if (a.open !== b.open) return a.open ? -1 : 1;
        if (a.newestMs !== b.newestMs) return (b.newestMs || 0) - (a.newestMs || 0);
        return newestFirst(a, b);
      })
      .map(function (r) {
        return {
          review: r.review,
          title: shown(r).title,
          path_hint: shown(r).path_hint,
          open: r.open,
          questions: r.questions,
          unread: r.unread,
          newest_at: r.newestMs === null ? null : iso(r.newestMs)
        };
      });
    return { count: documents.length, documents: documents };
  }

  /** The Library's own waiting total, and its documents newest first. */
  function waitingOnAgents(rows) {
    var total = 0;
    var waiting = rows.filter(function (r) {
      total += r.waiting;
      return r.waiting > 0;
    });
    var cut = capped(waiting);
    return {
      count: total,
      more: cut.more,
      documents: cut.items.map(function (r) {
        return { review: r.review, title: shown(r).title, path_hint: shown(r).path_hint, waiting: r.waiting };
      })
    };
  }

  function openDocuments(rows) {
    var open = rows.filter(function (r) { return r.open; });
    var cut = capped(open);
    return {
      count: open.length,
      more: cut.more,
      items: cut.items.map(function (r) {
        return { review: r.review, title: shown(r).title, path_hint: shown(r).path_hint, focused: r.focused };
      })
    };
  }

  /**
   * `open` counts sessions not closed. `connected` is the open ones whose agent
   * the Library calls listening or working. A session is named by its Library
   * rename, else its newest document's title, else its own name, else its id,
   * and points at its newest document, or null: a session's review is the one
   * field in the answer that may be null.
   */
  function sessionsSection(rows, sessionNames, nowMs) {
    var newestRow = Object.create(null);
    rows.forEach(function (r) {
      if (!newestRow[r.sessionId]) newestRow[r.sessionId] = r;
    });
    var all = reader.sessionsAt(nowMs);
    var open = all.filter(function (s) { return !s.closed; });
    var connected = open
      .filter(function (s) { return !!s.watching; })
      .map(function (s) {
        var row = newestRow[s.id] || null;
        var renamed = Object.prototype.hasOwnProperty.call(sessionNames || {}, s.id) ? String(sessionNames[s.id]) : null;
        return {
          session: s.id,
          name: catalogReader.menuText(renamed, TITLE_MAX) || (row && shown(row).title) || catalogReader.menuText(s.name, TITLE_MAX) || s.id,
          presence: s.watching.state,
          last_heard_at: s.watching.last_active || s.started_at || iso(nowMs),
          review: row ? row.review : null
        };
      })
      .sort(function (a, b) {
        var heard = (Date.parse(b.last_heard_at) || 0) - (Date.parse(a.last_heard_at) || 0);
        return heard !== 0 ? heard : a.session < b.session ? -1 : 1;
      });
    var cut = capped(connected);
    return { open: open.length, connected: { count: connected.length, more: cut.more, items: cut.items } };
  }

  function recent(rows) {
    var cut = capped(rows);
    return {
      more: cut.more,
      items: cut.items.map(function (r) {
        return { review: r.review, title: shown(r).title, path_hint: shown(r).path_hint, last: iso(r.lastMs) };
      })
    };
  }

  return {
    read: read,
    /** The reviews the last read had to rebuild. */
    lastRebuilt: function () { return lastRebuilt.slice(); }
  };
}

module.exports = {
  SUMMARY_VERSION: SUMMARY_VERSION,
  SUMMARY_FILE: SUMMARY_FILE,
  LIST_MAX: LIST_MAX,
  createSummary: createSummary
};
