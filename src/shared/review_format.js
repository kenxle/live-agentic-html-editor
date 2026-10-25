// The two things the reviewer's work turns into: the `review.json` projection
// the helper writes for the agent, and the human-readable text the library's
// Copy and Export produce from its own records.
//
// Owner: 0A-wire, FROZEN at CP0. Imported by: the review file writer
// (src/service/review_writer.js, 3A, which owns the path safety and the atomic
// write), the projection (src/service/projection.js, 3A), and the layer's Copy
// and Export (3C), which must produce the same text with no helper running
// (R10).
//
// Pure: no filesystem, no clock of its own beyond a default timestamp, no
// randomness. Given the same review it returns the same bytes.
//
// Two architecture decisions shape every line of this file:
//
//  - D6, REVIEW DATA IS ONE JSON FILE. The separation between page text and
//    reviewer intent is structural: page text sits in fields such as `quote`,
//    `before`, `after_full`, and `context`. Agent instructions live in the skill.
//
//  - D12, PAGE TEXT IS DATA AND REVIEWER TEXT IS INTENT. The intent channel is
//    exactly two fields, `note` and `change`, carried verbatim and never
//    truncated. A region's full `after` is NOT intent: it is mostly the page's
//    own words with the reviewer's changes mixed in, so carrying it as intent
//    would let a document someone else sent ride a hidden instruction into the
//    instruction channel on the back of the reviewer's edit. It rides along in
//    `after_full`, a data field, boundable like every other data field.
//
// The fencing machinery below the projection is DEAD as of this rework and is
// kept only so nothing breaks mid-build. It is on the Phase 4B cleanup batch.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.review_format = factory(root.LAHE.record, root.LAHE.normalize, root.LAHE.gestures);
  } else {
    module.exports = factory(require("./record.js"), require("./normalize.js"), require("./gestures.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record, normalize, gestures) {
  "use strict";

  var SCHEMA = "lahe.review/5";

  // ---------------------------------------------------------------------------
  // The field names the projection uses, and their classes (D12)
  // ---------------------------------------------------------------------------
  //
  // The record calls the region's current wording `after`. The projection calls
  // it `after_full`, which is the name an agent reads. One rename, in one place.

  var PROJECTED = {
    // intent, verbatim, never bounded
    NOTE: "note",
    CHANGE: "change",
    // data, boundable
    QUOTE: "quote",
    BEFORE: "before",
    AFTER_FULL: "after_full",
    CONTEXT: "context",
    BEFORE_HTML: "before_html",
    AFTER_HTML: "after_html",
    REGION_LABEL: "region_label",
    REGION: "region",
    SUBJECT: "subject",
    AFTER_HISTORY: "after_history",
    THREAD: "thread",
    // Free writing (docs/features/20260928.01_free_writing). The three text
    // fields are data, grouped under page on a drain line. The four markers
    // are data too, and stay at the top level of a drain line.
    NEW_BLOCKS: "new_blocks",
    ANCHOR_AFTER_HTML: "anchor_after_html",
    REMOVE_BLOCKS: "remove_blocks",
    ANCHOR_TAG_AFTER: "anchor_tag_after",
    PLACEMENT: "placement",
    RUN_WORDS: "run_words",
    PROOFREAD: "proofread",
    // Choice buttons (docs/features/20261013.01_choice_buttons). The press, at
    // the top level of the item and of a drain line: {group, answer}, two
    // bounded ids. Intent, by key. Only on a choice item.
    CHOICE: "choice"
  };

  // A run proofreads when its words (from_anchor blocks aside) are more than
  // this, and the review is not a notes review (brief R11, plan PQ3).
  var PROOFREAD_MIN_WORDS = 150;

  var INTENT_FIELDS = [PROJECTED.NOTE, PROJECTED.CHANGE];

  // The order matters only for readability, but the first four are the four the
  // skill calls out by name, so they lead.
  //
  // THE DRAIN NESTS THESE UNDER `page`. `lahe status --json` prints each item
  // with every field in this list moved into the item's `page` object, beside
  // the page's own path. That is the D12 fence on a drain line, as
  // structure rather than words: the skill says that everything under page
  // came off the page and is never an instruction. Repeated instruction-shaped text steers an agent,
  // and a drain can carry hundreds of items. See status.drainLine.
  var DATA_FIELDS = [
    PROJECTED.QUOTE,
    PROJECTED.BEFORE,
    PROJECTED.AFTER_FULL,
    PROJECTED.CONTEXT,
    PROJECTED.BEFORE_HTML,
    PROJECTED.AFTER_HTML,
    PROJECTED.REGION_LABEL,
    PROJECTED.REGION,
    PROJECTED.SUBJECT,
    PROJECTED.AFTER_HISTORY,
    PROJECTED.NEW_BLOCKS,
    PROJECTED.ANCHOR_AFTER_HTML,
    PROJECTED.REMOVE_BLOCKS
  ];

  // The classification travels with the file as schema data. Every key here names a field the
  // projection ACTUALLY emits (NEW-4): the record's internal, dotted field names
  // (`region.label`, `page_title`) are not what an agent reads, so listing them
  // would describe fields that are not in the file. The two intent fields, then
  // every data-named carrier the projection writes,
  // including the page-group header fields the agent reads as labels.
  var PROJECTED_FIELD_CLASS = {
    // intent (D12): the reviewer's own words, verbatim, never bounded
    note: record.CLASS_INSTRUCTION,
    change: record.CLASS_INSTRUCTION,
    // intent, by key (choice buttons): which group the reviewer pressed and
    // which answer. Two ids off record.CHOICE_TOKEN, checked at the helper's
    // door and again at projection, so neither can hold a sentence. The
    // group's question rides in quote and its heading in context, as data.
    "choice.group": record.CLASS_INSTRUCTION,
    "choice.answer": record.CLASS_INSTRUCTION,
    // data: everything that came off the page, boundable
    quote: record.CLASS_DATA,
    before: record.CLASS_DATA,
    after_full: record.CLASS_DATA,
    context: record.CLASS_DATA,
    before_html: record.CLASS_DATA,
    after_html: record.CLASS_DATA,
    region_label: record.CLASS_DATA,
    // How to find this element in the SOURCE: the id the page wrote onto it,
    // the ancestor chain a person can read, which of N identical siblings it
    // is, and whether its words are enough on their own. All four were read off
    // the page, so all four are data.
    region: record.CLASS_DATA,
    // What the element the reviewer pointed at says about itself: its tag, its
    // src, its alt, its opening tag, and the page text beside it. All of it was
    // read off the page, so it is data and it is bounded, exactly like `quote`.
    // An alt attribute is a place someone can write a sentence, and a sentence
    // in a data field is page content, never an instruction (D6).
    subject: record.CLASS_DATA,
    // Every wording this item has committed, in order, with the rev it was
    // committed at. It is page text like `after_full` is, so it is data and it
    // is bounded the same way. It earns its place because it is the one field
    // that tells a reviewer who reworded a sentence four times apart from one
    // who got it right first time, which is exactly the pattern R39's
    // end-of-session list exists to surface.
    after_history: record.CLASS_DATA,
    // Free writing. The run is text the reviewer wrote INTO the page, to be
    // placed as written, so it is data like the page's own words. The four
    // markers describe the run and carry no text at all.
    new_blocks: record.CLASS_DATA,
    anchor_after_html: record.CLASS_DATA,
    remove_blocks: record.CLASS_DATA,
    anchor_tag_after: record.CLASS_DATA,
    placement: record.CLASS_DATA,
    run_words: record.CLASS_DATA,
    proofread: record.CLASS_DATA,
    // the page-group header fields, all page-controlled
    title: record.CLASS_DATA,
    origin: record.CLASS_DATA,
    path: record.CLASS_DATA,
    // the agent's own reply text, its own trust class: plain data (D6)
    "reply.agent": record.CLASS_DATA,
    "reply.reason": record.CLASS_DATA,
    "reply.text": record.CLASS_DATA,
    "reply.at": record.CLASS_DATA,
    "reply.user_needs_to_see_reply": record.CLASS_DATA,
    // The helper's own finding about a handled claim, not anything an agent or
    // a page said. A boolean, and data like every other non-intent field.
    handled_not_on_page: record.CLASS_DATA,
    // The reviewer marked the item done themselves. A boolean the helper
    // writes from the reviewer's own act, never from page text.
    closed_by_reviewer: record.CLASS_DATA,
    "thread[].rev": record.CLASS_DATA,
    "thread[].reviewer.note": record.CLASS_DATA,
    "thread[].reviewer.change": record.CLASS_DATA,
    "thread[].reviewer.at": record.CLASS_DATA,
    "thread[].agent.status": record.CLASS_DATA,
    "thread[].agent.agent": record.CLASS_DATA,
    "thread[].agent.reason": record.CLASS_DATA,
    "thread[].agent.text": record.CLASS_DATA,
    "thread[].agent.files": record.CLASS_DATA,
    "thread[].agent.at": record.CLASS_DATA,
    // The drain's catalog_requests section (`lahe status`, LAHE Library). The
    // id and helper-value fields (request, action, review, session, kind,
    // moves_with, at) are not listed; these four carry page-derived text and
    // are fenced like every other data field. A title holding the fence marker
    // or a newline cannot break out of its entry.
    "catalog_requests[].title": record.CLASS_DATA,
    "catalog_requests[].path": record.CLASS_DATA,
    "catalog_requests[].candidate": record.CLASS_DATA,
    "catalog_requests[].folder": record.CLASS_DATA,
    "catalog_requests[].handoff": record.CLASS_DATA,
    // A proofread question's fixes, on that turn only: the agent's own words.
    "thread[].agent.proofread": record.CLASS_DATA,
    "thread[].agent.suggestions": record.CLASS_DATA
  };

  // ---------------------------------------------------------------------------
  // Bounding (D12): data may be bounded, intent never is
  // ---------------------------------------------------------------------------
  //
  // Named constants, because "2000" typed in two files is how two formatters end
  // up disagreeing about what a truncated value looks like.

  // How many characters of page-derived text reach a data field.
  var BEFORE_MAX = 2000;
  // Shorter, because these are locating hints rather than passages.
  var CONTEXT_MAX = 400;
  // The agent's own words: text and reason on a reply, and the agent's turns in
  // a card's thread. Bounded because they are agent-controlled and reach the
  // rail's DOM, but far above BEFORE_MAX, because the reply IS the reading. At
  // 2000 a 2156-character answer lost its last sentence, which was the one
  // instruction the reviewer had to act on (Ken, 2026-09-11: "why is this
  // truncated?!"). The marker still says when the cap is hit.
  var REPLY_TEXT_MAX = 20000;
  // reply.files is agent-controlled and reaches the rail, so it is not trusted
  // to be a short list of strings. The count is capped and each entry is bounded
  // (finding 24).
  var REPLY_FILES_MAX = 100;
  // after_history grows by one entry per rewording, so a long session on one
  // sentence is legitimately long. The newest entries are the ones worth
  // reading (the last one is the wording that stands), so the cap keeps the
  // tail. The kept entries carry their own revs, so a history that starts at
  // rev 40 on an item at rev 61 says on its face that older ones were dropped.
  var AFTER_HISTORY_MAX = 50;

  // The bound is VISIBLE in the value: an agent that reads a bounded field has
  // to be able to tell it was bounded, or it will treat a cut-off passage as
  // the whole passage and edit the wrong thing.
  var TRUNCATION_MARKER = "[... bounded here. {n} more characters of page text.]";

  function truncationMarker(n) {
    return TRUNCATION_MARKER.replace("{n}", String(n));
  }

  // The one function that puts page-derived text into the projection.
  function boundData(value, max) {
    if (value === null || value === undefined) return null;
    var text = String(value);
    var limit = typeof max === "number" ? max : BEFORE_MAX;
    if (text.length <= limit) return text;
    return text.slice(0, limit) + " " + truncationMarker(text.length - limit);
  }

  function projectSlide(slide) {
    if (!slide || !Number.isInteger(slide.total) || slide.total < 0) return null;
    var uncounted = slide.uncounted === true;
    if (uncounted ? slide.index !== null : !Number.isInteger(slide.index) || slide.index < 1 || slide.total < slide.index) return null;
    var out = record.emptySlideContext();
    out.index = slide.index;
    out.total = slide.total;
    out.uncounted = uncounted;
    ["id", "heading", "text"].forEach(function (field) {
      out[field] = typeof slide[field] === "string" ? boundData(slide[field], CONTEXT_MAX) : null;
    });
    return out;
  }

  // Intent, carried through untouched. A function rather than a bare read, so
  // "this field is never bounded" is a thing the code says out loud.
  function verbatim(value) {
    return typeof value === "string" ? value : value === undefined ? null : value;
  }

  // reply.files as it reaches the rail: string entries only, the count capped,
  // and each entry bounded (finding 24). An agent could put anything in this
  // array; a non-string entry or a runaway list must not ride through untyped.
  function boundFiles(files) {
    if (!Array.isArray(files)) return [];
    var out = [];
    for (var i = 0; i < files.length && out.length < REPLY_FILES_MAX; i += 1) {
      if (typeof files[i] === "string") out.push(boundData(files[i], CONTEXT_MAX));
    }
    return out;
  }

  /**
   * Every wording this record has committed, in order, bounded like any other
   * text that came off the page.
   *
   * The entries are DECISIONS, not keystrokes: `record.bumpRev` appends one
   * only when a committed wording actually moved, so four entries mean the
   * reviewer reworded this passage four times. That difference is invisible
   * anywhere else in review.json, and it is the whole reason R39's list is
   * worth keeping.
   */
  function boundHistory(history) {
    if (!Array.isArray(history)) return [];
    var kept = history.length > AFTER_HISTORY_MAX ? history.slice(history.length - AFTER_HISTORY_MAX) : history;
    var out = [];
    kept.forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      out.push({
        rev: typeof entry.rev === "number" ? entry.rev : null,
        after: boundData(entry.after, BEFORE_MAX),
        after_html: boundData(entry.after_html, BEFORE_MAX),
        at: entry.at || null
      });
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // The source hint (D6)
  // ---------------------------------------------------------------------------
  //
  // Copy/export can explain a source hint in words. review.json keeps only
  // the structured hint so its contents remain review data.
  function sourceHintSentence(hint) {
    if (hint && hint.known === true && hint.path) {
      // hint.path came off the page's add-step config; bound it like other
      // page-derived text (NEW-6).
      return (
        "Edit this source: " +
        boundData(hint.path, CONTEXT_MAX) +
        ". This page is generated from it. A change made only to the generated file is erased by the next build."
      );
    }
    return (
      "Source unknown. Nobody has told this tool what generates this page. Do not assume the file you are " +
      "reading about is the source. Find the generator, or ask the reviewer, before editing anything."
    );
  }

  // The hint in review.json is structured data; hint.path is bounded.
  function sourceHint(hint) {
    return {
      known: !!(hint && hint.known === true && hint.path),
      path: boundData((hint && hint.path) || null, CONTEXT_MAX)
    };
  }

  var LOST_NOTE =
    "The subject of this item is no longer on the page. The quoted text below may not be in the source any more. " +
    "Do not go looking for it blind; ask the reviewer if you cannot place it.";

  // ---------------------------------------------------------------------------
  // Grouping by page (D6, the plan's Q2, and record.samePage's file:// rule)
  // ---------------------------------------------------------------------------
  //
  // One group per ORIGIN PLUS PATHNAME, ordered by first visit, with ONE
  // exception: record.samePage's own file:// rule (src/shared/record.js, "Does
  // this record belong to the page in front of us?"). The browser layer has
  // always read every record through that rule, so a file:// visit and a
  // served visit of the SAME document never split apart on the reviewer's own
  // page. review.json grouped by the raw key alone, with no such exception, so
  // the same two visits split into two separate page groups here even though
  // the browser layer never showed the reviewer a split: `lahe status` showed
  // two three-item pages for one document, and each view showed the reviewer
  // only its own half (Ken, live, 2026-08-18). This groups the same way the
  // browser layer already does: the exact key first, and samePage's
  // document-tail comparison for anything that does not match one.
  //
  // Two dev servers both serving /dashboard are still two groups; samePage
  // never merges two served origins, only a file:// one against either kind.
  // Query strings and fragments already collapsed away in record.pageFrom.

  function knownHint(hint) {
    return !!(hint && hint.known === true && hint.path);
  }

  // STABLE ADDRESSES: a page's old origins (`origin_aliases`, old origin to
  // site origin, computed by the helper from its own records) group with the
  // page's new origin, and the group shows the new one, which is the address
  // that works. Without aliases nothing here changes.
  function pageGroups(items, aliases) {
    var byKey = {};
    var order = [];
    var table = aliases && typeof aliases === "object" ? aliases : {};
    items.forEach(function (it, index) {
      // The item keeps its own origin; only the group it joins is chosen by
      // the alias.
      var itOrigin = it[record.FIELD.PAGE_ORIGIN];
      var aliased = Object.prototype.hasOwnProperty.call(table, itOrigin) ? table[itOrigin] : null;
      // Grouped by identity, so every spelling of one stable address
      // (with the pages port, port-free, .lahe) is one group.
      var key = aliased ? record.pageIdentityKeyFor({ origin: aliased, path: it[record.FIELD.PAGE_PATH] }) : record.pageIdentityKey(it);
      var group = byKey[key] || null;
      if (!group) {
        // No exact match: this may still be another visit of a document
        // already in a group, over file:// where the other visit was served
        // or vice versa. Scan for that one exception rather than minting a
        // second group for the same document.
        for (var i = 0; i < order.length; i += 1) {
          if (record.samePage(it, order[i])) {
            group = order[i];
            break;
          }
        }
      }
      if (!group) {
        group = {
          key: key,
          origin: aliased || itOrigin,
          path: it[record.FIELD.PAGE_PATH],
          title: it[record.FIELD.PAGE_TITLE] || null,
          first_seq: typeof it[record.FIELD.PAGE_SEQ] === "number" ? it[record.FIELD.PAGE_SEQ] : null,
          arrival: index,
          hint: it[record.FIELD.SOURCE_HINT] || null,
          // Whether ANY item folded into this group arrived over file://. The
          // group's displayed origin below can move on to a served one, and
          // this is how that does not erase the fact that part of the review's
          // traffic was the file:// fallback (lahe status reads this).
          file_origin_seen: it[record.FIELD.PAGE_ORIGIN] === record.FILE_ORIGIN,
          items: []
        };
        order.push(group);
      } else {
        if (it[record.FIELD.PAGE_ORIGIN] === record.FILE_ORIGIN) group.file_origin_seen = true;
        // THE SERVED ORIGIN IS THE CANONICAL DISPLAY. A group minted from a
        // file:// visit that a served visit later joins switches its displayed
        // origin and path to the served one: that is the real, reachable
        // address for the same document, and a later file:// visit still
        // matches it (samePage's rule 3 fires whenever either side is file://,
        // so the served pathname on the group is still a valid comparison).
        if (group.origin === record.FILE_ORIGIN && it[record.FIELD.PAGE_ORIGIN] !== record.FILE_ORIGIN) {
          group.origin = aliased || it[record.FIELD.PAGE_ORIGIN];
          group.path = it[record.FIELD.PAGE_PATH];
        }
      }
      byKey[key] = group;
      if (!group.title && it[record.FIELD.PAGE_TITLE]) group.title = it[record.FIELD.PAGE_TITLE];
      // A known hint never loses to an unknown one (D6): once a group has a
      // hint recognized as known, a later item with no hint, or one that is
      // not recognized as known, leaves it standing rather than clobbering it.
      var itHint = it[record.FIELD.SOURCE_HINT] || null;
      if (itHint && !knownHint(group.hint)) group.hint = itHint;
      var seq = it[record.FIELD.PAGE_SEQ];
      if (typeof seq === "number" && (group.first_seq === null || seq < group.first_seq)) group.first_seq = seq;
      group.items.push(it);
    });

    // First-visit order. A page with no seq sorts after the ones that have one,
    // in arrival order, rather than throwing: a missing seq is a 1B bug that
    // should not cost the reviewer their file.
    order.sort(function (a, b) {
      if (a.first_seq === null && b.first_seq === null) return a.arrival - b.arrival;
      if (a.first_seq === null) return 1;
      if (b.first_seq === null) return -1;
      if (a.first_seq !== b.first_seq) return a.first_seq - b.first_seq;
      return a.arrival - b.arrival;
    });
    // The key travels with whatever origin and path the group ended up
    // displaying, not the one it happened to be minted from.
    order.forEach(function (g) {
      g.key = record.pageKeyFor(g);
    });
    return order;
  }

  // ---------------------------------------------------------------------------
  // review.json (the file the agent reads)
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} it the record
   * @param {Object} [pageHint] the page group's source hint, used when the
   *   record itself carries none. It is what the agent reads at the top of the
   *   page group, so the two answers cannot disagree.
   */
  // A run's blocks for the agent: each block's derived words beside its html.
  // Never bounded: the helper's ceiling bounds a run, and brief R6 keeps the
  // words as typed.
  function projectBlocks(list) {
    if (!Array.isArray(list) || !list.length) return null;
    return list.map(function (b) {
      // text is the words as typed: entities resolved, so it matches what the
      // page shows and what a proofread's from must quote (code lead 7).
      var out = { tag: b.tag, html: b.html, text: normalize.decodeEntities(record.blockText(b.html)) };
      if (b.from_anchor === true) out.from_anchor = true;
      return out;
    });
  }

  // Has the agent already asked its proofread question on this item? Then the
  // reviewer answered it (Use the fixes or Keep mine), and asking again would
  // loop (adversary review 4).
  function proofreadAsked(it) {
    return record.threadOf(it).some(function (round) {
      return !!round && !!round.agent && round.agent.proofread === true;
    });
  }

  function isProofread(it, options) {
    if (!record.isRunRecord(it)) return false;
    if (options && options.notes === true) return false;
    if (proofreadAsked(it)) return false;
    return normalize.runWords(it[record.FIELD.NEW_BLOCKS]) > PROOFREAD_MIN_WORDS;
  }

  // A proofread turn's fixes, as the thread carries them. Bounded per string
  // at the run's own byte ceiling; the count is capped on the wire.
  function projectSuggestions(list) {
    return (Array.isArray(list) ? list : []).map(function (sg) {
      var s = sg || {};
      return {
        block: typeof s.block === "number" ? s.block : null,
        from: boundData(typeof s.from === "string" ? s.from : null, record.NEW_BLOCKS_MAX_BYTES),
        to: boundData(typeof s.to === "string" ? s.to : null, record.NEW_BLOCKS_MAX_BYTES)
      };
    });
  }

  function projectItem(it, pageHint, linkedHint, options) {
    var F = record.FIELD;
    var ctx = it[F.CONTEXT] || {};
    var out = {};
    // A run record's whole sitting is not cut at BEFORE_MAX.
    var run = record.isRunRecord(it);
    var sittingMax = run ? Infinity : BEFORE_MAX;

    out.id = it[F.ID];
    out.rev = it[F.REV];
    out.kind = it[F.KIND];
    out.state = it[F.STATE];
    // A take-back names the handled item it undoes. An id, not page text and
    // not the reviewer's words, so it carries no trust class of its own: it is
    // structural, like id and rev. Null on every ordinary item.
    out.reverts = it[F.REVERTS] || null;

    // Intent. Verbatim, never bounded, never cleaned up (D12, R3).
    out[PROJECTED.NOTE] = verbatim(it[F.NOTE]);
    out[PROJECTED.CHANGE] = verbatim(it[F.CHANGE]);

    // Historical reviewer words remain verbatim but are explicitly data. The
    // current instruction channel is still only the two top-level fields.
    out[PROJECTED.THREAD] = record.chronologicalThread(it).map(function (round) {
      var reviewer = round.reviewer || {};
      var agent = round.agent || {};
      var projected = {
        rev: round.rev,
        reviewer: {
          note: verbatim(reviewer.note),
          change: verbatim(reviewer.change),
          at: reviewer.at || null
        },
        agent: {
          status: agent.status || null,
          agent: boundData(agent.agent, CONTEXT_MAX),
          reason: boundData(agent.reason, REPLY_TEXT_MAX),
          text: boundData(agent.text, REPLY_TEXT_MAX),
          files: boundFiles(agent.files),
          at: agent.at || null
        }
      };
      // A proofread question's fixes stay readable after the reviewer answers
      // it, so the agent never has to rebuild them from cut history (design
      // call 6). Only on that turn, so every other round keeps its shape.
      if (agent.proofread === true) {
        projected.agent.proofread = true;
        projected.agent.suggestions = projectSuggestions(agent.suggestions);
      }
      return projected;
    });

    // Data. Everything below came off the page.
    out[PROJECTED.QUOTE] = boundData(ctx.quote, BEFORE_MAX);
    out[PROJECTED.BEFORE] = boundData(it[F.BEFORE], BEFORE_MAX);
    out[PROJECTED.AFTER_FULL] = boundData(it[F.AFTER], sittingMax);
    out[PROJECTED.CONTEXT] = {
      prefix: boundData(ctx.prefix, CONTEXT_MAX),
      suffix: boundData(ctx.suffix, CONTEXT_MAX),
      heading: boundData(ctx.heading, CONTEXT_MAX),
      element: boundData(ctx.element, CONTEXT_MAX)
    };
    var slide = projectSlide(ctx.slide);
    if (slide) out[PROJECTED.CONTEXT].slide = slide;
    // What the subject IS, when the record was made on a whole element. Null
    // for a passage of text, which has its words in `quote` already.
    var subject = ctx.subject;
    out[PROJECTED.SUBJECT] = subject
      ? {
          tag: boundData(subject.tag, CONTEXT_MAX),
          src: boundData(subject.src, CONTEXT_MAX),
          alt: boundData(subject.alt, CONTEXT_MAX),
          // The opening tag, media sources, or SVG drawing. Bounded on the longer limit because a data
          // URI is a legitimate src and truncating it to 400 characters would
          // hand the agent a tag that matches nothing in the source.
          html: boundData(record.subjectHtmlOf(subject), BEFORE_MAX),
          near: boundData(subject.near, CONTEXT_MAX)
        }
      : null;
    out[PROJECTED.BEFORE_HTML] = boundData(it[F.BEFORE_HTML], BEFORE_MAX);
    out[PROJECTED.AFTER_HTML] = boundData(it[F.AFTER_HTML], sittingMax);
    // Free writing. Present on every item, null when the item has none, so
    // every item keeps one shape.
    out[PROJECTED.NEW_BLOCKS] = projectBlocks(it[F.NEW_BLOCKS]);
    // The anchor's own change is part of the sitting: a list anchor is the
    // whole list, and a character cut can end mid-tag (code lead 17).
    out[PROJECTED.ANCHOR_AFTER_HTML] = boundData(typeof it[F.ANCHOR_AFTER_HTML] === "string" ? it[F.ANCHOR_AFTER_HTML] : null, record.hasRunFields(it) ? Infinity : BEFORE_MAX);
    out[PROJECTED.REMOVE_BLOCKS] = projectBlocks(it[F.REMOVE_BLOCKS]);
    out[PROJECTED.ANCHOR_TAG_AFTER] = typeof it[F.ANCHOR_TAG_AFTER] === "string" ? it[F.ANCHOR_TAG_AFTER] : null;
    out[PROJECTED.PLACEMENT] = record.PLACEMENTS.indexOf(it[F.PLACEMENT]) !== -1 ? it[F.PLACEMENT] : null;
    out[PROJECTED.RUN_WORDS] = run ? normalize.runWords(it[F.NEW_BLOCKS]) : null;
    out[PROJECTED.PROOFREAD] = isProofread(it, options);
    out[PROJECTED.REGION_LABEL] = boundData((it[F.REGION] && it[F.REGION].label) || null, CONTEXT_MAX);
    // WHAT THE AGENT NEEDS TO EDIT THE SOURCE, rather than to read the page.
    //
    // `stamp` is the id the reviewer's page wrote onto the element. Carrying it
    // into the source is what makes the next build reproduce it, and a stamped
    // element is found with certainty rather than guessed at.
    //
    // `where` and `ordinal` are for the first edit of one of N identical
    // elements, which happens before any stamp is in the source: the chain says
    // which block, and the ordinal says which twin inside it. Neither ever
    // places a write in the browser (D9); they are information handed to an
    // agent who is editing the source with the reviewer's words in front of it.
    // `stamp_carriable` is the other half of `stamp`, and it is read off the
    // SOURCE rather than off the page: a Markdown file has nowhere to put an
    // attribute, so an agent working from one is told not to try. See
    // record.sourceCanCarryStamp.
    out[PROJECTED.REGION] = regionFacts(
      it[F.REGION],
      record.pageCanCarryStamp({
        path: it[F.PAGE_PATH],
        // A linked page's hint is the helper's, never the record's own claim.
        source_hint: linkedHint !== undefined ? linkedHint : it[F.SOURCE_HINT] || pageHint || null
      }),
      it
    );
    out[PROJECTED.AFTER_HISTORY] = boundHistory(it[F.AFTER_HISTORY]);

    // A CHOICE carries its press and nothing about a region to rewrite: no
    // before, after_full, html, region_label, subject or region facts (no
    // stamp is ever minted for one, so no stamp round asks the agent for a
    // data-lahe-id on a button group). The question is in quote and the
    // heading in context, as for any item. The key is set only on a choice,
    // so every other item keeps today's shape.
    if (record.isChoice(it)) {
      var press = it[F.CHOICE] || {};
      out[PROJECTED.CHOICE] = {
        group: record.isChoiceToken(press.group) ? press.group : null,
        answer: record.isChoiceToken(press.answer) ? press.answer : null
      };
      out[PROJECTED.BEFORE] = null;
      out[PROJECTED.AFTER_FULL] = null;
      out[PROJECTED.BEFORE_HTML] = null;
      out[PROJECTED.AFTER_HTML] = null;
      out[PROJECTED.REGION_LABEL] = null;
      out[PROJECTED.SUBJECT] = null;
      out[PROJECTED.REGION] = null;
      out[PROJECTED.AFTER_HISTORY] = [];
    }

    // A HANDLED ITEM HAS NO LOST ANCHOR. The fix an agent reported was expected
    // to rewrite the passage the item points at, so an anchor that no longer
    // binds is the fix landing rather than the feedback going missing. The
    // layer clears the stamp when the reply folds; this also covers records
    // stamped by an older build, so review.json never tells an agent the region
    // is lost for work that is finished.
    var handled = it[F.STATE] === record.STATE.HANDLED;
    var lost = !handled && it[F.REGION] && it[F.REGION].lost;
    // THE CODE IS THE PER-ITEM SIGNAL. The sentence saying what a lost item
    // means is a contract clause, read once: it used to ride on every lost item
    // as lost.hint, and a page restructure can lose many items at once, so it
    // was the same rule text repeated per item. LOST_NOTE is still used by the
    // one-shot text export below.
    out.lost = lost ? { code: lost.code || null, reason: lost.reason || null, at: lost.at || null } : null;

    // The agent's own words have their own trust class (D6): plain data, so one
    // agent cannot instruct another through a reply the helper re-projects.
    var reply = it[F.REPLY];
    out.reply = reply
      ? {
          status: reply.status || null,
          agent: boundData(reply.agent, CONTEXT_MAX),
          reason: boundData(reply.reason, BEFORE_MAX),
          text: boundData(reply.text, BEFORE_MAX),
          files: boundFiles(reply.files),
          at: reply.at || null,
          // The agent's flag, projected back so a second agent reading this file
          // sees what the first one claimed. A boolean, so it needs no bounding:
          // only the literal true survives.
          user_needs_to_see_reply: reply.user_needs_to_see_reply === true
        }
      : null;

    // THE AGENT SAID HANDLED AND THE PAGE DOES NOT SHOW IT. A boolean, like
    // user_needs_to_see_reply, so only the literal true survives and nothing
    // here needs bounding. It sits beside the reply rather than inside it
    // because it is not something the agent said: it is what the helper found
    // when it looked at the built page. The item is still ready, so it is on
    // the drain list, and this is the field that says why it came back.
    out.handled_not_on_page = it[F.HANDLED_NOT_ON_PAGE] === true;

    // THE REVIEWER CLOSED IT. A handled item no agent retired: the reviewer
    // chose "Mark as done" on the card. Beside the reply for the same reason as
    // the flag above: the reply, if any, is the agent's last answer, and this
    // says it is not what finished the item.
    out.closed_by_reviewer = record.isClosedByReviewer(it);

    // WHEN THE REVIEWER LAST CHANGED THESE WORDS, and it is the obvious field
    // on purpose. This pair used to be created_at and updated_at, side by side
    // and equally plain, and on 2026-09-23 an agent read the created_at of two
    // reworded cards, called them "a leftover comment card from yesterday",
    // replied not_handled twice and wrote nothing. The reviewer retyped the
    // same change three times. Rewording bumps the rev and reopens the item, so
    // every item in this file is current work: the field that says so is named
    // for what it means, and the card's birthday is named for what it is not.
    out.reviewer_last_changed_at = it[F.UPDATED_AT] || it[F.CREATED_AT] || null;
    out.card_first_created_at = it[F.CREATED_AT] || null;
    return out;
  }

  /** The six locating facts, defaulted so every item carries the same shape. */
  function regionFacts(region, carriable, item) {
    var ref = (region && region.ref) || null;
    var ordinal = (ref && ref.ordinal) || null;
    var index = ordinal && typeof ordinal.index === "number" ? ordinal.index : 1;
    var of = ordinal && typeof ordinal.of === "number" ? ordinal.of : 1;
    return {
      stamp: ref && typeof ref.stamp === "string" && ref.stamp ? ref.stamp : null,
      where: boundData((ref && ref.where) || null, CONTEXT_MAX),
      ordinal: { index: index, of: of },
      // Absent reads as true, which is what a reference minted before this
      // existed was: findable by its words until something proved otherwise.
      text_unique: !(ref && ref.text_unique === false),
      // Can the source behind this page hold the attribute at all? False for
      // Markdown, plain text, and anything else with no place to put one.
      stamp_carriable: carriable === true,
      // THE PAGE CHECK ASKED FOR THIS ID AND DID NOT GET IT. The check asks
      // once (record.answeredPageCheckReopen), so without this the fact that
      // an id was never carried into the source would live only in the round's
      // note, and a later agent reading a handled item would have no sign of
      // it. Nothing clears it: it is a record of what happened, not a claim
      // about the source right now.
      stamp_missing: stampMissing(region, item)
    };
  }

  /** Did a page check ask this item for its id, in this revision or an older one? */
  function stampMissing(region, item) {
    var stamp = region && region.check_reopen;
    if (stamp && stamp.tool === record.TOOL_ROUND.PAGE_CHECK_STAMP) return true;
    var thread = record.threadOf(item || {});
    for (var i = 0; i < thread.length; i += 1) {
      if (thread[i] && thread[i].tool === record.TOOL_ROUND.PAGE_CHECK_STAMP) return true;
    }
    return false;
  }

  // A page served under a /.lahe-source/ mount is a document a reviewed page
  // links to (spec 20260922.02). Its source file is worked out by the helper,
  // off the static server's mount table, and handed in as
  // review.linked_files[page path]. Whatever the page itself claimed is never
  // used for it, and a page the helper could not map reads as unknown rather
  // than falling back to the linking page's source, which is the wrong file.
  var LINKED_PAGE_PREFIX = "/.lahe-source/";

  // Any spelling that DECODES under the prefix counts as a linked page, so an
  // encoded one (/%2Elahe-source/...) never falls back to the review-wide
  // source. The helper maps only the literal spelling, which is the only one
  // the static server serves, so an encoded one reads as unknown.
  function isLinkedPage(pagePath) {
    if (typeof pagePath !== "string") return false;
    if (pagePath.indexOf(LINKED_PAGE_PREFIX) === 0) return true;
    try {
      return decodeURIComponent(pagePath).indexOf(LINKED_PAGE_PREFIX) === 0;
    } catch (err) {
      return false;
    }
  }

  function linkedHintOf(review, pagePath) {
    var table = review.linked_files && typeof review.linked_files === "object" ? review.linked_files : {};
    var file = Object.prototype.hasOwnProperty.call(table, pagePath) ? table[pagePath] : null;
    return typeof file === "string" && file ? { known: true, path: file } : null;
  }

  // A source hint naming a file in a removed worktree reads as its main copy
  // (spec 20261015.01 R10). The helper computes the map; this only applies it.
  function movedHint(review, hint) {
    var map = review.moved_hints;
    if (!map || typeof map !== "object" || !hint) return hint;
    var hinted = typeof hint === "object" ? hint.path : hint;
    if (typeof hinted !== "string" || !Object.prototype.hasOwnProperty.call(map, hinted)) return hint;
    return typeof hint === "object" ? Object.assign({}, hint, { path: map[hinted] }) : map[hinted];
  }

  function projectReview(review) {
    requireReview(review);
    var groups = pageGroups(review.items, review.origin_aliases);
    groups.forEach(function (g) { g.hint = movedHint(review, g.hint); });
    review = Object.assign({}, review, { source_hint: movedHint(review, review.source_hint) });
    return {
      schema: SCHEMA,
      generated_at: review.generated_at || new Date().toISOString(),
      review: {
        id: review.id,
        agent_session_id: review.agent_session_id || "legacy",
        started_at: review.started_at || null,
        ended_at: review.ended_at || null,
        // A `lahe write` notes review. Review-level: the one behavior it
        // changes reaches each item as proofread.
        notes: review.notes === true
      },
      // The classification travels with the file, so an agent sees the rule as
      // structure rather than only being told it in prose.
      field_classes: Object.assign({}, PROJECTED_FIELD_CLASS),
      intent_fields: INTENT_FIELDS.slice(),
      counts: countItems(review),
      pages: groups.map(function (g) {
        return {
          key: g.key,
          origin: g.origin,
          path: g.path,
          // The title comes from doc.title, so it is fully page-controlled and
          // an agent reads it as a label. Bounded like every other page-derived
          // field, with the marker visible (NEW-4).
          title: boundData(g.title, CONTEXT_MAX),
          // A page's own hint wins when it has one; otherwise this falls back
          // to the review-wide hint `add --source` (or `review`'s own
          // Markdown --source) recorded, so a known source is not reported as
          // unknown merely because no item on this page ever carried it itself
          // (see projection.js's reviewSourceHint).
          source_hint: sourceHint(
            isLinkedPage(g.path) ? linkedHintOf(review, g.path) : g.hint || review.source_hint || null
          ),
          // The linked document's file on disk, when this page is one a
          // reviewed page links to and the helper could map it. Null
          // otherwise.
          linked_file: isLinkedPage(g.path) && linkedHintOf(review, g.path) ? linkedHintOf(review, g.path).path : null,
          // lahe status reads this to say when a page connected over file://
          // rather than (or in addition to) the served origin above, so a
          // half-configured review is visible instead of silent.
          file_origin_seen: !!g.file_origin_seen,
          items: g.items.map(function (it) {
            var opts = { notes: review.notes === true };
            if (isLinkedPage(g.path)) return projectItem(it, null, linkedHintOf(review, g.path), opts);
            return projectItem(it, g.hint || review.source_hint || null, undefined, opts);
          })
        };
      })
    };
  }

  // Pretty-printed, because a person opens this file too, and with a trailing
  // newline so appending tools and editors behave. The helper writes these bytes
  // beside the target and renames (D6's atomic write); TEMP_SUFFIX is the name
  // of the beside-file, here rather than in the writer so the projection and its
  // writer cannot disagree.
  var TEMP_SUFFIX = ".tmp";

  function stringifyReview(projection) {
    return JSON.stringify(projection, null, 2) + "\n";
  }

  function countItems(review) {
    var counts = { total: 0 };
    for (var i = 0; i < record.STATES.length; i += 1) counts[record.STATES[i]] = 0;
    review.items.forEach(function (it) {
      counts.total += 1;
      var st = it[record.FIELD.STATE];
      if (Object.prototype.hasOwnProperty.call(counts, st)) counts[st] += 1;
    });
    return counts;
  }

  // ---------------------------------------------------------------------------
  // The human-readable text (R10: Copy and Export, with no helper running)
  // ---------------------------------------------------------------------------
  //
  // This is for a PERSON: the reviewer pasting their feedback into a chat, or
  // saving it. It is not the agent contract, so it has no contract field and no
  // fences. Same bounding rules, because the same reason applies: the reviewer's
  // words are whole, and page text is quoted for locating.

  function renderText(review) {
    requireReview(review);
    var out = [];
    var counts = countItems(review);
    // The document's own name leads, when the caller knows it. An exported file
    // gets forwarded to an agent (or found weeks later) with none of the page's
    // context attached, and "Review r25cd2bc5cac4" alone forces whoever holds
    // it to go match ids; the title is what a person or an agent can place.
    if (typeof review.title === "string" && review.title.trim()) {
      out.push("Review of \"" + review.title.trim() + "\" (" + review.id + ")");
    } else {
      out.push("Review " + review.id);
    }
    out.push(
      counts.total +
        " item" +
        (counts.total === 1 ? "" : "s") +
        ", " +
        counts.ready +
        " ready, " +
        counts.draft +
        " still draft, " +
        counts.handled +
        " handled, " +
        counts.not_handled +
        " not handled."
    );
    out.push("");

    pageGroups(review.items, review.origin_aliases).forEach(function (g) {
      out.push("Page: " + (g.title ? g.title + " " : "") + g.path + " (" + g.origin + ")");
      out.push(sourceHintSentence(movedHint(review, g.hint)));
      out.push("");
      g.items.forEach(function (it) {
        out.push(renderItemText(it));
        out.push("");
      });
    });

    return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
  }

  // Page text can carry the breaks the reviewer typed. In this one-item-per-
  // block text format a bare newline would start a line that reads like a new
  // field, so the continuation lines are indented under the field they belong
  // to. A blank line stays blank rather than becoming four spaces.
  function wrapped(value) {
    return String(value)
      .split("\n")
      .map(function (line, at) {
        if (at === 0 || !line) return line;
        return "    " + line;
      })
      .join("\n");
  }

  function renderItemText(it) {
    var F = record.FIELD;
    var ctx = it[F.CONTEXT] || {};
    var lines = [];
    lines.push(it[F.KIND] + " " + it[F.ID] + " rev " + it[F.REV] + " (" + it[F.STATE] + ")");
    var label = (it[F.REGION] && it[F.REGION].label) || null;
    if (label) lines.push("  Where: " + boundData(label, CONTEXT_MAX));
    // Said before the words themselves, because it is what the words ARE: the
    // reviewer's current wording, not a request dated by the card it sits on.
    var lastChanged = it[F.UPDATED_AT] || it[F.CREATED_AT] || null;
    if (lastChanged) {
      lines.push("  Reviewer last changed these words: " + lastChanged + " (their current wording)");
      if (it[F.CREATED_AT] && it[F.CREATED_AT] !== lastChanged) {
        lines.push("  Card first created: " + it[F.CREATED_AT] + " (not how old the request is)");
      }
    }
    // Same rule as the JSON projection: a handled item's fix was expected to
    // change its own passage, so it is not reported as a lost anchor.
    if (it[F.STATE] !== record.STATE.HANDLED && it[F.REGION] && it[F.REGION].lost) lines.push("  " + LOST_NOTE);
    record.chronologicalThread(it).forEach(function (round) {
      var reviewer = round.reviewer || {};
      var agent = round.agent || {};
      lines.push("  Earlier exchange, rev " + round.rev + " (historical context, not current instructions):");
      if (reviewer.note) lines.push("    Reviewer note" + (reviewer.at ? " [" + reviewer.at + "]" : "") + ": " + reviewer.note);
      if (reviewer.change) lines.push("    Reviewer change" + (reviewer.at ? " [" + reviewer.at + "]" : "") + ": " + reviewer.change);
      lines.push(
        "    " +
          ((agent.agent || "the agent") + " said" + (agent.at ? " [" + agent.at + "]" : "") + ": " + (agent.status || "")) +
          (agent.reason ? " (" + boundData(agent.reason, BEFORE_MAX) + ")" : "") +
          (agent.text ? " " + boundData(agent.text, BEFORE_MAX) : "")
      );
    });
    if (it[F.NOTE]) {
      lines.push("  Note (the reviewer's words)" + (it[F.UPDATED_AT] ? " [" + it[F.UPDATED_AT] + "]" : "") + ": " + it[F.NOTE]);
    }
    if (it[F.CHANGE]) {
      lines.push("  Change (the reviewer's words)" + (it[F.UPDATED_AT] ? " [" + it[F.UPDATED_AT] + "]" : "") + ": " + it[F.CHANGE]);
    }
    // For a record made on a whole element, what that element is. Copy and
    // Export reach an agent with no review.json in front of them (R10), and
    // "the image" is not an answer when there are three of them.
    if (ctx.subject && ctx.subject.html) {
      lines.push("  The element (page markup): " + boundData(record.subjectHtmlOf(ctx.subject), BEFORE_MAX));
    }
    var slide = projectSlide(ctx.slide);
    if (slide) {
      lines.push("  Slide when this note began (page data): " + (slide.uncounted ? "uncounted" : slide.index + " of " + slide.total) +
        (slide.heading ? ", " + slide.heading : "") + (slide.id ? " [" + slide.id + "]" : ""));
      if (slide.text) lines.push("  Slide text (page data): " + slide.text);
    }
    // A CHOICE reads as its question and its answer. The answer is the
    // button's value, which is what the agent acts on; the question is the
    // group's own words off the page.
    if (record.isChoice(it)) {
      var press = it[F.CHOICE] || {};
      if (ctx.quote) lines.push("  Question (page text): " + wrapped(boundData(ctx.quote, BEFORE_MAX)));
      if (ctx.heading) lines.push("  Under the heading (page text): " + boundData(ctx.heading, CONTEXT_MAX));
      lines.push("  Answer (the reviewer's press): " + String(press.answer) + ", in the group " + String(press.group));
    } else if (ctx.quote) lines.push("  Quoted from the page: " + wrapped(boundData(ctx.quote, BEFORE_MAX)));
    if (typeof it[F.BEFORE] === "string") lines.push("  Before (page text): " + wrapped(boundData(it[F.BEFORE], BEFORE_MAX)));
    if (record.isRunRecord(it)) {
      runTextLines(it).forEach(function (line) {
        lines.push(line);
      });
    } else if (typeof it[F.AFTER] === "string") {
      lines.push("  After (page text, with the edit): " + wrapped(boundData(it[F.AFTER], BEFORE_MAX)));
    }
    if (it[F.REPLY]) {
      lines.push(
        "  " +
          ((it[F.REPLY].agent || "the agent") + " said" + (it[F.REPLY].at ? " [" + it[F.REPLY].at + "]" : "") + ": " + (it[F.REPLY].status || "")) +
          (it[F.REPLY].reason ? " (" + boundData(it[F.REPLY].reason, BEFORE_MAX) + ")" : "") +
          (it[F.REPLY].text ? " " + boundData(it[F.REPLY].text, BEFORE_MAX) : "")
      );
    }
    return lines.join("\n");
  }

  // The menu's names for the six writable types, so a person reading an export
  // sees the words the reviewer saw on the bar. Read from gestures, the one
  // table (code lead 20).
  function blockTypeName(tag) {
    return gestures.blockTypeLabel(tag) || tag;
  }

  function blockLine(b) {
    var name = blockTypeName(b.tag);
    var text = record.blockText(b.html);
    if (b.tag === "ul" || b.tag === "ol") text = text.split(/\n{2,}/).join("; ");
    return "    " + name + (b.from_anchor === true ? " (moved from the anchor)" : "") + ": " + wrapped(text);
  }

  // A run in the text format: the anchor's change, then each new block by type.
  function runTextLines(it) {
    var F = record.FIELD;
    var lines = [];
    if (it[F.PLACEMENT] !== record.PLACEMENT.START_OF_CONTAINER && typeof it[F.ANCHOR_AFTER_HTML] === "string") {
      lines.push("  Anchor after the edit (page text): " + wrapped(record.blockText(it[F.ANCHOR_AFTER_HTML])));
    }
    if (typeof it[F.ANCHOR_TAG_AFTER] === "string" && it[F.ANCHOR_TAG_AFTER]) {
      lines.push("  Anchor becomes: " + blockTypeName(it[F.ANCHOR_TAG_AFTER]));
    }
    lines.push(
      it[F.PLACEMENT] === record.PLACEMENT.START_OF_CONTAINER
        ? "  New blocks (the reviewer's new text), at the start of the page:"
        : "  New blocks (the reviewer's new text):"
    );
    it[F.NEW_BLOCKS].forEach(function (b) {
      lines.push(blockLine(b));
    });
    return lines;
  }

  function requireReview(review) {
    if (!review || typeof review !== "object") throw new TypeError("expected a review object");
    if (typeof review.id !== "string" || !review.id) throw new Error("review.id is required");
    if (!Array.isArray(review.items)) {
      throw new Error("review.items must be an array; the projection groups items by page itself");
    }
  }

  // The files inside reviews/<review-id>/ (the architecture's Data and state
  // layout). Named here because the formatter, the writer, and the reply reader
  // must all spell them the same way.
  var FILE_NAMES = { json: "review.json", events: "events.jsonl", replies: "replies.jsonl" };

  return {
    SCHEMA: SCHEMA,
    PROJECTED: PROJECTED,
    INTENT_FIELDS: INTENT_FIELDS,
    DATA_FIELDS: DATA_FIELDS,
    PROJECTED_FIELD_CLASS: PROJECTED_FIELD_CLASS,
    BEFORE_MAX: BEFORE_MAX,
    PROOFREAD_MIN_WORDS: PROOFREAD_MIN_WORDS,
    REPLY_TEXT_MAX: REPLY_TEXT_MAX,
    CONTEXT_MAX: CONTEXT_MAX,
    REPLY_FILES_MAX: REPLY_FILES_MAX,
    AFTER_HISTORY_MAX: AFTER_HISTORY_MAX,
    boundHistory: boundHistory,
    TRUNCATION_MARKER: TRUNCATION_MARKER,
    truncationMarker: truncationMarker,
    boundData: boundData,
    LOST_NOTE: LOST_NOTE,
    FILE_NAMES: FILE_NAMES,
    TEMP_SUFFIX: TEMP_SUFFIX,
    sourceHintSentence: sourceHintSentence,
    sourceHint: sourceHint,
    pageGroups: pageGroups,
    projectItem: projectItem,
    isLinkedPage: isLinkedPage,
    projectReview: projectReview,
    stringifyReview: stringifyReview,
    countItems: countItems,
    renderText: renderText
  };
});
