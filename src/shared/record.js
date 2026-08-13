// The item record: the single place every field name in this tool is spelled.
//
// Owner: 0A-kernel. Imported by: the store (1B), the sync client (1B), the
// helper (1A), the projection (3A), the review formatter (0A-wire), the edit
// recorder (2A), replay (2C), the rail (1B), the comment surface (1D).
//
// Architecture D4 (records are the truth) names the fields. This module is that
// table as code. If a builder needs a field name, they import FIELD; they never
// type the string.
//
// Three things this table carries that a builder would otherwise invent:
//
//  1. THE PAGE FIELDS. One review spans a dev-server walk, and review.json is
//     grouped by page (D6). Without page_origin, page_path, page_title and
//     page_seq on the record itself, the projection has nothing to group by.
//     The group key is ORIGIN PLUS PATHNAME, never pathname alone: two dev
//     servers both serving /dashboard must not collapse into one section.
//
//  2. THE APPLIED-`after` HISTORY. Replay's branch three (an earlier revision's
//     text landed somewhere) has nothing to compare against unless the record
//     carries the ordered list of `after` values it has had (D7). Without it a
//     two-rewording case falls into branch four and flags a collision that is
//     not one.
//
//  3. THE FIELD CLASSIFICATION, per D12 (page text is data, reviewer text is
//     intent). Only `note` and `change` are intent. The full `before` and
//     `after` of a region are the page's own words with the reviewer's changes
//     mixed in, so carrying them as intent would let a document someone else
//     sent ride a hidden instruction into the instruction channel on the back
//     of the reviewer's edit.
//
// The event envelope is NOT here. The events.jsonl line schema, its closed type
// vocabulary, and the reply line schema are 0A-wire's, in src/shared/protocol.js
// and docs/CONTRACTS.md, because they are read and written by things outside
// this repo.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.record = factory(root.LAHE.normalize);
  } else {
    module.exports = factory(require("./normalize.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Field names
  // ---------------------------------------------------------------------------

  var FIELD = {
    ID: "id",
    REV: "rev",
    KIND: "kind",
    STATE: "state",

    // The reviewer's own words. The two intent fields, and the only two.
    NOTE: "note",
    CHANGE: "change",

    // The region's text, off the page. Data.
    BEFORE: "before",
    AFTER: "after",
    BEFORE_HTML: "before_html",
    AFTER_HTML: "after_html",
    AFTER_HISTORY: "after_history",

    // Where it is.
    REGION: "region",
    CONTEXT: "context",

    // Which page it was made on. The projection groups by ORIGIN + PATH.
    PAGE_ORIGIN: "page_origin",
    PAGE_PATH: "page_path",
    PAGE_TITLE: "page_title",
    PAGE_SEQ: "page_seq",
    SOURCE_HINT: "source_hint",

    // What the agent said, folded from its reply line.
    REPLY: "reply",

    CREATED_AT: "created_at",
    UPDATED_AT: "updated_at"
  };

  // ---------------------------------------------------------------------------
  // Kinds
  // ---------------------------------------------------------------------------
  //
  // D4's list, closed. `format_only` is its own kind because a formatting change
  // is still a change (R31) and it compares on structure rather than on
  // normalized text, whose whole job is to ignore formatting. `delete` is its
  // own kind because a deleted block reads as a deletion rather than as an empty
  // edit (R27).

  var KIND = {
    COMMENT: "comment",
    EDIT: "edit",
    DELETE: "delete",
    FORMAT_ONLY: "format_only",
    NOTE: "note"
  };
  var KINDS = Object.keys(KIND).map(function (k) {
    return KIND[k];
  });

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------
  //
  // Exactly four. `question` is a REPLY STATUS that leaves the item in ready,
  // not a fifth state, and `reopened` is a TRANSITION from handled back to
  // ready, not a state. The transition table and its actor column live in
  // src/shared/lifecycle.js.

  var STATE = {
    DRAFT: "draft",
    READY: "ready",
    HANDLED: "handled",
    NOT_HANDLED: "not_handled"
  };
  var STATES = Object.keys(STATE).map(function (k) {
    return STATE[k];
  });

  // The agent's reply statuses, which are not states. `question` and
  // `not_handled` both leave work in front of the reviewer; only `handled`
  // retires an item.
  var REPLY_STATUS = {
    HANDLED: "handled",
    NOT_HANDLED: "not_handled",
    QUESTION: "question"
  };
  var REPLY_STATUSES = Object.keys(REPLY_STATUS).map(function (k) {
    return REPLY_STATUS[k];
  });

  // ---------------------------------------------------------------------------
  // D12: every field is classified
  // ---------------------------------------------------------------------------
  //
  // "intent" means the reviewer wrote it and an agent should act on it. "data"
  // means it came off the reviewed page; it is there so the agent can find the
  // right place in the source, and it is never an instruction, no matter what
  // it says.
  //
  // The default for an unknown field is DATA. Failing to data is the safe
  // direction: a new field added by a later task is treated as page content
  // until someone decides otherwise.

  var CLASS_INSTRUCTION = "instruction";
  var CLASS_DATA = "data";

  // The whole intent channel, in one list. Two fields, and that is the point.
  var INTENT_FIELDS = [FIELD.NOTE, FIELD.CHANGE];

  var FIELD_CLASS = {
    note: CLASS_INSTRUCTION,
    change: CLASS_INSTRUCTION,
    before: CLASS_DATA,
    after: CLASS_DATA,
    before_html: CLASS_DATA,
    after_html: CLASS_DATA,
    after_history: CLASS_DATA,
    "context.quote": CLASS_DATA,
    "context.prefix": CLASS_DATA,
    "context.suffix": CLASS_DATA,
    "context.heading": CLASS_DATA,
    "context.element": CLASS_DATA,
    "region.label": CLASS_DATA,
    page_title: CLASS_DATA,
    page_path: CLASS_DATA,
    "reply.reason": CLASS_DATA,
    "reply.text": CLASS_DATA
  };

  function fieldClass(path) {
    return Object.prototype.hasOwnProperty.call(FIELD_CLASS, path) ? FIELD_CLASS[path] : CLASS_DATA;
  }

  // ---------------------------------------------------------------------------
  // Ids
  // ---------------------------------------------------------------------------
  //
  // Client-minted, so a re-post after a dropped connection cannot double-count
  // (D5). A CSPRNG is required in both environments; Node 20 and every target
  // browser have globalThis.crypto. Missing entropy is an error, not a
  // Math.random fallback: two items sharing an id is silent, permanent loss of
  // the reviewer's work.
  function csprngBytes(n) {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (g && g.crypto && typeof g.crypto.getRandomValues === "function") {
      var b = new Uint8Array(n);
      g.crypto.getRandomValues(b);
      return b;
    }
    // Node without the webcrypto global. Node's own crypto module is built in,
    // so reaching for it is not a dependency. Guarded on there being no window
    // so a browser page that happens to define require never takes this path.
    if (typeof require === "function" && typeof window === "undefined") {
      return new Uint8Array(require("node:crypto").randomBytes(n));
    }
    throw new Error("randomId: no CSPRNG available (globalThis.crypto.getRandomValues)");
  }

  function randomId(prefix) {
    var bytes = csprngBytes(12);
    var hex = "";
    for (var i = 0; i < bytes.length; i += 1) {
      hex += (bytes[i] + 0x100).toString(16).slice(1);
    }
    return (prefix ? prefix + "_" : "") + hex;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // The page a record was made on
  // ---------------------------------------------------------------------------
  //
  // Query strings and fragments collapse away: /dashboard?tab=2 and
  // /dashboard#top are one page. A file:// review carries the file's basename
  // as its path, and "file" as its origin, so a document opened from disk still
  // gets a group.

  var FILE_ORIGIN = "file";

  function emptyPage() {
    return { origin: null, path: null, title: null, seq: null, source_hint: null };
  }

  // The group key for review.json. ORIGIN plus PATH, never path alone.
  function pageKey(item) {
    if (!item || typeof item !== "object") throw new TypeError("pageKey expects an item");
    return String(item[FIELD.PAGE_ORIGIN]) + "|" + String(item[FIELD.PAGE_PATH]);
  }

  // Builds the page fields from a location-like object. Pure, so it is
  // unit-testable with no browser: the library passes window.location, the
  // helper passes a parsed URL, a test passes a plain object.
  //
  // @param {Object} loc {origin, pathname, href, title}
  // @param {Object} options {seq, source_hint}
  function pageFrom(loc, options) {
    var l = loc || {};
    var opts = options || {};
    var origin = l.origin || null;
    var path = l.pathname || null;

    if (!origin || origin === "null" || /^file:/i.test(String(l.href || ""))) {
      // A page opened from disk. The basename is the only part a person would
      // recognize, and the full path is not the reviewer's to leak into a group
      // heading.
      origin = FILE_ORIGIN;
      var href = String(l.href || l.pathname || "");
      var tail = href.split("?")[0].split("#")[0].split("/").filter(Boolean).pop();
      path = tail || "document";
    }

    return {
      origin: origin,
      path: path,
      title: typeof l.title === "string" ? l.title : null,
      seq: typeof opts.seq === "number" ? opts.seq : null,
      source_hint: opts.source_hint || null
    };
  }

  // ---------------------------------------------------------------------------
  // The record
  // ---------------------------------------------------------------------------

  function emptyRegion() {
    return {
      // The anchor engine's reference (1C mints it). Opaque here on purpose:
      // this module owns the field name, 1C owns the contents.
      ref: null,
      // Display only. Pinned at first touch, never recomputed. See regions.js.
      label: null,
      // null, or {code, reason, at} when the subject can no longer be found.
      lost: null
    };
  }

  function emptyContext() {
    return { quote: null, prefix: null, suffix: null, heading: null, element: null };
  }

  // Creates a record with every field present. Every field present always is
  // deliberate: the merge rule never has to distinguish "absent" from "null",
  // and an agent reading review.json sees a stable shape.
  function newItem(input) {
    var src = input || {};
    if (KINDS.indexOf(src.kind) === -1) {
      throw new Error("newItem: kind must be one of " + KINDS.join(", ") + ", got " + String(src.kind));
    }
    var page = src.page || {};
    var origin = src.page_origin || page.origin;
    var path = src.page_path || page.path;
    if (typeof origin !== "string" || !origin) {
      throw new Error("newItem: page_origin is required; review.json is grouped by origin plus path");
    }
    if (typeof path !== "string" || !path) {
      throw new Error("newItem: page_path is required; review.json is grouped by origin plus path");
    }

    var at = src.created_at || nowIso();
    var item = {};
    item[FIELD.ID] = src.id || randomId("itm");
    item[FIELD.REV] = typeof src.rev === "number" ? src.rev : 1;
    item[FIELD.KIND] = src.kind;
    item[FIELD.STATE] = src.state || STATE.DRAFT;
    item[FIELD.NOTE] = typeof src.note === "string" ? src.note : null;
    item[FIELD.CHANGE] = typeof src.change === "string" ? src.change : null;
    item[FIELD.BEFORE] = typeof src.before === "string" ? src.before : null;
    item[FIELD.AFTER] = typeof src.after === "string" ? src.after : null;
    item[FIELD.BEFORE_HTML] = typeof src.before_html === "string" ? src.before_html : null;
    item[FIELD.AFTER_HTML] = typeof src.after_html === "string" ? src.after_html : null;
    item[FIELD.AFTER_HISTORY] = Array.isArray(src.after_history) ? src.after_history.slice() : [];
    item[FIELD.REGION] = src.region || emptyRegion();
    item[FIELD.CONTEXT] = src.context || emptyContext();
    item[FIELD.PAGE_ORIGIN] = origin;
    item[FIELD.PAGE_PATH] = path;
    item[FIELD.PAGE_TITLE] = src.page_title || page.title || null;
    item[FIELD.PAGE_SEQ] = typeof src.page_seq === "number" ? src.page_seq : typeof page.seq === "number" ? page.seq : null;
    item[FIELD.SOURCE_HINT] = src.source_hint || page.source_hint || null;
    item[FIELD.REPLY] = src.reply || null;
    item[FIELD.CREATED_AT] = at;
    item[FIELD.UPDATED_AT] = src.updated_at || at;

    // A record that arrives with an `after` starts its history with it, so
    // branch three has something to compare against from the first revision.
    if (!item[FIELD.AFTER_HISTORY].length && typeof item[FIELD.AFTER] === "string") {
      item[FIELD.AFTER_HISTORY] = [historyEntry(item[FIELD.REV], item[FIELD.AFTER], item[FIELD.AFTER_HTML], at)];
    }
    return item;
  }

  function isDraft(item) {
    return item[FIELD.STATE] === STATE.DRAFT;
  }

  function isReady(item) {
    return item[FIELD.STATE] === STATE.READY;
  }

  // Outstanding for the reviewer: still in front of them. A handled item is
  // kept and reopenable (R38), not outstanding.
  function isOutstanding(item) {
    return item[FIELD.STATE] === STATE.READY || item[FIELD.STATE] === STATE.NOT_HANDLED;
  }

  // ---------------------------------------------------------------------------
  // The applied-`after` history
  // ---------------------------------------------------------------------------

  function historyEntry(rev, after, afterHtml, at) {
    return {
      rev: rev,
      after: typeof after === "string" ? after : null,
      after_html: typeof afterHtml === "string" ? afterHtml : null,
      at: at || nowIso()
    };
  }

  // Every rewording bumps rev, and the previous `after` is kept. Replies name
  // (id, rev) and lifecycle wins only for the revision it names (D4), so a rev
  // that does not move is how a stale "handled" swallows a rewording.
  function bumpRev(item, changes) {
    var next = Object.assign({}, item, changes || {});
    next[FIELD.REV] = item[FIELD.REV] + 1;
    next[FIELD.UPDATED_AT] = nowIso();

    var history = (item[FIELD.AFTER_HISTORY] || []).slice();
    var newAfter = next[FIELD.AFTER];
    var newAfterHtml = next[FIELD.AFTER_HTML];
    var last = history.length ? history[history.length - 1] : null;
    // Dedupe on the field this record actually compares on (comparisonFields):
    // a format-only record's `after` text never moves, so gating on it alone
    // drops every formatting revision from the history and replay's branch three
    // then misses, flagging a false conflict on the reviewer's own change. Push
    // when EITHER the compared after OR the after_html moved.
    var afterMoved = typeof newAfter === "string" && (!last || last.after !== newAfter);
    var htmlMoved = typeof newAfterHtml === "string" && (!last || last.after_html !== newAfterHtml);
    if (afterMoved || htmlMoved) {
      history.push(historyEntry(next[FIELD.REV], newAfter, newAfterHtml, next[FIELD.UPDATED_AT]));
    }
    next[FIELD.AFTER_HISTORY] = history;
    return next;
  }

  // The `after` values this record has had that are NOT its current one. This
  // is exactly what replay's branch three compares against: an earlier version
  // landed somewhere, so the current revision is re-applied and the card says
  // an earlier version had landed.
  //
  // `field` is FIELD.AFTER for an ordinary record and FIELD.AFTER_HTML for a
  // format-only one, whose difference lives in the markup rather than in the
  // text. The history entry carries both, so one history serves both modes.
  function priorAfters(item, field) {
    var key = field === FIELD.AFTER_HTML ? "after_html" : "after";
    var current = item[field === FIELD.AFTER_HTML ? FIELD.AFTER_HTML : FIELD.AFTER];
    var out = [];
    var history = item[FIELD.AFTER_HISTORY] || [];
    for (var i = 0; i < history.length; i += 1) {
      var value = history[i][key];
      if (typeof value !== "string") continue;
      if (value === current) continue;
      if (out.indexOf(value) === -1) out.push(value);
    }
    return out;
  }

  // Which pair of fields a record compares on. A format-only record's whole
  // difference is in the markup, so comparing its `after` (identical to its
  // `before` by construction) would make the branch a silent no-op.
  function comparisonFields(item) {
    if (item[FIELD.KIND] === KIND.FORMAT_ONLY) {
      return { before: FIELD.BEFORE_HTML, after: FIELD.AFTER_HTML };
    }
    return { before: FIELD.BEFORE, after: FIELD.AFTER };
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  // Fail loud, and report every problem at once rather than the first.
  //
  // A draft is held to a lighter bar than a ready item on purpose: a draft is
  // the reviewer mid-sentence, and refusing to store a half-written thought is
  // the exact work-losing behavior this tool exists to remove.
  function validateItem(item) {
    var problems = [];
    if (!item || typeof item !== "object") {
      throw new TypeError("validateItem expects an object, got " + typeof item);
    }
    if (typeof item[FIELD.ID] !== "string" || !item[FIELD.ID]) problems.push("id must be a non-empty string");
    if (typeof item[FIELD.REV] !== "number" || item[FIELD.REV] < 1) problems.push("rev must be a number >= 1");
    if (KINDS.indexOf(item[FIELD.KIND]) === -1) problems.push("kind must be one of " + KINDS.join(", "));
    if (STATES.indexOf(item[FIELD.STATE]) === -1) problems.push("state must be one of " + STATES.join(", "));
    if (typeof item[FIELD.PAGE_ORIGIN] !== "string" || !item[FIELD.PAGE_ORIGIN]) {
      problems.push("page_origin must be a non-empty string");
    }
    if (typeof item[FIELD.PAGE_PATH] !== "string" || !item[FIELD.PAGE_PATH]) {
      problems.push("page_path must be a non-empty string");
    }
    if (!Array.isArray(item[FIELD.AFTER_HISTORY])) {
      problems.push("after_history must be an array; replay's branch three reads it");
    }
    if (item[FIELD.STATE] !== STATE.DRAFT) {
      if ((item[FIELD.KIND] === KIND.COMMENT || item[FIELD.KIND] === KIND.NOTE) && !item[FIELD.NOTE]) {
        problems.push("a ready " + item[FIELD.KIND] + " must carry the reviewer's note");
      }
      if (item[FIELD.KIND] === KIND.EDIT && typeof item[FIELD.AFTER] !== "string") {
        problems.push("a ready edit must carry after text");
      }
    }
    if (item[FIELD.REPLY] && REPLY_STATUSES.indexOf(item[FIELD.REPLY].status) === -1) {
      problems.push("reply.status must be one of " + REPLY_STATUSES.join(", "));
    }
    if (problems.length) {
      throw new Error("invalid item " + String(item[FIELD.ID]) + ": " + problems.join("; "));
    }
    return item;
  }

  // ---------------------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------------------
  //
  // Which mode a record compares in: format-only records compare on structure,
  // everything else on normalized text (D7). Every caller asks this rather than
  // testing the kind itself, so no second rule can grow anywhere.

  function comparisonMode(item) {
    return normalize.modeFor(item[FIELD.KIND]);
  }

  function normalizedBefore(item) {
    return typeof item[FIELD.BEFORE] === "string" ? normalize.normalizeText(item[FIELD.BEFORE]) : null;
  }

  function normalizedAfter(item) {
    return typeof item[FIELD.AFTER] === "string" ? normalize.normalizeText(item[FIELD.AFTER]) : null;
  }

  return {
    FIELD: FIELD,
    KIND: KIND,
    KINDS: KINDS,
    STATE: STATE,
    STATES: STATES,
    REPLY_STATUS: REPLY_STATUS,
    REPLY_STATUSES: REPLY_STATUSES,
    CLASS_INSTRUCTION: CLASS_INSTRUCTION,
    CLASS_DATA: CLASS_DATA,
    INTENT_FIELDS: INTENT_FIELDS,
    FIELD_CLASS: FIELD_CLASS,
    fieldClass: fieldClass,
    FILE_ORIGIN: FILE_ORIGIN,
    randomId: randomId,
    nowIso: nowIso,
    emptyRegion: emptyRegion,
    emptyContext: emptyContext,
    emptyPage: emptyPage,
    pageFrom: pageFrom,
    pageKey: pageKey,
    newItem: newItem,
    bumpRev: bumpRev,
    historyEntry: historyEntry,
    priorAfters: priorAfters,
    comparisonFields: comparisonFields,
    validateItem: validateItem,
    isDraft: isDraft,
    isReady: isReady,
    isOutstanding: isOutstanding,
    comparisonMode: comparisonMode,
    normalizedBefore: normalizedBefore,
    normalizedAfter: normalizedAfter
  };
});
