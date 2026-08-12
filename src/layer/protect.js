// The protection API: mark, veto, snapshot, restore, release.
//
// Owner: 2B. D7's first half, and it ships with ALL THREE LAYERS or not at all.
// The archived round-two review proved restore-after alone cannot save the
// caret: a repaint destroys the text node the selection lives in before any
// observer fires, so by the time a restore runs there is nothing to restore to.
//
//   LAYER 1, cooperative skip. The block carries the attributes morphing
//   libraries honor (Turbo's data-turbo-permanent, and the equivalents the two
//   fixture engines honor), so a cooperative framework leaves it alone.
//
//   LAYER 2, the pre-morph veto. Where the framework offers a cancelable event
//   before it replaces an element (Turbo's turbo:before-morph-element, and the
//   fixtures' equivalents), the library cancels it for the protected block.
//
//   LAYER 3, snapshot and restore. The framework-free fallback for a repaint
//   that honors neither: the selection is snapshotted region-relative, and a
//   document-level mutation observer puts the block, its editing surface and the
//   caret back afterwards.
//
// Layers 1 and 2 are TWO DIFFERENT FRAMEWORK FEATURES. A builder can implement
// one and believe they did both, which is why they are named separately, counted
// separately, installable separately, and tested separately
// (test/browser/protection_layers.spec.js runs ranked test 1 three times, once
// per layer, in both fixture flavors).
//
// ---------------------------------------------------------------------------
// Three things that were found the hard way, and are now structural
// ---------------------------------------------------------------------------
//
// 1. THE VETO CHECKS BOTH DIRECTIONS. `isProtected(el)` answers "is el the
//    protected block, or inside it". A frame-level morph fires the pre-morph
//    event on an element that CONTAINS the block, so a veto written against
//    isProtected alone never fires on that flavor and layer two silently does
//    nothing. `touches()` is the predicate the veto uses: the event target is
//    the block, is inside it, or contains it.
//
// 2. LAYER THREE HOLDS NO NODE REFERENCE AND OBSERVES NO REGION. A no-hook
//    repaint replaces the frame's innerHTML, so the region ELEMENT is destroyed,
//    not just its children. A snapshot keyed by element and an observer attached
//    to the region both die on the first repaint and silently stop restoring. So
//    snapshots are keyed by region identity (an attribute the page itself
//    carries) and one observer watches the document.
//
// 3. A RESTORE RE-ESTABLISHES THE EDITING SURFACE. The block comes back from the
//    repaint as ordinary page markup: not editable, not focused, not marked. A
//    restore that only puts the text back leaves the block dead to the keyboard,
//    so every keystroke after the first goes nowhere, the snapshot goes stale,
//    and every later repaint restores the same one sentence. The attributes the
//    block carried when it was marked are part of the snapshot, and the
//    `onRestore` callback is the seam 2A and 2D re-bind through.
//
// The snapshot is REGION-RELATIVE, never node-relative: a repaint destroys the
// text node, so a node reference restores nothing.
//
// Layer three gets its own assertion in the harness, not the node-identity one.
// It restores text after the repaint destroyed the node it lived in, so the
// caret is in a NEW node by construction and the node-identity assertion would
// fail for every correct implementation. What layer three's assertion checks
// instead: the text reads as expected, the caret sits at the same character
// offset inside the node now holding those characters, no characters were lost,
// and `counters.restores` incremented.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    // Replay is resolved LAZILY. The bundle concatenates protect.js before
    // replay.js (src/shared/manifest.js), so reading root.LAHE.replay at factory
    // time would capture undefined forever.
    root.LAHE.protect = factory(root.LAHE.markers, root.LAHE.selection, root.LAHE.epoch, function () {
      return root.LAHE.replay;
    });
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("./selection.js"),
      require("../shared/epoch.js"),
      function () {
        return require("./replay.js");
      }
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, selection, epoch, replayModule) {
  "use strict";

  var LAYER = {
    COOPERATIVE_SKIP: "cooperative_skip",
    VETO: "veto",
    SNAPSHOT_RESTORE: "snapshot_restore"
  };
  var LAYERS = [LAYER.COOPERATIVE_SKIP, LAYER.VETO, LAYER.SNAPSHOT_RESTORE];

  // -------------------------------------------------------------------------
  // The framework vocabulary, in ONE place
  // -------------------------------------------------------------------------
  //
  // Every attribute layer one writes and every event layer two listens for is
  // in this table and nowhere else. Scattering the spellings is how a library
  // ends up marking a block with an attribute the page's framework has never
  // heard of while listening for an event it never fires.
  //
  // The library does not try to work out which framework the page is running.
  // It cannot do that reliably, and guessing wrong costs the reviewer their
  // caret, so it marks with every known skip attribute (an attribute a
  // framework does not know is inert to it) and listens for every known
  // pre-morph event. `detect()` exists for diagnostics, not for deciding.
  var FRAMEWORKS = [
    {
      name: "turbo",
      skipAttribute: markers.TURBO_PERMANENT_ATTR,
      beforeMorphEvent: "turbo:before-morph-element",
      present: function (win) {
        return !!(win && win.Turbo);
      }
    },
    {
      name: "harness_repaint_engine",
      skipAttribute: "data-lahe-permanent",
      beforeMorphEvent: "lahe:before-morph-element",
      present: function (win) {
        return !!(win && win.__lahe && win.__lahe.fixture);
      }
    },
    {
      name: "app_fixture_morph_engine",
      skipAttribute: "data-app-permanent",
      beforeMorphEvent: "app:before-morph-element",
      present: function (win) {
        return !!(win && win.__app && win.__app.morph);
      }
    }
  ];

  function unique(list) {
    var out = [];
    list.forEach(function (value) {
      if (value && out.indexOf(value) === -1) out.push(value);
    });
    return out;
  }

  var SKIP_ATTRIBUTES = unique(
    FRAMEWORKS.map(function (f) {
      return f.skipAttribute;
    })
  );
  var BEFORE_MORPH_EVENTS = unique(
    FRAMEWORKS.map(function (f) {
      return f.beforeMorphEvent;
    })
  );

  // The library's own marker, so the veto and replay can tell a block the tool
  // is holding from one the page author marked permanent for their own reasons.
  var PROTECTED_ATTRIBUTE = markers.PROTECTED_ATTR;

  // Region identity for layer three, in preference order: the author's own
  // region attribute, the harness and app fixtures' region attribute, then the
  // id. All three are attributes the page's own markup carries, so they come
  // back when the repaint rebuilds the block from the server's HTML. A minted
  // attribute would not.
  var MINTED_REGION_ATTRIBUTE = "data-lahe-region";
  var REGION_KEY_ATTRIBUTES = [markers.AUTHOR_REGION_ATTR, "data-region", "id"];

  // The attributes that make a block the reviewer's editing surface. They are
  // saved at mark time and re-applied on restore, because the block comes back
  // from a no-hook repaint as ordinary page markup.
  var SURFACE_ATTRIBUTES = [
    "contenteditable",
    "spellcheck",
    "autocorrect",
    "autocapitalize",
    "tabindex",
    "role"
  ];

  // The counters the harness reads. Public and stable from Phase 0, because
  // ranked test 1 asserts them and a paused implementation would otherwise pass
  // every assertion in it. Do not add to this set without adding it to the stub
  // as well: test/unit/harness_stub_vocabulary.test.js pins the two together.
  var counters = {
    marked: 0, // layer 1: blocks marked for cooperative skip
    vetoes: 0, // layer 2: morphs cancelled before they happened
    snapshots: 0, // layer 3: selections snapshotted
    restores: 0, // layer 3: selections restored after a repaint
    restoreFailures: 0 // layer 3 ran and could not put the caret back
  };

  function resetCounters() {
    Object.keys(counters).forEach(function (k) {
      counters[k] = 0;
    });
  }

  // Which element is protected right now, and the snapshot taken when it was.
  // One at a time: edit state is per region (D3), so a second mark releases the
  // first rather than nesting.
  var active = null;

  // Keyed by region identity, never by element. See finding 2 in the header.
  var snapshots = Object.create(null);

  // Set while a restore is writing, so the observer does not read its own work
  // as fresh damage.
  var restoring = false;

  // What install() put in place. Null when nothing is installed.
  var installation = null;

  // The last thing that stopped a restore, for a failure message that names
  // something rather than reporting a silent zero.
  var lastFailure = null;

  function enabled(layer) {
    if (!installation) return true; // direct calls (a unit test, a caller wiring its own listeners)
    return installation.layers.indexOf(layer) !== -1;
  }

  function ownerDocument(el) {
    if (el && el.ownerDocument) return el.ownerDocument;
    return typeof document !== "undefined" ? document : null;
  }

  // -------------------------------------------------------------------------
  // Region identity
  // -------------------------------------------------------------------------

  var mintSeq = 0;

  /**
   * The stable identity of a region: an attribute the page's own markup carries,
   * with the selector that finds it again after the element it was on has been
   * destroyed and rebuilt.
   *
   * @param {Element} el
   * @returns {{attribute: string, value: string, selector: string, minted: boolean}}
   */
  function regionKeyFor(el) {
    if (!el || typeof el.getAttribute !== "function") {
      throw new TypeError("protect.regionKeyFor: an element is required");
    }
    for (var i = 0; i < REGION_KEY_ATTRIBUTES.length; i += 1) {
      var name = REGION_KEY_ATTRIBUTES[i];
      var value = el.getAttribute(name);
      // A value carrying a quote cannot be put in an attribute selector without
      // escaping rules that differ per browser. Skip it rather than mint a
      // selector that silently matches nothing.
      if (typeof value === "string" && value && value.indexOf('"') === -1) {
        return {
          attribute: name,
          value: value,
          selector: "[" + name + '="' + value + '"]',
          minted: false
        };
      }
    }
    // Nothing stable to hold on to. Mint one and say so: a minted attribute does
    // NOT survive a repaint that rebuilds the element from the server's HTML, so
    // layer three's restore will report an honest failure rather than pretending.
    mintSeq += 1;
    var minted = "r" + mintSeq + "-" + Date.now();
    el.setAttribute(MINTED_REGION_ATTRIBUTE, minted);
    return {
      attribute: MINTED_REGION_ATTRIBUTE,
      value: minted,
      selector: "[" + MINTED_REGION_ATTRIBUTE + '="' + minted + '"]',
      minted: true
    };
  }

  function findRegion(key, doc) {
    var d = doc || (typeof document !== "undefined" ? document : null);
    if (!d || !key) return null;
    return d.querySelector(key.selector);
  }

  // -------------------------------------------------------------------------
  // LAYER 1: the cooperative-skip attributes
  // -------------------------------------------------------------------------

  function applySkipAttributes(el) {
    SKIP_ATTRIBUTES.forEach(function (name) {
      el.setAttribute(name, "");
    });
  }

  function removeSkipAttributes(el) {
    SKIP_ATTRIBUTES.forEach(function (name) {
      el.removeAttribute(name);
    });
  }

  /**
   * LAYER 1. Marks el as the protected region: the library owns it until
   * release.
   *
   * @param {Element} el
   * @param {Object} options {reason}
   * @returns {Object} {element, key, layers, at}
   */
  function mark(el, options) {
    if (!el) throw new TypeError("protect.mark: an element is required");
    if (active && active.element !== el) release(active.element);
    counters.marked += 1;

    var key = regionKeyFor(el);
    el.setAttribute(PROTECTED_ATTRIBUTE, "");
    if (enabled(LAYER.COOPERATIVE_SKIP)) applySkipAttributes(el);

    active = {
      element: el,
      key: key,
      reason: (options || {}).reason || null,
      // The record this block is being edited under. 2C asked for it at
      // CP2-mid: replay was answering "is the reviewer in this record's
      // region" from the node it last bound the record to, and the side that
      // actually knows the id is this one. Optional, because a caller that
      // marks a block outside an edit session has no record.
      item: (options || {}).item || null,
      at: Date.now(),
      snapshot: null,
      // The last thing the page tried to say in this block while it was
      // protected, taken off the page by layer three's restore. See
      // displacedChange() below.
      displaced: null
    };

    if (enabled(LAYER.SNAPSHOT_RESTORE)) snapshot(el);
    return active;
  }

  // True when el, or an ancestor of it, is the protected region. Replay asks
  // this before it writes anywhere.
  function isProtected(el) {
    if (!active || !el) return false;
    if (active.element === el) return true;
    return typeof active.element.contains === "function" && active.element.contains(el);
  }

  /**
   * The predicate the VETO uses, and it is not isProtected.
   *
   * A frame-level morph fires its cancelable event on an element that CONTAINS
   * the protected block. Vetoing only when the target is the block or inside it
   * means layer two never fires on that flavor and silently does nothing, while
   * every counter it publishes stays at zero and reads like a page that was
   * never repainted.
   *
   * @returns {boolean} true when a morph of el would touch the protected block
   */
  function touches(el) {
    if (!active || !el) return false;
    if (isProtected(el)) return true;
    return typeof el.contains === "function" && el.contains(active.element);
  }

  function protectedElement() {
    return active ? active.element : null;
  }

  /**
   * LAYER 2. The pre-morph veto. A framework's cancelable event handler calls
   * this with the element about to be replaced; a true return means the library
   * cancelled it.
   *
   * @param {Element} el the element the framework is about to replace
   * @param {Event} event the cancelable event, when there is one
   * @returns {boolean} true when the morph was vetoed
   */
  function veto(el, event) {
    if (!touches(el)) return false;
    counters.vetoes += 1;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    return true;
  }

  // -------------------------------------------------------------------------
  // LAYER 3: snapshot and restore
  // -------------------------------------------------------------------------

  function textNodesIn(el) {
    var doc = ownerDocument(el);
    if (!doc || !doc.createTreeWalker) return [];
    var walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */, null);
    var out = [];
    var node = walker.nextNode();
    while (node) {
      out.push(node);
      node = walker.nextNode();
    }
    return out;
  }

  /**
   * A caret position measured as a CHARACTER OFFSET from the start of the
   * region. The only measurement that survives the node it was taken in.
   *
   * @returns {null|number} null when that node is not inside the region
   */
  function offsetWithin(el, node, offsetInNode) {
    if (!el || !node) return null;
    if (!(el === node || (typeof el.contains === "function" && el.contains(node)))) return null;
    var nodes = textNodesIn(el);
    var total = 0;
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i] === node) return total + offsetInNode;
      total += nodes[i].nodeValue.length;
    }
    // The container was an element rather than a text node (an empty block, or
    // a caret between children): everything before it is what has been counted.
    return total;
  }

  /** Put the caret back at a character offset, in whatever node now holds it. */
  function placeCaretAt(el, startOffset, endOffset) {
    var doc = ownerDocument(el);
    var win = doc && doc.defaultView;
    if (!doc || !win || !doc.createRange) return false;
    var nodes = textNodesIn(el);
    if (nodes.length === 0) return false;

    function locate(offset) {
      var remaining = offset;
      for (var i = 0; i < nodes.length; i += 1) {
        var length = nodes[i].nodeValue.length;
        if (remaining <= length) return { node: nodes[i], offset: remaining };
        remaining -= length;
      }
      var last = nodes[nodes.length - 1];
      return { node: last, offset: last.nodeValue.length };
    }

    var start = locate(startOffset);
    var end = typeof endOffset === "number" && endOffset !== startOffset ? locate(endOffset) : start;
    var range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    var sel = win.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function readSurfaceAttributes(el) {
    var out = {};
    SURFACE_ATTRIBUTES.forEach(function (name) {
      if (el.hasAttribute(name)) out[name] = el.getAttribute(name);
    });
    return out;
  }

  /**
   * LAYER 3, first half. Snapshots the region's content and the selection,
   * region-relative.
   *
   * Called on mark, and again on every input and keyup while the block is
   * protected: `input` fires synchronously after the keystroke landed and before
   * any MutationObserver callback, so the snapshot is always ahead of the
   * observer that reads it. Without that ordering the observer sees the
   * reviewer's own typing as damage and restores it away.
   *
   * @param {Element} regionEl
   * @returns {null|Object} the snapshot
   */
  function snapshot(regionEl) {
    var el = regionEl || protectedElement();
    if (!el || restoring) return null;
    counters.snapshots += 1;

    var key = active && active.element === el ? active.key : regionKeyFor(el);
    var range = selection.currentRange();
    var startOffset = range ? offsetWithin(el, range.startContainer, range.startOffset) : null;
    var endOffset = range ? offsetWithin(el, range.endContainer, range.endOffset) : null;

    var snap = {
      regionKey: key,
      selector: key.selector,
      html: el.innerHTML,
      text: typeof el.textContent === "string" ? el.textContent : "",
      attributes: readSurfaceAttributes(el),
      startOffset: startOffset,
      endOffset: endOffset === null ? startOffset : endOffset,
      collapsed: !selection.hasSelection(),
      at: Date.now()
    };

    snapshots[key.value] = snap;
    if (active && active.element === el) active.snapshot = snap;
    return snap;
  }

  /**
   * LAYER 3, second half. Restores a snapshot after the repaint.
   *
   * Three things happen here, and dropping any one of them makes the layer look
   * like it works for exactly one keystroke:
   *
   *   the content goes back, from the snapshot rather than from the node;
   *   the editing surface goes back, because the block came back as ordinary
   *     page markup with no contenteditable and no protection on it;
   *   the caret goes back, at the character offset the snapshot recorded, in
   *     whatever node now holds those characters.
   *
   * @param {Object|string} [snapOrKey] a snapshot, a region key value, or
   *                                    nothing for the protected region's own
   * @param {Element} [regionEl] the element to restore into, when the caller
   *                             already has it
   * @returns {boolean} true when the caret landed where the snapshot said
   */
  function restore(snapOrKey, regionEl) {
    var snap = null;
    if (typeof snapOrKey === "string") snap = snapshots[snapOrKey];
    else if (snapOrKey && typeof snapOrKey === "object") snap = snapOrKey;
    else if (active) snap = active.snapshot;

    if (!snap) {
      lastFailure = "restore called with no snapshot to restore";
      counters.restoreFailures += 1;
      return false;
    }

    var el = regionEl || findRegion(snap.regionKey);
    if (!el) {
      lastFailure =
        "the region " +
        snap.selector +
        " is not in the document" +
        (snap.regionKey.minted
          ? ". Its identity was MINTED because the page's markup carried none, and a minted " +
            "attribute does not come back when a repaint rebuilds the element from the server's HTML"
          : "");
      counters.restoreFailures += 1;
      return false;
    }

    // Nothing was damaged. Not a failure and not a restore: a counter that moved
    // here would let a page where nothing ever happened score full marks.
    var caretAlreadyRight =
      snap.startOffset === null ||
      offsetWithin(el, selection.caretNode(), selection.caretOffset()) === snap.startOffset;
    if (el.textContent === snap.text && el.isConnected && caretAlreadyRight) return false;

    var rebuilt = !!active && active.element !== el && !active.element.isConnected;
    var placed = false;

    // WHAT THE PAGE TRIED TO SAY, kept before it is written over.
    //
    // Layer three is the only place a page's change to a protected block is
    // taken back off the page with its text still readable. Everywhere else the
    // change either never happened (layer two vetoed it) or never reached this
    // block. If that text is thrown away here, an agent that rewrote this very
    // block while the reviewer was in it is swallowed silently: the reviewer
    // commits, the page holds their own words, replay compares their words
    // against their words, and nothing ever tells them the source moved. So the
    // text is kept, and `release` hands it to replay, which decides whether it
    // is a collision. Last write wins: the newest thing the page tried to say
    // is the one the reviewer has to reconcile against.
    if (active && active.element === el) {
      active.displaced = {
        text: typeof el.textContent === "string" ? el.textContent : "",
        html: el.innerHTML,
        at: Date.now()
      };
    }

    restoring = true;
    try {
      epoch.write("protect_restore", function () {
        el.innerHTML = snap.html;
        // The editing surface, re-established. See finding 3 in the header.
        Object.keys(snap.attributes).forEach(function (name) {
          if (el.getAttribute(name) !== snap.attributes[name]) el.setAttribute(name, snap.attributes[name]);
        });
        if (rebuilt) {
          // Protection has to move to the node that replaced the one the repaint
          // destroyed, or the next repaint has nothing marked to protect.
          active.element = el;
          active.key = snap.regionKey;
          el.setAttribute(PROTECTED_ATTRIBUTE, "");
          if (enabled(LAYER.COOPERATIVE_SKIP)) applySkipAttributes(el);
        }
        if (typeof el.focus === "function") el.focus();
        placed = snap.startOffset === null ? true : placeCaretAt(el, snap.startOffset, snap.endOffset);
      });
    } finally {
      restoring = false;
    }

    if (placed) counters.restores += 1;
    else {
      lastFailure = "the caret could not be placed at offset " + snap.startOffset + " in " + snap.selector;
      counters.restoreFailures += 1;
    }
    if (installation && installation.onRestore) installation.onRestore(el, snap);
    return placed;
  }

  // -------------------------------------------------------------------------
  // install: the three layers wired to the page
  // -------------------------------------------------------------------------

  function normalizeLayers(asked) {
    if (!asked) return LAYERS.slice();
    var list = [].concat(asked);
    list.forEach(function (name) {
      if (LAYERS.indexOf(name) === -1) {
        throw new Error("protect.install: unknown layer " + JSON.stringify(name) + ", expected one of " + LAYERS.join(", "));
      }
    });
    return list;
  }

  /**
   * Wires protection to a document: the veto listeners for every framework's
   * pre-morph event, the snapshot refresh on the reviewer's own typing, and the
   * document-level observer that restores after a repaint.
   *
   * @param {Object} [options] {document, layers, onRestore}
   *   `layers` names a subset, which is how ranked test 1 scores each layer on
   *   its own. `onRestore(el, snapshot)` is the seam for whoever has to re-bind
   *   to the block after it came back as a new node.
   * @returns {{layers: string[], frameworks: string[], uninstall: Function}}
   */
  function install(options) {
    var opts = options || {};
    // The layer names are checked BEFORE anything about the environment, so a
    // typo'd layer reads as a typo rather than as a missing document.
    var layers = normalizeLayers(opts.layers);
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    if (!doc) throw new Error("protect.install: there is no document to install into");
    if (installation) installation.uninstall();

    function onBeforeMorph(event) {
      if (!enabled(LAYER.VETO)) return;
      veto(event.target, event);
    }

    function onTyping(event) {
      if (!enabled(LAYER.SNAPSHOT_RESTORE) || restoring || !active) return;
      var target = event.target;
      if (!(target === active.element || (target && active.element.contains && active.element.contains(target)))) return;
      snapshot(active.element);
    }

    var observer = null;
    function onMutations() {
      if (!enabled(LAYER.SNAPSHOT_RESTORE) || restoring || !active) return;
      // Drop the records this callback has not read: the restore below writes,
      // and a queued batch describing our own write is not damage.
      if (observer) observer.takeRecords();
      Object.keys(snapshots).forEach(function (key) {
        restore(key);
      });
    }

    BEFORE_MORPH_EVENTS.forEach(function (name) {
      doc.addEventListener(name, onBeforeMorph, true);
    });
    doc.addEventListener("input", onTyping, true);
    doc.addEventListener("keyup", onTyping, true);

    if (layers.indexOf(LAYER.SNAPSHOT_RESTORE) !== -1 && typeof MutationObserver === "function") {
      observer = new MutationObserver(onMutations);
      observer.observe(doc.documentElement, { childList: true, characterData: true, subtree: true });
    }

    installation = {
      document: doc,
      layers: layers,
      frameworks: detect(doc.defaultView),
      onRestore: typeof opts.onRestore === "function" ? opts.onRestore : null,
      uninstall: function () {
        BEFORE_MORPH_EVENTS.forEach(function (name) {
          doc.removeEventListener(name, onBeforeMorph, true);
        });
        doc.removeEventListener("input", onTyping, true);
        doc.removeEventListener("keyup", onTyping, true);
        if (observer) observer.disconnect();
        installation = null;
      }
    };
    return installation;
  }

  function uninstall() {
    if (installation) installation.uninstall();
  }

  /**
   * Which of the known frameworks look present. DIAGNOSTIC ONLY: nothing branches
   * on it, because a wrong guess costs the reviewer their caret and marking with
   * an attribute a framework has never heard of costs nothing.
   */
  function detect(win) {
    var w = win || (typeof window !== "undefined" ? window : null);
    return FRAMEWORKS.filter(function (f) {
      return f.present(w);
    }).map(function (f) {
      return f.name;
    });
  }

  /**
   * Lifts protection. On release the commit runs and 2C's replay pass runs
   * immediately, so a change the page tried to make to the block while it was
   * protected surfaces through replay's neither-matches branch rather than
   * being silently swallowed. 2C owns that seam; 2B calls it.
   *
   * @param {Element} el
   * @returns {boolean} true when something was released
   */
  function release(el) {
    if (!active) return false;
    if (el && active.element !== el) return false;

    var element = active.element;
    // What the commit pass is told about this block, built before `active` is
    // dropped. The element saves replay an anchor resolve it does not need
    // (2C's ask), and `observed` is the page's own attempt at this block, which
    // only protection ever saw.
    var commit = {
      item: active.item,
      element: element,
      observed: active.displaced ? active.displaced.text : null,
      observedHtml: active.displaced ? active.displaced.html : null
    };
    if (element && typeof element.removeAttribute === "function") {
      element.removeAttribute(PROTECTED_ATTRIBUTE);
      removeSkipAttributes(element);
    }
    delete snapshots[active.key.value];
    active = null;

    var replay = replayModule();
    if (!replay) {
      // Fail loud. Protection lifting without the pass that follows it is the
      // silent swallow this seam exists to prevent.
      throw new Error(
        "protect.release: the replay module is not loaded, so the pass that runs on commit cannot run. " +
          "Load src/layer/replay.js beside protect.js."
      );
    }
    runCommitPass(replay, commit);
    return true;
  }

  /**
   * Run the commit pass, AFTER the write epoch the caller is inside has closed.
   *
   * This is not a nicety. `epoch.write` closes on a microtask, not when its
   * function returns, so a caller that just wrote to the DOM is still "inside" a
   * write epoch for the rest of the synchronous turn. `replay.schedule` refuses
   * while the epoch is open, by design, because replay's own writes must not
   * schedule replay. The editing surface commits by taking contenteditable back
   * off (a write) and then releasing protection in the same turn, so the commit
   * pass was refused every single time: protection lifted, no pass ran, and a
   * change the page made to the block underneath the reviewer was swallowed
   * exactly as if this seam had never been wired.
   *
   * Nobody could see it before CP2-mid. 2B's specs call release() straight, with
   * no epoch open, and pass; 2A's specs scheduled their own pass afterwards from
   * a microtask, which hid it from that side too. It took the two real surfaces
   * on one page.
   *
   * A microtask is the right amount of waiting: the epoch's own close is queued
   * as one, so ours runs immediately after it, still in the same task and still
   * before anything paints.
   */
  function runCommitPass(replay, commit) {
    function run() {
      replay.schedule(replay.REASON.COMMIT, { immediate: true, commit: commit });
    }
    if (!epoch.isWriting()) {
      run();
      return;
    }
    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  return {
    LAYER: LAYER,
    LAYERS: LAYERS,
    FRAMEWORKS: FRAMEWORKS,
    SKIP_ATTRIBUTES: SKIP_ATTRIBUTES,
    BEFORE_MORPH_EVENTS: BEFORE_MORPH_EVENTS,
    PROTECTED_ATTRIBUTE: PROTECTED_ATTRIBUTE,
    REGION_KEY_ATTRIBUTES: REGION_KEY_ATTRIBUTES,
    MINTED_REGION_ATTRIBUTE: MINTED_REGION_ATTRIBUTE,
    SURFACE_ATTRIBUTES: SURFACE_ATTRIBUTES,
    counters: counters,
    resetCounters: resetCounters,
    install: install,
    uninstall: uninstall,
    detect: detect,
    regionKeyFor: regionKeyFor,
    mark: mark,
    isProtected: isProtected,
    touches: touches,
    protectedElement: protectedElement,
    // The record the protected block is being edited under, or null. Replay
    // asks this first, because an id from the side that knows it beats replay's
    // own memory of the node a record was last bound to.
    protectedItemId: function () {
      return active ? active.item : null;
    },
    // The last change the page made to the protected block that layer three
    // took back off, or null. Read by release(); a caller may read it too.
    displacedChange: function () {
      return active ? active.displaced : null;
    },
    veto: veto,
    snapshot: snapshot,
    restore: restore,
    release: release,
    lastFailure: function () {
      return lastFailure;
    }
  };
});
