// The rail: the chrome, the card API, the status line, and the failure chips.
//
// Owner: 1B.
//
// This file holds THE RAIL CHROME ONLY: the tab shell, the status line, the
// failure chips, and the card API. TAB CONTENTS ARE NOT HERE. They live in
// three files with one owner each (tab_active.js is 1D's, tab_done.js is 3A's,
// tab_edits.js is 3D's), so five tasks stop writing one file. A tab owner fills
// tabBody(tab); a card's contents go in cardBody(id).
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
// The law has three sharp edges, all of them enforced below rather than
// documented:
//
//   1. upsertCard on an id that exists MUTATES the existing node. It never
//      replaces it, and it never re-orders around it.
//   2. removeCard on a card holding focus returns false and removes nothing.
//   3. A card whose state moves it to another tab is NOT re-parented while it
//      holds focus: re-parenting blurs a focused element in every engine. The
//      move is held and flushed the moment focus leaves.
//
// ---------------------------------------------------------------------------
// All library UI is in a CLOSED shadow root (D8)
// ---------------------------------------------------------------------------
//
// The page's CSS cannot reach the library and the library's CSS cannot touch
// the page. That is also why the rail answers questions about its own focus:
// nothing outside can read a closed root's activeElement, and removeCard needs
// the answer anyway.
//
// The one page-level exception D8 names (the namespaced ::highlight() rules) is
// 1D's file, not this one. This file adds exactly one element to the page: the
// overlay host.
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
//                                (R12): kept locally, stored, agent listening
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.overlay = factory(
      root.LAHE.markers,
      root.LAHE.failures,
      root.LAHE.record,
      root.LAHE.highlight,
      root.LAHE.protocol
    );
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/failures.js"),
      require("../shared/record.js"),
      require("./highlight.js"),
      require("../shared/protocol.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, failuresModule, record, highlightModule, protocol) {
  "use strict";

  // D10's three tabs. Contents come from the three tab files; the shell is
  // here, so a tab can be registered before its file exists.
  var TAB = { ACTIVE: "active", EDITS: "edits", DONE: "done" };
  var TABS = [TAB.ACTIVE, TAB.EDITS, TAB.DONE];
  var TAB_LABEL = { active: "Active", edits: "Edits", done: "Done" };

  /**
   * Which pane a card belongs in, from the record alone.
   *
   * Module scope, and on both the module and every rail, because it is the ONE
   * pane rule. The Done tab has to know which tab a card sits in to badge that
   * tab rather than always Done, and a second copy of this rule in that file is
   * how the two drift apart. Pure: item in, tab name out, no card required, so
   * it answers for an item the rail has never been handed.
   */
  function paneForItem(item) {
    var kind = item[record.FIELD.KIND];
    // The state the REVIEWER is shown, which is the state their card is placed
    // by. While a TOOL ROUND is open the record says ready and the reviewer is
    // not part of it, so the card stays in Done where they left it
    // (record.displayState, and Ken on 2026-09-15).
    var state = record.displayState(item);
    if (state === record.STATE.HANDLED) return TAB.DONE;
    if (kind === record.KIND.EDIT || kind === record.KIND.FORMAT_ONLY || kind === record.KIND.DELETE) {
      return TAB.EDITS;
    }
    return TAB.ACTIVE;
  }

  // R12. The status line has states, not strings, so a test asserts the
  // TRANSITIONS rather than the presence of a sentence. The sentences live here
  // so two builders cannot write two wordings for the same state.
  var STATUS = {
    // Something FAILED: a request the helper refused, could not take, or never
    // answered. Saying the helper is away is a fact here.
    KEPT_LOCALLY: "kept_locally",
    // Nothing has failed and the helper has not confirmed anything yet. The work
    // is in this browser, which is true, and no outage is asserted, because
    // asserting one before a single request has failed is an invention (the
    // status line lied on every freshly loaded page; walkers, 2026-08-14).
    KEPT_UNCONFIRMED: "kept_unconfirmed",
    // STORED IS ABOUT STORAGE, and that is all this state machine decides. There
    // used to be a fourth state, `agent_connected`, which read "Stored · agent
    // reading" the moment the first reply of the session arrived. It never aged
    // out, so it kept saying an agent was reading for the rest of the session,
    // sitting directly above a second line that read "No agent watching · oldest
    // item 6m" (Ken, live, 2026-08-23). The page cannot know whether an agent is
    // reading; the helper can, from the machine. So the storage half stops here,
    // and the agent half is added by the one renderer below, from the helper's
    // answer.
    STORED: "stored",
    // R36: the agent rebuilt the page and the library is about to reload it.
    // A moment long, and it exists so the reload is something the reviewer was
    // told about rather than something that happened to them.
    PAGE_RELOADING: "page_reloading"
  };
  var STATUS_TEXT = {
    kept_locally: "Kept in this browser. Nothing is lost; it will be stored when the helper is back.",
    kept_unconfirmed: "Kept in this browser. It is stored the moment the helper confirms it.",
    stored: "Stored.",
    page_reloading: "Page updated. Reloading, your comments and edits come with it."
  };
  // The short form, for the one line that is always on screen. The long form
  // above is the title attribute, so the plain statement is never truncated
  // away entirely.
  var STATUS_SHORT = {
    kept_locally: "Kept in this browser",
    kept_unconfirmed: "Kept in this browser",
    stored: "Stored",
    page_reloading: "Page updated. Reloading..."
  };

  // Has anything come back from the agent? GROUND TRUTH FROM THE HELPER, which
  // reads it off the machine: the replies on this review, and whether anything
  // on this computer is holding the session's wake feed open. Never something an
  // agent said about itself. A reviewer used to be told "monitoring is active"
  // in a chat while seven items sat unanswered, and nothing on screen could
  // contradict it.
  //
  // IT IS HALF OF ONE LINE, not a line of its own. The rail had two, and they
  // contradicted each other in front of the reviewer: "Stored · agent reading"
  // over "No agent watching · oldest item 6m", both at once, while an agent was
  // demonstrably replying. One line cannot disagree with itself.
  //
  // WHAT IT SAYS IS AN ELAPSED TIME, in a reviewer's words. Either the agent
  // answered and it says how long ago, or work is waiting and it says how long
  // it has waited. It never mentions monitors, heartbeats or wake feeds: that is
  // our plumbing, and a reviewer cannot do anything with it.
  //
  // THE WORDS COME FROM protocol.js, which is already above this file in the
  // bundle. They used to be hand-copied here, which is two spellings of one wire
  // value: rename a state on the helper and the rail silently stopped
  // recognising it, which looks exactly like a healthy rail with nothing to say.
  var AGENT_STATE = protocol.AGENT_LIVENESS.STATE;
  var AGENT_FIELD = protocol.AGENT_LIVENESS.FIELD;
  // How often the line re-reads its own clock. The number on it is the one thing
  // on the rail that goes stale by itself: the helper repeats the same payload
  // for as long as nothing changes, while "nothing back yet, 1m" quietly becomes
  // a lie. 30 seconds is well inside the units the line prints, and it is what
  // makes a quiet line start speaking and a calm one go loud with no word from
  // the helper at all.
  var AGENT_AGE_TICK_MS = 30000;
  var AGENT_TEXT = protocol.AGENT_LIVENESS.TEXT;
  var AGENT_CONNECTION = protocol.AGENT_LIVENESS.CONNECTION;
  var AGENT_DETAIL = protocol.AGENT_LIVENESS.DETAIL;
  // Under AGENT_QUIET_MS the line says nothing about a wait; past the overdue
  // rule below it is loud about one. Both live in protocol.js beside the
  // states, for the same reason the words do.
  var AGENT_QUIET_MS = protocol.AGENT_LIVENESS.QUIET_MS;
  // THE ONE RULE for an overdue wait, and the words that go with it. The footer
  // going loud, a late card turning amber and the banner at the top of the rail
  // all read agentOverdue, so the three cannot disagree about when to speak up.
  var agentOverdue = protocol.AGENT_LIVENESS.overdue;
  var AGENT_PROMINENT = protocol.AGENT_LIVENESS.PROMINENT;

  var STATE_LABEL = {
    draft: "Draft",
    ready: "Ready",
    handled: "Handled",
    not_handled: "Not handled",
    // A rail-only display state (docs/features/20260917.01_hold_toggle): the
    // item itself is still `ready` in the record (Hold gates delivery, not
    // lifecycle); this is what the card shows while its ready event sits
    // queued in the outbox with Hold on.
    held: "Held"
  };
  // The word the toggle and the toast both use. One spelling, so the button's
  // accessible name and anything announcing it never drift apart.
  var HOLD_LABEL = "Hold sending";
  var HOLD_ZERO_TEXT = "Holding — nothing sends until you release";
  function holdCountText(n) {
    return "Holding, " + n + " queued";
  }
  var KIND_LABEL = {
    comment: "Comment",
    edit: "Edit",
    delete: "Deletion",
    format_only: "Formatting",
    note: "Note"
  };

  function timestampLabel(value) {
    if (!value) return "";
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
    } catch (err) {
      return date.toLocaleString();
    }
  }

  // The named limit from D5, said on the status line rather than claimed as
  // covered: two windows in separate storage with no helper running cannot be
  // refused by anything, so the rail says so out loud.
  // It is SHOWN ONLY IN THE STATE IT DESCRIBES (see renderStatus): a caveat
  // about there being no helper, printed under a status line that says the
  // helper is storing and an agent is reading, contradicts the line above it and
  // teaches the reviewer to stop reading the footer.
  var LIMIT_SEPARATE_STORAGE_NO_HELPER =
    "A second window in a separate browser profile cannot be detected.";

  // How a tab module's sheet names itself inside the rail's closed root, so
  // ensureStyleSheet can find the one it already put there instead of adding a
  // second copy on every remount.
  var SHEET_ATTR = "data-lahe-sheet";

  // ---------------------------------------------------------------------------
  // How wide the rail is
  // ---------------------------------------------------------------------------
  //
  // Ken: "some of these responses are getting quite thorough and long, so the
  // chat rail should be drag-expandable." An agent's answer is a piece of
  // reading now, and a column sized for a one-line status note is the wrong
  // shape for it. So the reviewer drags the rail's left edge and the rail
  // remembers where they left it.
  //
  // The default stays exactly what it was, expressed in CSS so a rail nobody
  // has touched has no inline width at all: clamp(320px, 26vw, 392px).
  //
  // Nothing about the PAGE changes when the rail grows (D8). The rail is
  // position:fixed inside a closed root, so its width is not part of any layout
  // the page can see.

  // The default width, as three numbers rather than a CSS string, so the one
  // place it is spelled is here and the stylesheet is built from it. A rail
  // nobody has dragged carries no inline width at all and wears this.
  var RAIL_DEFAULT_MIN = 320;
  var RAIL_DEFAULT_VW = 26;
  var RAIL_DEFAULT_MAX = 392;

  // The narrowest useful rail. Below this the cards' own controls start
  // wrapping, so there is nothing to gain by letting the drag go further.
  var RAIL_MIN_WIDTH = 280;
  // The widest, as a share of the viewport. A rail past this is not a panel
  // beside the page, it IS the page, and the reviewer can no longer see what
  // they are reviewing.
  var RAIL_MAX_FRACTION = 0.7;
  // ...and never closer than this to the left edge, which is what keeps the
  // fraction sane on a narrow window: 70% of a 480px phone would leave 144px of
  // page, and this leaves a usable strip instead.
  var RAIL_MAX_MARGIN = 48;
  // The gap the rail keeps from the right edge of the viewport. It matches the
  // `right` in the .rail rule, and it is the difference between the rail's own
  // width and the allowance everything else keeps clear of.
  var RAIL_EDGE_GAP = 16;
  // One press of an arrow key. Small enough to tune with, large enough that the
  // rail visibly moves.
  var RAIL_KEY_STEP = 16;
  // What the grip says it is, to a screen reader and to a test.
  var RAIL_GRIP_LABEL = "Resize the review panel";

  /**
   * The width the rail may actually take, given the viewport it is in.
   *
   * Pure, and exported, because this is the whole of the resize policy: a test
   * can state the rule without a browser, and the drag, the keyboard and the
   * restore-from-storage path all clamp through this ONE function rather than
   * each having its own idea of the bounds.
   *
   * The minimum wins a fight with the maximum. On a viewport too narrow for
   * both, a rail clamped to something under RAIL_MIN_WIDTH is a rail whose
   * cards have started wrapping, and a reviewer on a small window is better
   * served by a readable panel that covers more of the page.
   *
   * @param {number} width          the width being asked for, in CSS pixels
   * @param {number} [viewportWidth] the viewport's width, when there is one
   * @returns {number|null} the width to use, rounded, or null for "not a width"
   */
  function clampRailWidth(width, viewportWidth) {
    var want = Number(width);
    if (!isFinite(want) || want <= 0) return null;
    var view = Number(viewportWidth);
    var max = null;
    if (isFinite(view) && view > 0) {
      max = Math.max(RAIL_MIN_WIDTH, Math.min(view * RAIL_MAX_FRACTION, view - RAIL_MAX_MARGIN));
    }
    if (want < RAIL_MIN_WIDTH) want = RAIL_MIN_WIDTH;
    if (max !== null && want > max) want = max;
    return Math.round(want);
  }

  // ---------------------------------------------------------------------------
  // Folding a card down to one line
  // ---------------------------------------------------------------------------
  //
  // Ken, 2026-09-15: "I'm scrolling through comments a lot now. We should make
  // individual comments in a thread collapsible, so I can close them down to a
  // single line when I'm doing a lot of chatting across lots of different
  // things."
  //
  // A collapsed card is a card that is STILL THERE, not one that is hidden: it
  // keeps its place in the pane, its state chip, its time, and both of the marks
  // that say something on it is worth reading. What goes away is the reading:
  // the quote, the body, the agent's answer, the composer.
  //
  // THE ONE READING RULE THIS CHANGES. A collapsed card does not count as
  // looked at, so opening the tab it sits in does not mark its reply read.
  // Expanding it does. Everything else about unseen, badges, toasts and neglect
  // is untouched; see tab_done.js, which owns all of it.
  //
  // These four are declared above the stylesheet because the stylesheet is built
  // from them, and a var read before its line runs is `undefined` in a selector.

  // The plain chevron the disclosure controls wear, in the card head and on a
  // thread round. Drawn rather than vendored: it is two strokes, and shipping a
  // second icon file to say "there is more under here" is not worth the
  // provenance note it would need.
  var CHEVRON_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M9 5l7 7-7 7"/>' +
    "</svg>";

  // The card attribute that says it is folded. On the CARD rather than on a
  // child, so one attribute puts away every block the rail and the three tab
  // owners draw inside it, and nothing has to be told.
  var CARD_COLLAPSED_ATTR = "data-lahe-collapsed";
  // The two marks a folded card still has to show. tab_done.js SETS both of
  // these; the rail only reads them, which is what lets a folded card say "1
  // new" without this file knowing what a reply is. Spelled here so there is one
  // spelling: tab_done.js takes its own constants from these.
  var CARD_UNSEEN_ATTR = "data-lahe-unseen";
  var CARD_ASKING_ATTR = "data-lahe-asking";
  // A ready card nobody has picked up, past the overdue rule. Set by the rail
  // alone, off the item and the helper's liveness answer.
  var CARD_LATE_ATTR = "data-lahe-late";

  // How much of what a card is about fits on its folded line. Long enough to
  // recognize the passage, short enough that every folded card is one row at
  // rail width.
  var COLLAPSED_LINE_MAX = 60;

  var CSS = [
    // all: initial stops every inheritable property of the host page (font,
    // color, line-height, letter-spacing) from reaching the rail. A closed
    // shadow root blocks the page's SELECTORS, never its inheritance.
    ":host{all:initial;position:fixed;z-index:2147483000;top:0;right:0;bottom:0;width:0;height:0;",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;",
    "--ink:#15171c;--ink-soft:#565e6d;--ink-faint:#868f9f;--paper:#fff;--surface:#f6f7f9;",
    "--sunken:#eef0f4;--line:#e2e5eb;--line-soft:#eceef2;--accent:#3c56a5;--accent-ink:#2c3f7d;",
    "--accent-wash:rgba(60,86,165,.09);--warn:#8d5715;--warn-wash:rgba(180,120,30,.12);",
    "--good:#2c6f52;--shadow:0 1px 2px rgba(18,20,26,.06),0 14px 34px rgba(18,20,26,.13);",
    // THE CARD'S STATE IS A COLOR AS WELL AS A WORD. A draft the reviewer has
    // not submitted wears a quiet warm wash, and a card an agent has HANDLED
    // wears green, because green means done. A card that is sent and waiting is
    // not done, so it is not green (Ken, 2026-09-16: a waiting card "is green,
    // signifying success"): it is the plain card with the accent border. They
    // are washes over the card's paper, not fills: the reviewer's own sentence
    // stays the strongest thing on the card.
    "--draft-wash:#fdf8ef;--draft-line:#ecdcbe;--handled-wash:#f1f8f4;--handled-line:#cee2d6;",
    "--radius:14px;--radius-sm:10px}",
    // THE PAGE PICKS THE SCHEME, NOT THE OS. highlight.js samples the reviewed
    // page's own background and stamps data-lahe-scheme on this rail's host, so
    // a dark-mode OS over a light page leaves the rail light and the tool stays
    // a quiet object on someone else's page instead of a black slab.
    ":host([data-lahe-scheme='dark']){",
    // Dark keeps the same relationship light has: the card and the rail are the
    // lit surface, the pane behind them is the ground. Inverting that is what
    // makes a dark UI read as a stack of holes.
    "--ink:#e9ebf0;--ink-soft:#a8b0be;--ink-faint:#7b8496;--paper:#1c2028;--surface:#14171c;",
    "--sunken:#0f1216;--line:#2c313b;--line-soft:#242932;--accent:#93a7ea;",
    // Raised from .14: at the lower alpha the question block was barely
    // separable from the card behind it, so the block's loudness rested on the
    // rule alone and D10's promise (a question cannot be scrolled past) was
    // thinner in dark than in light. Same relationship, not the same alpha.
    "--accent-ink:#b7c4f2;--accent-wash:rgba(147,167,234,.22);--warn:#dfae6a;",
    "--warn-wash:rgba(223,174,106,.14);--good:#7fc4a2;",
    // The same two washes, derived the way every other dark token here is: the
    // same relationship to the card's paper, not the same numbers. A light tint
    // carried into dark reads as a lit panel; these are the dark paper with the
    // hue mixed into it.
    "--draft-wash:#26221b;--draft-line:#3b3327;--handled-wash:#1a2420;--handled-line:#2a3d34;",
    "--shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.45)}",
    "*{box-sizing:border-box;margin:0;padding:0;font:inherit;color:inherit}",
    "button{background:none;border:0;cursor:pointer;font:inherit;color:inherit}",
    ":focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}",

    // --- the rail -----------------------------------------------------------
    // pointer-events comes back on here: the ONE page-level host is
    // pointer-events:none so the page stays clickable through it, and the two
    // things the rail actually draws turn it back on.
    ".rail{position:fixed;top:16px;right:" + RAIL_EDGE_GAP + "px;bottom:16px;",
    "width:clamp(" + RAIL_DEFAULT_MIN + "px," + RAIL_DEFAULT_VW + "vw," + RAIL_DEFAULT_MAX + "px);",
    "pointer-events:auto;",
    "display:flex;flex-direction:column;background:var(--paper);color:var(--ink);",
    "border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);",
    "overflow:hidden;font-size:13px;line-height:1.45;letter-spacing:.005em}",
    ".rail[hidden]{display:none}",

    // --- the resize grip ------------------------------------------------------
    // The rail is fixed to the right edge, so its LEFT edge is the one that
    // moves. The grip is an 8px hit area along that edge: wide enough to catch
    // with a mouse, narrow enough that it is not stealing presses from the
    // cards beside it.
    //
    // Inside the rail rather than straddling its border, because .rail is
    // overflow:hidden and anything hanging outside it would simply be clipped.
    // The visible affordance is the 2px line, which is what the reviewer aims
    // at, and it only appears on hover, focus or during a drag: a permanent
    // line down the inside edge would read as a second border.
    //
    // NO TRANSITION ON WIDTH anywhere. A rail that eases toward the pointer
    // feels broken while you are dragging it.
    ".grip{position:absolute;left:0;top:0;bottom:0;width:8px;z-index:6;",
    "cursor:col-resize;touch-action:none;background:none;border:0;padding:0}",
    ".grip::after{content:'';position:absolute;left:3px;top:0;bottom:0;width:2px;background:transparent}",
    ".grip:hover::after,.grip:focus-visible::after{background:var(--line)}",
    ".grip[data-lahe-dragging]::after{background:var(--accent)}",
    // The drag must not select the words it passes over, and it must not land a
    // press on a card when the pointer is released. The grip itself keeps its
    // events: it is the thing being dragged.
    ".rail[data-lahe-resizing]{-webkit-user-select:none;user-select:none}",
    ".rail[data-lahe-resizing]>*:not(.grip){pointer-events:none}",

    // position/z-index so the head's menu can hang over the panes below it.
    ".head{position:relative;z-index:3;display:flex;align-items:center;gap:10px;padding:13px 14px 12px;",
    "border-bottom:1px solid var(--line-soft)}",
    ".mark{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none}",
    ".title{font-size:13px;font-weight:600;letter-spacing:-.005em}",
    ".review{font-size:11px;color:var(--ink-faint);letter-spacing:.02em;",
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:11ch}",
    ".head .spacer{flex:1}",
    ".iconbtn{width:26px;height:26px;border-radius:7px;color:var(--ink-soft);",
    "display:flex;align-items:center;justify-content:center;font-size:14px}",
    ".iconbtn:hover{background:var(--surface);color:var(--ink)}",
    ".iconbtn[aria-expanded='true']{background:var(--surface);color:var(--ink)}",

    // --- the head's menu ------------------------------------------------------
    // Copy and Export are HERE now, not standing in the footer (D10, revised
    // from Ken's real use): reachable in one click, in the reviewer's face
    // never. The button is the collapse arrow's twin, same hit area and same
    // quiet register, so the head reads as two controls rather than as one
    // control and one advertisement.
    ".menuwrap{position:relative;display:flex;flex:none}",
    ".menu{position:absolute;top:calc(100% + 7px);right:0;min-width:172px;z-index:4;",
    "display:flex;flex-direction:column;gap:1px;padding:5px;background:var(--paper);",
    "border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:var(--shadow)}",
    ".menu[hidden]{display:none}",
    ".menuitem{display:block;width:100%;text-align:left;white-space:nowrap;font-size:12.5px;",
    "font-weight:500;color:var(--ink);padding:7px 10px;border-radius:7px}",
    ".menuitem:hover{background:var(--surface)}",

    // --- tabs ---------------------------------------------------------------
    ".tabs{display:flex;gap:2px;padding:8px 10px 0;border-bottom:1px solid var(--line-soft)}",
    ".tab{position:relative;padding:6px 10px 10px;font-size:12px;font-weight:500;",
    "color:var(--ink-soft);display:flex;align-items:center;gap:6px}",
    ".tab:hover{color:var(--ink)}",
    ".tab[aria-selected='true']{color:var(--ink);font-weight:600}",
    ".tab[aria-selected='true']::after{content:'';position:absolute;left:8px;right:8px;bottom:-1px;",
    "height:2px;background:var(--accent);border-radius:2px}",
    ".count{font-variant-numeric:tabular-nums;font-size:11px;color:var(--ink-faint);",
    "background:var(--surface);border-radius:999px;padding:1px 6px;min-width:20px;text-align:center}",
    ".tab[aria-selected='true'] .count{color:var(--accent-ink);background:var(--accent-wash)}",
    // The unseen badge, next to (never instead of) the total count. The count
    // says how much is in the tab; this says how much of it is NEW since the
    // reviewer last looked. Accent-filled so it reads at a glance, small enough
    // that a question card is still the loudest thing in the rail.
    ".newmark{font-variant-numeric:tabular-nums;font-size:10px;font-weight:700;line-height:1;",
    "color:#fff;background:var(--accent);border-radius:999px;padding:2px 5px;min-width:14px;text-align:center}",
    ":host([data-lahe-scheme='dark']) .newmark{color:#12151a}",
    ".newmark[hidden]{display:none}",

    // --- panes --------------------------------------------------------------
    ".panes{flex:1;overflow:hidden;display:flex;background:var(--surface)}",
    ".pane{flex:1;overflow-y:auto;padding:12px;display:none;flex-direction:column;gap:10px}",
    ".pane[data-current='true']{display:flex}",
    ".empty{color:var(--ink-faint);font-size:12px;padding:18px 4px;text-align:center}",
    ".pane:not(:has(.card)) .empty{display:block}",
    ".pane:has(.card) .empty{display:none}",

    // --- cards --------------------------------------------------------------
    ".card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius-sm);",
    "padding:11px 12px 12px;display:flex;flex-direction:column;gap:8px;",
    "box-shadow:0 1px 1px rgba(18,20,26,.03)}",
    // The state, in color. Draft is a quiet warm wash: unsent, and only the
    // reviewer can see it. Ready is the plain card with the accent border: sent,
    // and not done yet. Handled is the one green card, because green means done.
    ".card[data-state='draft']{background:var(--draft-wash);border-color:var(--draft-line)}",
    ".card[data-state='ready']{background:var(--paper);border-color:var(--accent)}",
    ".card[data-state='handled']{background:var(--handled-wash);border-color:var(--handled-line)}",
    // HELD (docs/features/20260917.01_hold_toggle). Not a fifth meaning added to
    // the three colors above: green stays "handled", the warm wash stays
    // "draft", so held is neutral, built only from tokens this rail already
    // has (--surface, --line). A dashed line is the whole signal; no accent
    // stripe layered on top (Ken flagged exactly that pattern as a banned
    // single-side colored border on the overdue banner, commit 51bfd2a: this
    // rail's own border already carries the meaning, on all four sides).
    ".card[data-state='held']{background:var(--surface);border-color:var(--line);border-style:dashed}",
    // A READY CARD NOBODY HAS PICKED UP, past the overdue rule. The signal is a
    // strong amber border (drawn two pixels wide with a ring, so nothing moves)
    // and the "waiting 12m" label, on the plain card. It is deliberately NOT a
    // wash: a warm wash is what a draft wears, and the two must not blur. After
    // the state rules so it wins over the ready accent, and it goes the moment a
    // reply lands, because the reply takes the item out of waiting.
    ".card[" + CARD_LATE_ATTR + "='true']{background:var(--paper);border-color:var(--warn);",
    "box-shadow:0 0 0 1px var(--warn)}",
    ".card__wait{display:none;font-size:10px;font-weight:600;color:var(--warn);white-space:nowrap;",
    "font-variant-numeric:tabular-nums}",
    ".card[" + CARD_LATE_ATTR + "='true'] .card__wait{display:inline}",
    // The wait takes the timestamp's place rather than sitting beside it: at
    // rail width both together pushed the state chip off the card. The exact
    // time is still one hover away on the wait itself.
    ".card[" + CARD_LATE_ATTR + "='true'] .card__time{display:none}",
    ".card:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-wash)}",
    ".card__top{display:flex;align-items:center;gap:8px}",
    ".card__kind{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;",
    "color:var(--ink-faint)}",

    // --- folding a card to one line -----------------------------------------
    //
    // The chevron is the same quiet weight as the head it sits in, and its TAP
    // TARGET IS 44px while its drawn box is not: the negative margins pull the
    // hit area out over the card's own padding, which is space nothing else
    // wants, so a thumb gets a real target and the head keeps its height.
    ".carddisclose{flex:none;position:relative;z-index:1;display:inline-flex;",
    "align-items:center;justify-content:center;width:44px;height:44px;",
    "margin:-12px -10px -12px -12px;padding:0;border:0;background:none;",
    "color:var(--ink-faint);cursor:pointer}",
    ".carddisclose:hover{color:var(--ink-soft)}",
    ".carddisclose:focus-visible{outline:2px solid var(--accent);outline-offset:-10px;border-radius:7px}",
    // Pointing right when the card is folded, a quarter turn down when it is
    // open. 120ms, which is long enough to read as a turn and short enough that
    // it never delays the reading underneath it.
    ".carddisclose svg{width:13px;height:13px;transform:rotate(90deg);",
    "transition:transform 120ms ease}",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'] .carddisclose svg{transform:rotate(0deg)}",
    "@media (prefers-reduced-motion:reduce){.carddisclose svg{transition:none}}",
    // The folded line itself. Drawn always, shown only when the card is folded,
    // so nothing is built at the moment of the click.
    ".card__line{display:none;align-items:baseline;gap:7px;min-width:0}",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'] .card__line{display:flex}",
    ".card__linetext{flex:1;min-width:0;font-size:12.5px;color:var(--ink-soft);",
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    // The tag that keeps a folded card honest: something on it is worth reading
    // and the words for it are off the screen. Driven entirely by the two marks
    // tab_done already sets on the card, so it can never disagree with them.
    ".card__tag{flex:none;display:none;font-size:10px;font-weight:700;line-height:1;",
    "letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:3px 6px;",
    "color:#fff;background:var(--accent)}",
    ":host([data-lahe-scheme='dark']) .card__tag{color:#12151a}",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'][" + CARD_UNSEEN_ATTR + "='true'] .card__tag--new{display:inline-block}",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'][" + CARD_ASKING_ATTR + "='true'] .card__tag--ask{display:inline-block}",
    // A card that is both is a question, which is the louder of the two.
    ".card[" + CARD_COLLAPSED_ATTR + "='true'][" + CARD_ASKING_ATTR + "='true'] .card__tag--new{display:none}",
    // Everything a folded card puts away. The card keeps its head (kind, time,
    // state chip) and gains the line above; the reading goes.
    ".card[" + CARD_COLLAPSED_ATTR + "='true'] > .card__quote,",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'] > .card__body,",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'] > .card__badges,",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'] > .agent,",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'] > .card__continuation,",
    ".card[" + CARD_COLLAPSED_ATTR + "='true'] > .card__notice{display:none}",
    ".card[" + CARD_COLLAPSED_ATTR + "='true']{gap:6px;padding-bottom:10px}",
    ".card__top .spacer{flex:1}",
    ".card__time,.agent__time{font-size:10px;color:var(--ink-faint);font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".card__state{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;",
    "padding:2px 7px;border-radius:999px;background:var(--surface);color:var(--ink-soft)}",
    ".card__state[data-state='ready']{background:var(--accent-wash);color:var(--accent-ink)}",
    ".card__state[data-state='handled']{color:var(--good);background:transparent;",
    "border:1px solid currentColor}",
    ".card__state[data-state='not_handled']{color:var(--warn);background:var(--warn-wash)}",
    ".card__quote{font-size:12px;color:var(--ink-soft);border-left:2px solid var(--line);",
    "padding-left:9px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
    ".card__body{font-size:13.5px;line-height:1.5;color:var(--ink);display:flex;",
    "flex-direction:column;gap:8px}",
    ".card__body:empty{display:none}",
    ".card__continuation:empty{display:none}",
    // A text box a tab owner hosts in a card reads as part of the card rather
    // than as a form control dropped into one. 1D owns the box; the rail owns
    // how anything inside its own surface looks, and specificity this low is
    // overridable by the owner.
    ".card__body textarea,.card__body input[type='text']{width:100%;border:0;background:transparent;",
    "resize:none;min-height:3.2em;font:inherit;font-size:13.5px;line-height:1.5;color:var(--ink);",
    "outline:0;padding:0}",
    ".card__body textarea::placeholder{color:var(--ink-faint)}",
    // THE ONE QUIET ACTION REGISTER FOR ANYTHING INSIDE A CARD. Every tab owner
    // that puts a control on a card uses it, so the rail has one button voice
    // rather than one per file. It is deliberately small and outlined: these sit
    // under the reviewer's own sentence and must not compete with it.
    ".cardacts{display:flex;align-items:center;gap:7px;flex-wrap:wrap}",
    ".cardacts:empty{display:none}",
    ".cardact{font-size:11.5px;font-weight:550;color:var(--ink-soft);border:1px solid var(--line);",
    "border-radius:7px;padding:3px 9px;background:var(--paper)}",
    ".cardact:hover{color:var(--ink);background:var(--surface)}",
    ".cardact--quiet{border-color:transparent;background:none;padding:3px 5px}",
    ".cardact--quiet:hover{background:var(--surface);border-color:var(--line-soft)}",

    // A HANDLED CARD IS NOT AN ACTIVE ONE, AND IT SAYS EACH THING ONCE. The
    // Active tab's row stays attached to a card that moved to Done (withdrawing
    // it would re-parent a node the reviewer may be in, which is the rail's own
    // law), so the pane it landed in decides what shows. On a handled card the
    // Done row carries the reviewer's words and Reopen, the rail's own .agent
    // block carries what the agent said and the files, and the Active row's copy
    // of the note and its Reword/Delete are not drawn.
    ".card[data-state='handled'] .card__body > [data-lahe-active-row]{display:none}",

    ".card__badges{display:flex;flex-direction:column;gap:5px}",
    ".card__badges:empty{display:none}",
    ".badge{font-size:12px;color:var(--warn);background:var(--warn-wash);border-radius:7px;",
    "padding:6px 8px}",
    ".card__notice{font-size:12px;color:var(--ink-faint)}",
    ".card__notice:empty{display:none}",

    // The agent's question is the loudest thing on a card: its own block, its
    // own rule, its own weight. Not a tinted label (D10).
    // THE AGENT'S WORDS ARE WHAT THE REVIEWER CAME TO READ. Ken, 2026-09-11: the
    // answer sat at 12.5px on a tinted surface, so it was both smaller and
    // lower-contrast than his own note above it, "and it's the thing I need to
    // read." Full ink and the card body's size, the same weight as the note.
    ".agent{border-radius:8px;padding:9px 11px;background:var(--surface);color:var(--ink);",
    "font-size:14px;line-height:1.55}",
    ".agent:empty{display:none}",
    ".agent__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px}",
    ".agent__who{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;",
    "color:var(--ink-faint);display:block}",
    ".agent.is-loud{background:var(--accent-wash);border-left:3px solid var(--accent);",
    "color:var(--ink);font-size:14px;line-height:1.55}",
    ".agent.is-loud .agent__who{color:var(--accent-ink)}",
    // ONE PATH PER LINE, AND IT BREAKS. Repo-relative paths are long and have
    // no natural break points, so joined on one line with normal wrapping they
    // ran straight out of the card (Ken, Done tab, first real use). A path is a
    // unit the reviewer scans, so it gets its own line, and anywhere-breaking
    // keeps the longest one inside the card at rail width.
    ".agent__files{margin-top:5px;font-size:11px;color:var(--ink-faint);",
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;",
    "display:flex;flex-direction:column;gap:2px;min-width:0}",
    ".agent__file{overflow-wrap:anywhere;word-break:break-word;line-height:1.35}",

    // --- the overdue banner ---------------------------------------------------
    //
    // At the top of the rail, under the head, where it is read before any card.
    // Shown exactly while the footer line is loud, and gone when it is not.
    // A full border on --warn carries the signal on all four sides, matching
    // the late card's own ring (see CARD_LATE_ATTR below). No accent stripe on
    // one side alone: that reads as a single-side colored border, which this
    // rail's own style rules ban the same way the document style guide does.
    ".late{display:none;flex-direction:column;gap:7px;margin:10px 10px 0;padding:11px 12px;",
    "border-radius:var(--radius-sm);background:var(--warn-wash);border:1px solid var(--warn)}",
    ".late[data-shown='true']{display:flex}",
    ".late__title{font-size:12.5px;font-weight:700;color:var(--ink);line-height:1.4}",
    ".late__check{font-size:12px;color:var(--ink-soft);line-height:1.45}",
    ".late__btn{align-self:flex-start;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;",
    "background:var(--accent);border:1px solid var(--accent);color:#fff;cursor:pointer}",
    ":host([data-lahe-scheme='dark']) .late__btn{color:#12151a}",
    ".late__btn:hover{filter:brightness(1.06)}",
    ".late__note{font-size:11.5px;color:var(--ink-soft);line-height:1.4}",
    ".late__note:empty{display:none}",
    ".late__message{display:none;font-size:11px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;",
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--paper);",
    "border:1px solid var(--line);border-radius:7px;padding:7px 8px;user-select:text;-webkit-user-select:text}",
    ".late__message[data-shown='true']{display:block}",

    // --- footer -------------------------------------------------------------
    ".foot{border-top:1px solid var(--line-soft);background:var(--paper);",
    "padding:10px 12px 11px;display:flex;align-items:stretch;gap:10px}",
    ".chips{display:flex;flex-direction:column;gap:6px}",
    ".chips:empty{display:none}",
    ".chip{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.4;",
    "background:var(--warn-wash);color:var(--ink);border-radius:8px;padding:7px 8px 7px 10px}",
    // min-width:0 and the wrap rules are load bearing: a chip is a flex item, a
    // flex item will not shrink below its content, and one long unbroken path in
    // the detail line pushed the whole chip wider than the rail so the first
    // sentence was clipped off the side, unreadable (Ken, live, 2026-08-18).
    ".chip__text{flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word}",
    ".chip__remedy{display:block;color:var(--ink-soft);font-size:11.5px;margin-top:2px;",
    "overflow-wrap:anywhere;word-break:break-word}",
    ".chip__copy{margin-top:4px;padding:2px 8px;border-radius:6px;font-size:11.5px;",
    "background:var(--ink);color:var(--paper,#fff);cursor:pointer}",
    ".chip__action{margin-top:6px;padding:3px 10px;border-radius:7px;font-size:11.5px;font-weight:600;",
    "background:var(--accent);color:var(--paper,#fff);cursor:pointer}",
    ".chip__action[disabled]{opacity:.6;cursor:default}",
    ".chip__x{width:20px;height:20px;border-radius:5px;color:var(--ink-soft);flex:none;",
    "display:flex;align-items:center;justify-content:center;font-size:13px}",
    ".chip__x:hover{background:rgba(0,0,0,.06);color:var(--ink)}",
    ".chip__count{font-variant-numeric:tabular-nums;color:var(--ink-faint);font-size:11px}",

    // THE ONE STATUS LINE: is the work stored, and has anything come back. Two
    // rows here used to answer those separately and could contradict each other
    // in front of the reviewer. Calm by default, because the healthy reading is
    // most of the reviewer's session and a rail that shouts through it is a rail
    // nobody reads by the third comment.
    ".statusline{display:flex;align-items:center;gap:8px}",
    ".status{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink-soft);flex:1;min-width:0}",
    ".status__dot{width:6px;height:6px;border-radius:50%;background:var(--ink-faint);flex:none}",
    ".status[data-status='stored'] .status__dot{background:var(--good)}",
    ".status[data-status='kept_locally'] .status__dot{background:var(--warn)}",
    ".status[data-agent='working'] .status__dot{background:var(--accent)}",
    // The quiet indicator is a dot's worth of difference, not a colour change
    // anyone has to decode: connected keeps the stored green, nobody connected
    // goes grey. Grey is not an alarm; nothing is waiting.
    ".status[data-agent='absent'] .status__dot{background:var(--ink-faint)}",
    // LOUD IS THE WAIT'S DOING. Last, so it wins over the calm rules above it:
    // an item nobody has answered in ten minutes, or one the machine can see
    // nothing has picked up, is the one thing on this line worth interrupting
    // for.
    ".status[data-loud='true']{color:var(--warn-ink,var(--ink));font-weight:600}",
    ".status[data-loud='true'] .status__dot{background:var(--warn)}",
    ".status__text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",

    // THE HOLD TOGGLE (docs/features/20260917.01_hold_toggle). Beside the
    // status line, not a new zone: this is already the rail's place for "state
    // of the conversation with the agent," and Hold is exactly that. A real
    // switch, drawn with the rail's own neutral tokens: pressed reads as a
    // filled pill on --sunken, the same surface the end-review panel's buttons
    // use for their own pressed state, never a new hue.
    ".holdrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
    ".holdbtn{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;",
    "color:var(--ink-soft);padding:3px 9px;border-radius:999px;border:1px solid var(--line);flex:none}",
    ".holdbtn:hover{background:var(--surface);color:var(--ink)}",
    ".holdbtn__dot{width:6px;height:6px;border-radius:50%;background:var(--ink-faint);flex:none}",
    ".holdbtn[aria-pressed='true']{background:var(--sunken);color:var(--ink);border-color:var(--line)}",
    ".holdbtn[aria-pressed='true'] .holdbtn__dot{background:var(--ink-soft)}",
    ".holdcount{font-size:11px;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;",
    "white-space:nowrap;flex:1;min-width:0}",
    ".holdcount:empty{display:none}",

    ".limit{font-size:11.5px;color:var(--ink-faint);line-height:1.4}",
    ".limit:empty{display:none}",

    // The refusal panel (D5): shown when this window lost the claim and is
    // read-only. It carries the reason and the one control that undoes it,
    // "Review here instead", which moves the review to this window.
    ".refusal{display:none;flex-direction:column;gap:8px;padding:11px 12px;border-radius:var(--radius-sm);",
    "background:var(--warn-wash);border:1px solid rgba(180,120,30,.28);margin-bottom:2px}",
    ".refusal[data-shown='true']{display:flex}",
    ".refusal__title{font-size:12px;font-weight:700;color:var(--warn);letter-spacing:.02em;",
    "display:flex;align-items:center;justify-content:space-between;gap:8px}",
    ".refusal__x{border:0;background:transparent;color:var(--ink-soft);font-size:14px;line-height:1;",
    "cursor:pointer;padding:0 2px}",
    ".refusal__x:hover{color:var(--ink)}",
    ".refusal__reason{font-size:11.5px;color:var(--ink-soft);line-height:1.45;",
    "overflow-wrap:anywhere;white-space:pre-wrap}",
    ".refusal__btn{align-self:flex-start;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;",
    "background:var(--accent);border:1px solid var(--accent);color:#fff;cursor:pointer}",
    ":host([data-lahe-scheme='dark']) .refusal__btn{color:#12151a}",
    ".refusal__btn:hover{filter:brightness(1.06)}",
    ".refusal__btn[disabled]{opacity:.6;cursor:default}",

    // The confirm before the door. There is no window.confirm anywhere in this
    // library: a browser dialog is the page's chrome, not the rail's, and it
    // cannot say what is unfinished. This can, which is the entire point of
    // asking (D10: ending is a deliberate act, and the reviewer should know
    // what they are ending on top of).
    ".endpanel{display:none;flex-direction:column;gap:7px;padding:11px 12px;border-radius:var(--radius-sm);",
    "background:var(--surface);border:1px solid var(--line);margin-bottom:2px}",
    ".endpanel[data-shown='true']{display:flex}",
    ".endpanel__title{font-size:12.5px;font-weight:700;color:var(--ink)}",
    ".endpanel__what{font-size:11.5px;color:var(--ink-soft);line-height:1.45}",
    ".endpanel__kept{font-size:11.5px;color:var(--ink-faint);line-height:1.45}",
    ".endpanel__kept:empty{display:none}",
    ".endpanel__acts{display:flex;align-items:center;gap:8px}",
    ".endpanel__go,.endpanel__no{font-size:12px;font-weight:550;padding:5px 11px;border-radius:7px;",
    "border:1px solid var(--line);background:var(--paper);color:var(--ink);cursor:pointer}",
    ".endpanel__go:hover,.endpanel__no:hover{background:var(--sunken)}",
    ".endpanel__go[disabled],.endpanel__no[disabled]{opacity:.6;cursor:default}",
    ".endpanel__go[hidden],.endpanel__no[hidden]{display:none}",

    // The keyboard hints are readable, not fine print (D10).
    ".hints{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11.5px;color:var(--ink-soft)}",
    ".hint{display:flex;align-items:center;gap:5px}",
    "kbd{font-family:inherit;font-size:11px;font-weight:600;color:var(--ink);",
    "background:var(--sunken);border:1px solid var(--line);border-bottom-width:2px;",
    "border-radius:5px;padding:1px 5px;letter-spacing:.01em}",

    // THE DOOR, BESIDE THE HINTS. Ending a review is the one control that
    // closes the session, so it is standing UI rather than a menu item: a
    // reviewer looking for the way out should not have to open a menu to find
    // it. The row keeps the hints on flex:1 so they wrap exactly as they did,
    // and the button is a narrow strip beside them, spanning both hint rows.
    // Its register is deliberately quiet, and never readable as a submit
    // button under the reviewer's own words.
    // The door is as tall as the whole bottom bar, not just the hints. Ken asked
    // for that and it is also what makes it read as a way OUT rather than one more
    // control in a row of them: it is the full height of the thing it closes.
    // .foot is the row now and .footmain is the column that used to be .foot, so
    // everything the footer stacks keeps stacking and the door sits beside all of
    // it. align-items:stretch is what gives the button its height.
    ".footmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px}",
    ".endbtn{flex:none;width:38px;display:flex;align-items:center;justify-content:center;",
    "border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--ink-soft);cursor:pointer}",
    ".endbtn:hover{background:var(--surface);color:var(--ink)}",
    ".endbtn[disabled]{opacity:.55;cursor:default}",
    ".endbtn svg{width:18px;height:18px;display:block}",

    // --- the collapsed pill --------------------------------------------------
    // It never overlaps the open rail because it only exists while the rail is
    // hidden. Two elements that are never on screen together cannot overlap.
    // right/bottom are the DEFAULT corner, not the only one. A reviewer can drag
    // the pill off it (see "Moving the pill out of the page's way"), and the
    // inline offsets that lands write over these.
    //
    // touch-action:none is what makes that possible on the device that needs it.
    // Without it the browser claims a finger drag as a scroll before the layer
    // sees a second pointermove, so the pill cannot be moved on a phone at all,
    // which is the only place anyone wanted to move it.
    ".pill{position:fixed;right:16px;bottom:16px;pointer-events:auto;display:flex;align-items:center;gap:8px;",
    "height:38px;padding:0 14px;border-radius:999px;background:var(--paper);color:var(--ink);",
    "border:1px solid var(--line);box-shadow:var(--shadow);font-size:12.5px;font-weight:550;",
    "touch-action:none;-webkit-user-select:none;user-select:none;cursor:grab}",
    ".pill[data-lahe-dragging]{cursor:grabbing;box-shadow:var(--shadow),0 0 0 1px var(--accent)}",
    ".pill[hidden]{display:none}",
    ".pill:hover{background:var(--surface)}",
    ".pill__dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}",
    ".pill__count{font-variant-numeric:tabular-nums;color:var(--ink-faint);font-weight:500}",
    ".pill__count[hidden]{display:none}",
    // THE PILL, LATE. The rail can be closed for most of a session, and the
    // banner is inside it. So the pill wears the late card's signal: the amber
    // border and ring, an amber dot, and the wait. No motion and no sound.
    ".pill__wait{display:none;font-variant-numeric:tabular-nums;font-weight:650;color:var(--warn)}",
    ".pill[data-lahe-late='true']{border-color:var(--warn);box-shadow:var(--shadow),0 0 0 1px var(--warn)}",
    ".pill[data-lahe-late='true'] .pill__dot{background:var(--warn)}",
    ".pill[data-lahe-late='true'] .pill__wait{display:inline}",
    // THE PILL, HELD (docs/features/20260917.01_hold_toggle). Neutral, on the
    // same tokens as the held card, and never at the same time as late above:
    // renderStatus shows held whenever it applies, because held is the more
    // actionable of the two ("you did this on purpose") and a card only ever
    // reads as held while Hold suppresses it from the overdue clock entirely.
    ".pill[data-lahe-held='true']{border-color:var(--line);box-shadow:var(--shadow),0 0 0 1px var(--line)}",
    ".pill[data-lahe-held='true'] .pill__dot{background:var(--ink-faint)}",
    ".pill[data-lahe-held='true'] .pill__wait{display:inline;color:var(--ink-soft)}",
    // THE JEWEL: the same number the Done tab badge carries, on the one surface
    // that is still on screen once the rail is put away. A reviewer works with
    // the rail collapsed, and a question or a refusal was badging a tab strip
    // nobody could see. Same accent, same size, same restraint as .newmark: no
    // motion, no pulsing, and nothing at all when the count is zero.
    ".pill__jewel{font-variant-numeric:tabular-nums;font-size:10px;font-weight:700;line-height:1;",
    "color:#fff;background:var(--accent);border-radius:999px;padding:2px 5px;min-width:14px;text-align:center}",
    ":host([data-lahe-scheme='dark']) .pill__jewel{color:#12151a}",
    ".pill__jewel[hidden]{display:none}",

    // --- the toast ------------------------------------------------------------
    // TOP RIGHT. Bottom-left was where it started and Ken kept nearly missing
    // it: the eye is not down there, and a notification that has to be hunted
    // for is a notification that gets hunted for later, which is the whole
    // problem this exists to solve. Top right is where a person looks for one.
    // right:16px here is the COLLAPSED case, which is the one the toast exists
    // for: nothing else is on screen, so the corner is free. With the rail open
    // the column is moved left of it from JS (placeToasts), because a rail the
    // reviewer can drag to most of the window is no longer something a toast
    // can politely sit on top of for a few seconds. The collapsed pill is
    // bottom-right, so there is nothing to collide with either way.
    //
    // It borrows nothing new: the card's own paper, the card's own border, the
    // accent rule the question block already uses down its left edge.
    ".toasts{position:fixed;top:16px;right:16px;pointer-events:none;display:flex;",
    "flex-direction:column;align-items:flex-end;gap:8px;",
    "width:min(560px,calc(100vw - 32px))}",
    ".toasts[hidden]{display:none}",
    ".toast{pointer-events:auto;width:100%;display:flex;align-items:flex-start;gap:8px;",
    "padding:10px 11px;background:var(--paper);color:var(--ink);text-align:left;",
    "border:1px solid var(--line);border-left:3px solid var(--accent);",
    "border-radius:var(--radius-sm);box-shadow:var(--shadow);cursor:pointer;",
    // SWIPED, NOT SELECTED. Ken: "because the toasts slide in like a Mac
    // notification, my inclination is to grab them with the mouse and slide
    // them back away ... of course that just highlights text and then opens the
    // card instead." A toast is chrome, nobody has ever wanted to copy half of
    // one, and a press that starts a text selection is a press that cannot
    // start a gesture. touch-action keeps vertical scrolling the page's, and
    // takes the horizontal axis for the swipe.
    "-webkit-user-select:none;user-select:none;touch-action:pan-y}",
    ".toast:hover{background:var(--surface)}",
    ".toast[data-lahe-dragging='true']{cursor:grabbing;box-shadow:var(--shadow),0 0 0 1px var(--accent)}",

    // THE MOVEMENT IS THE POINT. A toast that fades in place is a thing that was
    // always there; a toast that arrives from the edge is a thing that just
    // happened, and the reviewer's eye goes to it without being asked to. It
    // slides in from the right, which is the edge it is anchored to, so the
    // motion reads as "this came in" rather than as decoration.
    //
    // Transform and opacity only: neither one costs a layout, so a page with its
    // own scroll and resize handlers is untouched by a toast arriving.
    "@keyframes lahe-toast-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}",
    "@keyframes lahe-toast-fade{from{opacity:0}to{opacity:1}}",
    ".toast{animation:lahe-toast-in 200ms cubic-bezier(.2,.7,.3,1) both}",
    // Going: shorter than arriving, and pointer-events off the moment it starts,
    // so a half-faded toast can never eat a click meant for the page under it.
    // The node itself is removed when the fade ends (see dismissToast); this
    // never leaves a transparent box sitting over the page.
    ".toast[data-lahe-leaving='true']{opacity:0;transform:translateX(24px);pointer-events:none;",
    "transition:opacity 120ms ease-in,transform 120ms ease-in}",
    // Someone who asked their machine for less motion gets a plain fade, and
    // nothing slides. The toast still arrives and still leaves.
    "@media (prefers-reduced-motion:reduce){",
    ".toast{animation:lahe-toast-fade 160ms ease-out both}",
    ".toast[data-lahe-leaving='true']{transform:none;transition:opacity 120ms ease-in}}",
    ".toast__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}",
    ".toast__label{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;",
    "color:var(--accent-ink)}",
    // The whole answer, not the first two lines of it. Ken's first day with the
    // toast: a clamped answer sent him to the rail anyway, which is the trip the
    // toast exists to save. The box grows down to fit; tab_done's TOAST_TEXT_MAX
    // is the ceiling that keeps an essay from becoming a wall.
    // 15px, up from 13: Ken read toasts from a laptop on his lap and had to
    // pull the screen to his face. A toast is read from farther away than the
    // rail, so it is set a size larger than the card text (2026-09-11).
    ".toast__text{font-size:15px;line-height:1.45;color:var(--ink);overflow-wrap:anywhere;",
    "white-space:pre-line}",
    // One line, quieter: this is what the answer is ABOUT, not the answer.
    ".toast__about{font-size:12.5px;line-height:1.35;color:var(--ink-soft);",
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".toast__about:empty{display:none}",
    ".toast__x{flex:none;width:20px;height:20px;border-radius:6px;color:var(--ink-faint);",
    "display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1}",
    ".toast__x:hover{background:var(--sunken);color:var(--ink)}",
    // pointer-events STAYS off: it is a count, there is nothing to press on it,
    // and a line of text that swallows clicks is exactly the kind of guest this
    // tool must not be on someone else's page.
    ".toast__more{pointer-events:none;font-size:11px;color:var(--ink-faint);padding:0 4px}",
    ".toast__more[hidden]{display:none}"
  ].join("");

  // How long a toast that is not a question stays on screen. ONE number, named
  // once: everything that auto-dismisses reads it, and a test shortens it
  // through the rail's toastDuration rather than by waiting ten seconds.
  var TOAST_MS = 10000;
  // How many stand at once before the rest collapse into a count. Four toasts
  // stacked up the side of a page is a second rail, which is the thing the
  // reviewer already closed.
  var TOAST_MAX = 3;
  // The gap the toast column keeps from the open rail's left edge, and the
  // narrowest the column may be squeezed to on the way to making that gap.
  var TOAST_RAIL_GAP = 8;
  var TOAST_MIN_WIDTH = 220;
  // Two presses of the grip closer together than this are one double press,
  // which puts the rail back to its default width.
  var GRIP_DOUBLE_MS = 400;
  // How long the going-away fade runs. The CSS owns the animation; JS knows this
  // number for one reason only, which is when to take the node out of the DOM.
  // It matches the transition in the .toast[data-lahe-leaving] rule above.
  var TOAST_OUT_MS = 120;
  // Why a toast left, told to whoever put it up. The reviewer pressing the X is
  // a decision about that message; the clock running out is not.
  var TOAST_GONE = { USER: "user", TIMEOUT: "timeout", REPLACED: "replaced" };

  // ---------------------------------------------------------------------------
  // Swipe to dismiss: the numbers, and the one decision
  // ---------------------------------------------------------------------------
  //
  // The toast arrives from the right edge like a notification, so a reviewer's
  // hand reaches to push it back the way it came. That gesture has to mean the
  // same thing the X means, or it is a trap: the reviewer thinks they have
  // dealt with the message and the tool thinks they have not.

  // How far a pointer travels before this is a drag rather than a press. Small
  // enough that a deliberate push is recognized at once, large enough that the
  // shake in a click still opens the card.
  var TOAST_SWIPE_SLOP = 6;
  // The far end of the throw: the smaller of a share of the toast's own width
  // and a flat ceiling, so a narrow toast is not harder to dismiss than a wide
  // one and a very wide one does not demand an arm's length of travel.
  var TOAST_SWIPE_FRACTION = 0.4;
  var TOAST_SWIPE_MAX_PX = 120;
  // A flick: rightward pixels per millisecond at the moment of release. Half a
  // pixel per millisecond is 500px a second, which is a deliberate throw and
  // not a slow drag that changed its mind.
  var TOAST_FLING_SPEED = 0.5;
  // And how far it has to have gone before speed is allowed to decide anything.
  //
  // The flick is a shortcut past the full throw, not a way to dismiss a message
  // with a twitch. A hand that moves twenty pixels and stops has changed its
  // mind, however fast those twenty pixels were, and reading that as a throw
  // loses an answer the reviewer never saw. Four times the dead zone is the
  // distance at which a push is plainly a push.
  var TOAST_FLING_MIN_PX = 24;
  // The shortest stretch of travel a speed can honestly be read off.
  //
  // Pointer moves do not arrive one per frame. They are coalesced, and how they
  // are coalesced is the engine's business: WebKit and Firefox both deliver
  // several inside the same millisecond. Dividing one of those deltas by the
  // millisecond it took says 4px per ms for a hand that moved 20px in total and
  // then stopped, which is how a drag a reviewer changed their mind about got
  // read as a throw. Measuring across a frame's worth of time instead makes the
  // number mean what it says, and a gesture too short to hold a frame simply
  // has no speed: the distance decides it, which is the honest answer.
  var SWIPE_VELOCITY_WINDOW_MS = 12;
  // The slide off the edge, matched to TOAST_OUT_MS so the node is taken out of
  // the DOM exactly as it finishes leaving.
  var TOAST_SPRING_MS = 160;

  /**
   * Fold one pointer move into the running speed of a swipe.
   *
   * Pure apart from the sampler it is handed: it keeps the last sample that was
   * far enough back in time to divide by, and leaves the speed alone until the
   * next one is. A sampler is { lastX, lastAt, velocity }.
   *
   * @param {object} sampler  carried across the moves of one gesture
   * @param {number} x        where the pointer is now, in client px
   * @param {number} at       when, in ms
   * @returns {number} the speed to judge the gesture by, px per ms
   */
  function sampleSwipeVelocity(sampler, x, at) {
    if (!sampler) return 0;
    var since = at - sampler.lastAt;
    if (!(since >= SWIPE_VELOCITY_WINDOW_MS)) return sampler.velocity || 0;
    sampler.velocity = (x - sampler.lastX) / since;
    sampler.lastX = x;
    sampler.lastAt = at;
    return sampler.velocity;
  }

  /** How far this toast has to travel to count as thrown away. */
  function toastSwipeThreshold(width) {
    var w = typeof width === "number" && width > 0 ? width : 0;
    return Math.max(TOAST_SWIPE_SLOP, Math.min(TOAST_SWIPE_MAX_PX, w * TOAST_SWIPE_FRACTION));
  }

  /**
   * Did that gesture mean "get rid of this"?
   *
   * Pure, and the whole of the decision, so the feel can be argued about in a
   * unit test rather than by dragging things in a browser. Two ways to say yes,
   * because two hands say it differently: the patient one drags it most of the
   * way across, and the quick one flicks it and lets go early.
   *
   * Rightward only. The toast came from the right edge and goes back to it;
   * a leftward drag is not a dismissal in any direction anyone means.
   *
   * @param {object} gesture
   * @param {number} gesture.dx        how far right of where it started, px
   * @param {number} gesture.velocity  px per ms at release, rightward positive
   * @param {number} gesture.width     the toast's own width
   */
  function shouldDismissSwipe(gesture) {
    var g = gesture || {};
    var dx = typeof g.dx === "number" ? g.dx : 0;
    if (dx <= TOAST_SWIPE_SLOP) return false;
    if (dx >= toastSwipeThreshold(g.width)) return true;
    if (dx < TOAST_FLING_MIN_PX) return false;
    var velocity = typeof g.velocity === "number" ? g.velocity : 0;
    return velocity >= TOAST_FLING_SPEED;
  }

  // The review-level actions, in the head's menu. They are the same two the
  // footer used to stand up as buttons, and they run through the same
  // runAction seam, so what they DO is still boot's business (D10, revised).
  //
  // The third is not one of those. Present is the rail's OWN state rather than
  // work for boot to do, so it is handled where it is drawn (see the menu item
  // click, and setPresenting). Its label carries the chord, because pressing it
  // takes every surface off the screen and the chord is the way back.
  var PRESENT = {
    ACTION: "present",
    KEYS: "Cmd-Shift-X",
    LABEL: "Hide for presenting",
    // What the rail's own footer teaches. The chord is the ONLY way back, and
    // the reviewer has to know that before they use it, not after.
    MENU_LABEL: "Hide for presenting (Cmd-Shift-X)"
  };

  // What the collapsed pill says on hover. It carries the chord for the same
  // reason the Present menu item does: the pill is the one control a reviewer
  // sees when the panel is away, so it is where they find out there is a key
  // for it.
  var PILL_TITLE = "Open the review panel (Cmd-Shift-1)";

  // Folding every card at once, like Present below, is the rail acting on
  // ITSELF: there is no work for boot to do and no action for a caller to
  // register, so these two are handled where they are drawn. They act on the
  // tab that is open, because that is the list the reviewer is looking at.
  var FOLD_ALL = { COLLAPSE: "collapse-cards", EXPAND: "expand-cards" };

  var MENU_ITEMS = [
    { action: "copy", label: "Copy review" },
    { action: "export", label: "Export review to file" },
    { action: FOLD_ALL.COLLAPSE, label: "Collapse all cards" },
    { action: FOLD_ALL.EXPAND, label: "Expand all cards" },
    { action: PRESENT.ACTION, label: PRESENT.MENU_LABEL }
  ];

  // ---------------------------------------------------------------------------
  // The way out (D10: a review ends when the reviewer chooses End review)
  // ---------------------------------------------------------------------------
  //
  // The words live here with the rest of the rail's words, so a test can read
  // them without a browser and nothing spells them twice.
  //
  // The register is quiet, not a submit button. Ending a review is a
  // deliberate act, and the rail's job at that moment is to say what is
  // still unfinished, not to hurry the reviewer through it.
  var END_REVIEW = {
    // Both the tooltip and the accessible name, deliberately the same sentence.
    LABEL: "End this review and perform cleanup",
    TITLE: "End this review?",
    ENDED_TITLE: "Review ended",
    NOTHING_PENDING: "Nothing is waiting on an agent.",
    // Always under the count, because the reviewer's real question at the door
    // is whether ending costs them anything.
    KEPT: "Your work is kept either way. Ending closes the review and shows your hand edits.",
    CONFIRM: "End review",
    CANCEL: "Keep reviewing",
    CLOSE: "Close",
    WORKING: "Ending…",
    // The heading already says "Review ended", so these do not repeat it. A panel
    // whose first two words restate its own title reads as filler and costs the
    // reviewer the one line that could have told them something (Ken, 2026-08-24).
    ENDED: "Your work is saved.",
    ENDED_WITH_LIST: "Your hand edits are under Edits, and saved to a file.",
    ENDED_NO_EDITS: "You made no hand edits this session.",
    UNSENT:
      "Some of your typing had not reached the helper yet. It is kept in this browser and goes out on the next load.",
    FAILED: "The review was not ended: "
  };

  // The exit sign, drawn rather than typed: a figure stepping through a
  // doorway. An emoji would be the page's font at the page's size and reads
  // differently on every platform; this is the rail's own stroke weight and
  // the rail's own colour, and it is the one piece of iconography in the
  // footer, so it has to say what it is with no label beside it.
  // Heroicons 2.2.0 `arrow-right-start-on-rectangle`, MIT, vendored under
  // vendor/heroicons with its licence and the file the path came from. It is the
  // set's own exit glyph: a doorway with an arrow leaving through it.
  //
  // The path is inlined rather than loaded, because the library is one built file
  // with no runtime fetches, and it is a copy rather than a drawing so the next
  // person can diff it against a newer Heroicons release. The stroke is left to
  // the rail (currentColor, and the rail's own weight) instead of Heroicons'
  // slate, so the door matches the footer it sits in.
  var EXIT_ICON_PATH =
    "M15.75 9V5.25C15.75 4.00736 14.7426 3 13.5 3L7.5 3C6.25736 3 5.25 4.00736 " +
    "5.25 5.25L5.25 18.75C5.25 19.9926 6.25736 21 7.5 21H13.5C14.7426 21 15.75 " +
    "19.9926 15.75 18.75V15M18.75 15L21.75 12M21.75 12L18.75 9M21.75 12L9 12";
  var END_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="' + EXIT_ICON_PATH + '"/>' +
    "</svg>";

  /** One line: no newlines, no runs of spaces, nothing on either end. */
  function oneLine(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Cut a sentence to length, at a word.
   *
   * At a word because the alternative reads as a typo: "cut this to one senten"
   * looks like something went wrong, and the reviewer stops to work out what.
   * A single word longer than the whole line still has to end somewhere, so that
   * one case is cut where it lands.
   *
   * @param {string} text
   * @param {number} max the most characters to keep, before the ellipsis
   * @returns {string}
   */
  function clipAtWord(text, max) {
    var value = oneLine(text);
    var limit = typeof max === "number" && max > 0 ? max : COLLAPSED_LINE_MAX;
    if (value.length <= limit) return value;
    var head = value.slice(0, limit + 1);
    var space = head.lastIndexOf(" ");
    var kept = space > 0 ? head.slice(0, space) : value.slice(0, limit);
    return kept.replace(/[\s,.;:!?-]+$/, "") + "…";
  }

  /**
   * What a folded card says it is about, from the record alone.
   *
   * ONE SOURCE PER KIND, and the reason is that the reviewer is scanning:
   *
   *   a comment      the QUOTE. The passage is what they are looking for; their
   *                  own note is what they wrote about it, and they already know
   *                  what they wrote
   *   an edit        the CHANGE sentence, which is the edit said in words. The
   *                  before-and-after is the detail, and detail is what folding
   *                  puts away
   *   a page note    the NOTE, because a note tethered to nothing has no quote
   *                  to stand in for it
   *
   * Each falls through to the others rather than to nothing: a card with an
   * empty line is a card the reviewer cannot tell from the one above it.
   *
   * Pure: item in, one line out, no card and no document required.
   *
   * @param {object} item the record
   * @param {number} [max] characters, before the ellipsis
   * @returns {string}
   */
  function collapsedLineText(item, max) {
    if (!item) return "";
    var kind = item[record.FIELD.KIND];
    var context = item[record.FIELD.CONTEXT] || {};
    var quote = oneLine(context.quote);
    var change = oneLine(item[record.FIELD.CHANGE]);
    // The reviewer's own words, never the tool's: see record.reviewerNote.
    var note = oneLine(record.reviewerNote(item));
    var picked;
    if (kind === record.KIND.NOTE) picked = note || quote || change;
    else if (kind === record.KIND.EDIT || kind === record.KIND.FORMAT_ONLY || kind === record.KIND.DELETE) {
      picked = change || quote || note;
    } else picked = quote || note || change;
    return clipAtWord(picked, max);
  }

  /**
   * What is unfinished, counted off the reviewer's own records.
   *
   * Two numbers, because they are two different problems. An UNANSWERED item is
   * work an agent has not come back on. A DRAFT is worse in a quieter way: it
   * is invisible to every agent (R7), so a review that ends with drafts in it
   * ends with work nobody will ever see.
   */
  function endReviewCounts(items) {
    var out = { unanswered: 0, drafts: 0 };
    (items || []).forEach(function (item) {
      if (!item) return;
      if (item[record.FIELD.STATE] === record.STATE.DRAFT) out.drafts += 1;
      else if (record.isUnansweredReady(item)) out.unanswered += 1;
    });
    return out;
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  /** The one sentence the confirm panel leads with. Never silent about a count. */
  function unfinishedSentence(counts) {
    var c = counts || {};
    var unanswered = c.unanswered || 0;
    var drafts = c.drafts || 0;
    var waiting =
      unanswered +
      " " +
      plural(unanswered, "item is", "items are") +
      " still waiting on an agent";
    var unsent =
      drafts +
      " " +
      plural(drafts, "draft has", "drafts have") +
      " not been marked ready, so no agent has seen " +
      plural(drafts, "it", "them");
    if (unanswered && drafts) return waiting + ", and " + unsent + ".";
    if (unanswered) return waiting + ".";
    if (drafts) return unsent[0].toUpperCase() + unsent.slice(1) + ".";
    return END_REVIEW.NOTHING_PENDING;
  }

  var HINTS = [
    { keys: ["⌘", "⇧", "C"], what: "comment" },
    { keys: ["⌘", "⇧", "E"], what: "edit" },
    { keys: ["⌘", "⏎"], what: "send" }
  ];

  /**
   * The page's own setInterval, bound to it, or null when there is no page.
   *
   * Bound because a bare `window.setInterval` called as a free function is an
   * illegal invocation in some engines, and taken from the document's own view
   * rather than a global so a rail mounted in another document uses that
   * document's clock.
   */
  function timersFrom(doc) {
    var view = doc && doc.defaultView ? doc.defaultView : null;
    if (!view || typeof view.setInterval !== "function") return null;
    return {
      setInterval: function (fn, ms) { return view.setInterval(fn, ms); },
      clearInterval: function (handle) { return view.clearInterval(handle); }
    };
  }

  function createRail(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var store = opts.store || null;
    var reviewId = opts.reviewId || null;
    // The library's ONE page-level host is highlight.js's surface, and the rail
    // mounts inside it rather than adding a second element to the page. The
    // default is the shared instance for the same reason: two instances would
    // be two hosts.
    var highlights = opts.highlights || highlightModule.shared;
    // The clock and the timer source, as seams. A test drives the agent line's
    // age without sleeping for a minute, and a page with no document (Node) gets
    // no timers at all.
    var now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
    var timers = opts.timers || timersFrom(doc);
    // Where the handoff message is copied to. A seam for the same reason the
    // clock is one: a test holds the write without a real clipboard.
    var clipboardOverride = opts.clipboard || null;
    // Where the notices already raised are remembered for this tab, so a reload,
    // a remount or the next page of a folder review does not raise them again.
    // A seam so a test can hand two rails the same storage.
    var sessionStorageOverride = opts.sessionStorage || null;
    // Was the banner up at the last repaint? A notice is raised only when this
    // goes from false to true.
    var overdueShown = false;
    // What the banner last said about the copy, so a repaint keeps it.
    var handoffNote = "";
    var handoffFailed = false;

    var cards = Object.create(null);
    var cardSequence = 0;
    var chips = [];
    var dismissed = Object.create(null);
    var status = null;
    var activeTab = TAB.ACTIVE;
    // tab -> how many things in it the reviewer has not looked at yet. Held as
    // state rather than painted imperatively, for the reason the refusal is: a
    // remount rebuilds the tab strip and an imperative badge would vanish with
    // the old dom while the fact it stood for was still true.
    var tabNewCounts = Object.create(null);
    // Who wants to know the reviewer moved to a tab. This is how the Done tab
    // learns to mark its replies seen without this file knowing what a reply is.
    var tabSelectHandlers = [];
    // Who wants to know the rail was collapsed or opened again. Same seam as
    // onTabSelect and for the same reason: collapsing the rail ENDS the visit to
    // whatever tab was open, and the Done tab has per-visit state to drop when
    // that happens. This file still knows nothing about replies.
    var collapseHandlers = [];
    // Who wants to know a card was clicked. The rail decides what counts as a
    // click on the CARD (rather than on a control inside it, or a text
    // selection); what to DO about it, which is finding the passage on the page,
    // belongs to whoever knows about anchors. See onCardActivate.
    var cardActivateHandlers = [];
    // Who wants to know a card was folded or opened. Same seam as onTabSelect,
    // and there for the same reason: EXPANDING A CARD IS READING IT, and the
    // Done tab is the file that knows what that means for a reply.
    var cardCollapseHandlers = [];
    // id -> true for the cards the reviewer folded to one line. Only the folded
    // ones are held; an absent id is an open card, which is also the right
    // answer for a card that does not exist yet. Read from the review's own
    // preferences, so a reload finds the same shape of list.
    var collapsedCards = readCardCollapsePreference();
    // Where the pointer went down, so a drag that ends inside a card is read as
    // a drag and not as a click.
    var pressPoint = null;
    // A person's choice, separate from the rail's momentary visibility. A
    // second-window refusal has to open the rail so its remedy is visible, but
    // that forced opening must not erase the choice to keep the rail collapsed.
    var preferredCollapsed = readCollapsedPreference();
    var collapsed = preferredCollapsed;
    // PRESENT MODE: the whole library off the screen, and still working.
    //
    // Ken: "sometimes during a presentation there will not be LAHE on there,
    // but during class it's nice if I can talk to the AI through the deck. I
    // might want a way to hide the pill for the chat rail."
    //
    // So this is HIDDEN, not off. Sync keeps polling and folding, the window
    // claim and its heartbeat carry on, and replies that arrive during the talk
    // are waiting as toasts the moment the reviewer comes back. What goes is
    // everything anyone in the room can see: the rail, the pill, the toasts,
    // the boxes, and every wash on the page (highlight.setHidden does both
    // halves in one call).
    //
    // The page starts hidden two ways: the reviewer chose it last time (the
    // preference below, so a reload mid-talk stays hidden), or the page always
    // wants to (data-lahe-start="hidden", which boot passes in).
    var presenting = opts.present === true || readPresentPreference();
    var presentHandlers = [];
    // How wide the reviewer dragged the rail, or null while they have left it
    // at its default. Held UNCLAMPED: the clamp belongs to the viewport that is
    // on screen right now, and a window dragged narrow and then wide again
    // gives the reviewer their own width back rather than the one the small
    // window forced.
    var railWidth = readWidthPreference();
    // Who wants to know the rail's width changed. The surfaces that keep clear
    // of the rail read the published allowance instead (see publishRailAllowance);
    // this is for a caller that wants to hear about it rather than measure.
    var widthHandlers = [];
    // The drag in progress, or null. Holds the width the drag started from, so
    // Escape can put it back.
    var gripDrag = null;
    // When the grip was last pressed, for the double-press that resets the
    // width. Read from pointerdown rather than from a dblclick event: the drag
    // calls preventDefault on pointerdown, and what a browser does with the
    // compatibility mouse events after that is not something to bet a control on.
    var gripPressedAt = 0;
    var mounted = false;
    var limitText = null;
    // The whole agent_liveness object the helper last sent, or null before one
    // has arrived. Held rather than reduced to a string, because the unattended
    // line wants the oldest item's age too, and because that age is recomputed
    // on every paint rather than frozen into the text once.
    var agentLiveness = null;
    // The slow repaint for that age, running only while an age is on screen.
    var agentAgeTimer = null;
    // The refusal is STATE, not a one-shot paint. A Turbo app remounts the rail
    // on its first navigation, and a refusal painted imperatively vanished with
    // the old dom while the (stateful) chip survived: the reviewer read a chip
    // telling them to press a button that no longer existed (first-real-use
    // finding, 2026-08-14). Mount re-applies it like every other piece of state.
    var refusalInfo = null;
    // The end-review confirm. Deliberately NOT re-applied by mount, unlike the
    // refusal above: a rebuild of the page mid-question is the reviewer being
    // taken somewhere else, and a dialog that survives it is a dialog answering
    // a question they can no longer see. The button that raises it is chrome and
    // comes back with every mount.
    var endPrompt = null;
    var endResolve = null;
    var endRun = null;
    var endRunning = false;
    var actionHandlers = Object.create(null);
    // The head menu is OPEN or not, and open is a moment rather than a piece of
    // rail state: the button is chrome and comes back with every mount, the
    // open menu does not, which is what a transient overlay should do.
    var menuOpen = false;
    // Removed the moment the menu closes, so the page carries no listener of
    // ours while nothing is open.
    var menuOutsideListener = null;
    var menuShadowListener = null;

    // The DOM, all of it, or all nulls when there is no document (Node).
    var dom = null;
    // The viewport clamp's two window listeners, held so unmount can take them
    // off again. They are the rail's, they are bound on mount, and a rail is
    // rebuilt every time the page throws the overlay root away (index.js's
    // ensureRoot): two more per rebuild, for the life of the page, was a real
    // accumulation on a page that rebuilds all session (the 2026-09-16 memory
    // audit). See mount, where it is bound, and unmount, where it goes.
    var viewportClamp = null;
    // Cards whose pane changed while they held focus. Re-parenting a focused
    // element blurs it, so the move waits for focus to leave.
    var pendingPlacement = Object.create(null);

    // -------------------------------------------------------------------------
    // Mount
    // -------------------------------------------------------------------------

    function el(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = text;
      return node;
    }

    function mount(mountOptions) {
      var mo = mountOptions || {};
      if (mounted) {
        // A remount over a rail that is already up still puts the menu away: a
        // menu is a moment, and the page under it has just been rebuilt.
        closeMenu(false);
        return { rootId: markers.OVERLAY_ROOT_ID, remounted: false };
      }
      mounted = true;
      loadChips();
      if (!doc || !doc.body) return { rootId: markers.OVERLAY_ROOT_ID, headless: true };

      // The page-level host is highlight.js's, created once, id
      // markers.OVERLAY_ROOT_ID. This file adds NOTHING to the page: it mounts
      // its own scope element inside that surface's closed root, and the rail's
      // CSS (:host{all:initial}, the tokens) applies to that scope rather than
      // to the shared host it does not own.
      var surface = highlights.surface();
      var surfaceRoot = surface.root || surface.host;
      if (!surfaceRoot) return { rootId: markers.OVERLAY_ROOT_ID, headless: true };

      var host = doc.createElement("div");
      markers.markChrome(host);
      // The scheme the rail draws in, taken from the PAGE's own background
      // rather than the OS (highlight.js decides; the rail only wears it).
      host.setAttribute(highlightModule.SCHEME_ATTR, highlights.pageScheme());
      // CLOSED, per D8. Nothing outside the library can reach in, which is also
      // why this module answers holdsFocus and activeElementInfo itself.
      var shadow = host.attachShadow({ mode: "closed" });
      // The page's own keyboard shortcuts do not reach the rail's text fields:
      // the card's editable note, the follow-up composers, the page note. The
      // surface root outside this one is fenced too, and that is not enough,
      // because THIS root is closed as well: a listener out there sees the host
      // div as both target and composedPath()[0], never the field. The whole
      // reasoning, and the measurement, are at highlight.fenceTypingKeys.
      highlightModule.fenceTypingKeys(shadow);

      var style = doc.createElement("style");
      style.textContent = CSS;
      shadow.appendChild(style);

      var rail = el("aside", "rail");
      rail.setAttribute("aria-label", "Review");

      // The handle that widens the rail. A separator rather than a button: it
      // does not do a thing when it is pressed, it divides the page from the
      // panel, and a screen reader reading "Resize the review panel, separator,
      // 392" is reading what it actually is. Focusable so the same move is
      // available without a pointer.
      var grip = el("div", "grip");
      markers.markChrome(grip);
      grip.setAttribute("role", "separator");
      grip.setAttribute("aria-orientation", "vertical");
      grip.setAttribute("aria-label", RAIL_GRIP_LABEL);
      grip.setAttribute("aria-valuemin", String(RAIL_MIN_WIDTH));
      grip.tabIndex = 0;
      grip.title = RAIL_GRIP_LABEL;
      rail.appendChild(grip);

      var head = el("div", "head");
      head.appendChild(el("span", "mark"));
      head.appendChild(el("span", "title", "Review"));
      head.appendChild(el("span", "review", reviewId || ""));
      head.appendChild(el("span", "spacer"));

      // The review's own actions, behind one quiet control beside the collapse
      // arrow. Nothing here decides what Copy or Export DO: each item runs the
      // same runAction seam the footer's buttons ran, so boot's wiring is
      // untouched by the move.
      var menuWrap = el("div", "menuwrap");
      var menuBtn = el("button", "iconbtn", "⋯");
      menuBtn.setAttribute("type", "button");
      menuBtn.setAttribute("aria-label", "More actions");
      menuBtn.setAttribute("aria-haspopup", "menu");
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.title = "More actions";
      var menuList = el("div", "menu");
      menuList.setAttribute("role", "menu");
      menuList.setAttribute("aria-label", "More actions");
      menuList.hidden = true;
      var menuItems = MENU_ITEMS.map(function (entry) {
        var item = el("button", "menuitem", entry.label);
        item.setAttribute("type", "button");
        item.setAttribute("role", "menuitem");
        item.setAttribute("data-action", entry.action);
        item.tabIndex = -1;
        item.addEventListener("click", function () {
          // Closed first, so the reviewer's click leaves nothing hanging over
          // the rail while the work runs, and the focus goes back where they
          // left it.
          closeMenu(true);
          // Present is the rail putting ITSELF away, so there is no action for
          // a caller to register and none to forget: the two review-level items
          // beside it are work only boot knows how to do, and this one is not.
          if (entry.action === PRESENT.ACTION) {
            setPresenting(true);
            return;
          }
          if (entry.action === FOLD_ALL.COLLAPSE || entry.action === FOLD_ALL.EXPAND) {
            setCardsCollapsed(currentTab(), entry.action === FOLD_ALL.COLLAPSE);
            return;
          }
          runAction(entry.action);
        });
        menuList.appendChild(item);
        return item;
      });
      menuBtn.addEventListener("click", function () {
        toggleMenu();
      });
      menuBtn.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          openMenu(event.key === "ArrowUp" ? menuItems.length - 1 : 0);
        }
      });
      menuList.addEventListener("keydown", function (event) {
        onMenuKey(event);
      });
      menuWrap.appendChild(menuBtn);
      menuWrap.appendChild(menuList);
      head.appendChild(menuWrap);

      var collapseBtn = el("button", "iconbtn", "→");
      collapseBtn.setAttribute("aria-label", "Collapse the rail");
      collapseBtn.title = "Collapse the rail";
      collapseBtn.addEventListener("click", function () {
        collapse(true);
      });
      head.appendChild(collapseBtn);
      rail.appendChild(head);

      // THE OVERDUE BANNER, at the top where it is read first. Built once and
      // shown or hidden by renderWaitBanner, like every other piece of chrome.
      var late = el("div", "late");
      late.setAttribute("role", "alert");
      late.setAttribute("data-lahe-late-banner", "true");
      var lateTitle = el("div", "late__title", "");
      var lateCheck = el("div", "late__check", AGENT_PROMINENT.CHECK);
      var lateBtn = el("button", "late__btn", AGENT_PROMINENT.HANDOFF_BUTTON);
      lateBtn.setAttribute("type", "button");
      lateBtn.addEventListener("click", function () {
        copyHandoff();
      });
      var lateNote = el("div", "late__note", "");
      lateNote.setAttribute("aria-live", "polite");
      var lateMessage = el("div", "late__message", "");
      late.appendChild(lateTitle);
      late.appendChild(lateCheck);
      late.appendChild(lateBtn);
      late.appendChild(lateNote);
      late.appendChild(lateMessage);
      rail.appendChild(late);

      var tabs = el("div", "tabs");
      tabs.setAttribute("role", "tablist");
      var tabButtons = Object.create(null);
      var counts = Object.create(null);
      var newmarks = Object.create(null);
      TABS.forEach(function (name) {
        var button = el("button", "tab");
        button.setAttribute("role", "tab");
        button.setAttribute("data-tab", name);
        button.appendChild(el("span", null, TAB_LABEL[name]));
        var count = el("span", "count", "0");
        button.appendChild(count);
        var newmark = el("span", "newmark", "");
        newmark.setAttribute("data-tab-new", name);
        newmark.hidden = true;
        button.appendChild(newmark);
        button.addEventListener("click", function () {
          selectTab(name);
        });
        tabs.appendChild(button);
        tabButtons[name] = button;
        counts[name] = count;
        newmarks[name] = newmark;
      });
      rail.appendChild(tabs);

      var panes = el("div", "panes");
      var paneNodes = Object.create(null);
      TABS.forEach(function (name) {
        var pane = el("div", "pane");
        pane.setAttribute("data-pane", name);
        pane.setAttribute("role", "tabpanel");
        pane.appendChild(el("div", "empty", emptyTextFor(name)));
        panes.appendChild(pane);
        paneNodes[name] = pane;
      });
      rail.appendChild(panes);

      var foot = el("div", "foot");
      var footMain = el("div", "footmain");
      var chipList = el("div", "chips");
      footMain.appendChild(chipList);

      // The refusal panel (D5, finding 12). Hidden until this window is refused;
      // its button re-claims the review with a takeover.
      var refusal = el("div", "refusal");
      refusal.setAttribute("role", "note");
      var refusalTitle = el("div", "refusal__title", "This review is open in another window");
      var refusalReason = el("div", "refusal__reason", "");
      var refusalBtn = el("button", "refusal__btn", "Review here instead");
      refusalBtn.setAttribute("type", "button");
      refusalBtn.addEventListener("click", function () {
        runAction("takeover");
      });
      // A WAY OUT. hideRefusal used to be reachable only from the way out of
      // read-only, so a panel painted on a window that was NOT read-only stood
      // there forever over a page the reviewer could still edit. The reviewer
      // gets to close it; a real refusal paints it again on the next claim.
      var refusalDismiss = el("button", "refusal__x", "×");
      refusalDismiss.setAttribute("type", "button");
      refusalDismiss.setAttribute("aria-label", "Dismiss");
      refusalDismiss.addEventListener("click", function () {
        hideRefusal();
      });
      refusalTitle.appendChild(refusalDismiss);
      refusal.appendChild(refusalTitle);
      refusal.appendChild(refusalReason);
      refusal.appendChild(refusalBtn);
      footMain.appendChild(refusal);

      // ONE ROW. There used to be a second one under it with its own claim about
      // agents, and the two contradicted each other in front of the reviewer
      // (Ken, live, 2026-08-23). Whether the work is stored and what the agent
      // has done with it are one sentence, because they are one question.
      var statusLineWrap = el("div", "statusline");
      var statusRow = el("div", "status");
      statusRow.setAttribute("role", "status");
      var statusDot = el("span", "status__dot");
      statusRow.appendChild(statusDot);
      var statusText = el("span", "status__text", "Kept in this browser");
      statusRow.appendChild(statusText);
      statusLineWrap.appendChild(statusRow);
      footMain.appendChild(statusLineWrap);

      // HOLD (docs/features/20260917.01_hold_toggle). Beside the status line,
      // the rail's existing place for "state of the conversation with the
      // agent." A real switch: aria-pressed says whether it is on, and the
      // count beside it is an aria-live region so a screen-reader reviewer is
      // told the count changed without polling the button.
      var holdRow = el("div", "holdrow");
      var holdBtn = el("button", "holdbtn");
      holdBtn.setAttribute("type", "button");
      holdBtn.setAttribute("aria-pressed", "false");
      holdBtn.setAttribute("aria-label", HOLD_LABEL);
      holdBtn.title = HOLD_LABEL;
      holdBtn.appendChild(el("span", "holdbtn__dot"));
      holdBtn.appendChild(el("span", null, HOLD_LABEL));
      holdBtn.addEventListener("click", function () {
        toggleHeld();
      });
      holdRow.appendChild(holdBtn);
      var holdCount = el("span", "holdcount", "");
      holdCount.setAttribute("aria-live", "polite");
      holdRow.appendChild(holdCount);
      footMain.appendChild(holdRow);

      var limit = el("div", "limit");
      footMain.appendChild(limit);

      // The confirm before the door, built once and hidden. It is not in the
      // menu and it is not a window.confirm: it is the rail saying what is
      // still unfinished, which is the only reason to ask at all.
      var endPanel = el("div", "endpanel");
      endPanel.setAttribute("role", "group");
      endPanel.setAttribute("aria-label", END_REVIEW.TITLE);
      endPanel.setAttribute("data-shown", "false");
      var endTitle = el("div", "endpanel__title", END_REVIEW.TITLE);
      var endWhat = el("div", "endpanel__what", "");
      var endKept = el("div", "endpanel__kept", END_REVIEW.KEPT);
      var endActs = el("div", "endpanel__acts");
      var endGo = el("button", "endpanel__go", END_REVIEW.CONFIRM);
      endGo.setAttribute("type", "button");
      var endNo = el("button", "endpanel__no", END_REVIEW.CANCEL);
      endNo.setAttribute("type", "button");
      endGo.addEventListener("click", function () {
        confirmEndReview(endRun);
      });
      endNo.addEventListener("click", function () {
        // The same button is Close once the review has ended: nothing is left
        // to cancel, so both readings do the same thing, which is put the panel
        // away and answer whoever asked.
        if (endRunning) return;
        hideEndPanel();
        settleEndPrompt({ confirmed: false, result: null });
      });
      endPanel.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !endRunning) cancelEndReview();
      });
      endActs.appendChild(endGo);
      endActs.appendChild(endNo);
      endPanel.appendChild(endTitle);
      endPanel.appendChild(endWhat);
      endPanel.appendChild(endKept);
      endPanel.appendChild(endActs);
      footMain.appendChild(endPanel);

      // No action buttons here. Copy and Export moved into the head's menu
      // (D10, revised): they read as submit buttons under the reviewer's own
      // words, and the footer's job is the status line and the hints.
      var hints = el("div", "hints");
      HINTS.forEach(function (hint) {
        var row = el("span", "hint");
        hint.keys.forEach(function (key) {
          row.appendChild(el("kbd", null, key));
        });
        row.appendChild(el("span", null, hint.what));
        hints.appendChild(row);
      });

      // The hints keep the row and the door sits beside them. Ken asked for the
      // way out here rather than in the menu: it is the control that closes the
      // session, and it should be where the reviewer's eye already is when they
      // are done. Same title and accessible name, because an icon with no label
      // has to say the whole thing on hover and to a screen reader alike.
      var endBtn = el("button", "endbtn");
      endBtn.setAttribute("type", "button");
      endBtn.setAttribute("aria-label", END_REVIEW.LABEL);
      endBtn.title = END_REVIEW.LABEL;
      endBtn.innerHTML = END_ICON;
      endBtn.addEventListener("click", function () {
        askEndReview();
      });
      footMain.appendChild(hints);
      foot.appendChild(footMain);
      foot.appendChild(endBtn);
      rail.appendChild(foot);

      var pill = el("button", "pill");
      pill.hidden = true;
      pill.setAttribute("type", "button");
      pill.setAttribute("aria-label", PILL_TITLE);
      pill.title = PILL_TITLE;
      pill.appendChild(el("span", "pill__dot"));
      pill.appendChild(el("span", null, "Review"));
      var pillCount = el("span", "pill__count", "0");
      pill.appendChild(pillCount);
      // How long the oldest comment has waited, shown only while that is late.
      var pillWaitNode = el("span", "pill__wait", "");
      pill.appendChild(pillWaitNode);
      var pillJewel = el("span", "pill__jewel");
      pillJewel.hidden = true;
      pill.appendChild(pillJewel);
      pill.addEventListener("click", function (event) {
        // A drag ends with a click, because the pointer went down and up on the
        // same button. Without this the reviewer moves the pill out of the way
        // of the page's own bar and the rail opens on top of it for their
        // trouble.
        if (pillDrag && pillDrag.moved) {
          event.preventDefault();
          event.stopPropagation();
          pillDrag = null;
          return;
        }
        pillDrag = null;
        collapse(false);
      });

      // POINTER EVENTS, not mouse events. The reviewer who needs this is on a
      // phone, reaching past their own thumb bar. One set of handlers covers the
      // mouse and the finger, and setPointerCapture is what keeps the drag alive
      // when the finger outruns the pill.
      pill.addEventListener("pointerdown", function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        var view = viewportOf(pill);
        if (!view) return;
        var rect = pill.getBoundingClientRect();
        pillDrag = {
          id: event.pointerId,
          moved: false,
          startX: event.clientX,
          startY: event.clientY,
          // Where inside the pill the finger landed, so it does not jump under
          // the touch on the first move.
          grabX: event.clientX - rect.left,
          grabY: event.clientY - rect.top
        };
        if (typeof pill.setPointerCapture === "function") {
          try { pill.setPointerCapture(event.pointerId); } catch (err) { /* not fatal */ }
        }
      });

      pill.addEventListener("pointermove", function (event) {
        if (!pillDrag || event.pointerId !== pillDrag.id) return;
        if (!pillDrag.moved) {
          var far =
            Math.abs(event.clientX - pillDrag.startX) > PILL_DRAG_SLOP ||
            Math.abs(event.clientY - pillDrag.startY) > PILL_DRAG_SLOP;
          if (!far) return;
          pillDrag.moved = true;
          pill.setAttribute("data-lahe-dragging", "true");
        }
        var view = viewportOf(pill);
        if (!view) return;
        // Held under the finger while it moves, in plain left/top, and turned
        // back into a corner and two offsets when it lands.
        var left = event.clientX - pillDrag.grabX;
        var top = event.clientY - pillDrag.grabY;
        var w = pill.offsetWidth || 0;
        var h = pill.offsetHeight || 0;
        left = Math.min(Math.max(left, PILL_EDGE_GAP), Math.max(PILL_EDGE_GAP, view.w - w - PILL_EDGE_GAP));
        top = Math.min(Math.max(top, PILL_EDGE_GAP), Math.max(PILL_EDGE_GAP, view.h - h - PILL_EDGE_GAP));
        pill.style.left = left + "px";
        pill.style.top = top + "px";
        pill.style.right = "auto";
        pill.style.bottom = "auto";
        event.preventDefault();
      });

      function endPillDrag(event) {
        if (!pillDrag || (event && event.pointerId !== pillDrag.id)) return;
        pill.removeAttribute("data-lahe-dragging");
        if (!pillDrag.moved) {
          pillDrag = null;
          return;
        }
        var view = viewportOf(pill);
        if (view) {
          pillSpot = spotFromRect(pill.getBoundingClientRect(), view);
          applyPillSpot();
          persistCollapsedPreference();
        }
        // Left set for the click handler that follows, and cleared there.
      }

      pill.addEventListener("pointerup", endPillDrag);
      pill.addEventListener("pointercancel", function (event) {
        endPillDrag(event);
        pillDrag = null;
      });

      // The toast stack. Bottom-left, so it is never under the rail and never
      // under the collapsed pill, which is the one control a reviewer working
      // with the rail closed has to be able to reach.
      var toastHost = el("div", "toasts");
      markers.markChrome(toastHost);
      toastHost.hidden = true;
      // Created once and kept last in the stack, so a toast arriving never has
      // to move it and moving a node never restarts somebody's animation.
      var toastMore = el("div", "toast__more", "");
      markers.markChrome(toastMore);
      toastMore.hidden = true;
      toastHost.appendChild(toastMore);

      shadow.appendChild(rail);
      shadow.appendChild(pill);
      shadow.appendChild(toastHost);
      surfaceRoot.appendChild(host);

      // A remembered offset outlives the viewport that produced it. Rotating a
      // phone, or an address bar sliding away, changes what "24px from the
      // bottom" reaches, so the spot is clamped again whenever the viewport
      // moves. Nothing is persisted here: the clamp is a presentation of the
      // reviewer's choice, not a new one made on their behalf.
      var pillView = doc && doc.defaultView;
      if (pillView && typeof pillView.addEventListener === "function") {
        // One handler for both events, held on the closure so unmount removes
        // exactly what this mount bound. Binding happens once per mount:
        // mount() returns early when the rail is already up, and unmount is the
        // only other way out, so there is no path that binds twice.
        viewportClamp = {
          view: pillView,
          handler: function () {
            if (pillSpot) applyPillSpot();
          }
        };
        pillView.addEventListener("resize", viewportClamp.handler);
        pillView.addEventListener("orientationchange", viewportClamp.handler);
      }

      // A held pane move lands the moment focus leaves the card.
      shadow.addEventListener("focusout", function () {
        flushPendingPlacements();
      });

      dom = {
        host: host,
        // The library's ONE page-level host, kept because the rail's width is
        // published on it as a custom property for the other surfaces to read.
        surfaceHost: surface.host || null,
        shadow: shadow,
        rail: rail,
        grip: grip,
        tabButtons: tabButtons,
        counts: counts,
        newmarks: newmarks,
        panes: paneNodes,
        chipList: chipList,
        foot: foot,
        statusRow: statusRow,
        statusText: statusText,
        late: late,
        lateTitle: lateTitle,
        lateCheck: lateCheck,
        lateBtn: lateBtn,
        lateNote: lateNote,
        lateMessage: lateMessage,
        statusDot: statusDot,
        holdBtn: holdBtn,
        holdCount: holdCount,
        limit: limit,
        hints: hints,
        footMain: footMain,
        endBtn: endBtn,
        endPanel: endPanel,
        endTitle: endTitle,
        endWhat: endWhat,
        endKept: endKept,
        endGo: endGo,
        endNo: endNo,
        refusal: refusal,
        refusalReason: refusalReason,
        refusalBtn: refusalBtn,
        menuBtn: menuBtn,
        menuList: menuList,
        menuItems: menuItems,
        menuWrap: menuWrap,
        collapseBtn: collapseBtn,
        pill: pill,
        pillCount: pillCount,
        pillWait: pillWaitNode,
        pillJewel: pillJewel,
        toastHost: toastHost,
        toastMore: toastMore
      };

      // Everything already in state is painted once, here. This is the only
      // place that draws from scratch, and it runs when there are no cards.
      Object.keys(cards).forEach(function (id) {
        buildCardNode(cards[id]);
        placeCard(cards[id]);
        paintCard(cards[id]);
      });
      renderChips();
      renderStatus();
      renderAgent();
      renderTabs();
      renderCollapsed();
      // The surface exists now, so a rail mounted while the reviewer is
      // presenting comes up hidden rather than flashing onto the projector for
      // a frame. Remounts reach this too, which is the case that matters: a
      // deck that re-renders mid-talk must not put the rail back on screen.
      renderPresent();
      // A toast is state, not a paint: the nodes went with the old root on a
      // remount and the thing they were telling the reviewer about is still
      // true, so they are drawn again and their clocks start over.
      remountToasts();
      // The pill exists now, so the reviewer's own arrangement can go back on it.
      // Read here as well as in setReview because a rail built WITH a review id
      // never goes through setReview at all, which is how the fixture and the
      // library both make one.
      pillSpot = readPillPreference();
      applyPillSpot();
      // The width the reviewer dragged the rail to, back on the rail, and the
      // allowance published for everything that keeps clear of it. Read here as
      // well as in setReview for the same reason the pill is: a rail built WITH
      // a review id never goes through setReview at all.
      railWidth = readWidthPreference();
      bindGrip(grip, shadow);
      applyRailWidth();
      if (mo.hidden) setCollapsed(true, false);
      if (refusalInfo) showRefusal(refusalInfo);
      return { rootId: markers.OVERLAY_ROOT_ID, remounted: false };
    }

    function emptyTextFor(name) {
      if (name === TAB.ACTIVE) return "Nothing outstanding. Select some text and press Cmd-Shift-C.";
      if (name === TAB.EDITS) return "No hand edits yet.";
      return "Nothing handled yet.";
    }

    // Unmount drops the DOM and keeps every piece of state, which is what makes
    // a remount (2D's, on navigation) cheap and lossless. Chips that were
    // dismissed stay dismissed because dismissal is state, not markup.
    function unmount() {
      // Before the dom goes: the document-level listener the open menu installed
      // belongs to a menu that is about to stop existing.
      closeMenu(false);
      // An unanswered end-review question goes with the rail that asked it, and
      // whoever awaited it is told, rather than left holding a promise that can
      // never settle now the panel is gone.
      if (endPrompt) {
        endRunning = false;
        endRun = null;
        settleEndPrompt({ confirmed: false, result: null });
      }
      // The toast nodes go with the root. The toasts themselves are state, so
      // mount draws them again; what must not survive is their clocks, which
      // would otherwise dismiss a toast that no longer has a node.
      toasts.forEach(function (toast) {
        clearToastTimer(toast);
        toast.node = null;
      });
      // A node mid-fade belongs to a root that is going away with it.
      toastLeaving = [];
      // The viewport clamp is about a pill that is about to stop existing, and
      // mount binds it again for the pill that replaces it.
      releaseViewportClamp();
      if (dom && dom.host && dom.host.parentNode) dom.host.parentNode.removeChild(dom.host);
      Object.keys(cards).forEach(function (id) {
        cards[id].node = null;
        cards[id].bodyNode = null;
        cards[id].parts = null;
      });
      dom = null;
      mounted = false;
      // The age tick belongs to a rail that is on screen. A remount arms it
      // again from renderAgent, so nothing is lost by dropping it here, and a
      // page that navigates away leaves no interval of ours running.
      armAgentAgeTick();
    }

    /** Take the viewport clamp off the window it was bound to. */
    function releaseViewportClamp() {
      if (!viewportClamp) return false;
      var view = viewportClamp.view;
      if (view && typeof view.removeEventListener === "function") {
        view.removeEventListener("resize", viewportClamp.handler);
        view.removeEventListener("orientationchange", viewportClamp.handler);
      }
      viewportClamp = null;
      return true;
    }

    function isMounted() {
      return mounted;
    }

    /**
     * Install a tab module's stylesheet in the rail's own closed root.
     *
     * A tab module used to carry its sheet inside the first node it put on a
     * card. That node is removable: a question node goes when the question is
     * answered, a row goes when the item leaves the pane, and the whole root
     * goes on a remount. The sheet left with it and the module's one-shot flag
     * still said "installed", so everything drawn afterwards came out with no
     * CSS and no error. The rail's shadow root outlives every card in it, so
     * the sheet belongs here.
     *
     * Idempotent by key and by connectedness, so a remount replaces the sheet
     * rather than stacking a second copy of it.
     *
     * @param {string} key   the module's name, one sheet per key
     * @param {string} css   the rules
     * @returns {Element|null} the style element, or null with no rail on screen
     */
    function ensureStyleSheet(key, css) {
      if (!doc || !dom || !dom.shadow || !key) return null;
      var found = dom.shadow.querySelector("style[" + SHEET_ATTR + "='" + key + "']");
      if (found && found.isConnected) return found;
      if (found && found.parentNode) found.parentNode.removeChild(found);
      var style = doc.createElement("style");
      style.setAttribute(SHEET_ATTR, key);
      markers.markChrome(style);
      style.textContent = css;
      dom.shadow.appendChild(style);
      return style;
    }

    /**
     * Re-read the page's background and re-stamp the rail with the scheme it
     * asks for. Called after a remount: the page that comes back is not required
     * to have the background the page that left had.
     *
     * @returns {"light"|"dark"|null} null when there is nothing mounted
     */
    function refreshScheme() {
      if (!dom) return null;
      // Called on every remount, which is the moment the page under the rail was
      // rebuilt. A menu the reviewer opened before a navigation is not something
      // they still want open after it, so it goes away with the page it belonged
      // to. The BUTTON is chrome and stays; the open menu is a moment.
      closeMenu(false);
      var next = highlights.refreshScheme();
      dom.host.setAttribute(highlightModule.SCHEME_ATTR, next);
      return next;
    }

    function setReview(id) {
      reviewId = id;
      preferredCollapsed = readCollapsedPreference();
      pillSpot = readPillPreference();
      railWidth = readWidthPreference();
      collapsed = preferredCollapsed;
      // A rail told which review it is showing reads that review's own choice
      // about being hidden, the way it reads the other three.
      presenting = readPresentPreference();
      // Folds are per review as well, so a rail told it is showing a different
      // review does not carry the last one's folded list onto these cards.
      collapsedCards = readCardCollapsePreference();
      loadChips();
      if (dom) {
        dom.rail.querySelector(".review").textContent = id || "";
        renderChips();
        renderCollapsed();
        renderPresent();
        Object.keys(cards).forEach(function (id) {
          applyCardCollapsed(cards[id]);
        });
        applyPillSpot();
        applyRailWidth();
        if (refusalInfo) setCollapsed(false, false);
      }
      return reviewId;
    }

    // -------------------------------------------------------------------------
    // Hold: queue several comments, release them to the agent at once
    // -------------------------------------------------------------------------
    //
    // docs/features/20260917.01_hold_toggle. Hold gates DELIVERY, not the item
    // lifecycle (docs/diagrams/item_lifecycle.md): an item is still `ready`,
    // durably, the moment the reviewer commits it. Everything below is a
    // RENDERING-layer question, the same kind record.displayState already
    // answers for handled/not_handled: is this ready item's own event still
    // sitting in this review's outbox because Hold is on? If so the card and
    // the pill say so; nothing about the record itself changes.

    function isHeldNow() {
      if (!store || !reviewId || typeof store.isHeld !== "function") return false;
      try {
        return store.isHeld(reviewId) === true;
      } catch (err) {
        return false;
      }
    }

    /**
     * How many comments the toggle's count is about.
     *
     * DISTINCT READY ITEMS, not store.pendingCount's raw event count. One
     * comment can sit in the outbox as more than one event (its creation, its
     * keystrokes, its ready), and a draft queues events too (drafts flow to
     * the helper for durability, R7 of the original brief) without ever being
     * something an agent could act on. "Holding, 3 queued" means three
     * comments, the way a reviewer reads it, not five wire events including a
     * draft nobody is waiting on.
     */
    function heldQueuedCount() {
      if (!store || !reviewId) return 0;
      if (typeof store.pendingEvents !== "function" || typeof store.readItem !== "function") return 0;
      try {
        var pending = store.pendingEvents(reviewId);
        var seen = Object.create(null);
        var n = 0;
        for (var i = 0; i < pending.length; i += 1) {
          var itemId = pending[i] && pending[i].item;
          if (!itemId || seen[itemId]) continue;
          seen[itemId] = true;
          var current = store.readItem(reviewId, itemId);
          if (current && current[record.FIELD.STATE] === record.STATE.READY) n += 1;
        }
        return n;
      } catch (err) {
        return 0;
      }
    }

    /**
     * Is THIS item's own event still queued, undelivered, while Hold is on?
     *
     * Checked per item, not just "is Hold on": an item sent and acknowledged
     * BEFORE Hold was turned on already reached the agent, so it stays a plain
     * ready card. Only an item whose event is still sitting in the outbox is
     * held back, which is the whole point of Requirement 9 (Hold suppresses
     * the outbox, not a fourth lifecycle state).
     */
    function isItemHeld(id) {
      if (!id || !isHeldNow()) return false;
      if (!store || typeof store.pendingEvents !== "function") return false;
      try {
        var pending = store.pendingEvents(reviewId);
        for (var i = 0; i < pending.length; i += 1) {
          if (pending[i] && pending[i].item === id) return true;
        }
      } catch (err) {
        /* best effort: an unreadable outbox reads as not held */
      }
      return false;
    }

    /** record.displayState, with the rail's one display-only addition. */
    function cardDisplayState(item) {
      var base = record.displayState(item);
      if (base === record.STATE.READY && isItemHeld(item[record.FIELD.ID])) return "held";
      return base;
    }

    /**
     * Recompute one card's held-ness and repaint only if it changed.
     *
     * Called from renderStatus's per-card pass (the same pass that already
     * repaints every card's late/wait state each tick), which is what makes a
     * newly-ready item correct without a special case: upsertCard paints it
     * BEFORE sync.js has queued its event, so the very first paint reads
     * "ready"; the very next renderStatus (fired by sync's own recomputeStatus,
     * synchronously after the event is queued) corrects it to "held" before
     * the reviewer's eye has moved.
     */
    function paintCardHeld(card) {
      if (!card) return;
      var next = cardDisplayState(card.item);
      if (next === card.state) return;
      card.state = next;
      paintCard(card);
    }

    function renderHold() {
      if (!dom || !dom.holdBtn) return;
      var held = isHeldNow();
      dom.holdBtn.setAttribute("aria-pressed", held ? "true" : "false");
      if (!held) {
        dom.holdCount.textContent = "";
        return;
      }
      var n = heldQueuedCount();
      // A ZERO-COUNT LABEL THAT ONLY MAKES SENSE ONCE SOMETHING HAS BEEN TYPED
      // reads as broken the moment Hold is turned on (R5, design review).
      dom.holdCount.textContent = n === 0 ? HOLD_ZERO_TEXT : holdCountText(n);
    }

    /**
     * The toggle's count and the collapsed pill's held reading, repainted
     * together. Called from renderStatus (the ordinary poll-driven refresh)
     * AND from upsertCard: sync.js's status line deliberately holds its
     * current reading steady rather than repainting on every queued event
     * (recomputeStatus, "HOLD the current reading rather than flickering"),
     * so a rail that only repainted Hold's own chrome from renderStatus would
     * leave the queued count reading stale for up to a poll interval after
     * each comment. upsertCard runs synchronously with every item change,
     * which is what makes this immediate instead.
     */
    function repaintHoldChrome() {
      renderHold();
      if (!dom || !dom.pill) return;
      var heldQueued = isHeldNow() ? heldQueuedCount() : 0;
      // HELD, ON THE COLLAPSED PILL (R10), takes over the late pill's spot
      // rather than sitting beside it: while Hold is on with anything queued,
      // that is the more actionable fact ("you did this on purpose, release
      // it when you're ready"), and a held item is by construction never the
      // one making the late reading loud (cardWaitFor excludes it, R4).
      if (heldQueued > 0) {
        var heldTitle = heldQueued + " held. Nothing sends to the agent until you release Hold.";
        dom.pill.setAttribute("data-lahe-held", "true");
        dom.pill.removeAttribute("data-lahe-late");
        dom.pillWait.textContent = heldQueued + " held";
        dom.pill.title = heldTitle;
        dom.pill.setAttribute("aria-label", heldTitle);
      } else {
        dom.pill.removeAttribute("data-lahe-held");
        var pill = pillWait();
        dom.pill.setAttribute("data-lahe-late", pill.late ? "true" : "");
        dom.pillWait.textContent = pill.text;
        dom.pill.title = pill.title;
        dom.pill.setAttribute("aria-label", pill.title);
      }
    }

    /**
     * Flip Hold. Releasing it runs the "hold-release" action, which is the
     * seam index.js wires to sync.flush({force: true}): the flush is forced
     * PAST the same gate this store write sets, exactly like the takeover and
     * end-review actions already registered on this seam (onAction/runAction).
     * Nothing here posts to the network directly; overlay.js has no sync.
     */
    function setHeldState(next) {
      var want = !!next;
      if (!store || !reviewId || typeof store.setHeld !== "function") return false;
      try {
        store.setHeld(reviewId, want);
      } catch (err) {
        return false;
      }
      renderStatus();
      if (!want) runAction("hold-release");
      return true;
    }

    function toggleHeld() {
      return setHeldState(!isHeldNow());
    }

    // -------------------------------------------------------------------------
    // Cards
    // -------------------------------------------------------------------------

    function handleFor(id) {
      return {
        id: id,
        node: cards[id] ? cards[id].node : null,
        body: cards[id] ? cards[id].bodyNode : null,
        holdsFocus: function () {
          return holdsFocus(id);
        }
      };
    }

    // Creates the card if it does not exist, updates it in place if it does.
    // NEVER re-creates. Returns a handle.
    function upsertCard(item) {
      record.validateItem(item);
      var id = item[record.FIELD.ID];
      if (!cards[id]) {
        cards[id] = {
          id: id,
          node: null,
          bodyNode: null,
          parts: null,
          item: item,
          state: cardDisplayState(item),
          pane: paneForItem(item),
          badges: [],
          agentMessage: null,
          notice: null,
          attached: [],
          attachedBefore: [],
          attachedContinuation: [],
          sequence: (cardSequence += 1),
          created: true
        };
        buildCardNode(cards[id]);
        placeCard(cards[id]);
      } else {
        cards[id].item = item;
        cards[id].state = cardDisplayState(item);
        cards[id].pane = paneForItem(item);
        placeCard(cards[id]);
      }
      paintCard(cards[id]);
      renderTabs();
      // See repaintHoldChrome: the queued count has to move the instant a new
      // item lands, not on the next poll-driven renderStatus.
      repaintHoldChrome();
      return handleFor(id);
    }

    // -------------------------------------------------------------------------
    // Clicking a card to find its place on the page
    // -------------------------------------------------------------------------
    //
    // A card is a pointer at a passage, and the reviewer's question in front of
    // it is "where is this?". So the whole card is the gesture, in every tab.
    // Three things are NOT that gesture, and this is where they are ruled out:
    //
    //  - a control. Every button, link, box and composer inside a card does its
    //    own job, and a jump on top of it is the rail acting on a press that was
    //    meant for something else.
    //  - a text selection. Copying the agent's answer out of a card ends in a
    //    click, and that click must not throw the page somewhere.
    //  - a drag. Same reason, before the selection exists to be read.
    var CLICK_SKIP_TAGS = {
      button: 1,
      a: 1,
      input: 1,
      textarea: 1,
      select: 1,
      option: 1,
      label: 1,
      summary: 1
    };

    // How far the pointer may travel between down and up and still be a click.
    var CLICK_SLOP = 4;

    function isInteractiveTarget(node, cardNodeEl) {
      var current = node;
      while (current && current !== cardNodeEl) {
        if (current.nodeType === 1) {
          var tag = (current.tagName || "").toLowerCase();
          if (CLICK_SKIP_TAGS[tag]) return true;
          if (current.isContentEditable) return true;
          // The escape hatch for anything a tab owner attaches that is
          // interactive without being one of the tags above.
          if (current.getAttribute && current.getAttribute("data-lahe-no-jump") !== null) return true;
        }
        current = current.parentNode;
      }
      return false;
    }

    // The reviewer is holding a selection inside this card. Asked of the shadow
    // root first, because that is where the card lives and a closed root answers
    // for its own selection; the document is the fallback for engines that do
    // not implement ShadowRoot.getSelection.
    function selectionInside(cardNodeEl) {
      var roots = [];
      var root = cardNodeEl.getRootNode ? cardNodeEl.getRootNode() : null;
      if (root && typeof root.getSelection === "function") roots.push(root);
      var doc = cardNodeEl.ownerDocument;
      var view = doc && doc.defaultView;
      if (view && typeof view.getSelection === "function") {
        roots.push({ getSelection: function () { return view.getSelection(); } });
      }
      for (var i = 0; i < roots.length; i += 1) {
        var selection = null;
        try {
          selection = roots[i].getSelection();
        } catch (err) {
          selection = null;
        }
        if (!selection || selection.isCollapsed) continue;
        if (!String(selection).replace(/\s+/g, "")) continue;
        var anchor = selection.anchorNode;
        if (!anchor) continue;
        if (anchor === cardNodeEl || cardNodeEl.contains(anchor)) return true;
      }
      return false;
    }

    function activateCard(id) {
      cardActivateHandlers.forEach(function (fn) {
        try {
          fn(id);
        } catch (err) {
          // One bad listener must never make a card feel broken to click.
        }
      });
      return id;
    }

    /**
     * Tell me when the reviewer clicks a card (and means it).
     *
     * @param {function(string)} fn called with the card's item id
     * @returns {function} unsubscribe
     */
    function onCardActivate(fn) {
      if (typeof fn !== "function") throw new TypeError("onCardActivate: a function is required");
      cardActivateHandlers.push(fn);
      return function () {
        var at = cardActivateHandlers.indexOf(fn);
        if (at !== -1) cardActivateHandlers.splice(at, 1);
      };
    }

    // -------------------------------------------------------------------------
    // Folding a card to one line
    // -------------------------------------------------------------------------

    /** Was this click on the card's head strip rather than in its contents? */
    function withinHead(node, cardNodeEl) {
      var current = node;
      while (current && current !== cardNodeEl) {
        if (current.nodeType === 1 && current.getAttribute && current.getAttribute("data-lahe-card-head") !== null) {
          return true;
        }
        current = current.parentNode;
      }
      return false;
    }

    function isCardCollapsed(id) {
      return collapsedCards[id] === true;
    }

    /** The ids currently folded, for a caller that wants the whole list. */
    function collapsedCardIds() {
      return Object.keys(collapsedCards);
    }

    /**
     * Paint one card's fold. Writes attributes and text into nodes that already
     * exist; it never rebuilds anything, which is this file's own law.
     */
    function applyCardCollapsed(card) {
      if (!card || !card.node || !card.parts) return false;
      var folded = isCardCollapsed(card.id);
      if (folded) card.node.setAttribute(CARD_COLLAPSED_ATTR, "true");
      else card.node.removeAttribute(CARD_COLLAPSED_ATTR);
      card.parts.disclose.setAttribute("aria-expanded", folded ? "false" : "true");
      var label = folded ? "Expand this card" : "Collapse this card";
      card.parts.disclose.setAttribute("aria-label", label);
      card.parts.disclose.title = label;
      // Kept up to date whether the card is folded or not, so the line is
      // already right the instant it is shown.
      card.parts.lineText.textContent = collapsedLineText(card.item, COLLAPSED_LINE_MAX);
      return folded;
    }

    /**
     * Fold this card, or open it.
     *
     * @param {string} id item id
     * @param {boolean} collapsed true to fold it down to one line
     * @returns {object|null} the card handle, or null when there is no such card
     */
    function setCardCollapsed(id, collapsed) {
      if (!cards[id]) return null;
      var want = collapsed === true;
      if (isCardCollapsed(id) === want) return handleFor(id);
      if (want) collapsedCards[id] = true;
      else delete collapsedCards[id];
      applyCardCollapsed(cards[id]);
      persistCollapsedPreference();
      cardCollapseHandlers.forEach(function (fn) {
        try {
          fn(id, want);
        } catch (err) {
          // One bad listener must never make a chevron feel broken to press.
        }
      });
      return handleFor(id);
    }

    function toggleCardCollapsed(id) {
      return setCardCollapsed(id, !isCardCollapsed(id));
    }

    /**
     * Fold, or open, every card in one tab.
     *
     * The head menu's two items. A tab rather than the whole rail, because the
     * reviewer asking for this is looking at one list and means that one.
     *
     * @param {string} tab one of TABS
     * @param {boolean} collapsed
     * @returns {string[]} the ids that actually changed
     */
    function setCardsCollapsed(tab, collapsed) {
      var changed = [];
      Object.keys(cards).forEach(function (id) {
        if (tab && cards[id].pane !== tab) return;
        if (isCardCollapsed(id) === (collapsed === true)) return;
        setCardCollapsed(id, collapsed);
        changed.push(id);
      });
      return changed;
    }

    /**
     * Tell me when a card is folded or opened.
     *
     * @param {function(string, boolean)} fn called with the item id and whether
     *   it is now folded
     * @returns {function} unsubscribe
     */
    function onCardCollapse(fn) {
      if (typeof fn !== "function") throw new TypeError("onCardCollapse: a function is required");
      cardCollapseHandlers.push(fn);
      return function () {
        var at = cardCollapseHandlers.indexOf(fn);
        if (at !== -1) cardCollapseHandlers.splice(at, 1);
      };
    }

    function buildCardNode(card) {
      if (!dom || card.node) return card.node;
      var node = el("article", "card");
      node.setAttribute("data-card-id", card.id);
      markers.markChrome(node);
      node.addEventListener("mousedown", function (event) {
        pressPoint = { x: event.clientX, y: event.clientY };
      });
      node.addEventListener("click", function (event) {
        var press = pressPoint;
        pressPoint = null;
        if (isInteractiveTarget(event.target, node)) return;
        if (press && Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) > CLICK_SLOP) return;
        if (selectionInside(node)) return;
        // THE HEAD FOLDS, THE BODY JUMPS. The rules above are untouched: a
        // control, a drag and a selection are still not a gesture at all. This
        // only splits what is left in two, and the head is the half that was
        // doing the least: a kind label, a time and a state chip are things to
        // read rather than things to press, so the strip they sit on is where
        // the fold belongs.
        if (withinHead(event.target, node)) {
          toggleCardCollapsed(card.id);
          return;
        }
        activateCard(card.id);
      });

      var top = el("div", "card__top");
      top.setAttribute("data-lahe-card-head", "true");
      // The disclosure, first in the head, so the chevrons line up down the pane
      // whatever the cards under them say.
      var disclose = el("button", "carddisclose");
      disclose.setAttribute("type", "button");
      disclose.innerHTML = CHEVRON_ICON;
      disclose.addEventListener("click", function () {
        toggleCardCollapsed(card.id);
      });
      top.appendChild(disclose);
      var kind = el("span", "card__kind");
      top.appendChild(kind);
      top.appendChild(el("span", "spacer"));
      // How long a late card has waited. Hidden unless the card is late.
      var wait = el("span", "card__wait", "");
      top.appendChild(wait);
      var time = el("time", "card__time");
      top.appendChild(time);
      var state = el("span", "card__state");
      top.appendChild(state);
      node.appendChild(top);

      // The one line a folded card shows. Built once with the card, like every
      // other part: nothing here is created at the moment of a click.
      var line = el("div", "card__line");
      var lineText = el("span", "card__linetext");
      line.appendChild(lineText);
      line.appendChild(el("span", "card__tag card__tag--new", "1 new"));
      line.appendChild(el("span", "card__tag card__tag--ask", "question"));
      node.appendChild(line);

      var quote = el("div", "card__quote");
      node.appendChild(quote);

      // What a tab-content owner fills. Nothing in this file writes into it.
      var body = el("div", "card__body");
      node.appendChild(body);

      var badges = el("div", "card__badges");
      node.appendChild(badges);
      var agent = el("div", "agent");
      node.appendChild(agent);
      var continuation = el("div", "card__continuation");
      node.appendChild(continuation);
      var notice = el("div", "card__notice");
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      node.appendChild(notice);

      card.node = node;
      card.bodyNode = body;
      card.continuationNode = continuation;
      card.parts = {
        head: top,
        disclose: disclose,
        line: line,
        lineText: lineText,
        kind: kind,
        wait: wait,
        time: time,
        state: state,
        quote: quote,
        badges: badges,
        agent: agent,
        continuation: continuation,
        notice: notice
      };
      applyCardCollapsed(card);
      // A remount rebuilds the card's node, so anything a tab owner attached
      // goes back into the new body rather than being silently dropped.
      (card.attachedBefore || []).forEach(function (attachedNode) {
        body.appendChild(attachedNode);
      });
      (card.attached || []).forEach(function (attachedNode) {
        body.appendChild(attachedNode);
      });
      (card.attachedContinuation || []).forEach(function (attachedNode) {
        continuation.appendChild(attachedNode);
      });
      return node;
    }

    // Puts the card in the pane its state says it belongs in. A card holding
    // focus is NEVER re-parented: moving a focused element blurs it in every
    // engine, which would be this file's own law broken by its own tidying.
    //
    // There is no early return for a card already in its pane: newest activity
    // sits on top, and a reply or a reworded note changes a card's place inside
    // a pane it never left.
    function placeCard(card) {
      if (!dom || !card.node) return;
      var pane = dom.panes[card.pane];
      if (holdsFocus(card.id)) {
        pendingPlacement[card.id] = true;
        return;
      }
      // The Edits pane orders its cards with inline flex order. A card that
      // leaves that pane keeps the inline style, and one stale negative order
      // beats every DOM position this function chooses: the card renders at
      // the top while the newest reply sinks below every migrated edit. Clear
      // it on the way into any other pane; the Edits tab re-stamps its own.
      if (card.pane !== TAB.EDITS && card.node.style && card.node.style.order) {
        card.node.style.order = "";
      }
      var before = null;
      var at = activityAt(card.item);
      Array.prototype.some.call(pane.children, function (node) {
        var other = cards[node.getAttribute && node.getAttribute("data-card-id")];
        if (!other || other === card) return false;
        var otherAt = activityAt(other.item);
        if (at > otherAt || (at === otherAt && card.sequence > other.sequence)) {
          before = node;
          return true;
        }
        return false;
      });
      if (before !== card.node) pane.insertBefore(card.node, before);
      delete pendingPlacement[card.id];
    }

    function activityAt(item) {
      if (!item) return -Infinity;
      var reply = item[record.FIELD.REPLY] || {};
      var parsed = Date.parse(reply.at || item[record.FIELD.UPDATED_AT] || item[record.FIELD.CREATED_AT] || "");
      return Number.isFinite(parsed) ? parsed : -Infinity;
    }

    function flushPendingPlacements() {
      Object.keys(pendingPlacement).forEach(function (id) {
        if (!cards[id]) {
          delete pendingPlacement[id];
          return;
        }
        if (holdsFocus(id)) return;
        delete pendingPlacement[id];
        placeCard(cards[id]);
      });
      renderTabs();
    }

    // Updates the parts of a card that changed. It writes text into existing
    // nodes; it never replaces one.
    function paintCard(card) {
      if (!dom || !card.node) return;
      var item = card.item;
      var p = card.parts;
      p.kind.textContent = KIND_LABEL[item[record.FIELD.KIND]] || item[record.FIELD.KIND];
      var reviewerAt = item[record.FIELD.UPDATED_AT] || item[record.FIELD.CREATED_AT] || null;
      p.time.textContent = timestampLabel(reviewerAt);
      if (reviewerAt) {
        p.time.setAttribute("datetime", reviewerAt);
        p.time.setAttribute("title", new Date(reviewerAt).toLocaleString());
      } else {
        p.time.removeAttribute("datetime");
        p.time.removeAttribute("title");
      }
      p.state.textContent = STATE_LABEL[card.state] || card.state;
      p.state.setAttribute("data-state", card.state);
      // On the card itself too, so anything a tab owner attached can be shown or
      // withdrawn by the card's own state without a second file being told.
      card.node.setAttribute("data-state", card.state);
      paintCardWait(card);
      var quote = (item[record.FIELD.CONTEXT] && item[record.FIELD.CONTEXT].quote) || "";
      p.quote.textContent = quote;
      p.quote.style.display = quote ? "" : "none";

      p.badges.textContent = "";
      card.badges.forEach(function (badge) {
        var row = el("div", "badge", badge.message || badge.code);
        p.badges.appendChild(row);
      });

      p.agent.textContent = "";
      p.agent.className = "agent";
      if (card.agentMessage) {
        var who = card.agentMessage.agent || "agent";
        var label =
          card.agentMessage.status === record.REPLY_STATUS.QUESTION
            ? "Question from " + who
            : who;
        var agentHead = el("div", "agent__head");
        agentHead.appendChild(el("span", "agent__who", label));
        if (card.agentMessage.at) {
          var agentTime = el("time", "agent__time", timestampLabel(card.agentMessage.at));
          agentTime.setAttribute("datetime", card.agentMessage.at);
          agentTime.setAttribute("title", new Date(card.agentMessage.at).toLocaleString());
          agentHead.appendChild(agentTime);
        }
        p.agent.appendChild(agentHead);
        p.agent.appendChild(
          el("span", null, card.agentMessage.text || card.agentMessage.reason || "")
        );
        if (card.agentMessage.files && card.agentMessage.files.length) {
          var fileList = el("div", "agent__files");
          card.agentMessage.files.forEach(function (name) {
            fileList.appendChild(el("div", "agent__file", name));
          });
          p.agent.appendChild(fileList);
        }
        if (card.agentMessage.loud) p.agent.className = "agent is-loud";
      }

      p.notice.textContent = card.notice || "";

      // Last, so the folded line is written from the item this paint just used.
      applyCardCollapsed(card);
    }

    function getCard(id) {
      return cards[id] || null;
    }

    function cardNode(id) {
      return cards[id] ? cards[id].node : null;
    }

    // The element a tab-content owner fills for this card.
    function cardBody(id) {
      return cards[id] ? cards[id].bodyNode : null;
    }

    /**
     * Put a tab owner's node inside a card, so the card really holds it.
     *
     * This is what makes holdsFocus(id) true for contents a tab file rendered:
     * the text box the reviewer is typing into is inside the card's own node,
     * which is the guard that stops a focused card being removed or re-parented.
     * A tab owner that renders its rows somewhere else keeps the rail's model in
     * sync while the rail holds no node, and the guard can never fire.
     *
     * The law holds here too: a node already in the card is left where it is,
     * and nothing is moved into a card that currently holds focus, because
     * re-parenting blurs a focused element in every engine.
     *
     * @returns {object|null} the card handle, or null when there is no such
     *   card, no node, or the move would have blurred the reviewer
     */
    function attachCardNode(id, node) {
      if (!cards[id] || !node) return null;
      var body = cards[id].bodyNode;
      cards[id].attached = cards[id].attached || [];
      if (cards[id].attached.indexOf(node) === -1) cards[id].attached.push(node);
      if (!body) return handleFor(id);
      if (node.parentNode === body) return handleFor(id);
      if (holdsFocus(id)) return null;
      body.appendChild(node);
      return handleFor(id);
    }

    // Earlier completed rounds belong before the current tab-owned turn.
    function prependCardNode(id, node) {
      if (!cards[id] || !node) return null;
      var card = cards[id];
      card.attachedBefore = card.attachedBefore || [];
      if (card.attachedBefore.indexOf(node) === -1) card.attachedBefore.push(node);
      if (!card.bodyNode) return handleFor(id);
      if (node.parentNode === card.bodyNode && node === card.bodyNode.firstChild) return handleFor(id);
      card.bodyNode.insertBefore(node, card.bodyNode.firstChild);
      return handleFor(id);
    }

    // A continuation composer reads after the current agent response, whose
    // carrier sits outside card__body.
    function attachCardContinuation(id, node) {
      if (!cards[id] || !node) return null;
      var card = cards[id];
      card.attachedContinuation = card.attachedContinuation || [];
      if (card.attachedContinuation.indexOf(node) === -1) card.attachedContinuation.push(node);
      if (card.continuationNode && node.parentNode !== card.continuationNode) card.continuationNode.appendChild(node);
      return handleFor(id);
    }

    function detachCardNode(id, node) {
      if (!cards[id] || !node) return false;
      ["attached", "attachedBefore", "attachedContinuation"].forEach(function (field) {
        cards[id][field] = (cards[id][field] || []).filter(function (each) {
          return each !== node;
        });
      });
      if (node.parentNode) node.parentNode.removeChild(node);
      return true;
    }

    // The element a tab owner fills with that tab's contents.
    function tabBody(tab) {
      if (TABS.indexOf(tab) === -1) throw new Error("tabBody: unknown tab " + String(tab));
      return dom ? dom.panes[tab] : null;
    }

    function removeCard(id) {
      if (!cards[id]) return false;
      // The one guard that matters. A card holding focus is not removed, even
      // when the caller thinks it should be; the caller is told no.
      if (holdsFocus(id)) return false;
      if (cards[id].node && cards[id].node.parentNode) {
        cards[id].node.parentNode.removeChild(cards[id].node);
      }
      delete cards[id];
      delete pendingPlacement[id];
      renderTabs();
      return true;
    }

    /**
     * A tab is finished with its own row for this card. The CARD goes only when
     * nobody else owns it.
     *
     * The card is shared: the Active tab, the Edits tab and the Done tab all
     * draw their rows inside the same card node, and exactly one of them owns
     * it at a time (paneForItem says which). A tab that removed the card
     * whenever its own row went away deleted a card another tab was still
     * showing. That is how a handled reply vanished: the item folds to handled,
     * its card moves to the Done pane, then closing the still-open comment box
     * re-runs the Active tab's refresh, the handled item is not outstanding
     * any more, and the Active tab dropped the card out from under Done. The
     * reply was still in the store, so a reload brought it back, which is
     * exactly what the reviewer reported ("I got the update but I had to
     * reload").
     *
     * So: remove the card when this tab is still the card's pane, or when the
     * record is gone from the store entirely. Otherwise leave the card standing
     * and let the owning tab keep its contents.
     *
     * @param {string} id item id
     * @param {string} tab the calling tab, one of TABS
     * @returns {boolean} true when the card itself was removed
     */
    function releaseCard(id, tab) {
      if (TABS.indexOf(tab) === -1) throw new Error("releaseCard: unknown tab " + String(tab));
      if (!cards[id]) return false;
      if (cards[id].pane === tab) return removeCard(id);
      if (!itemIsStored(id)) return removeCard(id);
      return false;
    }

    /**
     * Does the store still hold this record?
     *
     * A rail built with no store (the standalone shape, and some tests) cannot
     * ask, and answers yes: keeping a card another pane owns is the safe way to
     * be wrong, because the reviewer can still see it and a stale card is not
     * what anyone reported.
     */
    function itemIsStored(id) {
      if (!store || !reviewId || typeof store.readItem !== "function") return true;
      return !!store.readItem(reviewId, id);
    }

    function setCardState(id, state) {
      if (record.STATES.indexOf(state) === -1) {
        throw new Error("setCardState: unknown state " + String(state));
      }
      if (!cards[id]) return null;
      cards[id].state = state;
      cards[id].item = Object.assign({}, cards[id].item);
      cards[id].item[record.FIELD.STATE] = state;
      cards[id].pane = paneForItem(cards[id].item);
      placeCard(cards[id]);
      paintCard(cards[id]);
      renderTabs();
      return handleFor(id);
    }

    // failure comes from failures.failure(code, detail). Adding the same code
    // twice replaces the existing badge rather than stacking duplicates.
    function setCardBadge(id, failure) {
      if (!cards[id]) return null;
      if (!failure || !failure.code) throw new TypeError("setCardBadge expects a failure object");
      clearCardBadge(id, failure.code);
      cards[id].badges.push(failure);
      paintCard(cards[id]);
      return handleFor(id);
    }

    function clearCardBadge(id, code) {
      if (!cards[id]) return false;
      var before = cards[id].badges.length;
      cards[id].badges = cards[id].badges.filter(function (b) {
        return b.code !== code;
      });
      var changed = cards[id].badges.length !== before;
      if (changed) paintCard(cards[id]);
      return changed;
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
        paintCard(cards[id]);
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
      paintCard(cards[id]);
      return handleFor(id);
    }

    // A passing message. Explicitly not persistent, so nothing important can be
    // routed here by accident: the persistent carriers are badges and chips.
    function setCardNotice(id, text) {
      if (!cards[id]) return null;
      cards[id].notice = text ? String(text) : null;
      paintCard(cards[id]);
      return handleFor(id);
    }

    // Answered from the closed shadow root, which is the only place that can
    // see it. removeCard and placeCard are the callers that matter.
    function holdsFocus(id) {
      if (!dom || !cards[id] || !cards[id].node) return false;
      var active = dom.shadow.activeElement;
      if (!active) return false;
      return cards[id].node === active || cards[id].node.contains(active);
    }

    function focusedCardId() {
      if (!dom) return null;
      var ids = Object.keys(cards);
      for (var i = 0; i < ids.length; i += 1) {
        if (holdsFocus(ids[i])) return ids[i];
      }
      return null;
    }

    // A closed root's activeElement is unreadable from outside, so the rail
    // describes it. Used by 1B's own specs and by anything that has to know
    // whether the reviewer is mid-sentence before it acts.
    function activeElementInfo() {
      if (!dom) return { isCardInput: false, cardId: null, tag: null, selectionStart: null, value: null };
      var active = dom.shadow.activeElement;
      var id = focusedCardId();
      var isInput = !!active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable);
      return {
        isCardInput: isInput && !!id,
        cardId: id,
        tag: active ? active.tagName : null,
        selectionStart: active && typeof active.selectionStart === "number" ? active.selectionStart : null,
        value: active && typeof active.value === "string" ? active.value : null
      };
    }

    function cardIds() {
      return Object.keys(cards);
    }

    function countFor(tab) {
      return Object.keys(cards).filter(function (id) {
        return cards[id].pane === tab;
      }).length;
    }

    function countIncomplete() {
      return Object.keys(cards).filter(function (id) {
        // Pane placement and completion are separate. Direct edits stay in the
        // Edits pane so they do not bury comments, but they are still work for
        // the agent until a handled reply lands.
        return cards[id].state !== record.STATE.HANDLED;
      }).length;
    }

    // -------------------------------------------------------------------------
    // The dismissible failure chips (R11)
    // -------------------------------------------------------------------------
    //
    // Chips and their dismissals live in browser storage, not in the DOM, so
    // they survive a remount and a navigation (ranked test 33). DISMISSED STAYS
    // DISMISSED: a code the reviewer waved away does not come back the next
    // time the same thing fails, because a chip that reappears every poll is
    // the reviewer's own dismissal not working. The underlying state is still
    // on the status line, so dismissing hides the chip and never the truth.

    function loadChips() {
      if (!store || !reviewId || typeof store.readChips !== "function") return;
      var got = store.readChips(reviewId);
      chips = got.chips || [];
      dismissed = Object.create(null);
      (got.dismissed || []).forEach(function (code) {
        dismissed[code] = true;
      });
    }

    function saveChips() {
      if (!store || !reviewId || typeof store.writeChips !== "function") return;
      // A chip that survives a remount is the nice half. The chip ON SCREEN is
      // the half that matters, and one of the codes this list carries is
      // STORAGE_QUOTA: the write below is into the very storage that is full, so
      // without this the rail throws while trying to say so and the reviewer
      // sees nothing at all.
      failuresModule.tolerateStorageQuota(function () {
        store.writeChips(reviewId, { chips: chips, dismissed: Object.keys(dismissed) });
      });
    }

    // -------------------------------------------------------------------------
    // What a chip is allowed to offer
    // -------------------------------------------------------------------------
    //
    // Two closed lists, both opt in by failure code, because the generic version
    // (any chip with a detail gets a Copy button) put the wrong control on the
    // wrong failure. They live in src/shared/failures.js, next to the code
    // definitions, so a new code cannot be added without being asked what its
    // chip may offer: failuresModule.chipAction and failuresModule.isCopyable.

    function renderChips() {
      if (!dom) return;
      dom.chipList.textContent = "";
      chips.forEach(function (chip) {
        var row = el("div", "chip");
        var text = el("div", "chip__text");
        text.appendChild(el("span", null, chip.message || chip.code));
        if (chip.remedy) text.appendChild(el("span", "chip__remedy", chip.remedy));
        // The detail is the specific fact (this page's actual origin, the exact
        // command) and it is worth showing, so it gets its own line. Without
        // this the interpolated line was stored and never shown, and the
        // reviewer only ever saw the generic remedy.
        if (chip.detail) text.appendChild(el("span", "chip__remedy", chip.detail));
        // The chip's OWN action, for the failures the reviewer fixes here rather
        // than by asking an agent. A second window is the one that matters: the
        // fix is one button, so the chip carries it.
        var action = failuresModule.chipAction(chip.code);
        if (action) {
          var actionBtn = el("button", "chip__action", action.label);
          actionBtn.setAttribute("type", "button");
          actionBtn.addEventListener("click", function () {
            // ONE CLAIM AT A TIME. A double-click posted two takeovers, and the
            // out-of-order answer stored the older session secret, which the
            // next heartbeat presented and the helper refused: the reviewer's
            // own window locked out by pressing its own fix twice. The button
            // says it is working and cannot be pressed again until the claim
            // it started has answered.
            if (actionBtn.disabled) return;
            actionBtn.disabled = true;
            var label = actionBtn.textContent;
            actionBtn.textContent = "Working…";
            var done = function () {
              actionBtn.disabled = false;
              actionBtn.textContent = label;
            };
            var ran = runAction(action.action);
            if (ran && typeof ran.then === "function") ran.then(done, done);
            else done();
          });
          text.appendChild(actionBtn);
        }
        // Copy-for-your-agent is OPT IN, per failure code, and never on a chip
        // that has its own action. It went on every chip with a detail, which
        // put it on the second-window chip and displaced the one button that
        // actually fixes that failure (Ken, live, 2026-08-18). A copy button
        // earns its place only where handing the line to an agent IS the
        // remedy, which is what COPYABLE_CODES lists.
        if (chip.detail && failuresModule.isCopyable(chip.code)) {
          var copy = el("button", "chip__copy", "Copy for your agent");
          copy.addEventListener("click", function () {
            var nav = typeof navigator !== "undefined" ? navigator : null;
            var wrote =
              nav && nav.clipboard && nav.clipboard.writeText
                ? nav.clipboard.writeText(chip.detail)
                : Promise.reject(new Error("no clipboard"));
            wrote.then(
              function () {
                copy.textContent = "Copied";
              },
              function () {
                // No clipboard access: the text is already on screen to select.
                copy.textContent = "Select the line above";
              }
            );
          });
          text.appendChild(copy);
        }
        row.appendChild(text);
        if (chip.count > 1) row.appendChild(el("span", "chip__count", "×" + chip.count));
        var x = el("button", "chip__x", "×");
        x.setAttribute("aria-label", "Dismiss");
        x.addEventListener("click", function () {
          failuresApi.dismiss(chip.code);
        });
        row.appendChild(x);
        dom.chipList.appendChild(row);
      });
    }

    /**
     * What each chip is OFFERING the reviewer right now: its code, and the label
     * on every button it drew (its own action, the copy button, or neither).
     *
     * The chips live in a closed shadow root, so a spec cannot reach them with a
     * selector, and "the second-window chip has a Review here button and no Copy
     * button" is exactly the claim that broke live. This is how it is asserted.
     *
     * @returns {Array<{code: string, buttons: Array<string>}>}
     */
    function chipControls() {
      if (!dom) return [];
      var out = [];
      var rows = dom.chipList.children;
      for (var i = 0; i < rows.length; i += 1) {
        var buttons = [];
        var found = rows[i].querySelectorAll("button");
        for (var b = 0; b < found.length; b += 1) {
          // The dismiss × is chrome on every chip, never an offer.
          if (found[b].className !== "chip__x") buttons.push(found[b].textContent);
        }
        out.push({ code: chips[i] ? chips[i].code : null, buttons: buttons });
      }
      return out;
    }

    var failuresApi = {
      add: function (failure) {
        if (!failure || !failure.code) throw new TypeError("failures.add expects a failure object");
        if (dismissed[failure.code]) return null;
        var existing = chips.filter(function (f) {
          return f.code === failure.code;
        })[0];
        if (existing) {
          // A standing failure re-raised means "still true", never "again":
          // its chip updates in place and never counts (failures.js STANDING).
          if (!failure.standing && !existing.standing) {
            existing.count = (existing.count || 1) + 1;
          }
          existing.at = failure.at;
          existing.detail = failure.detail;
          saveChips();
          renderChips();
          return existing;
        }
        var entry = Object.assign({}, failure, { count: 1, dismissed: false });
        chips.push(entry);
        saveChips();
        renderChips();
        return entry;
      },
      dismiss: function (code) {
        var n = chips.length;
        chips = chips.filter(function (f) {
          return f.code !== code;
        });
        dismissed[code] = true;
        saveChips();
        renderChips();
        return chips.length !== n;
      },
      // Remove a chip because its condition ENDED, without the dismissed mark
      // that would suppress the code forever. A window that just took the
      // review over must not keep wearing "another window is reviewing this
      // page", and a page whose helper just answered must not keep wearing "the
      // local helper is not reachable"; the next real failure still gets a chip.
      //
      // With no code, every chip goes. It used to be TWO clear functions in this
      // one object literal, so the no-argument one silently won and clearing one
      // standing chip wiped the whole list.
      //
      // CLEARING NOTHING CHANGES NOTHING. A save is a browser-storage write and
      // a render tears the whole chip list down and rebuilds it, so a caller
      // that clears a code with no chip on it (the sync client does, on every
      // successful poll) was destroying and recreating the OTHER chips' buttons
      // once a second: the "Copy for your agent" button lost its "Copied"
      // confirmation, and a click straddling a rebuild landed on a detached
      // node (review, 2026-08-17).
      clear: function (code) {
        var n = chips.length;
        chips = chips.filter(function (f) {
          return code === undefined || code === null ? false : f.code !== code;
        });
        if (chips.length === n) return false;
        saveChips();
        renderChips();
        return true;
      },
      isDismissed: function (code) {
        return dismissed[code] === true;
      },
      list: function () {
        return chips.slice();
      },
      count: function () {
        return chips.length;
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
        renderStatus();
        return null;
      }
      if (!Object.prototype.hasOwnProperty.call(STATUS_TEXT, state)) {
        throw new Error(
          "setStatusLine: unknown status " + String(state) + "; expected one of " + Object.keys(STATUS_TEXT).join(", ")
        );
      }
      status = state;
      renderStatus();
      return status;
    }

    function getStatusLine() {
      return status;
    }

    function statusText() {
      return status ? STATUS_TEXT[status] : null;
    }

    /**
     * The helper's answer to "is an agent listening?".
     *
     * Takes the whole `agent_liveness` object from `replies.poll`, or null to
     * clear the line. An unknown state clears it too rather than throwing: this
     * comes off the wire, and a rail that breaks on an unfamiliar string is
     * worse than a rail that says nothing about a state it does not know.
     *
     * EVERY DELIVERY REPAINTS. The sync client no longer calls this only when
     * the state string changes, and the line is redrawn from the object each
     * time rather than trusted to be what it already said.
     */
    function setAgentLiveness(liveness) {
      agentLiveness = liveness && typeof liveness === "object" ? liveness : null;
      renderAgent();
      return agentLiveness;
    }

    function getAgentState() {
      return agentLiveness && typeof agentLiveness[AGENT_FIELD.STATE] === "string"
        ? agentLiveness[AGENT_FIELD.STATE]
        : null;
    }

    /** "12m" for a timestamp, or null. The rail's units, not a clock. */
    function agentAge(iso, atMs) {
      if (typeof iso !== "string" || !iso) return null;
      var then = Date.parse(iso);
      if (Number.isNaN(then)) return null;
      var seconds = Math.max(0, Math.round(((typeof atMs === "number" ? atMs : now()) - then) / 1000));
      if (seconds < 60) return seconds + "s";
      if (seconds < 3600) return Math.round(seconds / 60) + "m";
      if (seconds < 86400) return Math.round(seconds / 3600) + "h";
      return Math.round(seconds / 86400) + "d";
    }

    /** Milliseconds since a timestamp on the liveness object, or null. */
    function sinceMs(field, atMs) {
      var iso = agentLiveness ? agentLiveness[field] : null;
      if (typeof iso !== "string" || !iso) return null;
      var then = Date.parse(iso);
      if (Number.isNaN(then)) return null;
      return Math.max(0, (typeof atMs === "number" ? atMs : now()) - then);
    }

    /**
     * The agent half of the status line: a quiet indicator most of the time, and
     * one escalation when the reviewer's feedback has gone unanswered.
     *
     * THE QUIET HALF is a convenience, and it is deliberately two words with no
     * verb in them. A reviewer looks at it twice: when they start ("will my
     * comments actually reach the agent?") and when they come back from a break
     * ("did anything die while I was away?"). Both are the same question, is the
     * chain intact, so it gets a glanceable answer and nothing more. Everything
     * else the tool knows about the connection is in the hover text.
     *
     * THE ESCALATION is the part that matters, and its job is to hand the
     * reviewer a way OUT rather than to diagnose anything. Feedback that has sat
     * unanswered past QUIET_MS gets: what has happened (nothing), how long, and
     * the export path right there beside it, because the reviewer's real problem
     * at that moment is getting their work to an agent some other way.
     *
     * THE NUMBER IS COMPUTED HERE, on every paint, from the timestamp. The
     * helper repeats an unchanged payload for as long as nothing changes, so a
     * number baked in by the helper would sit there saying 1m an hour later.
     */
    function agentLine() {
      var state = getAgentState();
      var waitedMs = sinceMs(AGENT_FIELD.OLDEST_UNANSWERED_AT);
      // Speaking: something the reviewer submitted has gone unanswered long
      // enough to be worth saying. A state we do not recognise never speaks: it
      // comes off the wire, and a rail that invents a sentence for an unfamiliar
      // string is worse than a rail that stays quiet.
      var speaking =
        !!state &&
        Object.prototype.hasOwnProperty.call(AGENT_TEXT, state) &&
        waitedMs !== null &&
        waitedMs >= AGENT_QUIET_MS;
      if (speaking) {
        return {
          state: state,
          text: fillAge(AGENT_TEXT[state], waitedMs),
          // LOUD IS THE WAIT'S DOING, and only where the wait means something is
          // wrong. An agent that is mid-task stays calm however long the queue
          // behind it has grown, because the wait is explained. Nothing coming
          // back for ten minutes is not, and neither is nobody having picked it
          // up: a file tail can be armed all afternoon over an agent that
          // stopped reading, so no amount of listening buys quiet here.
          loud: agentOverdue(state, waitedMs),
          speaking: true,
          waitedMs: waitedMs
        };
      }
      // Quiet: the connection, in two words, or nothing at all when the machine
      // cannot be asked. A shrug is not a status.
      var listening = agentLiveness ? agentLiveness[AGENT_FIELD.LISTENING] : null;
      if (listening !== true && listening !== false) return null;
      return {
        state: listening ? "connected" : "absent",
        text: listening ? AGENT_CONNECTION.connected : AGENT_CONNECTION.absent,
        loud: false,
        speaking: false,
        waitedMs: waitedMs
      };
    }

    /**
     * The hover text: everything the tool actually knows about the connection.
     *
     * Assembled rather than picked, so a reviewer who is curious or worried gets
     * the whole picture in one place while the line itself stays short. The
     * order is the order someone would ask: is the helper there, is an agent on
     * this, when did it last say anything, how long has my thing been sitting,
     * and where is my work.
     */
    function statusTitle(line) {
      var parts = [];
      parts.push(status === STATUS.STORED ? AGENT_DETAIL.helper_up : AGENT_DETAIL.helper_down);
      if (status === STATUS.STORED) {
        var listening = agentLiveness ? agentLiveness[AGENT_FIELD.LISTENING] : null;
        if (listening === true) parts.push(AGENT_DETAIL.agent_connected);
        else if (listening === false) parts.push(AGENT_DETAIL.agent_absent);
        else parts.push(AGENT_DETAIL.agent_unknown);
        var agentName = sessionName();
        if (agentName) parts.push(fillName(AGENT_DETAIL.agent_named, agentName));

        var repliedMs = sinceMs(AGENT_FIELD.LAST_REPLY_AT);
        parts.push(
          repliedMs === null
            ? AGENT_DETAIL.never_replied
            : AGENT_DETAIL.replied.replace("{reply}", ageLabel(repliedMs))
        );

        var waitedMs = sinceMs(AGENT_FIELD.OLDEST_UNANSWERED_AT);
        if (waitedMs !== null) parts.push(fillAge(AGENT_DETAIL.waiting, waitedMs));
      }
      parts.push(AGENT_DETAIL.stored);
      if (line && line.speaking) parts.push(AGENT_DETAIL.save);
      return parts.join(" ");
    }

    /** "40s", "6m", "2h". The rail's units, not a clock. */
    function ageLabel(ms) {
      var seconds = Math.max(0, Math.round(ms / 1000));
      if (seconds < 60) return seconds + "s";
      if (seconds < 3600) return Math.round(seconds / 60) + "m";
      if (seconds < 86400) return Math.round(seconds / 3600) + "h";
      return Math.round(seconds / 86400) + "d";
    }

    function fillAge(template, ms) {
      return String(template).replace("{age}", ageLabel(ms));
    }

    // -------------------------------------------------------------------------
    // Making an overdue wait prominent
    // -------------------------------------------------------------------------
    //
    // Ken, 2026-09-16: "active boxes should change color if they haven't been
    // picked up after a certain amount of time. something with more prominence
    // should tell you to go check your agent or assign a new one to this doc."
    //
    // Two surfaces, and neither has a rule of its own. The banner shows exactly
    // while the footer line is loud. A card is late when it is itself waiting
    // (ready, no reply) and ITS OWN wait passes agentOverdue under the review's
    // current state. A reply lands on the item, so the card goes back at once.

    /**
     * A name, filled in literally. A function replacer, because a string one
     * reads $& and $' in the name as patterns and mangles it.
     */
    function fillName(template, name) {
      return String(template).replace("{name}", function () {
        return name;
      });
    }

    /** Is this card late, and how long has it waited? Works with no document. */
    function cardWaitFor(card, agentState) {
      var item = card && card.item;
      var none = { overdue: false, waitedMs: null, text: "" };
      if (!item || status !== STATUS.STORED || !record.isUnansweredReady(item)) return none;
      // R4: a held item never turns amber. This clock is computed off the
      // item's OWN local timestamp, not off anything the helper has said, so
      // an item that has never reached the helper would otherwise start
      // counting anyway. isItemHeld is the one thing standing between "the
      // helper has never heard of this" and a client clock that does not know
      // that.
      if (isItemHeld(item[record.FIELD.ID])) return none;
      var at = item[record.FIELD.UPDATED_AT] || item[record.FIELD.CREATED_AT] || null;
      var then = typeof at === "string" ? Date.parse(at) : NaN;
      if (Number.isNaN(then)) return none;
      var waitedMs = Math.max(0, now() - then);
      var state = agentState === undefined ? getAgentState() : agentState;
      if (!agentOverdue(state, waitedMs)) return { overdue: false, waitedMs: waitedMs, text: "" };
      return { overdue: true, waitedMs: waitedMs, text: fillAge(AGENT_PROMINENT.CARD, waitedMs) };
    }

    function cardWait(id) {
      return cardWaitFor(cards[id]);
    }

    function paintCardWait(card, agentState) {
      if (!dom || !card || !card.node || !card.parts) return;
      var wait = cardWaitFor(card, agentState);
      if (wait.overdue) card.node.setAttribute(CARD_LATE_ATTR, "true");
      else card.node.removeAttribute(CARD_LATE_ATTR);
      card.parts.wait.textContent = wait.text;
      var sentAt = card.parts.time.getAttribute("title");
      if (wait.overdue && sentAt) card.parts.wait.setAttribute("title", sentAt);
      else card.parts.wait.removeAttribute("title");
    }

    /** What the banner says, and whether it is up. Works with no document. */
    function waitBanner(line) {
      var current = line || statusLine();
      var sessionId = agentLiveness ? agentLiveness[AGENT_FIELD.SESSION_ID] : null;
      var name = sessionName();
      var message = protocol.AGENT_LIVENESS.handoffMessage(
        typeof sessionId === "string" ? sessionId : null,
        name,
        !!(agentLiveness && agentLiveness[AGENT_FIELD.STATE_DIR_FLAG] === true)
      );
      var shown = !!current.loud;
      var state = shown ? current.agentState : null;
      var template =
        state && AGENT_PROMINENT.BANNER[state] ? AGENT_PROMINENT.BANNER[state] : AGENT_PROMINENT.BANNER.waiting;
      return {
        shown: shown,
        state: state,
        text: shown ? fillAge(template, current.agedMs || 0) : "",
        check: name ? fillName(AGENT_PROMINENT.CHECK_NAMED, name) : AGENT_PROMINENT.CHECK,
        agedMs: current.agedMs || 0,
        name: name,
        button: AGENT_PROMINENT.HANDOFF_BUTTON,
        message: message
      };
    }

    /** The human's name for the owning session, off the wire, or null. */
    function sessionName() {
      var value = agentLiveness ? agentLiveness[AGENT_FIELD.NAME] : null;
      return typeof value === "string" && value.trim() ? value.trim() : null;
    }

    /**
     * The collapsed pill, on the same rule. Late exactly while the banner is up,
     * showing the wait, with the banner's sentence as its hover text. Works with
     * no document.
     */
    function pillWait(banner) {
      var b = banner || waitBanner();
      if (!b.shown) return { late: false, text: "", title: PILL_TITLE };
      return {
        late: true,
        text: ageLabel(b.agedMs),
        title: b.text + " " + b.check + " " + PILL_TITLE
      };
    }

    /**
     * ONE NOTICE PER CROSSING.
     *
     * Raised only when the banner goes from not shown to shown, so answering
     * the oldest late item while another is still late raises nothing: the
     * banner never left. The key is the review, the oldest waiting item the
     * helper names, and that item's wait-start, so a follow-up that puts the
     * same item back into waiting is a new wait with a new notice. Keys already
     * raised are kept in sessionStorage, so a reload, a remount or the next page
     * of a folder review does not raise the same one again. Without storage the
     * toast system's own memory still stops repeats within this page.
     */
    function raiseOverdueToast(banner) {
      // Not while presenting, and the crossing is not counted either: the
      // notice would be spent on nobody. The first repaint after the talk
      // raises it.
      if (presenting) return null;
      var was = overdueShown;
      overdueShown = banner.shown;
      if (!banner.shown || was) return null;
      var itemId = agentLiveness ? agentLiveness[AGENT_FIELD.OLDEST_ITEM] : null;
      var waitStart = agentLiveness ? agentLiveness[AGENT_FIELD.OLDEST_UNANSWERED_AT] : null;
      if (typeof itemId !== "string" || !itemId || typeof waitStart !== "string" || !waitStart) return null;
      var key = "overdue:" + String(reviewId || "") + ":" + itemId + ":" + waitStart;
      if (overdueSeen(key)) return null;
      rememberOverdue(key);
      var check = banner.name
        ? fillName(AGENT_PROMINENT.TOAST_CHECK_NAMED, banner.name)
        : AGENT_PROMINENT.TOAST_CHECK;
      return showToast({
        key: key,
        label: AGENT_PROMINENT.TOAST_LABEL,
        text: banner.text + " " + check + " " + AGENT_PROMINENT.TOAST_OPEN,
        onOpen: function () {
          collapse(false);
        }
      });
    }

    var OVERDUE_SEEN_PREFIX = "lahe:overdue-notices:";
    var OVERDUE_SEEN_MAX = 50;

    function overdueStorage() {
      if (sessionStorageOverride) return sessionStorageOverride;
      try {
        var view = doc && doc.defaultView;
        return view && view.sessionStorage ? view.sessionStorage : null;
      } catch (err) {
        return null;
      }
    }

    function overdueSeenList() {
      try {
        var storage = overdueStorage();
        if (!storage) return [];
        var parsed = JSON.parse(storage.getItem(OVERDUE_SEEN_PREFIX + String(reviewId || "")) || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }

    function overdueSeen(key) {
      return overdueSeenList().indexOf(key) !== -1;
    }

    function rememberOverdue(key) {
      try {
        var storage = overdueStorage();
        if (!storage) return false;
        var list = overdueSeenList().concat([key]).slice(-OVERDUE_SEEN_MAX);
        storage.setItem(OVERDUE_SEEN_PREFIX + String(reviewId || ""), JSON.stringify(list));
        return true;
      } catch (err) {
        return false;
      }
    }

    /** Self-report for the closed root: what the pill renders. */
    function pillWaitInfo() {
      if (!dom || !dom.pill) return { present: false };
      var view = dom.pill.ownerDocument ? dom.pill.ownerDocument.defaultView : null;
      var computed = view ? view.getComputedStyle(dom.pill) : null;
      var waitComputed = view ? view.getComputedStyle(dom.pillWait) : null;
      var box = dom.pill.getBoundingClientRect();
      return {
        present: true,
        visible: !!computed && computed.display !== "none",
        late: dom.pill.getAttribute("data-lahe-late") === "true",
        held: dom.pill.getAttribute("data-lahe-held") === "true",
        waitText: dom.pillWait.textContent || "",
        waitVisible: !!waitComputed && waitComputed.display !== "none",
        border: computed ? computed.borderTopColor : null,
        title: dom.pill.title || "",
        box: { x: box.left, y: box.top, width: box.width, height: box.height }
      };
    }

    /** Self-report for the closed root: what the Hold toggle renders. */
    function holdInfo() {
      if (!dom || !dom.holdBtn) return { present: false };
      var view = dom.holdBtn.ownerDocument ? dom.holdBtn.ownerDocument.defaultView : null;
      var computed = view ? view.getComputedStyle(dom.holdBtn) : null;
      return {
        present: true,
        visible: !!computed && computed.display !== "none",
        pressed: dom.holdBtn.getAttribute("aria-pressed") === "true",
        label: dom.holdBtn.getAttribute("aria-label") || "",
        countText: dom.holdCount.textContent || "",
        countLive: dom.holdCount.getAttribute("aria-live") || ""
      };
    }

    function renderWaitBanner(banner) {
      if (!dom || !dom.late) return;
      dom.late.setAttribute("data-shown", banner.shown ? "true" : "");
      dom.lateTitle.textContent = banner.text;
      // textContent, never innerHTML: the agent's name is display text.
      dom.lateCheck.textContent = banner.check;
      if (!banner.shown) {
        handoffNote = "";
        handoffFailed = false;
      }
      dom.lateNote.textContent = handoffNote;
      dom.lateMessage.textContent = banner.message;
      dom.lateMessage.setAttribute("data-shown", handoffFailed ? "true" : "");
    }

    function clipboardTarget() {
      if (clipboardOverride) return clipboardOverride;
      var view = doc && doc.defaultView;
      if (view && view.navigator && view.navigator.clipboard) return view.navigator.clipboard;
      return null;
    }

    /**
     * Copy the handoff message. No false success: a clipboard that refused
     * says so on the banner and shows the message to copy by hand.
     *
     * @returns {Promise<{ok: boolean, text: string, error?: string}>}
     */
    function copyHandoff() {
      var text = waitBanner().message;
      var target = clipboardTarget();
      var write =
        target && typeof target.writeText === "function"
          ? Promise.resolve().then(function () {
              return target.writeText(text);
            })
          : Promise.reject(new Error("this browser gave the page no clipboard to write to"));
      return write.then(
        function () {
          handoffNote = AGENT_PROMINENT.COPIED;
          handoffFailed = false;
          renderStatus();
          return { ok: true, text: text };
        },
        function (error) {
          handoffNote = AGENT_PROMINENT.COPY_FAILED;
          handoffFailed = true;
          renderStatus();
          return { ok: false, text: text, error: String((error && error.message) || error) };
        }
      );
    }

    /** Self-report for the closed root: what the banner renders, and where. */
    function waitBannerInfo() {
      if (!dom || !dom.late) return { present: false };
      var view = dom.late.ownerDocument ? dom.late.ownerDocument.defaultView : null;
      var computed = view ? view.getComputedStyle(dom.late) : null;
      var railBox = dom.rail.getBoundingClientRect();
      var box = dom.late.getBoundingClientRect();
      var tabsNode = dom.rail.querySelector(".tabs");
      var tabsBox = tabsNode ? tabsNode.getBoundingClientRect() : null;
      return {
        present: true,
        visible: !!computed && computed.display !== "none",
        text: dom.lateTitle.textContent || "",
        check: dom.lateCheck.textContent || "",
        // Elements inside the check line. A name is text, so this stays 0 even
        // for a name written as markup.
        checkElements: dom.lateCheck.children.length,
        buttonText: dom.lateBtn.textContent || "",
        note: dom.lateNote.textContent || "",
        background: computed ? computed.backgroundColor : null,
        messageVisible: dom.lateMessage.getAttribute("data-shown") === "true",
        // Where the button is, so a test can press it like a person would.
        button: (function () {
          var b = dom.lateBtn.getBoundingClientRect();
          return { x: b.left, y: b.top, width: b.width, height: b.height };
        })(),
        railBox: { x: railBox.left, y: railBox.top, width: railBox.width, height: railBox.height },
        topInRail: box.top - railBox.top,
        aboveTabs: !!tabsBox && box.bottom <= tabsBox.top + 0.5
      };
    }

    /** Self-report for the closed root: whether a card is drawn late. */
    function cardWaitInfo(id) {
      var card = cards[id];
      if (!dom || !card || !card.node) return { present: false };
      var view = card.node.ownerDocument ? card.node.ownerDocument.defaultView : null;
      var computed = view ? view.getComputedStyle(card.node) : null;
      var waitComputed = view ? view.getComputedStyle(card.parts.wait) : null;
      return {
        present: true,
        late: card.node.getAttribute(CARD_LATE_ATTR) === "true",
        background: computed ? computed.backgroundColor : null,
        border: computed ? computed.borderTopColor : null,
        waitText: card.parts.wait.textContent || "",
        waitVisible: !!waitComputed && waitComputed.display !== "none"
      };
    }

    /**
     * ONE LINE, and this is where the two halves become it.
     *
     * Storage first, because a reviewer whose work is not stored yet does not
     * need to hear about agents: nothing has reached one. Then the agent half,
     * which is only ever added to "Stored", because that is the only state in
     * which an agent could have had the work at all.
     */
    function statusLine() {
      var storage = status ? STATUS_SHORT[status] : "Kept in this browser";
      // The agent half only rides a line that says the work IS stored. A
      // reviewer whose work has not reached the helper does not need to hear
      // about agents: nothing has reached one.
      var agent = status === STATUS.STORED ? agentLine() : null;
      return {
        status: status,
        agentState: agent ? agent.state : null,
        text: agent ? storage + " · " + agent.text : storage,
        title: statusTitle(agent),
        loud: !!(agent && agent.loud),
        speaking: !!(agent && agent.speaking),
        agedMs: agent ? agent.waitedMs : null
      };
    }

    function renderAgent() {
      armAgentAgeTick();
      renderStatus();
    }

    /**
     * The one timer this file owns, and it runs only while it has to.
     *
     * The helper sends the same payload for as long as nothing changes, so
     * "nothing back yet, 1m" would sit there saying 1m an hour later. This
     * re-reads the clock.
     *
     * It is armed by THERE BEING AN ELAPSED TIME ON THE LINE, in any state. That
     * is what lets a calm line go loud on its own, and what lets a quiet one
     * start speaking: an item that crosses two minutes has to start saying so,
     * and one that crosses ten has to go loud, without one further word from the
     * helper. A line with no clock in it, and an unmounted rail, hold no timer.
     */
    function armAgentAgeTick() {
      var needed = mounted && waitingSoon();
      if (needed === !!agentAgeTimer) return agentAgeTimer;
      if (!needed) {
        if (timers) timers.clearInterval(agentAgeTimer);
        agentAgeTimer = null;
        return null;
      }
      if (!timers) return null;
      agentAgeTimer = timers.setInterval(function () {
        renderStatus();
        armAgentAgeTick();
      }, AGENT_AGE_TICK_MS);
      return agentAgeTimer;
    }

    /**
     * Is there an unanswered item whose age the line is counting?
     *
     * The timer has to be running BEFORE the line has anything to say, or the
     * moment a wait crosses the threshold would arrive with nothing to notice it
     * and the line would sit on the quiet indicator until the helper next
     * changed its mind. A rail with nothing waiting, and an unmounted rail, hold
     * no timer at all.
     */
    function waitingSoon() {
      var state = getAgentState();
      if (!state || !Object.prototype.hasOwnProperty.call(AGENT_TEXT, state)) return false;
      return sinceMs(AGENT_FIELD.OLDEST_UNANSWERED_AT) !== null;
    }

    /**
     * How many status rows the FOOTER actually paints.
     *
     * The shadow root is closed, so this is the only way a test can hold the
     * footer to ONE line. It counts role="status" rows, which is also what a
     * screen reader announces: two of them was two announcements that could
     * disagree with each other. Scoped to the footer, because a card's own
     * notice is a status too and is nobody's contradiction.
     */
    function statusRowCount() {
      if (!dom || !dom.foot) return 0;
      return dom.foot.querySelectorAll('[role="status"]').length;
    }

    /**
     * Self-report for the closed root: what the one status line actually renders.
     *
     * The shadow root is closed, so a browser test cannot query it. It reads
     * COMPUTED style rather than the attribute, because "the state is set" was
     * true the whole time the row could have been display:none, and the whole
     * point of the line is that a reviewer sees it.
     */
    function statusLineInfo() {
      if (!dom) return { present: false };
      var view = dom.statusRow.ownerDocument ? dom.statusRow.ownerDocument.defaultView : null;
      var computed = view ? view.getComputedStyle(dom.statusRow) : null;
      var dotComputed = view ? view.getComputedStyle(dom.statusDot) : null;
      return {
        present: true,
        status: dom.statusRow.getAttribute("data-status") || "",
        agentState: dom.statusRow.getAttribute("data-agent") || "",
        loud: dom.statusRow.getAttribute("data-loud") === "true",
        text: dom.statusText.textContent || "",
        title: dom.statusRow.title || "",
        display: computed ? computed.display : null,
        visible: !!computed && computed.display !== "none",
        weight: computed ? computed.fontWeight : null,
        dotColor: dotComputed ? dotComputed.backgroundColor : null
      };
    }

    // The one case nothing can refuse (D5): two windows, separate storage, no
    // helper. It is said here rather than claimed as covered anywhere.
    function setLimitNote(text) {
      limitText = text || null;
      renderStatus();
      return limitText;
    }

    // D5's refusal panel and its "Review here instead" button (finding 12). The
    // click is wired through onAction("takeover"), the same seam Copy and Export
    // use, so boot owns what the button actually does.
    function showRefusal(info) {
      var i = info || {};
      // Remembered before the dom check on purpose: a refusal that arrives
      // before mount (or between remounts) is re-applied by mount, not lost.
      refusalInfo = { reason: i.reason || null };
      if (!dom) return false;
      dom.refusalReason.textContent = i.reason || "This review is already open in another window.";
      dom.refusalBtn.disabled = false;
      dom.refusalBtn.textContent = "Review here instead";
      dom.refusal.setAttribute("data-shown", "true");
      // A refusal behind the collapsed pill is invisible, and a reviewer who
      // cannot type and is told nothing reads it as "broken" (Ken hit exactly
      // this on first real use). Expanding is safe here: a refused window is
      // read-only, so there is no focused card for the expand to disturb.
      setCollapsed(false, false);
      return true;
    }

    function hideRefusal() {
      refusalInfo = null;
      if (!dom) return false;
      dom.refusal.removeAttribute("data-shown");
      // Reset the button out of its "Moving the review here…" pending state,
      // so the next refusal (or a probe) never meets a stuck disabled button.
      dom.refusalBtn.disabled = false;
      dom.refusalBtn.textContent = "Review here instead";
      // Put the rail back where the reviewer chose to keep it. If they changed
      // that choice while the refusal was visible, preferredCollapsed already
      // carries the newer answer.
      setCollapsed(preferredCollapsed, false);
      return true;
    }

    // While the takeover request is in flight, the button says so and cannot be
    // pressed twice.
    function markRefusalPending() {
      if (!dom) return false;
      dom.refusalBtn.disabled = true;
      dom.refusalBtn.textContent = "Moving the review here…";
      return true;
    }

    function refusalShown() {
      return !!(dom && dom.refusal.getAttribute("data-shown") === "true");
    }

    // Self-report for the closed root: is the Review-here button really on
    // screen, pressable, and labeled? The panel showing while its button is
    // missing was a real failure mode (a chip told the reviewer to press a
    // button that did not exist), so tests and probes ask for the geometry,
    // not just the flag.
    function refusalButtonInfo() {
      if (!dom || !dom.refusalBtn) return { present: false };
      var rect = dom.refusalBtn.getBoundingClientRect();
      return {
        present: true,
        label: dom.refusalBtn.textContent,
        disabled: !!dom.refusalBtn.disabled,
        visible: refusalShown() && rect.width > 0 && rect.height > 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    }

    // -------------------------------------------------------------------------
    // End review (D10): ask, then hand the click on
    // -------------------------------------------------------------------------
    //
    // The rail owns the asking and the words; what ending DOES is boot's, wired
    // through the same runAction seam Copy, Export and the takeover use. The
    // panel's confirm button follows the failure chip's rule: an action that
    // returns a promise disables its own control and says it is working, so a
    // double press cannot post twice.

    function askEndReview() {
      if (endRunning) return null;
      return runAction("end");
    }

    /**
     * Ask before ending, and stay up while the ending runs.
     *
     * @param {{unanswered?: number, drafts?: number, run?: function(): Promise}} options
     *   `run` is the work: it resolves to {ok, message}. The panel disables its
     *   own buttons while it runs and then paints the message, so the reviewer
     *   never watches a control they pressed do nothing.
     * @returns {Promise<{confirmed: boolean, result: ?object}>}
     */
    function promptEndReview(options) {
      var o = options || {};
      if (!dom || !dom.endPanel) return Promise.resolve({ confirmed: false, result: null });
      if (endPrompt) return endPrompt;

      dom.endTitle.textContent = END_REVIEW.TITLE;
      dom.endWhat.textContent = unfinishedSentence({ unanswered: o.unanswered || 0, drafts: o.drafts || 0 });
      dom.endKept.textContent = END_REVIEW.KEPT;
      dom.endGo.textContent = END_REVIEW.CONFIRM;
      dom.endGo.hidden = false;
      dom.endGo.disabled = false;
      dom.endNo.textContent = END_REVIEW.CANCEL;
      dom.endNo.disabled = false;
      dom.endPanel.setAttribute("data-shown", "true");
      // A question behind the collapsed pill is a question nobody answers.
      setCollapsed(false, false);
      // The keyboard lands on the way BACK, not on the door: this panel is a
      // pause, and a confirm button under a stray Enter is not a pause.
      dom.endNo.focus();

      endRun = typeof o.run === "function" ? o.run : null;
      endPrompt = new Promise(function (resolve) {
        endResolve = resolve;
      });
      return endPrompt;
    }

    function settleEndPrompt(answer) {
      var resolve = endResolve;
      endPrompt = null;
      endResolve = null;
      if (resolve) resolve(answer);
    }

    function cancelEndReview() {
      if (endRunning) return false;
      hideEndPanel();
      settleEndPrompt({ confirmed: false, result: null });
      return true;
    }

    function hideEndPanel() {
      if (!dom || !dom.endPanel) return false;
      dom.endPanel.setAttribute("data-shown", "false");
      setCollapsed(preferredCollapsed, false);
      return true;
    }

    function confirmEndReview(run) {
      if (!dom || endRunning) return null;
      endRunning = true;
      dom.endGo.disabled = true;
      dom.endNo.disabled = true;
      dom.endGo.textContent = END_REVIEW.WORKING;
      var ran = typeof run === "function" ? run() : null;
      var settled = ran && typeof ran.then === "function" ? ran : Promise.resolve(ran || { ok: true, message: END_REVIEW.ENDED });
      return settled.then(paintEndResult, function (error) {
        return paintEndResult({ ok: false, message: END_REVIEW.FAILED + String((error && error.message) || error) });
      });
    }

    function paintEndResult(result) {
      var r = result || {};
      endRunning = false;
      if (dom) {
        dom.endTitle.textContent = r.ok === false ? END_REVIEW.TITLE : END_REVIEW.ENDED_TITLE;
        dom.endWhat.textContent = r.message || (r.ok === false ? END_REVIEW.FAILED : END_REVIEW.ENDED);
        // The second line was about what ending would cost; it has happened, so
        // it has nothing left to say.
        dom.endKept.textContent = "";
        // A failure leaves the door pressable: the helper may be back in a
        // second, and the reviewer should not have to hunt for the control
        // again.
        dom.endGo.hidden = r.ok !== false;
        dom.endGo.disabled = false;
        dom.endGo.textContent = END_REVIEW.CONFIRM;
        dom.endNo.disabled = false;
        dom.endNo.textContent = END_REVIEW.CLOSE;
      }
      settleEndPrompt({ confirmed: true, result: r });
      return r;
    }

    /**
     * The door and its panel, for a spec that cannot reach into a closed root.
     * Geometry rather than flags where a flag could be true while the control
     * is nowhere on screen.
     */
    function endInfo() {
      if (!dom || !dom.endBtn) return { present: false };
      var rect = dom.endBtn.getBoundingClientRect();
      var hintsRect = dom.hints.getBoundingClientRect();
      var panelRect = dom.endPanel.getBoundingClientRect();
      return {
        present: true,
        label: dom.endBtn.getAttribute("aria-label"),
        title: dom.endBtn.title,
        text: (dom.endBtn.textContent || "").trim(),
        icon: !!dom.endBtn.querySelector("svg"),
        inMenu: dom.menuItems.some(function (node) {
          return node.getAttribute("data-action") === "end";
        }),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        hintsRect: {
          x: hintsRect.x,
          y: hintsRect.y,
          width: hintsRect.width,
          height: hintsRect.height,
          right: hintsRect.right,
          bottom: hintsRect.bottom
        },
        running: endRunning,
        panel: {
          open: dom.endPanel.getAttribute("data-shown") === "true",
          title: dom.endTitle.textContent || "",
          what: dom.endWhat.textContent || "",
          kept: dom.endKept.textContent || "",
          rect: { x: panelRect.x, y: panelRect.y, width: panelRect.width, height: panelRect.height },
          confirm: buttonReading(dom.endGo),
          cancel: buttonReading(dom.endNo)
        }
      };
    }

    function buttonReading(node) {
      var rect = node.getBoundingClientRect();
      return {
        label: (node.textContent || "").trim(),
        disabled: !!node.disabled,
        hidden: !!node.hidden,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    }

    function renderStatus() {
      // ONE READING PER REPAINT. The line, the banner, the pill, the notice and
      // every late card below read these two, rather than each working the
      // status out again.
      var line = statusLine();
      var banner = waitBanner(line);
      // Before the document check: the notice is state the toast list holds,
      // and it must be raised whether or not a rail is drawn yet.
      raiseOverdueToast(banner);
      if (!dom) return;
      dom.statusRow.setAttribute("data-status", status || "");
      dom.statusRow.setAttribute("data-agent", line.agentState || "");
      dom.statusRow.setAttribute("data-loud", line.loud ? "true" : "");
      dom.statusText.textContent = line.text;
      dom.statusRow.title = line.title;
      // The banner and the late cards run off the same clock and the same
      // liveness answer as this line, so they are repainted with it.
      renderWaitBanner(banner);
      repaintHoldChrome();
      var agentState = getAgentState();
      Object.keys(cards).forEach(function (id) {
        paintCardHeld(cards[id]);
        paintCardWait(cards[id], agentState);
      });
      // ONLY IN THE STATE IT DESCRIBES. The limit is about there being no helper
      // to see across two storage buckets, so it is on screen exactly while the
      // rail is saying nothing reached a helper. Under "Stored" it was a
      // permanent sentence contradicting the line above it, and a caveat that is
      // always on screen is a caveat nobody reads.
      var showLimit = !status || status === STATUS.KEPT_LOCALLY || status === STATUS.KEPT_UNCONFIRMED;
      dom.limit.textContent = showLimit && limitText ? limitText : "";
    }

    function renderTabs() {
      if (!dom) return;
      TABS.forEach(function (name) {
        dom.tabButtons[name].setAttribute("aria-selected", name === activeTab ? "true" : "false");
        dom.panes[name].setAttribute("data-current", name === activeTab ? "true" : "false");
        dom.counts[name].textContent = String(countFor(name));
        // ZERO UNSEEN IS NO BADGE, not a badge reading 0. A permanent little
        // dot saying "nothing new" is noise the reviewer learns to ignore, and
        // then the one that means something does not register either.
        var fresh = tabNewCounts[name] || 0;
        dom.newmarks[name].textContent = fresh ? String(fresh) : "";
        dom.newmarks[name].hidden = fresh === 0;
      });
      // THE COLLAPSED PILL'S COUNT: still to handle, then the all-time total in
      // parentheses, "3 (7)". A finished review reads "0 (7)", which is the
      // burn-down a reviewer wants to see rather than a blank pill. The rail can be
      // collapsed for most of a session, and with only the open count on it a
      // reviewer who had answered everything saw the same empty pill as one who
      // had never written anything: no sense of how much is on the page and no
      // sign the tool was alive. The total is every card the rail is holding for
      // this page, whatever tab it sits under, so a finished review reads 0/7
      // rather than blank.
      //
      // An empty pill still invites on an untouched page: "Review 0/0" prints
      // the one number that is not information.
      // The left number is lifecycle truth, not the Active tab's layout count.
      // In particular, a ready direct edit sits in Edits but remains incomplete
      // until the agent reports it handled.
      var open = countIncomplete();
      var total = Object.keys(cards).length;
      dom.pillCount.textContent = total ? String(open) + " (" + String(total) + ")" : "";
      dom.pillCount.hidden = total === 0;
      // The jewel is a VIEW of the tab badges, never a second tally. It reads
      // whatever setTabNewCount was last told, so opening Done and clearing the
      // badge clears the jewel in the same call: there is one number and two
      // places it shows.
      var fresh = pillNewCount();
      dom.pillJewel.textContent = fresh ? String(fresh) : "";
      dom.pillJewel.hidden = fresh === 0;
    }

    /**
     * The number the collapsed pill's jewel shows.
     *
     * Every tab's unseen count, added up. Today only Done fills one (replies the
     * reviewer needs to read), so this IS the Done badge's number; a second tab
     * that starts counting gets carried to the pill for free rather than needing
     * this to be taught about it.
     */
    function pillNewCount() {
      var total = 0;
      TABS.forEach(function (name) {
        total += tabNewCounts[name] || 0;
      });
      return total;
    }

    function selectTab(tab) {
      if (TABS.indexOf(tab) === -1) throw new Error("selectTab: unknown tab " + String(tab));
      activeTab = tab;
      // Handlers run BEFORE the paint, so a listener that clears its own badge
      // (the Done tab does exactly that) lands in the same frame the tab opens
      // in. Painting first would show the badge for one frame and then drop it.
      tabSelectHandlers.forEach(function (fn) {
        try {
          fn(tab);
        } catch (err) {
          // One bad listener must never leave the reviewer on a tab that did
          // not finish switching.
        }
      });
      renderTabs();
      return activeTab;
    }

    /** Tell me when the reviewer moves to a tab. Returns an unsubscribe. */
    function onTabSelect(fn) {
      if (typeof fn !== "function") throw new TypeError("onTabSelect: a function is required");
      tabSelectHandlers.push(fn);
      return function () {
        var at = tabSelectHandlers.indexOf(fn);
        if (at !== -1) tabSelectHandlers.splice(at, 1);
      };
    }

    /**
     * How many things in this tab the reviewer has not seen yet.
     *
     * The rail owns the badge; WHAT counts as unseen belongs to whoever fills
     * the tab. Zero removes it.
     */
    function setTabNewCount(tab, count) {
      if (TABS.indexOf(tab) === -1) throw new Error("setTabNewCount: unknown tab " + String(tab));
      var n = typeof count === "number" && count > 0 ? Math.floor(count) : 0;
      if (tabNewCounts[tab] === n) return n;
      tabNewCounts[tab] = n;
      renderTabs();
      return n;
    }

    function tabNewCount(tab) {
      return tabNewCounts[tab] || 0;
    }

    function currentTab() {
      return activeTab;
    }

    // Copy and Export are always one click away, in the head's menu; who does
    // the work is 3C's. The rail holds the controls and hands the click on, and
    // this seam did not move when they did.
    function onAction(name, fn) {
      actionHandlers[name] = fn;
      return function () {
        delete actionHandlers[name];
      };
    }

    function runAction(name) {
      if (typeof actionHandlers[name] === "function") return actionHandlers[name]();
      return null;
    }

    // -------------------------------------------------------------------------
    // The head's menu
    // -------------------------------------------------------------------------
    //
    // It closes on every way out a reviewer might take: choosing an item, Esc,
    // a click anywhere else (on the page or elsewhere in the rail), collapsing,
    // and unmounting. A menu that survives one of those is a menu that hangs
    // over someone's page after they have moved on.

    function openMenu(index) {
      if (!dom || menuOpen) return menuOpen;
      menuOpen = true;
      dom.menuList.hidden = false;
      dom.menuBtn.setAttribute("aria-expanded", "true");
      focusMenuItem(index || 0);
      // TWO listeners, because the root is CLOSED. A closed root hides its own
      // nodes from composedPath(), so a click on a menu item arrives at the
      // document retargeted to the host and looks exactly like a click on the
      // page: the document listener alone closed the menu before the item's own
      // click handler ever ran, and Export silently did nothing.
      //
      // So the document listener only handles what really came from outside our
      // tree, and the listener inside the shadow root, which can see real
      // targets, decides for everything within it.
      menuOutsideListener = function (event) {
        if (event.type === "keydown") {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          closeMenu(true);
          return;
        }
        if (fromOurTree(event)) return;
        closeMenu(false);
      };
      menuShadowListener = function (event) {
        if (dom.menuWrap.contains(event.target)) return;
        closeMenu(false);
      };
      doc.addEventListener("pointerdown", menuOutsideListener, true);
      doc.addEventListener("keydown", menuOutsideListener, true);
      dom.shadow.addEventListener("pointerdown", menuShadowListener, true);
      return menuOpen;
    }

    /**
     * Did this event start inside the library's own (closed) tree?
     *
     * A closed root retargets everything to its host, and the rail lives inside
     * a second closed root (the highlight surface's), so the honest test is the
     * chain of hosts from the rail's own host outwards.
     */
    function fromOurTree(event) {
      if (!dom) return false;
      var path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.indexOf(dom.menuWrap) !== -1) return true;
      var node = dom.host;
      while (node) {
        if (node === event.target || path.indexOf(node) !== -1) return true;
        var root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
        node = root && root.host ? root.host : null;
      }
      return false;
    }

    function closeMenu(returnFocus) {
      if (menuOutsideListener) {
        doc.removeEventListener("pointerdown", menuOutsideListener, true);
        doc.removeEventListener("keydown", menuOutsideListener, true);
        menuOutsideListener = null;
      }
      if (menuShadowListener) {
        if (dom) dom.shadow.removeEventListener("pointerdown", menuShadowListener, true);
        menuShadowListener = null;
      }
      if (!menuOpen) return false;
      menuOpen = false;
      if (!dom) return true;
      dom.menuList.hidden = true;
      dom.menuBtn.setAttribute("aria-expanded", "false");
      if (returnFocus) dom.menuBtn.focus();
      return true;
    }

    function toggleMenu() {
      return menuOpen ? closeMenu(true) : openMenu(0);
    }

    function focusMenuItem(index) {
      if (!dom || !dom.menuItems.length) return -1;
      var count = dom.menuItems.length;
      var next = ((index % count) + count) % count;
      dom.menuItems[next].focus();
      return next;
    }

    function focusedMenuIndex() {
      if (!dom) return -1;
      var active = dom.shadow.activeElement;
      return dom.menuItems.indexOf(active);
    }

    function onMenuKey(event) {
      if (!dom) return;
      var index = focusedMenuIndex();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusMenuItem(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusMenuItem(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusMenuItem(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusMenuItem(dom.menuItems.length - 1);
      } else if (event.key === "Tab") {
        closeMenu(false);
      }
    }

    function menuIsOpen() {
      return menuOpen;
    }

    /**
     * Self-report for the closed root: where the menu button is, whether it is
     * open, and where each item is. A test cannot query a closed root, and a
     * click that lands at the wrong coordinates is the failure this exists to
     * make impossible to fake, so the geometry comes from the rail itself the
     * way the refusal button's does.
     */
    function menuInfo() {
      if (!dom || !dom.menuBtn) return { present: false, open: false, items: [] };
      var rect = dom.menuBtn.getBoundingClientRect();
      var collapse = dom.collapseBtn.getBoundingClientRect();
      return {
        present: true,
        label: dom.menuBtn.getAttribute("aria-label"),
        title: dom.menuBtn.title,
        expanded: dom.menuBtn.getAttribute("aria-expanded"),
        open: menuOpen,
        buttonFocused: dom.shadow.activeElement === dom.menuBtn,
        focusedIndex: focusedMenuIndex(),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right },
        collapseRect: { x: collapse.x, y: collapse.y, width: collapse.width, height: collapse.height },
        items: dom.menuItems.map(function (node) {
          var r = node.getBoundingClientRect();
          return {
            action: node.getAttribute("data-action"),
            label: (node.textContent || "").trim(),
            rect: { x: r.x, y: r.y, width: r.width, height: r.height }
          };
        })
      };
    }

    // The collapsed pill never overlaps the open rail (D10), and the mechanism
    // is that the two are never on screen at the same time.
    function readCollapsedPreference() {
      if (!reviewId || !store || typeof store.readUiPreferences !== "function") return false;
      try {
        return store.readUiPreferences(reviewId).collapsed === true;
      } catch (err) {
        return false;
      }
    }

    function readPresentPreference() {
      if (!reviewId || !store || typeof store.readUiPreferences !== "function") return false;
      try {
        return store.readUiPreferences(reviewId).present === true;
      } catch (err) {
        return false;
      }
    }

    /**
     * Which cards this review had folded last time, as an id -> true map.
     *
     * Best effort, like every other read in this bucket: a denied or corrupt
     * storage costs the reviewer their folds, which come back with one click,
     * and never a word of their own work.
     */
    function readCardCollapsePreference() {
      var out = Object.create(null);
      if (!reviewId || !store || typeof store.readUiPreferences !== "function") return out;
      try {
        var got = store.readUiPreferences(reviewId).cards || {};
        Object.keys(got).forEach(function (id) {
          if (got[id] === true) out[id] = true;
        });
      } catch (err) {
        return Object.create(null);
      }
      return out;
    }

    /** The folded ids as a plain object, which is what the store writes. */
    function collapsedCardsValue() {
      var out = {};
      Object.keys(collapsedCards).forEach(function (id) {
        out[id] = true;
      });
      return out;
    }

    function persistCollapsedPreference() {
      if (!reviewId || !store || typeof store.writeUiPreferences !== "function") return false;
      try {
        // EVERY FIELD, ALWAYS. The bucket is written whole, so writing one and
        // omitting another is how a reviewer collapses the rail and finds the
        // pill back in the corner they dragged it out of, or drags the rail
        // wider and finds it narrow again after collapsing it once.
        store.writeUiPreferences(reviewId, {
          collapsed: preferredCollapsed,
          pill: pillSpot,
          width: railWidth,
          present: presenting,
          cards: collapsedCardsValue()
        });
        return true;
      } catch (err) {
        return false;
      }
    }

    // -------------------------------------------------------------------------
    // Moving the pill out of the page's way
    // -------------------------------------------------------------------------
    //
    // The pill sits bottom-right because that is out of the way of most pages.
    // It is not out of the way of ALL pages: Ken, on a site with its own bottom
    // bar for thumb reach, "it's covering the buttons and i need to drag it to a
    // different location". The tool is a guest on somebody else's page and it
    // cannot know what is underneath it, so the reviewer moves it.
    //
    // A CORNER AND TWO OFFSETS, not a point. See store.readPillSpot: a phone
    // rotates, an address bar slides away, a window gets dragged narrower, and a
    // remembered x/y is off screen after any of them.

    // How far a pointer travels before this is a drag rather than a press. Small
    // enough that a deliberate move is recognized at once, large enough that a
    // thumb tap, which never lands perfectly still, still opens the rail.
    var PILL_DRAG_SLOP = 5;
    var PILL_EDGE_GAP = 8;

    var pillSpot = null;
    var pillDrag = null;

    function readPillPreference() {
      if (!reviewId || !store || typeof store.readUiPreferences !== "function") return null;
      try {
        return store.readUiPreferences(reviewId).pill || null;
      } catch (err) {
        return null;
      }
    }

    /** The viewport, asked of the document the rail is actually in. */
    function viewportOf(node) {
      var view = node && node.ownerDocument ? node.ownerDocument.defaultView : null;
      if (!view) return null;
      return { w: view.innerWidth, h: view.innerHeight };
    }

    /**
     * Put the pill where the reviewer left it, clamped so it is always reachable.
     *
     * Clamped on every apply rather than only on drag: the offsets outlive the
     * viewport that produced them, and a pill three quarters off a rotated phone
     * is a pill the reviewer cannot drag back.
     */
    function applyPillSpot() {
      var node = dom && dom.pill;
      if (!node) return false;
      if (!pillSpot) {
        node.style.left = "";
        node.style.top = "";
        node.style.right = "";
        node.style.bottom = "";
        return false;
      }
      var view = viewportOf(node);
      var size = { w: node.offsetWidth || 0, h: node.offsetHeight || 0 };
      var maxX = view ? Math.max(0, view.w - size.w - PILL_EDGE_GAP) : pillSpot.x;
      var maxY = view ? Math.max(0, view.h - size.h - PILL_EDGE_GAP) : pillSpot.y;
      var x = Math.min(Math.max(pillSpot.x, PILL_EDGE_GAP), maxX);
      var y = Math.min(Math.max(pillSpot.y, PILL_EDGE_GAP), maxY);
      // "auto", not "". Clearing the inline value hands the side back to the
      // stylesheet, and the stylesheet still says right:16px and bottom:16px.
      // A pill with an inline left AND a stylesheet right has no free side to
      // move on: it stretches between the two instead of going anywhere.
      node.style.left = pillSpot.h === "left" ? x + "px" : "auto";
      node.style.right = pillSpot.h === "right" ? x + "px" : "auto";
      node.style.top = pillSpot.v === "top" ? y + "px" : "auto";
      node.style.bottom = pillSpot.v === "bottom" ? y + "px" : "auto";
      return true;
    }

    /** The nearest corner, and the distance to it, from a viewport rectangle. */
    function spotFromRect(rect, view) {
      var fromLeft = rect.left;
      var fromRight = Math.max(0, view.w - rect.right);
      var fromTop = rect.top;
      var fromBottom = Math.max(0, view.h - rect.bottom);
      return {
        h: fromLeft <= fromRight ? "left" : "right",
        x: Math.round(Math.max(0, Math.min(fromLeft, fromRight))),
        v: fromTop <= fromBottom ? "top" : "bottom",
        y: Math.round(Math.max(0, Math.min(fromTop, fromBottom)))
      };
    }

    function setCollapsed(next, persist) {
      collapsed = next === undefined ? !collapsed : !!next;
      if (persist !== false) {
        preferredCollapsed = collapsed;
        persistCollapsedPreference();
      }
      // A menu hanging where the rail used to be is the reviewer's page wearing
      // a fragment of a tool they just put away.
      if (collapsed) closeMenu(false);
      renderCollapsed();
      collapseHandlers.forEach(function (fn) {
        try {
          fn(collapsed);
        } catch (err) {
          // One bad listener must never leave the rail half collapsed.
        }
      });
      return collapsed;
    }

    /**
     * Hide the whole library, or bring it back.
     *
     * The rail owns this because the rail owns what is on screen and the
     * preference bucket it is written into. What it does NOT own is the
     * gestures: hiding the tool has to disarm commenting and hand-editing, and
     * that is boot's, through onPresent below.
     *
     * @param {boolean} [next] undefined toggles
     * @param {boolean} [persist] false leaves the reviewer's stored choice alone
     * @returns {boolean} whether the library is hidden now
     */
    function setPresenting(next, persist) {
      var want = next === undefined ? !presenting : !!next;
      if (want === presenting) return presenting;
      presenting = want;
      // A menu hanging over the page while the rail goes invisible is a
      // fragment of a tool the reviewer just put away.
      if (presenting) closeMenu(false);
      if (persist !== false) persistCollapsedPreference();
      renderPresent();
      presentHandlers.forEach(function (fn) {
        try {
          fn(presenting);
        } catch (err) {
          // One bad listener must never leave the library half hidden.
        }
      });
      return presenting;
    }

    function isPresenting() {
      return presenting;
    }

    /** Tell me when the library is hidden or brought back. Returns an unsubscribe. */
    function onPresent(fn) {
      if (typeof fn !== "function") throw new TypeError("onPresent: a function is required");
      presentHandlers.push(fn);
      return function () {
        var at = presentHandlers.indexOf(fn);
        if (at !== -1) presentHandlers.splice(at, 1);
      };
    }

    /**
     * One call, both halves: the surface goes display:none (so the rail, the
     * pill, the toasts and the boxes go with it) and every page wash is
     * unregistered. Nothing here is torn down, so coming back is the same call
     * with the other argument.
     */
    function renderPresent() {
      if (typeof highlights.setHidden === "function") highlights.setHidden(presenting);
    }

    /** Tell me when the rail collapses or opens. Returns an unsubscribe. */
    function onCollapse(fn) {
      if (typeof fn !== "function") throw new TypeError("onCollapse: a function is required");
      collapseHandlers.push(fn);
      return function () {
        var at = collapseHandlers.indexOf(fn);
        if (at !== -1) collapseHandlers.splice(at, 1);
      };
    }

    function collapse(next) {
      return setCollapsed(next, true);
    }

    function renderCollapsed() {
      if (!dom) return;
      dom.rail.hidden = collapsed;
      dom.pill.hidden = !collapsed;
      // The toast column stands beside an open rail and in the corner with the
      // rail closed, so putting the rail away moves it back.
      publishRailAllowance();
    }

    function isCollapsed() {
      return collapsed;
    }

    // -------------------------------------------------------------------------
    // Putting the keyboard in the rail
    // -------------------------------------------------------------------------
    //
    // A reviewer who opened the panel with a chord never touched the mouse, so
    // leaving the focus out on the page would hand them a panel they then have
    // to Tab their way into past everything the page has. The first focusable
    // control in the OPEN TAB is the answer rather than the first in the whole
    // rail: the tab strip and the head sit above every pane, so focusing the
    // rail's first control at all would land on the same button whichever list
    // the reviewer was reading. The pane comes first, and the rail as a whole is
    // the fallback for a pane with nothing in it yet.
    var FOCUSABLE = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(",");

    /** Is this node actually on screen, rather than inside something hidden? */
    function isShown(node) {
      if (!node || node.hidden === true) return false;
      if (typeof node.getClientRects !== "function") return true;
      return node.getClientRects().length > 0;
    }

    function firstFocusableIn(root) {
      if (!root || typeof root.querySelectorAll !== "function") return null;
      var found = root.querySelectorAll(FOCUSABLE);
      for (var i = 0; i < found.length; i += 1) {
        if (isShown(found[i]) && typeof found[i].focus === "function") return found[i];
      }
      return null;
    }

    /**
     * Put the keyboard on the first control in the open tab.
     *
     * A no-op while the rail is away, because there is nothing to focus and
     * focusing the pill instead would be the tool answering a question the
     * reviewer did not ask.
     *
     * @returns {boolean} whether anything took the focus
     */
    function focusFirstControl() {
      if (!dom || collapsed || presenting) return false;
      var pane = dom.panes ? dom.panes[activeTab] : null;
      var node = firstFocusableIn(pane) || firstFocusableIn(dom.rail);
      if (!node) return false;
      try {
        node.focus();
      } catch (err) {
        return false;
      }
      return dom.shadow.activeElement === node;
    }

    /**
     * What inside the rail holds the keyboard right now, as plain data.
     *
     * A closed root has no selector from outside, so a test (and anyone
     * debugging) can only ask the rail. Same shape as gripInfo and menuInfo and
     * for the same reason.
     *
     * THE RAIL, not the whole surface. The pill, the toasts and the anchored
     * comment boxes share this root, and a reviewer typing into a comment box is
     * not a reviewer with the keyboard in the panel: the caller that closes the
     * panel from a chord reads this to decide whether it has focus to hand back,
     * and a comment box mid-sentence must not have it taken away.
     *
     * @returns {(object|null)} null when the rail holds no focus at all
     */
    /**
     * Take the keyboard out of the rail, by name.
     *
     * Hiding the rail usually blurs whatever was inside it, and "usually" is the
     * whole problem. Firefox leaves the focus where it was while its own window
     * is in the background, and a closed root reports its HOST as the page's
     * activeElement, so the caller that puts the panel away cannot even tell
     * that the keyboard is still in it: the reviewer's next keystroke goes to
     * the library rather than to the page. The root itself names the node that
     * holds the focus, so blurring that node is the one reading that does not
     * depend on the engine.
     *
     * @returns {boolean} true when this actually took the focus off something
     */
    function releaseFocus() {
      if (!dom || !dom.shadow) return false;
      var node = dom.shadow.activeElement;
      if (!node || typeof node.blur !== "function") return false;
      try {
        node.blur();
      } catch (err) {
        return false;
      }
      return dom.shadow.activeElement !== node;
    }

    function focusedControl() {
      if (!dom || !dom.shadow) return null;
      var node = dom.shadow.activeElement;
      if (!node || !dom.rail.contains(node)) return null;
      return {
        tag: node.tagName,
        className: typeof node.className === "string" ? node.className : "",
        label: node.getAttribute ? node.getAttribute("aria-label") : null,
        inPane: !!(dom.panes && dom.panes[activeTab] && dom.panes[activeTab].contains(node))
      };
    }

    // -------------------------------------------------------------------------
    // Dragging the rail wider
    // -------------------------------------------------------------------------
    //
    // Ken: "some of these responses are getting quite thorough and long, so the
    // chat rail should be drag-expandable: you should be able to drag the edge
    // of it to expand it horizontally so you can read more."
    //
    // The rail is fixed to the right edge of the viewport, so widening it moves
    // its LEFT edge and changes nothing about the page underneath (D8). What it
    // does change is how much room the other surfaces have to leave: the
    // anchored comment box, the selection pill and the toast column all keep
    // clear of the rail, and until now they did it against a number typed into
    // comments.js. The rail publishes the number instead; see
    // publishRailAllowance.

    function readWidthPreference() {
      if (!reviewId || !store || typeof store.readUiPreferences !== "function") return null;
      try {
        return store.readUiPreferences(reviewId).width || null;
      } catch (err) {
        return null;
      }
    }

    /** The default width, in pixels, for a viewport. The stylesheet's clamp. */
    function defaultRailWidth(viewWidth) {
      if (!isFinite(viewWidth) || viewWidth <= 0) return RAIL_DEFAULT_MAX;
      var want = (viewWidth * RAIL_DEFAULT_VW) / 100;
      return Math.min(RAIL_DEFAULT_MAX, Math.max(RAIL_DEFAULT_MIN, want));
    }

    /** The viewport width the rail is in, or null with nothing on screen. */
    function railViewWidth() {
      var view = dom ? viewportOf(dom.rail) : null;
      return view ? view.w : null;
    }

    /**
     * How wide the rail is RIGHT NOW, measured where that is possible.
     *
     * Measured rather than computed, because the default width is a CSS clamp
     * and the browser is the only thing that knows what it came out as. A
     * collapsed rail cannot be measured (it is display:none), so its width is
     * computed from the same numbers the stylesheet was built from.
     */
    function currentRailWidth() {
      if (dom && !dom.rail.hidden) {
        var rect = dom.rail.getBoundingClientRect();
        if (rect && rect.width > 0) return rect.width;
      }
      var view = railViewWidth();
      var chosen = clampRailWidth(railWidth, view);
      return chosen === null ? defaultRailWidth(view === null ? NaN : view) : chosen;
    }

    /**
     * Tell everything that has to keep clear of the rail how much room it takes.
     *
     * ONE NUMBER, ONE PLACE. It goes on the library's one page-level host as a
     * custom property (highlight.RAIL_ALLOWANCE_PROP), which is the only thing
     * the rail's closed root and the comment boxes' closed root both touch.
     * comments.js reads it back for the anchored box and the selection pill;
     * the toast column is the rail's own, so it is moved here.
     */
    function publishRailAllowance() {
      if (!dom) return null;
      var allowance = Math.round(currentRailWidth() + RAIL_EDGE_GAP);
      if (dom.surfaceHost && dom.surfaceHost.style) {
        dom.surfaceHost.style.setProperty(highlightModule.RAIL_ALLOWANCE_PROP, allowance + "px");
      }
      placeToasts(allowance);
      widthHandlers.forEach(function (fn) {
        try {
          fn(allowance);
        } catch (err) {
          // One bad listener must never leave a drag half applied.
        }
      });
      return allowance;
    }

    /**
     * The toast column, clear of the rail it used to sit on top of.
     *
     * It was top-right and overlapped the open rail deliberately: a toast is on
     * screen for seconds and the rail was a known width. A rail the reviewer
     * can drag to most of the window makes that a toast landing on the card it
     * is telling them about, so with the rail OPEN the column now stands beside
     * it. With the rail collapsed nothing is in the way and the column goes
     * back to the corner, which is the case the toast exists for.
     */
    function placeToasts(allowance) {
      if (!dom || !dom.toastHost) return;
      if (collapsed) {
        dom.toastHost.style.right = "";
        dom.toastHost.style.maxWidth = "";
        return;
      }
      var view = railViewWidth();
      var right = allowance + TOAST_RAIL_GAP;
      dom.toastHost.style.right = right + "px";
      // The stylesheet's own min(480px, 100vw - 32px) does not know about the
      // offset, so a wide rail would push the column off the left edge.
      if (view !== null) {
        dom.toastHost.style.maxWidth = Math.max(TOAST_MIN_WIDTH, view - right - RAIL_EDGE_GAP) + "px";
      }
    }

    /** What the grip says about itself, once the width is known. */
    function paintGrip() {
      if (!dom || !dom.grip) return;
      var view = railViewWidth();
      var width = Math.round(currentRailWidth());
      var max = clampRailWidth(view === null ? RAIL_MIN_WIDTH : view, view);
      dom.grip.setAttribute("aria-valuenow", String(width));
      dom.grip.setAttribute("aria-valuemax", String(max === null ? width : max));
      dom.grip.setAttribute("aria-valuetext", width + " pixels wide");
    }

    /**
     * Put the chosen width on the rail.
     *
     * Clamped HERE rather than when it was stored, so a window that shrank
     * gives back a rail that fits and a window that grows again gives back the
     * width the reviewer actually chose.
     */
    function applyRailWidth() {
      if (!dom) return null;
      var want = clampRailWidth(railWidth, railViewWidth());
      // "" and not a number: an untouched rail keeps the stylesheet's clamp,
      // which is the thing a reset goes back to.
      dom.rail.style.width = want === null ? "" : want + "px";
      publishRailAllowance();
      paintGrip();
      return want;
    }

    /**
     * Set the rail's width. null is "back to the default".
     *
     * @param {number|null} next    the width in pixels, or null for the default
     * @param {Object} [options]    persist:false for a width mid-drag
     */
    function setRailWidth(next, options) {
      var opts = options || {};
      railWidth = next === null || next === undefined ? null : clampRailWidth(next, railViewWidth());
      var applied = applyRailWidth();
      if (opts.persist !== false) persistCollapsedPreference();
      return applied;
    }

    /** The rail's own width in pixels, measured. */
    function width() {
      return dom ? Math.round(currentRailWidth()) : null;
    }

    /** How much room from the right edge is the rail's, in pixels. */
    function railAllowance() {
      return Math.round(currentRailWidth() + RAIL_EDGE_GAP);
    }

    /** Tell me when the rail's width changes. Returns an unsubscribe. */
    function onWidth(fn) {
      if (typeof fn !== "function") throw new TypeError("onWidth: a function is required");
      widthHandlers.push(fn);
      return function () {
        var at = widthHandlers.indexOf(fn);
        if (at !== -1) widthHandlers.splice(at, 1);
      };
    }

    function endGripDrag(event) {
      if (!gripDrag) return;
      if (event && event.pointerId !== undefined && event.pointerId !== gripDrag.id) return;
      if (dom && dom.grip) {
        dom.grip.removeAttribute("data-lahe-dragging");
        try {
          if (typeof dom.grip.releasePointerCapture === "function") {
            dom.grip.releasePointerCapture(gripDrag.id);
          }
        } catch (err) {
          // The capture is already gone, which is the state we wanted.
        }
      }
      if (dom) dom.rail.removeAttribute("data-lahe-resizing");
      gripDrag = null;
      persistCollapsedPreference();
    }

    /** Escape: the width goes back to what it was when the drag started. */
    function cancelGripDrag() {
      if (!gripDrag) return false;
      railWidth = gripDrag.was;
      applyRailWidth();
      endGripDrag();
      return true;
    }

    function stepRailWidth(by) {
      setRailWidth(currentRailWidth() + by);
    }

    function onGripKey(event) {
      var key = event.key;
      if (key === "ArrowLeft") {
        // LEFT GROWS. The rail's left edge is the one that moves, so left is
        // the direction the reviewer drags to make it wider.
        stepRailWidth(RAIL_KEY_STEP);
      } else if (key === "ArrowRight") {
        stepRailWidth(-RAIL_KEY_STEP);
      } else if (key === "Home") {
        setRailWidth(RAIL_MIN_WIDTH);
      } else if (key === "End") {
        var view = railViewWidth();
        setRailWidth(view === null ? RAIL_MIN_WIDTH : view);
      } else if (key === "Escape") {
        if (!cancelGripDrag()) return;
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    }

    function bindGrip(grip, shadow) {
      // POINTER EVENTS AND CAPTURE, and nothing bound on the page's document.
      // The library is a guest here (D8): the drag has to survive the pointer
      // outrunning an 8px strip without the page carrying a listener of ours.
      grip.addEventListener("pointerdown", function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        if (!dom) return;
        var at = now();
        var doubled = at - gripPressedAt < GRIP_DOUBLE_MS;
        gripPressedAt = at;
        if (doubled) {
          // The second press of a double press: back to the default width, and
          // no drag, so the reviewer does not resize by a pixel on the way.
          endGripDrag();
          setRailWidth(null);
          event.preventDefault();
          return;
        }
        gripDrag = { id: event.pointerId, from: event.clientX, was: railWidth, width: currentRailWidth() };
        try {
          if (typeof grip.setPointerCapture === "function") grip.setPointerCapture(event.pointerId);
        } catch (err) {
          // No capture is a worse drag, not a broken one: the moves that land
          // on the grip still resize.
        }
        grip.setAttribute("data-lahe-dragging", "");
        dom.rail.setAttribute("data-lahe-resizing", "");
        // Stops the press becoming a text selection that runs across the page
        // the moment the pointer leaves the rail.
        event.preventDefault();
        // ...which also stops the press focusing the grip, so the focus is
        // moved by hand. Escape has to reach a keydown handler of ours to
        // abandon the drag, and a keyboard left on the page reaches none.
        try {
          grip.focus();
        } catch (err) {
          // A grip that cannot take focus still drags.
        }
      });

      grip.addEventListener("pointermove", function (event) {
        if (!gripDrag || event.pointerId !== gripDrag.id) return;
        // Leftwards is wider: the distance the pointer has travelled from where
        // the press landed, added to the width the rail had then.
        setRailWidth(gripDrag.width + (gripDrag.from - event.clientX), { persist: false });
        event.preventDefault();
      });

      grip.addEventListener("pointerup", endGripDrag);
      grip.addEventListener("pointercancel", endGripDrag);
      grip.addEventListener("keydown", onGripKey);
      // A browser that does deliver a dblclick here gets the same answer. Both
      // paths end at one width, so arriving twice costs nothing.
      grip.addEventListener("dblclick", function (event) {
        setRailWidth(null);
        event.preventDefault();
      });

      // Escape anywhere in the rail's own root ends a drag, because the pointer
      // is down on the grip and the keyboard is wherever the reviewer left it.
      shadow.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        if (cancelGripDrag()) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
    }

    /**
     * What the grip is, for a caller outside the closed root: the specs' way in,
     * and the coordinates a real press uses.
     */
    function gripInfo() {
      if (!dom || !dom.grip) return { present: false, dragging: false, rect: null };
      var rect = dom.grip.getBoundingClientRect();
      return {
        present: true,
        dragging: !!gripDrag,
        label: dom.grip.getAttribute("aria-label"),
        role: dom.grip.getAttribute("role"),
        orientation: dom.grip.getAttribute("aria-orientation"),
        valueNow: Number(dom.grip.getAttribute("aria-valuenow")),
        valueMin: Number(dom.grip.getAttribute("aria-valuemin")),
        valueMax: Number(dom.grip.getAttribute("aria-valuemax")),
        focused: dom.shadow.activeElement === dom.grip,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    }

    /** Put the keyboard on the grip, for a caller that cannot reach into it. */
    function focusGrip() {
      if (!dom || !dom.grip) return false;
      dom.grip.focus();
      return dom.shadow.activeElement === dom.grip;
    }

    // -------------------------------------------------------------------------
    // Toasts
    // -------------------------------------------------------------------------
    //
    // WHY THERE IS A TOAST AT ALL. Ken works with the rail collapsed, because
    // the rail is in the way of the page he is reviewing. That is the tool
    // working as designed, and it has one cost: an answer arriving on a card
    // behind a closed rail is an answer nobody reads. He told us what that cost
    // is in practice: "I forget to go look for answers and end up asking the
    // same questions again."
    //
    // So this file draws a small thing on the page when something arrives that
    // is worth stopping for. It knows nothing about replies: WHAT is worth
    // stopping for is decided in tab_done.js, by the same rule the tab badge
    // already uses, so there is one notion of important and not two.
    //
    // Three rules it will not bend:
    //
    //   ONE PER KEY     a toast is shown once. The caller passes the key (an
    //                   item plus which reply it is), so a reload replaying the
    //                   same folded reply cannot toast it a second time.
    //   THREE AT MOST   the rest collapse into "+N more". A column of toasts is
    //                   a second rail, which is the thing the reviewer closed.
    //   A QUESTION WAITS  sticky toasts have no timer at all. Everything else
    //                   leaves on its own after toastMs.
    //
    // -------------------------------------------------------------------------
    // WHAT THIS PROMISES THE PAGE UNDERNEATH
    // -------------------------------------------------------------------------
    //
    // Ken: "we need to be careful of it interacting with and preventing other
    // JavaScript on the page in a website." The tool is a guest, and a guest
    // that eats clicks or steals focus on somebody's real application is worse
    // than no notification at all. Six promises, each with the thing that keeps
    // it true, because a promise with no mechanism is a comment:
    //
    //  1. THE PAGE STAYS CLICKABLE. `.toasts` is pointer-events:none and only
    //     `.toast` turns it back on, so every pixel of the container that is not
    //     a toast box passes clicks straight through. `.toast__more` is a count
    //     with nothing to press, so it stays none too, and a toast mid-fade is
    //     set pointer-events:none the moment it starts leaving.
    //  2. FOCUS IS NEVER TAKEN. Nothing here calls focus(). A toast appearing
    //     leaves document.activeElement exactly where it was, so a half-typed
    //     form field on the page keeps the caret. Focus reaches a toast only if
    //     the reviewer tabs or clicks into one.
    //  3. NO DOCUMENT OR WINDOW LISTENERS. Every handler (click, keydown,
    //     mouseenter, mouseleave) is bound on the toast node itself. Escape is
    //     the one worth naming: the handler is on the toast, so it can only run
    //     with focus inside a toast, and the page's own Escape and an open
    //     comment box's Escape never reach it. preventDefault and
    //     stopPropagation are called only on events that started inside a toast.
    //  4. NO LAYOUT, NO SCROLL, NO OBSERVER. The container is position:fixed
    //     inside the closed shadow root, and the animation moves opacity and
    //     transform only. Nothing here scrolls anything, resizes anything, or
    //     touches the page host's size or attributes, so the page's own resize
    //     handlers and MutationObservers never see a toast arrive.
    //  5. NOTHING IS TOUCHED OUTSIDE THE SHADOW ROOT. Every node created and
    //     removed here is a child of dom.toastHost, which is inside the rail's
    //     own closed root.
    //  6. A DISMISSED TOAST IS GONE. It is removed from the DOM at the end of
    //     its fade (TOAST_OUT_MS), never left sitting at opacity 0 over page
    //     content.
    //  7. A SWIPE NEVER REACHES THE PAGE. All four pointer handlers are on the
    //     toast node, and the gesture is held with setPointerCapture on that
    //     same node, so a drag that outruns the toast still belongs to the
    //     toast and never becomes a drag, a selection, or a click on whatever
    //     is underneath. Nothing is bound to the document for it. The "+N more"
    //     line has no handlers at all and is pointer-events:none, so a swipe
    //     across it does nothing to anything.

    var toasts = [];
    var toastSeq = 0;
    var toastKeys = Object.create(null);
    // Nodes part way through their going-away fade. They are out of `toasts`
    // already, so they count for nothing; they are held only so the render pass
    // leaves them where they are instead of yanking them out mid-fade.
    var toastLeaving = [];
    // The live duration, so a test can shorten it. TOAST_MS is the only place
    // the real number is written.
    var toastMs = TOAST_MS;

    /**
     * Put a toast on the page.
     *
     * @param {object} spec
     * @param {string} spec.key     shown once per key, for the life of the rail
     * @param {string} spec.label   the short status word ("Question")
     * @param {string} spec.text    what the agent said, already bounded
     * @param {string} [spec.about] the words the item is about, one line
     * @param {boolean} [spec.sticky] true stays until clicked or dismissed
     * @param {function} [spec.onOpen] run when the reviewer clicks the toast
     * @returns {string|null} the toast id, or null when the key was already used
     */
    function showToast(spec) {
      var s = spec || {};
      toastSeq += 1;
      var key = s.key ? String(s.key) : "toast-" + String(toastSeq);
      if (toastKeys[key]) return null;
      toastKeys[key] = true;
      var toast = {
        id: "toast-" + String(toastSeq),
        key: key,
        label: String(s.label || ""),
        text: String(s.text || ""),
        about: String(s.about || ""),
        sticky: s.sticky === true,
        onOpen: typeof s.onOpen === "function" ? s.onOpen : null,
        // Told WHY it left, because the caller cares about the difference: a
        // reviewer who presses the X has dealt with it, and a toast that ran
        // out of time has not been dealt with by anyone.
        onGone: typeof s.onGone === "function" ? s.onGone : null,
        node: null,
        timer: null,
        paused: false,
        // The swipe: the gesture in progress, and whether the last press turned
        // into one (which is how the click handler knows not to open the card).
        drag: null,
        dragged: false
      };
      // Newest first, which is newest on top.
      toasts.unshift(toast);
      // The clock starts when it is VISIBLE, not when it is created (see
      // renderToasts), so a toast waiting its turn behind three others cannot
      // expire before anyone has laid eyes on it.
      renderToasts();
      return toast.id;
    }

    function toastById(id) {
      for (var i = 0; i < toasts.length; i += 1) {
        if (toasts[i].id === id) return toasts[i];
      }
      return null;
    }

    function clearToastTimer(toast) {
      var view = doc && doc.defaultView;
      if (toast.timer && view && typeof view.clearTimeout === "function") view.clearTimeout(toast.timer);
      toast.timer = null;
    }

    function armToast(toast) {
      clearToastTimer(toast);
      if (toast.sticky || toast.paused) return null;
      var view = doc && doc.defaultView;
      if (!view || typeof view.setTimeout !== "function") return null;
      // harness-allow-timer: a toast's own life, pinned at TOAST_MS. It is the
      // duration itself rather than a wait for something to happen, so there is
      // no condition to poll instead.
      toast.timer = view.setTimeout(function () {
        toast.timer = null;
        dismissToast(toast.id, TOAST_GONE.TIMEOUT);
      }, toastMs);
      return toast.timer;
    }

    /** The toast follows the pointer, and fades as it goes. */
    function paintToastDrag(node, dx) {
      node.style.transform = "translateX(" + Math.round(dx) + "px)";
      // Gone by about the point it would be released as a dismissal, so the
      // gesture tells the reviewer what it is going to do before they let go.
      var span = Math.max(1, toastSwipeThreshold(node.offsetWidth || 0));
      var fade = dx > 0 ? Math.min(0.75, dx / (span * 1.4)) : 0;
      node.style.opacity = String(1 - fade);
    }

    function releaseToastPointer(node, pointerId) {
      if (typeof node.releasePointerCapture !== "function") return false;
      try {
        node.releasePointerCapture(pointerId);
        return true;
      } catch (err) {
        return false;
      }
    }

    /** Not far enough, and not fast enough: it goes back where it was. */
    function springToastBack(node) {
      node.style.transition = reducedMotion()
        ? "none"
        : "transform " + String(TOAST_SPRING_MS) + "ms cubic-bezier(.2,.7,.3,1), opacity " +
          String(TOAST_SPRING_MS) + "ms ease-out";
      node.style.transform = "";
      node.style.opacity = "";
      return true;
    }

    /**
     * Thrown away: off the right edge it came in from, and gone.
     *
     * The SAME meaning as the X, deliberately. A reviewer who pushes a message
     * off the screen has dealt with it; if the tool treated that as "ignored"
     * the reply would come back later as neglect, which is the tool arguing
     * with a decision it just watched them make.
     */
    function flingToast(toast) {
      var node = toast.node;
      if (node && !reducedMotion()) {
        node.style.transition =
          "transform " + String(TOAST_OUT_MS) + "ms ease-out, opacity " + String(TOAST_OUT_MS) + "ms ease-out";
        node.style.transform = "translateX(" + String(Math.round((node.offsetWidth || 0) + 48)) + "px)";
        node.style.opacity = "0";
      }
      return dismissToast(toast.id, TOAST_GONE.USER);
    }

    /** Has this machine asked for less movement? */
    function reducedMotion() {
      var view = doc && doc.defaultView;
      if (!view || typeof view.matchMedia !== "function") return false;
      try {
        return view.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
      } catch (err) {
        return false;
      }
    }

    /** Hovering holds it. The reviewer reading it is not the reviewer ignoring it. */
    function pauseToast(toast) {
      toast.paused = true;
      clearToastTimer(toast);
    }

    function resumeToast(toast) {
      if (!toast.paused) return;
      toast.paused = false;
      armToast(toast);
    }

    function dismissToast(id, reason) {
      var toast = toastById(id);
      if (!toast) return false;
      var why = reason || TOAST_GONE.USER;
      clearToastTimer(toast);
      var at = toasts.indexOf(toast);
      if (at !== -1) toasts.splice(at, 1);
      var node = toast.node;
      toast.node = null;
      if (toast.onGone) {
        try {
          toast.onGone(why);
        } catch (err) {
          // A bad listener must never leave a toast stuck on the page.
        }
      }
      // Out of the count at once, off the screen a fade later. The node stops
      // taking clicks the instant it starts leaving (the CSS sets
      // pointer-events:none), so the page under it is clickable through the
      // whole fade, and it is REMOVED at the end rather than left transparent.
      fadeOutNode(node);
      renderToasts();
      return true;
    }

    function fadeOutNode(node) {
      if (!node) return false;
      if (!node.parentNode) return false;
      var view = doc && doc.defaultView;
      if (!view || typeof view.setTimeout !== "function") {
        node.parentNode.removeChild(node);
        return true;
      }
      node.setAttribute("data-lahe-leaving", "true");
      toastLeaving.push(node);
      // harness-allow-timer: the going-away fade, pinned at TOAST_OUT_MS to
      // match the CSS transition. It is when to take the node out of the DOM,
      // not a wait for anything to happen.
      view.setTimeout(function () {
        dropLeavingNode(node);
      }, TOAST_OUT_MS);
      return true;
    }

    function dropLeavingNode(node) {
      var at = toastLeaving.indexOf(node);
      if (at !== -1) toastLeaving.splice(at, 1);
      if (node.parentNode) node.parentNode.removeChild(node);
      // The container hides itself again once the last node has actually gone,
      // so an emptied stack leaves nothing at all over the page.
      renderToasts();
      return true;
    }

    /** The reviewer pressed it: run what it was for, then take it away. */
    function openToast(id) {
      var toast = toastById(id);
      if (!toast) return false;
      var run = toast.onOpen;
      dismissToast(id);
      if (run) {
        try {
          run();
        } catch (err) {
          // A toast that cannot navigate must still go away when pressed.
        }
      }
      return true;
    }

    function clearToasts() {
      toasts.slice().forEach(function (toast) {
        clearToastTimer(toast);
        if (toast.node && toast.node.parentNode) toast.node.parentNode.removeChild(toast.node);
        toast.node = null;
      });
      toasts = [];
      toastLeaving.slice().forEach(dropLeavingNode);
      renderToasts();
      return true;
    }

    /** The dom went with the old root; the toasts did not. Draw them again. */
    function remountToasts() {
      toastLeaving = [];
      toasts.forEach(function (toast) {
        toast.node = null;
        toast.paused = false;
      });
      // renderToasts arms what is visible and leaves the queue cold, so there
      // is nothing to arm by hand here.
      renderToasts();
      return toasts.length;
    }

    function toastNodeFor(toast) {
      if (toast.node) return toast.node;
      var node = el("div", "toast");
      markers.markChrome(node);
      node.setAttribute("role", "status");
      node.setAttribute("data-lahe-toast", toast.id);
      node.setAttribute("data-lahe-sticky", toast.sticky ? "true" : "false");
      node.tabIndex = 0;

      var body = el("span", "toast__body");
      body.appendChild(el("span", "toast__label", toast.label));
      body.appendChild(el("span", "toast__text", toast.text));
      body.appendChild(el("span", "toast__about", toast.about));
      node.appendChild(body);

      var close = el("button", "toast__x", "×");
      close.setAttribute("type", "button");
      close.setAttribute("aria-label", "Dismiss");
      close.addEventListener("click", function (event) {
        event.stopPropagation();
        dismissToast(toast.id);
      });
      node.appendChild(close);

      node.addEventListener("click", function () {
        // A swipe ends in a click, because the pointer went down and up on the
        // same element. Without this the reviewer pushes the toast away and the
        // rail opens on the card for their trouble. The flag is cleared on the
        // NEXT pointerdown rather than here, so nothing else can clear it early.
        if (toast.dragged) return;
        openToast(toast.id);
      });

      // --- the swipe ----------------------------------------------------------
      //
      // Pointer events, so the mouse and the finger are one set of handlers,
      // and all four of them are on THIS node. Capture keeps the gesture alive
      // when the pointer outruns the toast; nothing is ever bound to the
      // document, so a swipe cannot reach the page underneath.
      node.addEventListener("pointerdown", function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        // The X is a button and stays one. A press on it is not a gesture.
        if (event.target && typeof event.target.closest === "function" && event.target.closest(".toast__x")) return;
        toast.dragged = false;
        toast.drag = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dx: 0,
          lastX: event.clientX,
          lastAt: now(),
          velocity: 0,
          moved: false
        };
        if (typeof node.setPointerCapture === "function") {
          try {
            node.setPointerCapture(event.pointerId);
          } catch (err) {
            // Not fatal: without capture a fast drag off the node simply ends.
          }
        }
      });

      node.addEventListener("pointermove", function (event) {
        var drag = toast.drag;
        if (!drag || event.pointerId !== drag.id) return;
        var dx = event.clientX - drag.startX;
        var dy = event.clientY - drag.startY;
        if (!drag.moved) {
          if (Math.abs(dx) <= TOAST_SWIPE_SLOP) return;
          // A mostly vertical drag is the reviewer scrolling the page with the
          // pointer over a toast. The page keeps it.
          if (Math.abs(dy) > Math.abs(dx)) {
            toast.drag = null;
            return;
          }
          drag.moved = true;
          toast.dragged = true;
          // The arrival animation fills forwards, and a filled animation beats
          // an inline transform, so it has to be out of the way before the
          // toast can follow the pointer at all.
          node.style.animation = "none";
          node.style.transition = "none";
          node.setAttribute("data-lahe-dragging", "true");
          // A toast being handled is not a toast being ignored.
          pauseToast(toast);
        }
        sampleSwipeVelocity(drag, event.clientX, now());
        // Rightward is the gesture. Leftward gives a little and no more, so the
        // toast feels attached to the pointer rather than nailed down, without
        // ever suggesting there is something to find over there.
        drag.dx = dx > 0 ? dx : Math.max(-14, dx * 0.2);
        paintToastDrag(node, drag.dx);
        if (typeof event.preventDefault === "function") event.preventDefault();
      });

      node.addEventListener("pointerup", function (event) {
        var drag = toast.drag;
        if (!drag || event.pointerId !== drag.id) return;
        toast.drag = null;
        releaseToastPointer(node, event.pointerId);
        node.removeAttribute("data-lahe-dragging");
        // Never past the dead zone: that was a click, and the click handler is
        // about to run and open the card, which is what it has always done.
        if (!drag.moved) return;
        if (shouldDismissSwipe({ dx: drag.dx, velocity: drag.velocity, width: node.offsetWidth || 0 })) {
          flingToast(toast);
          return;
        }
        springToastBack(node);
        resumeToast(toast);
      });

      node.addEventListener("pointercancel", function (event) {
        var drag = toast.drag;
        if (!drag || event.pointerId !== drag.id) return;
        toast.drag = null;
        releaseToastPointer(node, event.pointerId);
        node.removeAttribute("data-lahe-dragging");
        springToastBack(node);
        resumeToast(toast);
      });

      node.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openToast(toast.id);
          return;
        }
        // ESCAPE IS THE PAGE'S FIRST. This handler is on the toast, so it only
        // ever runs with focus inside one: a comment box's Escape and the
        // page's own Escape never reach here.
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismissToast(toasts.length ? toasts[0].id : toast.id);
        }
      });
      node.addEventListener("mouseenter", function () {
        pauseToast(toast);
      });
      node.addEventListener("mouseleave", function () {
        resumeToast(toast);
      });

      toast.node = node;
      return node;
    }

    /**
     * Put the stack in order, moving as little as possible.
     *
     * A NODE ALREADY IN PLACE IS NEVER MOVED. Re-parenting an element restarts
     * its CSS animation, so a rebuild-everything render made every standing
     * toast slide in again each time a new one arrived, and it would rip a
     * toast out from under its own fade. Newest first, inserted ahead of the
     * one it is newer than; everything else stays put.
     *
     * Everything this touches is a child of dom.toastHost, inside the closed
     * root. Nothing outside the shadow root is read or written.
     */
    function renderToasts() {
      if (!dom || !dom.toastHost) return false;
      var host = dom.toastHost;
      var shown = toasts.slice(0, TOAST_MAX);
      // THE STACK CYCLES. A toast queued behind the cap has no clock, and gets
      // one the moment it comes into view, so every message is eventually seen
      // rather than three being shown and the rest quietly expiring off screen.
      toasts.forEach(function (toast, index) {
        if (index < TOAST_MAX) {
          if (!toast.timer && !toast.sticky && !toast.paused) armToast(toast);
        } else {
          clearToastTimer(toast);
        }
      });
      var live = [];
      // The count line is created once and lives at the end, so it is the thing
      // the oldest visible toast is inserted before.
      var anchor = dom.toastMore;
      for (var i = shown.length - 1; i >= 0; i -= 1) {
        var node = toastNodeFor(shown[i]);
        if (node.parentNode !== host) host.insertBefore(node, anchor);
        anchor = node;
        live.push(node);
      }
      // Anything left that is neither live, nor fading, nor the count line is a
      // toast that has been pushed past the cap.
      Array.prototype.slice.call(host.childNodes).forEach(function (child) {
        if (child === dom.toastMore) return;
        if (live.indexOf(child) !== -1) return;
        if (toastLeaving.indexOf(child) !== -1) return;
        host.removeChild(child);
      });
      var hidden = toasts.length - shown.length;
      dom.toastMore.textContent = hidden > 0 ? "+" + String(hidden) + " more" : "";
      dom.toastMore.hidden = hidden < 1;
      host.hidden = toasts.length === 0 && toastLeaving.length === 0;
      return true;
    }

    /**
     * What is on screen, for a spec that cannot reach into a closed root.
     *
     * Geometry as well as text, so a test clicks the real thing at real
     * coordinates rather than calling openToast and proving nothing about
     * whether the toast was clickable.
     */
    function toastInfo() {
      return {
        count: toasts.length,
        more: Math.max(0, toasts.length - TOAST_MAX),
        toasts: toasts.map(function (toast, index) {
          var rect = toast.node && typeof toast.node.getBoundingClientRect === "function"
            ? toast.node.getBoundingClientRect()
            : null;
          // The close control's own geometry. A spec presses the X the way a
          // reviewer does, at real coordinates, rather than calling the
          // dismissal and proving nothing about whether the button was there.
          var closeNode = toast.node ? toast.node.querySelector(".toast__x") : null;
          var closeRect = closeNode ? closeNode.getBoundingClientRect() : null;
          return {
            closeRect: closeRect
              ? { x: closeRect.x, y: closeRect.y, width: closeRect.width, height: closeRect.height }
              : null,
            id: toast.id,
            key: toast.key,
            label: toast.label,
            text: toast.text,
            about: toast.about,
            sticky: toast.sticky,
            paused: toast.paused,
            armed: !!toast.timer,
            visible: index < TOAST_MAX,
            rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
          };
        })
      };
    }

    /** Read the auto-dismiss duration, or set it. A test shortens it; nothing else does. */
    function toastDuration(ms) {
      if (typeof ms === "number" && ms > 0) toastMs = ms;
      return toastMs;
    }

    // -------------------------------------------------------------------------
    // Carrying the rail across a reload the tool itself started
    // -------------------------------------------------------------------------
    //
    // Ken clicked a toast, the rail opened on the card, and two seconds later
    // the agent rebuilt the page for a different review. LAHE reloaded, the rail
    // came back in its default state, and the card he was reading "disappeared
    // out from in front of me".
    //
    // The reload is right and the scroll position is already carried (see
    // sync.js's viewport marker). This is the same promise for the rail: what
    // was open stays open, on the same tab, scrolled to the same place, with the
    // same card focused. It is the LIVE state, not the stored preference: a rail
    // opened by a toast is open whatever the reviewer's usual choice is.
    //
    // A reviewer's own reload is untouched. Only the marker sync.js writes on
    // the way out is consumed, and only once.

    /** What is on screen right now, as plain data. */
    function railState() {
      var pane = dom && dom.panes ? dom.panes[activeTab] : null;
      return {
        collapsed: collapsed,
        tab: activeTab,
        scroll: pane && typeof pane.scrollTop === "number" ? Math.round(pane.scrollTop) : 0,
        focused: focusedCardId()
      };
    }

    /**
     * Put it back, exactly.
     *
     * The collapse is applied WITHOUT persisting: this is restoring what was on
     * screen, not recording a new decision, and writing it back as a preference
     * would turn "a toast opened the rail once" into "the rail is open now".
     *
     * @param {object} state from railState, across a reload
     * @returns {object} what could actually be applied
     */
    function applyRailState(state) {
      var s = state || {};
      var done = { collapsed: false, tab: null, scroll: false, focused: null };
      if (typeof s.collapsed === "boolean") {
        setCollapsed(s.collapsed, false);
        done.collapsed = true;
      }
      if (s.tab && TABS.indexOf(s.tab) !== -1) {
        selectTab(s.tab);
        done.tab = s.tab;
      }
      var pane = dom && dom.panes ? dom.panes[activeTab] : null;
      if (pane && typeof s.scroll === "number" && s.scroll >= 0) {
        pane.scrollTop = s.scroll;
        done.scroll = true;
      }
      if (s.focused) {
        var node = cardNode(s.focused);
        if (node && typeof node.focus === "function") {
          node.tabIndex = -1;
          if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
          node.focus();
          done.focused = s.focused;
        }
      }
      return done;
    }

    // Rects for both, plus the overlap answer, because "never overlaps" is a
    // geometric claim and a test should be able to check it as one.
    function geometry() {
      if (!dom) {
        return {
          railVisible: false,
          pillVisible: false,
          pillTitle: "",
          pillCount: "",
          pillJewel: "",
          overlap: false,
          rail: null,
          pill: null
        };
      }
      var railRect = dom.rail.hidden ? null : dom.rail.getBoundingClientRect();
      var pillRect = dom.pill.hidden ? null : dom.pill.getBoundingClientRect();
      var overlap = false;
      if (railRect && pillRect) {
        overlap =
          railRect.left < pillRect.right &&
          pillRect.left < railRect.right &&
          railRect.top < pillRect.bottom &&
          pillRect.top < railRect.bottom;
      }
      return {
        railVisible: !!railRect,
        pillVisible: !!pillRect,
        // What the pill says on hover, which is where the chord is taught to a
        // reviewer looking at a page with the panel away.
        pillTitle: dom.pill.title || "",
        // The burn-down the pill shows, as the reviewer reads it: "3 (7)", or
        // "" on a page nothing has been written on yet.
        pillCount: dom.pillCount.hidden ? "" : dom.pillCount.textContent,
        // The jewel, as the reviewer reads it: "2", or "" when there is nothing
        // waiting. Empty is the honest answer for a hidden jewel and for a pill
        // that is not on screen at all.
        pillJewel: dom.pill.hidden || dom.pillJewel.hidden ? "" : dom.pillJewel.textContent,
        overlap: overlap,
        rail: railRect ? { top: railRect.top, right: railRect.right, bottom: railRect.bottom, left: railRect.left } : null,
        pill: pillRect ? { top: pillRect.top, right: pillRect.right, bottom: pillRect.bottom, left: pillRect.left } : null
      };
    }

    return {
      TAB: TAB,
      TABS: TABS,
      STATUS: STATUS,
      STATUS_TEXT: STATUS_TEXT,
      STATUS_SHORT: STATUS_SHORT,
      AGENT_STATE: AGENT_STATE,
      AGENT_TEXT: AGENT_TEXT,
      setAgentLiveness: setAgentLiveness,
      agentState: getAgentState,
      agentLine: agentLine,
      statusLine: statusLine,
      statusLineInfo: statusLineInfo,
      // The overdue wait, made prominent: the banner, the late cards, and the
      // one button that copies a handoff message for a new agent.
      waitBanner: function () {
        return waitBanner();
      },
      waitBannerInfo: waitBannerInfo,
      cardWait: cardWait,
      cardWaitInfo: cardWaitInfo,
      pillWait: function () {
        return pillWait();
      },
      pillWaitInfo: pillWaitInfo,
      copyHandoff: copyHandoff,
      // Hold: queue several comments, release them to the agent at once
      // (docs/features/20260917.01_hold_toggle). isHeld/setHeld read and
      // write through the store, exactly like isCollapsed/collapse above;
      // setHeld(false) is what runs the "hold-release" action a host wires to
      // sync.flush({force: true}).
      isHeld: isHeldNow,
      setHeld: setHeldState,
      heldCount: heldQueuedCount,
      holdInfo: holdInfo,
      statusRowCount: statusRowCount,
      LIMIT_SEPARATE_STORAGE_NO_HELPER: LIMIT_SEPARATE_STORAGE_NO_HELPER,
      SHEET_ATTR: SHEET_ATTR,
      mount: mount,
      unmount: unmount,
      isMounted: isMounted,
      ensureStyleSheet: ensureStyleSheet,
      refreshScheme: refreshScheme,
      setReview: setReview,
      collapse: collapse,
      isCollapsed: isCollapsed,
      onCollapse: onCollapse,
      focusFirstControl: focusFirstControl,
      focusedControl: focusedControl,
      releaseFocus: releaseFocus,
      // Present mode: the whole library off the screen, and still working.
      PRESENT: PRESENT,
      setPresenting: setPresenting,
      isPresenting: isPresenting,
      onPresent: onPresent,
      // The rail's width, and the room everything else leaves for it.
      width: width,
      setWidth: setRailWidth,
      railAllowance: railAllowance,
      onWidth: onWidth,
      gripInfo: gripInfo,
      focusGrip: focusGrip,
      geometry: geometry,
      // What is on screen, and putting it back after a reload the tool started.
      railState: railState,
      applyRailState: applyRailState,
      selectTab: selectTab,
      currentTab: currentTab,
      onTabSelect: onTabSelect,
      onCardActivate: onCardActivate,
      activateCard: activateCard,
      // Folding a card to one line, and the seam that says it happened.
      isCardCollapsed: isCardCollapsed,
      setCardCollapsed: setCardCollapsed,
      toggleCardCollapsed: toggleCardCollapsed,
      setCardsCollapsed: setCardsCollapsed,
      collapsedCardIds: collapsedCardIds,
      onCardCollapse: onCardCollapse,
      setTabNewCount: setTabNewCount,
      tabNewCount: tabNewCount,
      pillNewCount: pillNewCount,
      tabBody: tabBody,
      upsertCard: upsertCard,
      paneForItem: paneForItem,
      getCard: getCard,
      cardNode: cardNode,
      cardBody: cardBody,
      attachCardNode: attachCardNode,
      prependCardNode: prependCardNode,
      attachCardContinuation: attachCardContinuation,
      detachCardNode: detachCardNode,
      removeCard: removeCard,
      releaseCard: releaseCard,
      setCardState: setCardState,
      setCardBadge: setCardBadge,
      clearCardBadge: clearCardBadge,
      cardBadges: cardBadges,
      setAgentMessage: setAgentMessage,
      setCardNotice: setCardNotice,
      holdsFocus: holdsFocus,
      focusedCardId: focusedCardId,
      activeElementInfo: activeElementInfo,
      cardIds: cardIds,
      countFor: countFor,
      chipControls: chipControls,
      failures: failuresApi,
      onAction: onAction,
      menuInfo: menuInfo,
      menuIsOpen: menuIsOpen,
      // End review (D10). promptEndReview is what boot calls once it knows what
      // is unfinished; the door on the rail runs the registered "end" action,
      // which is what calls it.
      promptEndReview: promptEndReview,
      cancelEndReview: cancelEndReview,
      endInfo: endInfo,
      // The door, pressed, for a caller with no on-screen geometry to click.
      clickEnd: function () {
        if (!dom || !dom.endBtn) return null;
        dom.endBtn.click();
        return true;
      },
      // The toast surface. What is worth toasting is not decided here; see the
      // Toasts section above.
      showToast: showToast,
      dismissToast: dismissToast,
      openToast: openToast,
      clearToasts: clearToasts,
      toastInfo: toastInfo,
      toastDuration: toastDuration,
      TOAST_MS: TOAST_MS,
      TOAST_MAX: TOAST_MAX,
      TOAST_OUT_MS: TOAST_OUT_MS,
      TOAST_GONE: TOAST_GONE,
      openMenu: openMenu,
      closeMenu: closeMenu,
      showRefusal: showRefusal,
      hideRefusal: hideRefusal,
      markRefusalPending: markRefusalPending,
      refusalShown: refusalShown,
      refusalButtonInfo: refusalButtonInfo,
      setStatusLine: setStatusLine,
      getStatusLine: getStatusLine,
      statusText: statusText,
      setLimitNote: setLimitNote
    };
  }

  var shared = createRail();

  return {
    PRESENT: PRESENT,
    // Folding a card to one line: the attributes the rule is written in, the
    // icon both disclosures wear, and the pure line builder.
    FOLD_ALL: FOLD_ALL,
    CARD_COLLAPSED_ATTR: CARD_COLLAPSED_ATTR,
    CARD_UNSEEN_ATTR: CARD_UNSEEN_ATTR,
    CARD_ASKING_ATTR: CARD_ASKING_ATTR,
    COLLAPSED_LINE_MAX: COLLAPSED_LINE_MAX,
    CHEVRON_ICON: CHEVRON_ICON,
    collapsedLineText: collapsedLineText,
    clipAtWord: clipAtWord,
    TAB: TAB,
    TABS: TABS,
    STATUS: STATUS,
    STATUS_TEXT: STATUS_TEXT,
    STATUS_SHORT: STATUS_SHORT,
    AGENT_STATE: AGENT_STATE,
    AGENT_TEXT: AGENT_TEXT,
    LIMIT_SEPARATE_STORAGE_NO_HELPER: LIMIT_SEPARATE_STORAGE_NO_HELPER,
    TOAST_MS: TOAST_MS,
    TOAST_MAX: TOAST_MAX,
    TOAST_OUT_MS: TOAST_OUT_MS,
    TOAST_GONE: TOAST_GONE,
    // Swipe to dismiss: the numbers, and the one decision, pure so the feel can
    // be argued about in a unit test rather than by dragging things.
    TOAST_SWIPE_SLOP: TOAST_SWIPE_SLOP,
    TOAST_FLING_MIN_PX: TOAST_FLING_MIN_PX,
    SWIPE_VELOCITY_WINDOW_MS: SWIPE_VELOCITY_WINDOW_MS,
    sampleSwipeVelocity: sampleSwipeVelocity,
    TOAST_SWIPE_FRACTION: TOAST_SWIPE_FRACTION,
    TOAST_SWIPE_MAX_PX: TOAST_SWIPE_MAX_PX,
    TOAST_FLING_SPEED: TOAST_FLING_SPEED,
    toastSwipeThreshold: toastSwipeThreshold,
    shouldDismissSwipe: shouldDismissSwipe,
    END_REVIEW: END_REVIEW,
    endReviewCounts: endReviewCounts,
    unfinishedSentence: unfinishedSentence,
    SHEET_ATTR: SHEET_ATTR,
    RAIL_MIN_WIDTH: RAIL_MIN_WIDTH,
    RAIL_MAX_FRACTION: RAIL_MAX_FRACTION,
    RAIL_MAX_MARGIN: RAIL_MAX_MARGIN,
    RAIL_EDGE_GAP: RAIL_EDGE_GAP,
    RAIL_KEY_STEP: RAIL_KEY_STEP,
    RAIL_GRIP_LABEL: RAIL_GRIP_LABEL,
    clampRailWidth: clampRailWidth,
    timestampLabel: timestampLabel,
    paneForItem: paneForItem,
    createRail: createRail,
    shared: shared,
    OVERLAY_ROOT_ID: markers.OVERLAY_ROOT_ID,
    failureFor: failuresModule.failure
  };
});
