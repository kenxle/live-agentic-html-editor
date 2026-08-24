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
    var state = item[record.FIELD.STATE];
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
  // Under AGENT_QUIET_MS the line says nothing about a wait; past
  // AGENT_STALE_MS it is loud about one. Both live in protocol.js beside the
  // states, for the same reason the words do.
  var AGENT_QUIET_MS = protocol.AGENT_LIVENESS.QUIET_MS;
  var AGENT_STALE_MS = protocol.AGENT_LIVENESS.STALE_MS;

  var STATE_LABEL = {
    draft: "Draft",
    ready: "Ready",
    handled: "Handled",
    not_handled: "Not handled"
  };
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
    // not submitted wears the rail's needs-you amber, a submitted one wears its
    // green, and the whole list can be read without reading a single chip. They
    // are washes over the card's paper, not fills: the reviewer's own sentence
    // stays the strongest thing on the card, so these sit a few points off
    // --paper rather than announcing themselves.
    "--draft-wash:#fdf8ef;--draft-line:#ecdcbe;--ready-wash:#f1f8f4;--ready-line:#cee2d6;",
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
    "--draft-wash:#26221b;--draft-line:#3b3327;--ready-wash:#1a2420;--ready-line:#2a3d34;",
    "--shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.45)}",
    "*{box-sizing:border-box;margin:0;padding:0;font:inherit;color:inherit}",
    "button{background:none;border:0;cursor:pointer;font:inherit;color:inherit}",
    ":focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}",

    // --- the rail -----------------------------------------------------------
    // pointer-events comes back on here: the ONE page-level host is
    // pointer-events:none so the page stays clickable through it, and the two
    // things the rail actually draws turn it back on.
    ".rail{position:fixed;top:16px;right:16px;bottom:16px;width:clamp(320px,26vw,392px);",
    "pointer-events:auto;",
    "display:flex;flex-direction:column;background:var(--paper);color:var(--ink);",
    "border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);",
    "overflow:hidden;font-size:13px;line-height:1.45;letter-spacing:.005em}",
    ".rail[hidden]{display:none}",

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
    // The state, in color. Draft is the amber the rail already uses for "this
    // one needs you", which is exactly what an unsubmitted comment is; ready is
    // green. A HANDLED card keeps the plain paper it has always had, so the two
    // greens never sit next to each other meaning different things: handled
    // wears an outlined green chip on paper, ready wears the wash.
    ".card[data-state='draft']{background:var(--draft-wash);border-color:var(--draft-line)}",
    ".card[data-state='ready']{background:var(--ready-wash);border-color:var(--ready-line)}",
    ".card:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-wash)}",
    ".card__top{display:flex;align-items:center;gap:8px}",
    ".card__kind{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;",
    "color:var(--ink-faint)}",
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
    ".agent{border-radius:8px;padding:8px 10px;background:var(--surface);font-size:12.5px}",
    ".agent:empty{display:none}",
    ".agent__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px}",
    ".agent__who{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;",
    "color:var(--ink-faint);display:block}",
    ".agent.is-loud{background:var(--accent-wash);border-left:3px solid var(--accent);",
    "color:var(--ink);font-size:13.5px;line-height:1.5}",
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
    ".pill{position:fixed;right:16px;bottom:16px;pointer-events:auto;display:flex;align-items:center;gap:8px;",
    "height:38px;padding:0 14px;border-radius:999px;background:var(--paper);color:var(--ink);",
    "border:1px solid var(--line);box-shadow:var(--shadow);font-size:12.5px;font-weight:550}",
    ".pill[hidden]{display:none}",
    ".pill:hover{background:var(--surface)}",
    ".pill__dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}",
    ".pill__count{font-variant-numeric:tabular-nums;color:var(--ink-faint);font-weight:500}",
    ".pill__count[hidden]{display:none}",
    // THE JEWEL: the same number the Done tab badge carries, on the one surface
    // that is still on screen once the rail is put away. A reviewer works with
    // the rail collapsed, and a question or a refusal was badging a tab strip
    // nobody could see. Same accent, same size, same restraint as .newmark: no
    // motion, no pulsing, and nothing at all when the count is zero.
    ".pill__jewel{font-variant-numeric:tabular-nums;font-size:10px;font-weight:700;line-height:1;",
    "color:#fff;background:var(--accent);border-radius:999px;padding:2px 5px;min-width:14px;text-align:center}",
    ":host([data-lahe-scheme='dark']) .pill__jewel{color:#12151a}",
    ".pill__jewel[hidden]{display:none}"
  ].join("");

  // The review-level actions, in the head's menu. They are the same two the
  // footer used to stand up as buttons, and they run through the same
  // runAction seam, so what they DO is still boot's business (D10, revised).
  var MENU_ITEMS = [
    { action: "copy", label: "Copy review" },
    { action: "export", label: "Export review to file" }
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
    // Where the pointer went down, so a drag that ends inside a card is read as
    // a drag and not as a click.
    var pressPoint = null;
    // A person's choice, separate from the rail's momentary visibility. A
    // second-window refusal has to open the rail so its remedy is visible, but
    // that forced opening must not erase the choice to keep the rail collapsed.
    var preferredCollapsed = readCollapsedPreference();
    var collapsed = preferredCollapsed;
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

      var style = doc.createElement("style");
      style.textContent = CSS;
      shadow.appendChild(style);

      var rail = el("aside", "rail");
      rail.setAttribute("aria-label", "Review");

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
      pill.appendChild(el("span", "pill__dot"));
      pill.appendChild(el("span", null, "Review"));
      var pillCount = el("span", "pill__count", "0");
      pill.appendChild(pillCount);
      var pillJewel = el("span", "pill__jewel");
      pillJewel.hidden = true;
      pill.appendChild(pillJewel);
      pill.addEventListener("click", function () {
        collapse(false);
      });

      shadow.appendChild(rail);
      shadow.appendChild(pill);
      surfaceRoot.appendChild(host);

      // A held pane move lands the moment focus leaves the card.
      shadow.addEventListener("focusout", function () {
        flushPendingPlacements();
      });

      dom = {
        host: host,
        shadow: shadow,
        rail: rail,
        tabButtons: tabButtons,
        counts: counts,
        newmarks: newmarks,
        panes: paneNodes,
        chipList: chipList,
        foot: foot,
        statusRow: statusRow,
        statusText: statusText,
        statusDot: statusDot,
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
        pillJewel: pillJewel
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
      collapsed = preferredCollapsed;
      loadChips();
      if (dom) {
        dom.rail.querySelector(".review").textContent = id || "";
        renderChips();
        renderCollapsed();
        if (refusalInfo) setCollapsed(false, false);
      }
      return reviewId;
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
          state: item[record.FIELD.STATE],
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
        cards[id].state = item[record.FIELD.STATE];
        cards[id].pane = paneForItem(item);
        placeCard(cards[id]);
      }
      paintCard(cards[id]);
      renderTabs();
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
        activateCard(card.id);
      });

      var top = el("div", "card__top");
      var kind = el("span", "card__kind");
      top.appendChild(kind);
      top.appendChild(el("span", "spacer"));
      var time = el("time", "card__time");
      top.appendChild(time);
      var state = el("span", "card__state");
      top.appendChild(state);
      node.appendChild(top);

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
      card.parts = { kind: kind, time: time, state: state, quote: quote, badges: badges, agent: agent, continuation: continuation, notice: notice };
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
      store.writeChips(reviewId, { chips: chips, dismissed: Object.keys(dismissed) });
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
          loud:
            state !== AGENT_STATE.WORKING &&
            (waitedMs >= AGENT_STALE_MS || state === AGENT_STATE.NO_AGENT),
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
      if (!dom) return;
      var line = statusLine();
      dom.statusRow.setAttribute("data-status", status || "");
      dom.statusRow.setAttribute("data-agent", line.agentState || "");
      dom.statusRow.setAttribute("data-loud", line.loud ? "true" : "");
      dom.statusText.textContent = line.text;
      dom.statusRow.title = line.title;
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

    function persistCollapsedPreference() {
      if (!reviewId || !store || typeof store.writeUiPreferences !== "function") return false;
      try {
        store.writeUiPreferences(reviewId, { collapsed: preferredCollapsed });
        return true;
      } catch (err) {
        return false;
      }
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
    }

    function isCollapsed() {
      return collapsed;
    }

    // Rects for both, plus the overlap answer, because "never overlaps" is a
    // geometric claim and a test should be able to check it as one.
    function geometry() {
      if (!dom) {
        return {
          railVisible: false,
          pillVisible: false,
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
      geometry: geometry,
      selectTab: selectTab,
      currentTab: currentTab,
      onTabSelect: onTabSelect,
      onCardActivate: onCardActivate,
      activateCard: activateCard,
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
    TAB: TAB,
    TABS: TABS,
    STATUS: STATUS,
    STATUS_TEXT: STATUS_TEXT,
    STATUS_SHORT: STATUS_SHORT,
    AGENT_STATE: AGENT_STATE,
    AGENT_TEXT: AGENT_TEXT,
    LIMIT_SEPARATE_STORAGE_NO_HELPER: LIMIT_SEPARATE_STORAGE_NO_HELPER,
    END_REVIEW: END_REVIEW,
    endReviewCounts: endReviewCounts,
    unfinishedSentence: unfinishedSentence,
    SHEET_ATTR: SHEET_ATTR,
    timestampLabel: timestampLabel,
    paneForItem: paneForItem,
    createRail: createRail,
    shared: shared,
    OVERLAY_ROOT_ID: markers.OVERLAY_ROOT_ID,
    failureFor: failuresModule.failure
  };
});
