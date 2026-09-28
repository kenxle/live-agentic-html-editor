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
// WHAT THE CHECK IS. An item is held open only when its `after` (the words the
// reviewer put on the page) is not in the page's text AND something says the
// item's own passage was never touched. Either of two things can say so:
//
//   1. NOTHING WAS WRITTEN. No file this review is built from, source or page,
//      has been written since the reviewer committed this wording. See
//      touchedSince below. It covers the whole review, so it catches an agent
//      that did nothing at all, whatever shape the item is.
//   2. THE PASSAGE IS STILL THERE. The item's `before` is on the page as whole
//      blocks, exactly once. This one is per item, so an agent that fixes one
//      of five edits and answers handled to all five has the other four held.
//      See verdictFor below.
//
// Containment alone is far too strict to act on: an agent that carried the
// reviewer's meaning in its own words fails it, and holding a finished item
// open on that is the tool arguing with an agent that did the work. Both
// witnesses above only speak when the passage was left alone. An agent that
// changed the passage, in any words, has removed its `before`, and the reply
// stands. Grading whether it is the RIGHT change belongs to the browser's page
// check, which has the reviewer's live page in front of it.

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
//  - A PASSAGE THE AGENT CHANGED. Its `before` is gone from the page, so the
//    agent did work there, and this is not the thing that grades it.
//  - A PASSAGE IT CANNOT PLACE, once something was written: an insertion (no
//    `before`), a `before` found twice or recorded as not unique (D9: never
//    guess), and an edit that only added words, whose old block can stand
//    untouched while the agent does the work beside it. See passageOf below.
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
var markdown = require("./markdown.js");
var markdownLinks = require("./markdown_links.js");
var staticServers = require("./static_servers.js");
var reviewFormat = require("../shared/review_format.js");

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
 * The page's words, one entry per block, each folded the way comparable folds.
 *
 * textOf separates blocks with a paragraph break, so splitting on it gives the
 * blocks back, and folding each one with foldTypography is the same fold as
 * comparable: `blocksOf(x).join(" ") === comparable(x)` for a page with no
 * head. The head is dropped because the reviewer never sees it, and a Markdown
 * render's <title> repeats its first heading, which would make every edit to
 * that heading look like a twin.
 *
 * @returns {string[]|null}
 */
function blocksOf(text) {
  try {
    var body = String(text).replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, "");
    return decodeEntities(normalize.textOf(body))
      .split(normalize.PARAGRAPH_BREAK)
      .map(function (block) {
        return normalize.foldTypography(block);
      })
      .filter(function (block) {
        return block.length > 0;
      });
  } catch (error) {
    return null;
  }
}

/**
 * The item's own passage, as the blocks its `before` was.
 *
 * An edit is made on one block, and `before` is that block's text as the
 * reviewer's page read it, so the passage is found as WHOLE blocks and never as
 * a substring. That is what keeps an agent's own wording safe: an agent that
 * kept the old sentence and added one of its own has changed the block, and a
 * substring test would say it had not.
 *
 * Answers null when there is no passage to look for:
 *  - an empty `before`: an insertion has no old words on the page;
 *  - a `before` the reviewer's page recorded as not unique
 *    (`region.ref.text_unique === false`): once the agent changes the right
 *    twin, the other one is still there and would look untouched;
 *  - an `after` that holds the whole `before`: the reviewer only ADDED words.
 *    An agent can do that work and leave the old block exactly as it was,
 *    putting the new words in a block of its own and in its own wording
 *    (test/browser/reverted_edit.spec.js), so the old block still being there
 *    proves nothing. This also covers a typography-only or break-only edit,
 *    whose before and after fold to the same words.
 *
 * @returns {string[]|null}
 */
function passageOf(item) {
  var before = item[record.FIELD.BEFORE];
  if (typeof before !== "string" || !before.trim()) return null;
  var region = item[record.FIELD.REGION];
  if (region && region.ref && region.ref.text_unique === false) return null;
  var foldedBefore = comparable(before);
  var foldedAfter = comparable(item[record.FIELD.AFTER]);
  if (!foldedBefore || !foldedAfter || foldedAfter.indexOf(foldedBefore) !== -1) return null;
  var blocks = blocksOf(before);
  return blocks && blocks.length ? blocks : null;
}

/** Every block index at which the passage starts, in one page's blocks. */
function passageStarts(blocks, passage) {
  var starts = [];
  for (var i = 0; i + passage.length <= blocks.length; i += 1) {
    var whole = true;
    for (var j = 0; j < passage.length; j += 1) {
      if (blocks[i + j] !== passage[j]) {
        whole = false;
        break;
      }
    }
    if (whole) starts.push(i);
  }
  return starts;
}

/**
 * The handled verdict for one item against the pages it could be on.
 *
 * Held open (false) only when the after is not on the page AND one of these
 * says the item's own passage was never touched:
 *  - NOTHING WAS WRITTEN since the reviewer committed (the review-level gate);
 *  - THE BEFORE IS STILL THERE, as whole blocks, exactly once across the pages.
 *    Gone means the agent changed it, in whatever words, and the reply stands.
 *    Twice means the check cannot tell which one the reviewer meant, and it
 *    never guesses (D9).
 *
 * When the passage is found, an after that sits wholly inside it does not count
 * as the change: a reviewer who trimmed words from a paragraph has an after
 * that the untouched paragraph already contains.
 *
 * @param {string[]} pages the HTML of every page read
 * @param {object} item
 * @param {boolean} nothingWritten
 * @returns {boolean|null} true shown, false held open, null not ours to grade
 */
function verdictFor(pages, item, nothingWritten) {
  var needle = comparable(item[record.FIELD.AFTER]);
  if (!needle) return null;
  var passage = passageOf(item);
  var read = [];
  var found = [];
  pages.forEach(function (html) {
    var blocks = blocksOf(html);
    if (!blocks) return;
    read.push(blocks);
    if (!passage) return;
    passageStarts(blocks, passage).forEach(function (start) {
      found.push({ page: read.length - 1, start: start });
    });
  });
  if (read.length === 0) return null;

  var untouched = found.length === 1 ? found[0] : null;
  if (!untouched && !nothingWritten) return null;

  for (var p = 0; p < read.length; p += 1) {
    var blocks = read[p];
    var hay = blocks.join(" ");
    var from = -1;
    var to = -1;
    if (untouched && untouched.page === p) {
      from = blocks.slice(0, untouched.start).join(" ").length + (untouched.start > 0 ? 1 : 0);
      to = from + passage.join(" ").length;
    }
    var at = hay.indexOf(needle);
    while (at !== -1) {
      if (!(at >= from && at + needle.length <= to)) return true;
      at = hay.indexOf(needle, at + 1);
    }
  }
  return false;
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
 * stat'ed, so one write anywhere turns this witness off for every item in that
 * review. On its own that let an agent fix item one, answer handled to items
 * one through five, and slip two to five past the check. The per-item witness
 * in verdictFor (the item's own `before`, still on the page) closes that.
 *
 * WHY IT IS KEPT alongside the per-item witness. When nothing at all was
 * written, the agent changed nothing, and that holds for shapes the per-item
 * witness cannot place: an insertion, a `before` with a twin, a page whose
 * blocks do not line up with the reviewer's. It never second-guesses real work,
 * because it only speaks when there was none.
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

    // AN ITEM MADE ON A LINKED DOCUMENT is judged against that document, not
    // the page that linked to it (spec 20260922.02). The file comes from the
    // same mount lookup that names it in review.json; one it cannot vouch for
    // is "cannot tell".
    var pagePath = item[record.FIELD.PAGE_PATH];
    if (reviewFormat.isLinkedPage(pagePath)) {
      return linkedPageShows(meta, reviewId, item, pagePath);
    }

    // Both halves of the per-item rule live in verdictFor: the review-level
    // gate (nothing written) and the item's own passage (its before, still on
    // the page exactly once).
    var pages = [];
    pageFilesFor(meta, item).forEach(function (file) {
      try {
        pages.push(fs.readFileSync(file, "utf8"));
      } catch (error) {
        // An unreadable file is not evidence either way.
      }
    });
    return verdictFor(pages, item, !touchedSince(meta, item));
  }

  function linkedPageShows(meta, reviewId, item, pagePath) {
    var file = null;
    try {
      file = staticServers.linkedFileForPage(dir, meta.agent_session_id, reviewId, pagePath);
    } catch (error) {
      file = null;
    }
    if (!file) return null;
    var at = item[record.FIELD.UPDATED_AT] || item[record.FIELD.CREATED_AT];
    var committedAt = typeof at === "string" ? Date.parse(at) : NaN;
    var nothingWritten;
    try {
      nothingWritten = Number.isFinite(committedAt) && fs.statSync(file).mtimeMs <= committedAt;
    } catch (error) {
      return null;
    }
    var html;
    try {
      // The page the reviewer sees is the render, so a Markdown file is read
      // the way the server renders it. A throwaway registry: nothing is
      // mounted or recorded by a check.
      html = markdown.isMarkdown(file)
        ? markdown.render(file, { links: markdownLinks.createRegistry({}) })
        : fs.readFileSync(file, "utf8");
    } catch (error) {
      return null;
    }
    return verdictFor([html], item, nothingWritten);
  }

  return { pageShows: pageShows, rebuild: rebuild };
}

module.exports = {
  decodeEntities: decodeEntities,
  touchedSince: touchedSince,
  comparable: comparable,
  blocksOf: blocksOf,
  passageOf: passageOf,
  verdictFor: verdictFor,
  checkable: checkable,
  pageFilesFor: pageFilesFor,
  createHandledCheck: createHandledCheck
};
