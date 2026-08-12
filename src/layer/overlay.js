// The rail: the card API and the persistent failures list.
//
// Owner: Task 1B-i. STUB: every signature is real and committed, and the state
// each function records is real. What is missing is the DOM. Five tasks import
// this API (2A-i, 2B, 2C, 2D, 3A), which is why it lands first and why its
// shape is decided in Phase 0 rather than discovered.
//
// ---------------------------------------------------------------------------
// The law this file owns: THE RAIL UPDATES IN PLACE, AND A CARD THAT HOLDS
// FOCUS IS NEVER RE-CREATED.
// ---------------------------------------------------------------------------
//
// The single largest in-page revert mechanism in the tool being replaced is a
// rail that rebuilds every card on every repaint: a half-reworded comment is
// destroyed because a removed node never fires blur. Replay makes repaints more
// frequent, not less. So the API has no render(items) that redraws everything.
// It has upsertCard, and the mutators below, and that is deliberate: there is
// no function here whose implementation could reasonably be "rebuild the list".
//
// ---------------------------------------------------------------------------
// How any task attaches something to a card
// ---------------------------------------------------------------------------
//
// Three carriers, matching architecture D15's table. A task picks by whether
// the reviewer has to do something about it.
//
//   setCardState(id, state)      the lifecycle chip: outstanding, delivered,
//                                applied, declined. 3A drives it
//   setCardBadge(id, failure)    a persistent state on the card, from a
//                                failures.js code. "Cannot be placed here",
//                                "the content changed", "verification could not
//                                find your wording". Stays until it is cleared
//                                by the thing that set it
//   setAgentMessage(id, reply)   R68: what the agent said about this item,
//                                rendered as a message on the card with a place
//                                to answer
//   setCardNotice(id, text)      a passing message. Not persistent
//
// And separately, not on a card:
//
//   failures.add(failure)        the rail's persistent failures list. Sync
//                                refusals, CSP refusals, storage quota. Stays
//                                until the reviewer dismisses it (R9)
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.overlay = factory(root.LAHE.markers, root.LAHE.failures, root.LAHE.lifecycle, root.LAHE.record);
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/failures.js"),
      require("../shared/lifecycle.js"),
      require("../shared/record.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, failuresModule, lifecycle, record) {
  "use strict";

  function createRail() {
    var cards = Object.create(null);
    var failureList = [];
    var statusLine = null;
    var presence = null;
    var collapsed = false;
    var mounted = false;

    // A card handle. The node reference is what 1B-i fills in; the point of
    // returning a handle rather than an id is that a caller physically cannot
    // "re-render the list" through it.
    function handleFor(id) {
      return {
        id: id,
        node: cards[id] ? cards[id].node : null,
        holdsFocus: function () {
          return holdsFocus(id);
        }
      };
    }

    // Creates the card if it does not exist, updates it in place if it does.
    // Never re-creates. Returns a handle.
    function upsertCard(item) {
      record.validateItem(item);
      var id = item[record.FIELD.ID];
      if (!cards[id]) {
        cards[id] = {
          id: id,
          node: null,
          item: item,
          state: item[record.FIELD.STATE],
          badges: [],
          agentMessage: null,
          notice: null,
          created: true
        };
      } else {
        cards[id].item = item;
        cards[id].state = item[record.FIELD.STATE];
      }
      return handleFor(id);
    }

    function getCard(id) {
      return cards[id] || null;
    }

    function removeCard(id) {
      if (!cards[id]) return false;
      // The one guard that matters. A card holding focus is not removed, even
      // when the caller thinks it should be; the caller is told no.
      if (holdsFocus(id)) return false;
      delete cards[id];
      return true;
    }

    function setCardState(id, state) {
      if (record.STATES.indexOf(state) === -1) {
        throw new Error("setCardState: unknown state " + String(state));
      }
      if (!cards[id]) return null;
      cards[id].state = state;
      return handleFor(id);
    }

    // failure comes from failures.failure(code, detail). Adding the same code
    // twice replaces the existing badge rather than stacking duplicates.
    function setCardBadge(id, failure) {
      if (!cards[id]) return null;
      if (!failure || !failure.code) throw new TypeError("setCardBadge expects a failure object");
      clearCardBadge(id, failure.code);
      cards[id].badges.push(failure);
      return handleFor(id);
    }

    function clearCardBadge(id, code) {
      if (!cards[id]) return false;
      var before = cards[id].badges.length;
      cards[id].badges = cards[id].badges.filter(function (b) {
        return b.code !== code;
      });
      return cards[id].badges.length !== before;
    }

    function cardBadges(id) {
      return cards[id] ? cards[id].badges.slice() : [];
    }

    // R68. reply is {text, at, files, kind}. The card is where a declined item
    // gets answered, so the reply is part of the item, not a toast.
    function setAgentMessage(id, reply) {
      if (!cards[id]) return null;
      cards[id].agentMessage = reply || null;
      return handleFor(id);
    }

    // A passing message. Explicitly not persistent, so nothing important can be
    // routed here by accident: the persistent carriers are badges and the
    // failures list.
    function setCardNotice(id, text) {
      if (!cards[id]) return null;
      cards[id].notice = text ? String(text) : null;
      return handleFor(id);
    }

    // STUB: 1B-i answers this from document.activeElement. Returning false here
    // is the safe stub only because removeCard is the sole consumer and the
    // stub creates no DOM to remove.
    function holdsFocus(id) {
      void id;
      return false;
    }

    function cardIds() {
      return Object.keys(cards);
    }

    // -------------------------------------------------------------------------
    // The persistent failures list (R9, D14)
    // -------------------------------------------------------------------------

    var failuresApi = {
      // Adds a failure. Persistent codes stay until dismissed. A non-persistent
      // code is still recorded, so a test can assert it happened, and the UI
      // shows it as a passing message.
      add: function (failure) {
        if (!failure || !failure.code) throw new TypeError("failures.add expects a failure object");
        var existing = failureList.filter(function (f) {
          return f.code === failure.code;
        })[0];
        if (existing) {
          existing.count = (existing.count || 1) + 1;
          existing.at = failure.at;
          existing.detail = failure.detail;
          return existing;
        }
        var entry = Object.assign({}, failure, { count: 1, dismissed: false });
        failureList.push(entry);
        return entry;
      },
      dismiss: function (code) {
        var n = failureList.length;
        failureList = failureList.filter(function (f) {
          return f.code !== code;
        });
        return failureList.length !== n;
      },
      list: function () {
        return failureList.slice();
      },
      count: function () {
        return failureList.length;
      },
      clear: function () {
        failureList = [];
      }
    };

    // -------------------------------------------------------------------------
    // The rest of the rail
    // -------------------------------------------------------------------------

    // R13: a sentence on screen at all times saying what happens to an edit on
    // this target and naming the file or route it concerns.
    function setStatusLine(text) {
      statusLine = text === null || text === undefined ? null : String(text);
      return statusLine;
    }

    function getStatusLine() {
      return statusLine;
    }

    // D7: presence is DISPLAYED and is never read by the code that decides
    // whether send works. It is stored on its own field, deliberately not
    // reachable from sendEnabled below, so the separation is visible in the
    // code rather than promised in a comment.
    function setPresence(value) {
      presence = value;
      return presence;
    }

    function getPresence() {
      return presence;
    }

    // The send button's enabled state. One input: how many items are
    // outstanding. See lifecycle.isSendEnabled, and plan test 2, which asserts
    // statically that presence is not among the inputs.
    function sendEnabled(outstandingCount) {
      return lifecycle.isSendEnabled(outstandingCount);
    }

    function mount() {
      mounted = true;
      return { rootId: markers.OVERLAY_ROOT_ID, isStub: true };
    }

    function unmount() {
      mounted = false;
    }

    function isMounted() {
      return mounted;
    }

    function collapse(next) {
      collapsed = next === undefined ? !collapsed : !!next;
      return collapsed;
    }

    function isCollapsed() {
      return collapsed;
    }

    return {
      mount: mount,
      unmount: unmount,
      isMounted: isMounted,
      collapse: collapse,
      isCollapsed: isCollapsed,
      upsertCard: upsertCard,
      getCard: getCard,
      removeCard: removeCard,
      setCardState: setCardState,
      setCardBadge: setCardBadge,
      clearCardBadge: clearCardBadge,
      cardBadges: cardBadges,
      setAgentMessage: setAgentMessage,
      setCardNotice: setCardNotice,
      holdsFocus: holdsFocus,
      cardIds: cardIds,
      failures: failuresApi,
      setStatusLine: setStatusLine,
      getStatusLine: getStatusLine,
      setPresence: setPresence,
      getPresence: getPresence,
      sendEnabled: sendEnabled
    };
  }

  var shared = createRail();

  return {
    createRail: createRail,
    shared: shared,
    OVERLAY_ROOT_ID: markers.OVERLAY_ROOT_ID,
    failureFor: failuresModule.failure,
    isStub: true
  };
});
