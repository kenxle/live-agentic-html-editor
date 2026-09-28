// The Library page's view model.
//
// Owner: Library 2.2. Plan: docs/features/20260922.02_lahe_library/03_plan_lahe_library.md,
// Task 2.2 and the Page Spec (every string the page shows, by state).
// Architecture: 02_architecture_lahe_library.md, "The list response" and "Open".
//
// A PURE MODULE. No DOM, no clock, no fetch: a list response plus the page's
// own state in, sections, cards, rows, button states and strings out. The page
// script (page.js) owns the network and the DOM and asks this file every
// question that has a wording or a rule in it, so every state in the Page Spec
// is a node:test away from being proved.
//
// Two kinds of export:
//
//   build(list, state, now, opts)   the whole view, from scratch, each render
//   decide(list, state, id, action) what a click on Open, Pick this up or
//                                   Launch should do, before anything is sent
//
// plus small state updaters (withFetch, withPanel, afterOpen, ...) that return
// a NEW state object. The page keeps one state and replaces it; nothing here
// mutates its arguments.
//
// Every string is page text and is rendered with textContent by page.js.
// Nothing in a view is ever HTML.
//
// Dual-environment module, like src/shared/: the browser gets
// LAHE.catalogViewModel, node:test gets module.exports.
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.catalogViewModel = factory(root.LAHE.protocol);
  } else {
    module.exports = factory(require("../../shared/protocol.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (protocol) {
  "use strict";

  var CATALOG = protocol.CATALOG;
  var LEGACY_SESSION = "legacy";

  var TEXT = {
    TITLE: "LAHE Library",
    AGENT_ATTACHED: "Hand-overs go to: {agent}",
    AGENT_NONE: "No agent attached. Open still works; hand-overs give you a message to paste.",
    AGENT_STOPPED: "{agent} is attached but has stopped watching. Open still works; hand-overs give you a message to paste.",
    WAITING: "Waiting for {agent}.",
    ALREADY_WAITING: "Already waiting for {agent}.",
    // The helper queued nothing: the attached agent already owns or watches
    // the document (request_id: null).
    ALREADY_HAS: "{agent} already has it. Nothing was sent.",
    DONE: "{agent}: {text}",
    REFUSED: "{agent} couldn't take it: {text}.",
    EXPIRED: "Not picked up. {agent} didn't answer.",
    // Not in the Page Spec's table: the expired line carries a reason
    // (catalog_requests.js EXPIRY_REASON), and a launch that expired is not a
    // pick-up. The row names both, so the reader knows what to do next.
    EXPIRED_PICKUP: "Not picked up.",
    EXPIRED_LAUNCH: "No new agent was launched.",
    EXPIRED_TIMEOUT: "{agent} didn't answer.",
    EXPIRED_MONITOR_DEAD: "{agent} stopped watching before it answered.",
    EXPIRED_ATTACH_CHANGED: "A different agent was attached before {agent} answered.",
    PANEL_NO_AGENT: "No agent is attached. This is the same hand-off message the rail already copies. Paste it into any agent:",
    PANEL_REFUSED: "This is the same hand-off message the rail already copies. Paste it into a new agent:",
    COPY: "Copy",
    COPIED: "Copied.",
    COPY_FAILED: "Couldn't copy. Select the message and copy it yourself.",
    CLOSE: "Close",
    COPY_HANDOFF: "Copy the hand-off message",
    POPUP_BLOCKED: "The browser blocked the new tab. Allow pop-ups for this page, then press Open again.",
    LIST_FAILED: "The Library couldn't load the list: {why}",
    OPEN: "Open",
    PICKUP: "Pick this up",
    LAUNCH: "Launch a new agent",
    // Pick this up and Launch sit behind one menu per row, so Open is the
    // only button a row shows at rest.
    HAND_TO: "Hand to agent",
    // An agent is told to refuse a dev-server hand-over (it cannot start
    // someone's app), so the Library does not offer one.
    DEV_SERVER_NO_HANDOFF: "An app's dev server serves this page, so no agent can take it from here. Start the dev server and open the page yourself.",
    SEARCH_PLACEHOLDER: "Search titles, files, folders, sessions",
    ALL_PROJECTS: "All projects",
    SECTION_TOP: "Unanswered comments, and starred ({n})",
    SECTION_WEEK: "This week ({n})",
    SECTION_OLDER: "Older than a week: {reviews}. Search reaches all of them.",
    SHOW_MISSING: "Show {n} missing",
    MISSING_HEADING: "Missing ({n}). Neither the file nor a main-repo copy exists.",
    HIDE: "Hide",
    // The card names its watcher once, so its rows need not repeat it. The
    // Page Spec's card wording did not name the agent; a row's badge did, on
    // every row of the card.
    WATCH_LIBRARY_AGENT: "watched by {agent}, the agent that opened this Library",
    WATCH_OTHER: "watched by {agent}",
    // The watcher's name is the card's own title: a session watched by its
    // own agent, often one launched for the document and named after it.
    WATCH_OWN: "watched by its own agent",
    WATCH_NONE: "no agent watching",
    UNNAMED_SESSION: 'Unnamed session, started on "{name}"',
    // Not in the Page Spec: the reader's "legacy" group is lahe add reviews
    // from before agent sessions existed, and "Unnamed session" would be untrue.
    LEGACY_SESSION: "Reviews from before sessions",
    SESSION_OF: 'session "{name}"',
    BADGE_ENDED: "review ended",
    BADGE_SERVED: "being served now",
    BADGE_WATCHING: "agent watching: {agent}",
    FOLDED: "{n} reviews of this folder, shown as one",
    UNREADABLE: "Some of this review's records can't be read.",
    MISSING: "File is gone. Open unavailable.",
    WORKTREE: "The worktree is gone. An agent will open the main repository's copy, which may differ from what you reviewed.",
    NEEDS_AGENT: "Needs an agent to reopen. No agent is attached.",
    NO_MATCHES: "Nothing matches that search.",
    RESTARTED: "LAHE restarted, reload this page.",
    RELOAD: "Reload",
    NOT_RUNNING: "LAHE is not running. Ask an agent to open the lahe library.",
    EMPTY: "No reviews yet. Documents you review in LAHE show up here.",
    LOADING: "Loading the Library.",
    STAR: "Star",
    UNSTAR: "Remove the star",
    STAR_FAILED: "Couldn't save the star: {why}. The star goes back.",
    STAR_NOT_RUNNING: "LAHE is not running",
    OPENING_HANDOFF: 'Opening "{name}" in a new tab and handing it to {agent}.',
    OPENING: 'Opening "{name}" in a new tab.',
    // Not in the Page Spec's table: the tab is open but the agent has not
    // answered yet. Saying "watching" here would be the optimistic "done".
    OPENED_WAITING: '"{name}" is open in a new tab. Waiting for {agent} to start watching it.',
    DONE_AFTER_OPEN: '"{name}" is open in a new tab, and {agent} is watching it.',
    OPENED: '"{name}" is open in a new tab.',
    OPENED_QUEUE_FULL: "Opened. No agent was asked: too many hand-overs are waiting.",
    OPENED_NO_AGENT: "Opened. No agent is attached to watch it.",
    QUEUE_FULL: "No agent was asked: too many hand-overs are waiting.",
    URL_REFUSED: "LAHE answered with an address that is not on this computer, so the Library did not open it.",
    UNKNOWN_ERROR: "Something went wrong.",
    CONFIRM_TITLE: "Another agent is watching this.",
    CONFIRM_BODY: '"{name}" belongs to session "{session}". Handing it to {agent} moves the whole session and stops the other agent.',
    CONFIRM_MOVES: "These reviews move with it:",
    CONFIRM_MOVE: "Move the session",
    CONFIRM_READ: "Just open it to read",
    CONFIRM_CANCEL: "Cancel",
    // failures.js holds PROTO_CATALOG_UNREADABLE's own wording, but the page
    // cannot load failures.js (the asset allowlist is fixed), so the notice is
    // spelled here from the same sentence.
    STARS_UNREADABLE: "Stars can't change right now: the Library's saved stars file can't be read. LAHE leaves the file as it is."
  };

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m;
    });
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i += 1) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  function withKey(map, key, value) {
    var out = assign({}, map);
    if (value === undefined) delete out[key];
    else out[key] = value;
    return out;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  //
  //   fetch      "loading" | "ok" | "unauthorized" | "unreachable": how the
  //              last list call went
  //   query      the search box
  //   project    the project filter, "" for all
  //   showMissing whether the missing section is open
  //   expanded   {sessionId: true|false}, a card the reader opened or closed
  //   panel      {review, reason} | null: the hand-off panel under one row
  //   dialog     {review, action} | null: the confirm before moving a
  //              watched session (R12b)
  //   banner     {kind: "opening"|"opened", review, name, agent, requestId,
  //              watched} | null: what Open is doing
  //   opening    {reviewId: true}: an Open sent and not yet answered. A
  //              second click on that row sends nothing until it answers.
  //   menu       reviewId | null: the row whose Hand to agent menu is open
  //   notes      {reviewId: {kind, text, tone, at, busy, action, requestId}}:
  //              what the page's own last action on a row came to
  //   starPending  {reviewId: desired}: a star sent and not yet answered
  //   starOverride {reviewId: starred}: an answered star the list has not
  //              caught up with yet

  function initialState() {
    return {
      fetch: "loading",
      query: "",
      project: "",
      showMissing: false,
      expanded: {},
      panel: null,
      dialog: null,
      banner: null,
      opening: {},
      menu: null,
      notes: {},
      starPending: {},
      starOverride: {}
    };
  }

  /**
   * How the last list call went. {ok: true}, {ok: false, status}, or
   * {ok: false, unreachable: true}. A 401 means the helper restarted and the
   * page's token is gone for good, which only a reload fixes.
   */
  function withFetch(state, result) {
    var fetchState = "unreachable";
    var failure = null;
    if (result && result.ok) fetchState = "ok";
    else if (result && result.status === 401) fetchState = "unauthorized";
    else if (result && !result.unreachable && typeof result.status === "number") {
      fetchState = "failed";
      failure = errorText(result.error);
    }
    return assign({}, state, { fetch: fetchState, fetchFailure: failure });
  }

  /** Poll again? Not after a 401: the token is dead until the page reloads. */
  function shouldPoll(state) {
    return state.fetch !== "unauthorized";
  }

  function withQuery(state, query) {
    return assign({}, state, { query: String(query == null ? "" : query) });
  }

  function withProject(state, project) {
    return assign({}, state, { project: String(project == null ? "" : project) });
  }

  function withShowMissing(state, shown) {
    return assign({}, state, { showMissing: !!shown });
  }

  function withExpanded(state, sessionId, open) {
    return assign({}, state, { expanded: withKey(state.expanded, sessionId, !!open) });
  }

  /** Open one row's Hand to agent menu, or close it with null. */
  function withMenu(state, reviewId) {
    return assign({}, state, { menu: reviewId || null });
  }

  function withPanel(state, reviewId, reason) {
    return assign({}, state, { panel: reviewId ? { review: reviewId, reason: reason || "no_agent" } : null });
  }

  /** Whether the hand-off message reached the clipboard, for the panel's status line. */
  function withCopied(state, reviewId, ok) {
    if (!state.panel || state.panel.review !== reviewId) return state;
    return assign({}, state, { panel: assign({}, state.panel, { copied: !!ok }) });
  }

  /** window.open gave nothing back: no request was sent. */
  function popupBlocked(state, reviewId, now) {
    return withNote(state, reviewId, { kind: "error", text: TEXT.POPUP_BLOCKED, tone: "warn" }, now);
  }

  function withDialog(state, reviewId, action) {
    return assign({}, state, { dialog: reviewId ? { review: reviewId, action: action } : null });
  }

  /** A note on one row from the page's own action. `now` orders it against the list's requests. */
  function withNote(state, reviewId, note, now) {
    return assign({}, state, { notes: withKey(state.notes, reviewId, note ? assign({}, note, { at: now }) : undefined) });
  }

  /** A fresh list arrived: drop the star overrides it now agrees with. */
  function afterList(state, list) {
    var override = assign({}, state.starOverride);
    Object.keys(override).forEach(function (id) {
      var found = findReview(list, id);
      if (!found || !!found.review.starred === override[id]) delete override[id];
    });
    return assign({}, state, { starOverride: override });
  }

  // ---------------------------------------------------------------------------
  // Time
  // ---------------------------------------------------------------------------
  //
  // Today's times are just the clock ("3:40 PM"); anything earlier carries its
  // day ("Sun Sep 27, 4:00 PM"); another year carries the year. `timeZone` is
  // for tests; the page passes none and gets the reader's own zone.

  function parts(ms, timeZone) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit"
    });
    var out = {};
    fmt.formatToParts(new Date(ms)).forEach(function (p) {
      out[p.type] = p.value;
    });
    return out;
  }

  function formatTime(iso, now, timeZone) {
    var ms = Date.parse(iso);
    if (!isFinite(ms)) return "unknown time";
    var t = parts(ms, timeZone);
    var n = parts(now, timeZone);
    var clock = t.hour + ":" + t.minute + " " + t.dayPeriod;
    if (t.year === n.year && t.month === n.month && t.day === n.day) return clock;
    if (t.year === n.year) return t.weekday + " " + t.month + " " + t.day + ", " + clock;
    return t.month + " " + t.day + ", " + t.year;
  }

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  function agentLabel(ref) {
    if (!ref) return null;
    return ref.name || ref.session || null;
  }

  // The attached agent, but only when it can take a hand-over right now.
  function liveAgent(list) {
    var a = list && list.attached;
    if (!a || !a.session || a.watching === false) return null;
    return { session: a.session, name: agentLabel(a) };
  }

  function agentHeader(list) {
    var a = list && list.attached;
    // A closed attached session is no agent at all, not one that stopped.
    if (a && a.closed === true) return { attached: false, text: TEXT.AGENT_NONE };
    if (a && a.session && a.watching !== false) {
      return { attached: true, text: fill(TEXT.AGENT_ATTACHED, { agent: agentLabel(a) }) };
    }
    if (a && a.session) {
      return { attached: false, text: fill(TEXT.AGENT_STOPPED, { agent: agentLabel(a) }) };
    }
    return { attached: false, text: TEXT.AGENT_NONE };
  }

  function handoffFor(session) {
    var isLegacy = !session || session.id === LEGACY_SESSION;
    return protocol.AGENT_LIVENESS.handoffMessage(isLegacy ? null : session.id, isLegacy ? null : session.name || null, false);
  }

  function sameWatcher(a, b) {
    return !!(a && b && a.session === b.session);
  }

  function watchText(session, list) {
    var w = session.watching;
    if (!w) return TEXT.WATCH_NONE;
    var attached = list && list.attached;
    var agent = agentLabel(w);
    if (attached && attached.session && w.session === attached.session) return fill(TEXT.WATCH_LIBRARY_AGENT, { agent: agent });
    if (agent === sessionTitle(session)) return TEXT.WATCH_OWN;
    return fill(TEXT.WATCH_OTHER, { agent: agent });
  }

  // ---------------------------------------------------------------------------
  // Names
  // ---------------------------------------------------------------------------

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function sessionTitle(session) {
    if (session.id === LEGACY_SESSION) return TEXT.LEGACY_SESSION;
    if (session.name) return session.name;
    var reviews = session.reviews || [];
    var first = reviews.length ? reviews[reviews.length - 1] : null;
    return fill(TEXT.UNNAMED_SESSION, { name: first ? first.display_name : session.id });
  }

  // The path line says only what the title and the card do not: the project
  // is left out when the card shows exactly that one project, and a folder or
  // file the title already names is left out.
  function whereText(review, cardProjects) {
    var name = String(review.display_name || review.title || "");
    var parts = [];
    var projectShown = !!(cardProjects && cardProjects.length === 1 && cardProjects[0] === review.project);
    if (typeof review.project === "string" && review.project && !projectShown) parts.push(review.project);
    var rest = [review.folder, review.file].filter(function (p) {
      return typeof p === "string" && p !== "";
    });
    var said = rest.every(function (p) {
      return name.indexOf(p) !== -1;
    });
    if (!said) parts = parts.concat(rest);
    return parts.join(" / ");
  }

  // ---------------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------------

  function withoutFinalPeriod(text) {
    return String(text == null ? "" : text).replace(/[.\s]+$/, "");
  }

  function requestNote(review, list) {
    var q = review.request;
    if (!q) return null;
    var agent = q.by_name || agentLabel(list && list.attached) || "the agent";
    if (q.state === "waiting") {
      return { text: fill(TEXT.WAITING, { agent: agent }), tone: "info", busy: true, copyHandoff: false, action: q.action };
    }
    if (q.state === "done") {
      return { text: fill(TEXT.DONE, { agent: agent, text: q.text || "" }), tone: "ok", busy: false, copyHandoff: false };
    }
    if (q.state === "refused") {
      // A refusal is about the agent that gave it. Once that agent is not the
      // attached, live one, the note is history and is dropped.
      var live = liveAgent(list);
      if (!live || live.name !== q.by_name) return null;
      return {
        text: fill(TEXT.REFUSED, { agent: agent, text: withoutFinalPeriod(q.text) }),
        tone: "warn",
        busy: false,
        copyHandoff: q.action === "launch"
      };
    }
    if (q.state === "expired") {
      var launch = q.action === "launch";
      var why = q.reason === "attach_changed"
        ? TEXT.EXPIRED_ATTACH_CHANGED
        : q.reason === "monitor_dead" ? TEXT.EXPIRED_MONITOR_DEAD : TEXT.EXPIRED_TIMEOUT;
      return {
        text: (launch ? TEXT.EXPIRED_LAUNCH : TEXT.EXPIRED_PICKUP) + " " + fill(why, { agent: agent }),
        tone: "warn",
        busy: false,
        // A launch nobody ran can still be done by hand, from the message.
        copyHandoff: launch
      };
    }
    return null;
  }

  function effectiveStar(review, state) {
    var o = state.starOverride || {};
    return Object.prototype.hasOwnProperty.call(o, review.id) ? !!o[review.id] : !!review.starred;
  }

  // The page's own note on a row, or what the list says about its request,
  // whichever is newer. The list wins when it has caught up with the note's own
  // request, when a newer request exists, or when "already waiting" is no
  // longer true.
  function pickNote(local, review, list) {
    var fromList = requestNote(review, list);
    if (!local) return fromList;
    var q = review.request;
    if (q) {
      if (local.requestId && q.id === local.requestId) return fromList;
      if (local.kind === "already" && q.state !== "waiting") return fromList;
      var qAt = Date.parse(q.answered_at || q.at);
      if (isFinite(qAt) && qAt > local.at) return fromList;
    }
    return {
      text: local.text,
      tone: local.tone || "info",
      busy: !!local.busy,
      copyHandoff: false,
      action: local.action || null
    };
  }

  // `cardWatching` is the watcher the row's card already names, or null when
  // the row is shown outside a card (the missing section); `inCard` says which.
  function buildRow(review, session, list, state, now, opts, cardWatching, inCard) {
    var agent = liveAgent(list);
    var missing = review.openable === "missing";
    var viaAgent = review.openable === "via-agent";
    var devServer = review.kind === "dev-server";
    var note = pickNote(state.notes && state.notes[review.id], review, list);
    var busyAction = note && note.busy ? note.action : null;
    var starred = effectiveStar(review, state);

    var notices = [];
    if (review.unreadable) notices.push({ text: TEXT.UNREADABLE, tone: "warn" });
    if (missing) notices.push({ text: TEXT.MISSING, tone: "quiet" });
    if (!missing && review.kind === "worktree") notices.push({ text: TEXT.WORKTREE, tone: "info" });
    if (viaAgent && !agent) notices.push({ text: TEXT.NEEDS_AGENT, tone: "warn" });
    if (devServer && !missing) notices.push({ text: TEXT.DEV_SERVER_NO_HANDOFF, tone: "quiet" });

    var handEnabled = !missing && !devServer;
    var buttons = {
      open: { label: TEXT.OPEN, enabled: !missing && !(viaAgent && !agent), busy: isOpening(state, review.id) },
      pickup: { label: TEXT.PICKUP, enabled: handEnabled, busy: busyAction === "pickup" },
      launch: { label: TEXT.LAUNCH, enabled: handEnabled, busy: busyAction === "launch" },
      handTo: {
        label: TEXT.HAND_TO,
        // The attached agent already watches this session: there is nothing
        // to hand it.
        hidden: !!(agent && session.watching && session.watching.session === agent.session),
        enabled: handEnabled,
        reason: devServer && !missing ? TEXT.DEV_SERVER_NO_HANDOFF : null,
        busy: busyAction === "pickup" || busyAction === "launch",
        expanded: state.menu === review.id && handEnabled
      }
    };

    var panel = null;
    if (state.panel && state.panel.review === review.id) {
      panel = {
        reason: state.panel.reason,
        intro: state.panel.reason === "refused" ? TEXT.PANEL_REFUSED : TEXT.PANEL_NO_AGENT,
        message: handoffFor(session),
        copyLabel: TEXT.COPY,
        closeLabel: TEXT.CLOSE,
        copyStatus: state.panel.copied === true ? TEXT.COPIED : state.panel.copied === false ? TEXT.COPY_FAILED : null
      };
    }

    var badges = [];
    if (review.ended) badges.push(TEXT.BADGE_ENDED);
    if (review.served_url) badges.push(TEXT.BADGE_SERVED);
    if (session.watching && !sameWatcher(session.watching, cardWatching)) {
      badges.push(fill(TEXT.BADGE_WATCHING, { agent: agentLabel(session.watching) }));
    }

    var folded = review.folded_from && review.folded_from.length
      ? fill(TEXT.FOLDED, { n: review.folded_from.length + 1 })
      : null;

    var pages = (review.pages || []).length > 1
      ? review.pages.map(function (p) {
          return { title: p.title || p.path, path: p.path };
        })
      : [];

    return {
      id: review.id,
      session: session.id,
      name: review.display_name || review.title || review.id,
      where: whereText(review, inCard ? session.projects : null),
      lastText: "last " + formatTime(review.last, now, opts.timeZone),
      counts: {
        waiting: review.waiting > 0 ? review.waiting + " waiting" : null,
        comments: plural(review.total || 0, "comment", "comments"),
        asOf: review.counts_as_of && review.counts_as_of !== review.last
          ? "counts as of " + formatTime(review.counts_as_of, now, opts.timeZone)
          : null
      },
      starred: starred,
      star: {
        on: starred,
        enabled: true,
        pending: Object.prototype.hasOwnProperty.call(state.starPending || {}, review.id),
        label: starred ? TEXT.UNSTAR : TEXT.STAR
      },
      badges: badges,
      folded: folded,
      pages: pages,
      notices: notices,
      note: note,
      offerHandoff: viaAgent && !agent,
      handoffLabel: TEXT.COPY_HANDOFF,
      buttons: buttons,
      panel: panel,
      sessionText: fill(TEXT.SESSION_OF, { name: sessionTitle(session) })
    };
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  //
  // Every whitespace-separated term must appear, case-insensitively, somewhere
  // in the text a row shows or in its session's name. A query that the session
  // alone satisfies keeps the whole card.

  function terms(query) {
    return String(query || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function matchesAll(haystack, ts) {
    for (var i = 0; i < ts.length; i += 1) if (haystack.indexOf(ts[i]) === -1) return false;
    return true;
  }

  function sessionHaystack(session) {
    return [session.name, sessionTitle(session)].join("\n").toLowerCase();
  }

  function rowHaystack(review) {
    return [review.display_name, review.title, review.file, review.folder, review.path_hint, review.project]
      .filter(function (v) {
        return typeof v === "string";
      })
      .join("\n")
      .toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // The whole view
  // ---------------------------------------------------------------------------

  function projectOptions(sessions) {
    var seen = {};
    var names = [];
    sessions.forEach(function (s) {
      (s.projects || []).forEach(function (p) {
        if (!Object.prototype.hasOwnProperty.call(seen, p)) {
          seen[p] = true;
          names.push(p);
        }
      });
    });
    names.sort();
    return [{ value: "", label: TEXT.ALL_PROJECTS }].concat(
      names.map(function (p) {
        return { value: p, label: p };
      })
    );
  }

  function banner(state, list) {
    if (state.fetch === "unauthorized") return { tone: "error", text: TEXT.RESTARTED, action: "reload", actionLabel: TEXT.RELOAD };
    if (state.fetch === "unreachable") return { tone: "error", text: TEXT.NOT_RUNNING, action: null };
    if (state.fetch === "failed") return { tone: "error", text: fill(TEXT.LIST_FAILED, { why: state.fetchFailure }), action: null };
    var b = state.banner;
    if (!b) return null;
    if (b.kind === "opening") {
      return {
        tone: "progress",
        text: b.agent ? fill(TEXT.OPENING_HANDOFF, { name: b.name, agent: b.agent }) : fill(TEXT.OPENING, { name: b.name }),
        action: null
      };
    }
    if (b.kind === "opened") {
      if (b.requestId) {
        var found = findReview(list, b.review);
        var q = found && found.review.request;
        if (q && q.id === b.requestId) {
          if (q.state === "done") return { tone: "ok", text: fill(TEXT.DONE_AFTER_OPEN, { name: b.name, agent: b.agent }), action: null };
          if (q.state !== "waiting") return null;
        }
        return { tone: "progress", text: fill(TEXT.OPENED_WAITING, { name: b.name, agent: b.agent }), action: null };
      }
      if (b.watched) return { tone: "ok", text: fill(TEXT.DONE_AFTER_OPEN, { name: b.name, agent: b.agent }), action: null };
      return { tone: "ok", text: fill(TEXT.OPENED, { name: b.name }), action: null };
    }
    return null;
  }

  function dialogView(state, list) {
    var d = state.dialog;
    if (!d) return null;
    var found = findReview(list, d.review);
    var agent = liveAgent(list);
    if (!found || !agent) return null;
    var others = found.session.reviews
      .filter(function (r) {
        return r.id !== d.review;
      })
      .map(function (r) {
        return r.display_name || r.id;
      });
    var body = fill(TEXT.CONFIRM_BODY, {
      name: found.review.display_name || found.review.id,
      session: sessionTitle(found.session),
      agent: agent.name
    });
    if (others.length) body += " " + TEXT.CONFIRM_MOVES;
    var buttons = [{ id: "move", label: TEXT.CONFIRM_MOVE }];
    if (found.review.openable === "yes") buttons.push({ id: "read", label: TEXT.CONFIRM_READ });
    buttons.push({ id: "cancel", label: TEXT.CONFIRM_CANCEL });
    return { review: d.review, action: d.action, title: TEXT.CONFIRM_TITLE, body: body, reviews: others, buttons: buttons };
  }

  function build(list, state, now, opts) {
    state = state || initialState();
    opts = opts || {};
    var view = {
      title: TEXT.TITLE,
      agent: agentHeader(list),
      search: { placeholder: TEXT.SEARCH_PLACEHOLDER, value: state.query || "" },
      projects: { options: [], value: state.project || "" },
      banner: banner(state, list),
      dialog: list ? dialogView(state, list) : null,
      loading: null,
      empty: null,
      notice: null,
      noMatches: null,
      sections: [],
      missing: null
    };
    if (!list) {
      if (state.fetch === "loading") view.loading = TEXT.LOADING;
      return view;
    }
    var sessions = list.sessions || [];
    view.projects.options = projectOptions(sessions);
    if (list.notice === "PROTO_CATALOG_UNREADABLE") view.notice = TEXT.STARS_UNREADABLE;
    if (!sessions.length) {
      view.empty = TEXT.EMPTY;
      return view;
    }

    var ts = terms(state.query);
    var searching = ts.length > 0;
    var weekMs = CATALOG.DEFAULT_VIEW_DAYS * 24 * 60 * 60 * 1000;
    var top = [];
    var week = [];
    var older = [];
    var olderReviews = 0;
    var missingRows = [];

    sessions.forEach(function (session) {
      if (state.project && (session.projects || []).indexOf(state.project) === -1) return;
      var wholeCard = searching && matchesAll(sessionHaystack(session), ts);
      var sessionText = sessionHaystack(session);
      var kept = session.reviews.filter(function (r) {
        return !searching || wholeCard || matchesAll(sessionText + "\n" + rowHaystack(r), ts);
      });
      var visible = [];
      kept.forEach(function (r) {
        if (r.openable === "missing") missingRows.push({ review: r, session: session });
        else visible.push(r);
      });
      if (!visible.length) return;

      var needsYou = visible.some(function (r) {
        return r.waiting > 0 || effectiveStar(r, state);
      });
      var recent = now - Date.parse(session.last) < weekMs;
      var bucket = needsYou ? top : recent ? week : older;
      var defaultOpen = bucket !== older;
      var open = searching
        ? true
        : Object.prototype.hasOwnProperty.call(state.expanded || {}, session.id)
          ? state.expanded[session.id]
          : defaultOpen;
      var waiting = visible.reduce(function (sum, r) {
        return sum + (r.waiting || 0);
      }, 0);
      if (bucket === older) olderReviews += visible.length;
      bucket.push({
        id: session.id,
        title: sessionTitle(session),
        projects: (session.projects || []).slice(),
        reviewsText: plural(visible.length, "review", "reviews"),
        watchText: watchText(session, list),
        watched: !!session.watching,
        waitingText: waiting > 0 ? waiting + " waiting" : null,
        lastText: "last " + formatTime(session.last, now, opts.timeZone),
        open: open,
        rows: visible.map(function (r) {
          return buildRow(r, session, list, state, now, opts, session.watching || null, true);
        })
      });
    });

    if (top.length) view.sections.push({ id: "top", heading: fill(TEXT.SECTION_TOP, { n: top.length }), cards: top });
    if (week.length) view.sections.push({ id: "week", heading: fill(TEXT.SECTION_WEEK, { n: week.length }), cards: week });
    if (older.length) {
      view.sections.push({
        id: "older",
        heading: fill(TEXT.SECTION_OLDER, { reviews: plural(olderReviews, "review", "reviews") }),
        cards: older
      });
    }

    if (missingRows.length) {
      view.missing = {
        shown: !!state.showMissing,
        toggleText: fill(TEXT.SHOW_MISSING, { n: missingRows.length }),
        section: state.showMissing
          ? {
              heading: fill(TEXT.MISSING_HEADING, { n: missingRows.length }),
              hideText: TEXT.HIDE,
              rows: missingRows.map(function (m) {
                return buildRow(m.review, m.session, list, state, now, opts, null, false);
              })
            }
          : null
      };
    }

    if (searching && !view.sections.length && !view.missing) view.noMatches = TEXT.NO_MATCHES;
    return view;
  }

  // ---------------------------------------------------------------------------
  // Clicks
  // ---------------------------------------------------------------------------

  function findReview(list, reviewId) {
    var sessions = (list && list.sessions) || [];
    for (var s = 0; s < sessions.length; s += 1) {
      for (var r = 0; r < sessions[s].reviews.length; r += 1) {
        if (sessions[s].reviews[r].id === reviewId) return { review: sessions[s].reviews[r], session: sessions[s] };
      }
    }
    return null;
  }

  function isOpening(state, reviewId) {
    return !!(state && state.opening && state.opening[reviewId]);
  }

  function watchedByOther(session, agent) {
    return !!(session.watching && agent && session.watching.session !== agent.session);
  }

  /**
   * What a click should do, before anything is sent.
   *
   * @param {string} action "open" | "pickup" | "launch"
   * @param {{confirmed?: boolean, read?: boolean}} options confirmed: the
   *   reader chose "Move the session"; read: "Just open it to read"
   * @returns {{kind: "none"|"handoff"|"already"|"confirm"|"open"|"request", ...}}
   *   open: {tab, body} where tab is whether a new tab is opened first;
   *   request: {body}; already: {note}; handoff: {reason}; confirm: {action}
   */
  function decide(list, state, reviewId, action, options) {
    options = options || {};
    var found = findReview(list, reviewId);
    if (!found || found.review.openable === "missing") return { kind: "none" };
    // An Open on this row is still in flight: a second click sends nothing.
    if (isOpening(state, reviewId)) return { kind: "none" };
    var review = found.review;
    var agent = liveAgent(list);
    var viaAgent = review.openable === "via-agent";
    var waiting = !!(review.request && review.request.state === "waiting");
    var already = {
      kind: "already",
      review: reviewId,
      note: { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: review.request && review.request.by_name || (agent && agent.name) || "the agent" }), tone: "info" }
    };

    if (action === "open") {
      if (viaAgent && !agent) return { kind: "handoff", review: reviewId, reason: "no_agent" };
      if (options.read && !viaAgent) {
        return { kind: "open", review: reviewId, tab: true, body: { review: reviewId, handoff: false, confirmed: false } };
      }
      if (viaAgent && waiting) return already;
      var handoff = !!agent && !waiting;
      if (handoff && watchedByOther(found.session, agent) && !options.confirmed) {
        return { kind: "confirm", review: reviewId, action: action };
      }
      return {
        kind: "open",
        review: reviewId,
        tab: !viaAgent,
        body: { review: reviewId, handoff: handoff, confirmed: !!options.confirmed }
      };
    }

    if (action === "pickup" || action === "launch") {
      if (!agent) return { kind: "handoff", review: reviewId, reason: "no_agent" };
      if (waiting) return already;
      if (watchedByOther(found.session, agent) && !options.confirmed) {
        return { kind: "confirm", review: reviewId, action: action };
      }
      return { kind: "request", review: reviewId, body: { review: reviewId, action: action, confirmed: !!options.confirmed } };
    }
    return { kind: "none" };
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  //
  // A result is what page.js got back: {ok: true, body}, {ok: false, status,
  // error: {code, message, remedy}}, {ok: false, unreachable: true}, or, for
  // Open only, {ok: false, urlRefused: true}.

  function clearRow(state, reviewId) {
    var out = assign({}, state, { notes: withKey(state.notes, reviewId, undefined) });
    if (out.panel && out.panel.review === reviewId) out.panel = null;
    if (out.dialog && out.dialog.review === reviewId) out.dialog = null;
    return out;
  }

  function errorText(error) {
    if (!error) return TEXT.UNKNOWN_ERROR;
    return [error.message, error.remedy]
      .filter(function (t) {
        return typeof t === "string" && t;
      })
      .join(" ") || TEXT.UNKNOWN_ERROR;
  }

  // What every refusal shared by Open and a request comes to.
  function refused(state, list, reviewId, action, result, now) {
    if (result.unreachable) return withFetch(state, { ok: false, unreachable: true });
    if (result.status === 401) return withFetch(state, { ok: false, status: 401 });
    var code = result.error && result.error.code;
    var found = findReview(list, reviewId);
    var agent = liveAgent(list);
    var agentName = (found && found.review.request && found.review.request.by_name) || (agent && agent.name) || "the agent";
    if (code === "PROTO_CONFIRM_NEEDED") return withDialog(state, reviewId, action);
    if (code === "PROTO_NO_AGENT") return withPanel(state, reviewId, "no_agent");
    if (code === "PROTO_REQUEST_PENDING") {
      return withNote(state, reviewId, { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: agentName }), tone: "info" }, now);
    }
    if (code === "PROTO_QUEUE_FULL") return withNote(state, reviewId, { kind: "error", text: TEXT.QUEUE_FULL, tone: "warn" }, now);
    return withNote(state, reviewId, { kind: "error", text: errorText(result.error), tone: "warn" }, now);
  }

  /** Open was clicked and decided: say so while it is in flight. */
  function beginOpen(state, list, reviewId, options) {
    options = options || {};
    var out = clearRow(state, reviewId);
    out.opening = withKey(state.opening, reviewId, true);
    var found = findReview(list, reviewId);
    var agent = liveAgent(list);
    if (!found || options.tab === false) return assign(out, { banner: null });
    return assign(out, {
      banner: {
        kind: "opening",
        review: reviewId,
        name: found.review.display_name || reviewId,
        agent: options.handoff && agent ? agent.name : null
      }
    });
  }

  function afterOpen(state, list, reviewId, result, now) {
    var opening = state.banner && state.banner.review === reviewId ? state.banner : null;
    var out = assign({}, state, { banner: null, opening: withKey(state.opening, reviewId, undefined) });
    if (!result || !result.ok) {
      if (result && result.urlRefused) return withNote(out, reviewId, { kind: "error", text: TEXT.URL_REFUSED, tone: "warn" }, now);
      return refused(out, list, reviewId, "open", result || { unreachable: true }, now);
    }
    var body = result.body || {};
    var found = findReview(list, reviewId);
    var agent = liveAgent(list);
    var name = found ? found.review.display_name || reviewId : reviewId;
    if (body.not_asked === "queue_full") return withNote(out, reviewId, { kind: "opened", text: TEXT.OPENED_QUEUE_FULL, tone: "warn" }, now);
    if (body.not_asked === "no_agent") return withNote(out, reviewId, { kind: "opened", text: TEXT.OPENED_NO_AGENT, tone: "warn" }, now);
    if (body.not_asked === "request_pending" && body.url) {
      // The review already had a request waiting: the tab opened, and nobody
      // was asked a second time.
      var pendingAgent = (found && found.review.request && found.review.request.by_name) || (agent && agent.name) || "the agent";
      out = withNote(out, reviewId, { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: pendingAgent }), tone: "info" }, now);
      return assign(out, { banner: { kind: "opened", review: reviewId, name: name, agent: null, requestId: null, watched: false } });
    }
    if (!body.url) {
      // No server could be restarted, so the helper queued a pick-up for the
      // attached agent instead. page.js has already closed the blank tab.
      if (!body.request_id) return out;
      return withNote(out, reviewId, {
        kind: "waiting",
        text: fill(TEXT.WAITING, { agent: agent ? agent.name : "the agent" }),
        tone: "info",
        busy: true,
        action: "pickup",
        requestId: body.request_id
      }, now);
    }
    var handedOver = !!(opening && opening.agent);
    return assign(out, {
      banner: {
        kind: "opened",
        review: reviewId,
        name: name,
        agent: handedOver ? opening.agent : null,
        requestId: handedOver && body.request_id ? body.request_id : null,
        watched: !!(handedOver && agent && found && found.session.watching && found.session.watching.session === agent.session)
      }
    });
  }

  function afterRequest(state, list, reviewId, action, result, now) {
    var out = clearRow(state, reviewId);
    if (!result || !result.ok) return refused(out, list, reviewId, action, result || { unreachable: true }, now);
    var agent = liveAgent(list);
    if (result.body && result.body.request_id === null) {
      return withNote(out, reviewId, {
        kind: "has",
        text: fill(TEXT.ALREADY_HAS, { agent: agent ? agent.name : "the agent" }),
        tone: "ok"
      }, now);
    }
    return withNote(out, reviewId, {
      kind: "waiting",
      text: fill(TEXT.WAITING, { agent: agent ? agent.name : "the agent" }),
      tone: "info",
      busy: true,
      action: action,
      requestId: (result.body && result.body.request_id) || null
    }, now);
  }

  function beginStar(state, reviewId, desired) {
    return assign({}, state, { starPending: withKey(state.starPending, reviewId, !!desired) });
  }

  function afterStar(state, reviewId, desired, result, now) {
    var out = assign({}, state, { starPending: withKey(state.starPending, reviewId, undefined) });
    if (result && result.ok) {
      out.starOverride = withKey(state.starOverride, reviewId, !!desired);
      out.notes = withKey(state.notes, reviewId, undefined);
      return out;
    }
    if (result && result.status === 401) return withFetch(out, { ok: false, status: 401 });
    var why = !result || result.unreachable
      ? TEXT.STAR_NOT_RUNNING
      : (result.error && (result.error.remedy || result.error.message)) || TEXT.UNKNOWN_ERROR;
    return withNote(out, reviewId, { kind: "error", text: fill(TEXT.STAR_FAILED, { why: withoutFinalPeriod(why) }), tone: "warn" }, now);
  }

  // ---------------------------------------------------------------------------
  // The Open URL check
  // ---------------------------------------------------------------------------
  //
  // The helper answers Open with the document's URL, and the page sends a tab
  // there. Only a loopback http: address is followed: anything else closes the
  // tab and says why, so a bad answer can never send the reader off the machine.

  function isLoopbackHttpUrl(value) {
    if (typeof value !== "string" || !value) return false;
    var parsed;
    try {
      parsed = new URL(value);
    } catch (err) {
      return false;
    }
    if (parsed.protocol !== "http:") return false;
    if (parsed.username || parsed.password) return false;
    return protocol.LOOPBACK_ORIGIN_HOSTS.indexOf(parsed.hostname) !== -1;
  }

  return {
    TEXT: TEXT,
    initialState: initialState,
    withFetch: withFetch,
    shouldPoll: shouldPoll,
    withQuery: withQuery,
    withProject: withProject,
    withShowMissing: withShowMissing,
    withExpanded: withExpanded,
    withPanel: withPanel,
    withMenu: withMenu,
    withDialog: withDialog,
    withCopied: withCopied,
    popupBlocked: popupBlocked,
    withNote: withNote,
    afterList: afterList,
    beginOpen: beginOpen,
    afterOpen: afterOpen,
    afterRequest: afterRequest,
    beginStar: beginStar,
    afterStar: afterStar,
    isLoopbackHttpUrl: isLoopbackHttpUrl,
    formatTime: formatTime,
    build: build,
    decide: decide
  };
});
