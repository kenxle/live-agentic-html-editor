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
//   DEMAND      an Answer button that opens the box on this card. A question
//               with nothing to press is a notification, and notifications get
//               scrolled past
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
      if (seen[item[record.FIELD.ID]] !== stamp) out.push(item[record.FIELD.ID]);
    });
    return out;
  }

  /**
   * The marks after the reviewer has looked at everything on screen.
   *
   * Built fresh from the items rather than merged into the old map, so an item
   * that no longer has a reply drops out and the bucket cannot grow forever.
   */
  function seenMarksFor(items) {
    var next = {};
    (items || []).forEach(function (item) {
      var stamp = replyStamp(item);
      if (stamp) next[item[record.FIELD.ID]] = stamp;
    });
    return next;
  }

  // What the reviewer reads when their own rewording outran an agent's answer.
  // A constant, so the test asserts the sentence the reviewer sees.
  var STALE_NOTICE = "answered an older version of this, so it is still open. Nothing was lost.";

  // Injected once, into the rail's closed shadow root, by appending it inside
  // the first node this file attaches to a card. The rail's own stylesheet is
  // 1B's and is not edited; these rules add the two things this file draws.
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
    "." + ASK_CLASS + " .lahe-ask-answer{align-self:flex-start;font-size:12px;font-weight:600;",
    "padding:5px 12px;border-radius:8px;background:var(--accent);color:#fff}",
    // The page picks the scheme, not the OS (highlight.js stamps the rail host).
    ":host([data-lahe-scheme='dark']) ." + ASK_CLASS + " .lahe-ask-answer{color:#12151a}",
    // In dark the wash alone carries less separation from the card behind it, so
    // the block gets a hairline as well. Same relationship, drawn twice.
    ":host([data-lahe-scheme='dark']) ." + ASK_CLASS + "{",
    "border-top:1px solid rgba(147,167,234,.28);border-bottom:1px solid rgba(147,167,234,.28)}",
    "." + ASK_CLASS + " .lahe-ask-answer:hover{filter:brightness(1.06)}",
    // The card carrying a question is pulled to the top of its pane and given
    // the accent border, so it is the first thing in the tab and reads as one
    // object with the block inside it.
    ".card[" + ASKING_ATTR + "='true']{order:-1;border-color:var(--accent)}",

    // The unseen mark. A reply that folded while the reviewer was looking at
    // another tab is the only sign they get that an answer arrived, so the card
    // carries one: an accent rule down its left edge, drawn as an inset shadow
    // so it costs the card no layout and cannot fight the border a question
    // sets. Deliberately calmer than the question block above: a question is a
    // stop, and this is a "there is something here". If the same card is both,
    // the question treatment is the one that reads.
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
    var styleAttached = false;
    // id -> row node, and id -> question node. Created once, updated in place,
    // removed only when the item leaves the state that drew them. The rail's
    // own law, applied to this file's nodes.
    var rows = Object.create(null);
    var asks = Object.create(null);
    var threads = Object.create(null);
    var composers = Object.create(null);
    var follows = Object.create(null);
    // id -> the Reopen button. Held separately from its row because on a
    // hand-edit card the button does not live in that row: it moves next to
    // Undo. Whoever removes the row still has to remove the button.
    var reopens = Object.create(null);
    var counters = { folded: 0, refused: 0, rejected: 0, reopened: 0, questions: 0 };
    // id -> true for the cards currently wearing the unseen mark, so a paint
    // knows which ones to take it back off. The durable truth is in storage;
    // this is only what is on screen right now.
    var unseenNow = Object.create(null);
    var dropTabWatch = null;

    function el(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = text;
      markers.markChrome(node);
      return node;
    }

    /** The one stylesheet this file adds, inside the rail's own closed root. */
    function ensureStyle(node) {
      if (styleAttached || !doc || !node) return;
      var style = doc.createElement("style");
      style.textContent = STYLE;
      node.appendChild(style);
      styleAttached = true;
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
      if (!dropTabWatch && typeof rail.onTabSelect === "function") {
        dropTabWatch = rail.onTabSelect(function (tab) {
          if (tab === overlayModule.TAB.DONE) markRepliesSeen();
        });
      }
      refresh();
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

    /** Recompute from storage, repaint the cards, and hand the rail the count. */
    function paintUnseen() {
      var ids = unseenReplyIds(itemsNow(), readSeen());
      var next = Object.create(null);
      ids.forEach(function (id) {
        next[id] = true;
      });
      Object.keys(unseenNow).forEach(function (id) {
        if (!next[id]) markUnseenCard(id, false);
      });
      ids.forEach(function (id) {
        markUnseenCard(id, true);
      });
      unseenNow = next;
      if (typeof rail.setTabNewCount === "function") rail.setTabNewCount(overlayModule.TAB.DONE, ids.length);
      return ids;
    }

    /**
     * Everything answered right now counts as read.
     *
     * Called when the reviewer selects the Done tab, and when a reply folds
     * while they are already sitting on it: in both cases the answer is in front
     * of them, so a badge would be telling them about something they can see.
     */
    function markRepliesSeen() {
      writeSeen(seenMarksFor(itemsNow()));
      return paintUnseen();
    }

    /** Is the reviewer looking at the replies as this one lands? */
    function watchingDone() {
      if (typeof rail.currentTab !== "function") return false;
      if (rail.currentTab() !== overlayModule.TAB.DONE) return false;
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

    // The row and its Reopen button go together, even when they are not in the
    // same place: on a hand-edit card the button was moved into the Edits row's
    // footer, so removing the row alone would leave a Reopen next to Undo on an
    // item that is no longer handled.
    function dropRow(id) {
      var row = rows[id];
      if (row && row.parentNode) row.parentNode.removeChild(row);
      var reopen = reopens[id];
      if (reopen && reopen.parentNode) reopen.parentNode.removeChild(reopen);
      delete reopens[id];
      delete follows[id];
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
    // saidBy), and its Reopen moves next to that row's Undo (see homeReopen),
    // so a handled edit reads as one summary, the exact wording, and the two
    // things the reviewer can do about it.
    function buildRow(item) {
      var row = el("div", ROW_CLASS);
      row.setAttribute("data-lahe-item", item[record.FIELD.ID]);
      row.appendChild(el("div", "lahe-done-said", ""));

      var foot = el("div", "cardacts");
      var follow = el("button", "cardact", "Follow up");
      follow.setAttribute("type", "button");
      follow.addEventListener("click", function () {
        focusComposer(item[record.FIELD.ID]);
      });
      follows[item[record.FIELD.ID]] = follow;
      foot.appendChild(follow);

      var reopen = el("button", "cardact cardact--quiet", "Reopen issue");
      reopen.setAttribute("type", "button");
      reopen.addEventListener("click", function () {
        reopenItem(item[record.FIELD.ID]);
      });
      foot.appendChild(reopen);
      reopens[item[record.FIELD.ID]] = reopen;
      updateReopenAvailability(item[record.FIELD.ID]);
      row.appendChild(foot);
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

    /**
     * Put Reopen where the reviewer's other decision about this item already is.
     *
     * Reopen and Undo are one decision surface: keep the agent's change, or take
     * it back. On a hand-edit card they were at opposite ends, Reopen at the top
     * in this row and Undo at the bottom in the Edits row. Reopen moves into the
     * Edits row's own footer, first, so the pair reads as one group at the foot
     * of the card. Run on every paint because it is idempotent and it puts the
     * button back after a remount rebuilt either row.
     *
     * Absent an Edits row (a comment card), Reopen stays in this row's own
     * footer, which is where it has always been.
     */
    function homeReopen(row, item) {
      var reopen = reopens[item[record.FIELD.ID]];
      if (!reopen) return null;
      var body = row.parentNode;
      var edits = body ? body.querySelector("[data-lahe-edit-row] .cardacts") : null;
      var home = edits || row.querySelector(".cardacts");
      if (!home) return null;
      if (reopen.parentNode !== home) home.insertBefore(reopen, home.firstChild);
      return home;
    }

    function updateRow(row, item) {
      row.querySelector(".lahe-done-said").textContent = saidBy(item);
      homeReopen(row, item);
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
          updateReopenAvailability(id);
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
      updateReopenAvailability(id);
      return composers[id];
    }

    function updateReopenAvailability(id) {
      var node = composers[id];
      var input = node && node.querySelector("textarea");
      var hasDraft = !!(input && input.value.trim());
      if (reopens[id]) {
        reopens[id].disabled = isReadOnly() || hasDraft;
        reopens[id].title = hasDraft ? "Send or clear the follow-up draft before reopening this issue" : "";
      }
      if (follows[id]) follows[id].disabled = isReadOnly();
      if (asks[id]) {
        var answer = asks[id].querySelector("button");
        if (answer) answer.disabled = isReadOnly();
      }
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

    function submitFollowup(id, text) {
      var item = itemById(id);
      if (!item || !item[record.FIELD.REPLY] || !String(text || "").trim()) return item;
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
     */
    function reopenItem(id) {
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
      counters.reopened += 1;
      return continueItem(item, reopened, "Issue reopened. The unchanged request is back in front of the agent.");
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
      return applied.filter(Boolean);
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
      var next = Object.assign({}, item);
      next[record.FIELD.STATE] = event.state || item[record.FIELD.STATE];
      next[record.FIELD.REPLY] = {
        status: reply.status || null,
        agent: reply.agent || null,
        reason: reply.reason || null,
        text: reply.text || null,
        files: Array.isArray(reply.files) ? reply.files.slice() : [],
        at: event[protocol.EVENT_FIELD.TS] || null
      };
      store.write(reviewId, next);

      rail.upsertCard(next);
      rail.setCardState(id, next[record.FIELD.STATE]);
      rail.setCardNotice(id, null);

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

      // IT ARRIVED IN FRONT OF THEM. The Done pane is newest first, so a reply
      // that folds while the reviewer is on that tab is already on screen and
      // needs no badge: stamp it read here, before applyReplies repaints, so the
      // badge never flashes on and back off. Every other case leaves it unseen
      // and the badge appears on the next paint.
      if (watchingDone()) {
        var marks = readSeen();
        marks[id] = replyStamp(next);
        writeSeen(marks);
      }

      return { kind: "folded", item: id, state: next[record.FIELD.STATE], status: reply.status };
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
      updateReopenAvailability(id);
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

      // The demand. A question with nothing to press is a notification.
      if (comments && typeof comments.reopen === "function") {
        var answer = el("button", "lahe-ask-answer", "Answer");
        answer.setAttribute("type", "button");
        answer.addEventListener("click", function () {
          focusComposer(id);
        });
        node.appendChild(answer);
      }
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
      Object.keys(unseenNow).forEach(function (id) {
        markUnseenCard(id, false);
      });
      unseenNow = Object.create(null);
      Object.keys(rows).forEach(dropRow);
      Object.keys(asks).forEach(clearQuestion);
      Object.keys(threads).forEach(clearThread);
      Object.keys(composers).forEach(clearComposer);
      rows = Object.create(null);
      asks = Object.create(null);
      threads = Object.create(null);
      composers = Object.create(null);
      follows = Object.create(null);
      reopens = Object.create(null);
      styleAttached = false;
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
          updateReopenAvailability(id);
        });
        Object.keys(reopens).forEach(updateReopenAvailability);
        Object.keys(asks).forEach(updateReopenAvailability);
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
      markRepliesSeen: markRepliesSeen,
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
    replyStamp: replyStamp,
    unseenReplyIds: unseenReplyIds,
    seenMarksFor: seenMarksFor,
    createDoneTab: createDoneTab
  };
});
