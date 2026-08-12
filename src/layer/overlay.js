// The rail: the chrome, the card API, and the persistent failure chips.
//
// Owner: 1B. STUB committed by 0A-kernel: every signature is real and the state
// each function records is real. What is missing is the DOM.
//
// This file holds THE RAIL CHROME ONLY: the tab shell, the status line, the
// failure chips, and the card API. TAB CONTENTS ARE NOT HERE. They live in
// three files with one owner each (tab_active.js is 1D's, tab_done.js is 3A's,
// tab_edits.js is 3D's), so five tasks stop writing one file.
//
// ---------------------------------------------------------------------------
// The law this file owns: THE RAIL UPDATES IN PLACE, AND A CARD THAT HOLDS
// FOCUS IS NEVER RE-CREATED.
// ---------------------------------------------------------------------------
//
// The single largest in-page revert mechanism in the tool being replaced is a
// rail that rebuilds every card on every repaint: a half-reworded comment is
// destroyed because a removed node never fires blur. Replay makes repaints more
// frequent, not less. So this API has no render(items) that redraws everything.
// It has upsertCard and the mutators below, and that is deliberate: there is no
// function here whose implementation could reasonably be "rebuild the list".
//
// ---------------------------------------------------------------------------
// How any task attaches something to a card
// ---------------------------------------------------------------------------
//
// Four carriers. A task picks by whether the reviewer has to do something.
//
//   setCardState(id, state)      the lifecycle chip: draft, ready, handled,
//                                not_handled. 3A drives it from folded replies
//   setCardBadge(id, failure)    a persistent state on the card, from a
//                                failures.js code: "cannot be placed here",
//                                "the content changed underneath you". Stays
//                                until the thing that set it clears it
//   setAgentMessage(id, reply)   what the agent said about this item (R34).
//                                A QUESTION IS THE LOUDEST THING ON A CARD, a
//                                distinct treatment and not a tinted label,
//                                because a question the reviewer scrolls past
//                                is a stalled agent
//   setCardNotice(id, text)      a passing message. Not persistent
//
// And separately, not on a card:
//
//   failures.add(failure)        the rail's dismissible chip list. Sync
//                                refusals, CSP refusals, a malformed reply
//                                line. Stays until dismissed (R11)
//   setStatusLine(state)         one line, always on screen, saying plainly
//                                what is happening to the reviewer's typing
//                                (R12): kept locally, stored, agent connected
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.overlay = factory(root.LAHE.markers, root.LAHE.failures, root.LAHE.record);
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/failures.js"),
      require("../shared/record.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, failuresModule, record) {
  "use strict";

  // D10's three tabs. Contents come from the three tab files; the shell is
  // here, so a tab can be registered before its file exists.
  var TAB = { ACTIVE: "active", EDITS: "edits", DONE: "done" };
  var TABS = [TAB.ACTIVE, TAB.EDITS, TAB.DONE];

  // R12. The status line has states, not strings, so a test asserts the
  // TRANSITIONS rather than the presence of a sentence. The sentences live here
  // so two builders cannot write two wordings for the same state.
  var STATUS = {
    KEPT_LOCALLY: "kept_locally",
    STORED: "stored",
    AGENT_CONNECTED: "agent_connected"
  };
  var STATUS_TEXT = {
    kept_locally: "Kept in this browser. Nothing is lost; it will be stored when the helper is back.",
    stored: "Stored.",
    agent_connected: "Stored, and an agent is reading."
  };

  function createRail() {
    var cards = Object.create(null);
    var chips = [];
    var status = null;
    var activeTab = TAB.ACTIVE;
    var collapsed = false;
    var mounted = false;

    // A card handle. The node reference is what 1B fills in; the point of
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

    // R34. reply is {status, agent, reason, text, files, at}. The card is where
    // a not-handled item gets answered, so the reply is part of the item and
    // never a toast. The agent's name comes from the reply itself; absent one,
    // the card says "agent", and that is the whole of agent detection (D10).
    function setAgentMessage(id, reply) {
      if (!cards[id]) return null;
      if (!reply) {
        cards[id].agentMessage = null;
        return handleFor(id);
      }
      cards[id].agentMessage = {
        status: reply.status || null,
        agent: reply.agent || "agent",
        reason: reply.reason || null,
        text: reply.text || null,
        files: reply.files || [],
        at: reply.at || null,
        // A question is the loudest thing on the card. Stated as data so the
        // treatment cannot quietly become a tinted label.
        loud: reply.status === record.REPLY_STATUS.QUESTION
      };
      return handleFor(id);
    }

    // A passing message. Explicitly not persistent, so nothing important can be
    // routed here by accident: the persistent carriers are badges and chips.
    function setCardNotice(id, text) {
      if (!cards[id]) return null;
      cards[id].notice = text ? String(text) : null;
      return handleFor(id);
    }

    // STUB: 1B answers this from the shadow root's activeElement. Returning
    // false here is safe only because removeCard is the sole consumer and the
    // stub creates no DOM to remove.
    function holdsFocus(id) {
      void id;
      return false;
    }

    function cardIds() {
      return Object.keys(cards);
    }

    // -------------------------------------------------------------------------
    // The dismissible failure chips (R11)
    // -------------------------------------------------------------------------

    var failuresApi = {
      // Persistent codes stay until dismissed. A non-persistent code is still
      // recorded, so a test can assert it happened, and the UI shows it as a
      // passing message.
      add: function (failure) {
        if (!failure || !failure.code) throw new TypeError("failures.add expects a failure object");
        var existing = chips.filter(function (f) {
          return f.code === failure.code;
        })[0];
        if (existing) {
          existing.count = (existing.count || 1) + 1;
          existing.at = failure.at;
          existing.detail = failure.detail;
          return existing;
        }
        var entry = Object.assign({}, failure, { count: 1, dismissed: false });
        chips.push(entry);
        return entry;
      },
      // Dismissed stays dismissed, across a remount, a navigation, and a replay
      // pass (ranked test 33). The underlying state is still visible on the
      // status line, so dismissing hides the chip and never the truth.
      dismiss: function (code) {
        var n = chips.length;
        chips = chips.filter(function (f) {
          return f.code !== code;
        });
        return chips.length !== n;
      },
      list: function () {
        return chips.slice();
      },
      count: function () {
        return chips.length;
      },
      clear: function () {
        chips = [];
      }
    };

    // -------------------------------------------------------------------------
    // The rest of the chrome
    // -------------------------------------------------------------------------

    // R12: one line on screen at all times saying what is happening to the
    // reviewer's typing. Takes a STATE, not a sentence.
    function setStatusLine(state) {
      if (state === null || state === undefined) {
        status = null;
        return null;
      }
      if (!Object.prototype.hasOwnProperty.call(STATUS_TEXT, state)) {
        throw new Error("setStatusLine: unknown status " + String(state) + "; expected one of " + Object.keys(STATUS_TEXT).join(", "));
      }
      status = state;
      return status;
    }

    function getStatusLine() {
      return status;
    }

    function statusText() {
      return status ? STATUS_TEXT[status] : null;
    }

    function selectTab(tab) {
      if (TABS.indexOf(tab) === -1) throw new Error("selectTab: unknown tab " + String(tab));
      activeTab = tab;
      return activeTab;
    }

    function currentTab() {
      return activeTab;
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

    // The collapsed pill never overlaps the open rail (D10). 1B owns the
    // geometry; the state lives here so a test can drive it.
    function collapse(next) {
      collapsed = next === undefined ? !collapsed : !!next;
      return collapsed;
    }

    function isCollapsed() {
      return collapsed;
    }

    return {
      TAB: TAB,
      TABS: TABS,
      STATUS: STATUS,
      STATUS_TEXT: STATUS_TEXT,
      mount: mount,
      unmount: unmount,
      isMounted: isMounted,
      collapse: collapse,
      isCollapsed: isCollapsed,
      selectTab: selectTab,
      currentTab: currentTab,
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
      statusText: statusText
    };
  }

  var shared = createRail();

  return {
    TAB: TAB,
    TABS: TABS,
    STATUS: STATUS,
    STATUS_TEXT: STATUS_TEXT,
    createRail: createRail,
    shared: shared,
    OVERLAY_ROOT_ID: markers.OVERLAY_ROOT_ID,
    failureFor: failuresModule.failure,
    isStub: true
  };
});
