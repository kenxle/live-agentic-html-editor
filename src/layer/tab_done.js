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
//     column), and it posts its own event so the helper's projection agrees
//     with the rail rather than restoring `handled` on the next re-post.
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

  // What the reviewer reads when their own rewording outran an agent's answer.
  // A constant, so the test asserts the sentence the reviewer sees.
  var STALE_NOTICE = "answered an older version of this, so it is still open. Nothing was lost.";

  // Injected once, into the rail's closed shadow root, by appending it inside
  // the first node this file attaches to a card. The rail's own stylesheet is
  // 1B's and is not edited; these rules add the two things this file draws.
  var STYLE = [
    "." + ROW_CLASS + "{display:flex;flex-direction:column;gap:7px}",
    "." + ROW_CLASS + " .lahe-done-said{font-size:13.5px;line-height:1.5;color:var(--ink)}",
    "." + ROW_CLASS + " .lahe-done-agent{font-size:12.5px;color:var(--ink-soft)}",
    "." + ROW_CLASS + " .lahe-done-files{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;",
    "font-size:11px;color:var(--ink-faint);overflow-wrap:anywhere}",
    "." + ROW_CLASS + " .lahe-done-foot{display:flex;gap:8px;align-items:center}",
    "." + ROW_CLASS + " .lahe-done-reopen{font-size:11.5px;font-weight:550;color:var(--ink-soft);",
    "border:1px solid var(--line);border-radius:7px;padding:3px 9px}",
    "." + ROW_CLASS + " .lahe-done-reopen:hover{color:var(--ink);background:var(--surface)}",

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
    "@media (prefers-color-scheme:dark){." + ASK_CLASS + " .lahe-ask-answer{color:#12151a}}",
    "." + ASK_CLASS + " .lahe-ask-answer:hover{filter:brightness(1.06)}",
    // The card carrying a question is pulled to the top of its pane and given
    // the accent border, so it is the first thing in the tab and reads as one
    // object with the block inside it.
    ".card[" + ASKING_ATTR + "='true']{order:-1;border-color:var(--accent)}"
  ].join("");

  function createDoneTab(options) {
    var opts = options || {};
    var rail = opts.overlay || overlayModule.shared;
    var store = opts.store || null;
    var reviewId = opts.reviewId || null;
    var comments = opts.comments || null;
    var sync = opts.sync || null;
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
    var counters = { folded: 0, refused: 0, rejected: 0, reopened: 0, questions: 0 };

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
      refresh();
      return api;
    }

    function refresh() {
      if (!mounted || !doc) return api;
      var seen = Object.create(null);

      itemsNow().forEach(function (item) {
        if (item[record.FIELD.STATE] !== record.STATE.HANDLED) return;
        var id = item[record.FIELD.ID];
        seen[id] = true;
        rail.upsertCard(item);
        rail.setCardState(id, record.STATE.HANDLED);
        if (item[record.FIELD.REPLY]) rail.setAgentMessage(id, item[record.FIELD.REPLY]);
        if (!rows[id]) {
          rows[id] = buildRow(item);
          ensureStyle(rows[id]);
          rail.attachCardNode(id, rows[id]);
        }
        updateRow(rows[id], item);
      });

      Object.keys(rows).forEach(function (id) {
        if (seen[id]) return;
        var row = rows[id];
        if (row && row.parentNode) row.parentNode.removeChild(row);
        delete rows[id];
      });

      return api;
    }

    function buildRow(item) {
      var row = el("div", ROW_CLASS);
      row.setAttribute("data-lahe-item", item[record.FIELD.ID]);
      row.appendChild(el("div", "lahe-done-said", ""));
      row.appendChild(el("div", "lahe-done-agent", ""));
      row.appendChild(el("div", "lahe-done-files", ""));

      var foot = el("div", "lahe-done-foot");
      var reopen = el("button", "lahe-done-reopen", "Reopen");
      reopen.setAttribute("type", "button");
      reopen.addEventListener("click", function () {
        reopenItem(item[record.FIELD.ID]);
      });
      foot.appendChild(reopen);
      row.appendChild(foot);
      return row;
    }

    /** What the reviewer asked for, in their own words. */
    function saidBy(item) {
      var note = item[record.FIELD.NOTE];
      var change = item[record.FIELD.CHANGE];
      if (note && change && note !== change) return note + "\n" + change;
      return note || change || item[record.FIELD.AFTER] || "";
    }

    function updateRow(row, item) {
      row.querySelector(".lahe-done-said").textContent = saidBy(item);

      var reply = item[record.FIELD.REPLY] || {};
      var who = agentName(reply);
      var line = who + " made this change.";
      if (reply.reason) line = who + ": " + boundedText(reply.reason);
      row.querySelector(".lahe-done-agent").textContent = line;

      var filesNode = row.querySelector(".lahe-done-files");
      var files = Array.isArray(reply.files) ? reply.files : [];
      filesNode.textContent = files.join("  ");
      filesNode.hidden = files.length === 0;
    }

    // The name comes from the reply itself, and absent one the card says
    // "agent". That is the whole of agent detection (D10).
    function agentName(reply) {
      return (reply && reply.agent) || "agent";
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
      lifecycle.assertTransition(item[record.FIELD.STATE], record.STATE.READY, lifecycle.ACTOR.REVIEWER);

      var reopened = Object.assign({}, item);
      reopened[record.FIELD.STATE] = record.STATE.READY;
      reopened[record.FIELD.REPLY] = null;
      reopened[record.FIELD.UPDATED_AT] = record.nowIso();
      store.write(reviewId, reopened);

      rail.upsertCard(reopened);
      rail.setCardState(id, record.STATE.READY);
      rail.setAgentMessage(id, null);
      rail.setCardNotice(id, "Reopened. It is back in front of the agent.");
      postReopened(reopened);
      counters.reopened += 1;
      refresh();
      return reopened;
    }

    /**
     * The reopening as an event.
     *
     * It has to be its own event rather than a re-post of the record: the
     * helper's projection holds the agent's answer for the revision it named,
     * so a record arriving at the same revision would be merged UNDER that
     * answer and the item would go straight back to handled. The event is
     * queued through the store's outbox, which is what makes it survive a
     * helper that is down.
     */
    function postReopened(item) {
      if (!store || typeof store.queueEvent !== "function") return null;
      var event = protocol.newEvent({
        event: protocol.EVENT.ITEM_REOPENED,
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
      // The sync client may be handed in directly, or as a function, because
      // boot wires the tabs before it builds the client they post through.
      var client = typeof sync === "function" ? sync() : sync;
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
      rail.setAgentMessage(id, next[record.FIELD.REPLY]);
      rail.setCardNotice(id, null);

      if (reply.status === record.REPLY_STATUS.QUESTION) drawQuestion(next);
      else clearQuestion(id);

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
      node.appendChild(who);

      node.appendChild(el("p", "lahe-ask-text", ""));

      // The demand. A question with nothing to press is a notification.
      if (comments && typeof comments.reopen === "function") {
        var answer = el("button", "lahe-ask-answer", "Answer");
        answer.setAttribute("type", "button");
        answer.addEventListener("click", function () {
          var box = comments.reopen(id, { host: rail.cardBody(id), placement: "inline" });
          if (box && typeof box.focus === "function") box.focus();
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
      Object.keys(rows).forEach(function (id) {
        var row = rows[id];
        if (row && row.parentNode) row.parentNode.removeChild(row);
      });
      Object.keys(asks).forEach(clearQuestion);
      rows = Object.create(null);
      asks = Object.create(null);
      styleAttached = false;
      mounted = false;
      return true;
    }

    var api = {
      ROW_CLASS: ROW_CLASS,
      ASK_CLASS: ASK_CLASS,
      ASKING_ATTR: ASKING_ATTR,
      STALE_NOTICE: STALE_NOTICE,
      mount: mount,
      unmount: unmount,
      refresh: refresh,
      applyReplies: applyReplies,
      reopen: reopenItem,
      question: function (id) {
        return asks[id] || null;
      },
      questionIds: function () {
        return Object.keys(asks);
      },
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
    STALE_NOTICE: STALE_NOTICE,
    STYLE: STYLE,
    createDoneTab: createDoneTab
  };
});
