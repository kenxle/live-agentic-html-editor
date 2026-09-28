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

    // The id of the handled item this record takes back, when it is a revert
    // (see revertOf). Null on every ordinary record.
    REVERTS: "reverts",

    // What the agent said, folded from its reply line.
    REPLY: "reply",

    // The agent replied handled and the built page does not show this edit's
    // words. True means the claim was checked and failed, so the item did not
    // retire: it is still the reviewer's outstanding work and still on the
    // agent's drain list. Absent or false everywhere else, including on every
    // item whose claim cannot be checked at all.
    HANDLED_NOT_ON_PAGE: "handled_not_on_page",

    // Completed reviewer/agent exchanges, oldest first. The current exchange
    // stays in NOTE/CHANGE + REPLY until the reviewer continues it.
    THREAD: "thread",

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

  /**
   * Did the reviewer make this change with their hands, on the page itself?
   *
   * The three kinds that carry a before-and-after. It lives here rather than in
   * a tab file because more than one surface has to agree on the answer: the
   * Edits tab lists exactly these, and the Done tab has to know that the Edits
   * row on the same card is already drawing the change summary, so it does not
   * print the same sentence a second time.
   */
  function isHandEdit(item) {
    if (!item) return false;
    var kind = item[FIELD.KIND];
    return kind === KIND.EDIT || kind === KIND.DELETE || kind === KIND.FORMAT_ONLY;
  }

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
    "context.subject": CLASS_DATA,
    "region.label": CLASS_DATA,
    // The page's own words, kept so replay knows which page states the reviewer
    // has already answered. Data, and emphatically not intent.
    "region.accepted_page_texts": CLASS_DATA,
    // The page check's own bookkeeping. Tool-written, never read as an
    // instruction, and not projected into review.json at all.
    "region.check_reopen": CLASS_DATA,
    page_title: CLASS_DATA,
    page_path: CLASS_DATA,
    "reply.reason": CLASS_DATA,
    "reply.text": CLASS_DATA,
    // Earlier reviewer turns are historical context, not instructions to run
    // again. Only the current top-level note/change are the intent channel.
    "thread[].reviewer.note": CLASS_DATA,
    "thread[].reviewer.change": CLASS_DATA,
    "thread[].agent.reason": CLASS_DATA,
    "thread[].agent.text": CLASS_DATA
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

  // ---------------------------------------------------------------------------
  // Can this page's SOURCE hold a data-lahe-id at all?
  // ---------------------------------------------------------------------------
  //
  // FOUND BY DOGFOODING, 2026-09-14, within an hour of the helper picking up
  // 0.2.0. An agent on a Markdown review answered: the source is plain
  // Markdown, which has no place for an attribute, and the renderer builds the
  // page from it. It is right, and two things were wrong because of it. The
  // contract asked every agent for something impossible on a .md review, and
  // the page check's stamp rule (S7) would have reopened every handled edit of
  // every Markdown review once, with a note asking for an attribute that source
  // cannot carry. On the tool's most common document type that is a reopen
  // storm.
  //
  // So the stamp is EXPECTED only where the source is markup with attributes.
  // The list is extensions rather than a guess about content, because a path is
  // the only thing both the page check and the projection reliably have.
  var STAMP_SOURCE_EXTENSIONS = [
    "html", "htm", "xhtml", "svg", "vue", "svelte", "astro", "jsx", "tsx",
    "erb", "ejs", "njk", "hbs", "liquid", "php", "mustache", "twig", "jinja", "j2"
  ];

  /** The lowercased extension of a path, or "" when it has none. */
  function extensionOf(path) {
    if (typeof path !== "string" || !path) return "";
    var clean = path.split("#")[0].split("?")[0];
    var last = clean.split("/").pop() || "";
    var dot = last.lastIndexOf(".");
    if (dot <= 0 || dot === last.length - 1) return "";
    return last.slice(dot + 1).toLowerCase();
  }

  /**
   * Could an agent write `data-lahe-id` into the source behind this path?
   *
   * Markdown, plain text, reStructuredText, JSON and a path with no extension
   * at all are all "no": there is nowhere in that file to put an attribute.
   * The caller passes the SOURCE's path when the review knows one (the page's
   * source_hint) and the page's own path when it does not.
   */
  function sourceCanCarryStamp(path) {
    var ext = extensionOf(path);
    if (!ext) return false;
    return STAMP_SOURCE_EXTENSIONS.indexOf(ext) !== -1;
  }

  /**
   * The same question for a whole page: its source if the review knows one,
   * otherwise the page's own path.
   *
   * @param {Object} page {path, source_hint} or a record's page fields
   */
  function pageCanCarryStamp(page) {
    if (!page || typeof page !== "object") return false;
    var hint = page.source_hint;
    var hinted = hint && typeof hint === "object" ? hint.path : hint;
    if (typeof hinted === "string" && hinted) return sourceCanCarryStamp(hinted);
    return sourceCanCarryStamp(page.path);
  }

  /** And for one record, which carries both its page path and its source hint. */
  function itemCanCarryStamp(item) {
    if (!item || typeof item !== "object") return false;
    return pageCanCarryStamp({
      path: item[FIELD.PAGE_PATH],
      source_hint: item[FIELD.SOURCE_HINT]
    });
  }

  // The group key for review.json. ORIGIN plus PATH, never path alone.
  function pageKey(item) {
    if (!item || typeof item !== "object") throw new TypeError("pageKey expects an item");
    return String(item[FIELD.PAGE_ORIGIN]) + "|" + String(item[FIELD.PAGE_PATH]);
  }

  // The same key, from a page object (record.pageFrom's shape) rather than from
  // an item. One spelling of "origin plus path" serves both sides, so the
  // browser layer can ask "is this record mine?" without hand-building an item.
  function pageKeyFor(page) {
    if (!page || typeof page !== "object") throw new TypeError("pageKeyFor expects a page");
    return String(page.origin) + "|" + String(page.path);
  }

  // ---------------------------------------------------------------------------
  // Does this record belong to the page in front of us?
  // ---------------------------------------------------------------------------
  //
  // A review MAY span pages, and the browser layer only ever gets to act on the
  // ONE document it is loaded into. Without this, a second page attached to an
  // existing review inherited every record the first page made: the layer tried
  // to re-anchor them here, the rail listed them, and the count pill counted
  // them (Ken, live, 2026-08-17, 78 foreign items on a one-pager).
  //
  // THE RULE, and it is three rules because file:// is not a normal origin and
  // a directory URL is not a document name:
  //
  //  1. ORIGIN PLUS PATH, exactly pageKey. Two dev servers both serving
  //     /dashboard are two different pages, so they never see each other's
  //     items.
  //  2. A PATH THAT NAMES A DIRECTORY IS THE INDEX DOCUMENT. "/" and "/docs/"
  //     are the server handing back index.html, and that is the document the
  //     reviewer is looking at. Without this a page served at the origin root
  //     had the empty string for a name, so nothing could ever match it and the
  //     reviewer's own items disappeared on the next visit.
  //  3. WHEN EITHER SIDE IS THE FILE ORIGIN, compare the DOCUMENT TAIL: the
  //     last N path segments, N being however many the shorter side has. The
  //     same document is legitimately visited both ways in one review: opened
  //     from disk it carries origin "file" and the tail pageFrom kept, served
  //     over http it carries the server's origin and a full pathname. Those two
  //     keys can never be equal, so a strict match would hide each visit's
  //     comments from the other, on one document.
  //
  // Rule 3 is why pageFrom keeps the parent directory for a file page rather
  // than the basename alone. Two different documents both named index.html,
  // both opened off disk, matched on basename and page B inherited page A's
  // records; with "notes/index.html" against "deck/index.html" they stay apart,
  // while "docs/report.html" off disk still matches "/docs/report.html" served,
  // and a one-segment record ("report.html", written before this rule existed)
  // still matches on its basename alone.
  //
  // The residual case rule 3 still accepts on purpose: two documents whose LAST
  // TWO segments agree (/a/docs/index.html and /b/docs/index.html, both off
  // disk) match. Deeper tails would trade that away for leaking more of the
  // reviewer's disk into a group heading, and hiding the reviewer's items on the
  // document in front of them is the worse failure of the two.

  // The one tail parser. Query and fragment dropped, empty segments dropped, a
  // directory path answered with the index document it serves.
  var INDEX_DOCUMENT = "index.html";

  function segmentsOf(path) {
    var raw = String(path === null || path === undefined ? "" : path)
      .split("?")[0]
      .split("#")[0];
    var parts = raw.split("/").filter(Boolean);
    if (!parts.length || /\/$/.test(raw)) parts.push(INDEX_DOCUMENT);
    return parts;
  }

  function basenameOf(path) {
    var parts = segmentsOf(path);
    return parts[parts.length - 1];
  }

  // The path as a PERSON should read it: enough to tell two documents apart,
  // short enough to sit in a chip. The last two segments, or the raw path when
  // it has none to give.
  function shortPath(path) {
    var raw = String(path === null || path === undefined ? "" : path);
    var parts = raw.split("?")[0].split("#")[0].split("/").filter(Boolean);
    if (!parts.length) return raw || "";
    return parts.slice(Math.max(0, parts.length - 2)).join("/");
  }

  /**
   * @param {Object} item a record
   * @param {Object} page the current page, from record.pageFrom
   * @returns {boolean} true when the record was made on this page
   */
  function samePage(item, page) {
    if (!item || typeof item !== "object") throw new TypeError("samePage expects an item");
    if (!page || typeof page !== "object") throw new TypeError("samePage expects a page");
    if (pageKey(item) === pageKeyFor(page)) return true;
    var itemOrigin = String(item[FIELD.PAGE_ORIGIN]);
    var pageOrigin = String(page.origin);
    if (itemOrigin !== FILE_ORIGIN && pageOrigin !== FILE_ORIGIN) return false;
    var a = segmentsOf(item[FIELD.PAGE_PATH]);
    var b = segmentsOf(page.path);
    var depth = Math.min(a.length, b.length);
    for (var i = 1; i <= depth; i += 1) {
      if (a[a.length - i] !== b[b.length - i]) return false;
    }
    return depth > 0;
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
      // A page opened from disk. The document and its parent directory: enough
      // identity that two index.html files in two folders are two pages
      // (samePage's rule 3), and still not the reviewer's whole disk leaking
      // into a group heading.
      origin = FILE_ORIGIN;
      var href = String(l.href || l.pathname || "");
      path = shortPath(href) || "document";
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
      lost: null,
      // The page states the reviewer has already answered "keep mine" to. See
      // acceptedPageTexts below.
      accepted_page_texts: [],
      // null, or {rev, at, stamp} once the page check has reopened this record.
      // It is what stops the check and an agent from answering each other
      // forever. See pageCheckReopen below.
      check_reopen: null
    };
  }

  // ---------------------------------------------------------------------------
  // The accepted page states: what "Keep mine" has to remember
  // ---------------------------------------------------------------------------
  //
  // The reviewer's decision on a collision has to survive the next repaint, and
  // on a live page there is always a next repaint. Writing the reviewer's
  // version once is not enough: the page's own source still says the agent's
  // sentence, so the very next morph renders it again, replay reads a fourth
  // branch and raises the same collision, forever. (Found by a walker on
  // 2026-08-14 at /?morph=raw&poll=250.)
  //
  // So the record remembers WHICH PAGE STATE the reviewer already answered. The
  // page holding one of those states is not a new collision: it is the same
  // question, already decided, and replay treats it exactly like the `before`
  // (branch two) and re-applies the current `after`.
  //
  // `before` is NOT touched by any of this, per R29: it is the agent's diff base
  // and it stays pristine.
  //
  // ADD-ONLY, AND BOUNDED. Add-only because a decision the reviewer made is not
  // something a later pass gets to un-make. Bounded because a page whose source
  // genuinely churns (a feed, a clock, a cursor in a URL) would otherwise hand
  // the record a new state on every pass and grow it without limit, in browser
  // storage and in every event this record posts. The cap keeps the NEWEST
  // states, because the reviewer's most recent decisions describe the page as it
  // is now; the oldest one falling off means a page state from long ago can
  // raise the collision once more, which is honest (it asks again rather than
  // guessing) and is the price of the bound.
  var ACCEPTED_PAGE_TEXTS_MAX = 8;

  /** The page states this record's reviewer has already accepted. Never null. */
  function acceptedPageTexts(item) {
    var region = item && item[FIELD.REGION];
    var list = region && region.accepted_page_texts;
    return Array.isArray(list) ? list : [];
  }

  /**
   * Remember one page state as answered. Add-only, deduped, capped.
   *
   * Writes a NEW region object rather than pushing into the old one, the way
   * every other region stamp in this tool does, so a caller holding the previous
   * region sees the value it read.
   *
   * @returns {Array} the accepted list as it now stands
   */
  function acceptPageText(item, text) {
    if (!item || typeof text !== "string" || !text) return acceptedPageTexts(item);
    var region = item[FIELD.REGION] || emptyRegion();
    var list = acceptedPageTexts(item).slice();
    if (list.indexOf(text) === -1) list.push(text);
    if (list.length > ACCEPTED_PAGE_TEXTS_MAX) list = list.slice(list.length - ACCEPTED_PAGE_TEXTS_MAX);
    var next = {};
    Object.keys(region).forEach(function (key) {
      next[key] = region[key];
    });
    next.accepted_page_texts = list;
    item[FIELD.REGION] = next;
    return list;
  }

  // ---------------------------------------------------------------------------
  // The page check's stamp: what stops a reopen loop
  // ---------------------------------------------------------------------------
  //
  // The incident this exists for (review rbbe2de599404, 2026-09-10). The
  // reviewer split a numbered list item in two and added a sentence. The agent
  // applied it as a new numbered item instead, which was a legitimate reading
  // and the one the reviewer had actually wanted. The page check then read the
  // record's `after` as missing (it was never on the page as one block) and the
  // record's `before` as still there (the original item was untouched), called
  // that a revert, and reopened the item. The agent replied handled. The check
  // reopened it again. Thirteen revisions in thirty six minutes, each one waking
  // the agent and appending another copy of the same sentence to the note.
  //
  // The fix is one fact on the record: WHICH REVISION THE CHECK ITSELF CREATED.
  // When the check reopens, the record moves to rev R+1 and the stamp says
  // rev R+1. If the agent then answers rev R+1 handled and the page still reads
  // the same way, the check is looking at its own reopen coming back, and that
  // second handled reply is the agent saying "this is how it renders now". The
  // check stays quiet, the way replay stays quiet about a page state the
  // reviewer already answered with Keep mine (accepted_page_texts above).
  //
  // It unblocks itself honestly: any later revision (a reviewer rewording, the
  // reviewer's own Reopen issue) moves rev past the stamp, and the check is free
  // to fire once more. So a genuine revert months later is still caught.
  //
  // `stamp` is the reply this reopen answered (replyStamp below), kept for the
  // record rather than for the rule, so a person reading storage can see which
  // reply the check acted on.

  /** The page check's stamp on this record, or null. */
  function pageCheckReopen(item) {
    var region = item && item[FIELD.REGION];
    var stamp = region && region.check_reopen;
    return stamp && typeof stamp === "object" ? stamp : null;
  }

  /**
   * Which reply this is, as one string: when it landed, plus the revision it
   * answered. A boolean cannot carry it, because an item that is answered,
   * reopened and answered again has to read as a different reply the second
   * time. Null when there is no reply.
   */
  function replyStamp(item) {
    var reply = item && item[FIELD.REPLY];
    if (!reply) return null;
    var rev = item[FIELD.REV];
    return String(reply.at || "") + "@" + String(rev === undefined || rev === null ? "" : rev);
  }

  /**
   * Stamp `item` (already the reopened revision) as reopened by the page check.
   *
   * Writes a NEW region object rather than mutating the old one, like every
   * other region stamp here, so a caller holding the previous region still sees
   * the value it read.
   *
   * @param {Object} item the reopened revision
   * @param {string|null} stamp the reply stamp the check acted on
   * @param {string} at ISO time of the reopen
   */
  function stampPageCheckReopen(item, stamp, at, tool) {
    if (!item) return null;
    var region = item[FIELD.REGION] || emptyRegion();
    var next = {};
    Object.keys(region).forEach(function (key) {
      next[key] = region[key];
    });
    next.check_reopen = {
      rev: item[FIELD.REV],
      at: at || nowIso(),
      stamp: typeof stamp === "string" ? stamp : null,
      // Which round this is, when it is one the reviewer is not part of. See
      // TOOL_ROUNDS.
      tool: TOOL_ROUNDS.indexOf(tool) === -1 ? null : tool
    };
    item[FIELD.REGION] = next;
    return next.check_reopen;
  }

  // ---------------------------------------------------------------------------
  // A TOOL ROUND: an exchange the reviewer is not part of
  // ---------------------------------------------------------------------------
  //
  // Ken, 2026-09-15, pasting a card from review rec7752d7cefe: "This should not
  // be showing up in my chat rail." The card showed the page check asking for a
  // data-lahe-id, and under it the agent's bare "handled". Both were correct:
  // the source was HTML, the agent had carried three other ids into that file
  // and skipped this one, and the check was right to ask. It was still the
  // wrong thing to put in front of a person. That exchange is between the tool
  // and the agent, about plumbing the reviewer never typed and cannot act on.
  //
  // So a revision the TOOL created for the AGENT says so, and the rail draws
  // nothing for it: no round in the thread, no notice, no unseen mark, no
  // toast, and the card stays in the tab the reviewer last saw it in. The
  // agent's own file is unchanged: review.json still carries the round and its
  // note, because the agent is who the round is for.
  //
  // The revert and formatting reopens are NOT tool rounds. Those are about the
  // reviewer's own words going missing from the page, which is theirs to know.
  var TOOL_ROUND = {
    // The check asked for an id the agent did not carry into the source (S7).
    PAGE_CHECK_STAMP: "page_check_stamp"
  };
  var TOOL_ROUNDS = [TOOL_ROUND.PAGE_CHECK_STAMP];

  /**
   * Is the item's CURRENT revision one a tool opened? The tool's name, or null.
   *
   * It stays true once the agent answers, because the answer belongs to the
   * round that asked: the reviewer is not shown the question or the reply. Any
   * later revision (a reviewer rewording, their own Reopen, another check) moves
   * the rev past the stamp and this goes back to null.
   */
  function toolRoundOf(item) {
    var stamp = pageCheckReopen(item);
    if (!stamp || typeof stamp.rev !== "number" || stamp.rev !== item[FIELD.REV]) return null;
    return TOOL_ROUNDS.indexOf(stamp.tool) === -1 ? null : stamp.tool;
  }

  /** The same question about an archived round in a thread. */
  function isToolRound(round) {
    return !!(round && typeof round.tool === "string" && TOOL_ROUNDS.indexOf(round.tool) !== -1);
  }

  /**
   * The note as the REVIEWER wrote it: the tool's own sentence taken back out.
   *
   * The page check appends its sentence to the note, because the record shape
   * has no other field that reaches the agent. That is right for review.json
   * and wrong for the card: Ken's screenshot on 2026-09-15 was this sentence,
   * on his own card, above the agent's "handled". The revert and formatting
   * sentences are NOT stripped: those rounds are the reviewer's business.
   *
   * @returns {string|null} null when nothing of the reviewer's is left
   */
  function reviewerNote(item) {
    var note = item && item[FIELD.NOTE];
    if (typeof note !== "string" || !note) return null;
    var out = note.split(PAGE_CHECK_STAMP_NOTE).join("").replace(/\n{3,}/g, "\n\n").trim();
    return out || null;
  }

  /**
   * What the REVIEWER is shown as this item's state.
   *
   * The record says ready while a tool round is open, and that is true: the
   * agent has work. The reviewer decided this item and their decision has not
   * changed, so their card still says handled and still sits where they left
   * it. One rule, read by the rail's pane placement and by its state chip, so
   * the two cannot disagree.
   */
  function displayState(item) {
    if (!item) return null;
    return toolRoundOf(item) ? STATE.HANDLED : item[FIELD.STATE];
  }

  /**
   * Has the agent already answered the revision the page check itself created?
   *
   * True means the current handled reply IS the answer to the check's reopen,
   * so reopening again would be the loop.
   */
  function answeredPageCheckReopen(item) {
    var stamp = pageCheckReopen(item);
    if (!stamp || typeof stamp.rev !== "number") return false;
    return item[FIELD.REV] === stamp.rev;
  }

  // ---------------------------------------------------------------------------
  // The page check's sentence, and keeping one copy of it
  // ---------------------------------------------------------------------------
  //
  // The sentence a page-check reopen carries. Tool-generated, and it says so in
  // its own first words, because the record shape has no field that could carry
  // "this text is not the reviewer's". It names no page content: the item
  // already carries the before and after text, and repeating page text into the
  // note would push page content into the intent channel (D12).
  var PAGE_CHECK_NOTE =
    "Reopened by the page check: this handled change is no longer on the page and the original text is back. " +
    "Reapply it, or reply not_handled saying why.";

  // The check's other sentence. The words of the edit are on the page and the
  // bold or italic the reviewer applied with them is not, which is a different
  // situation and needs different words: nothing has to be reapplied, the
  // formatting has to be carried. It is the 2026-09-11 case, where an agent
  // working from a Markdown source applied the after text alone and replied
  // handled three times over.
  var PAGE_CHECK_FORMAT_NOTE =
    "Reopened by the page check: the words landed but the bold or italic in this edit did not. " +
    "Carry the formatting into the source, or reply not_handled saying why.";

  // The check's third sentence. The words of the edit are on the page and the
  // element they are on carries no data-lahe-id, so the agent edited the source
  // without carrying the stamp into it. Nothing has to be reapplied and nothing
  // is wrong with the rendering: the id is what lets the next build be found
  // with certainty instead of guessed at, and it is missing (S7).
  var PAGE_CHECK_STAMP_NOTE =
    "Reopened by the page check: the change landed but the data-lahe-id stamp did not reach the source. " +
    "Write the stamp onto that element so the next build reproduces it, or reply not_handled saying why.";

  // Every sentence the page check writes. collapsePageCheckNote reads this
  // list, so a new one is collapsed the day it is added.
  var PAGE_CHECK_NOTES = [PAGE_CHECK_NOTE, PAGE_CHECK_FORMAT_NOTE, PAGE_CHECK_STAMP_NOTE];

  /**
   * The carried note with `sentence` on the end, AT MOST ONCE.
   *
   * The loop above appended the same sentence thirteen times, because the append
   * asked nothing about what was already there. A note that already carries the
   * sentence comes back unchanged.
   */
  function appendNoteOnce(carried, sentence) {
    var line = typeof sentence === "string" ? sentence : "";
    if (!line.trim()) return typeof carried === "string" ? carried : null;
    var note = typeof carried === "string" ? carried : "";
    if (!note.trim()) return line;
    if (note.indexOf(line) !== -1) return note;
    return note + "\n\n" + line;
  }

  /**
   * The next revision of `item` as the PAGE CHECK reopens it.
   *
   * An ordinary reopenIssue, plus the two things that keep the check from
   * running away with itself: the sentence lands at most once, and the record
   * remembers which revision this reopen created. It lives here rather than in
   * the Done tab so the rule a test asserts and the rule the reviewer's page
   * runs are one function.
   *
   * @param {Object} item the handled record
   * @param {string} note the sentence the reopened item carries
   * @param {string} [at] ISO time of the reopen
   */
  function pageCheckReopenOf(item, note, at, tool) {
    var stamp = replyStamp(item);
    var next = reopenIssue(item);
    if (typeof note === "string" && note.trim()) {
      next[FIELD.NOTE] = appendNoteOnce(next[FIELD.NOTE], note);
    }
    stampPageCheckReopen(next, stamp, at, tool);
    return next;
  }

  /**
   * One copy of the page-check sentence, however many a stored record has.
   *
   * Records written before the loop was fixed carry the sentence many times
   * over. This is read on the way out of storage so those cards recover on the
   * next reload rather than needing storage edited by hand. Returns the same
   * object when there was nothing to collapse.
   */
  function collapsePageCheckNote(item) {
    if (!item || typeof item !== "object") return item;
    var note = item[FIELD.NOTE];
    if (typeof note !== "string") return item;
    var collapsed = note;
    for (var i = 0; i < PAGE_CHECK_NOTES.length; i += 1) {
      collapsed = collapseSentence(collapsed, PAGE_CHECK_NOTES[i]);
    }
    if (collapsed === note) return item;
    var out = Object.assign({}, item);
    out[FIELD.NOTE] = collapsed;
    return out;
  }

  // One copy of `sentence` in `note`, however many it holds.
  function collapseSentence(note, sentence) {
    var first = note.indexOf(sentence);
    if (first === -1) return note;
    var second = note.indexOf(sentence, first + sentence.length);
    if (second === -1) return note;
    // Keep the head up to and including the first copy, drop every later copy
    // and the blank line each one was joined on, keep anything else that was
    // written between them.
    var head = note.slice(0, first + sentence.length);
    var tail = note
      .slice(first + sentence.length)
      .split(sentence)
      .join("")
      .replace(/^(\s*\n)+/, "")
      .replace(/\n{3,}/g, "\n\n");
    return tail.trim() ? head + "\n\n" + tail.trim() : head;
  }

  // `subject` is what the region IS, for a record made on a whole element:
  // {tag, src, alt, html, near}, or null when the record was made on a passage
  // of text. `element` beside it is only the tag name, which is what an agent
  // used to get for an image: three of them on a page read identically and the
  // agent had to guess which one the reviewer meant. Every field of it is text
  // off the page, so it is DATA, classified below with the rest.
  function emptyContext() {
    return { quote: null, prefix: null, suffix: null, heading: null, element: null, subject: null };
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
    item[FIELD.REVERTS] = typeof src.reverts === "string" && src.reverts ? src.reverts : null;
    item[FIELD.REPLY] = src.reply || null;
    item[FIELD.HANDLED_NOT_ON_PAGE] = src.handled_not_on_page === true;
    item[FIELD.THREAD] = Array.isArray(src.thread) ? src.thread.slice() : [];
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

  /**
   * THE ONE DEFINITION OF WORK AN AGENT SHOULD ACT ON.
   *
   * Ready and carrying no reply. `ready` is the state the review.json contract
   * names as the one an agent may act on (drafts are the reviewer mid-sentence
   * and never reach the projection), and the reply is what the item carries once
   * an agent has answered this revision. A reworded item drops its reply in the
   * projection, so it comes back here on its own.
   *
   * It lives here rather than in `lahe status` because the helper answers the
   * same question on the wire: the rail's "no agent watching, 3 waiting" and the
   * drain command's item list have to be counting the same items, and they
   * stopped agreeing the moment the route spelled the rule out a second time.
   */
  function isUnansweredReady(item) {
    if (!item || item[FIELD.STATE] !== STATE.READY) return false;
    // A HANDLED CLAIM THE PAGE DOES NOT BEAR OUT IS NOT AN ANSWER. The item
    // carries a reply, so the plain rule above would drop it off the drain list
    // and the agent would never hear that its change did not arrive. It is the
    // one reply that leaves the work exactly where it was.
    if (item[FIELD.HANDLED_NOT_ON_PAGE] === true) return true;
    return !item[FIELD.REPLY];
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

  function threadOf(item) {
    return item && Array.isArray(item[FIELD.THREAD]) ? item[FIELD.THREAD] : [];
  }

  // Historical exchanges are read chronologically everywhere they leave the
  // record. The stored array is normally append-only already, but sorting at
  // the boundary also gives imported and legacy records one deterministic
  // presentation. Equal or missing timestamps retain their original order.
  function chronologicalThread(item) {
    return threadOf(item)
      .map(function (round, index) {
        return { round: round, index: index };
      })
      .sort(function (a, b) {
        var ar = a.round || {};
        var br = b.round || {};
        var aa = (ar.reviewer && ar.reviewer.at) || (ar.agent && ar.agent.at) || null;
        var ba = (br.reviewer && br.reviewer.at) || (br.agent && br.agent.at) || null;
        var ams = Date.parse(aa || "");
        var bms = Date.parse(ba || "");
        var aValid = Number.isFinite(ams);
        var bValid = Number.isFinite(bms);
        if (aValid && bValid && ams !== bms) return ams - bms;
        if (aValid !== bValid) return aValid ? -1 : 1;
        return a.index - b.index;
      })
      .map(function (entry) {
        return entry.round;
      });
  }

  function copyReply(reply) {
    if (!reply) return null;
    return {
      status: reply.status || null,
      agent: reply.agent || null,
      reason: reply.reason || null,
      text: reply.text || null,
      files: Array.isArray(reply.files) ? reply.files.slice() : [],
      at: reply.at || null
    };
  }

  /** The completed current exchange, ready to become immutable history. */
  function completedRound(item) {
    if (!item || !item[FIELD.REPLY]) {
      throw new Error("completedRound: an item needs an agent reply before it can be archived");
    }
    var round = {
      rev: item[FIELD.REV],
      reviewer: {
        note: typeof item[FIELD.NOTE] === "string" ? item[FIELD.NOTE] : null,
        change: typeof item[FIELD.CHANGE] === "string" ? item[FIELD.CHANGE] : null,
        at: item[FIELD.UPDATED_AT] || item[FIELD.CREATED_AT] || null
      },
      agent: copyReply(item[FIELD.REPLY])
    };
    // A round the tool opened travels as one, so the rail still knows not to
    // draw it once it is history. The key is absent on every other round, which
    // is every round made before this existed.
    var tool = toolRoundOf(item);
    if (tool) round.tool = tool;
    return round;
  }

  /**
   * Archive the answered current revision and create the next actionable turn.
   * One helper owns this operation so Follow up and Reopen issue cannot drift.
   */
  function continueThread(item, nextTurn) {
    var turn = nextTurn || {};
    var history = chronologicalThread(item);
    history.push(completedRound(item));
    var next = bumpRev(item, {
      note: typeof turn.note === "string" ? turn.note : null,
      change: typeof turn.change === "string" ? turn.change : null,
      thread: history
    });
    next[FIELD.STATE] = STATE.READY;
    next[FIELD.REPLY] = null;
    return next;
  }

  /**
   * The reviewer says something more about an item the agent already answered.
   *
   * The change sentence is CARRIED, exactly as Reopen issue carries it. It
   * describes the edit the reviewer made, and a follow-up does not undo that
   * edit, so dropping it leaves the new revision saying nothing about what the
   * reviewer actually did. That is what happened on 2026-09-11: the reviewer
   * asked "did my bolding come through?", the revision that question created
   * carried an empty change, and the only line describing the edit was gone
   * from the one revision where it mattered most.
   */
  function followUp(item, text) {
    var note = typeof text === "string" ? text : "";
    if (!note.trim()) return item;
    return continueThread(item, {
      note: note,
      change: typeof item[FIELD.CHANGE] === "string" ? item[FIELD.CHANGE] : null
    });
  }

  function reopenIssue(item) {
    return continueThread(item, {
      note: typeof item[FIELD.NOTE] === "string" ? item[FIELD.NOTE] : null,
      change: typeof item[FIELD.CHANGE] === "string" ? item[FIELD.CHANGE] : null
    });
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

  // ---------------------------------------------------------------------------
  // The reviewer's change, for the intent channel (D12)
  // ---------------------------------------------------------------------------
  //
  // An edit commits with no note typed, so without this its only intent field is
  // empty and the agent is left reading the data-class `after`/`before` the
  // contract tells it never to treat as an instruction. That is the D12
  // laundering the redraw exists to prevent.
  //
  // The whole `after` is NOT the answer: it is mostly the page's own words with
  // the reviewer's change mixed in, so carrying it as intent would launder page
  // text into the instruction channel on the back of the edit. So `change` names
  // only what the reviewer actually did: the span that moved between `before`
  // and `after`, stated in one short line. It is the reviewer's own action, so
  // it is intent, and (like every intent field) it is carried verbatim and never
  // truncated.

  // What counts as being inside a word. Letters, digits and the apostrophes a
  // word carries; everything else (space, punctuation, a break) is a boundary.
  var WORD_CHAR = /[A-Za-z0-9_\u00C0-\u024F\u0370-\u1FFF\u2C00-\uD7FF'\u2019]/;

  function isWordChar(ch) {
    return !!ch && WORD_CHAR.test(ch);
  }

  // The changed span between two strings: the shared prefix and suffix trimmed
  // away, leaving what was removed and what was added. Pure, so editing.js and a
  // test agree on the same answer.
  //
  // THE SPAN IS WIDENED TO WHOLE WORDS, and that is not cosmetic. On
  // 2026-09-14 (review r9d5cbe5ebc64) the reviewer pasted a new paragraph above
  // one that began "A friend asked me last week". Both start with "A", so the
  // shared prefix was that letter and the shared suffix was " friend asked...",
  // and the sentence the agent reads reported the addition as
  // 'rticle drop! ... A': it began mid-word and ended on a stray letter.
  // Retreating each boundary to the nearest non-word character costs a few
  // characters of precision and buys a sentence that says what happened.
  function changedSpan(before, after) {
    var b = typeof before === "string" ? before : "";
    var a = typeof after === "string" ? after : "";
    var start = 0;
    var maxStart = Math.min(b.length, a.length);
    while (start < maxStart && b.charAt(start) === a.charAt(start)) start += 1;
    // Back the prefix out of a word it split, BEFORE the suffix is measured:
    // moving start left keeps the two strings equal in front of it, and it
    // gives the suffix scan below the room to take in the rest of that word.
    while (start > 0 && isWordChar(b.charAt(start - 1)) && (isWordChar(b.charAt(start)) || isWordChar(a.charAt(start)))) {
      start -= 1;
    }
    var endB = b.length;
    var endA = a.length;
    while (endB > start && endA > start && b.charAt(endB - 1) === a.charAt(endA - 1)) {
      endB -= 1;
      endA -= 1;
    }
    // And push the suffix out of a word it split, the same way.
    while (
      endB < b.length &&
      endA < a.length &&
      isWordChar(b.charAt(endB)) &&
      (isWordChar(b.charAt(endB - 1)) || isWordChar(a.charAt(endA - 1)))
    ) {
      endB += 1;
      endA += 1;
    }
    return { removed: b.slice(start, endB), added: a.slice(start, endA) };
  }

  // ---------------------------------------------------------------------------
  // A whole paragraph added above or below, said as that
  // ---------------------------------------------------------------------------
  //
  // The gesture from the same report: the reviewer wrote a new paragraph above
  // an existing one and changed nothing else. A span diff can only describe
  // that as a long addition beside a paragraph break, which is two sentences
  // for one plain thing. This says the plain thing, and it names the paragraph
  // the new one sits against so the agent knows WHERE to put it in the source.
  //
  // It fires only when the block's whole previous text is still there, in one
  // piece, with a paragraph break between it and the new words. A split, a
  // reword, or an insertion in the middle is not this, and falls through to the
  // span diff.
  var PARAGRAPH_BREAK_HEAD = /^\n{2,}/;
  var PARAGRAPH_BREAK_TAIL = /\n{2,}$/;

  // How much of the existing paragraph the sentence quotes. It is there to say
  // which paragraph, not to repeat it: the record's own before and after carry
  // the full text, and the agent is reading them beside this line.
  var QUOTE_LEAD_MAX = 60;

  function quoteLead(text) {
    var s = String(text).replace(/\s+/g, " ").trim();
    if (s.length <= QUOTE_LEAD_MAX) return s;
    var cut = s.slice(0, QUOTE_LEAD_MAX);
    var space = cut.lastIndexOf(" ");
    if (space > QUOTE_LEAD_MAX / 3) cut = cut.slice(0, space);
    return cut + "...";
  }

  /**
   * A paragraph added before or after everything the block already said.
   *
   * @returns {?{where: string, text: string}} null when this is not that edit
   */
  function paragraphAddition(before, after) {
    var b = typeof before === "string" ? before.trim() : "";
    var a = typeof after === "string" ? after.trim() : "";
    if (!b || !a || a === b || a.length <= b.length) return null;
    if (a.slice(0, b.length) === b) {
      var tail = a.slice(b.length);
      var head = PARAGRAPH_BREAK_HEAD.exec(tail);
      if (head) {
        var below = tail.slice(head[0].length).trim();
        if (below) return { where: "after", text: below };
      }
    }
    if (a.slice(a.length - b.length) === b) {
      var lead = a.slice(0, a.length - b.length);
      var joint = PARAGRAPH_BREAK_TAIL.exec(lead);
      if (joint) {
        var above = lead.slice(0, lead.length - joint[0].length).trim();
        if (above) return { where: "before", text: above };
      }
    }
    return null;
  }

  function paragraphChangeText(addition, existing) {
    return (
      'Added a paragraph ' +
      addition.where +
      ' "' +
      quoteLead(existing) +
      '": "' +
      addition.text +
      '".'
    );
  }

  // A break the reviewer typed, said in words. Quoting it would print a
  // newline inside the quotes, where nobody can see it, and a reviewer reading
  // the rail would be told their change was 'Changed " " to " "'.
  var BREAK_ADDED_PARAGRAPH = "Added a paragraph break: this block becomes two paragraphs.";
  var BREAK_ADDED_LINE = "Added a line break.";
  var BREAK_REMOVED = "Removed a break, joining the lines into one.";

  function breakChangeText(span) {
    var addedBreak = span.added.indexOf("\n") !== -1;
    var removedBreak = span.removed.indexOf("\n") !== -1;
    if (!addedBreak && !removedBreak) return "";
    if (addedBreak) return span.added.indexOf("\n\n") !== -1 ? BREAK_ADDED_PARAGRAPH : BREAK_ADDED_LINE;
    return BREAK_REMOVED;
  }

  // ---------------------------------------------------------------------------
  // The formatting the reviewer changed, said in words
  // ---------------------------------------------------------------------------
  //
  // On 2026-09-11 the reviewer made one word italic and one clause bold inside a
  // rewrite. The record carried both: `after` held the plain words and
  // `after_html` held the <em> and <strong>. The change sentence quoted only the
  // wording, so the one line the agent reads as INTENT said nothing about the
  // emphasis, the agent applied the text alone and replied handled, and the bold
  // and italics were gone from the page and the source with nothing anywhere
  // saying so.
  //
  // So the sentence says it. The vocabulary is normalize's closed list
  // (strong, em, and the not-bold / not-italic resets), read through
  // emphasisRuns, which means every other difference between the two markups
  // (a link, a span, a class the page's own renderer added) is already gone and
  // cannot be reported as a formatting change.
  var FORMAT_ADDED = { strong: "bold", em: "italic" };
  var FORMAT_REMOVED = { "not-bold": "bold", "not-italic": "italic" };
  // The reset tag that says "these words are deliberately not this", per tag.
  var RESET_FOR = { strong: normalize.NOT_BOLD_TAG, em: normalize.NOT_ITALIC_TAG };

  function runKey(run) {
    return run.tag + " " + run.text;
  }

  // How many of each run a list holds, so two identical bold runs in one block
  // are two runs and not one.
  function runCounts(runs) {
    var counts = {};
    for (var i = 0; i < runs.length; i += 1) {
      var key = runKey(runs[i]);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  function takeOne(counts, run) {
    var key = runKey(run);
    if (!counts[key]) return false;
    counts[key] -= 1;
    return true;
  }

  /**
   * The inline formatting that moved between two markups, in plain sentences.
   *
   * Returns "" when nothing did, which is every ordinary wording edit.
   *
   * @param {string} beforeHtml the region's markup before the edit
   * @param {string} afterHtml the region's markup after it
   */
  function formattingChangeText(beforeHtml, afterHtml) {
    if (typeof afterHtml !== "string" || !afterHtml) return "";
    var before = normalize.emphasisRuns(typeof beforeHtml === "string" ? beforeHtml : "");
    var after = normalize.emphasisRuns(afterHtml);
    var beforeLeft = runCounts(before);
    var afterLeft = runCounts(after);
    var lines = [];
    var i;
    // Each loop consumes from ITS OWN copy of the other side's counts, so the
    // two differences are read independently and a run present on both sides is
    // reported by neither.
    for (i = 0; i < after.length; i += 1) {
      if (takeOne(beforeLeft, after[i])) continue;
      if (hasOwn(FORMAT_ADDED, after[i].tag)) {
        lines.push('Made "' + after[i].text + '" ' + FORMAT_ADDED[after[i].tag] + ".");
      } else if (hasOwn(FORMAT_REMOVED, after[i].tag)) {
        lines.push('Removed ' + FORMAT_REMOVED[after[i].tag] + ' from "' + after[i].text + '".');
      }
    }
    // A run the before had and the after does not: the reviewer took the tag
    // off words that carried it. The reset tags say the same thing about words
    // a stylesheet made bold, and they are already reported above.
    // Taking bold off words a stylesheet made bold writes BOTH a <not-bold> in
    // the after and, when the words carried a <strong> too, the loss of that
    // tag. One gesture, so one sentence: a reset already reported above cancels
    // the matching loss here.
    var resets = runCounts(after);
    for (i = 0; i < before.length; i += 1) {
      if (takeOne(afterLeft, before[i])) continue;
      if (!hasOwn(FORMAT_ADDED, before[i].tag)) continue;
      if (takeOne(resets, { tag: RESET_FOR[before[i].tag], text: before[i].text })) continue;
      lines.push('Removed ' + FORMAT_ADDED[before[i].tag] + ' from "' + before[i].text + '".');
    }
    return lines.join(" ");
  }

  function hasOwn(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  function editChangeText(kind, before, after, beforeHtml, afterHtml) {
    if (kind === KIND.DELETE) return "Deleted this block.";
    if (kind === KIND.FORMAT_ONLY) return "Changed the emphasis in this block; the words are the same.";
    // A whole paragraph added above or below is one plain sentence, not a
    // break sentence plus a long quotation.
    var addition = paragraphAddition(before, after);
    if (addition) {
      var lines = [paragraphChangeText(addition, before)];
      var addedEmphasis = formattingChangeText(beforeHtml, afterHtml);
      if (addedEmphasis) lines.push(addedEmphasis);
      return lines.join(" ");
    }
    var span = changedSpan(before, after);
    var breakLine = breakChangeText(span);
    var added = span.added;
    var removed = span.removed;
    if (breakLine) {
      // The break is already stated in words, so what is left to quote is the
      // wording either side of it, if any of it moved.
      added = added.replace(/\s+/g, " ").trim();
      removed = removed.replace(/\s+/g, " ").trim();
    }
    var words = "";
    if (added && removed) words = 'Changed "' + removed + '" to "' + added + '".';
    else if (added) words = 'Added "' + added + '".';
    else if (removed) words = 'Removed "' + removed + '".';
    var emphasis = formattingChangeText(beforeHtml, afterHtml);
    var parts = [];
    if (breakLine) parts.push(breakLine);
    if (words) parts.push(words);
    if (emphasis) parts.push(emphasis);
    if (parts.length) return parts.join(" ");
    return "Edited this block.";
  }

  // ---------------------------------------------------------------------------
  // Taking a handled change back (R28, R38)
  // ---------------------------------------------------------------------------
  //
  // The reviewer undoes a hand edit the agent already applied. Their page goes
  // back to the original wording, and that leaves the SOURCE holding a change
  // nobody wants any more: the next rebuild would put it back on the page, and
  // the agent would never hear that it was taken back.
  //
  // So an undo of a handled edit mints work. The record it makes is an ordinary
  // outstanding hand edit pointing the other way: what the source says now is
  // its `before`, what it should say again is its `after`. Everything already
  // built reads it without a special case. Replay compares it against the page
  // and finds it already applied (the reviewer's undo did that half). The Edits
  // tab draws it as a before-and-after row. The agent applies it the way it
  // applies any edit, and the result is the change coming out of the file.
  //
  // WHY NOT A NEW KIND. `kind` decides how a record COMPARES and how a row
  // reads, and a revert compares exactly like the edit it undoes: a format-only
  // revert has to compare on structure, or its identical before and after text
  // make it a silent no-op. `reverts` carries the one thing kind cannot, which
  // is WHICH handled item this takes back, and it carries it as an id so the
  // agent can find that item in the same file rather than being told about it
  // in prose.
  //
  // WHY THE HANDLED RECORD IS KEPT. It is the record that a fix landed (R38),
  // and it is the only place the applied wording is written down. It also stops
  // the page check reopening it: replay.revertedHandledEditIds skips an item
  // that another record reverts, so the reviewer's deliberate take-back is not
  // read as the page having lost an applied fix.

  var REVERT_EDIT = "Undo: the reviewer took this change back. Remove it from the source, so the passage reads as it did before.";
  var REVERT_DELETE = "Undo: the reviewer put this block back. Restore it in the source; it should not have been deleted.";
  var REVERT_FORMAT = "Undo: the reviewer took this formatting change back. Put the markup back the way the source had it.";

  function revertChangeText(kind) {
    if (kind === KIND.DELETE) return REVERT_DELETE;
    if (kind === KIND.FORMAT_ONLY) return REVERT_FORMAT;
    return REVERT_EDIT;
  }

  /**
   * The work an undo of a handled hand edit makes: put the source back.
   *
   * Pure. The caller supplies the region and context, because those are read off
   * the live page and this file never touches a DOM.
   *
   * @param {Object} item the HANDLED record the reviewer just undid
   * @param {{region?: Object, context?: Object, created_at?: string}} [extra]
   * @returns {Object} a new ready record whose before/after point the other way
   */
  function revertOf(item, extra) {
    var src = extra || {};
    // A delete has no `after` text: what the source holds now is nothing, and
    // what it should hold again is the block. Everything else is the swap.
    var isDelete = item[FIELD.KIND] === KIND.DELETE;
    var before = isDelete ? "" : item[FIELD.AFTER];
    var beforeHtml = isDelete ? "" : item[FIELD.AFTER_HTML];
    return newItem({
      // A reverted delete is an EDIT: it puts words back, and comparing it as a
      // delete would make it idempotent by absence, which is the opposite of
      // what it asks for.
      kind: isDelete ? KIND.EDIT : item[FIELD.KIND],
      state: STATE.READY,
      change: revertChangeText(item[FIELD.KIND]),
      before: typeof before === "string" ? before : "",
      after: typeof item[FIELD.BEFORE] === "string" ? item[FIELD.BEFORE] : "",
      before_html: typeof beforeHtml === "string" ? beforeHtml : null,
      after_html: typeof item[FIELD.BEFORE_HTML] === "string" ? item[FIELD.BEFORE_HTML] : null,
      reverts: item[FIELD.ID],
      region: src.region || null,
      context: src.context || null,
      page_origin: item[FIELD.PAGE_ORIGIN],
      page_path: item[FIELD.PAGE_PATH],
      page_title: item[FIELD.PAGE_TITLE],
      page_seq: item[FIELD.PAGE_SEQ],
      source_hint: item[FIELD.SOURCE_HINT],
      created_at: src.created_at
    });
  }

  /** Is this record a take-back rather than a fresh change? */
  function isRevert(item) {
    return !!item && typeof item[FIELD.REVERTS] === "string" && !!item[FIELD.REVERTS];
  }

  /**
   * The ids these records take back, as a lookup.
   *
   * One pass, so a caller with a list never has to write the scan itself and
   * two callers cannot disagree about what "taken back" means.
   */
  function takenBackIds(items) {
    var out = {};
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i += 1) {
      if (isRevert(list[i])) out[list[i][FIELD.REVERTS]] = true;
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
    // Missing is accepted for legacy records. Every newly minted record carries
    // an empty array, and threadOf presents old records the same way.
    if (item[FIELD.THREAD] !== undefined && !Array.isArray(item[FIELD.THREAD])) {
      problems.push("thread must be an array of completed exchanges");
    }
    threadOf(item).forEach(function (round, index) {
      if (!round || typeof round !== "object") {
        problems.push("thread[" + index + "] must be an object");
        return;
      }
      if (typeof round.rev !== "number" || round.rev < 1) problems.push("thread[" + index + "].rev must be >= 1");
      if (!round.reviewer || typeof round.reviewer !== "object") problems.push("thread[" + index + "].reviewer is required");
      if (!round.agent || typeof round.agent !== "object") problems.push("thread[" + index + "].agent is required");
      if (round.agent && REPLY_STATUSES.indexOf(round.agent.status) === -1) {
        problems.push("thread[" + index + "].agent.status must be one of " + REPLY_STATUSES.join(", "));
      }
    });
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
    isHandEdit: isHandEdit,
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
    pageKeyFor: pageKeyFor,
    STAMP_SOURCE_EXTENSIONS: STAMP_SOURCE_EXTENSIONS,
    sourceCanCarryStamp: sourceCanCarryStamp,
    pageCanCarryStamp: pageCanCarryStamp,
    itemCanCarryStamp: itemCanCarryStamp,
    samePage: samePage,
    basenameOf: basenameOf,
    shortPath: shortPath,
    newItem: newItem,
    bumpRev: bumpRev,
    threadOf: threadOf,
    chronologicalThread: chronologicalThread,
    completedRound: completedRound,
    continueThread: continueThread,
    followUp: followUp,
    reopenIssue: reopenIssue,
    historyEntry: historyEntry,
    priorAfters: priorAfters,
    ACCEPTED_PAGE_TEXTS_MAX: ACCEPTED_PAGE_TEXTS_MAX,
    acceptedPageTexts: acceptedPageTexts,
    acceptPageText: acceptPageText,
    PAGE_CHECK_NOTE: PAGE_CHECK_NOTE,
    PAGE_CHECK_FORMAT_NOTE: PAGE_CHECK_FORMAT_NOTE,
    PAGE_CHECK_STAMP_NOTE: PAGE_CHECK_STAMP_NOTE,
    TOOL_ROUND: TOOL_ROUND,
    TOOL_ROUNDS: TOOL_ROUNDS,
    toolRoundOf: toolRoundOf,
    isToolRound: isToolRound,
    displayState: displayState,
    reviewerNote: reviewerNote,
    PAGE_CHECK_NOTES: PAGE_CHECK_NOTES,
    pageCheckReopen: pageCheckReopen,
    stampPageCheckReopen: stampPageCheckReopen,
    answeredPageCheckReopen: answeredPageCheckReopen,
    replyStamp: replyStamp,
    appendNoteOnce: appendNoteOnce,
    pageCheckReopenOf: pageCheckReopenOf,
    collapsePageCheckNote: collapsePageCheckNote,
    changedSpan: changedSpan,
    paragraphAddition: paragraphAddition,
    formattingChangeText: formattingChangeText,
    editChangeText: editChangeText,
    REVERT_EDIT: REVERT_EDIT,
    REVERT_DELETE: REVERT_DELETE,
    REVERT_FORMAT: REVERT_FORMAT,
    revertChangeText: revertChangeText,
    revertOf: revertOf,
    isRevert: isRevert,
    takenBackIds: takenBackIds,
    BREAK_ADDED_PARAGRAPH: BREAK_ADDED_PARAGRAPH,
    BREAK_ADDED_LINE: BREAK_ADDED_LINE,
    BREAK_REMOVED: BREAK_REMOVED,
    comparisonFields: comparisonFields,
    validateItem: validateItem,
    isDraft: isDraft,
    isReady: isReady,
    isUnansweredReady: isUnansweredReady,
    isOutstanding: isOutstanding,
    comparisonMode: comparisonMode,
    normalizedBefore: normalizedBefore,
    normalizedAfter: normalizedAfter
  };
});
