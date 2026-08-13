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
//                                (R12): kept locally, stored, agent connected
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.overlay = factory(root.LAHE.markers, root.LAHE.failures, root.LAHE.record, root.LAHE.highlight);
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/failures.js"),
      require("../shared/record.js"),
      require("./highlight.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, failuresModule, record, highlightModule) {
  "use strict";

  // D10's three tabs. Contents come from the three tab files; the shell is
  // here, so a tab can be registered before its file exists.
  var TAB = { ACTIVE: "active", EDITS: "edits", DONE: "done" };
  var TABS = [TAB.ACTIVE, TAB.EDITS, TAB.DONE];
  var TAB_LABEL = { active: "Active", edits: "Edits", done: "Done" };

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
  // The short form, for the one line that is always on screen. The long form
  // above is the title attribute, so the plain statement is never truncated
  // away entirely.
  var STATUS_SHORT = {
    kept_locally: "Kept in this browser",
    stored: "Stored",
    agent_connected: "Stored · agent reading"
  };

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

  // The named limit from D5, said on the status line rather than claimed as
  // covered: two windows in separate storage with no helper running cannot be
  // refused by anything, so the rail says so out loud.
  // It is SHOWN ONLY IN THE STATE IT DESCRIBES (see renderStatus): a caveat
  // about there being no helper, printed under a status line that says the
  // helper is storing and an agent is reading, contradicts the line above it and
  // teaches the reviewer to stop reading the footer.
  var LIMIT_SEPARATE_STORAGE_NO_HELPER =
    "A second window in a separate browser profile cannot be detected.";

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

    ".head{display:flex;align-items:center;gap:10px;padding:13px 14px 12px;",
    "border-bottom:1px solid var(--line-soft)}",
    ".mark{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none}",
    ".title{font-size:13px;font-weight:600;letter-spacing:-.005em}",
    ".review{font-size:11px;color:var(--ink-faint);letter-spacing:.02em;",
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:11ch}",
    ".head .spacer{flex:1}",
    ".iconbtn{width:26px;height:26px;border-radius:7px;color:var(--ink-soft);",
    "display:flex;align-items:center;justify-content:center;font-size:14px}",
    ".iconbtn:hover{background:var(--surface);color:var(--ink)}",

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
    ".card:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-wash)}",
    ".card__top{display:flex;align-items:center;gap:8px}",
    ".card__kind{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;",
    "color:var(--ink-faint)}",
    ".card__top .spacer{flex:1}",
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
    ".agent__who{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;",
    "color:var(--ink-faint);display:block;margin-bottom:3px}",
    ".agent.is-loud{background:var(--accent-wash);border-left:3px solid var(--accent);",
    "color:var(--ink);font-size:13.5px;line-height:1.5}",
    ".agent.is-loud .agent__who{color:var(--accent-ink)}",
    ".agent__files{margin-top:5px;font-size:11px;color:var(--ink-faint);",
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",

    // --- footer -------------------------------------------------------------
    ".foot{border-top:1px solid var(--line-soft);background:var(--paper);",
    "padding:10px 12px 11px;display:flex;flex-direction:column;gap:9px}",
    ".chips{display:flex;flex-direction:column;gap:6px}",
    ".chips:empty{display:none}",
    ".chip{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.4;",
    "background:var(--warn-wash);color:var(--ink);border-radius:8px;padding:7px 8px 7px 10px}",
    ".chip__text{flex:1}",
    ".chip__remedy{display:block;color:var(--ink-soft);font-size:11.5px;margin-top:2px}",
    ".chip__x{width:20px;height:20px;border-radius:5px;color:var(--ink-soft);flex:none;",
    "display:flex;align-items:center;justify-content:center;font-size:13px}",
    ".chip__x:hover{background:rgba(0,0,0,.06);color:var(--ink)}",
    ".chip__count{font-variant-numeric:tabular-nums;color:var(--ink-faint);font-size:11px}",

    ".status{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink-soft)}",
    ".status__dot{width:6px;height:6px;border-radius:50%;background:var(--ink-faint);flex:none}",
    ".status[data-status='stored'] .status__dot{background:var(--good)}",
    ".status[data-status='agent_connected'] .status__dot{background:var(--accent)}",
    ".status[data-status='kept_locally'] .status__dot{background:var(--warn)}",
    ".status__text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".limit{font-size:11.5px;color:var(--ink-faint);line-height:1.4}",
    ".limit:empty{display:none}",

    // Copy and export are ALWAYS visible, not only when nothing is connected
    // (D10): when something is wrong is exactly when the reviewer cannot tell.
    ".actions{display:flex;gap:7px}",
    ".btn{flex:1;font-size:12px;font-weight:550;padding:7px 10px;border-radius:8px;",
    "border:1px solid var(--line);background:var(--paper);color:var(--ink);text-align:center}",
    ".btn:hover{background:var(--surface)}",
    ".btn--primary{background:var(--accent);border-color:var(--accent);color:#fff}",
    ":host([data-lahe-scheme='dark']) .btn--primary{color:#12151a}",
    ".btn--primary:hover{filter:brightness(1.06);background:var(--accent)}",

    // The keyboard hints are readable, not fine print (D10).
    ".hints{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11.5px;color:var(--ink-soft)}",
    ".hint{display:flex;align-items:center;gap:5px}",
    "kbd{font-family:inherit;font-size:11px;font-weight:600;color:var(--ink);",
    "background:var(--sunken);border:1px solid var(--line);border-bottom-width:2px;",
    "border-radius:5px;padding:1px 5px;letter-spacing:.01em}",

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
    ".pill__count[hidden]{display:none}"
  ].join("");

  var HINTS = [
    { keys: ["⌘", "⇧", "C"], what: "comment" },
    { keys: ["⌘", "⇧", "E"], what: "edit" },
    { keys: ["⌘", "⏎"], what: "done with this one" }
  ];

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

    var cards = Object.create(null);
    var chips = [];
    var dismissed = Object.create(null);
    var status = null;
    var activeTab = TAB.ACTIVE;
    var collapsed = false;
    var mounted = false;
    var limitText = null;
    var actionHandlers = Object.create(null);

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
      if (mounted) return { rootId: markers.OVERLAY_ROOT_ID, remounted: false };
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
      TABS.forEach(function (name) {
        var button = el("button", "tab");
        button.setAttribute("role", "tab");
        button.setAttribute("data-tab", name);
        button.appendChild(el("span", null, TAB_LABEL[name]));
        var count = el("span", "count", "0");
        button.appendChild(count);
        button.addEventListener("click", function () {
          selectTab(name);
        });
        tabs.appendChild(button);
        tabButtons[name] = button;
        counts[name] = count;
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
      var chipList = el("div", "chips");
      foot.appendChild(chipList);

      var statusRow = el("div", "status");
      statusRow.setAttribute("role", "status");
      statusRow.appendChild(el("span", "status__dot"));
      var statusText = el("span", "status__text", "Kept in this browser");
      statusRow.appendChild(statusText);
      foot.appendChild(statusRow);

      var limit = el("div", "limit");
      foot.appendChild(limit);

      var actions = el("div", "actions");
      var copyBtn = el("button", "btn btn--primary", "Copy");
      copyBtn.addEventListener("click", function () {
        runAction("copy");
      });
      var exportBtn = el("button", "btn", "Export");
      exportBtn.addEventListener("click", function () {
        runAction("export");
      });
      actions.appendChild(copyBtn);
      actions.appendChild(exportBtn);
      foot.appendChild(actions);

      var hints = el("div", "hints");
      HINTS.forEach(function (hint) {
        var row = el("span", "hint");
        hint.keys.forEach(function (key) {
          row.appendChild(el("kbd", null, key));
        });
        row.appendChild(el("span", null, hint.what));
        hints.appendChild(row);
      });
      foot.appendChild(hints);
      rail.appendChild(foot);

      var pill = el("button", "pill");
      pill.hidden = true;
      pill.appendChild(el("span", "pill__dot"));
      pill.appendChild(el("span", null, "Review"));
      var pillCount = el("span", "pill__count", "0");
      pill.appendChild(pillCount);
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
        panes: paneNodes,
        chipList: chipList,
        statusRow: statusRow,
        statusText: statusText,
        limit: limit,
        pill: pill,
        pillCount: pillCount
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
      renderTabs();
      renderCollapsed();
      if (mo.hidden) collapse(true);
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
      if (dom && dom.host && dom.host.parentNode) dom.host.parentNode.removeChild(dom.host);
      Object.keys(cards).forEach(function (id) {
        cards[id].node = null;
        cards[id].bodyNode = null;
        cards[id].parts = null;
      });
      dom = null;
      mounted = false;
    }

    function isMounted() {
      return mounted;
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
      var next = highlights.refreshScheme();
      dom.host.setAttribute(highlightModule.SCHEME_ATTR, next);
      return next;
    }

    function setReview(id) {
      reviewId = id;
      loadChips();
      if (dom) {
        dom.rail.querySelector(".review").textContent = id || "";
        renderChips();
      }
      return reviewId;
    }

    // -------------------------------------------------------------------------
    // Cards
    // -------------------------------------------------------------------------

    function paneForItem(item) {
      var kind = item[record.FIELD.KIND];
      var state = item[record.FIELD.STATE];
      if (state === record.STATE.HANDLED) return TAB.DONE;
      if (kind === record.KIND.EDIT || kind === record.KIND.FORMAT_ONLY || kind === record.KIND.DELETE) {
        return TAB.EDITS;
      }
      return TAB.ACTIVE;
    }

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

    function buildCardNode(card) {
      if (!dom || card.node) return card.node;
      var node = el("article", "card");
      node.setAttribute("data-card-id", card.id);
      markers.markChrome(node);

      var top = el("div", "card__top");
      var kind = el("span", "card__kind");
      top.appendChild(kind);
      top.appendChild(el("span", "spacer"));
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
      var notice = el("div", "card__notice");
      node.appendChild(notice);

      card.node = node;
      card.bodyNode = body;
      card.parts = { kind: kind, state: state, quote: quote, badges: badges, agent: agent, notice: notice };
      // A remount rebuilds the card's node, so anything a tab owner attached
      // goes back into the new body rather than being silently dropped.
      (card.attached || []).forEach(function (attachedNode) {
        body.appendChild(attachedNode);
      });
      return node;
    }

    // Puts the card in the pane its state says it belongs in. A card holding
    // focus is NEVER re-parented: moving a focused element blurs it in every
    // engine, which would be this file's own law broken by its own tidying.
    function placeCard(card) {
      if (!dom || !card.node) return;
      var pane = dom.panes[card.pane];
      if (card.node.parentNode === pane) return;
      if (holdsFocus(card.id)) {
        pendingPlacement[card.id] = true;
        return;
      }
      pane.appendChild(card.node);
      delete pendingPlacement[card.id];
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
        p.agent.appendChild(el("span", "agent__who", label));
        p.agent.appendChild(
          el("span", null, card.agentMessage.text || card.agentMessage.reason || "")
        );
        if (card.agentMessage.files && card.agentMessage.files.length) {
          p.agent.appendChild(el("div", "agent__files", card.agentMessage.files.join("  ")));
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

    function renderChips() {
      if (!dom) return;
      dom.chipList.textContent = "";
      chips.forEach(function (chip) {
        var row = el("div", "chip");
        var text = el("div", "chip__text");
        text.appendChild(el("span", null, chip.message || chip.code));
        if (chip.remedy) text.appendChild(el("span", "chip__remedy", chip.remedy));
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

    var failuresApi = {
      add: function (failure) {
        if (!failure || !failure.code) throw new TypeError("failures.add expects a failure object");
        if (dismissed[failure.code]) return null;
        var existing = chips.filter(function (f) {
          return f.code === failure.code;
        })[0];
        if (existing) {
          existing.count = (existing.count || 1) + 1;
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
      isDismissed: function (code) {
        return dismissed[code] === true;
      },
      list: function () {
        return chips.slice();
      },
      count: function () {
        return chips.length;
      },
      clear: function () {
        chips = [];
        saveChips();
        renderChips();
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

    // The one case nothing can refuse (D5): two windows, separate storage, no
    // helper. It is said here rather than claimed as covered anywhere.
    function setLimitNote(text) {
      limitText = text || null;
      renderStatus();
      return limitText;
    }

    function renderStatus() {
      if (!dom) return;
      dom.statusRow.setAttribute("data-status", status || "");
      dom.statusText.textContent = status ? STATUS_SHORT[status] : "Kept in this browser";
      dom.statusRow.title = status ? STATUS_TEXT[status] : "";
      // ONLY IN THE STATE IT DESCRIBES. The limit is about there being no helper
      // to see across two storage buckets, so it is on screen exactly while the
      // rail is saying nothing reached a helper. Under "Stored · agent reading"
      // it was a permanent sentence contradicting the line above it, and a
      // caveat that is always on screen is a caveat nobody reads.
      var showLimit = !status || status === STATUS.KEPT_LOCALLY;
      dom.limit.textContent = showLimit && limitText ? limitText : "";
    }

    function renderTabs() {
      if (!dom) return;
      TABS.forEach(function (name) {
        dom.tabButtons[name].setAttribute("aria-selected", name === activeTab ? "true" : "false");
        dom.panes[name].setAttribute("data-current", name === activeTab ? "true" : "false");
        dom.counts[name].textContent = String(countFor(name));
      });
      // An empty pill invites; it does not report a zero. "Review 0" on an
      // untouched page prints the one number that is not information.
      var open = countFor(TAB.ACTIVE);
      dom.pillCount.textContent = open ? String(open) : "";
      dom.pillCount.hidden = open === 0;
    }

    function selectTab(tab) {
      if (TABS.indexOf(tab) === -1) throw new Error("selectTab: unknown tab " + String(tab));
      activeTab = tab;
      renderTabs();
      return activeTab;
    }

    function currentTab() {
      return activeTab;
    }

    // Copy and Export are always visible; who does the work is 3C's. The rail
    // holds the buttons and hands the click on.
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

    // The collapsed pill never overlaps the open rail (D10), and the mechanism
    // is that the two are never on screen at the same time.
    function collapse(next) {
      collapsed = next === undefined ? !collapsed : !!next;
      renderCollapsed();
      return collapsed;
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
      if (!dom) return { railVisible: false, pillVisible: false, overlap: false, rail: null, pill: null };
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
      LIMIT_SEPARATE_STORAGE_NO_HELPER: LIMIT_SEPARATE_STORAGE_NO_HELPER,
      mount: mount,
      unmount: unmount,
      isMounted: isMounted,
      refreshScheme: refreshScheme,
      setReview: setReview,
      collapse: collapse,
      isCollapsed: isCollapsed,
      geometry: geometry,
      selectTab: selectTab,
      currentTab: currentTab,
      tabBody: tabBody,
      upsertCard: upsertCard,
      getCard: getCard,
      cardNode: cardNode,
      cardBody: cardBody,
      attachCardNode: attachCardNode,
      removeCard: removeCard,
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
      failures: failuresApi,
      onAction: onAction,
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
    LIMIT_SEPARATE_STORAGE_NO_HELPER: LIMIT_SEPARATE_STORAGE_NO_HELPER,
    createRail: createRail,
    shared: shared,
    OVERLAY_ROOT_ID: markers.OVERLAY_ROOT_ID,
    failureFor: failuresModule.failure
  };
});
