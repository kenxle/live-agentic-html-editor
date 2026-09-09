// The Done tab's contents, what an agent's answer does to a card, and the
// treatment a question gets.
//
// Owner: 3A. The rail CHROME (the tab shell, the status line, the failure
// chips, the card API) is 1B's, in overlay.js, and nothing here edits it. This
// file is what the Done pane holds, plus the one thing that has to happen on
// the page when an agent answers: the reviewer finds out, on the item's own
// card, without reading a chat window (R34).
//
// ---------------------------------------------------------------------------
// Three rules, in the order they matter
// ---------------------------------------------------------------------------
//
//  1. AN AGENT'S QUESTION IS THE LOUDEST THING ON A CARD. Not a tinted label.
//     A question the reviewer scrolls past is a stalled agent: the agent is
//     blocked, the work is not moving, and nothing about a small colored word
//     says so. The treatment is below, and its rules are stated where they are
//     drawn rather than left to the CSS to imply.
//
//  2. A HANDLED ITEM IS KEPT AND REOPENABLE (R38). It loses its highlight and
//     moves to the Done tab; it is never deleted. Reopening is a lifecycle
//     transition the REVIEWER makes (handled -> ready, lifecycle.js's actor
//     column). It archives the completed exchange and posts the new revision
//     through the ordinary ready-item path.
//
//  3. AGENT TEXT IS ITS OWN TRUST CLASS. Plain text, bounded by
//     review_format's own bound with the marker visible, labelled with the name
//     from the reply itself (absent one, "agent"), and written with
//     textContent. It is never markup, never a link, and never presented as an
//     instruction to the reviewer.
//
// ---------------------------------------------------------------------------
// The question treatment, stated as design
// ---------------------------------------------------------------------------
//
// It borrows nothing new: one accent, the rail's own tokens, the rail's own
// type scale. What makes it loud is placement, size and a demand:
//
//   PLACEMENT   the card is pulled to the top of its pane (flex order) and
//               marked, so a question cannot sit below three finished items
//   RULE        a 3px accent rule down the whole block, full bleed to the
//               card's padding, which is the only element in the rail with one
//   NAME        an eyebrow that says WHO is asking, in the accent ink, because
//               "an agent" is not who the reviewer is answering
//   SIZE        the question is the largest text in the rail, one step above
//               the reviewer's own words, which are otherwise the largest
//   BOX         the follow-up composer, already on the card: every replied item
//               gets one. The block deliberately adds no button of its own,
//               because the only thing one could do is focus a textarea the
//               reviewer is already looking at
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.tabDone = factory(
      root.LAHE.markers,
      root.LAHE.record,
      root.LAHE.lifecycle,
      root.LAHE.protocol,
      root.LAHE.failures,
      root.LAHE.review_format,
      root.LAHE.overlay
    );
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/record.js"),
      require("../shared/lifecycle.js"),
      require("../shared/protocol.js"),
      require("../shared/failures.js"),
      require("../shared/review_format.js"),
      require("./overlay.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, record, lifecycle, protocol, failures, reviewFormat, overlayModule) {
  "use strict";

  var ROW_CLASS = "lahe-done-row";
  var ASK_CLASS = "lahe-ask";
  var ASKING_ATTR = "data-lahe-asking";
  // A card holding a reply the reviewer has not read yet.
  var UNSEEN_ATTR = "data-lahe-unseen";

  /**
   * Which reply this is, as one string.
   *
   * A boolean cannot carry this. An item that is answered, reopened, and
   * answered again has to read as new the second time, so the mark has to name
   * WHICH reply was read: the time it landed, plus the revision it answered.
   * Returns null when there is no reply to have seen.
   */
  function replyStamp(item) {
    var reply = item && item[record.FIELD.REPLY];
    if (!reply) return null;
    var rev = item[record.FIELD.REV];
    return String(reply.at || "") + "@" + String(rev === undefined || rev === null ? "" : rev);
  }

  /**
   * Is this a reply the reviewer actually has to read?
   *
   * The badge used to count every folded reply, which meant "claude carried this
   * change into the source" interrupted the reviewer exactly as loudly as an
   * open question did. Two things count now:
   *
   *   THE AGENT SAID SO   user_needs_to_see_reply on the reply line, which the
   *                       contract asks for on an answer, a caveat, or a change
   *                       made differently than asked, AND words to read in
   *                       text or reason
   *   THE STATUS SAYS SO  question and not_handled, always, flag or no flag: a
   *                       question needs an answer and a refusal needs its
   *                       reason read, and neither is the agent's call
   *
   * Everything else still lands on its card in Done, whole, with its text and
   * its timestamp. It simply arrives already read.
   *
   * THE FLAG NEEDS WORDS BEHIND IT. All three things the contract asks the flag
   * for, an answer, a caveat, a change made differently than asked, are things
   * an agent says in words. A flagged reply carrying neither text nor reason
   * has nothing to read, so the card falls through to the wordless line
   * `agentMessageFor` writes: "claude handled this." Counting that is a badge
   * that sends the reviewer to a card to learn nothing, and it happens in runs:
   * an agent that flags one wordless confirmation flags twelve, and the number
   * on the rail stops meaning anything. Ken hit exactly this (2026-09-04). The
   * agent asked for attention it had no use for, so the ask is refused here
   * rather than trusted; the reply is not hidden, only already read.
   *
   * `question` and `not_handled` are deliberately NOT held to this. A refusal
   * with no reason and a question with no text are both worth fixing, but the
   * status alone is the signal there, and swallowing a wordless refusal would
   * leave the reviewer thinking their item was done.
   *
   * @param {object} reply the reply as it sits on a record
   */
  function needsToSeeReply(reply) {
    if (!reply) return false;
    if (reply.status === record.REPLY_STATUS.QUESTION) return true;
    if (reply.status === record.REPLY_STATUS.NOT_HANDLED) return true;
    if (reply.user_needs_to_see_reply !== true) return false;
    return hasWords(reply.text) || hasWords(reply.reason);
  }

  /** Is there anything here for a person to actually read? */
  function hasWords(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  /**
   * The ids whose reply the reviewer has not read.
   *
   * Pure: items in, marks in, ids out. Nothing here touches the DOM or storage,
   * which is what makes the rule testable without a browser.
   *
   * @param {object[]} items every record this review holds
   * @param {object} marks id -> the stamp of the reply already read
   * @returns {string[]}
   */
  function unseenReplyIds(items, marks) {
    var seen = marks && typeof marks === "object" ? marks : {};
    var out = [];
    (items || []).forEach(function (item) {
      var stamp = replyStamp(item);
      if (!stamp) return;
      if (!needsToSeeReply(item[record.FIELD.REPLY])) return;
      if (seen[item[record.FIELD.ID]] !== stamp) out.push(item[record.FIELD.ID]);
    });
    return out;
  }

  /**
   * The unseen ids, grouped by the tab their card actually sits in.
   *
   * THE BADGE GOES WHERE THE CARD IS. A question or a refusal keeps its card on
   * the ACTIVE (or Edits) side, deliberately: the work is not finished, so it
   * stays where unfinished work lives. Badging Done for it sent the reviewer to
   * a tab the thing was not in. The pane rule is not restated here; `paneOf` is
   * the rail's own paneForItem, passed in.
   *
   * @param {object[]} items every record this review holds
   * @param {object} marks id -> the stamp of the reply already read
   * @param {function} paneOf item -> the tab name its card lives in
   * @returns {object} tab -> ids, tabs with nothing unseen simply absent
   */
  function unseenByTab(items, marks, paneOf) {
    var byId = Object.create(null);
    (items || []).forEach(function (item) {
      byId[item[record.FIELD.ID]] = item;
    });
    // A plain object, so a caller can compare it with a literal.
    var out = {};
    unseenReplyIds(items, marks).forEach(function (id) {
      var tab = paneOf(byId[id]);
      if (!out[tab]) out[tab] = [];
      out[tab].push(id);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // The toast: telling the reviewer an answer arrived, on the page
  // ---------------------------------------------------------------------------
  //
  // The rail is where answers live, and Ken works with the rail closed, because
  // an open rail covers the page he came to review. That is the tool working as
  // intended, and the cost is real: "I forget to go look for answers and end up
  // asking the same questions again."
  //
  // So an answer worth stopping for says so on the page. Three things keep this
  // from becoming noise, and they are the whole design:
  //
  //   ONE NOTION OF IMPORTANT   needsToSeeReply, unchanged, is the test. The
  //                             badge and the toast agree by construction, and
  //                             a routine "carried this into the source" gets
  //                             neither.
  //   NOT IF THEY ARE LOOKING   a reply landing on the tab the reviewer already
  //                             has open is on screen. A toast would be telling
  //                             them about something they can see.
  //   NOT WHEN THEY CANNOT ACT  a refused (read-only) window writes nothing and
  //                             answers nothing, so it interrupts with nothing.

  // The plain note is labeled with who said it ("claude says"), because "Note"
  // told Ken nothing about where the words came from. The name is the reply's
  // own agent field, the same one the card shows.
  var TOAST_LABEL = {
    question: "Question",
    not_handled: "Not handled",
    says: " says"
  };

  // The whole answer, and one line of context. The toast grows to fit the text,
  // so this is not a display clamp; it is the ceiling on what is CARRIED, so a
  // very long agent answer cannot turn the toast into a wall. An answer longer
  // than this is cut on a word, and the card has the rest.
  var TOAST_TEXT_MAX = 1200;
  var TOAST_ABOUT_MAX = 120;

  /** The short word at the top of the toast. */
  function toastLabelFor(reply) {
    var status = reply && reply.status;
    if (status === record.REPLY_STATUS.QUESTION) return TOAST_LABEL.question;
    if (status === record.REPLY_STATUS.NOT_HANDLED) return TOAST_LABEL.not_handled;
    return ((reply && reply.agent) || "agent") + TOAST_LABEL.says;
  }

  /** Cut to length on a word where it can, with the ellipsis saying it was cut. */
  function clip(text, max) {
    var value = String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim();
    if (value.length <= max) return value;
    var cut = value.slice(0, max);
    var space = cut.lastIndexOf(" ");
    if (space > max * 0.6) cut = cut.slice(0, space);
    return cut + "...";
  }

  /**
   * Should this reply interrupt the reviewer?
   *
   * Pure, and the whole decision: given the reply, whether the reviewer is
   * already looking at the tab its card is in, whether this window can act at
   * all, and whether this browser had already folded this same reply before
   * (a reload re-delivers the backlog, and an answer read yesterday is not news
   * today).
   *
   * @param {object} options
   * @param {object} options.reply       the reply as it sits on the record
   * @param {boolean} [options.watching] the rail is open on the card's own tab
   * @param {boolean} [options.readOnly] this window is refused
   * @param {boolean} [options.known]    this browser already held this reply
   */
  function shouldToastReply(options) {
    var o = options || {};
    if (o.readOnly === true) return false;
    if (o.known === true) return false;
    if (o.watching === true) return false;
    return needsToSeeReply(o.reply);
  }

  /** How many replies are waiting, and how many of those are questions. */
  function replyWaitCounts(items, marks) {
    var byId = Object.create(null);
    (items || []).forEach(function (item) {
      byId[item[record.FIELD.ID]] = item;
    });
    var counts = { total: 0, questions: 0 };
    unseenReplyIds(items, marks).forEach(function (id) {
      var reply = byId[id] && byId[id][record.FIELD.REPLY];
      counts.total += 1;
      if (reply && reply.status === record.REPLY_STATUS.QUESTION) counts.questions += 1;
    });
    return counts;
  }

  /**
   * The one sentence a summary toast says. Plain words, and no jargon: it is
   * read at a glance by someone who was doing something else.
   */
  function waitingSentence(counts) {
    var c = counts || {};
    var total = c.total || 0;
    var questions = c.questions || 0;
    if (total < 1) return "";
    if (total === 1) {
      return questions ? "1 reply is waiting, and it is a question." : "1 reply is waiting.";
    }
    var head = String(total) + " replies are waiting";
    if (!questions) return head + ".";
    if (questions === 1) return head + ", 1 of them is a question.";
    if (questions === total) return head + ", and they are all questions.";
    return head + ", " + String(questions) + " of them are questions.";
  }

  /**
   * The marks after the reviewer has looked at a set of replies.
   *
   * Built fresh from the items rather than merged into the old map, so an item
   * that no longer has a reply drops out and the bucket cannot grow forever.
   *
   * `includes` narrows WHICH replies this reading covers, which is how opening
   * one tab marks that tab's replies read and leaves another tab's badge
   * standing. An item the filter excludes keeps whatever mark it already had
   * (from `prior`), so reading Active cannot un-read Done.
   *
   * @param {object[]} items every record this review holds
   * @param {object} [prior] the marks as they stand now
   * @param {function} [includes] item -> is this one of the replies just read
   */
  function seenMarksFor(items, prior, includes) {
    var had = prior && typeof prior === "object" ? prior : {};
    var next = {};
    (items || []).forEach(function (item) {
      var stamp = replyStamp(item);
      if (!stamp) return;
      var id = item[record.FIELD.ID];
      if (!includes || includes(item)) next[id] = stamp;
      else if (Object.prototype.hasOwnProperty.call(had, id)) next[id] = had[id];
    });
    return next;
  }

  // What the reviewer reads when their own rewording outran an agent's answer.
  // A constant, so the test asserts the sentence the reviewer sees.
  var STALE_NOTICE = "answered an older version of this, so it is still open. Nothing was lost.";

  // The name this file's sheet answers to inside the rail's closed root.
  var SHEET_KEY = "tab_done";

  // Injected once, into the rail's closed shadow root, through the rail's own
  // ensureStyleSheet. The rail's own stylesheet is 1B's and is not edited;
  // these rules add the things this file draws.
  var STYLE = [
    "." + ROW_CLASS + "{display:flex;flex-direction:column;gap:8px}",
    "." + ROW_CLASS + " .lahe-done-said{font-size:13.5px;line-height:1.5;color:var(--ink);",
    "white-space:pre-wrap;overflow-wrap:anywhere}",
    // Reopen wears the rail's own card-action register (`.cardact`), so every
    // control that sits on a card has one voice rather than one per file.
    // On a hand-edit card this row draws nothing at all: the reviewer's words
    // are empty and Reopen has moved into the Edits row's own footer, so both
    // slots are hidden rather than left as two blank gaps in the card.
    "." + ROW_CLASS + " .lahe-done-said:empty{display:none}",
    "." + ROW_CLASS + " .cardacts:empty{display:none}",
    ".lahe-thread{display:flex;flex-direction:column;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}",
    ".lahe-thread-round{display:flex;flex-direction:column;gap:5px}",
    ".lahe-thread-turn{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;line-height:1.45}",
    ".lahe-thread-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}",
    ".lahe-thread-turn strong{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint)}",
    ".lahe-thread-time,.lahe-ask-time{font-size:10px;color:var(--ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".lahe-ask-time{margin-left:auto;font-weight:400;letter-spacing:0;text-transform:none}",
    ".lahe-thread-text{display:block}",
    ".lahe-followup{display:flex;flex-direction:column;gap:7px;padding-top:8px}",
    ".lahe-followup-label{font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-faint)}",
    ".lahe-followup textarea{box-sizing:border-box;width:100%;min-height:72px;resize:vertical;border:1px solid var(--line);border-radius:7px;padding:8px 9px;background:var(--paper);color:var(--ink);font:inherit;line-height:1.4}",
    ".lahe-followup textarea:focus{outline:2px solid var(--accent);outline-offset:1px}",
    ".lahe-followup .cardacts{justify-content:flex-end}",

    // The question. Full bleed to the card's padding, so the rule runs the
    // whole height of the block rather than sitting in a box inside a box.
    "." + ASK_CLASS + "{margin:2px -12px -2px;padding:10px 12px 11px 13px;",
    "border-left:3px solid var(--accent);background:var(--accent-wash);",
    "display:flex;flex-direction:column;gap:7px}",
    "." + ASK_CLASS + " .lahe-ask-who{display:flex;align-items:center;gap:6px;font-size:10px;",
    "font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--accent-ink)}",
    "." + ASK_CLASS + " .lahe-ask-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}",
    // One step above the reviewer's own 13.5px, which is otherwise the largest
    // text in the rail. The question is a stop, not a line of chrome.
    "." + ASK_CLASS + " .lahe-ask-text{font-size:15px;line-height:1.45;color:var(--ink);",
    "overflow-wrap:anywhere;white-space:pre-wrap}",
    // In dark the wash alone carries less separation from the card behind it, so
    // the block gets a hairline as well. Same relationship, drawn twice.
    ":host([data-lahe-scheme='dark']) ." + ASK_CLASS + "{",
    "border-top:1px solid rgba(147,167,234,.28);border-bottom:1px solid rgba(147,167,234,.28)}",
    // The card carrying a question is pulled to the top of its pane and given
    // the accent border, so it is the first thing in the tab and reads as one
    // object with the block inside it.
    ".card[" + ASKING_ATTR + "='true']{order:-1;border-color:var(--accent)}",

    // The unseen mark. A reply the agent flagged (or a question, or a refusal)
    // that folded while the reviewer was looking at another tab is the only
    // sign they get that an answer arrived, so the card carries one: an accent
    // rule down its left edge, drawn as an inset shadow
    // so it costs the card no layout and cannot fight the border a question
    // sets. Deliberately calmer than the question block above: a question is a
    // stop, and this is a "there is something here". If the same card is both,
    // the question treatment is the one that reads.
    //
    // The mark OUTLIVES the badge by one visit. Opening the tab clears the
    // count, and the cards that were unread when the reviewer got there keep
    // this rule until they leave the tab. Otherwise the badge says four and the
    // tab it sends them to has no way of saying which four.
    ".card[" + UNSEEN_ATTR + "='true']{box-shadow:inset 3px 0 0 0 var(--accent)}",
    ".card[" + UNSEEN_ATTR + "='true'][" + ASKING_ATTR + "='true']{box-shadow:none}"
  ].join("");

  function createDoneTab(options) {
    var opts = options || {};
    var rail = opts.overlay || overlayModule.shared;
    var store = opts.store || null;
    var reviewId = opts.reviewId || null;
    var comments = opts.comments || null;
    var sync = opts.sync || null;
    var onContinued = typeof opts.onContinued === "function" ? opts.onContinued : function () {};
    var isReadOnly = typeof opts.isReadOnly === "function" ? opts.isReadOnly : function () { return false; };
    var doc = Object.prototype.hasOwnProperty.call(opts, "document")
      ? opts.document
      : typeof document !== "undefined"
      ? document
      : null;
    if (!store) throw new TypeError("createDoneTab: a store is required; the Done tab reads the reviewer's own records");
    if (!reviewId) throw new TypeError("createDoneTab: a review id is required; storage is keyed by it");

    var mounted = false;
    // The sheet itself, not a boolean. See ensureStyle.
    var styleNode = null;
    // id -> row node, and id -> question node. Created once, updated in place,
    // removed only when the item leaves the state that drew them. The rail's
    // own law, applied to this file's nodes.
    var rows = Object.create(null);
    var asks = Object.create(null);
    var threads = Object.create(null);
    var composers = Object.create(null);
    // id -> the Reopen button. Held separately from its row because on a
    // hand-edit card the button does not live in that row: it moves next to
    // Undo. Whoever removes the row still has to remove the button.
    var counters = { folded: 0, refused: 0, rejected: 0, reopened: 0, questions: 0 };
    // id -> true for the replies the reviewer genuinely has not read. This is
    // what the tab badges count. The durable truth is in storage.
    var unseenNow = Object.create(null);
    // id -> true for the cards that were unread at the moment the reviewer
    // arrived on this tab. See "the two-step decay" below.
    var freshNow = Object.create(null);
    // Which tab that visit is to, so a paint can tell a real visit from none.
    var freshTab = null;
    // id -> true for the cards currently wearing the mark on screen, so a paint
    // knows which ones to take it back off. Unseen or fresh, both wear it.
    var markedNow = Object.create(null);
    var dropTabWatch = null;
    var dropCollapseWatch = null;

    function el(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = text;
      markers.markChrome(node);
      return node;
    }

    /**
     * The one stylesheet this file adds, inside the rail's own closed root.
     *
     * Connectedness, not a boolean, and the rail's root rather than a card.
     * The sheet used to ride inside the first node this file attached, which
     * was usually the question block. Answering the question removes that
     * block, so the sheet went with it while the old flag still said
     * "installed": the thread and the follow-up composer drawn a moment later
     * came out with no CSS and no error, which is why the history read as one
     * run-on line and the textarea sat on top of its own label.
     *
     * `node` is the fallback host for a rail that is not on screen (a headless
     * stub in a unit test). A real rail takes the sheet into its shadow root.
     */
    function ensureStyle(node) {
      if (!doc) return;
      if (styleNode && styleNode.isConnected) return;
      if (rail && typeof rail.ensureStyleSheet === "function") {
        styleNode = rail.ensureStyleSheet(SHEET_KEY, STYLE);
        if (styleNode) return;
      }
      if (!node) return;
      var style = doc.createElement("style");
      style.setAttribute("data-lahe-sheet", SHEET_KEY);
      style.textContent = STYLE;
      node.appendChild(style);
      styleNode = style;
    }

    function itemsNow() {
      return store.read(reviewId);
    }

    function itemById(id) {
      return store.readItem(reviewId, id);
    }

    // -------------------------------------------------------------------------
    // The Done pane
    // -------------------------------------------------------------------------

    function mount() {
      if (mounted) return api;
      mounted = true;
      // OPENING THE TAB IS THE READING. The rail owns the tab strip and knows
      // nothing about replies, so it says "the reviewer moved here" and this
      // file decides what that means.
      // Every tab, not only Done: an unseen reply is badged on the tab its card
      // sits in, so the tab that clears it is that same tab.
      if (!dropTabWatch && typeof rail.onTabSelect === "function") {
        dropTabWatch = rail.onTabSelect(function (tab) {
          visitTab(tab);
        });
      }
      // Collapsing the rail ends the visit, so the cards the reviewer was given
      // a second look at go back to ordinary. Opening it again is a new visit,
      // and a new visit to an already-read tab has nothing fresh in it.
      if (!dropCollapseWatch && typeof rail.onCollapse === "function") {
        dropCollapseWatch = rail.onCollapse(function () {
          clearFresh();
        });
      }
      refresh();
      // A load that arrives with answers already waiting says so once. See
      // toastWaiting: a backlog is one interruption, not one per reply.
      toastWaiting();
      return api;
    }

    // -------------------------------------------------------------------------
    // Replies the reviewer has not read yet
    // -------------------------------------------------------------------------
    //
    // An agent's reply used to move an item to Done and say nothing. The
    // reviewer, who is on the Active tab writing the next comment, got no signal
    // that an answer had arrived, and no way to tell the answers they had read
    // from the ones they had not. The mark below is that signal, and it is
    // reviewer-side only: it lives in browser storage, never in review.json, and
    // no agent sees it or can set it.

    function readSeen() {
      return typeof store.readSeenReplies === "function" ? store.readSeenReplies(reviewId) : {};
    }

    function writeSeen(marks) {
      if (typeof store.writeSeenReplies === "function") store.writeSeenReplies(reviewId, marks);
      return marks;
    }

    /** The card wears the mark, so it survives whatever this file draws inside it. */
    function markUnseenCard(id, unseen) {
      var node = rail.cardNode(id);
      if (!node) return false;
      if (unseen) node.setAttribute(UNSEEN_ATTR, "true");
      else node.removeAttribute(UNSEEN_ATTR);
      return true;
    }

    /**
     * Which tab this item's card is in, asked of the rail.
     *
     * The rail owns the pane rule; this file only needs the answer. It asks
     * with the ITEM rather than reading a card's stored pane, so an item the
     * rail has not been handed yet still answers, and a card that moved tabs
     * answers with where it is now.
     */
    function paneOf(item) {
      if (!item) return overlayModule.TAB.DONE;
      if (typeof rail.paneForItem === "function") return rail.paneForItem(item);
      var card = typeof rail.getCard === "function" ? rail.getCard(item[record.FIELD.ID]) : null;
      return (card && card.pane) || overlayModule.TAB.DONE;
    }

    /** Recompute from storage, repaint the cards, and hand each tab its count. */
    function paintUnseen() {
      var grouped = unseenByTab(itemsNow(), readSeen(), paneOf);
      var ids = [];
      var next = Object.create(null);
      Object.keys(grouped).forEach(function (tab) {
        grouped[tab].forEach(function (id) {
          ids.push(id);
          next[id] = true;
        });
      });
      // Unseen OR fresh wears the mark. The badge counts only the unseen ones,
      // which is what makes the count clear on arrival while the cards under it
      // stay pointed out for the length of the visit.
      var marked = Object.create(null);
      ids.forEach(function (id) {
        marked[id] = true;
      });
      Object.keys(freshNow).forEach(function (id) {
        marked[id] = true;
      });
      Object.keys(markedNow).forEach(function (id) {
        if (!marked[id]) markUnseenCard(id, false);
      });
      Object.keys(marked).forEach(function (id) {
        markUnseenCard(id, true);
      });
      markedNow = marked;
      unseenNow = next;
      // Every tab is told, including the ones with nothing: a card that moved
      // out of a tab has to take its badge with it.
      if (typeof rail.setTabNewCount === "function") {
        overlayModule.TABS.forEach(function (tab) {
          rail.setTabNewCount(tab, (grouped[tab] || []).length);
        });
      }
      return ids;
    }

    /**
     * The reviewer arrived on a tab. Two things decay, at two different speeds.
     *
     * THE BADGE CLEARS AT ONCE. It said "there are four things here", the
     * reviewer came to look, and a count that keeps standing while they read is
     * a count that stops meaning anything. The seen marks go to storage in the
     * same breath, so a reload does not resurrect them as unread.
     *
     * THE CARDS KEEP THEIR MARK FOR THE VISIT. This is the half that was
     * missing: the badge said four, the reviewer opened the tab, and every card
     * looked the same, so the one question the badge had raised ("which four?")
     * had no answer anywhere on screen (reported live on 2026-08-18). The ids
     * that were unread at the moment of arrival are held here, in memory only,
     * and the card treatment reads unseen OR fresh. Leaving the tab drops them,
     * so the next visit shows ordinary cards.
     *
     * @param {string} tab the tab the reviewer just opened
     */
    function visitTab(tab) {
      // Captured BEFORE the marks are written, because writing them is exactly
      // what makes these ids stop being unseen.
      var arriving = unseenByTab(itemsNow(), readSeen(), paneOf)[tab] || [];
      freshNow = Object.create(null);
      freshTab = tab;
      arriving.forEach(function (id) {
        freshNow[id] = true;
      });
      return markRepliesSeen(tab);
    }

    /**
     * The visit is over: another tab, a collapsed rail, or an unmount.
     *
     * Session memory only, so there is nothing to erase in storage and nothing
     * a reload could bring back.
     */
    function clearFresh() {
      if (!freshTab && !Object.keys(freshNow).length) return false;
      freshNow = Object.create(null);
      freshTab = null;
      paintUnseen();
      return true;
    }

    /**
     * The replies in front of the reviewer right now count as read.
     *
     * Called when the reviewer selects a tab, and when a reply folds while they
     * are already sitting on the tab its card lands in: in both cases the answer
     * is in front of them, so a badge would be telling them about something they
     * can see. With no tab named, everything answered counts as read.
     *
     * @param {string} [tab] the tab the reviewer just opened
     */
    function markRepliesSeen(tab) {
      var inTab = tab
        ? function (item) {
            return paneOf(item) === tab;
          }
        : null;
      writeSeen(seenMarksFor(itemsNow(), readSeen(), inTab));
      return paintUnseen();
    }

    /** Is the reviewer looking at this tab as the reply lands? */
    function watchingTab(tab) {
      if (typeof rail.currentTab !== "function") return false;
      if (rail.currentTab() !== tab) return false;
      // A collapsed rail is not being looked at, whatever tab it would open on.
      return typeof rail.isCollapsed === "function" ? rail.isCollapsed() !== true : true;
    }

    function refresh() {
      if (!mounted) return api;
      // The unseen count is RECORD truth, not DOM truth. A headless rail (no
      // document, which is the shape the unit tests run in) draws nothing and
      // still has to know how many replies are waiting to be read.
      if (!doc) {
        paintUnseen();
        return api;
      }
      // Every paint, not only the paints that build a node. A remount throws the
      // rail's root away, and the sheet is in that root.
      ensureStyle(null);
      var seen = Object.create(null);

      itemsNow().forEach(function (item) {
        // Historical rounds and a current response can exist in either pane.
        // Ensure the card exists before attaching their nodes on a cold load.
        if (record.threadOf(item).length || item[record.FIELD.REPLY]) {
          rail.upsertCard(item);
          rail.setCardState(item[record.FIELD.ID], item[record.FIELD.STATE]);
        }
        if (record.threadOf(item).length) drawThread(item);
        else clearThread(item[record.FIELD.ID]);
        if (item[record.FIELD.REPLY]) {
          drawComposer(item);
          if (item[record.FIELD.REPLY].status === record.REPLY_STATUS.QUESTION) {
            rail.setAgentMessage(item[record.FIELD.ID], null);
            drawQuestion(item);
          } else {
            rail.setAgentMessage(item[record.FIELD.ID], agentMessageFor(item));
          }
        } else {
          clearComposer(item[record.FIELD.ID]);
          clearQuestion(item[record.FIELD.ID]);
        }
        if (item[record.FIELD.STATE] !== record.STATE.HANDLED) return;
        var id = item[record.FIELD.ID];
        seen[id] = true;
        rail.upsertCard(item);
        rail.setCardState(id, record.STATE.HANDLED);
        // R37, the half that is on the PAGE: a handled item loses its highlight.
        // Here rather than only in the fold path, because an item can arrive
        // handled from storage on a fresh load too, and the page it lands on has
        // the same right not to be covered in marks on finished passages.
        unpaintHandled(id);
        if (item[record.FIELD.REPLY]) rail.setAgentMessage(id, agentMessageFor(item));
        if (!rows[id]) {
          rows[id] = buildRow(item);
          ensureStyle(rows[id]);
          rail.attachCardNode(id, rows[id]);
        }
        updateRow(rows[id], item);
      });

      Object.keys(rows).forEach(function (id) {
        if (seen[id]) return;
        dropRow(id);
      });

      // Last, because it reads the cards this paint just created.
      paintUnseen();

      return api;
    }

    function dropRow(id) {
      var row = rows[id];
      if (row && row.parentNode) row.parentNode.removeChild(row);
      delete rows[id];
    }

    // ONE CARRIER PER FACT. A handled card used to say the reviewer's note
    // twice, the agent's sentence twice and the file list twice: the Active
    // tab's row, this row, and the rail's own `.agent` block all drew the same
    // three things. The rail's `.agent` block is the good one, so it keeps the
    // agent's sentence and the files; this row keeps the reviewer's own words
    // and Reopen; and the Active row is not drawn on a card in the Done pane
    // (the rail hides it by the card's state). Six blocks for three facts
    // becomes three.
    //
    // A handled HAND EDIT was the same defect one layer down: the Edits row is
    // also on this card, and both rows printed the change summary, once above
    // the before-and-after and once below it. This row no longer says it (see
    // saidBy),
    // so a handled edit reads as one summary, the exact wording, and the two
    // things the reviewer can do about it.
    function buildRow(item) {
      var row = el("div", ROW_CLASS);
      row.setAttribute("data-lahe-item", item[record.FIELD.ID]);
      row.appendChild(el("div", "lahe-done-said", ""));

      // NO BUTTONS. Ken: "in a completed comment we have buttons for follow up
      // and reopen and then below a text field to follow up. this all seems very
      // redundant and cluttered ... reopening without a comment isn't useful,
      // and the follow up button just focuses the existing follow up field."
      //
      // Both were true. Follow up called focusComposer on a composer that is
      // drawn for every replied item anyway, so it moved the caret into a box
      // already on screen. Reopen sent the same request back untouched, and it
      // had to be DISABLED whenever the field held a draft, which is the tell:
      // the two controls were alternatives, and the one with words is the one
      // worth having.
      //
      // Reopening did not go away with the button. Sending from the field ends
      // the handled state (continueItem sets READY and posts item.ready), so
      // R38's handled -> ready transition is still here, now always carrying
      // the reason it happened. The automatic reopen keeps its own path:
      // index.js calls reopen() with a note when a handled hand edit is undone
      // on the page.
      return row;
    }

    /**
     * What the reviewer asked for, in their own words.
     *
     * A hand edit's change summary is NOT said here. The Edits row on the same
     * card heads its before-and-after with that one sentence, so printing
     * `change` again put the same words above the diff and below it, with the
     * diff in between saying it a third time. One carrier per fact: the Edits
     * row owns the change, this row owns the reviewer's own note, and a hand
     * edit usually carries none. The Active tab's row already reads only the
     * note, so this is also the two panes finally agreeing.
     */
    function saidBy(item) {
      var note = item[record.FIELD.NOTE];
      if (record.isHandEdit(item)) return note || "";
      var change = item[record.FIELD.CHANGE];
      if (note && change && note !== change) return note + "\n" + change;
      return note || change || item[record.FIELD.AFTER] || "";
    }

    function updateRow(row, item) {
      row.querySelector(".lahe-done-said").textContent = saidBy(item);
    }

    /**
     * What the rail's own agent carrier says on a handled card.
     *
     * The reply as stored, with `reason` folded into `text` when the agent gave
     * a reason and nothing else, so the one carrier says the one sentence
     * whichever field the agent used. Bounded here, once, because this is the
     * only path a handled reply reaches the card by now.
     */
    function agentMessageFor(item) {
      var reply = item[record.FIELD.REPLY];
      if (!reply) return null;
      var said = reply.text || reply.reason;
      return {
        status: reply.status || null,
        // Agent name and reason are agent-controlled and reach the rail, so they
        // are bounded here the way reply.text already is (finding 22).
        agent: reviewFormat.boundData(agentName(reply), reviewFormat.CONTEXT_MAX),
        // The reply's own fields are kept as they came, so nothing reading the
        // card's model loses what the agent actually said in which field. Only
        // `text` is what gets DRAWN, which is what makes it one carrier.
        reason: reviewFormat.boundData(reply.reason, reviewFormat.CONTEXT_MAX),
        // The wordless fallback is kind-aware: "made this change" was written
        // for hand edits and read strangely under a handled COMMENT, where the
        // agent made a change the card never shows (Ken, 2026-08-18).
        text: said
          ? boundedText(said)
          : agentName(reply) +
            (record.isHandEdit(item) ? " carried this change into the source." : " handled this."),
        files: Array.isArray(reply.files) ? reply.files : [],
        at: reply.at || null
      };
    }

    // R37's page half. The paint is 1D's, so this file says WHEN and never how:
    // a retired item drops its highlight, a reopened one gets it back with its
    // anchor resolved against the page as it is now (the agent's change is
    // usually what retired it, so the old range is stale by construction).
    function unpaintHandled(id) {
      if (comments && typeof comments.unpaint === "function") comments.unpaint(id);
    }

    function repaintReopened(id) {
      if (comments && typeof comments.repaint === "function") comments.repaint(id);
    }

    // The name comes from the reply itself, and absent one the card says
    // "agent". That is the whole of agent detection (D10).
    function agentName(reply) {
      return (reply && reply.agent) || "agent";
    }

    function drawThread(item) {
      var id = item[record.FIELD.ID];
      if (!doc) return null;
      if (!threads[id]) {
        threads[id] = el("section", "lahe-thread");
        threads[id].setAttribute("aria-label", "Earlier exchanges");
        rail.prependCardNode(id, threads[id]);
      }
      var node = threads[id];
      while (node.firstChild) node.removeChild(node.firstChild);
      ensureStyle(node);
      record.chronologicalThread(item).forEach(function (round) {
        var pair = el("div", "lahe-thread-round");
        var reviewer = round.reviewer || {};
        if (reviewer.note) appendTurn(pair, "Reviewer note", reviewer.note, reviewer.at);
        if (reviewer.change) appendTurn(pair, "Reviewer change", reviewer.change, reviewer.at);
        var agent = round.agent || {};
        if (agent.text) appendTurn(pair, agent.agent || "Agent", agent.text, agent.at);
        if (agent.reason) appendTurn(pair, (agent.agent || "Agent") + " reason", agent.reason, agent.at);
        if (!agent.text && !agent.reason) appendTurn(pair, agent.agent || "Agent", agent.status || "", agent.at);
        node.appendChild(pair);
      });
      return node;
    }

    function appendTurn(host, who, text, at) {
      var line = el("p", "lahe-thread-turn");
      var head = el("span", "lahe-thread-head");
      head.appendChild(el("strong", null, who));
      if (at) {
        var time = el("time", "lahe-thread-time", overlayModule.timestampLabel(at));
        time.setAttribute("datetime", at);
        time.setAttribute("title", new Date(at).toLocaleString());
        head.appendChild(time);
      }
      line.appendChild(head);
      line.appendChild(el("span", "lahe-thread-text", String(text || "")));
      host.appendChild(line);
    }

    function clearThread(id) {
      var node = threads[id];
      if (node) rail.detachCardNode(id, node);
      delete threads[id];
    }

    function drawComposer(item) {
      var id = item[record.FIELD.ID];
      if (!doc) return null;
      if (!composers[id]) {
        var node = el("section", "lahe-followup");
        node.setAttribute("data-lahe-followup", id);
        var label = el("label", "lahe-followup-label", "Follow up");
        node.appendChild(label);
        var input = el("textarea", "lahe-followup-input");
        input.id = "lahe-followup-" + id;
        label.setAttribute("for", input.id);
        input.setAttribute("rows", "3");
        input.setAttribute("placeholder", "Add a new message without changing the earlier exchange");
        input.value = store.readFollowupDraft(reviewId, id);
        input.disabled = isReadOnly();
        input.addEventListener("input", function () {
          if (isReadOnly()) return;
          store.writeFollowupDraft(reviewId, id, input.value);
        });
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submitFollowup(id, input.value);
          }
        });
        node.appendChild(input);
        var actions = el("div", "cardacts");
        var send = el("button", "cardact", "Follow up");
        send.setAttribute("type", "button");
        send.disabled = isReadOnly();
        send.addEventListener("click", function () {
          submitFollowup(id, input.value);
        });
        actions.appendChild(send);
        node.appendChild(actions);
        composers[id] = node;
        ensureStyle(node);
        rail.attachCardContinuation(id, node);
      } else {
        var saved = store.readFollowupDraft(reviewId, id);
        var field = composers[id].querySelector("textarea");
        if (field && field !== field.getRootNode().activeElement && field.value !== saved) field.value = saved;
      }
      return composers[id];
    }

    function focusComposer(id) {
      if (isReadOnly()) return null;
      var item = itemById(id);
      var node = composers[id] || (item && item[record.FIELD.REPLY] ? drawComposer(item) : null);
      var input = node && node.querySelector("textarea");
      if (input && typeof input.focus === "function") input.focus();
      return input || null;
    }

    function clearComposer(id) {
      var node = composers[id];
      if (node) rail.detachCardNode(id, node);
      delete composers[id];
    }

    function continueItem(item, next, notice) {
      if (isReadOnly() || !next || next === item) return item;
      // The full-record event is durable before any record, draft, or UI
      // mutation. A storage refusal therefore leaves the answer and draft
      // intact; a later record failure remains recoverable from the outbox.
      var event = postReady(next);
      if (!event) return item;
      store.write(reviewId, next);
      try {
        store.clearFollowupDraft(reviewId, item[record.FIELD.ID]);
      } catch (err) {
        if (err && err.failure) rail.failures.add(err.failure);
      }
      rail.upsertCard(next);
      rail.setCardState(next[record.FIELD.ID], record.STATE.READY);
      rail.setAgentMessage(next[record.FIELD.ID], null);
      rail.setCardNotice(next[record.FIELD.ID], notice || null);
      clearQuestion(next[record.FIELD.ID]);
      clearComposer(next[record.FIELD.ID]);
      repaintReopened(next[record.FIELD.ID]);
      onContinued(next);
      refresh();
      rail.selectTab(rail.TAB.ACTIVE);
      var card = rail.cardNode(next[record.FIELD.ID]);
      if (card && typeof card.focus === "function") {
        card.tabIndex = -1;
        card.focus();
      }
      return next;
    }

    /**
     * The reviewer's answer to what the agent said, and now the only way a
     * handled item goes back to ready by hand.
     *
     * THE TRANSITION IS ASSERTED, not assumed. It used to be enough for
     * reopenItem alone to check this, because Reopen was the button that ended
     * the handled state and a follow-up merely rode the same helper. With the
     * button gone this is the manual path R38 travels, so a transition the
     * lifecycle table forbids has to fail loudly here rather than leave the rail
     * and the log disagreeing about what state the item is in.
     */
    function submitFollowup(id, text) {
      var item = itemById(id);
      if (!item || !item[record.FIELD.REPLY] || !String(text || "").trim()) return item;
      if (isReadOnly()) return item;
      lifecycle.assertTransition(item[record.FIELD.STATE], record.STATE.READY, lifecycle.ACTOR.REVIEWER);
      return continueItem(item, record.followUp(item, String(text)), "Follow-up sent. It is back in front of the agent.");
    }

    /** Agent text, bounded by review_format's own bound, marker visible. */
    function boundedText(text) {
      return reviewFormat.boundData(text, reviewFormat.BEFORE_MAX);
    }

    // -------------------------------------------------------------------------
    // Reopening (R38)
    // -------------------------------------------------------------------------

    /**
     * Put a handled item back in front of the agent.
     *
     * The transition is asserted rather than assumed, so a reopen from a state
     * the table does not allow fails loud here instead of leaving the rail and
     * the log disagreeing.
     *
     * `options.note` adds one tool-generated sentence to the carried note, and
     * `options.notice` replaces the line the card shows. Both exist for the
     * revert check (replay.isRevertedHandledEdit), which reopens an item the
     * reviewer is not looking at and therefore has to say why on the card. The
     * button in this file passes neither, so the reviewer's own reopen is
     * unchanged: same rev bump, same event, same rail behavior.
     */
    function reopenItem(id, options) {
      var opts = options || {};
      var item = itemById(id);
      if (!item) return null;
      if (isReadOnly()) return item;
      var draft = store.readFollowupDraft(reviewId, id);
      if (draft && draft.trim()) return item;
      lifecycle.assertTransition(item[record.FIELD.STATE], record.STATE.READY, lifecycle.ACTOR.REVIEWER);

      // Reopen issue archives the answered round and bumps the rev once. Two things depend on
      // it: a stale or duplicate reply.folded still naming the old rev now fails
      // the revision rule and cannot send the just-reopened item back to Done;
      // and an offline reopen arrives at a rev the store has never seen, so
      // merge's BROWSER_NEWER_REV protects it instead of it being discarded at
      // equal rev (STATE/REPLY are not content fields).
      var reopened = record.reopenIssue(item);
      if (typeof opts.note === "string" && opts.note.trim()) {
        var carried = reopened[record.FIELD.NOTE];
        reopened[record.FIELD.NOTE] =
          typeof carried === "string" && carried.trim() ? carried + "\n\n" + opts.note : opts.note;
      }
      counters.reopened += 1;
      return continueItem(
        item,
        reopened,
        opts.notice || "Issue reopened. The unchanged request is back in front of the agent."
      );
    }

    /**
     * Queue the new ready revision through the ordinary item path.
     *
     * The revision already moved, so the helper's usual projection rule drops
     * the old current reply while retaining it inside the carried thread.
     */
    function postReady(item) {
      var client = typeof sync === "function" ? sync() : sync;
      if (client && typeof client.recordItem === "function") {
        return client.recordItem(item, { immediate: "ready" });
      }
      if (!store || typeof store.queueEvent !== "function") return null;
      var event = protocol.newEvent({
        event: protocol.EVENT.ITEM_READY,
        event_id: record.randomId("evt"),
        review: reviewId,
        item: item[record.FIELD.ID],
        rev: item[record.FIELD.REV],
        page_path: item[record.FIELD.PAGE_PATH],
        page_title: item[record.FIELD.PAGE_TITLE],
        page_seq: item[record.FIELD.PAGE_SEQ],
        payload: { record: item }
      });
      store.queueEvent(reviewId, event);
      if (client && typeof client.flush === "function") client.flush();
      return event;
    }

    // -------------------------------------------------------------------------
    // What arrives from the helper
    // -------------------------------------------------------------------------

    /**
     * Apply folded replies and rejected lines from 1B's poll loop.
     *
     * This file never reads a reply file and never edits sync.js: the helper is
     * the single reader of reply files, and the library sees only what it
     * folded.
     *
     * @param {object[]} events reply.folded and reply.rejected events
     */
    function applyReplies(events) {
      var applied = [];
      (events || []).forEach(function (event) {
        var type = event[protocol.EVENT_FIELD.EVENT];
        if (type === protocol.EVENT.REPLY_REJECTED) {
          applied.push(rejectedLine(event));
          return;
        }
        if (type !== protocol.EVENT.REPLY_FOLDED) return;
        applied.push(foldedReply(event));
      });
      refresh();
      var settled = applied.filter(Boolean);
      // SEVERAL AT ONCE IS ONE INTERRUPTION. A page that was closed while an
      // agent worked comes back to a whole batch, and five toasts in one breath
      // is the rail again, in the corner the reviewer keeps clear. One is the
      // answer itself; more than one is a count and a way in.
      var wanted = settled.filter(function (result) {
        return result.toast === true;
      });
      if (wanted.length === 1) toastReply(wanted[0].item);
      else if (wanted.length > 1) {
        toastMany(
          "batch:" + wanted
            .map(function (result) {
              return result.item;
            })
            .sort()
            .join(","),
          wanted.map(function (result) {
            return result.item;
          })
        );
      }
      return settled;
    }

    // -------------------------------------------------------------------------
    // What the toast says, and what pressing it does
    // -------------------------------------------------------------------------

    function canToast() {
      return typeof rail.showToast === "function" && !isReadOnly();
    }

    /** The words the item is about: the passage, or the edit's own sentence. */
    function aboutWords(item) {
      if (!item) return "";
      var context = item[record.FIELD.CONTEXT] || {};
      if (record.isHandEdit(item)) return item[record.FIELD.CHANGE] || context.quote || "";
      return context.quote || item[record.FIELD.NOTE] || item[record.FIELD.CHANGE] || "";
    }

    /**
     * What the agent said, bounded as agent text always is before it is drawn.
     *
     * A question or a refusal can arrive with no words at all (the status alone
     * is the signal, which is why needsToSeeReply lets them through). The toast
     * still has to say something, so it says what happened.
     */
    function toastText(item) {
      var reply = item[record.FIELD.REPLY] || {};
      var said = reply.text || reply.reason;
      if (hasWords(said)) return clip(boundedText(said), TOAST_TEXT_MAX);
      if (reply.status === record.REPLY_STATUS.QUESTION) return agentName(reply) + " has a question about this.";
      if (reply.status === record.REPLY_STATUS.NOT_HANDLED) return agentName(reply) + " did not do this one.";
      return agentName(reply) + " answered this.";
    }

    /** One reply, on its own toast. */
    function toastReply(id) {
      if (!canToast()) return null;
      var item = itemById(id);
      if (!item || !item[record.FIELD.REPLY]) return null;
      var reply = item[record.FIELD.REPLY];
      return rail.showToast({
        key: "reply:" + id + ":" + String(replyStamp(item)),
        label: toastLabelFor(reply),
        text: toastText(item),
        about: clip(aboutWords(item), TOAST_ABOUT_MAX),
        // A QUESTION WAITS. An agent asking is an agent stopped, so the one
        // thing on screen that says so does not time out.
        sticky: reply.status === record.REPLY_STATUS.QUESTION,
        onOpen: function () {
          jumpToCard(id);
        }
      });
    }

    /** Several at once, or a boot that arrives with answers already waiting. */
    function toastMany(key, ids) {
      if (!canToast() || !ids || !ids.length) return null;
      var items = itemsNow();
      var wanted = Object.create(null);
      ids.forEach(function (id) {
        wanted[id] = true;
      });
      var counts = { total: 0, questions: 0 };
      items.forEach(function (item) {
        if (!wanted[item[record.FIELD.ID]]) return;
        var reply = item[record.FIELD.REPLY];
        counts.total += 1;
        if (reply && reply.status === record.REPLY_STATUS.QUESTION) counts.questions += 1;
      });
      if (!counts.total) return null;
      return rail.showToast({
        key: key,
        label: "Replies",
        text: waitingSentence(counts),
        about: "Open the review to read them.",
        sticky: counts.questions > 0,
        onOpen: function () {
          openTabFor(ids);
        }
      });
    }

    /**
     * On boot: one toast for everything already waiting, never one per reply.
     *
     * The unread replies on a fresh load are not news, they are a backlog, and
     * a backlog replayed one toast at a time is the reviewer clearing a stack
     * of things they already knew about. Replies whose tab the reviewer is
     * already looking at are left out for the same reason a live one is: they
     * are on screen.
     */
    function toastWaiting() {
      if (!canToast()) return null;
      var items = itemsNow();
      var ids = unseenReplyIds(items, readSeen()).filter(function (id) {
        return !watchingTab(paneOf(itemById(id)));
      });
      if (!ids.length) return null;
      return toastMany("waiting:" + ids.slice().sort().join(","), ids);
    }

    /**
     * The way in, from the toast: open the rail, go to the card, and count the
     * reply as read, because the reviewer is now looking at it.
     *
     * It uses the rail's own seams and adds none: collapse, selectTab (which is
     * what tells this file to mark the tab's replies seen) and the card node.
     */
    function jumpToCard(id) {
      var item = itemById(id);
      if (!item) return false;
      var tab = paneOf(item);
      if (typeof rail.collapse === "function") rail.collapse(false);
      if (typeof rail.selectTab === "function") rail.selectTab(tab);
      var node = rail.cardNode(id);
      if (node) {
        if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
        node.tabIndex = -1;
        if (typeof node.focus === "function") node.focus();
      }
      markRepliesSeen(tab);
      return true;
    }

    /** The summary toast's way in: the tab holding the most of what is waiting. */
    function openTabFor(ids) {
      var grouped = Object.create(null);
      (ids || []).forEach(function (id) {
        var item = itemById(id);
        if (!item) return;
        var tab = paneOf(item);
        grouped[tab] = (grouped[tab] || 0) + 1;
      });
      var best = null;
      Object.keys(grouped).forEach(function (tab) {
        if (!best || grouped[tab] > grouped[best]) best = tab;
      });
      if (typeof rail.collapse === "function") rail.collapse(false);
      if (best && typeof rail.selectTab === "function") rail.selectTab(best);
      return best;
    }

    /**
     * A line the helper could not read.
     *
     * A dismissible chip naming the FILE and the LINE, because that is what the
     * person fixing it needs and a message saying "a reply was malformed" is
     * not something anyone can act on. Dismissal is 1B's, and it sticks.
     */
    function rejectedLine(event) {
      counters.rejected += 1;
      var detail =
        String(event.file || "a reply file") +
        " line " +
        String(event.line === undefined || event.line === null ? "?" : event.line) +
        ": " +
        String(event.reason || "unreadable");
      rail.failures.add(failures.failure("REPLY_LINE_MALFORMED", detail));
      return { kind: "rejected", detail: detail };
    }

    /**
     * A HANDLED FIX IS EXPECTED TO CHANGE ITS OWN PASSAGE.
     *
     * The agent rewrites the passage the item pointed at, the page reloads,
     * replay cannot re-anchor the record (correctly: those words are gone), and
     * the card gets the lost-anchor badge. Then the reply folds and the same
     * card says both "I made the change" and "this could not be matched to this
     * version of the page". The reviewer read it as the tool contradicting
     * itself, and they were right: reported live on 2026-08-18.
     *
     * So a fold to HANDLED ends the anchor's claim on the card. The stamp is
     * cleared on the record too, not just the badge, because the stamp is what
     * review.json projects: leaving it would keep telling agents the region is
     * lost for work that is finished. Nothing reads the stamp on the way back
     * out (a reopen bumps the revision and returns the item to ready, and the
     * next replay pass re-evaluates the anchor from scratch), so clearing it
     * costs the reopen path nothing and a genuinely lost region is stamped
     * again on that pass.
     *
     * Only HANDLED. A not_handled reply or a question leaves work in front of
     * the reviewer, the anchor still matters, and the badge stays honest.
     */
    function forgetLostAnchor(item) {
      var region = item[record.FIELD.REGION];
      if (!region || !region.lost) return false;
      var nextRegion = Object.assign({}, region);
      nextRegion.lost = null;
      item[record.FIELD.REGION] = nextRegion;
      return true;
    }

    function clearAnchorBadges(id) {
      if (typeof rail.clearCardBadge !== "function") return;
      failures.ANCHOR_FAILURE_CODES.forEach(function (code) {
        rail.clearCardBadge(id, code);
      });
    }

    function foldedReply(event) {
      var id = event[protocol.EVENT_FIELD.ITEM];
      var item = id ? itemById(id) : null;
      // A reply for something this browser does not hold. The helper still has
      // it; there is nothing to draw here and nothing to be wrong about.
      if (!item) return null;

      var reply = event.reply || {};
      var replyRev = event[protocol.EVENT_FIELD.REV];

      // The refusal, on the card. Two ways to get here: the helper refused the
      // line, or the reviewer reworded in THIS browser while the helper was
      // down, so the fold looked current when it happened and does not now.
      // Both mean the same thing to the reviewer and say the same sentence.
      if (event.accepted !== true || !lifecycle.replyApplies(item, replyRev)) {
        counters.refused += 1;
        rail.upsertCard(item);
        rail.setCardNotice(id, agentName(reply) + " " + STALE_NOTICE);
        return { kind: "refused", item: id, state: item[record.FIELD.STATE] };
      }

      counters.folded += 1;
      // WHAT THIS BROWSER ALREADY KNEW. The reply cursor starts at zero on
      // every load, so a reload re-delivers every folded reply the helper has.
      // Re-applying them is harmless and correct; toasting them again is the
      // reviewer being told about yesterday's answers every time they refresh.
      // The stamp names WHICH reply, so an identical one is not news.
      var hadStamp = replyStamp(item);
      var next = Object.assign({}, item);
      next[record.FIELD.STATE] = event.state || item[record.FIELD.STATE];
      next[record.FIELD.REPLY] = {
        status: reply.status || null,
        agent: reply.agent || null,
        reason: reply.reason || null,
        text: reply.text || null,
        files: Array.isArray(reply.files) ? reply.files.slice() : [],
        at: event[protocol.EVENT_FIELD.TS] || null,
        user_needs_to_see_reply: reply.user_needs_to_see_reply === true
      };
      if (next[record.FIELD.STATE] === record.STATE.HANDLED) forgetLostAnchor(next);
      store.write(reviewId, next);

      rail.upsertCard(next);
      rail.setCardState(id, next[record.FIELD.STATE]);
      rail.setCardNotice(id, null);
      if (next[record.FIELD.STATE] === record.STATE.HANDLED) clearAnchorBadges(id);

      // A QUESTION IS NOT AN AGENT MESSAGE. The rail's own carrier is the quiet
      // one, and it is right for "I made the change" and for "I could not, and
      // here is why". A question gets the block below instead, and only that
      // block: the same sentence in two places on one card is how the loud one
      // stops reading as loud.
      if (reply.status === record.REPLY_STATUS.QUESTION) {
        rail.setAgentMessage(id, null);
        drawQuestion(next);
      } else {
        rail.setAgentMessage(id, agentMessageFor(next));
        clearQuestion(id);
      }

      // IT ARRIVED IN FRONT OF THEM, OR IT NEVER NEEDED THEM. Two replies are
      // stamped read the moment they fold: one that lands on the tab the
      // reviewer is already sitting on (it is on screen, and a badge would flash
      // on and back off around something they can see), and one the agent did
      // not flag on a handled item (a routine confirmation, which belongs on the
      // card for the record and nowhere else). Stamped here, before applyReplies
      // repaints, so neither can turn up unread later. Every other case leaves
      // it unseen and the badge appears on the next paint, on the tab the card
      // is in.
      var watching = watchingTab(paneOf(next));
      if (watching || !needsToSeeReply(next[record.FIELD.REPLY])) {
        var marks = readSeen();
        marks[id] = replyStamp(next);
        writeSeen(marks);
      }

      return {
        kind: "folded",
        item: id,
        state: next[record.FIELD.STATE],
        status: reply.status,
        // Decided here, where the "was the reviewer watching" answer is true,
        // and acted on in applyReplies once every event in the batch is folded.
        toast: shouldToastReply({
          reply: next[record.FIELD.REPLY],
          watching: watching,
          readOnly: isReadOnly(),
          known: hadStamp === replyStamp(next)
        })
      };
    }

    // -------------------------------------------------------------------------
    // The question
    // -------------------------------------------------------------------------

    function drawQuestion(item) {
      var id = item[record.FIELD.ID];
      var reply = item[record.FIELD.REPLY] || {};
      if (!doc) return null;
      if (!asks[id]) {
        asks[id] = buildQuestion(id);
        ensureStyle(asks[id]);
        rail.attachCardNode(id, asks[id]);
        counters.questions += 1;
      }
      var node = asks[id];
      node.querySelector(".lahe-ask-name").textContent = agentName(reply) + " is asking";
      var time = node.querySelector(".lahe-ask-time");
      if (reply.at) {
        time.textContent = overlayModule.timestampLabel(reply.at);
        time.setAttribute("datetime", reply.at);
        time.setAttribute("title", new Date(reply.at).toLocaleString());
      } else {
        time.textContent = "";
        time.removeAttribute("datetime");
        time.removeAttribute("title");
      }
      node.querySelector(".lahe-ask-text").textContent = boundedText(reply.text || "");
      markCard(id, true);
      return node;
    }

    function buildQuestion(id) {
      var node = el("aside", ASK_CLASS);
      node.setAttribute("data-lahe-item", id);
      node.setAttribute("role", "note");

      var who = el("div", "lahe-ask-who");
      who.appendChild(el("span", "lahe-ask-dot"));
      who.appendChild(el("span", "lahe-ask-name", ""));
      who.appendChild(el("time", "lahe-ask-time", ""));
      node.appendChild(who);

      node.appendChild(el("p", "lahe-ask-text", ""));

      // NO BUTTON HERE. There was an Answer button, on the theory that a
      // question with nothing to press is a notification. It could never do
      // anything: drawComposer runs for every item that has a reply, above,
      // before the question is drawn, so the box to answer in is already on the
      // card. Pressing Answer moved the caret into a textarea the reviewer was
      // already looking at, which is no visible change at all, and it spent the
      // most valuable strip in the block saying so.
      return node;
    }

    function clearQuestion(id) {
      var node = asks[id];
      if (node && node.parentNode) node.parentNode.removeChild(node);
      delete asks[id];
      markCard(id, false);
      return true;
    }

    /** The card itself carries the mark, so it sorts to the top of its pane. */
    function markCard(id, asking) {
      var node = rail.cardNode(id);
      if (!node) return false;
      if (asking) node.setAttribute(ASKING_ATTR, "true");
      else node.removeAttribute(ASKING_ATTR);
      return true;
    }

    function unmount() {
      if (dropTabWatch) dropTabWatch();
      dropTabWatch = null;
      if (dropCollapseWatch) dropCollapseWatch();
      dropCollapseWatch = null;
      Object.keys(markedNow).forEach(function (id) {
        markUnseenCard(id, false);
      });
      unseenNow = Object.create(null);
      // A remount is a new visit. Nothing is fresh in it: the cards were already
      // pointed out once, in the visit this unmount ended.
      freshNow = Object.create(null);
      freshTab = null;
      markedNow = Object.create(null);
      Object.keys(rows).forEach(dropRow);
      Object.keys(asks).forEach(clearQuestion);
      Object.keys(threads).forEach(clearThread);
      Object.keys(composers).forEach(clearComposer);
      rows = Object.create(null);
      asks = Object.create(null);
      threads = Object.create(null);
      composers = Object.create(null);
      styleNode = null;
      mounted = false;
      return true;
    }

    var api = {
      ROW_CLASS: ROW_CLASS,
      ASK_CLASS: ASK_CLASS,
      ASKING_ATTR: ASKING_ATTR,
      UNSEEN_ATTR: UNSEEN_ATTR,
      STALE_NOTICE: STALE_NOTICE,
      mount: mount,
      unmount: unmount,
      refresh: refresh,
      applyReplies: applyReplies,
      reopen: reopenItem,
      followUp: submitFollowup,
      focusFollowup: focusComposer,
      setReadOnly: function () {
        Object.keys(composers).forEach(function (id) {
          var input = composers[id].querySelector("textarea");
          var send = composers[id].querySelector("button");
          if (input) input.disabled = isReadOnly();
          if (send) send.disabled = isReadOnly();
        });
      },
      followup: function (id) {
        return composers[id] || null;
      },
      thread: function (id) {
        return threads[id] || null;
      },
      question: function (id) {
        return asks[id] || null;
      },
      questionIds: function () {
        return Object.keys(asks);
      },
      unseenIds: function () {
        return Object.keys(unseenNow);
      },
      /** The ids still pointed out on screen: unseen, or fresh this visit. */
      markedIds: function () {
        return Object.keys(markedNow);
      },
      /** The ids that were unread when the reviewer arrived on the open tab. */
      freshIds: function () {
        return Object.keys(freshNow);
      },
      freshTab: function () {
        return freshTab;
      },
      clearFresh: clearFresh,
      /** tab -> the unseen ids badged on it, as the last paint worked them out. */
      unseenByTab: function () {
        return unseenByTab(itemsNow(), readSeen(), paneOf);
      },
      markRepliesSeen: markRepliesSeen,
      // The toast seams, for boot and for a spec: what a load found waiting,
      // and the jump a pressed toast makes.
      toastWaiting: toastWaiting,
      jumpToCard: jumpToCard,
      rowCount: function () {
        return Object.keys(rows).length;
      },
      isMounted: function () {
        return mounted;
      },
      counters: counters
    };

    return api;
  }

  return {
    ROW_CLASS: ROW_CLASS,
    ASK_CLASS: ASK_CLASS,
    ASKING_ATTR: ASKING_ATTR,
    UNSEEN_ATTR: UNSEEN_ATTR,
    STALE_NOTICE: STALE_NOTICE,
    STYLE: STYLE,
    TOAST_LABEL: TOAST_LABEL,
    TOAST_TEXT_MAX: TOAST_TEXT_MAX,
    TOAST_ABOUT_MAX: TOAST_ABOUT_MAX,
    toastLabelFor: toastLabelFor,
    shouldToastReply: shouldToastReply,
    replyWaitCounts: replyWaitCounts,
    waitingSentence: waitingSentence,
    clip: clip,
    replyStamp: replyStamp,
    needsToSeeReply: needsToSeeReply,
    unseenReplyIds: unseenReplyIds,
    unseenByTab: unseenByTab,
    seenMarksFor: seenMarksFor,
    createDoneTab: createDoneTab
  };
});
