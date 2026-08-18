// Edit state: one block at a time, entered deliberately, committed once.
//
// Owner: 2A. Implements architecture D3 (edit is entered deliberately, per
// region; browse is the page untouched) and D4 (the edit record).
//
// ---------------------------------------------------------------------------
// What a reviewer does, and what happens
// ---------------------------------------------------------------------------
//
//   Cmd-Shift-E           the block under the caret becomes editable, that one
//                         block and nothing else, visibly framed
//   typing                every keystroke is durable, synchronously
//   Esc, or the pointer   the edit commits, protection lifts, and the block
//   going down outside    rejoins the page. Outside means outside: the rest of
//   the block            the page, AND the library's own rail, AND the window
//                         losing focus altogether. An edit left in `draft`
//                         reaches no agent at all, so every way of leaving the
//                         block has to end the same way.
//   navigating away       the open edit commits on the way out, and the event
//                         is durable in browser storage whether or not the
//                         keepalive post makes it (R1: navigation cannot be a
//                         losing move)
//   Bold / Italic         the two formatting commands R24 allows. A
//                         formatting-only change is still a change (R31)
//   Delete block          its own record kind, which reads as a deletion rather
//                         than as an empty edit (R27)
//   undo                  reverts THAT record's region to its `before` and
//                         retires the record, touching nothing else (R28)
//
// ---------------------------------------------------------------------------
// Five rules this file must not lose
// ---------------------------------------------------------------------------
//
//  1. `before` IS PINNED AT FIRST TOUCH and never recaptured, however many
//     times the reviewer retypes (R29). If it drifts to the last committed
//     wording, replay's branch two never matches the source again and the agent
//     gets a diff that is a no-op against the file, silently, while everything
//     on screen looks right.
//
//  2. A COMMIT IS THE REVIEWER LEAVING THE REGION. Esc, a click outside,
//     navigation. It is never the framework yanking the node out from under
//     them: a repaint that destroys the focused block must not commit anything
//     (that is 2B's protection domain), and a draft stays a draft.
//
//  3. EXACTLY ONE COMMIT PER SESSION. Clearing edit state removes
//     contenteditable, which fires blur. A blur handler that commits would
//     commit a second time and bump the revision, and one edit would reach the
//     agent as a rewording that never happened. So the session is cleared
//     BEFORE the DOM is touched, and there is no blur handler at all: the
//     gesture table's `when` column says COMMIT_EDIT applies only while a block
//     is in edit state.
//
//  4. `after` IS NEVER TRUNCATED AND NEVER CLEANED UP (R3). The text stored is
//     the block's own text, exactly as typed. Normalization is a COMPARISON
//     rule and happens at compare time, in replay, never on the way into a
//     record. The markup is the one exception, and only in one direction: it
//     goes through cleanMarkup so nothing the library added can reach a record
//     (R23, R33).
//
//  5. NOTHING THE LIBRARY DRAWS IS WRITTEN TO THE PAGE. The frame is a
//     rectangle in the library's own closed shadow root, over the block's
//     bounding box. The only things this file puts on a reviewed element are
//     the editing attributes below, and they come off at commit.
//
// A revision is a COMMITTED wording, not a keystroke. Typing inside a session
// writes the record every time and leaves `rev` where it is; the commit bumps
// it exactly once. The other reading (bump per keystroke) turns one edit into
// forty revisions and makes every agent reply stale on arrival.
//
// ---------------------------------------------------------------------------
// The formatting mechanism decision (kept from the file this reworks)
// ---------------------------------------------------------------------------
//
// DECIDED: document.execCommand, with normalization on capture.
//
//  - execCommand is deprecated and still implemented in every target engine,
//    and it handles the selection cases that are the actual work: a selection
//    that starts inside a <strong> and ends outside it, a partial selection
//    across an inline boundary. Manual range surgery is a week of edge cases,
//    and the ones it gets wrong are silent.
//  - Its known defect is dirty markup: <b> where you wanted <strong>, nested
//    spans, inline styles. cleanMarkup already normalizes every one of those,
//    because it has to normalize the page author's markup anyway.
//  - The one setting that matters: document.execCommand("styleWithCSS", false,
//    false) once per document, so tags are emitted rather than style
//    attributes. R35 forbids the tool writing a style attribute onto a reviewed
//    element, and styleWithCSS true would do exactly that on every bold.
//
// What changed from the file this reworks: its Chromium-only reasoning (the
// tool ships on three engines now) and its entry gesture. Click-to-edit is
// dead. It fought the page for every click, which is the inversion this design
// exists to remove.
//
// Composition events are deferred to composition end, so a post during IME
// composition cannot ship half-composed text as the reviewer's exact wording.
// IME itself is a MANUAL CHECK on the acceptance walk (4A): composition is not
// reliably drivable from Playwright, and a test that drove it would be
// asserting the harness rather than the browser.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.editing = factory(
      root.LAHE.markers,
      root.LAHE.normalize,
      root.LAHE.record,
      root.LAHE.regions,
      root.LAHE.epoch,
      root.LAHE.gestures,
      root.LAHE.selection,
      root.LAHE.store,
      root.LAHE.anchor,
      root.LAHE.highlight,
      root.LAHE.listeners,
      root.LAHE.protect,
      // replay.js loads AFTER this file (it depends on everything), so it is
      // resolved when a pass is scheduled rather than when this module loads.
      function () {
        return root.LAHE.replay;
      }
    );
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/normalize.js"),
      require("../shared/record.js"),
      require("../shared/regions.js"),
      require("../shared/epoch.js"),
      require("../shared/gestures.js"),
      require("./selection.js"),
      require("./store.js"),
      require("./anchor.js"),
      require("./highlight.js"),
      require("./listeners.js"),
      require("./protect.js"),
      function () {
        return require("./replay.js");
      }
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  markers,
  normalize,
  record,
  regions,
  epoch,
  gestures,
  selection,
  storeModule,
  anchor,
  highlightModule,
  listeners,
  protect,
  replayRef
) {
  "use strict";

  var FORMATTING_MECHANISM = "execCommand";

  var FRAME_CLASS = "lahe-edit-frame";
  var BAR_CLASS = "lahe-edit-bar";
  // The registry group, from the one place both this file and inject.js read it.
  var LISTENER_GROUP = listeners.GROUP.EDITING;

  // The commands R24 allows for v1, closed to bold and italic (the
  // architecture's list). An enum rather than a pass-through string, so a
  // builder cannot reach a command this tool never decided to support.
  var COMMANDS = {
    bold: "bold",
    italic: "italic"
  };

  // Run once per document, before any formatting command.
  var BOOT_COMMANDS = [
    { command: "styleWithCSS", value: false, why: "emit tags, never style attributes. R35" },
    { command: "defaultParagraphSeparator", value: "p", why: "Enter makes a paragraph, not a div" }
  ];

  // Set on the block in edit state. The platform must not be able to rewrite a
  // word and have it recorded as the reviewer's intent (D4).
  var EDITABLE_ATTRS = {
    contenteditable: "true",
    spellcheck: "false",
    autocorrect: "off",
    autocapitalize: "off",
    // Honored by Chromium on contenteditable, and it removes the third-party
    // format bar that would otherwise appear over the reviewed page.
    "data-gramm": "false"
  };

  // Ken's copy, one spelling, used on the frame.
  var LABEL_EDITING = "Editing this block";
  var HINT_FINISH = "Esc to finish";

  // The frame's look. Quiet on purpose: the reviewer is reading their own
  // sentence, not the tool. One accent, the rail's, used for the outline and
  // the bar; a wash light enough to leave the page's own text the loudest thing
  // inside it. It lives in the closed shadow root, so nothing here can leak
  // into the page and the page cannot restyle it.
  var FRAME_STYLE = [
    ":host, * { box-sizing: border-box; }",
    "." + FRAME_CLASS + " {",
    "  position: fixed;",
    "  pointer-events: none;",
    "  border-radius: 7px;",
    "  border: 1.5px solid #3c56a5;",
    "  box-shadow: 0 0 0 4px rgba(60, 86, 165, 0.10), 0 6px 20px rgba(17, 17, 17, 0.10);",
    "  background: rgba(60, 86, 165, 0.045);",
    "  transition: opacity 120ms ease;",
    "  z-index: 1;",
    "}",
    "." + BAR_CLASS + " {",
    "  position: fixed;",
    "  pointer-events: auto;",
    "  display: flex;",
    "  align-items: center;",
    "  gap: 8px;",
    "  padding: 5px 8px;",
    "  border-radius: 7px;",
    "  border: 1px solid rgba(17, 17, 17, 0.10);",
    "  background: #ffffff;",
    "  box-shadow: 0 6px 20px rgba(17, 17, 17, 0.14), 0 1px 2px rgba(17, 17, 17, 0.08);",
    "  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;",
    "  color: #111111;",
    "  z-index: 2;",
    "}",
    ".lahe-edit-bar__label {",
    "  font-size: 10.5px;",
    "  letter-spacing: 0.08em;",
    "  text-transform: uppercase;",
    "  color: #2c3f7d;",
    "  white-space: nowrap;",
    "}",
    ".lahe-edit-bar__sep { width: 1px; height: 16px; background: rgba(17, 17, 17, 0.12); }",
    ".lahe-edit-bar__btn {",
    "  border: 1px solid transparent;",
    "  background: transparent;",
    "  border-radius: 5px;",
    "  padding: 3px 7px;",
    "  font: inherit;",
    "  color: inherit;",
    "  cursor: pointer;",
    "}",
    ".lahe-edit-bar__btn:hover { background: rgba(60, 86, 165, 0.09); }",
    ".lahe-edit-bar__btn:focus-visible { outline: 2px solid #3c56a5; outline-offset: 1px; }",
    ".lahe-edit-bar__btn[data-lahe-command='bold'] { font-weight: 700; }",
    ".lahe-edit-bar__btn[data-lahe-command='italic'] { font-style: italic; }",
    ".lahe-edit-bar__hint { color: rgba(17, 17, 17, 0.5); white-space: nowrap; }",
    // The PAGE picks the scheme, not the OS: highlight.js samples the reviewed
    // page's own background and stamps it on the surface host. A dark-mode OS
    // over a light page used to turn this bar into a black card floating on a
    // white document.
    ":host([data-lahe-scheme='dark']) ." + FRAME_CLASS + " { border-color: #93a7ea; background: rgba(147, 167, 234, 0.10);",
    "    box-shadow: 0 0 0 4px rgba(147, 167, 234, 0.14), 0 6px 20px rgba(0, 0, 0, 0.4); }",
    ":host([data-lahe-scheme='dark']) ." + BAR_CLASS + " { background: #1b1b1d; color: #f2f2f2; border-color: rgba(255,255,255,0.16); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__label { color: #b7c4f2; }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__hint { color: rgba(242,242,242,0.55); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__sep { background: rgba(255,255,255,0.16); }"
  ].join("\n");

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  /**
   * A region's text and markup, as a record carries them.
   *
   * The text is RAW: the block's own text, exactly as it reads. Collapsing
   * whitespace here would be cleaning up the reviewer's words on the way into
   * the record, and R3's named failure is exactly that kind of helpfulness.
   * Comparison normalizes; storage does not.
   *
   * The markup goes through cleanMarkup, which is the one direction that is
   * required rather than forbidden: it is what stops anything the library added
   * from reaching a record (R23, R33).
   *
   * @param {Element} regionEl
   * @returns {{text: (string|null), html: (string|null)}}
   */
  function capture(regionEl) {
    if (!regionEl) return { text: null, html: null };
    return {
      text: typeof regionEl.textContent === "string" ? regionEl.textContent : null,
      html: typeof regionEl.innerHTML === "string" ? normalize.cleanMarkup(regionEl.innerHTML) : null
    };
  }

  /**
   * What kind of change this is, decided in one place because three callers
   * would otherwise each decide it.
   *
   * A formatting-only change is still a change (R31), and it is its own kind
   * because it compares on STRUCTURE: its `after` text is identical to its
   * `before` by construction, so a text comparison would make it a silent
   * no-op.
   *
   * @returns {{changed: boolean, kind: (string|null)}}
   */
  function kindFor(before, after) {
    var textSame = normalize.equalsInMode(normalize.MODE.TEXT, String(before.text || ""), String(after.text || ""));
    var structureSame = normalize.equalsInMode(
      normalize.MODE.STRUCTURE,
      String(before.html || ""),
      String(after.html || "")
    );
    if (textSame && structureSame) return { changed: false, kind: null };
    if (textSame) return { changed: true, kind: record.KIND.FORMAT_ONLY };
    return { changed: true, kind: record.KIND.EDIT };
  }

  // ---------------------------------------------------------------------------
  // The surface
  // ---------------------------------------------------------------------------

  function createEditing(options) {
    var opts = options || {};
    var store = opts.store || storeModule.shared;
    var reviewId = opts.reviewId || null;
    var hasDoc = Object.prototype.hasOwnProperty.call(opts, "document");
    var doc = hasDoc ? opts.document : typeof document !== "undefined" ? document : null;
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    var sync = opts.sync || null;
    var isRealDocument = doc && typeof document !== "undefined" && doc === document;
    var highlights =
      opts.highlights ||
      (isRealDocument ? highlightModule.shared : doc ? highlightModule.createHighlights({ document: doc }) : null);
    var defaultPage = opts.page || null;

    // The one open session, or null. Edit state is per region and there is one
    // of it: a second Cmd-Shift-E commits the first.
    var session = null;
    var listenerHandles = [];
    var changeListeners = [];
    var booted = false;
    var frameNode = null;
    var barNode = null;
    var frameRaf = null;
    // Which record belongs to which live element, for the session this page has
    // been open. The anchor is the durable answer and is asked second; this is
    // the cheap one, and it is correct until a repaint, which the anchor covers.
    var itemForElement = [];
    // What a deleted block was, and where, so undoing a delete puts it back
    // where it came from rather than at the end of its parent.
    var deleted = Object.create(null);

    function requireReview() {
      if (!reviewId) throw new Error("editing: a reviewId is required before an edit can be stored");
      return reviewId;
    }

    function setReview(id) {
      reviewId = id;
      return reviewId;
    }

    function setPage(page) {
      defaultPage = page;
      return defaultPage;
    }

    function onChange(fn) {
      changeListeners.push(fn);
      return function () {
        changeListeners = changeListeners.filter(function (f) {
          return f !== fn;
        });
      };
    }

    function emit(item, event) {
      for (var i = 0; i < changeListeners.length; i += 1) changeListeners[i](item, event);
    }

    // The one write path. Storage first, synchronously, then everyone else.
    function persist(item, event, immediate) {
      store.write(requireReview(), item);
      emit(item, event);
      if (sync && typeof sync.recordItem === "function") {
        sync.recordItem(item, immediate ? { immediate: immediate } : undefined);
      }
      return item;
    }

    // ------------------------------------------------------------------------
    // Entering edit state
    // ------------------------------------------------------------------------

    function bootCommands() {
      if (booted || !doc || typeof doc.execCommand !== "function") return false;
      booted = true;
      BOOT_COMMANDS.forEach(function (row) {
        try {
          doc.execCommand(row.command, false, row.value);
        } catch (err) {
          // Not every engine implements every boot command, and none of them
          // is load-bearing on its own: styleWithCSS is a preference about the
          // markup execCommand emits, and cleanMarkup canonicalizes the output
          // either way.
          void err;
        }
      });
      return true;
    }

    /**
     * Cmd-Shift-E. Makes the block under the caret editable, that one block and
     * nothing else.
     *
     * @returns {null|Object} the session
     */
    function editBlockAtCaret() {
      var block = selection.blockFor(null);
      if (!block && selection.selectedRange()) {
        var range = selection.selectedRange();
        block = selection.blockFor(
          range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement
        );
      }
      return editBlock(block);
    }

    /**
     * Puts one block into edit state.
     *
     * @param {Element} block
     * @returns {null|Object} {itemId, block, before, kind}
     */
    function editBlock(block) {
      if (!block || markers.isInsideOverlay(block)) return null;
      if (session && session.block === block) return sessionInfo();
      if (session) commit({ reason: "another block" });

      bootCommands();

      var existing = itemFor(block);
      var before;
      var item;

      if (existing) {
        // RE-ENTRY. `before` comes off the record, never off the page: the
        // page now says the reviewer's last committed wording, and capturing
        // it here is exactly the drift R29 forbids.
        item = existing;
        before = { text: item[record.FIELD.BEFORE], html: item[record.FIELD.BEFORE_HTML] };
      } else {
        before = capture(block);
        item = record.newItem({
          kind: record.KIND.EDIT,
          state: record.STATE.DRAFT,
          before: before.text,
          before_html: before.html,
          page_origin: pageField("origin"),
          page_path: pageField("path"),
          page_title: pageField("title"),
          page_seq: pageField("seq"),
          source_hint: pageField("source_hint"),
          region: regionFor(block),
          context: contextFor(block)
        });
        // The draft exists the moment edit state does, so the first keystroke
        // is not the first durable thing. It is removed again if the reviewer
        // leaves without changing anything.
        persist(item, "opened");
        remember(block, item[record.FIELD.ID]);
      }

      session = {
        block: block,
        itemId: item[record.FIELD.ID],
        before: before,
        composing: false,
        wasNew: !existing,
        startedAt: Date.now()
      };

      applyEditableAttrs(block);
      // The record goes on the mark. Protection is then able to answer "which
      // record is the reviewer in" for replay, instead of replay inferring it
      // from the node it last bound that record to (2C's CP2-mid ask).
      protect.mark(block, { reason: "edit", item: item[record.FIELD.ID] });
      bindBlock(block);
      drawFrame(block);
      if (typeof block.focus === "function") block.focus();
      return sessionInfo();
    }

    function pageField(name) {
      var page = defaultPage || {};
      return page[name] === undefined ? null : page[name];
    }

    function applyEditableAttrs(block) {
      epoch.write("editing.enter", function () {
        Object.keys(EDITABLE_ATTRS).forEach(function (name) {
          block.setAttribute(name, EDITABLE_ATTRS[name]);
        });
      });
    }

    function clearEditableAttrs(block) {
      epoch.write("editing.leave", function () {
        Object.keys(EDITABLE_ATTRS).forEach(function (name) {
          block.removeAttribute(name);
        });
      });
    }

    /**
     * The open block came back as a NEW element and the session has to move
     * onto it. This is the seam 2B's protection asked for: layer three restores
     * the reviewer's words into a node the repaint built, and everything this
     * file holds about the block (the input listener, the editing attributes,
     * the element-to-record memory) is attached to the node that was destroyed.
     * Without this the text on screen is right and the next keystroke goes
     * nowhere: nothing records it, and the reviewer only finds out later.
     *
     * It is NOT a commit and not a re-entry. `before` is untouched, the record
     * is untouched, and edit state stays exactly as open as it was.
     *
     * @param {Element} el the element the block came back as
     * @returns {boolean} true when the session moved
     */
    function rebind(el) {
      if (!session || !el) return false;
      if (session.block === el) return false; // same node, same listeners
      session.block = el;
      applyEditableAttrs(el);
      bindBlock(el);
      remember(el, session.itemId);
      positionFrame();
      return true;
    }

    function sessionInfo() {
      if (!session) return { open: false, itemId: null, blockId: null, before: null };
      return {
        open: true,
        itemId: session.itemId,
        blockId: session.block.id || null,
        before: session.before ? session.before.text : null
      };
    }

    // ------------------------------------------------------------------------
    // Typing
    // ------------------------------------------------------------------------

    var blockHandles = [];

    function bindBlock(block) {
      unbindBlock();
      blockHandles.push(listeners.on(block, "input", onInput, false, LISTENER_GROUP));
      blockHandles.push(listeners.on(block, "compositionstart", onCompositionStart, false, LISTENER_GROUP));
      blockHandles.push(listeners.on(block, "compositionend", onCompositionEnd, false, LISTENER_GROUP));
      // Deliberately NO blur handler. A commit is the reviewer leaving the
      // region, not the framework yanking the node: see rule 2 at the top.
    }

    function unbindBlock() {
      blockHandles.forEach(function (handle) {
        handle.off();
      });
      blockHandles = [];
    }

    function onCompositionStart() {
      if (session) session.composing = true;
    }

    function onCompositionEnd() {
      if (!session) return;
      session.composing = false;
      captureTyping();
    }

    function onInput() {
      // During IME composition the block holds half-composed text. Recording it
      // would ship it as the reviewer's exact wording, so the capture waits for
      // compositionend, which is one event away.
      if (!session || session.composing) return;
      captureTyping();
    }

    // Every keystroke, synchronously, before anything else. The revision does
    // NOT move here: a revision is a committed wording.
    function captureTyping() {
      if (!session) return null;
      var after = capture(session.block);
      var item = store.readItem(requireReview(), session.itemId);
      if (!item) return null;
      var next = Object.assign({}, item);
      next[record.FIELD.AFTER] = after.text;
      next[record.FIELD.AFTER_HTML] = after.html;
      next[record.FIELD.UPDATED_AT] = record.nowIso();
      persist(next, "typed");
      positionFrame();
      return next;
    }

    // ------------------------------------------------------------------------
    // Committing
    // ------------------------------------------------------------------------

    /**
     * Commits the open edit. Idempotent by construction: the session is cleared
     * before anything else happens, so a second call, a blur fired by removing
     * contenteditable, or a stray Escape does nothing.
     *
     * @param {{reason?: string}} [options]
     * @returns {null|Object} the committed record, or null when nothing was open
     */
    function commit(options) {
      if (!session) return null;
      var open = session;
      // FIRST. Removing contenteditable below fires blur, and anything that
      // reads edit state from here on must see it closed.
      session = null;
      var reason = (options || {}).reason || "commit";
      // On the unload path the event is QUEUED and nothing else: the transport
      // at unload is the keepalive post, and onUnload makes it one line below.
      // Asking for an immediate flush here instead would schedule an ordinary
      // fetch that races the document's teardown, which is the one transport
      // protocol.js says not to rely on, and it would hide the body cap by
      // sometimes beating it.
      var immediate = reason === "navigation" ? null : "ready";

      var block = open.block;
      var after = capture(block);

      unbindBlock();
      clearEditableAttrs(block);
      hideFrame();

      // WHY PROTECTION LIFTS LAST, and not here.
      //
      // protect.release runs the commit pass, synchronously and immediately.
      // Releasing before the record is written means that pass reads a DRAFT,
      // and a draft is not outstanding, so replay skips the one record the pass
      // exists for: the reviewer's commit is not compared against the page at
      // all, and a change the page made to the block underneath them is
      // swallowed exactly as if the seam were not wired. Found at CP2-mid, with
      // real records; every earlier test drove protection and replay directly
      // and could not see it. So: write the record, THEN lift protection.
      var item = store.readItem(requireReview(), open.itemId);
      if (!item) {
        protect.release(block);
        return null;
      }

      var verdict = kindFor(open.before, after);
      if (!verdict.changed) {
        // The reviewer opened a block, read it, and left. That is not an edit.
        // A draft record for it is a row in the rail and a line in the agent's
        // queue for a change that does not exist.
        if (open.wasNew) {
          store.remove(requireReview(), open.itemId);
          forget(open.itemId);
          emit(item, "discarded");
        }
        protect.release(block);
        return null;
      }

      // The reviewer's change, stated for the intent channel (D12). An edit
      // carries no typed note, so without this its only intent field is empty
      // and the agent is left reading the data-class `after`/`before`. `before`
      // is pinned at first touch, so this states the change against the page's
      // original wording, whichever session committed it.
      var changeText = record.editChangeText(verdict.kind, open.before ? open.before.text : null, after.text);

      var committed;
      if (record.isDraft(item)) {
        // First commit. The revision stays at one; the history gets its first
        // entry, which is what replay's branch three reads.
        committed = Object.assign({}, item);
        committed[record.FIELD.KIND] = verdict.kind;
        committed[record.FIELD.STATE] = record.STATE.READY;
        committed[record.FIELD.CHANGE] = changeText;
        committed[record.FIELD.AFTER] = after.text;
        committed[record.FIELD.AFTER_HTML] = after.html;
        committed[record.FIELD.UPDATED_AT] = record.nowIso();
        committed[record.FIELD.AFTER_HISTORY] = appendHistory(item, committed);
        record.validateItem(committed);
        persist(committed, "committed", immediate);
      } else {
        // A rewording of something already committed. The revision moves
        // exactly once, here, which is what makes a stale reply naming the old
        // revision refusable (R21).
        committed = record.bumpRev(item, {
          kind: verdict.kind,
          change: changeText,
          after: after.text,
          after_html: after.html,
          state: record.STATE.READY
        });
        record.validateItem(committed);
        persist(committed, "committed", immediate);
      }

      remember(block, committed[record.FIELD.ID]);
      // Protection lifts on the committed record, and lifting it runs the
      // commit pass: a change the page tried to make to this block while it was
      // protected surfaces through replay's neither-matches branch rather than
      // being silently swallowed. 2B calls it, 2C owns that seam, and it is the
      // only pass this commit schedules.
      protect.release(block);
      return committed;
    }

    function appendHistory(item, committed) {
      var history = (item[record.FIELD.AFTER_HISTORY] || []).slice();
      var last = history.length ? history[history.length - 1] : null;
      var value = committed[record.FIELD.AFTER];
      if (typeof value === "string" && (!last || last.after !== value)) {
        history.push(
          record.historyEntry(
            committed[record.FIELD.REV],
            value,
            committed[record.FIELD.AFTER_HTML],
            committed[record.FIELD.UPDATED_AT]
          )
        );
      }
      return history;
    }

    // ------------------------------------------------------------------------
    // Deleting a block (R27)
    // ------------------------------------------------------------------------

    /**
     * Deletes a block as its own record kind, so it reads as a deletion rather
     * than as an edit to nothing.
     *
     * @param {Element} block
     * @returns {null|Object} the record
     */
    function deleteBlock(block) {
      var el = block || (session ? session.block : null);
      if (!el || !el.parentNode) return null;

      var existing = itemFor(el);
      var before = existing
        ? { text: existing[record.FIELD.BEFORE], html: existing[record.FIELD.BEFORE_HTML] }
        : capture(el);

      if (session && session.block === el) {
        // Leaving edit state without committing an edit record: the deletion IS
        // the record.
        var open = session;
        session = null;
        unbindBlock();
        clearEditableAttrs(el);
        protect.release(el);
        hideFrame();
        if (open.wasNew && existing && record.isDraft(existing)) {
          store.remove(requireReview(), open.itemId);
          forget(open.itemId);
          existing = null;
        }
      }

      // A deletion is a change with no typed note, so it carries the same
      // stated intent field an edit does (D12).
      var deleteChange = record.editChangeText(record.KIND.DELETE, before.text, null);

      var item;
      if (existing) {
        item = record.bumpRev(existing, {
          kind: record.KIND.DELETE,
          change: deleteChange,
          after: null,
          after_html: null,
          state: record.STATE.READY
        });
      } else {
        item = record.newItem({
          kind: record.KIND.DELETE,
          state: record.STATE.READY,
          change: deleteChange,
          before: before.text,
          before_html: before.html,
          page_origin: pageField("origin"),
          page_path: pageField("path"),
          page_title: pageField("title"),
          page_seq: pageField("seq"),
          source_hint: pageField("source_hint"),
          region: regionFor(el),
          context: contextFor(el)
        });
      }

      // Where it was, so undo puts it back where it came from. The node itself
      // is kept as well as its markup: re-inserting the same node is the only
      // version that survives a page whose CSS keys off element identity.
      deleted[item[record.FIELD.ID]] = {
        node: el,
        parent: el.parentNode,
        next: el.nextSibling,
        html: before.html,
        tag: el.tagName
      };

      epoch.write("editing.delete", function () {
        el.parentNode.removeChild(el);
      });

      record.validateItem(item);
      persist(item, "deleted", "ready");
      scheduleReplay("commit");
      return item;
    }

    // ------------------------------------------------------------------------
    // Formatting (R24, R31)
    // ------------------------------------------------------------------------

    /**
     * Applies one formatting command inside a write epoch. The wrapper is not
     * optional: execCommand mutates the DOM, and an unwrapped mutation
     * schedules a replay pass that then sees its own change.
     *
     * @param {string} command one of COMMANDS
     * @returns {Object} {command, applied}
     */
    function format(command, value) {
      if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
        throw new Error("editing.format: " + String(command) + " is not one of the commands R24 allows");
      }
      if (!doc || typeof doc.execCommand !== "function") {
        return { command: command, applied: false, reason: "no execCommand in this environment" };
      }
      bootCommands();
      var applied = epoch.write("editing.format:" + command, function () {
        return doc.execCommand(command, false, value === undefined ? null : value);
      });
      // A formatting change is a change, so it is captured the same way a
      // keystroke is: the record's markup moves, its text does not, and the
      // commit reads that as kind format_only.
      captureTyping();
      return { command: command, applied: applied === true };
    }

    // ------------------------------------------------------------------------
    // Per-record undo (R28)
    // ------------------------------------------------------------------------

    /**
     * Reverts ONE record's region to its `before` and retires the record.
     * Touches nothing else: not the page outside that region, and not any other
     * record.
     *
     * @param {string} itemId
     * @returns {{reverted: boolean, kind: (string|null), reason: (string|null)}}
     */
    function undo(itemId) {
      var item = store.readItem(requireReview(), itemId);
      if (!item) return { reverted: false, kind: null, reason: "no record " + String(itemId) };

      if (session && session.itemId === itemId) {
        // Undoing the record the reviewer is inside. Edit state goes first, and
        // it goes without committing: the undo is the decision.
        var open = session;
        session = null;
        unbindBlock();
        clearEditableAttrs(open.block);
        protect.release(open.block);
        hideFrame();
      }

      var kind = item[record.FIELD.KIND];
      var restored;

      if (kind === record.KIND.DELETE) {
        restored = restoreDeleted(item);
      } else {
        restored = restoreRegion(item);
      }
      if (!restored.element) {
        // Fail loud rather than retiring a record whose region was never put
        // back: a silent success here means the reviewer's page and the agent's
        // instructions disagree and nothing says so.
        return { reverted: false, kind: kind, reason: restored.reason };
      }

      store.remove(requireReview(), itemId);
      forget(itemId);
      delete deleted[itemId];
      selection.placeCaretAtStart(restored.element);
      emit(item, "undone");
      scheduleReplay("undo");
      return { reverted: true, kind: kind, reason: null };
    }

    /**
     * Drop ONE record and leave the page exactly as it is.
     *
     * The seam undo ends with, minus the write. It exists for one caller: the
     * conflict card's "take the page's", where the reviewer is accepting what
     * the page already says. Reverting to `before` there would be wrong twice
     * over, because `before` is neither version in the collision.
     *
     * @param {string} itemId
     * @returns {{retired: boolean, kind: (string|null), reason: (string|null)}}
     */
    function retire(itemId) {
      var item = store.readItem(requireReview(), itemId);
      if (!item) return { retired: false, kind: null, reason: "no record " + String(itemId) };

      if (session && session.itemId === itemId) {
        // Retiring the record the reviewer is inside. Edit state goes first, and
        // it goes without committing: retiring is the decision.
        var open = session;
        session = null;
        unbindBlock();
        clearEditableAttrs(open.block);
        protect.release(open.block);
        hideFrame();
      }

      store.remove(requireReview(), itemId);
      forget(itemId);
      delete deleted[itemId];
      emit(item, "undone");
      scheduleReplay("undo");
      return { retired: true, kind: item[record.FIELD.KIND], reason: null };
    }

    function restoreRegion(item) {
      var el = elementFor(item);
      if (!el) return { element: null, reason: "the region this record points at is not on the page" };
      var beforeHtml = item[record.FIELD.BEFORE_HTML];
      var beforeText = item[record.FIELD.BEFORE];
      epoch.write("editing.undo", function () {
        if (typeof beforeHtml === "string") el.innerHTML = beforeHtml;
        else el.textContent = String(beforeText || "");
      });
      return { element: el, reason: null };
    }

    function restoreDeleted(item) {
      var where = deleted[item[record.FIELD.ID]];
      if (!where) return { element: null, reason: "nothing is remembered about where this block was" };
      if (!where.parent || !where.parent.isConnected) {
        return { element: null, reason: "the container this block lived in is gone from the page" };
      }
      var node = where.node;
      if (!node) {
        node = doc.createElement(where.tag || "p");
        node.innerHTML = String(where.html || "");
      }
      epoch.write("editing.undo_delete", function () {
        if (where.next && where.next.parentNode === where.parent) where.parent.insertBefore(node, where.next);
        else where.parent.appendChild(node);
      });
      return { element: node, reason: null };
    }

    // ------------------------------------------------------------------------
    // Which record belongs to which block
    // ------------------------------------------------------------------------

    function remember(el, id) {
      forget(id);
      itemForElement.push({ el: el, id: id });
    }

    function forget(id) {
      itemForElement = itemForElement.filter(function (row) {
        return row.id !== id;
      });
    }

    /**
     * The outstanding record for this block, if it has one. The live map is
     * asked first because it is exact and free; the anchor is asked second
     * because it is the durable answer and survives a repaint.
     */
    function itemFor(el) {
      if (!el || !reviewId) return null;
      var i;
      for (i = 0; i < itemForElement.length; i += 1) {
        if (itemForElement[i].el === el) {
          var got = store.readItem(reviewId, itemForElement[i].id);
          if (got && got[record.FIELD.STATE] !== record.STATE.HANDLED) return got;
        }
      }
      var items = store.read(reviewId);
      for (i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (!isEditKind(item)) continue;
        if (item[record.FIELD.STATE] === record.STATE.HANDLED) continue;
        if (elementFor(item) === el) return item;
      }
      return null;
    }

    function isEditKind(item) {
      var kind = item[record.FIELD.KIND];
      return kind === record.KIND.EDIT || kind === record.KIND.FORMAT_ONLY || kind === record.KIND.DELETE;
    }

    function elementFor(item) {
      var region = item[record.FIELD.REGION];
      if (!region || !region.ref || !doc) return null;
      var verdict = anchor.resolve(region.ref, doc);
      return verdict && verdict.bound ? verdict.element : null;
    }

    function regionFor(element) {
      var region = record.emptyRegion();
      if (!element) return region;
      var range = null;
      if (doc && doc.createRange) {
        range = doc.createRange();
        range.selectNodeContents(element);
      }
      region.ref = anchor.mint({ element: element, range: range, root: doc });
      try {
        regions.pinLabel(region, descriptorFor(element));
      } catch (err) {
        // A label is a display convenience. A region with a reference and no
        // label is still a usable record.
        region.label = null;
      }
      return region;
    }

    function descriptorFor(element) {
      var ordinal = 1;
      var sibling = element.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === element.tagName) ordinal += 1;
        sibling = sibling.previousElementSibling;
      }
      return {
        authorName: element.getAttribute ? element.getAttribute(regions.AUTHOR_ATTR) : null,
        id: element.id || null,
        ariaLabel: element.getAttribute ? element.getAttribute("aria-label") : null,
        heading: headingTextFor(element),
        ordinal: ordinal,
        tag: String(element.tagName || "").toLowerCase(),
        text: element.textContent || null
      };
    }

    function headingTextFor(element) {
      if (!element) return null;
      var el = element.previousElementSibling;
      while (el) {
        if (/^H[1-6]$/.test(el.tagName)) return normalize.normalizeText(el.textContent || "");
        el = el.previousElementSibling;
      }
      var parent = element.parentElement;
      return parent && doc && parent !== doc.body ? headingTextFor(parent) : null;
    }

    function contextFor(element) {
      var context = record.emptyContext();
      if (!element) return context;
      context.element = element.tagName;
      context.heading = headingTextFor(element);
      return context;
    }

    // ------------------------------------------------------------------------
    // The frame: drawn over the page, never on it
    // ------------------------------------------------------------------------

    function surface() {
      if (!doc || !highlights) return null;
      var got = highlights.surface();
      highlights.addSurfaceStyle("editing", FRAME_STYLE);
      return got.root || got.host;
    }

    function drawFrame(block) {
      var host = surface();
      if (!host) return null;
      if (!frameNode) {
        frameNode = doc.createElement("div");
        frameNode.className = FRAME_CLASS;
        markers.markChrome(frameNode);
        host.appendChild(frameNode);
      }
      if (!barNode) {
        barNode = buildBar();
        host.appendChild(barNode);
      }
      frameNode.style.display = "block";
      barNode.style.display = "flex";
      positionFrame();
      watchFrame();
      void block;
      return frameNode;
    }

    function buildBar() {
      var bar = doc.createElement("div");
      bar.className = BAR_CLASS;
      markers.markChrome(bar);

      var label = doc.createElement("span");
      label.className = "lahe-edit-bar__label";
      label.textContent = LABEL_EDITING;
      bar.appendChild(label);

      bar.appendChild(separator());

      Object.keys(COMMANDS).forEach(function (command) {
        var button = doc.createElement("button");
        button.type = "button";
        button.className = "lahe-edit-bar__btn";
        button.setAttribute("data-lahe-command", command);
        button.textContent = command === "bold" ? "B" : "I";
        button.setAttribute("aria-label", command === "bold" ? "Bold" : "Italic");
        button.addEventListener("click", function () {
          format(command);
        });
        bar.appendChild(button);
      });

      var remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "lahe-edit-bar__btn";
      remove.setAttribute("data-lahe-command", "delete");
      remove.textContent = "Delete block";
      remove.addEventListener("click", function () {
        deleteBlock(null);
      });
      bar.appendChild(remove);

      bar.appendChild(separator());

      var hint = doc.createElement("span");
      hint.className = "lahe-edit-bar__hint";
      hint.textContent = HINT_FINISH;
      bar.appendChild(hint);

      // Pressing a button must not take focus out of the block: the caret is
      // what execCommand applies to, and a bar that stole it would format
      // nothing and look broken.
      bar.addEventListener("mousedown", function (event) {
        event.preventDefault();
      });
      return bar;
    }

    function separator() {
      var sep = doc.createElement("span");
      sep.className = "lahe-edit-bar__sep";
      return sep;
    }

    function positionFrame() {
      if (!frameNode || !session || !win) return null;
      var rect = session.block.getBoundingClientRect();
      var pad = 6;
      frameNode.style.top = rect.top - pad + "px";
      frameNode.style.left = rect.left - pad + "px";
      frameNode.style.width = rect.width + pad * 2 + "px";
      frameNode.style.height = rect.height + pad * 2 + "px";

      if (barNode) {
        // The bar sits above the block, pinned by its BOTTOM edge, so its own
        // height never enters the calculation. Measuring the height instead
        // reads zero on the first frame in some engines, which puts the bar in
        // one place and then moves it a frame later: the reviewer sees it jump,
        // and anything aiming at a button can miss it.
        var viewport = win.innerHeight || 768;
        var roomAbove = rect.top - pad - 8;
        barNode.style.left = Math.round(Math.max(8, rect.left - pad)) + "px";
        if (roomAbove >= 44) {
          barNode.style.bottom = Math.round(viewport - roomAbove) + "px";
          barNode.style.top = "auto";
        } else {
          barNode.style.top = Math.round(rect.bottom + pad + 8) + "px";
          barNode.style.bottom = "auto";
        }
      }
      return frameNode;
    }

    function watchFrame() {
      if (frameRaf || !win) return;
      var tick = function () {
        if (!session) {
          frameRaf = null;
          return;
        }
        positionFrame();
        frameRaf = win.requestAnimationFrame ? win.requestAnimationFrame(tick) : null;
      };
      frameRaf = win.requestAnimationFrame ? win.requestAnimationFrame(tick) : null;
    }

    function hideFrame() {
      if (frameNode) frameNode.style.display = "none";
      if (barNode) barNode.style.display = "none";
      if (frameRaf && win && win.cancelAnimationFrame) win.cancelAnimationFrame(frameRaf);
      frameRaf = null;
      return true;
    }

    function frameRect() {
      if (!frameNode || frameNode.style.display === "none") return null;
      var r = frameNode.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    function frameLabel() {
      if (!barNode || barNode.style.display === "none") return null;
      return barNode.textContent;
    }

    function buttonNode(name) {
      if (!barNode) return null;
      return barNode.querySelector('[data-lahe-command="' + String(name) + '"]');
    }

    // ------------------------------------------------------------------------
    // Replay
    // ------------------------------------------------------------------------

    function scheduleReplay(reason) {
      var replay = typeof replayRef === "function" ? replayRef() : replayRef;
      if (!replay || typeof replay.schedule !== "function") return false;
      // After the write epoch closes, which is a microtask away: a pass
      // scheduled while the epoch is open is swallowed by design.
      var run = function () {
        replay.schedule(reason);
      };
      if (typeof queueMicrotask === "function") queueMicrotask(run);
      else Promise.resolve().then(run);
      return true;
    }

    // ------------------------------------------------------------------------
    // Wiring the gestures
    // ------------------------------------------------------------------------
    //
    // Every decision comes from the pure table in shared/gestures.js. This
    // function's only job is to describe the world to it and then do what it
    // says.

    function bind(input) {
      var src = input || {};
      var target = src.document || doc;
      if (!target) return { bound: false, reason: "no document" };
      if (src.page) setPage(src.page);
      unbind();

      listenerHandles.push(listeners.on(target, "keydown", onKeydown, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "click", onClick, true, LISTENER_GROUP));
      // Pointerdown, in capture, so a click that lands on the rail (or on
      // anything that stops the click from propagating) still commits the open
      // edit. mousedown as well, because a synthetic click in a test and an
      // engine without pointer events both still produce one; commit() is
      // idempotent, so the pair costs nothing.
      listenerHandles.push(listeners.on(target, "pointerdown", onPointerDown, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "mousedown", onPointerDown, true, LISTENER_GROUP));

      if (win) {
        // The window losing focus is the reviewer leaving too.
        listenerHandles.push(listeners.on(win, "blur", onWindowBlur, false, LISTENER_GROUP));
      }

      if (win) {
        // Navigation cannot be a losing move (R1). Both events are bound
        // because engines disagree about which one fires on which navigation,
        // and commit() is idempotent so the second one is free.
        listenerHandles.push(listeners.on(win, "pagehide", onUnload, false, LISTENER_GROUP));
        listenerHandles.push(listeners.on(win, "beforeunload", onUnload, false, LISTENER_GROUP));
      }
      // A remount de-registers this whole group before it calls back in here,
      // and the open block's own input handlers are in that group. Without this
      // line the reviewer's block is still contenteditable and still on screen
      // after a morph, and every keystroke into it is recorded nowhere.
      if (session && session.block) bindBlock(session.block);
      return { bound: true, listeners: listenerHandles.length };
    }

    function unbind() {
      listenerHandles.forEach(function (handle) {
        handle.off();
      });
      listenerHandles = [];
    }

    function describe(event) {
      return {
        type: event.type,
        key: event.key,
        metaKey: event.metaKey === true,
        ctrlKey: event.ctrlKey === true,
        shiftKey: event.shiftKey === true,
        hasSelection: selection.hasSelection(),
        inOverlay: markers.isInsideOverlay(event.target),
        pickMode: false,
        editing: !!session,
        inEditedBlock: !!session && !!event.target && (session.block === event.target || session.block.contains(event.target))
      };
    }

    function onKeydown(event) {
      if (markers.isInsideOverlay(event.target)) return;
      var got = gestures.gestureFor(describe(event));
      if (got.gesture === gestures.GESTURE.EDIT_BLOCK) {
        if (got.preventDefault) event.preventDefault();
        editBlockAtCaret();
      } else if (got.gesture === gestures.GESTURE.COMMIT_EDIT) {
        if (got.preventDefault) event.preventDefault();
        commit({ reason: "escape" });
      }
    }

    /**
     * The pointer went down somewhere. If an edit is open and this is outside
     * it, that is the reviewer leaving the block, so it commits.
     *
     * DELIBERATELY NOT SKIPPED FOR THE OVERLAY. onClick below returns early on
     * anything inside the library's own rail, and a click on the rail retargets
     * to the overlay host, so an edit the reviewer finished by clicking the rail
     * stayed in `draft` forever. A draft never passes protocol.countsAsNew, so
     * no agent ever saw it and the reviewer had no way to tell (Ken's session,
     * 2026-08-16). Nothing is prevented and nothing is stopped here: the rail
     * and the page both still get their event.
     *
     * This is not the blur hazard rule 3 warns about. That hazard is the ELEMENT
     * blur that firing when contenteditable comes off would commit a second
     * time; commit() clears the session before it touches the DOM, so a second
     * call is a no-op, and this handler never runs while no session is open.
     */
    function onPointerDown(event) {
      if (!session) return;
      var got = gestures.gestureFor(describe(event));
      if (got.gesture !== gestures.GESTURE.COMMIT_EDIT) return;
      commit({ reason: "pointer outside" });
    }

    /**
     * The whole window lost focus: another window, another tab, the desktop.
     *
     * The reviewer has left the block by any reading, and leaving an edit open
     * across a tab switch is how one comes back to a page whose edit never
     * reached the agent. Guarded to the window's own blur: element blur does not
     * bubble, but a stray retarget must not be read as the reviewer leaving.
     */
    function onWindowBlur(event) {
      if (!session) return;
      if (event && event.target && win && event.target !== win && event.target !== doc) return;
      commit({ reason: "window blur" });
    }

    function onClick(event) {
      if (markers.isInsideOverlay(event.target)) return;
      var got = gestures.gestureFor(describe(event));
      if (got.gesture !== gestures.GESTURE.COMMIT_EDIT) return;
      // The click still reaches the page. Browse is native, so clicking a link
      // while an edit is open both commits the edit and follows the link.
      commit({ reason: "click outside" });
    }

    function onUnload() {
      var committed = commit({ reason: "navigation" });
      // The record and its event are already durable in browser storage by the
      // time this line runs. The post is an attempt, not the guarantee: a body
      // over the keepalive cap, or an engine that drops the request, costs
      // latency and never the edit, because the next page load re-posts
      // anything the helper never acknowledged.
      if (sync && typeof sync.commitOnUnload === "function") sync.commitOnUnload();
      return committed;
    }

    function teardown() {
      unbind();
      unbindBlock();
      if (session) {
        clearEditableAttrs(session.block);
        protect.release(session.block);
        session = null;
      }
      hideFrame();
      if (frameNode && frameNode.parentNode) frameNode.parentNode.removeChild(frameNode);
      if (barNode && barNode.parentNode) barNode.parentNode.removeChild(barNode);
      frameNode = null;
      barNode = null;
      return true;
    }

    return {
      FRAME_CLASS: FRAME_CLASS,
      BAR_CLASS: BAR_CLASS,
      LABEL_EDITING: LABEL_EDITING,
      HINT_FINISH: HINT_FINISH,
      EDITABLE_ATTRS: EDITABLE_ATTRS,
      COMMANDS: COMMANDS,
      setReview: setReview,
      setPage: setPage,
      onChange: onChange,
      bind: bind,
      unbind: unbind,
      rebind: rebind,
      teardown: teardown,
      editBlock: editBlock,
      editBlockAtCaret: editBlockAtCaret,
      commit: commit,
      deleteBlock: deleteBlock,
      format: format,
      undo: undo,
      retire: retire,
      capture: capture,
      itemFor: itemFor,
      elementFor: elementFor,
      isEditing: function () {
        return !!session;
      },
      state: sessionInfo,
      frameRect: frameRect,
      frameLabel: frameLabel,
      buttonNode: buttonNode,
      items: function () {
        return store.read(requireReview());
      }
    };
  }

  return {
    FORMATTING_MECHANISM: FORMATTING_MECHANISM,
    FRAME_CLASS: FRAME_CLASS,
    BAR_CLASS: BAR_CLASS,
    FRAME_STYLE: FRAME_STYLE,
    COMMANDS: COMMANDS,
    BOOT_COMMANDS: BOOT_COMMANDS,
    EDITABLE_ATTRS: EDITABLE_ATTRS,
    LABEL_EDITING: LABEL_EDITING,
    HINT_FINISH: HINT_FINISH,
    TOOL_ATTR: markers.TOOL_ATTR,
    capture: capture,
    kindFor: kindFor,
    createEditing: createEditing
  };
});
