// Is a "handled" claim true on the page the reviewer is looking at?
//
// Owner: 3A. Read with src/service/replies.js (which asks this before a handled
// reply retires an item) and src/service/rebuild.js (which makes sure the page
// being read is the current render).
//
// An agent saying it made the change and the change being on the reviewer's
// page are two different facts, and only the second one is what the reviewer
// asked for. When they come apart the reviewer loses work silently: the item
// retires, replay stops re-applying their edit, and their words vanish on the
// next refresh with a card that says the change was made. So a handled reply
// for a HAND EDIT is checked against the built page before it is allowed to
// retire anything.
//
// WHAT THE CHECK IS. Two halves, and an item is only held open when BOTH say so.
//
//   1. NOTHING WAS WRITTEN. No file this review is built from, source or page,
//      has been written since the reviewer committed this wording. See
//      touchedSince below: this is the gate, and it decides whether the words
//      are consulted at all.
//   2. THE WORDS ARE NOT THERE. The item's `after` is the words the reviewer
//      put on the page, and they are not in the page's text.
//
// The second half alone is far too strict to act on. It is a containment test
// rather than an equality test, so a reflowed paragraph or the same change made
// in three other places still passes, but an agent that carried the reviewer's
// meaning in its own words does not, and holding a finished item open on that
// is the tool arguing with an agent that did the work. The first half is what
// keeps it honest: an agent that touched anything made a change, and grading
// whether it is the RIGHT change belongs to the browser's page check, which has
// the reviewer's live page in front of it and its own once-per-reopen guards.
// What is left is the one thing this exists for: the agent that answered
// handled having changed nothing at all.
//
// TOLERANT OF TYPOGRAPHY. A Markdown source holds a straight quote where the
// built HTML holds a curly one, and an agent that types the sentence correctly
// would otherwise fail this check forever. normalize.foldTypography is the
// tool's one answer to that, already used by replay's second pass, and it is
// what is used here. There is no second normalizer.
//
// WHAT IS NOT CHECKED, and why:
//
//  - A COMMENT. There is nothing to look for: the reviewer asked for something
//    in words and the agent decides what that means on the page. Only an item
//    carrying the reviewer's own after-text can be checked at all.
//  - A DELETE. Its after is empty, so "is it there" has no answer.
//  - A REVIEW SOMETHING HAS WRITTEN TO. touchedSince, the gate above. An agent
//    that edited the source or the page did work, and this is not the thing
//    that grades it.
//  - A REVERT, AND A TOOL ROUND. A take-back asks for text to be taken OUT, and
//    a page-check reopen is the browser's own check already mid-conversation
//    with the agent. See checkable below for both, and for the shapes with no
//    words to look for.
//  - A REVIEW WHOSE PAGE CANNOT BE READ. A page behind somebody else's dev
//    server, a file that moved, a folder review whose page cannot be resolved:
//    all answer "cannot tell", and cannot tell is treated as present. The tool
//    never holds an item open on a guess.
//
// Node-only. Not in the layer bundle.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var normalize = require("../shared/normalize.js");
var record = require("../shared/record.js");
var rebuildModule = require("./rebuild.js");

// THE RENDERER ESCAPES THE REVIEWER'S PUNCTUATION. marked writes an apostrophe
// as `&#39;`, so a page holding the reviewer's exact sentence does not hold
// their exact characters, and a raw containment test misses every sentence with
// an apostrophe in it. normalize.textOf resolves the one entity it has a reason
// to (&nbsp;), so the rest are resolved here, between the text extraction and
// the typography fold. Both sides of the comparison go through this same
// function, so it can never make the two disagree.
var NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeEntities(text) {
  return String(text)
    .replace(/&#[xX]([0-9a-fA-F]+);/g, function (whole, hex) {
      var code = parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/&#(\d+);/g, function (whole, dec) {
      var code = parseInt(dec, 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/&([a-zA-Z]+);/g, function (whole, name) {
      var lower = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : whole;
    });
}

/**
 * The page's words, as one comparison string.
 *
 * normalize.textOf drops script, style and the rest of the non-content
 * subtrees; foldTypography is normalizeText plus the quote, dash and ellipsis
 * folding. Both are the shared ones, and there is no second normalizer here.
 */
function comparable(text) {
  try {
    return normalize.foldTypography(decodeEntities(normalize.textOf(String(text))));
  } catch (error) {
    return null;
  }
}

/**
 * Can this item's claim be checked at all?
 *
 * Only one shape can: an ordinary EDIT, where the reviewer typed words and
 * asked for those words to be on the page. Everything else either has no words
 * to look for or means something the words cannot answer, and running the check
 * on it holds a finished item open forever.
 *
 *  - NOT A COMMENT, and not a DELETE or a FORMAT_ONLY record. A comment asks for
 *    something in words and the agent decides what that means on the page. A
 *    delete's after is empty. A format-only record's after is identical to its
 *    before by construction, so finding it proves nothing.
 *  - NOT A REVERT. The reviewer undid a change and is asking for text to be
 *    TAKEN OUT of the source. Its after is the wording that should stand again,
 *    which the agent may well have left exactly where it was, so containment
 *    passes whether or not the take-back happened, and the one thing that would
 *    really prove the work is an absence this test cannot see. Checking it also
 *    broke a real flow: test/browser/undo_reaches_helper.spec.js hung waiting
 *    for a handled reply that was correct to fold.
 *  - NOT A TOOL ROUND. A page-check reopen is the tool asking the agent for one
 *    specific thing, usually to carry a data-lahe-id into the source, and the
 *    page check has already formed its own opinion about what is on the page.
 *    A second, cruder opinion on top of it is two checks arguing, and the loser
 *    is the reviewer, whose item never closes. See
 *    test/browser/reverted_edit.spec.js.
 *  - NOT AN EMPTY AFTER. There is nothing to look for, so every page fails.
 */
function checkable(item) {
  if (!item) return false;
  if (item[record.FIELD.KIND] !== record.KIND.EDIT) return false;
  if (record.isRevert(item)) return false;
  if (record.toolRoundOf(item)) return false;
  var after = item[record.FIELD.AFTER];
  return typeof after === "string" && after.trim().length > 0;
}

/**
 * Every page file this review could be showing, for the page this item was made
 * on. A folder review records the folder, so the item's own page_path is what
 * picks the file inside it.
 */
function pageFilesFor(meta, item) {
  var targets = Array.isArray(meta.target_paths) ? meta.target_paths.slice() : [];
  if (typeof meta.target_path === "string" && meta.target_path && targets.indexOf(meta.target_path) === -1) {
    targets.push(meta.target_path);
  }
  var files = [];
  targets.forEach(function (target) {
    if (typeof target !== "string" || !target) return;
    var stat;
    try {
      stat = fs.statSync(target);
    } catch (error) {
      return;
    }
    if (stat.isFile()) {
      files.push(target);
      return;
    }
    if (!stat.isDirectory()) return;
    var pagePath = item ? item[record.FIELD.PAGE_PATH] : null;
    if (typeof pagePath !== "string" || !pagePath) return;
    var decoded;
    try {
      decoded = decodeURIComponent(pagePath);
    } catch (error) {
      return;
    }
    var relative = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relative || relative.charAt(relative.length - 1) === "/") relative += "index.html";
    var resolved = path.resolve(target, relative);
    // The same containment rule the static server applies to a request.
    if (resolved.indexOf(path.resolve(target) + path.sep) !== 0) return;
    files.push(resolved);
  });
  return files;
}

/**
 * Has anything this review is built from been written since the reviewer
 * committed this wording?
 *
 * THE SCOPE IS THE REVIEW, NOT THE ITEM. Every file the review is built from is
 * stat'ed, so one write anywhere disarms the check for every item in that
 * review until the reviewer commits something newer. That is deliberate, and it
 * is also the shape the reported failure arrived in: an agent that fixes item
 * one and then answers handled to items one through five leaves two to five
 * unguarded, because the file it wrote for item one is newer than all of them.
 * Narrowing it to the passage an item points at would mean resolving a record's
 * region inside a source file, which is the anchor engine's job and not
 * something the helper can do from a path and an mtime.
 *
 * THE SECOND HALF OF THE RULE, and the one that keeps the first half honest.
 * Containment asks "are the reviewer's words on the page", and the answer is
 * legitimately no in more cases than it is dishonestly no: the agent reflowed
 * the paragraph, split it in two, used its own wording for the same meaning,
 * or the renderer ate a character. Holding an item open on that is the tool
 * arguing with an agent that did the work, and the reviewer is the one who
 * pays for the argument.
 *
 * So the words are only allowed to convict when nothing moved. An agent that
 * touched the source or the page made a change, and judging whether it is the
 * RIGHT change is the browser's page check, which has the reviewer's live page
 * in front of it and its own once-per-reopen guards. This check is for the one
 * thing the page check cannot be relied on to catch in time: the agent that
 * answered handled having changed nothing at all, which is the reported
 * failure in its entirety.
 *
 * Unknown times answer true, which means "not our business". Failing toward
 * leaving the item alone is the same direction every other doubt here fails.
 *
 * THE ASSUMPTION IT RESTS ON. `updated_at` was minted by the reviewer's BROWSER
 * and the mtimes are read by the HELPER off the filesystem, so this compares two
 * clocks. Today they are the same machine, which is what makes it safe: the
 * helper is loopback-only and the page is served from it. If a page clock ever
 * ran ahead of the filesystem's, a real write would look older than the commit
 * and the gate would open when it should have stayed shut, which costs a false
 * "not on your page" rather than a missed one. That is the right direction for
 * the error to fall, but it is an assumption and not a guarantee.
 *
 * @returns {boolean} true when something was written since, or cannot be told
 */
function touchedSince(meta, item) {
  var at = item && (item[record.FIELD.UPDATED_AT] || item[record.FIELD.CREATED_AT]);
  var committedAt = typeof at === "string" ? Date.parse(at) : NaN;
  if (!Number.isFinite(committedAt)) return true;
  var files = pageFilesFor(meta, item);
  if (typeof meta.source_path === "string" && meta.source_path) files.push(meta.source_path);
  for (var i = 0; i < files.length; i += 1) {
    var stat;
    try {
      stat = fs.statSync(files[i]);
    } catch (error) {
      continue;
    }
    if (stat.mtimeMs > committedAt) return true;
  }
  return false;
}

/**
 * The handled check for one state directory.
 *
 * @param {{dir: string, log?: object, rebuild?: object}} options `rebuild` is a
 *   src/service/rebuild.js rebuilder. It is asked first, so an agent that edits
 *   the Markdown and replies in the same breath is judged against the render
 *   its edit produces rather than against the one before it.
 */
function createHandledCheck(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createHandledCheck: dir is required");
  var dir = opts.dir;
  var log = opts.log || null;
  var rebuild = opts.rebuild || rebuildModule.createRebuilder({ dir: dir, log: log });

  /**
   * Does the reviewer's page show this item's change?
   *
   * @returns {boolean|null} true when the words are there, false when the page
   *   was read and they are not, null when nothing could be read. A caller
   *   treats null as true: see the note at the top of this file.
   */
  function pageShows(reviewId, item) {
    if (!checkable(item)) return null;
    var meta = rebuildModule.readMeta(dir, reviewId);
    if (!meta) return null;
    if (typeof meta.id !== "string") meta = Object.assign({}, meta, { id: reviewId });

    // The page has to be current before it can be read as evidence.
    try {
      rebuild.refresh(meta);
    } catch (error) {
      if (log && typeof log.helperLog === "function") {
        log.helperLog("review " + reviewId + ": the page could not be refreshed before a handled check: " + error.message);
      }
    }

    // Something was written since the reviewer committed these words, so an
    // agent did something and what it did is not this check's to grade.
    if (touchedSince(meta, item)) return null;

    var needle = comparable(item[record.FIELD.AFTER]);
    if (!needle) return null;

    var read = 0;
    var files = pageFilesFor(meta, item);
    for (var i = 0; i < files.length; i += 1) {
      var html;
      try {
        html = fs.readFileSync(files[i], "utf8");
      } catch (error) {
        continue;
      }
      read += 1;
      var hay = comparable(html);
      if (hay && hay.indexOf(needle) !== -1) return true;
    }
    if (read === 0) return null;
    return false;
  }

  return { pageShows: pageShows, rebuild: rebuild };
}

module.exports = {
  decodeEntities: decodeEntities,
  touchedSince: touchedSince,
  comparable: comparable,
  checkable: checkable,
  pageFilesFor: pageFilesFor,
  createHandledCheck: createHandledCheck
};
