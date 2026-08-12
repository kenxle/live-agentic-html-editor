// Comment boxes, element-pick mode, and the untethered note.
//
// Owner: 1D. 0A-kernel ships A MINIMAL REAL COMMENT BOX here, not a stub,
// because 1B (library shell) and 1D (comments) each need a scoreable done bar
// in their own worktree instead of each stubbing the other's half and both
// passing. 1B can type into this box and assert twenty repaints leave the node
// identity and activeElement alone; 1D replaces it with the real surface.
//
// What is real here: a focused text box, a draft record written to the store
// SYNCHRONOUSLY ON EVERY KEYSTROKE, Cmd-Enter marking it ready, Esc closing it
// with the draft kept, and rewording bumping the revision.
//
// What 1D still owns: element-pick mode's hover outlining, the untethered note
// at the foot of the thread, the highlight painting (that is highlight.js), the
// shadow-root styling, and the draft nudge.
//
// Two rules this box already obeys, because they are the ones a rewrite loses:
//
//  1. THE BOX IS NEVER RE-CREATED WHILE IT HOLDS FOCUS. open() on an id that is
//     already open returns the same node.
//  2. NOTHING THE LIBRARY ADDS EVER REACHES A RECORD. The box is marked as the
//     library's own chrome, so the normalizer strips it out of any markup a
//     record carries (R23).
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.comments = factory(root.LAHE.markers, root.LAHE.record, root.LAHE.store, root.LAHE.gestures);
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/record.js"),
      require("./store.js"),
      require("../shared/gestures.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, record, storeModule, gestures) {
  "use strict";

  var BOX_CLASS = "lahe-comment-box";
  var INPUT_CLASS = "lahe-comment-input";

  function createComments(options) {
    var opts = options || {};
    var store = opts.store || storeModule.shared;
    var reviewId = opts.reviewId || null;
    var doc = opts.document || (typeof document !== "undefined" ? document : null);

    // id -> {item, node, input}
    var open = Object.create(null);
    var listeners = [];

    function requireReview() {
      if (!reviewId) throw new Error("comments: a reviewId is required before a comment can be stored");
      return reviewId;
    }

    function setReview(id) {
      reviewId = id;
      return reviewId;
    }

    function onChange(fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (f) {
          return f !== fn;
        });
      };
    }

    function emit(item) {
      for (var i = 0; i < listeners.length; i += 1) listeners[i](item);
    }

    // The one write path. Synchronous to storage before anything else happens,
    // which is the rule the whole design rests on.
    function persist(item) {
      store.write(requireReview(), item);
      emit(item);
      return item;
    }

    /**
     * Opens a comment box.
     *
     * @param {Object} input
     *   page      {origin, path, title, seq, source_hint} from record.pageFrom
     *   quote     the passage the reviewer selected, or null for a note
     *   kind      record.KIND.COMMENT (default) or record.KIND.NOTE
     *   region    the anchor reference, when 1C has minted one
     *   host      the element to append the box to (default document.body)
     * @returns {Object} {item, node, input, focus, type, markReady, close}
     */
    function openBox(input) {
      var src = input || {};
      var page = src.page || {};
      var kind = src.kind || record.KIND.COMMENT;

      var item = record.newItem({
        kind: kind,
        state: record.STATE.DRAFT,
        note: "",
        page_origin: page.origin,
        page_path: page.path,
        page_title: page.title,
        page_seq: page.seq,
        source_hint: page.source_hint,
        region: src.region || record.emptyRegion(),
        context: src.quote ? Object.assign(record.emptyContext(), { quote: src.quote }) : record.emptyContext()
      });

      // A draft exists the moment the box does. An empty box that the reviewer
      // abandons is a draft they can come back to, which costs nothing, and a
      // box whose first keystroke is the first durable thing is a box that can
      // lose that keystroke.
      persist(item);

      var handle = buildHandle(item, src.host || null);
      open[item[record.FIELD.ID]] = handle;
      return handle;
    }

    function buildHandle(item, host) {
      var id = item[record.FIELD.ID];
      var node = null;
      var inputEl = null;

      if (doc) {
        node = doc.createElement("div");
        node.className = BOX_CLASS;
        // Marked as the library's own chrome, so nothing here can reach a
        // record's markup (R23).
        markers.markChrome(node);
        node.setAttribute("data-lahe-item", id);

        inputEl = doc.createElement("textarea");
        inputEl.className = INPUT_CLASS;
        inputEl.setAttribute("spellcheck", "false");
        node.appendChild(inputEl);

        inputEl.addEventListener("input", function () {
          type(inputEl.value);
        });
        inputEl.addEventListener("keydown", function (event) {
          var got = gestures.gestureFor({
            type: "keydown",
            key: event.key,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            inCommentBox: true
          });
          if (got.gesture === gestures.GESTURE.MARK_READY) {
            if (got.preventDefault) event.preventDefault();
            markReady();
          } else if (got.gesture === gestures.GESTURE.CANCEL) {
            if (got.preventDefault) event.preventDefault();
            close();
          }
        });

        (host || doc.body).appendChild(node);
      }

      // Every keystroke. Synchronous, before anything else.
      function type(text) {
        var current = handleItem();
        // A draft does not bump rev: drafts flow to the helper and the log
        // legitimately holds many events at one revision (0A-wire's
        // idempotence rule is by event id, never by item and rev).
        var next = Object.assign({}, current);
        next[record.FIELD.NOTE] = String(text);
        next[record.FIELD.UPDATED_AT] = record.nowIso();
        if (!record.isDraft(next)) {
          // Rewording something already ready bumps the revision, which is what
          // makes a stale reply naming the old revision refusable (R21).
          next = record.bumpRev(current, { note: String(text) });
        }
        store.write(requireReview(), next);
        emit(next);
        return next;
      }

      function markReady() {
        var current = handleItem();
        var next = Object.assign({}, current);
        next[record.FIELD.STATE] = record.STATE.READY;
        next[record.FIELD.UPDATED_AT] = record.nowIso();
        record.validateItem(next);
        store.write(requireReview(), next);
        emit(next);
        return next;
      }

      function close() {
        // The draft is kept. Closing a box is not discarding work; only the
        // reviewer's own delete removes an item.
        if (node && node.parentNode) node.parentNode.removeChild(node);
        delete open[id];
        return handleItem();
      }

      function focus() {
        if (inputEl && typeof inputEl.focus === "function") inputEl.focus();
        return inputEl;
      }

      function handleItem() {
        return store.readItem(requireReview(), id) || item;
      }

      return {
        id: id,
        get item() {
          return handleItem();
        },
        node: node,
        input: inputEl,
        focus: focus,
        type: type,
        markReady: markReady,
        close: close
      };
    }

    function openBoxes() {
      return Object.keys(open).map(function (id) {
        return open[id];
      });
    }

    // Reopening an id that is already open returns the SAME node. A box that
    // holds focus is never re-created.
    function boxFor(id) {
      return open[id] || null;
    }

    // STUB: 1D owns element-pick mode's hover outlining and Esc handling. The
    // entry point is here so the gesture table has somewhere to land.
    function enterPickMode() {
      return { active: false, isStub: true };
    }

    return {
      BOX_CLASS: BOX_CLASS,
      INPUT_CLASS: INPUT_CLASS,
      setReview: setReview,
      onChange: onChange,
      openBox: openBox,
      boxFor: boxFor,
      openBoxes: openBoxes,
      enterPickMode: enterPickMode
    };
  }

  return {
    BOX_CLASS: BOX_CLASS,
    INPUT_CLASS: INPUT_CLASS,
    createComments: createComments
  };
});
