/*
 * live-agentic-html-editor Library page
 * version 0.4.0+2aac4a0d02b6
 *
 * GENERATED FILE. Do not edit. Edit the sources under src/ and run
 *   npm run build:layer
 *
 * Bundled by esbuild in the order given by src/shared/manifest.js.
 */
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/layer/catalog/view_model.js
  var require_view_model = __commonJS({
    "src/layer/catalog/view_model.js"(exports, module) {
      (function(root, factory) {
        "use strict";
        var browser = typeof window !== "undefined" && !!window.document;
        if (browser) {
          root.LAHE = root.LAHE || {};
          root.LAHE.catalogViewModel = factory(root.LAHE.protocol);
        } else {
          module.exports = factory(__require("../../shared/protocol.js"));
        }
      })(typeof globalThis !== "undefined" ? globalThis : exports, function(protocol) {
        "use strict";
        var CATALOG2 = protocol.CATALOG;
        var LEGACY_SESSION = "legacy";
        var TEXT = {
          TITLE: "Lahe Library",
          AGENT_ATTACHED: "Hand-overs go to: {agent}",
          AGENT_NONE: "No agent attached. Open still works; hand-overs give you a message to paste.",
          AGENT_STOPPED: "{agent} is attached but has stopped watching. Open still works; hand-overs give you a message to paste.",
          // On a Mac the helper opens the new Terminal window itself, so Launch a
          // new agent needs no attached agent (catalog_launch.js).
          AGENT_NONE_DIRECT: "No agent attached. Open and Launch a new agent still work; Pick this up gives you a message to paste.",
          AGENT_STOPPED_DIRECT: "{agent} is attached but has stopped watching. Open and Launch a new agent still work; Pick this up gives you a message to paste.",
          LAUNCHING: "Opening a new Terminal window.",
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
          PANEL_NO_AGENT: "No agent is attached. This is the same hand-off message the chat bar already copies. Paste it into any agent:",
          PANEL_REFUSED: "This is the same hand-off message the chat bar already copies. Paste it into a new agent:",
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
          // A launched agent takes the document's session over. These rows have
          // none to take, so Launch is off and no hand-off message is offered.
          LAUNCH_NO_SESSION_LEGACY: "This review is from before sessions, so there is no session for a new agent to take over. Pick this up has the attached agent serve it.",
          PANEL_NO_SESSION: "This document has no session a new agent could take over, so there is no hand-off message. Attach an agent with lahe library, then choose Pick this up.",
          DEV_SERVER_NO_HANDOFF: "An app's dev server serves this page, so no agent can take it from here. Start the dev server and open the page yourself.",
          SEARCH_PLACEHOLDER: "Search titles, files, folders, sessions",
          ALL_PROJECTS: "All projects",
          SECTION_TOP: "Unanswered comments, and starred ({n})",
          SECTION_WEEK: "This week ({n})",
          SECTION_OLDER: "Older than a week: {reviews}",
          SECTION_OLDER_NOTE: "Search reaches all of them.",
          SHOW_MISSING: "Show {n} missing",
          MISSING_HEADING: "Missing ({n}). Neither the file nor a main-repo copy exists.",
          HIDE: "Hide",
          // The card names its watcher once, so its rows need not repeat it. It
          // says only what is known (phase 8): a live monitor is "listening", a lahe
          // command inside CATALOG.WORKING_MS is "working", and anything older is
          // just when the agent was last active. A flat "watching" called an agent
          // that went quiet ten minutes ago a watcher.
          WATCH_LISTENING: "{agent} is listening",
          WATCH_WORKING: "{agent} is working, last active {time}",
          WATCH_AWAY: "{agent} last active {time}, not listening",
          WATCH_AWAY_NO_TIME: "{agent} is not listening",
          WATCH_NONE: "no agent listening",
          WATCH_LIBRARY_AGENT: "{agent} (the agent that opened this Library)",
          // The watcher's name is the card's own title: a session watched by its
          // own agent, often one launched for the document and named after it.
          WATCH_OWN: "its own agent",
          WATCH_OWN_START: "Its own agent",
          WAITING_ONE: "1 comment is waiting.",
          WAITING_MANY: "{n} comments are waiting.",
          UNNAMED_SESSION: 'Unnamed session, started on "{name}"',
          // Not in the Page Spec: the reader's "legacy" group is lahe add reviews
          // from before agent sessions existed, and "Unnamed session" would be untrue.
          LEGACY_SESSION: "Reviews from before sessions",
          // One card per project for pre-session reviews (phase 8): one card of
          // every project's old reviews read as a mix nobody made.
          LEGACY_PROJECT: "{project}, from before sessions",
          SESSION_OF: 'session "{name}"',
          BADGE_ENDED: "review ended",
          BADGE_SERVED: "being served now",
          BADGE_LISTENING: "agent listening: {agent}",
          BADGE_WORKING: "agent working: {agent}",
          FOLDED: "{n} reviews of this folder, shown as one",
          FOLDED_DOCUMENT: "{n} reviews of this document, shown as one",
          PAGES: "{n} pages",
          SHOW_MORE: "Show {n} more",
          SHOW_FEWER: "Show fewer",
          UNREADABLE: "Some of this review's records can't be read.",
          MISSING: "File is gone. Open unavailable.",
          // A legacy review belongs to no session: Pick this up has the attached
          // agent take it into its own session and serve it, old comments and all.
          LEGACY_PICKUP: "From before sessions. Pick this up has the attached agent take it into its session and serve it, with its old comments.",
          WORKTREE: "The worktree is gone. An agent will open the main repository's copy, which may differ from what you reviewed.",
          // With stable addresses the helper shows that copy itself, read-only.
          WORKTREE_READONLY: "The worktree is gone. Open shows the main repository's copy, read-only, which may differ from what you reviewed.",
          MOVED: "Moved from a worktree that is gone. Your comments came with it.",
          OPENED_RAIL_HELD: `Opened. This file's review is "{name}", so the page shows its comments. Open did not move the chat bar.`,
          OPENED_RETIRED: "Opened. This review was retired, so it answers on no page. The page shows the file's current review, if it has one.",
          BADGE_RETIRED: "review retired",
          NEEDS_AGENT: "Needs an agent to reopen. No agent is attached.",
          NO_MATCHES: "Nothing matches that search.",
          RESTARTED: "Lahe restarted, reload this page.",
          RELOAD: "Reload",
          NOT_RUNNING: "Lahe is not running. Ask an agent to open the lahe library.",
          EMPTY: "No reviews yet. Documents you review in Lahe show up here.",
          LOADING: "Loading the Library.",
          STAR: "Star",
          UNSTAR: "Remove the star",
          STAR_FAILED: "Couldn't save the star: {why}. The star goes back.",
          STAR_NOT_RUNNING: "Lahe is not running",
          RENAME: "Rename",
          RENAME_FAILED: "Couldn't save the rename: {why}. The old name goes back.",
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
          URL_REFUSED: "Lahe answered with an address that is not on this computer, so the Library did not open it.",
          UNKNOWN_ERROR: "Something went wrong.",
          CONFIRM_TITLE: "Another agent is on this session.",
          CONFIRM_BODY: '"{name}" belongs to session "{session}". Handing it to {agent} moves the whole session and stops the other agent.',
          CONFIRM_BODY_LAUNCH: '"{name}" belongs to session "{session}". A new agent takes the whole session over and stops the other agent.',
          CONFIRM_MOVES: "These reviews move with it:",
          CONFIRM_MOVE: "Move the session",
          CONFIRM_READ: "Just open it to read",
          CONFIRM_CANCEL: "Cancel",
          // failures.js holds PROTO_CATALOG_UNREADABLE's own wording, but the page
          // cannot load failures.js (the asset allowlist is fixed), so the notice is
          // spelled here from the same sentence.
          STARS_UNREADABLE: "Stars can't change right now: the Library's saved stars file can't be read. Lahe leaves the file as it is."
        };
        function fill(template, values) {
          return template.replace(/\{(\w+)\}/g, function(m, key) {
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
          if (value === void 0) delete out[key];
          else out[key] = value;
          return out;
        }
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
            starOverride: {},
            // {reviewId: true}: a review whose page list the reader opened.
            pagesOpen: {},
            // {cardId: true}: a card whose every review the reader asked to see.
            cardMore: {},
            // reviewId | null: the row whose name is being edited.
            renaming: null,
            // {reviewId: name|null}: a rename sent that the list has not caught up with.
            nameOverride: {}
          };
        }
        function withFetch(state, result) {
          var fetchState = "unreachable";
          var failure2 = null;
          if (result && result.ok) fetchState = "ok";
          else if (result && result.status === 401) fetchState = "unauthorized";
          else if (result && !result.unreachable && typeof result.status === "number") {
            fetchState = "failed";
            failure2 = errorText(result.error);
          }
          return assign({}, state, { fetch: fetchState, fetchFailure: failure2 });
        }
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
        function withRenaming(state, reviewId) {
          return assign({}, state, { renaming: reviewId || null });
        }
        function cleanTyped(name) {
          var t = typeof name === "string" ? name.trim() : "";
          return t || null;
        }
        function beginRename(state, reviewId, name) {
          return assign({}, state, { renaming: null, nameOverride: withKey(state.nameOverride || {}, reviewId, cleanTyped(name)) });
        }
        function afterRename(state, reviewId, result, now) {
          if (result && result.ok) {
            var kept = result.body && Object.prototype.hasOwnProperty.call(result.body, "name") ? result.body.name : void 0;
            var out = assign({}, state, { notes: withKey(state.notes, reviewId, void 0) });
            if (kept !== void 0) out.nameOverride = withKey(state.nameOverride || {}, reviewId, kept || null);
            return out;
          }
          var back = assign({}, state, { nameOverride: withKey(state.nameOverride || {}, reviewId, void 0) });
          if (result && result.status === 401) return withFetch(back, { ok: false, status: 401 });
          var why = !result || result.unreachable ? TEXT.STAR_NOT_RUNNING : result.error && (result.error.remedy || result.error.message) || TEXT.UNKNOWN_ERROR;
          return withNote(back, reviewId, { kind: "error", text: fill(TEXT.RENAME_FAILED, { why: withoutFinalPeriod(why) }), tone: "warn" }, now);
        }
        var SESSION_KEY = "session:";
        function sessionCustomName(session, state) {
          var o = state.nameOverride || {};
          var key = SESSION_KEY + session.id;
          if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
          return typeof session.custom_name === "string" && session.custom_name ? session.custom_name : null;
        }
        function customName(review, state) {
          var o = state.nameOverride || {};
          if (Object.prototype.hasOwnProperty.call(o, review.id)) return o[review.id];
          return typeof review.custom_name === "string" && review.custom_name ? review.custom_name : null;
        }
        function withPagesOpen(state, reviewId, open) {
          return assign({}, state, { pagesOpen: withKey(state.pagesOpen || {}, reviewId, open ? true : void 0) });
        }
        function withCardMore(state, cardId, open) {
          return assign({}, state, { cardMore: withKey(state.cardMore || {}, cardId, open ? true : void 0) });
        }
        function withExpanded(state, sessionId, open) {
          return assign({}, state, { expanded: withKey(state.expanded, sessionId, !!open) });
        }
        function withMenu(state, reviewId) {
          return assign({}, state, { menu: reviewId || null });
        }
        function withPanel(state, reviewId, reason) {
          return assign({}, state, { panel: reviewId ? { review: reviewId, reason: reason || "no_agent" } : null });
        }
        function withCopied(state, reviewId, ok) {
          if (!state.panel || state.panel.review !== reviewId) return state;
          return assign({}, state, { panel: assign({}, state.panel, { copied: !!ok }) });
        }
        function popupBlocked(state, reviewId, now) {
          return withNote(state, reviewId, { kind: "error", text: TEXT.POPUP_BLOCKED, tone: "warn" }, now);
        }
        function withDialog(state, reviewId, action) {
          return assign({}, state, { dialog: reviewId ? { review: reviewId, action } : null });
        }
        function withNote(state, reviewId, note, now) {
          return assign({}, state, { notes: withKey(state.notes, reviewId, note ? assign({}, note, { at: now }) : void 0) });
        }
        function afterList(state, list) {
          var override = assign({}, state.starOverride);
          Object.keys(override).forEach(function(id) {
            var found = findReview(list, id);
            if (!found || !!found.review.starred === override[id]) delete override[id];
          });
          var names = assign({}, state.nameOverride);
          Object.keys(names).forEach(function(id) {
            if (id.indexOf(SESSION_KEY) === 0) {
              var sid = id.slice(SESSION_KEY.length);
              var s = (list && list.sessions || []).filter(function(x) {
                return x.id === sid;
              })[0];
              if (!s || (s.custom_name || null) === names[id]) delete names[id];
              return;
            }
            var found = findReview(list, id);
            if (!found || (found.review.custom_name || null) === names[id]) delete names[id];
          });
          return assign({}, state, { starOverride: override, nameOverride: names });
        }
        function parts(ms, timeZone) {
          var fmt = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "short",
            day: "numeric",
            weekday: "short",
            hour: "numeric",
            minute: "2-digit"
          });
          var out = {};
          fmt.formatToParts(new Date(ms)).forEach(function(p) {
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
        function agentLabel(ref) {
          if (!ref) return null;
          return ref.name || ref.session || null;
        }
        function liveAgent(list) {
          var a = list && list.attached;
          if (!a || !a.session || a.watching === false) return null;
          return { session: a.session, name: agentLabel(a) };
        }
        function directLaunch(list) {
          return !!(list && list.launch && list.launch.direct === true);
        }
        function agentHeader(list) {
          var a = list && list.attached;
          var direct = directLaunch(list);
          var none = direct ? TEXT.AGENT_NONE_DIRECT : TEXT.AGENT_NONE;
          if (a && a.closed === true) return { attached: false, text: none };
          if (a && a.session && a.watching !== false) {
            return { attached: true, text: fill(TEXT.AGENT_ATTACHED, { agent: agentLabel(a) }) };
          }
          if (a && a.session) {
            return { attached: false, text: fill(direct ? TEXT.AGENT_STOPPED_DIRECT : TEXT.AGENT_STOPPED, { agent: agentLabel(a) }) };
          }
          return { attached: false, text: none };
        }
        function handoffFor(session, list) {
          var legacy = !session || isLegacy(session);
          var name = legacy || session.name_from_page === true ? null : session.name || null;
          var dirPath = list && typeof list.state_dir === "string" && list.state_dir ? list.state_dir : null;
          return protocol.handoffMessage({
            from: "library",
            sessionId: legacy ? null : session.id,
            name,
            stateDir: dirPath,
            request: null
          });
        }
        function sameWatcher(a, b) {
          return !!(a && b && a.session === b.session);
        }
        var STATE_LISTENING = "listening";
        var STATE_WORKING = "working";
        function agentPhrase(ref, session, list, start) {
          var attached = list && list.attached;
          var agent = agentLabel(ref);
          if (attached && attached.session && ref.session === attached.session) return fill(TEXT.WATCH_LIBRARY_AGENT, { agent });
          if (agent === sessionTitle(session)) return start ? TEXT.WATCH_OWN_START : TEXT.WATCH_OWN;
          return agent;
        }
        function watchText(session, list, now, opts, start) {
          var w = session.watching;
          if (w) {
            var agent = agentPhrase(w, session, list, start);
            if (w.state === STATE_WORKING) {
              return fill(TEXT.WATCH_WORKING, { agent, time: formatTime(w.last_active, now, opts.timeZone) });
            }
            return fill(TEXT.WATCH_LISTENING, { agent });
          }
          var a = session.away;
          if (a) {
            var who = agentPhrase(a, session, list, start);
            if (!a.last_active) return fill(TEXT.WATCH_AWAY_NO_TIME, { agent: who });
            return fill(TEXT.WATCH_AWAY, { agent: who, time: formatTime(a.last_active, now, opts.timeZone) });
          }
          return TEXT.WATCH_NONE;
        }
        function waitingIn(session) {
          return (session.reviews || []).reduce(function(sum, r) {
            return r.openable === "missing" ? sum : sum + (r.waiting || 0);
          }, 0);
        }
        function plural(n, one, many) {
          return n + " " + (n === 1 ? one : many);
        }
        function isLegacy(session) {
          return !!session && (session.id === LEGACY_SESSION || session.id.indexOf(LEGACY_SESSION + ":") === 0);
        }
        function sessionTitle(session) {
          if (session.legacyProject) return fill(TEXT.LEGACY_PROJECT, { project: session.legacyProject });
          if (isLegacy(session)) return TEXT.LEGACY_SESSION;
          if (session.name) return session.name;
          var reviews = session.reviews || [];
          var first = reviews.length ? reviews[reviews.length - 1] : null;
          return fill(TEXT.UNNAMED_SESSION, { name: first ? first.display_name : session.id });
        }
        var CARD_ROWS_SHOWN = 5;
        function fullPath(review) {
          var dirPart = typeof review.path_hint === "string" ? review.path_hint : "";
          var file = typeof review.file === "string" && review.file ? review.file : "";
          return dirPart && file ? dirPart.replace(/\/+$/, "") + "/" + file : dirPart || "";
        }
        function pathText(review) {
          return typeof review.project_path === "string" && review.project_path ? review.project_path : fullPath(review);
        }
        function withoutFinalPeriod(text) {
          return String(text == null ? "" : text).replace(/[.\s]+$/, "");
        }
        function requestNote(review, list) {
          var q = review.request;
          if (!q) return null;
          var agent = q.by_name || agentLabel(list && list.attached) || "the agent";
          if (q.state === "waiting") {
            return { text: fill(TEXT.WAITING, { agent }), tone: "info", busy: true, copyHandoff: false, action: q.action };
          }
          if (q.state === "done") {
            return { text: fill(TEXT.DONE, { agent, text: q.text || "" }), tone: "ok", busy: false, copyHandoff: false };
          }
          if (q.state === "refused") {
            var live = liveAgent(list);
            if (!live || live.name !== q.by_name) return null;
            return {
              text: fill(TEXT.REFUSED, { agent, text: withoutFinalPeriod(q.text) }),
              tone: "warn",
              busy: false,
              copyHandoff: q.action === "launch"
            };
          }
          if (q.state === "expired") {
            var launch = q.action === "launch";
            var why = q.reason === "attach_changed" ? TEXT.EXPIRED_ATTACH_CHANGED : q.reason === "monitor_dead" ? TEXT.EXPIRED_MONITOR_DEAD : TEXT.EXPIRED_TIMEOUT;
            return {
              text: (launch ? TEXT.EXPIRED_LAUNCH : TEXT.EXPIRED_PICKUP) + " " + fill(why, { agent }),
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
          if (!missing && review.kind === "worktree") {
            notices.push({ text: viaAgent ? TEXT.WORKTREE : TEXT.WORKTREE_READONLY, tone: "info" });
          }
          if (!missing && review.moved === true) notices.push({ text: TEXT.MOVED, tone: "info" });
          if (!missing && review.kind === "legacy") notices.push({ text: TEXT.LEGACY_PICKUP, tone: "info" });
          if (viaAgent && !agent) notices.push({ text: TEXT.NEEDS_AGENT, tone: "warn" });
          if (devServer && !missing) notices.push({ text: TEXT.DEV_SERVER_NO_HANDOFF, tone: "quiet" });
          var handEnabled = !missing && !devServer;
          var noSession = review.kind === "legacy";
          var launchReason = review.kind === "legacy" ? TEXT.LAUNCH_NO_SESSION_LEGACY : null;
          if (note && noSession) note = assign({}, note, { copyHandoff: false });
          var buttons = {
            open: { label: TEXT.OPEN, enabled: !missing && !(viaAgent && !agent), busy: isOpening(state, review.id) },
            pickup: { label: TEXT.PICKUP, enabled: handEnabled, busy: busyAction === "pickup" },
            launch: { label: TEXT.LAUNCH, enabled: handEnabled && !noSession, reason: launchReason, busy: busyAction === "launch" },
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
              intro: noSession ? TEXT.PANEL_NO_SESSION : state.panel.reason === "refused" ? TEXT.PANEL_REFUSED : TEXT.PANEL_NO_AGENT,
              message: noSession ? null : handoffFor(session, list),
              copyLabel: TEXT.COPY,
              closeLabel: TEXT.CLOSE,
              copyStatus: state.panel.copied === true ? TEXT.COPIED : state.panel.copied === false ? TEXT.COPY_FAILED : null
            };
          }
          var badges = [];
          if (review.retired) badges.push(TEXT.BADGE_RETIRED);
          if (review.ended) badges.push(TEXT.BADGE_ENDED);
          if (review.served_url) badges.push(TEXT.BADGE_SERVED);
          if (session.watching && !sameWatcher(session.watching, cardWatching)) {
            var badge = session.watching.state === STATE_WORKING ? TEXT.BADGE_WORKING : TEXT.BADGE_LISTENING;
            badges.push(fill(badge, { agent: agentLabel(session.watching) }));
          }
          var folded = review.folded_from && review.folded_from.length ? fill(review.fold_kind === "document" ? TEXT.FOLDED_DOCUMENT : TEXT.FOLDED, { n: review.folded_from.length + 1 }) : null;
          var allPages = (review.pages || []).length > 1 ? review.pages : [];
          var pagesOpen = !!(state.pagesOpen && state.pagesOpen[review.id]);
          var pagesToggle = allPages.length ? { text: fill(TEXT.PAGES, { n: allPages.length }), expanded: pagesOpen } : null;
          var pages = pagesOpen ? allPages.map(function(p) {
            var where = typeof p.source === "string" && p.source ? p.source : String(p.path || "").replace(/^\/\.lahe-source\/[^/]+\//, "");
            return { title: p.title || where, path: where };
          }) : [];
          var original = review.display_name || review.title || review.id;
          var renamed = customName(review, state);
          if (renamed === original) renamed = null;
          return {
            id: review.id,
            session: session.id,
            name: renamed || original,
            // The document's own name, under the reviewer's when they renamed it.
            originalName: renamed ? original : null,
            rename: { editing: state.renaming === review.id, value: renamed || original, label: TEXT.RENAME, original },
            path: pathText(review),
            pathTitle: fullPath(review),
            address: addressLink(review.address),
            lastText: "last " + formatTime(review.last, now, opts.timeZone),
            counts: {
              waiting: review.waiting > 0 ? review.waiting + " waiting" : null,
              comments: plural(review.total || 0, "comment", "comments"),
              asOf: review.counts_as_of && review.counts_as_of !== review.last ? "counts as of " + formatTime(review.counts_as_of, now, opts.timeZone) : null
            },
            starred,
            star: {
              on: starred,
              enabled: true,
              pending: Object.prototype.hasOwnProperty.call(state.starPending || {}, review.id),
              label: starred ? TEXT.UNSTAR : TEXT.STAR
            },
            badges,
            folded,
            pages,
            pagesToggle,
            notices,
            note,
            offerHandoff: viaAgent && !agent && !noSession,
            handoffLabel: TEXT.COPY_HANDOFF,
            buttons,
            panel,
            sessionText: fill(TEXT.SESSION_OF, { name: sessionTitle(session) })
          };
        }
        function cardSessions(sessions) {
          var out = [];
          sessions.forEach(function(session) {
            if (session.id !== LEGACY_SESSION) {
              out.push(session);
              return;
            }
            var groups = {};
            var order = [];
            session.reviews.forEach(function(r) {
              var key = typeof r.project === "string" && r.project ? r.project : "";
              if (!Object.prototype.hasOwnProperty.call(groups, key)) {
                groups[key] = [];
                order.push(key);
              }
              groups[key].push(r);
            });
            order.forEach(function(key) {
              var reviews = groups[key];
              var last = reviews.reduce(function(m, r) {
                return !m || Date.parse(r.last) > Date.parse(m) ? r.last : m;
              }, null);
              out.push(assign({}, session, {
                id: key ? LEGACY_SESSION + ":" + key : LEGACY_SESSION,
                legacyProject: key || null,
                projects: key ? [key] : [],
                reviews,
                last
              }));
            });
          });
          return out;
        }
        function hoistNotes(rows) {
          if (rows.length < 2) return [];
          var shared = rows[0].notices.filter(function(n) {
            return rows.every(function(row2) {
              return row2.notices.some(function(m) {
                return m.text === n.text;
              });
            });
          });
          if (!shared.length) return [];
          rows.forEach(function(row2) {
            row2.notices = row2.notices.filter(function(n) {
              return !shared.some(function(m) {
                return m.text === n.text;
              });
            });
          });
          return shared.map(function(n) {
            return { text: n.text, tone: n.tone };
          });
        }
        function actingOn(state, reviewId) {
          return !!(state.panel && state.panel.review === reviewId || state.menu === reviewId || state.opening && state.opening[reviewId] || state.notes && state.notes[reviewId]);
        }
        function terms(query) {
          return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
        }
        function matchesAll(haystack, ts) {
          for (var i = 0; i < ts.length; i += 1) if (haystack.indexOf(ts[i]) === -1) return false;
          return true;
        }
        function sessionHaystack(session) {
          return [session.custom_name, session.name, sessionTitle(session)].filter(function(v) {
            return typeof v === "string";
          }).join("\n").toLowerCase();
        }
        function rowHaystack(review) {
          return [review.custom_name, review.display_name, review.title, review.file, review.folder, review.path_hint, review.project].filter(function(v) {
            return typeof v === "string";
          }).join("\n").toLowerCase();
        }
        function projectOptions(sessions) {
          var seen = {};
          var names = [];
          sessions.forEach(function(s) {
            (s.projects || []).forEach(function(p) {
              if (!Object.prototype.hasOwnProperty.call(seen, p)) {
                seen[p] = true;
                names.push(p);
              }
            });
          });
          names.sort();
          return [{ value: "", label: TEXT.ALL_PROJECTS }].concat(
            names.map(function(p) {
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
        function dialogView(state, list, now, opts) {
          var d = state.dialog;
          if (!d) return null;
          var found = findReview(list, d.review);
          var agent = liveAgent(list);
          var direct = d.action === "launch" && directLaunch(list);
          if (!found || !agent && !direct) return null;
          var others = found.session.reviews.filter(function(r) {
            return r.id !== d.review;
          }).map(function(r) {
            return r.display_name || r.id;
          });
          var body = fill(direct ? TEXT.CONFIRM_BODY_LAUNCH : TEXT.CONFIRM_BODY, {
            name: found.review.display_name || found.review.id,
            session: sessionTitle(found.session),
            agent: agent ? agent.name : ""
          });
          if (others.length) body += " " + TEXT.CONFIRM_MOVES;
          var waiting = waitingIn(found.session);
          var status = watchText(found.session, list, now, opts, true) + ".";
          if (waiting > 0) status += " " + (waiting === 1 ? TEXT.WAITING_ONE : fill(TEXT.WAITING_MANY, { n: waiting }));
          var buttons = [{ id: "move", label: TEXT.CONFIRM_MOVE }];
          if (found.review.openable === "yes") buttons.push({ id: "read", label: TEXT.CONFIRM_READ });
          buttons.push({ id: "cancel", label: TEXT.CONFIRM_CANCEL });
          return { review: d.review, action: d.action, title: TEXT.CONFIRM_TITLE, status, body, reviews: others, buttons };
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
            dialog: list ? dialogView(state, list, now, opts) : null,
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
          var weekMs = CATALOG2.DEFAULT_VIEW_DAYS * 24 * 60 * 60 * 1e3;
          var top = [];
          var week = [];
          var older = [];
          var olderReviews = 0;
          var missingRows = [];
          cardSessions(sessions).forEach(function(session) {
            if (state.project && (session.projects || []).indexOf(state.project) === -1) return;
            var wholeCard = searching && matchesAll(sessionHaystack(session), ts);
            var sessionText = sessionHaystack(session);
            var kept = session.reviews.filter(function(r) {
              return !searching || wholeCard || matchesAll(sessionText + "\n" + rowHaystack(r), ts);
            });
            var visible = [];
            kept.forEach(function(r) {
              if (r.openable === "missing") missingRows.push({ review: r, session });
              else visible.push(r);
            });
            if (!visible.length) return;
            var needs = visible.filter(function(r) {
              return r.waiting > 0 || effectiveStar(r, state);
            });
            var others = visible.filter(function(r) {
              return needs.indexOf(r) === -1;
            });
            if (needs.length) top.push(makeCard(session, needs, session.id, true));
            if (others.length) {
              var othersLast = others.reduce(function(m, r) {
                return !m || Date.parse(r.last) > Date.parse(m) ? r.last : m;
              }, null);
              var bucket = now - Date.parse(othersLast) < weekMs ? week : older;
              if (bucket === older) olderReviews += others.length;
              var restId = needs.length ? session.id + ":earlier" : session.id;
              bucket.push(makeCard(session, others, restId, bucket !== older, othersLast));
            }
          });
          function makeCard(session, visible, cardId, defaultOpen, lastAt) {
            var open = searching ? true : Object.prototype.hasOwnProperty.call(state.expanded || {}, cardId) ? state.expanded[cardId] : defaultOpen;
            var waiting = visible.reduce(function(sum, r) {
              return sum + (r.waiting || 0);
            }, 0);
            var rows = visible.map(function(r) {
              return buildRow(r, session, list, state, now, opts, session.watching || null, true);
            });
            var notes = hoistNotes(rows);
            var more = null;
            var cardOpenAll = !!(state.cardMore && state.cardMore[cardId]);
            if (!searching && rows.length > CARD_ROWS_SHOWN) {
              var hidden = 0;
              if (!cardOpenAll) {
                rows = rows.filter(function(row2, i) {
                  var r = visible[i];
                  var keep = i < CARD_ROWS_SHOWN || r.waiting > 0 || row2.starred || actingOn(state, r.id);
                  if (!keep) hidden += 1;
                  return keep;
                });
              }
              if (cardOpenAll) more = { text: TEXT.SHOW_FEWER, expanded: true };
              else if (hidden > 0) more = { text: fill(TEXT.SHOW_MORE, { n: hidden }), expanded: false };
            }
            var original = sessionTitle(session);
            var renamed = sessionCustomName(session, state);
            if (renamed === original) renamed = null;
            var renameKey = SESSION_KEY + session.id;
            var at = lastAt || session.last;
            return {
              id: cardId,
              session: session.id,
              title: renamed || original,
              originalTitle: renamed ? original : null,
              // A pre-session card is ours, not a session: it has no name to change.
              rename: isLegacy(session) ? null : { editing: state.renaming === renameKey, value: renamed || original, label: TEXT.RENAME, original },
              projects: (session.projects || []).slice(),
              reviewsText: plural(visible.length, "review", "reviews"),
              watchText: watchText(session, list, now, opts, false),
              watched: !!session.watching,
              waitingText: waiting > 0 ? waiting + " waiting" : null,
              lastText: "last " + formatTime(at, now, opts.timeZone),
              open,
              lastAt: at,
              notes,
              more,
              rows
            };
          }
          [top, week, older].forEach(function(bucket) {
            bucket.sort(function(a, b) {
              var am = Date.parse(a.lastAt) || 0;
              var bm = Date.parse(b.lastAt) || 0;
              return bm - am;
            });
          });
          if (top.length) view.sections.push({ id: "top", heading: fill(TEXT.SECTION_TOP, { n: top.length }), cards: top });
          if (week.length) view.sections.push({ id: "week", heading: fill(TEXT.SECTION_WEEK, { n: week.length }), cards: week });
          if (older.length) {
            view.sections.push({
              id: "older",
              heading: fill(TEXT.SECTION_OLDER, { reviews: plural(olderReviews, "review", "reviews") }),
              subtitle: TEXT.SECTION_OLDER_NOTE,
              cards: older
            });
          }
          if (missingRows.length) {
            view.missing = {
              shown: !!state.showMissing,
              toggleText: fill(TEXT.SHOW_MISSING, { n: missingRows.length }),
              section: state.showMissing ? {
                heading: fill(TEXT.MISSING_HEADING, { n: missingRows.length }),
                hideText: TEXT.HIDE,
                rows: missingRows.map(function(m) {
                  return buildRow(m.review, m.session, list, state, now, opts, null, false);
                })
              } : null
            };
          }
          if (searching && !view.sections.length && !view.missing) view.noMatches = TEXT.NO_MATCHES;
          return view;
        }
        function findReview(list, reviewId) {
          var sessions = list && list.sessions || [];
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
        function decide(list, state, reviewId, action, options) {
          options = options || {};
          var found = findReview(list, reviewId);
          if (!found || found.review.openable === "missing") return { kind: "none" };
          if (isOpening(state, reviewId)) return { kind: "none" };
          var review = found.review;
          var agent = liveAgent(list);
          var viaAgent = review.openable === "via-agent";
          var waiting = !!(review.request && review.request.state === "waiting");
          var already = {
            kind: "already",
            review: reviewId,
            note: { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: review.request && review.request.by_name || agent && agent.name || "the agent" }), tone: "info" }
          };
          if (action === "open") {
            if (viaAgent && !agent) return { kind: "handoff", review: reviewId, reason: "no_agent" };
            if (options.read && !viaAgent) {
              return { kind: "open", review: reviewId, tab: true, body: { review: reviewId, handoff: false, confirmed: false } };
            }
            if (viaAgent && waiting) return already;
            var handoff = !!agent && !waiting;
            if (handoff && watchedByOther(found.session, agent) && !options.confirmed) {
              return { kind: "confirm", review: reviewId, action };
            }
            return {
              kind: "open",
              review: reviewId,
              tab: !viaAgent,
              body: { review: reviewId, handoff, confirmed: !!options.confirmed }
            };
          }
          if (action === "launch" && directLaunch(list)) {
            if (waiting) return already;
            if (found.session.watching && !options.confirmed) return { kind: "confirm", review: reviewId, action };
            return { kind: "request", review: reviewId, body: { review: reviewId, action, confirmed: !!options.confirmed } };
          }
          if (action === "pickup" || action === "launch") {
            if (!agent) return { kind: "handoff", review: reviewId, reason: "no_agent" };
            if (waiting) return already;
            if (watchedByOther(found.session, agent) && !options.confirmed) {
              return { kind: "confirm", review: reviewId, action };
            }
            return { kind: "request", review: reviewId, body: { review: reviewId, action, confirmed: !!options.confirmed } };
          }
          return { kind: "none" };
        }
        function clearRow(state, reviewId) {
          var out = assign({}, state, { notes: withKey(state.notes, reviewId, void 0) });
          if (out.panel && out.panel.review === reviewId) out.panel = null;
          if (out.dialog && out.dialog.review === reviewId) out.dialog = null;
          return out;
        }
        function errorText(error) {
          if (!error) return TEXT.UNKNOWN_ERROR;
          return [error.message, error.remedy].filter(function(t) {
            return typeof t === "string" && t;
          }).join(" ") || TEXT.UNKNOWN_ERROR;
        }
        function refused(state, list, reviewId, action, result, now) {
          if (result.unreachable) return withFetch(state, { ok: false, unreachable: true });
          if (result.status === 401) return withFetch(state, { ok: false, status: 401 });
          var code = result.error && result.error.code;
          var found = findReview(list, reviewId);
          var agent = liveAgent(list);
          var agentName = found && found.review.request && found.review.request.by_name || agent && agent.name || "the agent";
          if (code === "PROTO_CONFIRM_NEEDED") return withDialog(state, reviewId, action);
          if (code === "PROTO_NO_AGENT") return withPanel(state, reviewId, "no_agent");
          if (code === "PROTO_REQUEST_PENDING") {
            return withNote(state, reviewId, { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: agentName }), tone: "info" }, now);
          }
          if (code === "PROTO_QUEUE_FULL") return withNote(state, reviewId, { kind: "error", text: TEXT.QUEUE_FULL, tone: "warn" }, now);
          return withNote(state, reviewId, { kind: "error", text: errorText(result.error), tone: "warn" }, now);
        }
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
          var out = assign({}, state, { banner: null, opening: withKey(state.opening, reviewId, void 0) });
          if (!result || !result.ok) {
            if (result && result.urlRefused) return withNote(out, reviewId, { kind: "error", text: TEXT.URL_REFUSED, tone: "warn" }, now);
            return refused(out, list, reviewId, "open", result || { unreachable: true }, now);
          }
          var body = result.body || {};
          var found = findReview(list, reviewId);
          var agent = liveAgent(list);
          var name = found ? found.review.display_name || reviewId : reviewId;
          if (body.held_by && typeof body.held_by.name === "string") {
            out = withNote(out, reviewId, { kind: "opened", text: fill(TEXT.OPENED_RAIL_HELD, { name: body.held_by.name }), tone: "info" }, now);
          }
          if (body.retired === true && !body.held_by) {
            out = withNote(out, reviewId, { kind: "opened", text: TEXT.OPENED_RETIRED, tone: "info" }, now);
          }
          if (body.not_asked === "queue_full") return withNote(out, reviewId, { kind: "opened", text: TEXT.OPENED_QUEUE_FULL, tone: "warn" }, now);
          if (body.not_asked === "no_agent") return withNote(out, reviewId, { kind: "opened", text: TEXT.OPENED_NO_AGENT, tone: "warn" }, now);
          if (body.not_asked === "request_pending" && body.url) {
            var pendingAgent = found && found.review.request && found.review.request.by_name || agent && agent.name || "the agent";
            out = withNote(out, reviewId, { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: pendingAgent }), tone: "info" }, now);
            return assign(out, { banner: { kind: "opened", review: reviewId, name, agent: null, requestId: null, watched: false } });
          }
          if (!body.url) {
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
              name,
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
          if (result.body && typeof result.body.launched === "boolean") {
            return withNote(out, reviewId, {
              kind: result.body.launched ? "launched" : "error",
              text: result.body.text || TEXT.LAUNCHING,
              tone: result.body.launched ? "ok" : "warn",
              requestId: result.body.request_id || null
            }, now);
          }
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
            action,
            requestId: result.body && result.body.request_id || null
          }, now);
        }
        function beginStar(state, reviewId, desired) {
          return assign({}, state, { starPending: withKey(state.starPending, reviewId, !!desired) });
        }
        function afterStar(state, reviewId, desired, result, now) {
          var out = assign({}, state, { starPending: withKey(state.starPending, reviewId, void 0) });
          if (result && result.ok) {
            out.starOverride = withKey(state.starOverride, reviewId, !!desired);
            out.notes = withKey(state.notes, reviewId, void 0);
            return out;
          }
          if (result && result.status === 401) return withFetch(out, { ok: false, status: 401 });
          var why = !result || result.unreachable ? TEXT.STAR_NOT_RUNNING : result.error && (result.error.remedy || result.error.message) || TEXT.UNKNOWN_ERROR;
          return withNote(out, reviewId, { kind: "error", text: fill(TEXT.STAR_FAILED, { why: withoutFinalPeriod(why) }), tone: "warn" }, now);
        }
        function isLaheSiteUrl(value) {
          if (typeof value !== "string" || !value) return false;
          var parsed;
          try {
            parsed = new URL(value);
          } catch (err) {
            return false;
          }
          if (parsed.protocol !== "http:" || parsed.username || parsed.password) return false;
          var suffix = "." + protocol.PAGES.SUFFIX;
          var host = parsed.hostname;
          if (host.length <= suffix.length || host.slice(-suffix.length) !== suffix) return false;
          return protocol.isSiteName(host.slice(0, -suffix.length));
        }
        function addressLink(value) {
          if (!isLaheSiteUrl(value)) return null;
          var parsed = new URL(value);
          var readable = parsed.pathname;
          try {
            readable = decodeURIComponent(parsed.pathname);
          } catch (err) {
            readable = parsed.pathname;
          }
          return { href: value, text: parsed.host + readable };
        }
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
          TEXT,
          initialState,
          withFetch,
          shouldPoll,
          withQuery,
          withProject,
          withShowMissing,
          withExpanded,
          withPagesOpen,
          withRenaming,
          beginRename,
          afterRename,
          withCardMore,
          CARD_ROWS_SHOWN,
          withPanel,
          withMenu,
          withDialog,
          withCopied,
          popupBlocked,
          withNote,
          afterList,
          beginOpen,
          afterOpen,
          afterRequest,
          beginStar,
          afterStar,
          isLoopbackHttpUrl,
          isLaheSiteUrl,
          formatTime,
          build,
          decide
        };
      });
    }
  });

  // src/layer/copy_text.js
  var require_copy_text = __commonJS({
    "src/layer/copy_text.js"(exports, module) {
      (function(root, factory) {
        "use strict";
        var browser = typeof window !== "undefined" && !!window.document;
        if (browser) {
          root.LAHE = root.LAHE || {};
          root.LAHE.copyText = factory();
        } else {
          module.exports = factory();
        }
      })(typeof globalThis !== "undefined" ? globalThis : exports, function() {
        "use strict";
        function copyViaField(doc, text) {
          if (!doc || !doc.body || typeof doc.execCommand !== "function") return false;
          var before = doc.activeElement;
          var field = doc.createElement("textarea");
          field.value = text;
          field.setAttribute("readonly", "");
          field.setAttribute("aria-hidden", "true");
          field.setAttribute("tabindex", "-1");
          field.style.position = "fixed";
          field.style.top = "0";
          field.style.left = "-9999px";
          field.style.opacity = "0";
          doc.body.appendChild(field);
          var ok = false;
          try {
            field.focus({ preventScroll: true });
            field.select();
            field.setSelectionRange(0, text.length);
            ok = doc.execCommand("copy") === true;
          } catch (err) {
            ok = false;
          }
          if (field.parentNode) field.parentNode.removeChild(field);
          if (before && typeof before.focus === "function") {
            try {
              before.focus({ preventScroll: true });
            } catch (err) {
            }
          }
          return ok;
        }
        function copyText(text, env) {
          var e = env || {};
          var nav = e.navigator || (typeof navigator !== "undefined" ? navigator : null);
          var doc = e.document || (typeof document !== "undefined" ? document : null);
          var value = String(text === void 0 || text === null ? "" : text);
          if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
            var attempt;
            try {
              attempt = Promise.resolve(nav.clipboard.writeText(value));
            } catch (err) {
              attempt = Promise.reject(err);
            }
            return attempt.then(
              function() {
                return true;
              },
              // Refused (no permission, or the page lost focus): the field may
              // still work.
              function() {
                return copyViaField(doc, value);
              }
            );
          }
          return Promise.resolve(copyViaField(doc, value));
        }
        return copyText;
      });
    }
  });

  // src/contract/protocol.ts
  var protocol_exports = {};
  __export(protocol_exports, {
    AGENT_LIVENESS: () => AGENT_LIVENESS,
    ALIAS_MAX: () => ALIAS_MAX,
    API_VERSION: () => API_VERSION,
    AUTH: () => AUTH,
    BASE: () => BASE,
    CATALOG: () => CATALOG,
    CATALOG_LOG: () => CATALOG_LOG,
    CATALOG_PAGE_PATH: () => CATALOG_PAGE_PATH,
    CATALOG_ROUTES: () => CATALOG_ROUTES,
    CATALOG_TOKEN_META: () => CATALOG_TOKEN_META,
    CHECK: () => CHECK,
    CHECKS: () => CHECKS,
    CLIENT_CATALOG: () => CLIENT_CATALOG,
    CLIENT_CLI: () => CLIENT_CLI,
    CLIENT_LAYER: () => CLIENT_LAYER,
    CLI_EXIT: () => CLI_EXIT,
    CONTRACT_VERDICT: () => CONTRACT_VERDICT,
    DEFAULT_HELPER_ORIGIN: () => DEFAULT_HELPER_ORIGIN,
    DEFAULT_HOST: () => DEFAULT_HOST,
    DEFAULT_PORT: () => DEFAULT_PORT,
    DOCUMENT_ON: () => DOCUMENT_ON,
    EVENT: () => EVENT,
    EVENT_FIELD: () => EVENT_FIELD,
    EVENT_TYPES: () => EVENT_TYPES,
    FLUSH: () => FLUSH,
    FRAMES_ALLOW: () => FRAMES_ALLOW,
    HEADER: () => HEADER,
    HEALTH_FIELD: () => HEALTH_FIELD,
    HOST_FAMILY: () => HOST_FAMILY,
    IDEMPOTENCE_KEY: () => IDEMPOTENCE_KEY,
    JSON_CONTENT_TYPE: () => JSON_CONTENT_TYPE,
    LOOPBACK_ORIGIN_HOSTS: () => LOOPBACK_ORIGIN_HOSTS,
    MONITOR: () => MONITOR,
    NOTES_ON: () => NOTES_ON,
    ORIGIN_LIMIT: () => ORIGIN_LIMIT,
    PAGES: () => PAGES,
    PROOF: () => PROOF,
    REPLY_CURSOR_FIELD: () => REPLY_CURSOR_FIELD,
    REPLY_FIELD: () => REPLY_FIELD,
    REPLY_FILE: () => REPLY_FILE,
    REPLY_POLL: () => REPLY_POLL,
    REPLY_STATUS: () => REPLY_STATUS,
    REPLY_STATUSES: () => REPLY_STATUSES,
    ROUTES: () => ROUTES,
    SAFE_ID: () => SAFE_ID,
    SCRIPT_ATTR: () => SCRIPT_ATTR,
    SCRIPT_FALLBACK_ONERROR: () => SCRIPT_FALLBACK_ONERROR,
    SCRIPT_SELECTOR: () => SCRIPT_SELECTOR,
    SERVICE_CONTRACT: () => SERVICE_CONTRACT,
    SITE_ROUTES: () => SITE_ROUTES,
    START_HIDDEN: () => START_HIDDEN,
    SUGGESTIONS_MAX: () => SUGGESTIONS_MAX,
    SUGGESTION_TEXT_MAX: () => SUGGESTION_TEXT_MAX,
    SUMMARY_ROUTES: () => SUMMARY_ROUTES,
    SUMMARY_VERSION: () => SUMMARY_VERSION,
    WAKE: () => WAKE,
    acceptsNotesFlag: () => acceptsNotesFlag,
    agentFromFilename: () => agentFromFilename,
    catalogLogLine: () => catalogLogLine,
    checkRequest: () => checkRequest,
    classifyHost: () => classifyHost,
    drainCommand: () => drainCommand,
    encodeEventLine: () => encodeEventLine,
    errorBody: () => errorBody,
    fitsKeepalive: () => fitsKeepalive,
    handoffMessage: () => handoffMessage,
    helperContractVerdict: () => helperContractVerdict,
    hostAllowed: () => hostAllowed,
    isJsonObject: () => isJsonObject,
    isLoopbackPortOrigin: () => isLoopbackPortOrigin,
    isPathAlias: () => isPathAlias,
    isRegisterableOrigin: () => isRegisterableOrigin,
    isSafeId: () => isSafeId,
    isSiteLabel: () => isSiteLabel,
    isSiteName: () => isSiteName,
    isSpelling: () => isSpelling,
    isSpellingOrigin: () => isSpellingOrigin,
    legacyPickupNote: () => legacyPickupNote,
    livenessOverdue: () => livenessOverdue,
    monitorCommand: () => monitorCommand,
    newEvent: () => newEvent,
    nextReadOffset: () => nextReadOffset,
    parseEventLine: () => parseEventLine,
    parseReplyLine: () => parseReplyLine,
    route: () => route,
    scriptTag: () => scriptTag,
    siteNameFromOrigin: () => siteNameFromOrigin,
    siteOrigin: () => siteOrigin,
    splitCompleteLines: () => splitCompleteLines,
    stateDirFlag: () => stateDirFlag,
    statusFor: () => statusFor,
    takeoverCommand: () => takeoverCommand
  });

  // src/contract/json-object.ts
  function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // src/contract/safe-id.ts
  var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  function isSafeId(value) {
    return typeof value === "string" && SAFE_ID.test(value);
  }

  // src/contract/service-contract.ts
  var API_VERSION = "v1";
  var SERVICE_CONTRACT = 17;
  var CONTRACT_VERDICT = { CURRENT: "current", OLDER: "older", NEWER: "newer" };
  function helperContractVerdict(health) {
    const reported = isJsonObject(health) ? health["service_contract"] : void 0;
    const live = typeof reported === "number" && Number.isInteger(reported) ? reported : 0;
    if (live > SERVICE_CONTRACT) return CONTRACT_VERDICT.NEWER;
    if (live < SERVICE_CONTRACT) return CONTRACT_VERDICT.OLDER;
    return CONTRACT_VERDICT.CURRENT;
  }

  // src/contract/helper-address.ts
  var DEFAULT_PORT = 7817;
  var DEFAULT_HOST = "127.0.0.1";
  var DEFAULT_HELPER_ORIGIN = "http://" + DEFAULT_HOST + ":" + String(DEFAULT_PORT);
  var ALLOWED_HOST_NAMES = ["127.0.0.1", "localhost", "[::1]"];
  function hostAllowed(hostHeader) {
    if (typeof hostHeader !== "string" || hostHeader === "") return false;
    const name = hostHeader.replace(/:\d+$/, "");
    return ALLOWED_HOST_NAMES.some((allowed) => allowed === name);
  }

  // src/contract/review-write.ts
  var LOOPBACK_ORIGIN_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
  var ORIGIN_LIMIT = 16;
  var DEFAULT_PORT_OF = { http: "80", https: "443" };
  var ORIGIN_PATTERN = new RegExp(
    "^(https?)://(" + LOOPBACK_ORIGIN_HOSTS.map((host) => host.replace(/[.[\]]/g, "\\$&")).join("|") + ")(?::(0|[1-9][0-9]{0,4}))?$"
  );
  function isRegisterableOrigin(origin) {
    if (typeof origin !== "string") return false;
    if (origin === "null") return true;
    const match = ORIGIN_PATTERN.exec(origin);
    const scheme = match?.[1];
    if (scheme !== "http" && scheme !== "https") return false;
    const port = match?.[3];
    if (port === void 0) return true;
    return Number(port) <= 65535 && port !== DEFAULT_PORT_OF[scheme];
  }
  function acceptsNotesFlag(body) {
    return isJsonObject(body) && body["notes"] === true;
  }

  // src/contract/site-addresses.ts
  var PAGES = {
    PORT: 1483,
    PORT_ENV: "LAHE_PAGES_PORT",
    SUFFIX: "lahe.localhost",
    PRINTED_ENDING: "lahe.localhost",
    PRINTED_ENDING_REASON: "every browser treats .localhost names as this computer and as secure, with no setup",
    PORT_FREE_OFF_REASON: "the port-80 forward is not set up",
    LAHE_NAMES_OFF_REASON: "the .lahe option is not set up",
    LIBRARY_NAME: "library",
    MAX_LABELS: 4,
    LABEL_MAX: 63,
    NAME_MAX: 150,
    RESERVED_NAMES: ["library", "lahe", "www", "api"],
    MODE_SITES: "sites",
    CORP: "same-origin"
  };
  var SITE_LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var SITE_HOST = /^([a-z0-9.-]+)\.lahe\.localhost(?::(\d{1,5}))?$/;
  var SHORT_HOST = /^([a-z0-9.-]+)\.lahe(?::(\d{1,5}))?$/;
  function isSiteLabel(value) {
    return typeof value === "string" && value.length > 0 && value.length <= PAGES.LABEL_MAX && SITE_LABEL.test(value);
  }
  function isSiteName(value) {
    if (typeof value !== "string" || value === "" || value.length > PAGES.NAME_MAX) return false;
    const labels = value.split(".");
    return labels.length <= PAGES.MAX_LABELS && labels.every((label) => isSiteLabel(label));
  }
  var HOST_FAMILY = { API: "api", LIBRARY: "library", PAGE: "page", BAD: "bad" };
  function readSiteAddress(address, laheNames) {
    const full = SITE_HOST.exec(address);
    const short = full === null && laheNames ? SHORT_HOST.exec(address) : null;
    const match = full ?? short;
    const name = match?.[1];
    if (name === void 0) return null;
    return { name, port: match?.[2], short: full === null };
  }
  function portMatches(port, pagesPort) {
    return port === void 0 || Number(port) === pagesPort;
  }
  function classifyHost(hostHeader, options) {
    if (typeof hostHeader !== "string" || hostHeader === "") return { family: HOST_FAMILY.BAD };
    if (hostAllowed(hostHeader)) return { family: HOST_FAMILY.API };
    const address = readSiteAddress(hostHeader, options?.laheNames === true);
    if (address === null || !portMatches(address.port, options?.pagesPort)) return { family: HOST_FAMILY.BAD };
    const name = address.name;
    if (name === PAGES.LIBRARY_NAME) {
      return address.short ? { family: HOST_FAMILY.BAD } : { family: HOST_FAMILY.LIBRARY, name: PAGES.LIBRARY_NAME };
    }
    return isSiteName(name) ? { family: HOST_FAMILY.PAGE, name } : { family: HOST_FAMILY.BAD };
  }
  function siteOrigin(name, port) {
    return "http://" + name + "." + PAGES.SUFFIX + (port === 80 ? "" : ":" + String(port));
  }
  function siteNameFromOrigin(origin, pagesPort, laheNames) {
    const scheme = "http://";
    if (typeof origin !== "string" || !origin.startsWith(scheme)) return null;
    const address = readSiteAddress(origin.slice(scheme.length), laheNames === true);
    if (address === null || address.name === PAGES.LIBRARY_NAME) return null;
    const name = address.name;
    return isSiteName(name) && portMatches(address.port, pagesPort) ? name : null;
  }

  // src/contract/headers.ts
  var HEADER = {
    CLIENT: "x-lahe-client",
    TOKEN: "x-lahe-token",
    REQUEST_ID: "x-lahe-request-id",
    CONTENT_TYPE: "content-type",
    ORIGIN: "origin",
    HOST: "host",
    SEC_FETCH_SITE: "sec-fetch-site",
    SEC_FETCH_MODE: "sec-fetch-mode",
    SEC_FETCH_DEST: "sec-fetch-dest",
    CLI_SECRET: "x-lahe-cli-secret",
    PROOF_TS: "x-lahe-proof-ts",
    PROOF_NONCE: "x-lahe-proof-nonce",
    PROOF: "x-lahe-proof",
    PROOF_REPLY: "x-lahe-proof-reply"
  };
  var CLIENT_LAYER = "layer";
  var CLIENT_CLI = "cli";
  var CLIENT_CATALOG = "catalog";
  var JSON_CONTENT_TYPE = "application/json";
  var PROOF = {
    REQUEST_PREFIX: "lahe-proof-v1",
    REPLY_PREFIX: "lahe-proof-reply-v1",
    WINDOW_MS: 3e4,
    TS_PATTERN: /^[0-9]{1,16}$/,
    NONCE_PATTERN: /^[0-9a-f]{32}$/,
    MAC_PATTERN: /^[0-9a-f]{64}$/
  };
  var SUMMARY_VERSION = 1;

  // src/contract/routes.ts
  var BASE = "/lahe/" + API_VERSION;
  var AUTH = {
    NONE: "none",
    REVIEW_TOKEN: "review_token",
    CATALOG_TOKEN: "catalog_token",
    CLI_SECRET: "cli_secret",
    CLI_PROOF: "cli_proof"
  };
  var ROUTES = [
    { name: "health", method: "GET", path: "/lahe/v1/health", auth: "none", mutating: false },
    { name: "events.append", method: "POST", path: "/lahe/v1/events", auth: "review_token", mutating: true },
    { name: "library.get", method: "GET", path: "/lahe-layer.js", auth: "none", mutating: false },
    { name: "review.write", method: "POST", path: "/lahe/v1/review", auth: "review_token", mutating: true },
    { name: "review.read", method: "GET", path: "/lahe/v1/review", auth: "review_token", mutating: false },
    { name: "records.read", method: "GET", path: "/lahe/v1/records", auth: "review_token", mutating: false },
    { name: "replies.poll", method: "GET", path: "/lahe/v1/replies", auth: "review_token", mutating: false },
    { name: "window.claim", method: "POST", path: "/lahe/v1/window", auth: "review_token", mutating: true },
    { name: "window.release", method: "POST", path: "/lahe/v1/window/release", auth: "review_token", mutating: true },
    { name: "review.end", method: "POST", path: "/lahe/v1/end", auth: "review_token", mutating: true }
  ];
  var CATALOG_PAGE_PATH = "/catalog";
  var CATALOG_ROUTES = [
    {
      name: "catalog.page",
      method: "GET",
      path: "/catalog",
      auth: "catalog_token",
      mutating: false,
      checks: { sec_fetch_site: ["none", "same-origin"], top_level_navigation: true, token: false, json_body: false, origin: null }
    },
    {
      name: "catalog.asset",
      method: "GET",
      path: "/catalog/assets/",
      prefix: true,
      auth: "catalog_token",
      mutating: false,
      checks: { sec_fetch_site: ["none", "same-origin"], token: false, json_body: false, origin: null }
    },
    {
      name: "catalog.list",
      method: "GET",
      path: "/lahe/v1/catalog/list",
      auth: "catalog_token",
      mutating: false,
      checks: { sec_fetch_site: ["same-origin"], token: true, json_body: false, origin: null }
    },
    {
      name: "catalog.open",
      method: "POST",
      path: "/lahe/v1/catalog/open",
      auth: "catalog_token",
      mutating: true,
      checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" }
    },
    {
      name: "catalog.star",
      method: "POST",
      path: "/lahe/v1/catalog/star",
      auth: "catalog_token",
      mutating: true,
      checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" }
    },
    {
      name: "catalog.rename",
      method: "POST",
      path: "/lahe/v1/catalog/rename",
      auth: "catalog_token",
      mutating: true,
      checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" }
    },
    {
      name: "catalog.request",
      method: "POST",
      path: "/lahe/v1/catalog/request",
      auth: "catalog_token",
      mutating: true,
      checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" }
    }
  ];
  var SITE_ROUTES = [
    { name: "site.bind", method: "POST", path: "/lahe/v1/site/bind", auth: "cli_secret", mutating: true },
    { name: "review.retire", method: "POST", path: "/lahe/v1/review/retire", auth: "cli_secret", mutating: true }
  ];
  var SUMMARY_ROUTES = [
    { name: "summary.read", method: "GET", path: "/lahe/v1/summary", auth: "cli_proof", mutating: false },
    { name: "summary.open", method: "POST", path: "/lahe/v1/summary/open", auth: "cli_proof", mutating: true, refuse_origin: true }
  ];
  var ALL_ROUTES = [...ROUTES, ...CATALOG_ROUTES, ...SITE_ROUTES, ...SUMMARY_ROUTES];
  function route(name) {
    const found = ALL_ROUTES.find((entry) => entry.name === name);
    if (found === void 0) throw new Error("unknown route: " + name + ". Routes are listed in src/contract/routes.ts");
    return found;
  }
  var CATALOG_TOKEN_META = "lahe-catalog-token";
  var HEALTH_FIELD = { CATALOG_SEEN_AT: "catalog_seen_at" };

  // src/contract/request-checks.ts
  var CHECK = {
    HOST: "host",
    CUSTOM_HEADER: "custom_header",
    CONTENT_TYPE: "content_type",
    REVIEW_KNOWN: "review_known",
    TOKEN: "token",
    ORIGIN: "origin",
    SEC_FETCH_SITE: "sec_fetch_site",
    SEC_FETCH: "sec_fetch",
    PROOF: "proof"
  };
  var CHECKS = [
    { name: "host", code: "PROTO_BAD_HOST" },
    { name: "custom_header", code: "PROTO_MISSING_CUSTOM_HEADER" },
    { name: "content_type", code: "PROTO_UNSUPPORTED_MEDIA_TYPE" },
    { name: "review_known", code: "PROTO_UNKNOWN_REVIEW" },
    { name: "token", code: "PROTO_UNAUTHORIZED" },
    { name: "origin", code: "PROTO_FORBIDDEN_ORIGIN" },
    { name: "sec_fetch_site", code: "PROTO_CROSS_SITE" },
    { name: "sec_fetch", code: "AUTH_REFUSED" },
    { name: "proof", code: "AUTH_REFUSED" }
  ];
  var REVIEW_CLIENTS = [CLIENT_LAYER, CLIENT_CLI];
  function headerValue(headers, name) {
    if (Object.hasOwn(headers, name)) return headers[name];
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) return headers[key];
    }
    return void 0;
  }
  function textOf(value) {
    if (value === void 0) return null;
    return typeof value === "string" ? value : value.join(",");
  }
  function reviewRoute(name) {
    const found = ROUTES.find((entry) => entry.name === name);
    if (found === void 0) throw new Error("unknown route: " + name + ". Review routes are listed in src/contract/routes.ts");
    return found;
  }
  function registeredReview(config, review) {
    const reviews = config === null ? null : Reflect.get(config, "reviews");
    if (!isJsonObject(reviews) || !isSafeId(review) || !Object.hasOwn(reviews, review)) return null;
    const entry = reviews[review];
    if (!isJsonObject(entry)) return null;
    const token = entry["token"];
    const origins = entry["origins"];
    return { id: review, token: typeof token === "string" ? token : "", origins: Array.isArray(origins) ? origins : [] };
  }
  function tokensEqual(presented, registered) {
    const longest = Math.max(presented.length, registered.length);
    let difference = presented.length === registered.length ? 0 : 1;
    for (let index = 0; index < longest; index += 1) {
      difference |= (presented.charCodeAt(index) || 0) ^ (registered.charCodeAt(index) || 0);
    }
    return difference === 0;
  }
  function refusal(routeName, name, detail) {
    const entry = CHECKS.find((candidate) => candidate.name === name);
    if (entry === void 0) throw new Error("unknown check: " + name);
    const log = "refused " + routeName + ": check " + name + " failed" + (detail === null || detail === "" ? "" : " (" + detail + ")");
    return { ok: false, check: name, code: entry.code, log };
  }
  function checkRequest(request, config) {
    const route2 = reviewRoute(request.routeName);
    const headers = request.headers;
    const refuse = (name, detail) => refusal(route2.name, name, detail);
    const host = headerValue(headers, HEADER.HOST);
    if (!hostAllowed(host)) return refuse(CHECK.HOST, textOf(host) ?? "null");
    const origin = textOf(headerValue(headers, HEADER.ORIGIN));
    if (route2.auth === "none") return { ok: true, review: null, origin: origin === "" ? null : origin };
    const client = headerValue(headers, HEADER.CLIENT);
    if (typeof client !== "string" || !REVIEW_CLIENTS.some((allowed) => allowed === client)) return refuse(CHECK.CUSTOM_HEADER, null);
    if (route2.mutating) {
      const [mediaType = ""] = (textOf(headerValue(headers, HEADER.CONTENT_TYPE)) ?? "").split(";");
      const type = mediaType.trim().toLowerCase();
      if (type !== JSON_CONTENT_TYPE) return refuse(CHECK.CONTENT_TYPE, type === "" ? "none" : type);
    }
    const registered = registeredReview(config, request.review);
    if (registered === null) return refuse(CHECK.REVIEW_KNOWN, String(request.review));
    const presented = headerValue(headers, HEADER.TOKEN);
    if (registered.token === "" || typeof presented !== "string" || !tokensEqual(presented, registered.token)) {
      return refuse(CHECK.TOKEN, null);
    }
    const effective = origin === null || origin === "" ? "null" : origin;
    if (!registered.origins.some((allowed) => allowed === effective)) return refuse(CHECK.ORIGIN, effective);
    return { ok: true, review: registered.id, origin: effective };
  }

  // src/contract/failures.ts
  var SEVERITY = { BLOCKING: "blocking", WARNING: "warning", INFO: "info" };
  var SURFACE = { FAILURES_LIST: "failures_list", CARD: "card", CLI: "cli" };
  var ALIASES = {
    SYNC_SERVICE_DOWN: "HELPER_UNREACHABLE",
    CLI_NO_SERVICE: "HELPER_UNREACHABLE",
    SYNC_POLICY_REFUSED: "CSP_REFUSED",
    SECOND_TAB_REFUSED: "SECOND_WINDOW_REFUSED",
    ANCHOR_SUBJECT_GONE: "ANCHOR_LOST",
    ANCHOR_NOT_FOUND: "ANCHOR_LOST"
  };
  var NO_OFFER = { kind: "none" };
  var COPY_OFFER = { kind: "copy" };
  var TAKEOVER_OFFER = { kind: "action", label: "Review here", action: "takeover" };
  function row(severity, persistent, surface, message, remedy, options = {}) {
    return {
      severity,
      persistent,
      surface,
      message,
      remedy,
      standing: options.standing === true,
      offer: options.offer ?? NO_OFFER
    };
  }
  var CODES = {
    HELPER_UNREACHABLE: row(
      SEVERITY.WARNING,
      true,
      SURFACE.FAILURES_LIST,
      "The local helper is not reachable. Your feedback is safe in this browser and goes to the helper when it comes back.",
      "Start the helper, or use Copy or Export to get everything out now.",
      { standing: true }
    ),
    CSP_REFUSED: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "This page's content security policy refused the connection to the local helper. This is not the helper being down.",
      "Add the helper's origin to connect-src in this app's development CSP.",
      { offer: COPY_OFFER }
    ),
    SYNC_UNAUTHORIZED: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "The local helper refused this page's token.",
      "Run the add step again for this review, then reload the page.",
      { offer: COPY_OFFER }
    ),
    SYNC_ORIGIN_NOT_ALLOWED: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "This page's address is not registered for this review. The helper is fine; it refuses addresses it does not know.",
      "Have your agent re-run the add step with this page's address, then reload.",
      { offer: COPY_OFFER }
    ),
    STORAGE_QUOTA: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "Browser storage is full, so the last change could not be saved locally.",
      "Export what you have, then clear storage for this origin."
    ),
    SECOND_WINDOW_REFUSED: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "Another window is already reviewing this page. This one is read-only so the two cannot overwrite each other.",
      "Use Review here instead to move the review to this window.",
      { standing: true, offer: TAKEOVER_OFFER }
    ),
    ANCHOR_NO_TEXT_MATCH: row(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "This feedback could not be safely matched to this version of the page. Nothing was moved or changed, and your feedback is kept.",
      null
    ),
    ANCHOR_AMBIGUOUS: row(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "More than one place on this page matches this feedback, so nothing was moved or changed. Your feedback is kept.",
      null
    ),
    ANCHOR_STRUCTURE_ONLY: row(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "A structurally similar place is still present, but its text does not match this feedback. Nothing was moved or changed, and your feedback is kept.",
      null
    ),
    ANCHOR_LOST: row(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "This feedback could not be safely matched to this version of the page. Nothing was moved or changed, and your feedback is kept.",
      null
    ),
    REPLAY_NEITHER_MATCHES: row(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "This region is neither what you edited nor what you changed it to, so nothing was written. Your text is kept.",
      "Look at the region and reapply your change if it still makes sense."
    ),
    RUN_BLOCK_REFUSED: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "A new block in this edit is not a paragraph, heading or list the tool can store, or holds markup outside bold and italic.",
      null
    ),
    RUN_OVER_CEILING: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This edit is larger than the helper stores in one record.",
      null
    ),
    RUN_PLACEMENT_REFUSED: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This edit's placement is not after_anchor or start_of_container.",
      null
    ),
    RUN_TAKEBACK_CARRIES_RUN: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "A take-back names blocks to remove and never carries new blocks.",
      null
    ),
    REPLAY_RUN_WRONG_TAG: row(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "The agent placed '{first words}' as a {type}. You wrote a {type}, so Lahe sent it back.",
      null
    ),
    REPLAY_RUN_PLACED_ELSEWHERE: row(
      SEVERITY.INFO,
      true,
      SURFACE.CARD,
      "'{first words}' is already further down the page, so Lahe did not add it again.",
      null
    ),
    HELPER_CONTRACT_OLDER: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "The local helper is an older version than this page, so nothing you write here is sent to it. Your work is safe in this browser.",
      "Ask your agent to restart the helper (lahe session list restarts an old one), then reload this page."
    ),
    RUN_EVENT_REFUSED: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.CARD,
      "The helper refused this edit, so the agent has not seen it. Your words are still on this page.",
      null
    ),
    SUGGESTION_NOT_FOUND: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "A proofreading suggestion's from text is not in its block exactly once, so it cannot be applied.",
      null
    ),
    CHOICE_REFUSED: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "A choice record names its group and answer with short ids and carries nothing else, so this one was not stored.",
      null
    ),
    CHOICE_GROUP_INERT: row(
      SEVERITY.WARNING,
      true,
      SURFACE.FAILURES_LIST,
      "Some choices on this page cannot be pressed, so they show as plain text.",
      "Ask your agent to fix them. Each one and the reason:",
      { standing: true, offer: COPY_OFFER }
    ),
    CHOICE_GROUP_GONE: row(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "This choice is no longer on the page. Your answer is kept and is still with the agent.",
      null
    ),
    CHOICE_GROUP_TWICE: row(
      SEVERITY.WARNING,
      true,
      SURFACE.CARD,
      "Two choices on this page now share this one's name, so Lahe marked neither. Your answer is kept.",
      null
    ),
    REPLY_LINE_MALFORMED: row(
      SEVERITY.WARNING,
      true,
      SURFACE.FAILURES_LIST,
      "An agent wrote a reply line this tool could not read, so that line was skipped. Everything else was folded in.",
      "The chip names the file and the line number; the agent that wrote it can fix and append again.",
      { offer: COPY_OFFER }
    ),
    PROTO_BAD_REQUEST: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "The request was malformed.",
      null
    ),
    PROTO_BAD_HOST: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "The Host header does not name the helper, so the request was refused.",
      null
    ),
    PROTO_UNAUTHORIZED: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Missing or invalid per-review token.",
      null
    ),
    PROTO_FORBIDDEN_ORIGIN: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This origin is not registered for this review.",
      null
    ),
    PROTO_UNKNOWN_REVIEW: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "No such review.",
      null
    ),
    PROTO_UNSUPPORTED_MEDIA_TYPE: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Mutating routes require a JSON content type.",
      null
    ),
    PROTO_MISSING_CUSTOM_HEADER: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Every route but health requires the client header, so a simple cross-origin request cannot reach a handler.",
      null
    ),
    PROTO_STALE_REV: row(
      SEVERITY.WARNING,
      false,
      SURFACE.CLI,
      "This reply names a revision that has since been superseded. The newer revision stays outstanding.",
      null
    ),
    PROTO_UNKNOWN_ITEM: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "No such item in this review.",
      null
    ),
    PROTO_REVIEW_RETIRED: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This review was retired, so it takes no more comments.",
      "Reload the page: it now answers with the file's current review, if it has one."
    ),
    PROTO_NOT_OWNER: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This review belongs to another agent session, so this session cannot retire it.",
      "Ask your human. A handoff is lahe session takeover, which they ask for."
    ),
    PROTO_SECOND_WINDOW: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Another window already holds this review.",
      "Take over from the window you are in."
    ),
    PROTO_SECOND_INSTANCE: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "Another helper is already running for this data directory.",
      "Use the running one, or stop it first."
    ),
    PROTO_CROSS_SITE: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This request did not come from the Library page itself, so it was refused.",
      "Use the Library page at the helper's own address, /catalog."
    ),
    PROTO_NOT_OPENABLE: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "This document cannot be opened from the Library: its files are missing, or it has no recorded server.",
      "Ask your agent to serve it again with lahe review."
    ),
    PROTO_REQUEST_PENDING: row(
      SEVERITY.INFO,
      false,
      SURFACE.CLI,
      "This document already has a request waiting for an agent.",
      "Wait for the agent to answer. Its answer shows on the row."
    ),
    PROTO_QUEUE_FULL: row(
      SEVERITY.WARNING,
      false,
      SURFACE.CLI,
      "Too many requests are already waiting for an agent.",
      "Wait for the agent to answer some of them, then try again."
    ),
    PROTO_NO_AGENT: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "No agent is attached to the Library, or the attached agent has stopped watching.",
      "Ask an agent to run lahe library with its own session, or copy the hand-off message into a new agent."
    ),
    PROTO_CONFIRM_NEEDED: row(
      SEVERITY.INFO,
      false,
      SURFACE.CLI,
      "Another agent is watching this document's session, so moving it needs your say-so.",
      "Choose Move the session to confirm, or open it just to read."
    ),
    PROTO_NO_LAUNCH: row(
      SEVERITY.INFO,
      false,
      SURFACE.CLI,
      "A new agent can only be launched on a document with a session to take over and a file to serve. This one is from before sessions, or its worktree is gone and no main-repo copy passes the checks.",
      "Choose Pick this up instead. The attached agent serves it in its own session."
    ),
    PROTO_CATALOG_UNREADABLE: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "The Library's saved stars file cannot be read, so stars cannot change. Lahe leaves the file as it is.",
      "Fix or move aside catalog.json in the Lahe state folder, then try again."
    ),
    CLI_PATH_REFUSED: row(
      SEVERITY.BLOCKING,
      false,
      SURFACE.CLI,
      "A write was refused because the destination resolved outside the review folder or is a symlink.",
      null
    ),
    COPY_FAILED: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "The review was not copied to the clipboard, so there is nothing to paste.",
      "Use Export to save it as a file instead."
    ),
    EXPORT_FAILED: row(
      SEVERITY.BLOCKING,
      true,
      SURFACE.FAILURES_LIST,
      "The review could not be saved as a file.",
      "Use Copy to put it on the clipboard instead."
    )
  };
  function isAlias(name) {
    return Object.hasOwn(ALIASES, name);
  }
  function unknownName(name) {
    return new Error("unknown failure code: " + String(name) + ". Add it to src/contract/failures.ts");
  }
  function canonical(name) {
    return isAlias(name) ? ALIASES[name] : name;
  }
  function describe(name) {
    const code = canonical(name);
    if (!Object.hasOwn(CODES, code)) throw unknownName(name);
    return CODES[code];
  }
  function failure(name, detail) {
    const definition = describe(name);
    return {
      code: name,
      canonical_code: canonical(name),
      severity: definition.severity,
      persistent: definition.persistent,
      standing: definition.standing,
      surface: definition.surface,
      message: definition.message,
      remedy: definition.remedy,
      detail: detail ?? null,
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }

  // src/contract/error-body.ts
  var STATUS = {
    PROTO_BAD_REQUEST: 400,
    PROTO_BAD_HOST: 400,
    PROTO_MISSING_CUSTOM_HEADER: 400,
    PROTO_UNSUPPORTED_MEDIA_TYPE: 415,
    PROTO_UNAUTHORIZED: 401,
    PROTO_FORBIDDEN_ORIGIN: 403,
    PROTO_UNKNOWN_REVIEW: 404,
    PROTO_UNKNOWN_ITEM: 404,
    PROTO_STALE_REV: 409,
    PROTO_REVIEW_RETIRED: 410,
    PROTO_NOT_OWNER: 403,
    PROTO_SECOND_WINDOW: 409,
    PROTO_SECOND_INSTANCE: 409,
    PROTO_CROSS_SITE: 403,
    PROTO_NOT_OPENABLE: 409,
    PROTO_REQUEST_PENDING: 409,
    PROTO_QUEUE_FULL: 429,
    PROTO_NO_AGENT: 409,
    PROTO_CONFIRM_NEEDED: 409,
    PROTO_NO_LAUNCH: 409,
    PROTO_CATALOG_UNREADABLE: 500,
    AUTH_REFUSED: 401,
    SUMMARY_VERSION: 409
  };
  function hasStatus(code) {
    return Object.hasOwn(STATUS, code);
  }
  function statusFor(code) {
    return hasStatus(code) ? STATUS[code] : 500;
  }
  function errorBody(code, detail, requestId, check) {
    const failed = failure(code, detail);
    return {
      error: {
        code: failed.code,
        message: failed.message,
        remedy: failed.remedy,
        detail: failed.detail,
        check: check ?? null,
        request_id: requestId === void 0 || requestId === "" ? null : requestId
      }
    };
  }

  // src/contract/events.ts
  var EVENT = {
    REVIEW_CREATED: "review.created",
    ORIGIN_REGISTERED: "origin.registered",
    ORIGIN_REMOVED: "origin.removed",
    PAGE_VISITED: "page.visited",
    ITEM_CREATED: "item.created",
    ITEM_CONTENT: "item.content",
    ITEM_READY: "item.ready",
    ITEM_DELETED: "item.deleted",
    ITEM_REOPENED: "item.reopened",
    ITEM_CLOSED: "item.closed",
    REPLY_SEEN: "reply.seen",
    REPLY_FOLDED: "reply.folded",
    REPLY_REJECTED: "reply.rejected",
    REVIEW_ARCHIVED: "review.archived",
    REVIEW_ADOPTED: "review.adopted"
  };
  var EVENT_TYPES = Object.values(EVENT);
  var EVENT_FIELD = {
    EVENT: "event",
    EVENT_ID: "event_id",
    TS: "ts",
    SEQ: "seq",
    REVIEW: "review",
    ITEM: "item",
    REV: "rev",
    PAGE_PATH: "page_path",
    PAGE_TITLE: "page_title",
    PAGE_SEQ: "page_seq",
    SOURCE_HINT: "source_hint",
    RECEIVED_AT: "received_at"
  };
  var IDEMPOTENCE_KEY = EVENT_FIELD.EVENT_ID;
  function isEventType(value) {
    return typeof value === "string" && EVENT_TYPES.some((type) => type === value);
  }
  function numberOrNull(value) {
    return typeof value === "number" ? value : null;
  }
  function textOrNull(value) {
    return typeof value === "string" && value !== "" ? value : null;
  }
  function newEvent(input) {
    const type = input.event;
    if (!isEventType(type)) {
      throw new Error("newEvent: event must be one of " + EVENT_TYPES.join(", ") + ", got " + String(type));
    }
    const eventId = input.event_id;
    if (typeof eventId !== "string" || eventId === "") {
      throw new Error("newEvent: event_id is required and is client-minted; idempotence is by event_id");
    }
    const review = input.review;
    if (!isSafeId(review)) throw new Error("newEvent: review must be a safe id, got " + String(review));
    const event = {
      event: type,
      event_id: eventId,
      ts: typeof input.ts === "string" && input.ts !== "" ? input.ts : (/* @__PURE__ */ new Date()).toISOString(),
      seq: numberOrNull(input.seq),
      review,
      item: textOrNull(input.item),
      rev: numberOrNull(input.rev),
      page_path: textOrNull(input.page_path),
      page_title: textOrNull(input.page_title),
      page_seq: numberOrNull(input.page_seq),
      source_hint: textOrNull(input.source_hint)
    };
    const payload = input.payload;
    if (isJsonObject(payload)) {
      for (const [key, value] of Object.entries(payload)) {
        if (!Object.hasOwn(event, key)) Object.defineProperty(event, key, { value, enumerable: true, writable: true, configurable: true });
      }
    }
    return event;
  }
  function encodeEventLine(event) {
    return JSON.stringify(event) + "\n";
  }
  function parseEventLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      return { ok: false, reason: "not JSON: " + (error instanceof Error ? error.message : String(error)) };
    }
    if (!isJsonObject(parsed)) return { ok: false, reason: "not an object" };
    const type = parsed[EVENT_FIELD.EVENT];
    if (!isEventType(type)) return { ok: false, reason: "unknown event type " + String(type) };
    const eventId = parsed[EVENT_FIELD.EVENT_ID];
    if (typeof eventId !== "string" || eventId === "") {
      return { ok: false, reason: "missing event_id, which is the idempotence key" };
    }
    return { ok: true, event: { ...parsed, event: type, event_id: eventId } };
  }

  // src/contract/flush.ts
  var FLUSH = {
    HELPER_DEBOUNCE_MS: 750,
    DRAFT_FLOOR_MS: 1e4,
    RUN_DRAFT_FLOOR_MS: 3e4,
    PRESS_QUIET_MS: 3e3,
    PRESS_CAP_MS: 1e4,
    IMMEDIATE_ON: ["blur", "hide", "ready", "navigation", "unload"],
    KEEPALIVE_MAX_BYTES: 65536
  };
  function jsonOf(value) {
    return JSON.stringify(value);
  }
  function utf8Length(text) {
    let bytes = 0;
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    }
    return bytes;
  }
  function fitsKeepalive(body) {
    const text = typeof body === "string" ? body : jsonOf(body) ?? "";
    return utf8Length(text) <= FLUSH.KEEPALIVE_MAX_BYTES;
  }

  // src/contract/replies.ts
  var REPLY_FIELD = {
    ITEM: "item",
    REV: "rev",
    STATUS: "status",
    AGENT: "agent",
    REASON: "reason",
    TEXT: "text",
    FILES: "files",
    NEEDS_SEE: "user_needs_to_see_reply",
    PROOFREAD: "proofread",
    SUGGESTIONS: "suggestions"
  };
  var REPLY_STATUS = { HANDLED: "handled", NOT_HANDLED: "not_handled", QUESTION: "question" };
  var REPLY_STATUSES = Object.values(REPLY_STATUS);
  var SUGGESTIONS_MAX = 400;
  var SUGGESTION_TEXT_MAX = 2e5;
  var REQUIRED = {
    handled: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS],
    not_handled: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS, REPLY_FIELD.REASON],
    question: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS, REPLY_FIELD.TEXT]
  };
  function malformed(reason) {
    return { ok: false, code: "REPLY_LINE_MALFORMED", reason };
  }
  function isReplyStatus(value) {
    return typeof value === "string" && REPLY_STATUSES.some((status) => status === value);
  }
  function nonBlankText(value) {
    return typeof value === "string" && value.trim() !== "" ? value : null;
  }
  function parseSuggestions(list) {
    if (!Array.isArray(list)) return { ok: false, reason: "suggestions must be a list" };
    if (list.length > SUGGESTIONS_MAX) {
      return { ok: false, reason: "suggestions holds " + String(list.length) + " fixes, more than " + String(SUGGESTIONS_MAX) };
    }
    const suggestions = [];
    for (const [index, entry] of list.entries()) {
      const candidate = entry;
      const label = "suggestion " + String(index);
      if (!isJsonObject(candidate)) return { ok: false, reason: label + " must be an object" };
      const { block, from, to } = candidate;
      if (typeof block !== "number" || !Number.isInteger(block) || block < 0) {
        return { ok: false, reason: label + " block must be a whole number from 0" };
      }
      if (typeof from !== "string" || from === "") return { ok: false, reason: label + " from must be a non-empty string" };
      if (typeof to !== "string") return { ok: false, reason: label + " to must be a string" };
      if (from.length > SUGGESTION_TEXT_MAX || to.length > SUGGESTION_TEXT_MAX) {
        return { ok: false, reason: label + " from or to is over " + String(SUGGESTION_TEXT_MAX) + " characters" };
      }
      suggestions.push({ block, from, to });
    }
    return { ok: true, suggestions };
  }
  function parseReplyLine(line, options) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      return malformed("not JSON: " + (error instanceof Error ? error.message : String(error)));
    }
    if (!isJsonObject(parsed)) return malformed("a reply line must be a JSON object");
    const status = parsed[REPLY_FIELD.STATUS];
    if (!isReplyStatus(status)) {
      return malformed("status must be one of " + REPLY_STATUSES.join(", ") + ", got " + JSON.stringify(status));
    }
    const item = nonBlankText(parsed[REPLY_FIELD.ITEM]);
    const givenRev = parsed[REPLY_FIELD.REV];
    const rev = typeof givenRev === "number" ? givenRev : null;
    const givenReason = parsed[REPLY_FIELD.REASON];
    const givenText = parsed[REPLY_FIELD.TEXT];
    const reason = nonBlankText(givenReason);
    const text = nonBlankText(givenText);
    const found = { item, rev, status, reason, text };
    const missing = REQUIRED[status].filter((field) => found[field] === null);
    const incomplete = () => malformed("status " + status + " needs " + REQUIRED[status].join(", ") + "; missing or wrong type: " + missing.join(", "));
    if (missing.length > 0 || item === null || rev === null) return incomplete();
    const marksProofread = parsed[REPLY_FIELD.PROOFREAD] !== void 0 || parsed[REPLY_FIELD.SUGGESTIONS] !== void 0;
    let proofread = null;
    if (marksProofread) {
      if (status !== REPLY_STATUS.QUESTION) return malformed("proofread and suggestions belong on a question reply only");
      if (parsed[REPLY_FIELD.PROOFREAD] !== true) return malformed("proofread must be true when suggestions are given");
      const given = parsed[REPLY_FIELD.SUGGESTIONS];
      const checked = parseSuggestions(given === void 0 ? [] : given);
      if (!checked.ok) return malformed(checked.reason);
      proofread = checked.suggestions;
    }
    const lineAgent = parsed[REPLY_FIELD.AGENT];
    const filenameAgent = options?.filenameAgent;
    const agent = typeof lineAgent === "string" && lineAgent !== "" ? lineAgent : filenameAgent === void 0 || filenameAgent === "" ? null : filenameAgent;
    const files = parsed[REPLY_FIELD.FILES];
    const common = {
      item,
      rev,
      status,
      agent,
      reason: typeof givenReason === "string" ? givenReason : null,
      text: typeof givenText === "string" ? givenText : null,
      files: Array.isArray(files) ? files.slice() : [],
      user_needs_to_see_reply: parsed[REPLY_FIELD.NEEDS_SEE] === true
    };
    switch (status) {
      case "handled":
        return { ok: true, reply: { ...common, status: "handled" }, reason: null };
      case "not_handled":
        return reason === null ? incomplete() : { ok: true, reply: { ...common, status: "not_handled", reason }, reason: null };
      case "question":
        if (text === null) return incomplete();
        return {
          ok: true,
          reply: proofread === null ? { ...common, status: "question", text } : { ...common, status: "question", text, proofread: true, suggestions: proofread },
          reason: null
        };
    }
  }
  var REPLY_FILE = {
    SINGLE: "replies.jsonl",
    PATTERN: new RegExp("^replies(?:-(" + SAFE_ID.source.slice(1, -1) + "))?\\.jsonl$"),
    prefix: "replies-",
    suffix: ".jsonl"
  };
  function agentFromFilename(filename) {
    const match = typeof filename === "string" ? REPLY_FILE.PATTERN.exec(filename) : null;
    if (match === null) {
      return { ok: false, agent: null, reason: "reply file name is not replies.jsonl or replies-<agent>.jsonl" };
    }
    const agent = match[1];
    return { ok: true, agent: isSafeId(agent) ? agent : null, reason: null };
  }
  var REPLY_POLL = { INTERVAL_MS: 5e3 };
  var REPLY_CURSOR_FIELD = "seq";
  function nextReadOffset(recordedOffset, fileSize) {
    const size = fileSize;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) throw new Error("nextReadOffset: fileSize must be a number");
    const offset = typeof recordedOffset === "number" && recordedOffset > 0 ? recordedOffset : 0;
    return size < offset ? { offset: 0, refold: true } : { offset, refold: false };
  }
  function splitCompleteLines(chunk) {
    const lines = chunk.split("\n");
    const remainder = lines.pop() ?? "";
    return { lines, remainder };
  }

  // src/contract/script-tag.ts
  var SCRIPT_ATTR = {
    REVIEW: "data-lahe-review",
    TOKEN: "data-lahe-token",
    HELPER: "data-lahe-helper",
    FALLBACK: "data-lahe-fallback",
    FRAMES: "data-lahe-frames",
    START: "data-lahe-start",
    NOTES: "data-lahe-notes",
    DOCUMENT: "data-lahe-document",
    ALIASES: "data-lahe-aliases",
    PATH_ALIASES: "data-lahe-path-aliases",
    SPELLINGS: "data-lahe-spellings"
  };
  var ALIAS_MAX = 16;
  var FRAMES_ALLOW = "allow";
  var START_HIDDEN = "hidden";
  var NOTES_ON = "true";
  var DOCUMENT_ON = "true";
  var SCRIPT_SELECTOR = "script[" + SCRIPT_ATTR.REVIEW + "]";
  var SCRIPT_FALLBACK_ONERROR = "var s=document.createElement('script');s.src=this.getAttribute('" + SCRIPT_ATTR.FALLBACK + "');document.head.appendChild(s)";
  var LOOPBACK_PORT_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/;
  var PATH_ALIAS = /^\/[^"'<>\s\\]{0,511}$/;
  var SPELLING_ORIGIN = /^http:\/\/[a-z0-9.-]{1,253}(?::\d{1,5})?$/;
  function isLoopbackPortOrigin(value) {
    return typeof value === "string" && LOOPBACK_PORT_ORIGIN.test(value);
  }
  function isPathAlias(value) {
    return typeof value === "string" && PATH_ALIAS.test(value);
  }
  function isSpellingOrigin(value) {
    return typeof value === "string" && SPELLING_ORIGIN.test(value);
  }
  function isSpelling(value) {
    if (typeof value !== "string") return false;
    const space = value.indexOf(" ");
    return space > 0 && isSpellingOrigin(value.slice(0, space)) && isPathAlias(value.slice(space + 1));
  }
  var ALIASES_RULE = {
    option: "aliases",
    plural: "aliases",
    accepts: isLoopbackPortOrigin,
    refusal: "an alias must be a loopback http origin, not "
  };
  var PATH_ALIASES_RULE = {
    option: "pathAliases",
    plural: "path aliases",
    accepts: isPathAlias,
    refusal: "a path alias must be an absolute path, not "
  };
  var SPELLINGS_RULE = {
    option: "spellings",
    plural: "spellings",
    accepts: isSpelling,
    refusal: 'a spelling is "origin path", not '
  };
  function listValue(list, rule) {
    if (!Array.isArray(list)) throw new Error("scriptTag: " + rule.option + " must be a list");
    if (list.length > ALIAS_MAX) throw new Error("scriptTag: at most " + String(ALIAS_MAX) + " " + rule.plural);
    for (const entry of list) {
      const member = entry;
      if (!rule.accepts(member)) throw new Error("scriptTag: " + rule.refusal + JSON.stringify(member));
    }
    return JSON.stringify(list).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function attributeLine(name, value) {
    return "        " + name + '="' + value + '"\n';
  }
  function scriptTag(options) {
    const src = options.src;
    if (typeof src !== "string" || src === "") throw new Error("scriptTag: src is required (the path to the built library)");
    const review = options.review;
    if (!isSafeId(review)) throw new Error("scriptTag: review must be a safe id");
    const token = options.token;
    if (typeof token !== "string" || token === "") throw new Error("scriptTag: token is required; absent configuration fails closed");
    const fallback = options.fallback === void 0 || options.fallback === "" ? "" : attributeLine(SCRIPT_ATTR.FALLBACK, options.fallback) + attributeLine("onerror", SCRIPT_FALLBACK_ONERROR);
    const optIns = (options.notes === true ? attributeLine(SCRIPT_ATTR.NOTES, NOTES_ON) : "") + (options.document === true ? attributeLine(SCRIPT_ATTR.DOCUMENT, DOCUMENT_ON) : "");
    const lists = (options.aliases === void 0 ? "" : attributeLine(SCRIPT_ATTR.ALIASES, listValue(options.aliases, ALIASES_RULE))) + (options.pathAliases === void 0 ? "" : attributeLine(SCRIPT_ATTR.PATH_ALIASES, listValue(options.pathAliases, PATH_ALIASES_RULE))) + (options.spellings === void 0 ? "" : attributeLine(SCRIPT_ATTR.SPELLINGS, listValue(options.spellings, SPELLINGS_RULE)));
    return '<script src="' + src + '"\n' + attributeLine(SCRIPT_ATTR.REVIEW, review) + attributeLine(SCRIPT_ATTR.TOKEN, token) + attributeLine(SCRIPT_ATTR.HELPER, options.helper === void 0 || options.helper === "" ? DEFAULT_HELPER_ORIGIN : options.helper) + fallback + optIns + lists + "        defer><\/script>";
  }

  // src/contract/agent-commands.ts
  var CLI_EXIT = {
    OK: 0,
    HELPER_UNREACHABLE: 2,
    UNKNOWN_REVIEW: 3,
    BAD_USAGE: 4,
    SESSION_CLOSED: 5,
    SESSION_TAKEN_OVER: 6
  };
  var WAKE = {
    FILE: "wake.log",
    KIND: {
      WORK: "work",
      TAKEOVER: "takeover",
      CLOSED: "closed",
      ENDED: "ended"
    },
    FIELD: {
      AT: "at",
      KIND: "kind",
      REVIEW: "review",
      ITEM: "item",
      REV: "rev",
      DRAIN: "drain"
    }
  };
  var SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
  function shellWord(value) {
    return SHELL_SAFE.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
  }
  function stateDirFlag(stateDir) {
    const dir = stateDir;
    return typeof dir !== "string" || dir === "" ? "" : " --state-dir " + shellWord(dir);
  }
  function drainCommand(sessionId, stateDir) {
    return "lahe status --session " + sessionId + " --json --quiet" + stateDirFlag(stateDir);
  }
  function monitorCommand(sessions, stateDir, handoffRevisions) {
    const ids = typeof sessions === "string" ? [sessions] : sessions;
    const watched = ids.map((id) => {
      const revision = handoffRevisions?.[id];
      return " --session " + id + (revision !== void 0 && Number.isInteger(revision) ? " --handoff-rev " + String(revision) : "");
    });
    return "lahe monitor" + watched.join("") + stateDirFlag(stateDir);
  }
  function takeoverCommand(sessionId, stateDir, requestId) {
    return "lahe session takeover " + sessionId + stateDirFlag(stateDir) + (isSafeId(requestId) ? " --request " + requestId : "");
  }

  // src/contract/agent-liveness.ts
  var INTERVAL_SECONDS = 15;
  var FRESH_INTERVALS = 3;
  var MONITOR = {
    HEARTBEAT_FILE: "monitor.json",
    ACTIVITY_FILE: "activity.json",
    DELIVERED_FILE: "delivered.json",
    INTERVAL_SECONDS,
    FRESH_INTERVALS,
    HEARTBEAT_FIELD: { PID: "pid", HANDOFF_REV: "handoff_rev", AT: "at", PRIMARY: "primary" },
    ACTIVITY_FIELD: { AT: "at" },
    HEARTBEAT_FRESH_MS: INTERVAL_SECONDS * FRESH_INTERVALS * 1e3
  };
  var AGENT_LIVENESS = {
    STATE: {
      WORKING: "working",
      WAITING: "waiting",
      NO_AGENT: "no_agent",
      NONE: "none"
    },
    FIELD: {
      STATE: "state",
      UNANSWERED: "unanswered",
      OLDEST_UNANSWERED_AT: "oldest_unanswered_at",
      LAST_REPLY_AT: "last_reply_at",
      LISTENING: "listening",
      MONITOR_AT: "monitor_at",
      ACTIVITY_AT: "activity_at",
      SESSION_ID: "session_id",
      STATE_DIR_FLAG: "state_dir_flag_needed",
      OLDEST_ITEM: "oldest_unanswered_item",
      NAME: "session_name",
      NAME_FROM_PAGE: "session_name_from_page",
      PRESENCE: "presence"
    },
    PRESENCE: { LISTENING: "listening", WORKING: "working", AWAY: "away" },
    TEXT: {
      working: "agent is working, {age}",
      waiting: "nothing back yet, {age}",
      no_agent: "nobody has picked this up, {age}"
    },
    CONNECTION: {
      connected: "agent listening",
      absent: "no agent listening"
    },
    DETAIL: {
      helper_up: "The helper is answering this page, so comments and edits reach it as you make them.",
      helper_down: "The helper is not answering right now, so your work is being kept in this browser until it is.",
      agent_connected: "An agent has this review open.",
      agent_absent: "No agent has this review open.",
      agent_unknown: "Whether an agent has this review open cannot be checked on this computer.",
      agent_named: "The agent on this review is named {name}.",
      replied: "The agent last replied {reply} ago.",
      never_replied: "The agent has not replied on this review yet.",
      waiting: "Your oldest unanswered item has been waiting {age}.",
      stored: "Your comments and edits are stored in this browser and in the helper's log on disk.",
      save: "You can get your own copy any time: use Copy review or Export review to file in the menu."
    },
    PROMINENT: {
      BANNER: {
        no_agent: "Nobody has picked up your comments in {age}.",
        waiting: "Nothing has come back on your comments in {age}."
      },
      CHECK: "Check your agent's window first. It may have stopped, or it may be waiting on you.",
      CHECK_NAMED: "Check the agent named {name} first. It may have stopped, or it may be waiting on you.",
      HANDOFF_BUTTON: "Copy a message for a new agent",
      COPIED: "Copied. Paste it into a new agent and it will pick up your comments.",
      COPY_FAILED: "Could not copy. Select the message below and copy it yourself.",
      CARD: "waiting {age}",
      TOAST_LABEL: "Comments waiting",
      TOAST_CHECK: "Check your agent's window.",
      TOAST_CHECK_NAMED: "Check the agent named {name}.",
      TOAST_OPEN: "Open the rail to hand this doc to a new agent."
    },
    QUIET_MS: 3e4,
    ACTIVE_MS: 6e5,
    STALE_MS: 6e5,
    RECENT_COMMAND_MS: 6e5,
    NO_AGENT_LOUD_MS: 12e4
  };
  function livenessOverdue(state, waitedMs) {
    if (typeof state !== "string" || !Object.hasOwn(AGENT_LIVENESS.TEXT, state)) return false;
    if (typeof waitedMs !== "number" || !Number.isFinite(waitedMs) || waitedMs < AGENT_LIVENESS.QUIET_MS) return false;
    if (state === AGENT_LIVENESS.STATE.WORKING) return false;
    if (state === AGENT_LIVENESS.STATE.NO_AGENT) return waitedMs >= AGENT_LIVENESS.NO_AGENT_LOUD_MS;
    return waitedMs >= AGENT_LIVENESS.STALE_MS;
  }
  var RAIL_REASON = "The agent that was working on it stopped answering my comments, and I am asking you to continue it.";
  var LIBRARY_REASON = "I am handing it to you from the Lahe Library so you can continue it.";
  var STATE_DIR_QUESTION = "This review keeps its files outside Lahe's default folder, so add --state-dir with the folder the earlier agent's lahe commands used. If you cannot find it, ask me.";
  function handoffMessage(handoff) {
    const stateDir = handoff.from === "library" ? handoff.stateDir : null;
    const requestId = handoff.from === "library" ? handoff.request : null;
    const flag = stateDirFlag(stateDir);
    const sessionId = handoff.sessionId;
    const run = isSafeId(sessionId) ? ["Run this command:", "", "    " + takeoverCommand(sessionId, stateDir, requestId), ""] : ["Run `lahe session list" + flag + "` to find the session for this document, then take it over with:", "", "    lahe session takeover <session-id>" + flag, ""];
    const asksForStateDir = handoff.from === "rail" && handoff.stateDirFlagNeeded;
    const named = handoff.name === null || handoff.name === "" ? "" : ", the session named " + JSON.stringify(handoff.name);
    return [
      "Please take over my live Lahe review" + named + ". " + (handoff.from === "rail" ? RAIL_REASON : LIBRARY_REASON),
      "",
      ...run,
      ...asksForStateDir ? [STATE_DIR_QUESTION, ""] : [],
      "It prints the commands to catch up. Then work every comment that is waiting and reply to each one, and keep watching for new ones."
    ].join("\n");
  }

  // src/contract/library.ts
  var CATALOG = {
    REQUEST_EXPIRY_MS: 18e5,
    LIBRARY_SEEN_MS: 12e4,
    WORKING_MS: 12e4,
    LIBRARY_SESSION_IDLE_MS: 18e5,
    CREATED_BY_LIBRARY: "library",
    QUEUE_CAP: 5,
    REPROJECT_MAX_BYTES: 5242880,
    POLL_MS: 15e3,
    ANSWER_SHOWN_MS: 864e5,
    ANSWER_TEXT_MAX: 500,
    DEFAULT_VIEW_DAYS: 7,
    FOLD_CUTOFF: "2026-09-17T04:00:00Z",
    NOT_WORK_EVENTS: [EVENT.ORIGIN_REGISTERED, EVENT.ORIGIN_REMOVED, EVENT.PAGE_VISITED, EVENT.REVIEW_ADOPTED, EVENT.REPLY_SEEN]
  };
  function legacyPickupNote(reviewId) {
    return "It belongs to no session. Serving it takes review " + reviewId + " into your session, with its old comments; drain it for any still waiting.";
  }
  var CATALOG_LOG = {
    PREFIX: "catalog",
    ACTION: { OPEN: "open", STAR: "star", UNSTAR: "unstar", PICKUP: "pickup", LAUNCH: "launch" },
    FORMAT: "catalog <action> review=<id> age_days=<n>"
  };
  function catalogLogLine(action, reviewId, ageDays) {
    return CATALOG_LOG.PREFIX + " " + action + " review=" + reviewId + " age_days=" + String(ageDays);
  }

  // lahe-register:src/contract/protocol.ts
  var converted = Object.assign({}, protocol_exports);
  globalThis.LAHE = globalThis.LAHE || {};
  globalThis.LAHE.protocol = converted;

  // lahe-entry.js
  var import_view_model = __toESM(require_view_model());
  var import_copy_text = __toESM(require_copy_text());

  // src/layer/catalog/page.js
  (function() {
    "use strict";
    var protocol = window.LAHE && window.LAHE.protocol;
    var VM = window.LAHE && window.LAHE.catalogViewModel;
    var copyText = window.LAHE && window.LAHE.copyText;
    var statusLine = document.getElementById("lahe-catalog-status");
    if (!protocol || !VM || !copyText) {
      if (statusLine) statusLine.textContent = "The Library could not load its scripts. Reload this page.";
      return;
    }
    var meta = document.querySelector('meta[name="' + protocol.CATALOG_TOKEN_META + '"]');
    var token = meta && meta.getAttribute("content");
    if (!token) {
      if (statusLine) statusLine.textContent = "The Library token is missing. Reload this page.";
      return;
    }
    var ROUTE = {
      list: protocol.route("catalog.list"),
      open: protocol.route("catalog.open"),
      star: protocol.route("catalog.star"),
      rename: protocol.route("catalog.rename"),
      request: protocol.route("catalog.request")
    };
    var els = {
      agent: document.getElementById("lahe-catalog-agent"),
      search: document.getElementById("lahe-catalog-search"),
      project: document.getElementById("lahe-catalog-project"),
      banner: document.getElementById("lahe-catalog-banner"),
      main: document.getElementById("lahe-catalog-main"),
      dialog: document.getElementById("lahe-catalog-confirm")
    };
    var list = null;
    var state = VM.initialState();
    var lastRendered = null;
    var timer = null;
    function headers(json) {
      var h2 = {};
      h2[protocol.HEADER.CLIENT] = protocol.CLIENT_CATALOG;
      h2[protocol.HEADER.TOKEN] = token;
      if (json) h2[protocol.HEADER.CONTENT_TYPE] = protocol.JSON_CONTENT_TYPE;
      return h2;
    }
    function call(route2, body) {
      var init = {
        method: route2.method,
        headers: headers(route2.method !== "GET"),
        credentials: "same-origin",
        cache: "no-store"
      };
      if (route2.method !== "GET") init.body = JSON.stringify(body || {});
      return fetch(route2.path, init).then(
        function(res) {
          return res.text().then(function(text) {
            var parsed = null;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch (err) {
              parsed = null;
            }
            if (res.ok) return { ok: true, status: res.status, body: parsed || {} };
            return { ok: false, status: res.status, error: parsed && parsed.error || null };
          });
        },
        function() {
          return { ok: false, unreachable: true };
        }
      );
    }
    var polling = null;
    function poll() {
      if (!VM.shouldPoll(state)) return Promise.resolve();
      if (polling) return polling;
      polling = call(ROUTE.list).then(function(result) {
        polling = null;
        if (result.ok && result.body && Array.isArray(result.body.sessions)) {
          list = result.body;
          state = VM.afterList(VM.withFetch(state, { ok: true }), list);
        } else if (result.ok) {
          state = VM.withFetch(state, { ok: false, status: 500, error: { message: "The helper sent a list the page cannot read." } });
        } else {
          state = VM.withFetch(state, result);
        }
        if (!VM.shouldPoll(state)) stopPolling();
        render();
      });
      return polling;
    }
    function stopPolling() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    }
    window.__laheCatalogPollNow = function() {
      return poll().then(function() {
        render();
      });
    };
    function update(next) {
      state = next;
      render();
    }
    function now() {
      return Date.now();
    }
    function act(reviewId, action, options) {
      var d = VM.decide(list, state, reviewId, action, options || {});
      if (d.kind === "none") return;
      if (d.kind === "handoff") {
        focusKey(reviewId + ":copy");
        update(VM.withDialog(VM.withPanel(state, reviewId, d.reason), null));
        return;
      }
      if (d.kind === "already") {
        update(VM.withNote(state, reviewId, d.note, now()));
        return;
      }
      if (d.kind === "confirm") {
        update(VM.withDialog(state, reviewId, d.action));
        return;
      }
      update(VM.withDialog(state, null));
      if (d.kind === "request") {
        call(ROUTE.request, d.body).then(function(result) {
          update(VM.afterRequest(state, list, reviewId, d.body.action, result, now()));
          poll();
        });
        return;
      }
      if (d.kind === "open") openReview(reviewId, d);
    }
    function openReview(reviewId, d) {
      var tab = null;
      if (d.tab) {
        tab = window.open("about:blank", "_blank");
        if (!tab) {
          update(VM.popupBlocked(state, reviewId, now()));
          return;
        }
        awayInTab = true;
        try {
          tab.opener = null;
        } catch (err) {
        }
      }
      update(VM.beginOpen(state, list, reviewId, { handoff: d.body.handoff, tab: d.tab }));
      call(ROUTE.open, d.body).then(function(result) {
        var url = result.ok && result.body ? result.body.url : null;
        if (tab) {
          if (result.ok && (VM.isLoopbackHttpUrl(url) || VM.isLaheSiteUrl(url))) {
            tab.location.href = url;
          } else {
            tab.close();
            if (result.ok && url !== null && url !== void 0) result = { ok: false, urlRefused: true };
          }
        }
        update(VM.afterOpen(state, list, reviewId, result, now()));
        poll();
      });
    }
    function star(reviewId, desired) {
      update(VM.beginStar(state, reviewId, desired));
      call(ROUTE.star, { review: reviewId, starred: desired }).then(function(result) {
        update(VM.afterStar(state, reviewId, desired, result, now()));
        poll();
      });
    }
    var renameDraft = { id: null, value: "" };
    function startRename(reviewId) {
      var found = null;
      renameDraft = { id: null, value: "" };
      focusKey(reviewId + ":rename-input");
      update(VM.withRenaming(state, reviewId));
      found = els.main.querySelector('[data-key="' + cssEscape(reviewId + ":rename-input") + '"]');
      if (found && found.select) found.select();
    }
    var renameClosing = false;
    var blurTarget = false;
    function blurring() {
      return blurTarget;
    }
    function commitRename(input) {
      var id = input.getAttribute("data-rename");
      var typed = String(input.value || "").trim();
      var current = input.getAttribute("data-current") || "";
      var original = input.getAttribute("data-original") || "";
      if (!typed || typed === current) {
        cancelRename(id);
        return;
      }
      saveRename(id, typed === original ? "" : typed);
    }
    function saveRename(reviewId, value) {
      renameDraft = { id: null, value: "" };
      if (!blurring()) focusKey(reviewId + ":rename");
      update(VM.beginRename(state, reviewId, value));
      var body = reviewId.indexOf("session:") === 0 ? { session: reviewId.slice("session:".length), name: value } : { review: reviewId, name: value };
      call(ROUTE.rename, body).then(function(result) {
        update(VM.afterRename(state, reviewId, result, now()));
        poll();
      });
    }
    function cancelRename(reviewId) {
      renameDraft = { id: null, value: "" };
      if (!blurring()) focusKey(reviewId + ":rename");
      update(VM.withRenaming(state, null));
    }
    function copyHandoff(reviewId, message) {
      copyText(message).then(function(ok) {
        update(VM.withCopied(state, reviewId, ok));
      });
    }
    function onClick(event) {
      var btn = event.target.closest ? event.target.closest("[data-act]") : null;
      if (!btn || btn.disabled) return;
      var id = btn.getAttribute("data-review");
      var what = btn.getAttribute("data-act");
      if (what === "open") act(id, what);
      else if (what === "pickup" || what === "launch") {
        state = VM.withMenu(state, null);
        act(id, what);
      } else if (what === "menu") {
        if (btn.getAttribute("aria-expanded") === "true") update(VM.withMenu(state, null));
        else {
          focusKey(id + ":pickup");
          update(VM.withMenu(state, id));
        }
      } else if (what === "star") star(id, btn.getAttribute("aria-pressed") !== "true");
      else if (what === "rename") {
        event.preventDefault();
        startRename(id);
      } else if (what === "rename-session") {
        event.preventDefault();
        startRename("session:" + btn.getAttribute("data-session"));
      } else if (what === "pages") update(VM.withPagesOpen(state, id, btn.getAttribute("aria-expanded") !== "true"));
      else if (what === "more") update(VM.withCardMore(state, btn.getAttribute("data-card"), btn.getAttribute("aria-expanded") !== "true"));
      else if (what === "handoff") {
        focusKey(id + ":copy");
        update(VM.withPanel(state, id, btn.getAttribute("data-reason") || "no_agent"));
      } else if (what === "copy") copyHandoff(id, btn.getAttribute("data-message") || "");
      else if (what === "close-panel") update(VM.withPanel(state, null));
      else if (what === "show-missing") update(VM.withShowMissing(state, true));
      else if (what === "hide-missing") update(VM.withShowMissing(state, false));
      else if (what === "reload") window.location.reload();
      else if (what === "move") act(id, btn.getAttribute("data-action"), { confirmed: true });
      else if (what === "read") act(id, "open", { read: true });
      else if (what === "cancel") update(VM.withDialog(state, null));
    }
    function h(tag, attrs, children) {
      var node = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function(k) {
          var v = attrs[k];
          if (v === null || v === void 0 || v === false) return;
          if (k === "text") node.textContent = String(v);
          else node.setAttribute(k, v === true ? "" : String(v));
        });
      }
      (children || []).forEach(function(child) {
        if (child === null || child === void 0) return;
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      });
      return node;
    }
    function slashBreaks(text) {
      var out = [];
      String(text).split("/").forEach(function(part, i, all) {
        out.push(part + (i < all.length - 1 ? "/" : ""));
        if (i < all.length - 1) out.push(document.createElement("wbr"));
      });
      return out;
    }
    function button(label, attrs) {
      return h("button", Object.assign({ type: "button", class: "lib-btn", text: label }, attrs || {}));
    }
    function actionButton(row2, key, primary) {
      var b = row2.buttons[key];
      return button(b.label, {
        "data-act": key,
        "data-review": row2.id,
        "data-key": row2.id + ":" + key,
        "data-primary": primary ? "true" : null,
        "aria-busy": b.busy ? "true" : null,
        title: b.reason || null,
        disabled: !b.enabled
      });
    }
    function waitingMark(text) {
      return h("span", { class: "lib-waiting" }, [h("span", { class: "lib-dot", "aria-hidden": "true" }), text]);
    }
    function renderRow(row2, extra) {
      var nameLine;
      if (row2.rename.editing) {
        var typed = renameDraft.id === row2.id ? renameDraft.value : row2.rename.value;
        nameLine = h("p", { class: "lib-name lib-rename" }, [
          h("input", {
            type: "text",
            class: "lib-rename-input",
            "data-rename": row2.id,
            "data-key": row2.id + ":rename-input",
            "data-current": row2.rename.value,
            "data-original": row2.rename.original,
            value: typed,
            maxlength: "80",
            "aria-label": row2.rename.label + ": " + row2.rename.original,
            placeholder: row2.rename.original
          })
        ]);
      } else {
        nameLine = h("p", { class: "lib-name-line" }, [
          h("button", {
            type: "button",
            class: "lib-name",
            "data-act": "rename",
            "data-review": row2.id,
            "data-key": row2.id + ":rename",
            "aria-label": row2.rename.label + ": " + row2.name,
            title: row2.rename.label,
            text: row2.name
          })
        ]);
      }
      var main = h("div", { class: "lib-row-main" }, [
        nameLine,
        row2.originalName ? h("p", { class: "lib-original", text: row2.originalName }) : null,
        row2.path ? h("p", { class: "lib-where", title: row2.pathTitle || null }, slashBreaks(row2.path)) : null,
        row2.address ? h("p", { class: "lib-address" }, [
          h("a", {
            href: row2.address.href,
            target: "_blank",
            rel: "noopener noreferrer",
            "data-act-link": "address",
            "data-review": row2.id,
            text: row2.address.text
          })
        ]) : null
      ]);
      var facts = [h("span", { text: row2.lastText })];
      if (extra) facts.push(h("span", { text: extra }));
      if (row2.counts.waiting) facts.push(waitingMark(row2.counts.waiting));
      facts.push(h("span", { text: row2.counts.comments }));
      if (row2.counts.asOf) facts.push(h("span", { text: row2.counts.asOf }));
      row2.badges.forEach(function(b) {
        var kind = b.indexOf("agent listening") === 0 || b.indexOf("agent working") === 0 ? "watching" : b === "being served now" ? "served" : "ended";
        facts.push(h("span", { class: "lib-badge", "data-badge": kind, text: b }));
      });
      if (row2.folded) facts.push(h("span", { text: row2.folded }));
      main.appendChild(h("div", { class: "lib-facts" }, facts));
      if (row2.pagesToggle) {
        main.appendChild(
          h("p", { class: "lib-line" }, [
            button(row2.pagesToggle.text, {
              "data-act": "pages",
              "data-review": row2.id,
              "data-key": row2.id + ":pages",
              "data-quiet": "true",
              "data-disclosure": "true",
              "aria-expanded": row2.pagesToggle.expanded ? "true" : "false"
            })
          ])
        );
      }
      if (row2.pages.length) {
        main.appendChild(
          h(
            "ul",
            { class: "lib-pages", "aria-label": "Pages" },
            row2.pages.map(function(p) {
              return h("li", null, [h("span", { text: p.title }), p.title !== p.path ? h("span", { class: "lib-path", text: p.path }) : null]);
            })
          )
        );
      }
      row2.notices.forEach(function(n) {
        main.appendChild(h("p", { class: "lib-line", "data-tone": n.tone, text: n.text }));
      });
      if (row2.note) {
        var noteKids = [h("span", { class: "lib-mark", "aria-hidden": "true" }), h("span", { class: "lib-note-text", text: row2.note.text })];
        if (row2.note.copyHandoff) {
          noteKids.push(
            button(row2.handoffLabel, {
              "data-act": "handoff",
              "data-reason": "refused",
              "data-review": row2.id,
              "data-key": row2.id + ":handoff",
              "data-quiet": "true"
            })
          );
        }
        main.appendChild(
          h("p", { class: "lib-note", "data-tone": row2.note.tone, "data-busy": row2.note.busy ? "true" : "false" }, noteKids)
        );
      }
      if (row2.offerHandoff) {
        main.appendChild(
          h("p", { class: "lib-line" }, [
            button(row2.handoffLabel, {
              "data-act": "handoff",
              "data-reason": "no_agent",
              "data-review": row2.id,
              "data-key": row2.id + ":handoff",
              "data-quiet": "true"
            })
          ])
        );
      }
      var starBtn = h("button", {
        type: "button",
        class: "lib-star",
        "data-act": "star",
        "data-review": row2.id,
        "data-key": row2.id + ":star",
        "aria-pressed": row2.star.on ? "true" : "false",
        "aria-label": row2.star.label,
        title: row2.star.label,
        "aria-busy": row2.star.pending ? "true" : null,
        disabled: !row2.star.enabled || row2.star.pending,
        text: row2.star.on ? "\u2605" : "\u2606"
      });
      var actKids = [actionButton(row2, "open", true)];
      var hand = row2.buttons.handTo;
      if (!hand.hidden) {
        var menuId = "lib-menu-" + row2.id;
        var menuWrap = h("div", { class: "lib-menu" }, [
          button(hand.label, {
            "data-act": "menu",
            "data-review": row2.id,
            "data-key": row2.id + ":menu",
            "aria-haspopup": "true",
            "aria-expanded": hand.expanded ? "true" : "false",
            "aria-controls": hand.expanded ? menuId : null,
            "aria-busy": hand.busy ? "true" : null,
            title: hand.reason || null,
            disabled: !hand.enabled
          })
        ]);
        if (hand.expanded) {
          menuWrap.appendChild(
            h("div", { class: "lib-menu-list", id: menuId, role: "group", "aria-label": hand.label }, [
              actionButton(row2, "pickup", false),
              actionButton(row2, "launch", false)
            ])
          );
        }
        actKids.push(menuWrap);
      }
      var acts = h("div", { class: "lib-acts" }, actKids);
      var kids = [starBtn, main, acts];
      if (row2.panel) {
        kids.push(
          h("div", { class: "lib-panel", role: "region", "aria-label": row2.handoffLabel }, [
            h("p", { text: row2.panel.intro }),
            row2.panel.message ? h("pre", { text: row2.panel.message }) : null,
            h("div", { class: "lib-panel-acts" }, [
              row2.panel.message ? button(row2.panel.copyLabel, {
                "data-act": "copy",
                "data-review": row2.id,
                "data-key": row2.id + ":copy",
                "data-message": row2.panel.message,
                "data-primary": "true"
              }) : null,
              button(row2.panel.closeLabel, { "data-act": "close-panel", "data-review": row2.id, "data-key": row2.id + ":close" }),
              row2.panel.copyStatus ? h("span", { class: "lib-copy-status", role: "status", text: row2.panel.copyStatus }) : null
            ])
          ])
        );
      }
      return h("li", { "data-review": row2.id }, [h("div", { class: "lib-row" }, kids)]);
    }
    function cardTitle(card) {
      if (card.rename && card.rename.editing) {
        var key = "session:" + card.session;
        var typed = renameDraft.id === key ? renameDraft.value : card.rename.value;
        return h("span", { class: "lib-card-title" }, [
          h("input", {
            type: "text",
            class: "lib-rename-input",
            "data-rename": key,
            "data-key": key + ":rename-input",
            "data-current": card.rename.value,
            "data-original": card.rename.original,
            value: typed,
            maxlength: "80",
            "aria-label": card.rename.label + ": " + card.rename.original,
            placeholder: card.rename.original
          })
        ]);
      }
      var kids = [];
      if (card.rename) {
        kids.push(h("button", {
          type: "button",
          class: "lib-card-name",
          "data-act": "rename-session",
          "data-session": card.session,
          "data-key": "session:" + card.session + ":rename",
          "aria-label": card.rename.label + ": " + card.title,
          title: card.rename.label,
          text: card.title
        }));
      } else {
        kids.push(h("span", { text: card.title }));
      }
      if (card.originalTitle) kids.push(h("span", { class: "lib-card-original", text: card.originalTitle }));
      return h("span", { class: "lib-card-title" }, kids);
    }
    function renderCard(card) {
      var metaKids = card.projects.map(function(p) {
        return h("span", { class: "lib-project", text: p });
      });
      metaKids.push(h("span", { text: card.reviewsText }));
      metaKids.push(
        card.watched ? h("span", { class: "lib-card-watch" }, [h("span", { class: "lib-badge", "data-badge": "watching", text: card.watchText })]) : h("span", { class: "lib-card-watch", text: card.watchText })
      );
      if (card.waitingText) metaKids.push(waitingMark(card.waitingText));
      metaKids.push(h("span", { text: card.lastText }));
      var body = [
        h("summary", { "data-key": "card:" + card.id }, [
          h("span", { class: "lib-chev", "aria-hidden": "true" }),
          cardTitle(card),
          h("span", { class: "lib-card-meta" }, metaKids)
        ])
      ];
      if (card.notes && card.notes.length) {
        body.push(h("div", { class: "lib-card-notes" }, card.notes.map(function(n) {
          return h("p", { class: "lib-line", "data-tone": n.tone, text: n.text });
        })));
      }
      body.push(h("ul", { class: "lib-rows" }, card.rows.map(function(r) {
        return renderRow(r, null);
      })));
      if (card.more) {
        body.push(h("p", { class: "lib-card-more" }, [
          button(card.more.text, {
            "data-act": "more",
            "data-card": card.id,
            "data-key": "more:" + card.id,
            "data-quiet": "true",
            "data-disclosure": "true",
            "aria-expanded": card.more.expanded ? "true" : "false"
          })
        ]));
      }
      var details = h("details", { class: "lib-card", "data-session": card.id, open: card.open }, body);
      details.addEventListener("toggle", function() {
        if (details.open !== card.open) update(VM.withExpanded(state, card.id, details.open));
      });
      return details;
    }
    function renderMain(view) {
      var kids = [];
      if (view.notice) kids.push(h("p", { class: "lib-notice", text: view.notice }));
      if (view.loading) kids.push(h("p", { class: "lib-quiet", id: "lahe-catalog-status", text: view.loading }));
      if (view.empty) kids.push(h("p", { class: "lib-quiet", "data-state": "empty", text: view.empty }));
      if (view.noMatches) kids.push(h("p", { class: "lib-quiet", "data-state": "no-matches", text: view.noMatches }));
      view.sections.forEach(function(section) {
        kids.push(
          h("section", { class: "lib-section", "data-section": section.id }, [
            h("h2", { text: section.heading }),
            section.subtitle ? h("p", { class: "lib-section-sub", text: section.subtitle }) : null
          ].concat(section.cards.map(renderCard)))
        );
      });
      if (view.missing) {
        if (view.missing.section) {
          var sec = view.missing.section;
          kids.push(
            h("section", { class: "lib-section lib-missing", "data-section": "missing" }, [
              h("div", { class: "lib-section-head" }, [
                h("h2", { text: sec.heading }),
                button(sec.hideText, { "data-act": "hide-missing", "data-key": "missing:toggle", "data-quiet": "true" })
              ]),
              h("ul", { class: "lib-rows" }, sec.rows.map(function(r) {
                return renderRow(r, r.sessionText);
              }))
            ])
          );
        } else {
          kids.push(
            h("p", { class: "lib-missing-toggle" }, [
              button(view.missing.toggleText, { "data-act": "show-missing", "data-key": "missing:toggle", "data-quiet": "true" })
            ])
          );
        }
      }
      els.main.replaceChildren.apply(els.main, kids);
    }
    function renderBanner(banner) {
      if (!banner) {
        els.banner.replaceChildren();
        return;
      }
      var kids = [h("p", { text: banner.text })];
      if (banner.action === "reload") kids.push(button(banner.actionLabel, { "data-act": "reload", "data-key": "banner:reload", "data-primary": "true" }));
      var existing = els.banner.firstChild;
      if (existing && existing.getAttribute("data-text") === banner.text) return;
      els.banner.replaceChildren(h("div", { class: "lib-banner-box", "data-tone": banner.tone, "data-text": banner.text }, kids));
    }
    var lastDialog = null;
    function renderDialog(dialog) {
      var el = els.dialog;
      var serial = dialog ? JSON.stringify(dialog) : null;
      if (!dialog) {
        lastDialog = null;
        if (el.open) el.close();
        el.replaceChildren();
        return;
      }
      if (serial === lastDialog && el.open) return;
      lastDialog = serial;
      var kids = [
        h("h2", { id: "lahe-catalog-confirm-title", text: dialog.title }),
        dialog.status ? h("p", { class: "lib-dialog-status", text: dialog.status }) : null,
        h("p", { class: "lib-dialog-body", text: dialog.body })
      ].filter(Boolean);
      if (dialog.reviews.length) {
        kids.push(h("ul", { class: "lib-dialog-list" }, dialog.reviews.map(function(name) {
          return h("li", { text: name });
        })));
      }
      kids.push(
        h("div", { class: "lib-dialog-acts" }, dialog.buttons.map(function(b) {
          return button(b.label, {
            "data-act": b.id,
            "data-review": dialog.review,
            "data-action": dialog.action,
            "data-key": "dialog:" + b.id,
            "data-primary": b.id === "move" ? "true" : null,
            "data-quiet": b.id === "cancel" ? "true" : null
          });
        }))
      );
      el.replaceChildren.apply(el, kids);
      if (!el.open) el.showModal();
      var first = el.querySelector('[data-act="move"]');
      if (first) first.focus();
    }
    function renderProjects(projects) {
      var current = Array.prototype.map.call(els.project.options, function(o) {
        return o.value + "\0" + o.textContent;
      }).join("");
      var wanted = projects.options.map(function(o) {
        return o.value + "\0" + o.label;
      }).join("");
      if (current !== wanted) {
        els.project.replaceChildren.apply(
          els.project,
          projects.options.map(function(o) {
            return h("option", { value: o.value, text: o.label });
          })
        );
      }
      els.project.value = projects.value;
      els.project.hidden = projects.options.length <= 1;
    }
    var pendingFocus = null;
    function focusKey(key) {
      pendingFocus = key;
    }
    var awayInTab = false;
    function backOnPage() {
      if (!awayInTab) return;
      awayInTab = false;
      if (pendingFocus !== null) render();
    }
    window.addEventListener("focus", backOnPage);
    document.addEventListener("pointerdown", backOnPage, true);
    document.addEventListener("keydown", backOnPage, true);
    function render() {
      var view = VM.build(list, state, now(), {});
      var serial = JSON.stringify(view);
      if (serial === lastRendered && pendingFocus === null) return;
      lastRendered = serial;
      var active = document.activeElement;
      var activeKey = active && active.getAttribute ? active.getAttribute("data-key") : null;
      els.agent.textContent = view.agent.text;
      els.agent.setAttribute("data-attached", view.agent.attached ? "true" : "false");
      els.search.placeholder = view.search.placeholder;
      if (els.search.value !== view.search.value) els.search.value = view.search.value;
      renderProjects(view.projects);
      renderBanner(view.banner);
      renderMain(view);
      renderDialog(view.dialog);
      var key = pendingFocus || activeKey;
      pendingFocus = null;
      if (key && awayInTab) {
        pendingFocus = key;
        key = null;
      }
      if (key && !(view.dialog && els.dialog.open)) {
        var target = els.main.querySelector('[data-key="' + cssEscape(key) + '"]') || els.banner.querySelector('[data-key="' + cssEscape(key) + '"]');
        if (target && target !== document.activeElement) target.focus();
      }
    }
    function cssEscape(value) {
      return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
    }
    els.main.addEventListener("click", onClick);
    els.banner.addEventListener("click", onClick);
    els.dialog.addEventListener("click", onClick);
    els.dialog.addEventListener("close", function() {
      if (state.dialog) update(VM.withDialog(state, null));
    });
    document.addEventListener("keydown", function(event) {
      if (event.key !== "Escape" || !state.menu) return;
      focusKey(state.menu + ":menu");
      update(VM.withMenu(state, null));
    });
    els.main.addEventListener("input", function(event) {
      var id = event.target && event.target.getAttribute && event.target.getAttribute("data-rename");
      if (id) renameDraft = { id, value: event.target.value };
    });
    els.main.addEventListener("keydown", function(event) {
      var id = event.target && event.target.getAttribute && event.target.getAttribute("data-rename");
      if (!id) return;
      if (event.key === "Enter") {
        event.preventDefault();
        renameClosing = true;
        commitRename(event.target);
        renameClosing = false;
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        renameClosing = true;
        cancelRename(id);
        renameClosing = false;
      }
    });
    els.main.addEventListener("focusout", function(event) {
      var input = event.target;
      if (renameClosing || !input || !input.getAttribute || !input.getAttribute("data-rename")) return;
      if (!input.isConnected) return;
      renameClosing = true;
      blurTarget = true;
      commitRename(input);
      blurTarget = false;
      renameClosing = false;
    });
    els.search.addEventListener("input", function() {
      update(VM.withQuery(state, els.search.value));
    });
    els.project.addEventListener("change", function() {
      update(VM.withProject(state, els.project.value));
    });
    render();
    poll();
    timer = setInterval(poll, protocol.CATALOG.POLL_MS);
  })();
})();
