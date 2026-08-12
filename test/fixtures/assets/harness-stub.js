// Stub review layer, for the browser test harness only.
//
// This is NOT the real review layer (src/layer/). It is a deliberately small
// stand-in that exposes exactly the surface the harness helpers read:
//
//   window.__lahe.counters.replayPasses     how many replay passes have run
//   window.__lahe.counters.regionsWritten   how many regions replay has written
//   window.__lahe.replayNow()               run one replay pass synchronously
//   window.__lahe.stub.*                    stub-only controls (see test/helpers/stub.js)
//
// It implements just enough of architecture D3 to make the two hard assertions
// meaningful, and no more:
//
//   - a region being edited is protected, so the page's repaint flows around it
//   - replay skips a protected region and a region holding the caret
//   - replay compares the fresh DOM against the record three ways: equals
//     `after` means already applied, so skip (this is what makes replay
//     idempotent); equals `before` means the page re-rendered the same content,
//     so re-apply; equals neither means the content genuinely changed, so write
//     nothing
//
// Every one of those behaviors can be switched off through
// window.__lahe.stub.configure(), which is what lets the harness self-tests
// prove the assertions actually fail when the behavior is missing. An assertion
// nobody has watched fail is theatre.
//
// When the real layer lands, load it instead of this file and rewrite
// test/helpers/stub.js. Nothing else in test/helpers/ knows this file exists.

(function () {
  "use strict";

  const ns = window.__lahe || (window.__lahe = {});
  const counters = ns.counters || (ns.counters = {});
  counters.replayPasses = 0;
  counters.regionsWritten = 0;
  counters.regionsSkippedIdentical = 0;
  counters.regionsSkippedProtected = 0;
  counters.regionsSkippedCaret = 0;
  counters.regionsBlockedChanged = 0;
  // Protection layer three. Counted separately from everything else because the
  // restore assertion's whole job is to prove a restore actually ran: text that
  // looks right because nothing ever damaged it is not layer three working.
  counters.caretRestores = 0;

  const config = {
    // Protect a region from the first touch until it commits. Turning this off
    // reproduces the pre-fix behavior: the page repaints under the caret.
    protectOnEdit: true,
    // Replay's three-way comparison. Turning this off makes replay rewrite every
    // committed region on every pass, which is the failure the idempotence
    // assertion exists to catch.
    idempotent: true,
    // Never write into a region holding the caret.
    respectCaret: true,
    // Protection LAYER THREE: snapshot the reviewer's text and caret, and put
    // them back after a repaint destroyed them. Off by default, because the
    // other two layers are what the ordinary tests exercise, and because a
    // restore running underneath them would hide their failures. This is the
    // only layer that survives the no-hook repaint flavor, and the caret it
    // restores is in a NEW node by construction, which is why it has its own
    // assertion rather than the node-identity one.
    snapshotRestore: false,
    // Commit a record when the region loses focus. On by default, and switched
    // off by the layer-three tests: a repaint that destroys the focused region
    // fires blur, the stub commits a record, and replay then writes that record
    // straight back. The page looks repaired, the restore never ran, and the
    // layer under test scores full marks for someone else's work. Turning this
    // off is how the layer-three tests are about layer three.
    commitOnBlur: true
  };

  const records = [];

  // A LOCAL normalizer, deliberately. The one normalizer lives in
  // src/shared/normalize.js and every part of the real tool imports it; this
  // stub keeps its own so the harness does not take a dependency on a module
  // another builder owns and is still changing. It is not the contract, and no
  // test should assert against it. When the real layer replaces this stub, this
  // function goes away with the rest of the file.
  function normalize(text) {
    return String(text).replace(new RegExp(String.fromCharCode(160),"g")," ").replace(new RegExp("\\s+","g")," ").trim();
  }

  function regionSelector(name) {
    return '[data-region="' + name + '"]';
  }

  function regionElement(name) {
    return document.querySelector(regionSelector(name));
  }

  function recordFor(name) {
    for (let i = 0; i < records.length; i += 1) {
      if (records[i].region === name) return records[i];
    }
    return null;
  }

  function protect(el) {
    el.setAttribute("data-lahe-protected", "");
    // Turbo's own opt out. The repaint engine in repaint-engine.js honors it the
    // way Turbo does, so the fixture is not simply being polite to us.
    el.setAttribute("data-turbo-permanent", "");
  }

  function unprotect(el) {
    el.removeAttribute("data-lahe-protected");
    el.removeAttribute("data-turbo-permanent");
  }

  function touch(event) {
    const el = event.currentTarget;
    const name = el.getAttribute("data-region");
    let rec = recordFor(name);
    if (!rec) {
      rec = {
        region: name,
        before: el.textContent,
        beforeHtml: el.innerHTML,
        after: null,
        afterHtml: null,
        committed: false,
        blocked: false,
        lostAnchor: false
      };
      records.push(rec);
    }
    if (config.protectOnEdit) protect(el);
  }

  function commit(name) {
    const el = regionElement(name);
    const rec = recordFor(name);
    if (!el || !rec) return null;
    rec.after = el.textContent;
    rec.afterHtml = el.innerHTML;
    rec.committed = true;
    unprotect(el);
    return Object.assign({}, rec);
  }

  function onBlur(event) {
    const el = event.currentTarget;
    // A repaint that removes the region fires blur on the way out. That is the
    // framework yanking the node, not the reviewer leaving the region, and
    // committing there records an `after` read off an element that is already
    // gone. It also hides protection layer three completely: the bogus record
    // gets replayed back into the page, so the text looks right, the restore
    // never ran, and the layer under test is never scored.
    if (!config.commitOnBlur || !el.isConnected) return;
    commit(el.getAttribute("data-region"));
  }

  function enableEditing(name) {
    const els = name
      ? [regionElement(name)]
      : Array.from(document.querySelectorAll("[data-region]"));
    const enabled = [];
    els.forEach(function (el) {
      if (!el) return;
      enabled.push(el.getAttribute("data-region"));
      if (el.dataset.laheEditable === "1") return;
      el.dataset.laheEditable = "1";
      el.setAttribute("contenteditable", "true");
      // D4: the platform must not quietly rewrite a word and have it recorded as
      // the reviewer's intent.
      el.setAttribute("spellcheck", "false");
      el.setAttribute("autocorrect", "off");
      el.setAttribute("autocapitalize", "off");
      el.addEventListener("focusin", touch);
      el.addEventListener("beforeinput", touch);
      el.addEventListener("blur", onBlur);
      // Layer three's snapshot. `input` fires synchronously after the keystroke
      // landed and before any MutationObserver callback, so the snapshot is
      // always ahead of the observer that reads it.
      el.addEventListener("input", function () {
        snapshotRegion(el);
      });
      el.addEventListener("keyup", function () {
        snapshotRegion(el);
      });
    });
    return enabled;
  }

  // -------------------------------------------------------------------------
  // Protection layer three: snapshot and restore
  // -------------------------------------------------------------------------
  //
  // A repaint destroys the text node the selection lives in before any observer
  // fires, so nothing can save that node. What can be saved is what the reviewer
  // typed and where their caret was in it, measured as a character offset in the
  // region rather than as a node reference. The MutationObserver notices the
  // damage after the fact and puts both back.
  //
  // Everything here is deliberately measured in CHARACTER OFFSETS. A node
  // reference is exactly the thing that just died.

  // Keyed by REGION NAME, never by element reference. The no-hook repaint
  // replaces the whole frame's innerHTML, so the region element itself is
  // destroyed, not just its children. A snapshot held against a node reference,
  // or an observer attached to the region, dies with the first repaint and
  // silently stops restoring: exactly the failure layer three exists to catch.
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
    // The anchor is the element itself rather than a text node.
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

  function snapshotRegion(el) {
    if (!config.snapshotRestore || restoring) return;
    const name = el.getAttribute("data-region");
    if (!name) return;
    snapshots[name] = { html: el.innerHTML, text: el.textContent, caret: caretOffsetIn(el) };
  }

  function restoreRegion(name) {
    const snap = snapshots[name];
    const el = regionElement(name);
    if (!snap || !el || el.textContent === snap.text) return false;
    restoring = true;
    try {
      el.innerHTML = snap.html;
      // The repaint rebuilt the region element too, so it came back without the
      // editing surface on it. Putting the text back and leaving the region dead
      // to the keyboard is not a restore. This is the stub's version of the
      // remount contract 2D owns in the real layer.
      enableEditing(name);
      el.focus();
      if (snap.caret !== null) placeCaretAt(el, snap.caret);
    } finally {
      restoring = false;
    }
    counters.caretRestores += 1;
    return true;
  }

  // ONE observer, on the document, not one per region. A repaint that replaces a
  // whole frame removes the region element, and an observer attached to that
  // element never fires again.
  const damageObserver = new MutationObserver(function () {
    if (!config.snapshotRestore || restoring) return;
    damageObserver.takeRecords();
    try {
      Object.keys(snapshots).forEach(function (name) {
        restoreRegion(name);
      });
    } catch (err) {
      // A throw inside a MutationObserver callback is easy to lose: the restore
      // half-runs, the counter never moves, and the failure reads as "layer
      // three did nothing". Keep it where a test can find it.
      ns.lastRestoreError = String(err && err.stack ? err.stack : err);
      throw err;
    }
  });

  function watchForDamage() {
    damageObserver.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
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
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (!rec.committed) continue;
      const el = regionElement(rec.region);
      if (!el) {
        rec.lostAnchor = true;
        continue;
      }
      if (el.hasAttribute("data-lahe-protected")) {
        counters.regionsSkippedProtected += 1;
        continue;
      }
      if (config.respectCaret && containsCaret(el)) {
        counters.regionsSkippedCaret += 1;
        continue;
      }
      if (config.idempotent) {
        const dom = normalize(el.textContent);
        if (dom === normalize(rec.after)) {
          counters.regionsSkippedIdentical += 1;
          continue;
        }
        if (dom !== normalize(rec.before)) {
          counters.regionsBlockedChanged += 1;
          rec.blocked = true;
          continue;
        }
      }
      // A real write replaces nodes, which is exactly why an unprotected replay
      // destroys the caret. Keep it that way; a nodeValue poke would make the
      // negative self-tests pass for the wrong reason.
      el.innerHTML = rec.afterHtml;
      counters.regionsWritten += 1;
    }
    return counters.replayPasses;
  }

  // The real layer schedules replay from a MutationObserver with a write epoch.
  // The stub listens for the repaint engine's event instead, so a pass lands
  // synchronously after each repaint and tests can poll a counter rather than
  // guess at microtask timing.
  document.addEventListener("lahe:repainted", function () {
    replayNow();
  });

  watchForDamage();

  ns.replayNow = replayNow;
  ns.ready = true;
  ns.stub = {
    enableEditing: enableEditing,
    commit: commit,
    normalize: normalize,
    configure: function (patch) {
      Object.keys(patch || {}).forEach(function (key) {
        config[key] = patch[key];
      });
      return Object.assign({}, config);
    },
    config: function () {
      return Object.assign({}, config);
    },
    records: function () {
      return records.map(function (rec) {
        return Object.assign({}, rec);
      });
    },
    /** Layer three, by hand, for a test that wants to drive it deterministically. */
    snapshotRegion: function (name) {
      const el = regionElement(name);
      if (el) snapshotRegion(el);
      const snap = snapshots[name];
      return snap ? { text: snap.text, caret: snap.caret } : null;
    }
  };
})();
