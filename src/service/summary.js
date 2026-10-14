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
// LIGHT WHEN IDLE (R21). The app asks every five seconds. The answer's rows
// are kept in memory and an idle poll reads no file: it stats catalog.json
// and the reply files of reviews with a ready item; what moved is rebuilt
// (see "What is kept between polls").
// When a review's part is looked at, it is keyed on the size, modified time
// and inode of its events.jsonl, review.json and meta.json, plus the reviewed
// document while it has an unread reply. Inode is in the key because a
// same-size rewrite in the same millisecond (an atomic rename) changes
// nothing else. See stateKeyOf and partOf.
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
      noteSets(reviewId, part);
      rebuilt.push(reviewId);
      delete unreadable[reviewId];
      return part;
    } catch (err) {
      forget(reviewId);
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
   * is gone (R7). A file whose worktree was removed is gone too: its address
   * shows the main checkout's copy without this review's rail, so no page can
   * read the reply, and it would wait on the reviewer forever.
   */
  function describeRow(row) {
    var lead = row.lead.info;
    var out = {
      review: lead.id,
      ids: row.parts.map(function (part) { return part.info.id; }),
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
      if (info.summary.ended || part.openable === "missing" || part.kind === "worktree") return;
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

  /** Mark the rows a browser window holds now. */
  function applyHolders(list, held) {
    list.forEach(function (r) {
      r.open = false;
      r.focused = false;
      r.ids.forEach(function (id) {
        if (!held[id]) return;
        r.open = true;
        if (held[id].focused) r.focused = true;
      });
    });
  }

  // -------------------------------------------------------------------------
  // What is kept between polls
  // -------------------------------------------------------------------------
  //
  // AN IDLE POLL READS NO FILE. It stats catalog.json, and the folder and
  // reply files of each review with an item an agent can still answer (13 of
  // 690 on Ken's state folder), and reads nothing unless a stat moved. The
  // app asks every five seconds, and on a real state folder (690 reviews, 93 sessions) a poll that
  // stat'ed every review and folded every row cost the helper about 40 ms of
  // processor time each, spaced five seconds apart, which was more than an
  // open review tab costs. So the answer's rows are kept, and a poll rebuilds
  // only what moved:
  //
  //   a review the helper  the event log tells the summary (touched), and the
  //   itself wrote to      next poll rebuilds that review alone
  //   an agent's reply     the reply files of reviews with a ready item,
  //   on a closed document stat'ed on every poll and folded when they move
  //   anything else        a beat at most once per BEAT_MS: sessions and
  //                        their agents read again, waiting documents and the cutoff file
  //                        checked, and a slice of the reviews' own files
  //                        stat'ed (all of them every FULL_PASS_BEATS beats).
  //                        A monitor heartbeat or a deleted waiting
  //                        document shows within one beat
  //   a Library rename     catalog.json, stat'ed on every poll
  //   window holders       read from the helper's own memory on every poll

  var BEAT_MS = protocol.CATALOG.POLL_MS;
  // A beat stats a slice of the reviews, in turn, so each review's own files
  // are looked at once every FULL_PASS_BEATS beats (ten minutes). While the
  // helper runs it is the single writer of every one of those files, and
  // tells the summary when it writes one; the slow look is insurance. Closed
  // sessions are looked at in the same turn. What a reviewer is waiting on
  // (an agent's reply line, a waiting document going away, an open session's
  // agent) is looked at on every beat. A stat or a loop over every review
  // costs several times on a processor woken from five seconds of idle what
  // a back-to-back benchmark shows, so a beat touches a few hundred files and
  // loops over the reviews that matter, not all of them.
  var FULL_PASS_BEATS = 40;
  var turn = 0;

  var ids = [];
  var reviewsRoot = stateDir.reviewsRoot(dir);
  var reviewsRootKey = null;
  var sessionIdList = [];
  var sessionsRoot = stateDir.agentSessionsRoot(dir);
  var sessionsRootKey = null;
  // session id -> what reader.sessionAt said at its last look.
  var sessionEntries = Object.create(null);
  var touchedIds = Object.create(null);
  var lastFullMs = null;
  var sinceMs = null;
  var catalogKey = null;
  var catalogFile = path.join(dir, "catalog.json");
  var rows = null;
  var sections = null;
  var sectionsHeldKey = null;
  var sessionNames = {};
  // The reviews with an unread reply, and the ones with an item an agent can
  // still answer: kept as parts are rebuilt, so a beat need not walk them all.
  var waitingIds = Object.create(null);
  var readyIds = Object.create(null);
  // review id -> its reply files at the last look (replySignature).
  var replyState = Object.create(null);
  // review id -> its folder, resolved once: resolving lstats the folders on
  // the way, and the reply check runs on every poll.
  var folderOf = Object.create(null);
  var foldReplies = typeof opts.foldReplies === "function" ? opts.foldReplies : null;

  function noteSets(reviewId, part) {
    if (part.unread.count > 0) waitingIds[reviewId] = true;
    else delete waitingIds[reviewId];
    if (part.info.summary.ready > 0 && !part.info.summary.ended) readyIds[reviewId] = true;
    else delete readyIds[reviewId];
  }

  function forget(reviewId) {
    delete cache[reviewId];
    delete pathsOf[reviewId];
    delete waitingIds[reviewId];
    delete readyIds[reviewId];
    delete replyState[reviewId];
    delete folderOf[reviewId];
  }

  /**
   * A folder's key, or null when it moved in the last two seconds, is not
   * there, or is not a real folder (a symlink is not followed): a coarse
   * folder clock can stamp a second new entry with the same time as the look
   * before it, so an unsettled folder is listed again.
   */
  function settledKey(folder) {
    return keyOfFolder(fs.lstatSync(folder, { throwIfNoEntry: false }));
  }

  function keyOfFolder(stat) {
    if (!stat || !stat.isDirectory() || Date.now() - stat.mtimeMs <= 2000) return null;
    return stat.size + ":" + stat.mtimeMs + ":" + stat.ino;
  }

  /** This beat's slice of a list, in turn. */
  function sliceOf(list) {
    var size = Math.ceil(list.length / FULL_PASS_BEATS);
    return list.slice(turn * size, (turn + 1) * size);
  }

  /** The helper appended to a review's log: rebuild it on the next poll. */
  function touched(reviewId) {
    touchedIds[reviewId] = true;
  }

  /**
   * Reply files the helper has not folded, on a review an agent can still
   * answer. Nothing else folds them while no page has the document open, so
   * an agent's question on a closed document would never reach the icon.
   * Checked on every poll, not only on the beat, so a question shows within
   * one poll (brief R3: 10 seconds), and only for a review with an item in
   * state ready (a reply to any other item is refused anyway): a stat of the
   * review's folder and of each reply file it holds, and nothing read unless
   * one moved. On the first look the files are folded when one is at least as
   * new as the log, which is what a reply written while no helper ran looks
   * like; a tie counts, because a file system with coarse timestamps (the
   * Linux CI runner) gives a reply written right after the log the same
   * time, and folding a reply the log already holds changes nothing. After
   * that, when their signature moves.
   */
  function foldWaitingReplies() {
    if (!foldReplies) return;
    Object.keys(readyIds).forEach(function (id) {
      var held = replyState[id];
      var sig = replySignature(id, held);
      replyState[id] = sig;
      if (!sig.key) return;
      var due = held === undefined ? sig.newestMs >= statMtime(stateDir.eventsPath(dir, id)) : held.key !== sig.key;
      if (!due) return;
      try {
        foldReplies(id);
        // Its reply.folded events come back through touched too; marked here
        // as well, so this poll rebuilds it whatever log the fold wrote with.
        touched(id);
      } catch (err) {
        log("summary: could not fold the replies of review " + id + ": " + err.message);
      }
    });
  }

  /**
   * {folderKey, names, key, newestMs} over a review's reply files. The
   * folder is listed again only when it moved (a new reply file is a new
   * entry in it); otherwise only the reply files already known are stat'ed,
   * because a line appended to one does not move the folder. A symlink or
   * anything else that is not a regular file is skipped and never followed,
   * the rule replies.discover applies: a reply-named link to a busy file
   * would otherwise fold the review on every poll.
   */
  function replySignature(reviewId, held) {
    var folder = folderOf[reviewId] || (folderOf[reviewId] = stateDir.reviewDir(dir, reviewId));
    var folderStat = fs.lstatSync(folder, { throwIfNoEntry: false });
    // A review folder swapped for a link is not listed through it.
    if (folderStat && !folderStat.isDirectory()) return { folderKey: null, names: [], key: "", newestMs: 0 };
    var folderKey = keyOfFolder(folderStat);
    var names = folderKey && held && held.folderKey === folderKey ? held.names : null;
    if (!names) {
      try {
        names = fs.readdirSync(folder).filter(function (name) { return protocol.REPLY_FILE.PATTERN.test(name); });
      } catch (err) {
        names = [];
      }
    }
    var key = [];
    var newestMs = 0;
    names.forEach(function (name) {
      var stat = fs.lstatSync(path.join(folder, name), { throwIfNoEntry: false });
      if (!stat || !stat.isFile()) return;
      key.push(name + ":" + stat.size + ":" + stat.mtimeMs + ":" + stat.ino);
      if (stat.mtimeMs > newestMs) newestMs = stat.mtimeMs;
    });
    return { folderKey: folderKey, names: names, key: key.join("|"), newestMs: newestMs };
  }

  function statMtime(file) {
    var stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return stat && stat.isFile() ? stat.mtimeMs : 0;
  }

  /**
   * The beat's look at sessions: the list again when its folder moved, every
   * open session someone watches (that agent's liveness moves with the
   * clock), every open session whose folder moved, and this turn's slice of
   * the rest.
   */
  function lookAtSessions(first, nowMs) {
    var key = settledKey(sessionsRoot);
    if (first || key === null || key !== sessionsRootKey) sessionIdList = reader.sessionIds();
    sessionsRootKey = key;
    var listed = Object.create(null);
    var slice = Object.create(null);
    sessionIdList.forEach(function (id) { listed[id] = true; });
    sliceOf(sessionIdList).forEach(function (id) { slice[id] = true; });
    Object.keys(sessionEntries).forEach(function (id) {
      if (!listed[id]) delete sessionEntries[id];
    });
    sessionIdList.forEach(function (id) {
      var held = sessionEntries[id];
      // A closed session waits for its turn. An open one nobody watches stays
      // as it was until something is written into its folder: only a
      // heartbeat or a command makes an agent listening or working.
      if (!first && held && !slice[id] && (held.closed || (held.settled && reader.sessionKey(id) === held.key))) return;
      sessionEntries[id] = reader.sessionAt(id, nowMs);
    });
  }

  /** The beat's look at the list of reviews: again only when its folder moved. */
  function lookAtReviewList(first) {
    var key = settledKey(reviewsRoot);
    if (first || key === null || key !== reviewsRootKey) ids = reader.reviewIds();
    reviewsRootKey = key;
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
    var rebuilt = [];
    var first = rows === null;
    var full = first || nowMs - lastFullMs >= BEAT_MS || nowMs < lastFullMs;
    var changed = first;
    var written = Object.keys(touchedIds);
    touchedIds = Object.create(null);
    var looking;
    if (full) {
      var seeded = seededAt(nowMs);
      if (seeded !== sinceMs) changed = true;
      sinceMs = seeded;
      lookAtReviewList(first);
      lookAtSessions(first, nowMs);
      lastFullMs = nowMs;
      // Every review on the first poll; then this turn's slice, every review
      // with an unread reply, and the ones the helper wrote to.
      looking = first ? ids : written.concat(sliceOf(ids), Object.keys(waitingIds));
      turn = (turn + 1) % FULL_PASS_BEATS;
    } else {
      looking = written;
    }
    var known = Object.create(null);
    ids.forEach(function (id) { known[id] = true; });
    written.forEach(function (id) {
      if (!known[id]) {
        ids.push(id);
        known[id] = true;
      }
    });
    looking.forEach(function (id) {
      var had = cache[id] !== undefined;
      // A review that could not be read leaves the rows if it was in them.
      if (!partOf(id, sinceMs, rebuilt) && had) changed = true;
    });
    if (full) {
      Object.keys(cache).forEach(function (id) {
        if (known[id]) return;
        forget(id);
        changed = true;
      });
    }
    // Every poll: the reply files of reviews an agent can still answer.
    // Folding writes reply.folded events, which come back through touched;
    // those reviews are rebuilt here, in this same poll.
    foldWaitingReplies();
    Object.keys(touchedIds).forEach(function (id) {
      partOf(id, sinceMs, rebuilt);
    });
    touchedIds = Object.create(null);
    if (rebuilt.length) changed = true;
    lastRebuilt = rebuilt;

    var catalogNow = statKey(catalogFile);
    if (catalogNow !== catalogKey) changed = true;
    catalogKey = catalogNow;

    if (changed) {
      var parts = [];
      ids.forEach(function (id) {
        var hit = cache[id];
        // A retired review answers on no page: it is in no section at all.
        if (hit && !hit.part.info.retired) parts.push(hit.part);
      });
      var folded = reader.foldParts(parts);
      sessionNames = folded.sessionNames;
      rows = [];
      folded.sessions.forEach(function (s) {
        s.rows.forEach(function (row) {
          rows.push(describeRow(row));
        });
      });
      rows.sort(newestFirst);
    }
    // The sections are kept too, and built again only when the rows, the
    // sessions (a beat) or the window holders moved. An idle poll answers the
    // kept sections under a new generated_at.
    var held = holders();
    var heldKey = Object.keys(held).sort().map(function (id) { return id + (held[id].focused ? "+" : "-"); }).join(",");
    if (changed || full || heldKey !== sectionsHeldKey || sections === null) {
      applyHolders(rows, held);
      sections = {
        waiting_on_you: waitingOnYou(rows),
        waiting_on_agents: waitingOnAgents(rows),
        open_documents: openDocuments(rows),
        sessions: sessionsSection(rows, sessionNames, nowMs),
        recent: recent(rows)
      };
      sectionsHeldKey = heldKey;
    }

    return {
      summary_version: SUMMARY_VERSION,
      generated_at: iso(nowMs),
      helper: { version: opts.version, started_at: opts.startedAt, always_on: opts.alwaysOn === true },
      waiting_on_you: sections.waiting_on_you,
      waiting_on_agents: sections.waiting_on_agents,
      open_documents: sections.open_documents,
      sessions: sections.sessions,
      recent: sections.recent,
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
    var open = sessionIdList
      .map(function (id) { return sessionEntries[id]; })
      .filter(function (s) { return !!s && !s.closed; });
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
    touched: touched,
    /** Beats until every review's own files have been looked at again. */
    FULL_PASS_BEATS: FULL_PASS_BEATS,
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
