// The draft store: browser storage, written synchronously on every change.
//
// Owner: 1B.
//
// Five things live in browser storage, all keyed by REVIEW ID and all written
// synchronously:
//
//   items    the records themselves, drafts included
//   outbox   the events that have not been acknowledged by the helper yet.
//            This is what makes "re-post anything unacknowledged" survive a
//            reload and a kill -9: a queue that lives only in a JS array is
//            gone the moment the tab is
//   chips    the failure list and the codes the reviewer dismissed, so a chip
//            survives a remount and a navigation and stays gone once dismissed
//   holder   which window holds this review, so the second window's refusal can
//            NAME the first one rather than saying "somewhere else"
//   ui       the reviewer's small rail preferences. These are best effort: a
//            denied or corrupt preference must never stop the review itself
//   seen     which agent replies the reviewer has already read, so a reply that
//            arrived while they were on another tab can be flagged as new.
//            Best effort for the same reason `ui` is
//
// THE TWO RULES, both from D5:
//
//  1. WRITTEN SYNCHRONOUSLY ON EVERY CHANGE, before any network call. Not on a
//     timer, not debounced, not on blur. Ranked test 6 asserts durability in the
//     same task as the final keystroke with no awaited timer in between, which
//     is a test a debounced store cannot pass. The debounce in this design is
//     on the post to the HELPER (750ms of typing idle, protocol.js's flush
//     policy), never on the write to storage.
//
//  2. KEYED BY REVIEW ID, never by filename and never by page. A review spans
//     pages, so keying by page splits one review into several buckets and the
//     rail shows a slice of the reviewer's own work.
//
// Browser storage is partitioned by origin and no key choice changes that, so
// localhost and 127.0.0.1 are physically separate buckets. The helper is what
// unifies a review across origins (D5), which is one more reason drafts flow to
// it.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.store = factory(root.LAHE.record, root.LAHE.merge, root.LAHE.failures, root.LAHE.elapsed);
  } else {
    module.exports = factory(
      require("../shared/record.js"),
      require("../shared/merge.js"),
      require("../shared/failures.js"),
      require("../shared/elapsed.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record, merge, failures, elapsed) {
  "use strict";

  var KEY_PREFIX = "lahe.items.v1:";
  var OUTBOX_PREFIX = "lahe.outbox.v1:";
  var CHIPS_PREFIX = "lahe.chips.v1:";
  var ACKED_PREFIX = "lahe.acked.v1:";
  var HOLDER_PREFIX = "lahe.holder.v1:";
  var LOCK_PREFIX = "lahe.window.v1:";
  var UI_PREFIX = "lahe.ui.v1:";
  // Private reviewer text. Versioned and review-scoped, but deliberately not a
  // record field: an unfinished follow-up must never enter review.json.
  var FOLLOWUP_PREFIX = "lahe.followups.v1:";
  // Which agent replies the reviewer has already looked at. Reviewer-side only:
  // it never reaches review.json and no agent ever sees it. Best effort, like
  // the UI preferences above; a denied or corrupt bucket just means a reply is
  // treated as unseen again, which is the safe direction to fail in.
  var SEEN_REPLIES_PREFIX = "lahe.seenreplies.v1:";
  // The window IDENTITY and the helper SESSION SECRET live in sessionStorage,
  // not localStorage: sessionStorage survives a same-tab navigation (page 1 to
  // /clients of one review is the same reviewer, not a second window) but a
  // genuinely new tab gets a fresh sessionStorage and therefore a new identity.
  // That is exactly the line the helper session needs: a navigated reload proves
  // it is the holder with the secret it kept, and a second tab has neither.
  var WINDOW_ID_KEY = "lahe.window.id.v1";
  var RECLAIM_DEADLINE_MS = 1500;
  var SESSION_SECRET_PREFIX = "lahe.session.v1:";

  // The storage key for a review. Review id, never a filename, never a page.
  function keyFor(reviewId) {
    if (typeof reviewId !== "string" || !reviewId) {
      throw new TypeError("store.keyFor: reviewId must be a non-empty string");
    }
    return KEY_PREFIX + reviewId;
  }

  // The backing store. localStorage in a browser, a plain object in Node, and
  // an injected object in a test. Every write below goes through this
  // synchronously; nothing here is deferred, batched, or debounced.
  function defaultBacking() {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    var mem = Object.create(null);
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      setItem: function (k, v) {
        mem[k] = String(v);
      },
      removeItem: function (k) {
        delete mem[k];
      },
      key: function (i) {
        return Object.keys(mem)[i] === undefined ? null : Object.keys(mem)[i];
      },
      get length() {
        return Object.keys(mem).length;
      }
    };
  }

  // A private in-memory backing, the fallback when there is no sessionStorage
  // (Node, an old browser). Same tiny surface defaultBacking exposes.
  function memBacking() {
    var mem = Object.create(null);
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      setItem: function (k, v) {
        mem[k] = String(v);
      },
      removeItem: function (k) {
        delete mem[k];
      }
    };
  }

  // The stable, per-tab window id. Read from sessionStorage so it survives a
  // navigation; minted and stored once when absent.
  function stableWindowId(sessionBacking) {
    try {
      var existing = sessionBacking.getItem(WINDOW_ID_KEY);
      if (existing) return existing;
    } catch (err) {
      // sessionStorage can throw in a partitioned/denied context. Fall back to a
      // fresh id rather than failing the whole layer.
      return record.randomId("win");
    }
    var minted = record.randomId("win");
    try {
      sessionBacking.setItem(WINDOW_ID_KEY, minted);
    } catch (err) {
      /* best effort: a denied sessionStorage just means the id is per-load */
    }
    return minted;
  }

  function createStore(options) {
    var opts = options || {};
    var backing = opts.backing || defaultBacking();
    // sessionStorage in a browser, an injected object in a test, a private mem
    // object otherwise. This is where the window identity and the session secret
    // live, so both survive a same-tab navigation but not a new tab.
    var sessionBacking =
      opts.sessionBacking ||
      (typeof sessionStorage !== "undefined" && sessionStorage ? sessionStorage : memBacking());
    // A window identifies itself so a refusal can name the other one, and the id
    // is STABLE across a same-tab navigation (read from sessionStorage), so the
    // helper recognizes a reload of one review as the same window rather than a
    // second one. A new tab has a fresh sessionStorage and mints a new id.
    var windowId = opts.windowId || stableWindowId(sessionBacking);
    var locks = opts.locks || (typeof navigator !== "undefined" && navigator ? navigator.locks : null);
    // How long a same-id claim waits for the lock the recorded holder would be
    // holding (see reclaimThroughLock). Long enough for an outgoing document to
    // finish dying, short enough that a duplicated tab learns it is read-only
    // before the reviewer has typed into it.
    var reclaimMs = typeof opts.reclaimMs === "number" ? opts.reclaimMs : RECLAIM_DEADLINE_MS;
    var releaseHeldLock = null;

    function readJson(key, fallback) {
      var raw = backing.getItem(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch (err) {
        // Fail loud. A store that silently returns an empty list after a
        // corrupt write is the reviewer's whole session disappearing quietly,
        // which is exactly the failure this tool exists to remove.
        throw new Error("store: " + key + " is not readable JSON (" + err.message + ")");
      }
    }

    // Every durable write in this file goes through here, so there is one place
    // a full disk is reported from and one place that is synchronous.
    function writeJson(key, value) {
      try {
        backing.setItem(key, JSON.stringify(value));
      } catch (err) {
        var f = failures.failure("STORAGE_QUOTA", err && err.message);
        var loud = new Error("store: " + f.message + " (key " + key + ")");
        loud.failure = f;
        throw loud;
      }
      return value;
    }

    function readAll(reviewId) {
      var parsed = readJson(keyFor(reviewId), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    function writeAll(reviewId, items) {
      return writeJson(keyFor(reviewId), items);
    }

    // @returns {Array<Object>} every item for this review, in creation order
    function read(reviewId) {
      return readAll(reviewId);
    }

    // Writes one item. SYNCHRONOUS. Returns the item as stored. A quota failure
    // throws rather than being swallowed: R11 says failures are loud, and a
    // silently dropped write is the failure this tool exists to remove.
    function write(reviewId, item) {
      record.validateItem(item);
      // A content write means this browser holds keystrokes the helper has not
      // necessarily confirmed at this revision, so any stale acknowledgement is
      // cleared here (finding 10, "clear on the next content write"). The ack is
      // kept in a side-table, NOT on the item, so it never leaks into a snapshot,
      // an export, or review.json; merge reads it through a transient decoration.
      clearAcknowledged(reviewId, item[record.FIELD.ID]);
      var items = readAll(reviewId);
      for (var i = 0; i < items.length; i += 1) {
        if (items[i][record.FIELD.ID] === item[record.FIELD.ID]) {
          items[i] = item;
          writeAll(reviewId, items);
          return item;
        }
      }
      items.push(item);
      writeAll(reviewId, items);
      return item;
    }

    // The draft path, called on every keystroke. Same synchronous write; named
    // separately so a reader can see that a half-written thought is as durable
    // as a finished one (D5, drafts are durable and never actionable).
    function writeDraft(reviewId, item) {
      if (!record.isDraft(item)) {
        throw new Error("store.writeDraft: item " + item[record.FIELD.ID] + " is not a draft");
      }
      return write(reviewId, item);
    }

    // A rewording. The revision bump and the applied-after history are
    // record.js's rule; this is the durable half of it, so no caller has to
    // remember to write after bumping.
    function writeRevision(reviewId, item, changes) {
      var next = record.bumpRev(item, changes || {});
      write(reviewId, next);
      return next;
    }

    // The acknowledged side-table: itemId -> the rev the helper has confirmed.
    // Kept apart from the items so the ack is never serialized as content. merge
    // reads it via the transient decoration in mergeWithHelper (finding 10).
    function ackedKey(reviewId) {
      return ACKED_PREFIX + reviewId;
    }

    function readAcked(reviewId) {
      var got = readJson(ackedKey(reviewId), null);
      return got && typeof got === "object" ? got : {};
    }

    // Stamp an item acknowledged when the helper has confirmed the event that
    // carried THIS revision (finding 10). merge.js lets the store win fully at
    // equal rev when it is acknowledged (SAME_REV_ACKED); without it the browser
    // always won at equal rev and that branch was unreachable. The stored item's
    // current rev must match, so a confirmation of an older revision cannot mark
    // a newer one.
    function markAcknowledged(reviewId, id, rev) {
      var item = readItem(reviewId, id);
      if (!item) return false;
      if (typeof rev === "number" && item[record.FIELD.REV] !== rev) return false;
      var acked = readAcked(reviewId);
      if (acked[id] === item[record.FIELD.REV]) return true;
      acked[id] = item[record.FIELD.REV];
      writeJson(ackedKey(reviewId), acked);
      return true;
    }

    function clearAcknowledged(reviewId, id) {
      var acked = readAcked(reviewId);
      if (!Object.prototype.hasOwnProperty.call(acked, id)) return false;
      delete acked[id];
      writeJson(ackedKey(reviewId), acked);
      return true;
    }

    // The rev the helper has confirmed for an item, or null. Test-facing; the
    // product reads this only through the merge.
    function acknowledgedRev(reviewId, id) {
      var acked = readAcked(reviewId);
      return Object.prototype.hasOwnProperty.call(acked, id) ? acked[id] : null;
    }

    function readItem(reviewId, id) {
      var items = readAll(reviewId);
      for (var i = 0; i < items.length; i += 1) {
        if (items[i][record.FIELD.ID] === id) return items[i];
      }
      return null;
    }

    // The reviewer deleting their own outstanding work is the only caller.
    // Nothing in the library removes an item on its own initiative.
    function remove(reviewId, id) {
      var items = readAll(reviewId);
      for (var i = 0; i < items.length; i += 1) {
        if (items[i][record.FIELD.ID] === id) {
          items.splice(i, 1);
          writeAll(reviewId, items);
          return true;
        }
      }
      return false;
    }

    // Every review this origin holds anything for. Copy and export are scoped
    // to this, honestly: with the helper down, one origin's storage is one
    // origin's slice of a review, and the export says so.
    function reviews() {
      var out = [];
      for (var i = 0; i < backing.length; i += 1) {
        var k = backing.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) out.push(k.slice(KEY_PREFIX.length));
      }
      return out;
    }

    // Merge against the helper's state, through the one merge rule. Browser
    // wins on content, store wins on lifecycle per revision (D5). The result is
    // written back synchronously, so a reload after a merge shows the merged
    // truth rather than re-running the merge from stale halves.
    function mergeWithHelper(reviewId, helperItems) {
      // Decorate the browser items with a TRANSIENT acknowledged flag from the
      // side-table, so merge.js can reach SAME_REV_ACKED (finding 10), then strip
      // the flag from the results so nothing durable ever carries it.
      var acked = readAcked(reviewId);
      var local = readAll(reviewId).map(function (item) {
        if (acked[item[record.FIELD.ID]] === item[record.FIELD.REV]) {
          return Object.assign({}, item, { acknowledged: true });
        }
        return item;
      });
      var got = merge.mergeLists(local, helperItems || []);
      var cleaned = got.items.map(function (item) {
        if (item && item.acknowledged !== undefined) {
          item = Object.assign({}, item);
          delete item.acknowledged;
        }
        return item;
      });
      writeAll(reviewId, cleaned);
      return { items: cleaned, reasons: got.reasons };
    }

    // -------------------------------------------------------------------------
    // The outbox
    // -------------------------------------------------------------------------
    //
    // Written synchronously, in the same task as the keystroke that caused it,
    // for one reason: a queue that lives only in a JS array is gone with the
    // tab, and "re-posts anything unacknowledged on reconnect" would then mean
    // "unless the reviewer reloaded", which is the promise this tool is about.
    //
    // Acknowledgement is BY event_id, never by (item, rev): drafts do not bump
    // rev and drafts flow to the helper, so many events legitimately share an
    // item and a revision (protocol.js).

    function outboxKey(reviewId) {
      return OUTBOX_PREFIX + reviewId;
    }

    function pendingEvents(reviewId) {
      var parsed = readJson(outboxKey(reviewId), []);
      return Array.isArray(parsed) ? parsed : [];
    }

    // Appends one event. Same event_id twice replaces rather than duplicates,
    // so a re-queue after a failed post cannot double-count.
    function queueEvent(reviewId, event) {
      if (!event || typeof event.event_id !== "string" || !event.event_id) {
        throw new TypeError("store.queueEvent: an event needs an event_id; idempotence is by event_id");
      }
      var queue = pendingEvents(reviewId);
      for (var i = 0; i < queue.length; i += 1) {
        if (queue[i].event_id === event.event_id) {
          queue[i] = event;
          writeJson(outboxKey(reviewId), queue);
          return queue;
        }
      }
      queue.push(event);
      writeJson(outboxKey(reviewId), queue);
      return queue;
    }

    // Drops the events the helper said it accepted. Anything it did not name
    // stays queued, which is what makes a partially accepted batch safe.
    function acknowledge(reviewId, eventIds) {
      var accepted = Object.create(null);
      (eventIds || []).forEach(function (id) {
        accepted[id] = true;
      });
      var queue = pendingEvents(reviewId).filter(function (event) {
        return !accepted[event.event_id];
      });
      writeJson(outboxKey(reviewId), queue);
      return queue;
    }

    // -------------------------------------------------------------------------
    // Chips
    // -------------------------------------------------------------------------

    function readChips(reviewId) {
      var got = readJson(CHIPS_PREFIX + reviewId, null);
      if (!got || typeof got !== "object") return { chips: [], dismissed: [] };
      return {
        chips: Array.isArray(got.chips) ? got.chips : [],
        dismissed: Array.isArray(got.dismissed) ? got.dismissed : []
      };
    }

    function writeChips(reviewId, value) {
      return writeJson(CHIPS_PREFIX + reviewId, {
        chips: (value && value.chips) || [],
        dismissed: (value && value.dismissed) || []
      });
    }

    // -----------------------------------------------------------------------
    // Rail preferences
    // -----------------------------------------------------------------------
    //
    // Unlike records and the outbox, these are convenience state. Browser
    // storage may be denied, full, or contain an old malformed value; none of
    // those conditions may stop the reviewer from using the rail. Keep this
    // deliberately separate from readJson/writeJson, whose loud failures are
    // the correct contract for work the reviewer typed.

    function uiKey(reviewId) {
      keyFor(reviewId); // the same non-empty review-id guard every bucket uses
      return UI_PREFIX + reviewId;
    }

    /**
     * Where the reviewer put the collapsed pill, or null for its default corner.
     *
     * STORED AS A CORNER AND TWO OFFSETS, never as a point. A phone rotates, an
     * address bar slides away, a window gets dragged narrower: a remembered x/y
     * is off screen or in the middle of the page after any of those. An offset
     * from the nearest corner survives all of them, which is the same reason the
     * default is expressed as right/bottom rather than a position.
     */
    function readPillSpot(got) {
      var spot = got && typeof got === "object" ? got.pill : null;
      if (!spot || typeof spot !== "object") return null;
      var h = spot.h === "left" ? "left" : spot.h === "right" ? "right" : null;
      var v = spot.v === "top" ? "top" : spot.v === "bottom" ? "bottom" : null;
      if (!h || !v) return null;
      var x = Number(spot.x);
      var y = Number(spot.y);
      if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0) return null;
      return { h: h, x: x, v: v, y: y };
    }

    function readUiPreferences(reviewId) {
      try {
        var raw = backing.getItem(uiKey(reviewId));
        if (!raw) return { collapsed: false, pill: null };
        var got = JSON.parse(raw);
        if (!got || typeof got !== "object") return { collapsed: false, pill: null };
        return { collapsed: got.collapsed === true, pill: readPillSpot(got) };
      } catch (err) {
        return { collapsed: false, pill: null };
      }
    }

    function writeUiPreferences(reviewId, value) {
      // Whitelisted on the way in as well as on the way out: this bucket is
      // chrome preference and nothing else ever belongs in it.
      var next = { collapsed: !!(value && value.collapsed), pill: readPillSpot(value) };
      try {
        backing.setItem(uiKey(reviewId), JSON.stringify(next));
      } catch (err) {
        // Best effort. Losing chrome preference is recoverable; losing review
        // work is not, which is why record writes still fail loudly above.
      }
      return next;
    }

    // id -> the stamp of the reply the reviewer has seen for that item. The
    // stamp, not a boolean: an item that gets a SECOND reply later has to read
    // as unseen again, and a boolean cannot say that.
    function seenRepliesKey(reviewId) {
      keyFor(reviewId);
      return SEEN_REPLIES_PREFIX + reviewId;
    }

    function readSeenReplies(reviewId) {
      try {
        var raw = backing.getItem(seenRepliesKey(reviewId));
        if (!raw) return {};
        var got = JSON.parse(raw);
        if (!got || typeof got !== "object" || Array.isArray(got)) return {};
        var clean = {};
        Object.keys(got).forEach(function (id) {
          if (typeof got[id] === "string") clean[id] = got[id];
        });
        return clean;
      } catch (err) {
        return {};
      }
    }

    function writeSeenReplies(reviewId, marks) {
      var next = {};
      if (marks && typeof marks === "object") {
        Object.keys(marks).forEach(function (id) {
          if (typeof marks[id] === "string") next[id] = marks[id];
        });
      }
      try {
        backing.setItem(seenRepliesKey(reviewId), JSON.stringify(next));
      } catch (err) {
        // Best effort, on purpose. A full or denied storage costs the reviewer
        // one badge that comes back, never a word of their own work.
      }
      return next;
    }

    function followupKey(reviewId) {
      keyFor(reviewId);
      return FOLLOWUP_PREFIX + reviewId;
    }

    function readFollowupDrafts(reviewId) {
      var got = readJson(followupKey(reviewId), {});
      return got && typeof got === "object" && !Array.isArray(got) ? got : {};
    }

    function readFollowupDraft(reviewId, itemId) {
      var drafts = readFollowupDrafts(reviewId);
      return typeof drafts[itemId] === "string" ? drafts[itemId] : "";
    }

    // Synchronous, like every other reviewer-authored draft write.
    function writeFollowupDraft(reviewId, itemId, text) {
      var drafts = readFollowupDrafts(reviewId);
      drafts[itemId] = String(text || "");
      writeJson(followupKey(reviewId), drafts);
      return drafts[itemId];
    }

    function clearFollowupDraft(reviewId, itemId) {
      var drafts = readFollowupDrafts(reviewId);
      if (!Object.prototype.hasOwnProperty.call(drafts, itemId)) return false;
      delete drafts[itemId];
      writeJson(followupKey(reviewId), drafts);
      return true;
    }

    // -------------------------------------------------------------------------
    // The second window, client side (D5)
    // -------------------------------------------------------------------------
    //
    // TWO SHAPES, AND THEY FAIL DIFFERENTLY.
    //
    //   shared storage (two tabs, one browser profile) is refused HERE, by a Web
    //   Lock held for the life of the session. It works with the helper down,
    //   which is the whole reason it is a lock and not a helper call.
    //
    //   separate storage (two profiles, two contexts) cannot see this lock at
    //   all and can only be refused by the helper's session (1A's half).
    //
    // The third case, separate storage AND no helper, is refused by nothing.
    // That is a NAMED LIMIT: sync.js puts it on the status line rather than
    // letting the rail imply a guarantee that does not exist.

    function holderKey(reviewId) {
      return HOLDER_PREFIX + reviewId;
    }

    function readHolder(reviewId) {
      return readJson(holderKey(reviewId), null);
    }

    // The sentence a refusal shows the REVIEWER, so it holds no machine output.
    // It used to read "the window on /a/very/long/path/to/doc.html, open since
    // 2026-08-18T04:35:45.006Z": a raw ISO timestamp in a sentence written for a
    // person, and a path long enough to burst the chip (Ken, live, 2026-08-18).
    // The tail is the part a person recognizes, and the elapsed phrase is
    // shared with the helper's own refusal so the two never disagree.
    //
    // The TAIL, not the basename: a document served at the origin root has no
    // basename at all, so the clause vanished and the refusal named "the
    // window" with no window in it, and two folders' index.html both collapsed
    // to one name, which is the one case the reviewer needs told apart.
    // record.shortPath keeps the parent directory, which is short enough for a
    // chip and specific enough to point at a window.
    function describeHolder(holder) {
      if (!holder) return "another window";
      var name = holder.path ? record.shortPath(holder.path) : null;
      var where = name ? " on " + name : "";
      var when = holder.since ? ", open " + elapsed.elapsedPhrase(holder.since) : "";
      return "the window" + where + when;
    }

    /**
     * Claim this review for this window.
     *
     * @returns {Promise<{acquired: boolean, holder: object|null, windowId: string,
     *                    failure: object|null, reason: string|null}>}
     *   Resolved, never thrown: a window that cannot claim the review is a
     *   read-only window, not a crash.
     */
    function refusedBy(holder) {
      return {
        acquired: false,
        holder: holder,
        windowId: windowId,
        failure: failures.failure("SECOND_WINDOW_REFUSED", describeHolder(holder)),
        reason: "This review is already open in " + describeHolder(holder) + "."
      };
    }

    /**
     * Ask for the lock the recorded holder would be holding, and let the answer
     * decide. See claimWindow's comment for why an id match is a question and
     * not a verdict.
     *
     * The deadline is what keeps this from hanging forever behind a live window:
     * a session-held lock is never released, so the request would simply sit
     * there and the page would never learn it is read-only.
     */
    function reclaimThroughLock(reviewId, self, holder, settle) {
      var decided = false;
      // harness-allow-timer: the deadline on a lock a live holder will never
      // release. Not a sleep: the fast path settles the moment the lock is
      // granted, and this only fires when it never is.
      var deadline = setTimeout(function () {
        if (decided) return;
        decided = true;
        settle(refusedBy(holder));
      }, reclaimMs);

      locks.request(LOCK_PREFIX + reviewId, function () {
        if (decided) {
          // Granted after the deadline: this window has already been told it is
          // read-only, so the lock is released at once rather than held by a
          // window that is not acting as the holder.
          return Promise.resolve();
        }
        decided = true;
        clearTimeout(deadline);
        writeJson(holderKey(reviewId), self);
        settle({ acquired: true, holder: self, windowId: windowId, failure: null, reason: null, reclaimed: true });
        return new Promise(function (resolve) {
          releaseHeldLock = resolve;
        });
      });
      return null;
    }

    function claimWindow(reviewId, meta) {
      var self = {
        window_id: windowId,
        since: new Date().toISOString(),
        path: (meta && meta.path) || (typeof location !== "undefined" ? location.pathname : null)
      };

      if (!locks || typeof locks.request !== "function") {
        // No Web Locks (an old browser, or Node). The claim is not refused,
        // because refusing on the basis of a check that did not run would lock
        // a reviewer out of their own review, and a reviewer locked out is a
        // work-losing outcome in a tool whose thesis is never losing work.
        writeJson(holderKey(reviewId), self);
        return Promise.resolve({
          acquired: true,
          holder: self,
          windowId: windowId,
          failure: null,
          reason: null,
          unchecked: true
        });
      }

      var settle;
      var answered = new Promise(function (resolve) {
        settle = resolve;
      });

      locks.request(LOCK_PREFIX + reviewId, { ifAvailable: true }, function (lock) {
        if (!lock) {
          var holder = readHolder(reviewId);
          // THE RECORDED HOLDER CARRIES THIS WINDOW'S ID. A reload (R36's
          // auto-reload, or the reviewer's own) starts the new document BEFORE
          // the old one is torn down, so for a moment the outgoing page still
          // holds the Web Lock and the incoming one is refused. It is the same
          // tab, so refusing it would send a page reloading itself into its own
          // second-window guard, read-only with one window open (Ken, live,
          // 2026-08-18).
          //
          // BUT THE ID ALONE PROVES NOTHING. The window id lives in
          // sessionStorage, and a browser COPIES sessionStorage into a
          // duplicated or session-restored tab, so a genuine second live tab
          // presents the first tab's id and would be handed the review while
          // the first tab kept writing the same bucket: two live windows, one
          // storage, no guard, last write wins and the reviewer never hears
          // about it.
          //
          // So the id only decides WHICH QUESTION to ask, and the Web Lock
          // answers it. The lock is requested WITHOUT ifAvailable and the
          // answer is whatever acquisition says: mid-reload the outgoing
          // context is dying, so the lock frees within milliseconds and this
          // document really holds it; a duplicated tab is asking for a lock a
          // LIVE window holds for its whole session, never gets it, and is
          // refused when the deadline passes.
          if (holder && holder.window_id === windowId) {
            reclaimThroughLock(reviewId, self, holder, settle);
            return null;
          }
          settle(refusedBy(holder));
          return null;
        }
        writeJson(holderKey(reviewId), self);
        settle({ acquired: true, holder: self, windowId: windowId, failure: null, reason: null });
        // HELD FOR THE LIFE OF THE SESSION. The promise this returns is what
        // keeps the lock, so it resolves only when releaseWindow is called.
        return new Promise(function (resolve) {
          releaseHeldLock = resolve;
        });
      });

      return answered;
    }

    function releaseWindow(reviewId) {
      if (typeof releaseHeldLock === "function") {
        releaseHeldLock();
        releaseHeldLock = null;
      }
      if (reviewId) {
        var holder = readHolder(reviewId);
        if (holder && holder.window_id === windowId) backing.removeItem(holderKey(reviewId));
      }
      return true;
    }

    function refusalFailure(detail) {
      return failures.failure("SECOND_WINDOW_REFUSED", detail || null);
    }

    // The helper session secret this window holds for a review, kept in
    // sessionStorage so a same-tab navigation can re-present it and be recognized
    // as the holder rather than refused as a second window (D5). A new tab has no
    // secret and is correctly refused while the first tab is alive.
    function sessionSecretKey(reviewId) {
      return SESSION_SECRET_PREFIX + reviewId;
    }

    function sessionSecretFor(reviewId) {
      try {
        return sessionBacking.getItem(sessionSecretKey(reviewId)) || null;
      } catch (err) {
        return null;
      }
    }

    function rememberSessionSecret(reviewId, secret) {
      try {
        if (secret) sessionBacking.setItem(sessionSecretKey(reviewId), secret);
        else sessionBacking.removeItem(sessionSecretKey(reviewId));
      } catch (err) {
        /* best effort */
      }
      return secret || null;
    }

    return {
      windowId: windowId,
      keyFor: keyFor,
      read: read,
      write: write,
      writeDraft: writeDraft,
      writeRevision: writeRevision,
      readItem: readItem,
      markAcknowledged: markAcknowledged,
      acknowledgedRev: acknowledgedRev,
      remove: remove,
      reviews: reviews,
      mergeWithHelper: mergeWithHelper,
      pendingEvents: pendingEvents,
      queueEvent: queueEvent,
      acknowledge: acknowledge,
      readChips: readChips,
      writeChips: writeChips,
      readUiPreferences: readUiPreferences,
      writeUiPreferences: writeUiPreferences,
      readSeenReplies: readSeenReplies,
      writeSeenReplies: writeSeenReplies,
      readFollowupDraft: readFollowupDraft,
      writeFollowupDraft: writeFollowupDraft,
      clearFollowupDraft: clearFollowupDraft,
      readHolder: readHolder,
      describeHolder: describeHolder,
      claimWindow: claimWindow,
      releaseWindow: releaseWindow,
      refusalFailure: refusalFailure,
      sessionSecretFor: sessionSecretFor,
      rememberSessionSecret: rememberSessionSecret
    };
  }

  var shared = createStore();

  return {
    KEY_PREFIX: KEY_PREFIX,
    OUTBOX_PREFIX: OUTBOX_PREFIX,
    CHIPS_PREFIX: CHIPS_PREFIX,
    HOLDER_PREFIX: HOLDER_PREFIX,
    LOCK_PREFIX: LOCK_PREFIX,
    UI_PREFIX: UI_PREFIX,
    FOLLOWUP_PREFIX: FOLLOWUP_PREFIX,
    SEEN_REPLIES_PREFIX: SEEN_REPLIES_PREFIX,
    keyFor: keyFor,
    createStore: createStore,
    shared: shared
  };
});
