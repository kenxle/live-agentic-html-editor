// Stub review layer, for the browser test harness only.
//
// This is NOT the real library (src/layer/). It is a deliberately small stand-in
// that exposes exactly the surface the harness helpers read. What makes it worth
// reading: EVERY NAME IN IT IS THE KERNEL'S NAME. The vocabulary was copied from
// the landed modules, not invented here, so a builder who learns the flow from
// this file learns the real one.
//
//   src/shared/gestures.js  GESTURE.EDIT_BLOCK, COMMIT_EDIT, MARK_READY, CANCEL
//   src/shared/record.js    KIND, STATE, the field names, after_history, bumpRev
//   src/shared/lifecycle.js draft -> ready is the reviewer's, and only theirs
//   src/layer/protect.js    mark, isProtected, veto, snapshot, restore, release,
//                           and the counter names marked/vetoes/snapshots/
//                           restores/restoreFailures
//   src/layer/store.js      write, readItem, read, keyed by review id
//   src/layer/comments.js   the draft-on-every-keystroke rule
//
// It deliberately does NOT require or bundle those modules. The fixture server's
// root is test/fixtures, the built bundle is dist/lahe-layer.js, and builders are
// forbidden from rebuilding dist/, so a harness that loaded the bundle would make
// every self-test depend on an artifact no builder may refresh. The guard against
// drift is a unit test instead: test/unit/harness_stub_vocabulary.test.js pins
// every name below against the real modules and fails the gate when one moves.
//
// The surface, in the plan's words: enter edit state on a block, protect,
// release, commit, mark ready.
//
//   window.__lahe.counters.*      what the harness reads (see counters.js)
//   window.__lahe.replayNow()     one replay pass, synchronously
//   window.__lahe.stub.*          the vocabulary above, plus stub-only knobs
//
// Every behavior under test can be switched off through
// window.__lahe.stub.configure(), which is what lets the harness self-tests prove
// the assertions actually fail when the behavior is missing. An assertion nobody
// has watched fail is theatre.
//
// When the real library lands, load it instead of this file and rewrite
// test/helpers/stub.js. Nothing else in test/helpers/ knows this file exists.

(function () {
  "use strict";

  const ns = window.__lahe || (window.__lahe = {});
  const counters = ns.counters || (ns.counters = {});

  // Replay's counters. The contract in test/helpers/counters.js.
  counters.replayPasses = 0;
  counters.regionsWritten = 0;
  counters.regionsSkippedIdentical = 0;
  counters.regionsSkippedProtected = 0;
  counters.regionsSkippedCaret = 0;
  counters.regionsBlockedChanged = 0;

  // Protection's counters, spelled as src/layer/protect.js spells them. 2B
  // publishes these for real; the harness reads the same names either way.
  counters.marked = 0; // layer 1: blocks marked for cooperative skip
  counters.vetoes = 0; // layer 2: morphs cancelled before they happened
  counters.snapshots = 0; // layer 3: selections snapshotted
  counters.restores = 0; // layer 3: selections restored after a repaint
  counters.restoreFailures = 0; // layer 3 ran and could not put the caret back

  // ---------------------------------------------------------------------------
  // The kernel's vocabulary, copied
  // ---------------------------------------------------------------------------

  // src/shared/record.js
  const KIND = {
    COMMENT: "comment",
    EDIT: "edit",
    DELETE: "delete",
    FORMAT_ONLY: "format_only",
    NOTE: "note"
  };
  const STATE = {
    DRAFT: "draft",
    READY: "ready",
    HANDLED: "handled",
    NOT_HANDLED: "not_handled"
  };

  // src/layer/protect.js
  const LAYER = {
    COOPERATIVE_SKIP: "cooperative_skip",
    VETO: "veto",
    SNAPSHOT_RESTORE: "snapshot_restore"
  };

  // src/shared/gestures.js. The stub does not own the gesture table; it names
  // the gestures it implements so a test can say what it is exercising.
  const GESTURE = {
    EDIT_BLOCK: "edit_block",
    COMMIT_EDIT: "commit_edit",
    MARK_READY: "mark_ready",
    CANCEL: "cancel"
  };

  // Layer one's attribute (data-turbo-permanent's stand-in) and the library's own
  // marker. Two different things: the first asks a cooperative framework to skip
  // the block, the second says the block is ours.
  const SKIP_ATTRIBUTE = "data-lahe-permanent";
  const PROTECTED_ATTRIBUTE = "data-lahe-protected";
  const BEFORE_MORPH_ELEMENT = "lahe:before-morph-element";

  // src/layer/store.js keys by review id, never by page or filename.
  const REVIEW_ID = "harness-review";

  const config = {
    // LAYER 1. The cooperative-skip attribute goes on the block in edit state.
    // Off reproduces a library that never asked the framework for anything.
    cooperativeSkip: true,
    // LAYER 2. A listener cancels the pre-morph event for the protected block.
    // Off reproduces a library that marked the block and never vetoed.
    veto: true,
    // LAYER 3. Snapshot the reviewer's text and caret, and put them back after a
    // repaint destroyed them. OFF by default: it is the fallback for repaints
    // that honor neither of the other two, and a restore running underneath them
    // would hide their failures. This is the only layer that survives the
    // no-hook repaint flavor, and the caret it restores is in a NEW node by
    // construction, which is why it has its own assertion.
    snapshotRestore: false,
    // Replay's comparison. Off makes replay rewrite every ready record on every
    // pass, which is the failure the idempotence assertion exists to catch.
    idempotent: true,
    // Never write into a region holding the caret.
    respectCaret: true,
    // Commit when the block loses focus. On by default, and switched off by the
    // layer-three tests: a repaint that destroys the block in edit state fires
    // blur, the stub commits, and replay then writes that record straight back.
    // The page looks repaired, the restore never ran, and layer three scores
    // full marks for someone else's work. The real library has the same trap: a
    // commit is the reviewer leaving the block, not the framework yanking it.
    commitOnBlur: true
  };

  // ---------------------------------------------------------------------------
  // The items
  // ---------------------------------------------------------------------------
  //
  // Record-shaped, with the kernel's field names. A stub could get away with
  // {before, after}; spelling the whole record is the point, because this is
  // where a builder reads the shape.

  const items = [];
  let idSeq = 0;

  function nowIso() {
    return new Date().toISOString();
  }

  function pageFields() {
    return {
      page_origin: window.location.origin,
      page_path: window.location.pathname,
      page_title: document.title || null,
      page_seq: 1,
      source_hint: null
    };
  }

  // The kernel mints ids from a CSPRNG. A test wants them readable and stable,
  // and nothing in the harness depends on them being unguessable.
  function newItem(input) {
    idSeq += 1;
    const at = nowIso();
    const page = pageFields();
    const item = {
      id: "itm_" + idSeq,
      rev: 1,
      kind: input.kind,
      state: input.state || STATE.DRAFT,
      note: input.note ?? null,
      change: input.change ?? null,
      before: input.before ?? null,
      after: null,
      before_html: input.before_html ?? null,
      after_html: null,
      after_history: [],
      region: { ref: input.region || null, label: input.label || null, lost: null },
      context: { quote: null, prefix: null, suffix: null, heading: null, element: null },
      page_origin: page.page_origin,
      page_path: page.page_path,
      page_title: page.page_title,
      page_seq: page.page_seq,
      source_hint: page.source_hint,
      reply: null,
      created_at: at,
      updated_at: at
    };
    items.push(item);
    return item;
  }

  // src/shared/record.js: every rewording bumps rev and keeps the previous
  // `after`, which is what replay's branch three compares against.
  function pushHistory(item) {
    const last = item.after_history.length ? item.after_history[item.after_history.length - 1] : null;
    if (typeof item.after === "string" && (!last || last.after !== item.after)) {
      item.after_history.push({
        rev: item.rev,
        after: item.after,
        after_html: item.after_html,
        at: item.updated_at
      });
    }
  }

  function itemFor(region) {
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].region.ref === region) return items[i];
    }
    return null;
  }

  function regionSelector(name) {
    return '[data-region="' + name + '"]';
  }

  function regionElement(name) {
    return document.querySelector(regionSelector(name));
  }

  // ---------------------------------------------------------------------------
  // Protection: the three layers, named as src/layer/protect.js names them
  // ---------------------------------------------------------------------------
  //
  // One protected block at a time. Edit state is per region (D3), so a second
  // mark releases the first rather than nesting, exactly as protect.mark does.

  let active = null;

  /** LAYER 1. protect.mark: the library owns this block until release. */
  function mark(el, options) {
    if (!el) throw new TypeError("stub.mark: an element is required");
    if (active && active.element !== el) release(active.element);
    counters.marked += 1;
    active = { element: el, reason: (options || {}).reason || null, at: Date.now(), snapshot: null };
    el.setAttribute(PROTECTED_ATTRIBUTE, "");
    if (config.cooperativeSkip) el.setAttribute(SKIP_ATTRIBUTE, "");
    return active;
  }

  /** protect.isProtected: is el the protected block, or inside it? */
  function isProtected(el) {
    if (!active || !el) return false;
    if (active.element === el) return true;
    return typeof active.element.contains === "function" && active.element.contains(el);
  }

  function protectedElement() {
    return active ? active.element : null;
  }

  /** protect.release. Lifts every layer's mark at once. */
  function release(el) {
    if (!active) return false;
    if (el && active.element !== el) return false;
    active.element.removeAttribute(PROTECTED_ATTRIBUTE);
    active.element.removeAttribute(SKIP_ATTRIBUTE);
    active = null;
    return true;
  }

  // LAYER 2. protect.veto, wired to the fixture's cancelable pre-morph event.
  //
  // NOTE FOR 2B, and it is not a nit. protect.isProtected(el) answers "is el the
  // protected block or inside it". A turbo-frame replacement fires the event on
  // the FRAME, which CONTAINS the protected block, so a veto handler written
  // against isProtected alone never fires on that flavor and layer two silently
  // does nothing there. The condition a veto needs is both directions: the event
  // target is the block, is inside it, or contains it.
  function vetoTouches(el) {
    if (!active || !el) return false;
    if (isProtected(el)) return true;
    return typeof el.contains === "function" && el.contains(active.element);
  }

  document.addEventListener(BEFORE_MORPH_ELEMENT, function (event) {
    if (!config.veto) return;
    if (!vetoTouches(event.target)) return;
    counters.vetoes += 1;
    event.preventDefault();
  });

  // ---------------------------------------------------------------------------
  // LAYER 3: snapshot and restore
  // ---------------------------------------------------------------------------
  //
  // A repaint destroys the text node the selection lives in before any observer
  // fires, so nothing can save that node. What can be saved is what the reviewer
  // typed and where their caret was in it, measured as a CHARACTER OFFSET in the
  // region rather than as a node reference. protect.js says the same in its
  // header: the snapshot is region-relative, never node-relative.
  //
  // Keyed by REGION NAME, never by element reference, and observed at the
  // document rather than at the region. The no-hook repaint replaces the whole
  // frame's innerHTML, so the region element itself is destroyed, not just its
  // children: a snapshot held against a node, or an observer attached to the
  // region, dies on the first repaint and silently stops restoring.

  const snapshots = Object.create(null);
  let restoring = false;

  function textNodesOf(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const out = [];
    let node = walker.nextNode();
    while (node) {
      out.push(node);
      node = walker.nextNode();
    }
    return out;
  }

  /** Where the caret is, counted in characters from the start of the region. */
  function caretOffsetIn(el) {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
    if (!el.contains(sel.anchorNode)) return null;
    const nodes = textNodesOf(el);
    let total = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i] === sel.anchorNode) return total + sel.anchorOffset;
      total += nodes[i].nodeValue.length;
    }
    return sel.anchorOffset === 0 ? 0 : total;
  }

  /** Put the caret back at a character offset, in whatever node now holds it. */
  function placeCaretAt(el, offset) {
    const nodes = textNodesOf(el);
    let remaining = offset;
    for (let i = 0; i < nodes.length; i += 1) {
      const length = nodes[i].nodeValue.length;
      if (remaining <= length) {
        const range = document.createRange();
        range.setStart(nodes[i], remaining);
        range.collapse(true);
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
      remaining -= length;
    }
    return false;
  }

  /** protect.snapshot, region-relative. */
  function snapshot(el) {
    if (!config.snapshotRestore || restoring) return null;
    const name = el.getAttribute("data-region");
    if (!name) return null;
    counters.snapshots += 1;
    snapshots[name] = { html: el.innerHTML, text: el.textContent, caret: caretOffsetIn(el) };
    return snapshots[name];
  }

  /** protect.restore. Counts a failure when the caret could not be put back. */
  function restore(name) {
    const snap = snapshots[name];
    const el = regionElement(name);
    if (!snap || !el || el.textContent === snap.text) return false;
    // The protected element reference points at the node the repaint destroyed,
    // so protection has to be re-established on the node that replaced it.
    const wasProtected = !!active && !active.element.isConnected;
    restoring = true;
    let placed = true;
    try {
      el.innerHTML = snap.html;
      // The repaint rebuilt the BLOCK ITSELF, not just its children, so it came
      // back with no edit state and no listeners on it. Putting the text back and
      // leaving the block dead to the keyboard is not a restore: the next
      // keystroke goes nowhere, the snapshot goes stale, and every later repaint
      // restores the same one sentence. This is the stub's version of the
      // remount contract 2D owns in the real library.
      applyEditState(el);
      bindEditListeners(el, name);
      if (wasProtected) mark(el, { reason: "restore" });
      el.focus();
      if (snap.caret !== null) placed = placeCaretAt(el, snap.caret);
    } finally {
      restoring = false;
    }
    if (placed) counters.restores += 1;
    else counters.restoreFailures += 1;
    return placed;
  }

  const damageObserver = new MutationObserver(function () {
    if (!config.snapshotRestore || restoring) return;
    damageObserver.takeRecords();
    try {
      Object.keys(snapshots).forEach(function (name) {
        restore(name);
      });
    } catch (err) {
      // A throw inside a MutationObserver callback is easy to lose: the restore
      // half-runs, the counter never moves, and the failure reads as "layer
      // three did nothing". Keep it where a test can find it.
      ns.lastRestoreError = String(err && err.stack ? err.stack : err);
      throw err;
    }
  });

  damageObserver.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });

  // ---------------------------------------------------------------------------
  // Edit state: enter, commit
  // ---------------------------------------------------------------------------
  //
  // D3: edit state is entered DELIBERATELY, per block, with Cmd-Shift-E, and
  // that one block only. Browse is the page untouched, so there is no
  // page-wide "make everything editable" any more; a test names the block.

  function applyEditState(el) {
    el.dataset.laheEditing = "1";
    el.setAttribute("contenteditable", "true");
    // The platform must not quietly rewrite a word and have it recorded as the
    // reviewer's intent (R3).
    el.setAttribute("spellcheck", "false");
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
  }

  // Bound per element, not per region, because the repaint replaces the element.
  // The dataset flag rides on the node, so a rebuilt node binds again and the
  // node that survives does not double-bind.
  function bindEditListeners(el, region) {
    if (el.dataset.laheBound === "1") return;
    el.dataset.laheBound = "1";
    // `input` fires synchronously after the keystroke landed and before any
    // MutationObserver callback, so the snapshot is always ahead of the observer
    // that reads it.
    el.addEventListener("input", function () {
      snapshot(el);
    });
    el.addEventListener("keyup", function () {
      snapshot(el);
    });
    el.addEventListener("blur", function () {
      if (!config.commitOnBlur || !el.isConnected) return;
      commitEdit(region);
    });
  }

  function clearEditState(el) {
    delete el.dataset.laheEditing;
    el.removeAttribute("contenteditable");
    el.removeAttribute("spellcheck");
    el.removeAttribute("autocorrect");
    el.removeAttribute("autocapitalize");
  }

  /**
   * GESTURE.EDIT_BLOCK. Enter edit state on one block.
   *
   * The record's `before` is the wording as it was when the reviewer FIRST
   * touched the block, however many times they retype it after (R29). Re-entering
   * an already-edited block keeps the original `before`; if it drifted to the
   * last committed state, replay's branch two would never match and the agent
   * would get a diff that is a no-op against the source.
   *
   * @param {string} region the data-region value
   * @returns {object} the item, in record shape
   */
  function editBlock(region) {
    const el = regionElement(region);
    if (!el) throw new Error("stub.editBlock: no element matches " + regionSelector(region));

    let item = itemFor(region);
    if (!item) {
      item = newItem({
        kind: KIND.EDIT,
        state: STATE.DRAFT,
        before: el.textContent,
        before_html: el.innerHTML,
        region: region,
        label: region
      });
    }

    applyEditState(el);
    bindEditListeners(el, region);
    mark(el, { reason: GESTURE.EDIT_BLOCK });
    return Object.assign({}, item);
  }

  /**
   * GESTURE.COMMIT_EDIT. Esc, or a click outside: the edit is finished, the
   * block goes back to the page, and protection lifts.
   *
   * The item moves draft -> ready, which per src/shared/lifecycle.js is the
   * reviewer's transition and only theirs.
   */
  function commitEdit(region) {
    const el = regionElement(region);
    const item = itemFor(region);
    if (!el || !item) return null;

    // The gesture table's `when` column: COMMIT_EDIT applies when a block is in
    // edit state, and there is nothing to commit otherwise. This is load-bearing
    // rather than defensive. Clearing edit state removes contenteditable, which
    // blurs the block, which fires the blur handler, which commits again: the
    // second commit finds the item already ready and bumps its rev, so one edit
    // arrives at the agent as a rewording that never happened, and a reply
    // naming rev 1 gets refused for no reason.
    if (!el.dataset.laheEditing) return Object.assign({}, item);

    if (item.state !== STATE.DRAFT) {
      // A second commit after a re-entry is a rewording: it bumps rev, which is
      // what makes a stale reply naming the old rev refusable (R21).
      item.rev += 1;
    }
    item.after = el.textContent;
    item.after_html = el.innerHTML;
    item.state = STATE.READY;
    item.updated_at = nowIso();
    pushHistory(item);

    clearEditState(el);
    release(el);
    return Object.assign({}, item);
  }

  /**
   * GESTURE.MARK_READY. Cmd-Enter on a comment box. Separate from committing an
   * edit because they are different gestures on different surfaces, and only one
   * of them lifts protection.
   */
  function markReady(region) {
    const item = itemFor(region);
    if (!item) return null;
    item.state = STATE.READY;
    item.updated_at = nowIso();
    return Object.assign({}, item);
  }

  /** A comment on a passage, so a test has a non-edit item to work with. */
  function comment(region, note) {
    const el = regionElement(region);
    const item = newItem({
      kind: KIND.COMMENT,
      state: STATE.DRAFT,
      note: note ?? "",
      before: el ? el.textContent : null,
      region: region,
      label: region
    });
    return Object.assign({}, item);
  }

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------

  // A LOCAL normalizer, deliberately. The one normalizer lives in
  // src/shared/normalize.js and every part of the real tool imports it; this stub
  // keeps its own so the harness does not take a dependency on a module another
  // builder owns. It is not the contract, and no test should assert against it.
  function normalize(text) {
    return String(text)
      .replace(new RegExp(String.fromCharCode(160), "g"), " ")
      .replace(new RegExp("\\s+", "g"), " ")
      .trim();
  }

  function containsCaret(el) {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const node = sel.anchorNode;
    if (!node) return false;
    const owner = node.nodeType === 1 ? node : node.parentElement;
    return !!(owner && el.contains(owner));
  }

  function replayNow() {
    counters.replayPasses += 1;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      // Drafts are never actionable, and replay only re-applies what the
      // reviewer said was ready.
      if (item.state !== STATE.READY || item.kind !== KIND.EDIT) continue;
      const el = regionElement(item.region.ref);
      if (!el) {
        item.region.lost = { code: "no_match", reason: "the region is not in the page", at: nowIso() };
        continue;
      }
      if (el.hasAttribute(PROTECTED_ATTRIBUTE)) {
        counters.regionsSkippedProtected += 1;
        continue;
      }
      if (config.respectCaret && containsCaret(el)) {
        counters.regionsSkippedCaret += 1;
        continue;
      }
      if (config.idempotent) {
        const dom = normalize(el.textContent);
        if (dom === normalize(item.after)) {
          counters.regionsSkippedIdentical += 1;
          continue;
        }
        if (dom !== normalize(item.before)) {
          counters.regionsBlockedChanged += 1;
          continue;
        }
      }
      // A real write replaces nodes, which is exactly why an unprotected replay
      // destroys the caret. Keep it that way; a nodeValue poke would make the
      // negative self-tests pass for the wrong reason.
      el.innerHTML = item.after_html;
      counters.regionsWritten += 1;
    }
    return counters.replayPasses;
  }

  // The real library schedules replay from a MutationObserver behind a write
  // epoch. The stub listens for the repaint engine's event instead, so a pass
  // lands synchronously after each repaint and tests poll a counter rather than
  // guess at microtask timing.
  document.addEventListener("lahe:repainted", function () {
    replayNow();
  });

  ns.replayNow = replayNow;
  ns.ready = true;
  ns.stub = {
    KIND: KIND,
    STATE: STATE,
    LAYER: LAYER,
    GESTURE: GESTURE,
    REVIEW_ID: REVIEW_ID,
    SKIP_ATTRIBUTE: SKIP_ATTRIBUTE,
    PROTECTED_ATTRIBUTE: PROTECTED_ATTRIBUTE,

    // The vocabulary: enter edit state on a block, protect, release, commit,
    // mark ready.
    editBlock: editBlock,
    commitEdit: commitEdit,
    markReady: markReady,
    comment: comment,
    protect: function (region) {
      const el = regionElement(region);
      if (!el) throw new Error("stub.protect: no element matches " + regionSelector(region));
      return { region: region, marked: !!mark(el, { reason: "protect" }) };
    },
    release: function (region) {
      const el = region ? regionElement(region) : null;
      return release(el);
    },
    isProtected: function (region) {
      return isProtected(regionElement(region));
    },
    protectedRegion: function () {
      const el = protectedElement();
      return el ? el.getAttribute("data-region") : null;
    },
    snapshotRegion: function (region) {
      const el = regionElement(region);
      if (el) snapshot(el);
      const snap = snapshots[region];
      return snap ? { text: snap.text, caret: snap.caret } : null;
    },

    items: function () {
      return items.map(function (item) {
        return Object.assign({}, item);
      });
    },
    item: function (region) {
      const found = itemFor(region);
      return found ? Object.assign({}, found) : null;
    },

    normalize: normalize,
    configure: function (patch) {
      Object.keys(patch || {}).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(config, key)) {
          // Fail loud. A typo in a knob name silently leaves the behavior on,
          // and the negative half of a self-test then passes for no reason.
          throw new Error(
            "stub.configure: no such knob '" + key + "'. Known: " + Object.keys(config).join(", ")
          );
        }
        config[key] = patch[key];
      });
      return Object.assign({}, config);
    },
    config: function () {
      return Object.assign({}, config);
    }
  };
})();
