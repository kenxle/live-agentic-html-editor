// The fixture page's own re-render machinery. This stands in for the reviewed
// application, not for the tool, so it is harness-owned forever: it does not get
// swapped when the real review layer lands.
//
// It holds a "server" snapshot of each target subtree, taken at load, and writes
// that snapshot back on every repaint. That is the point. A repaint engine that
// does not actively try to revert what the reviewer typed makes every caret test
// theatre.
//
// Three flavors, because frameworks fail differently:
//
//   turbo-frame   replaces the target's children wholesale. Text nodes are
//                 destroyed, so the caret dies with them.
//   react-text    walks the target's text nodes and writes nodeValue in place.
//                 Node identity survives, so a caret assertion that only checks
//                 node identity passes while the reviewer's text is wiped. This
//                 is why the behavioral assertion checks the text too.
//   morph         a per-element morph, which is what idiomorph and therefore
//                 Turbo actually does. The veto applies to a single element and
//                 its subtree; the rest of the frame re-renders around it. This
//                 is the strongest repaint for a caret test, because the frame
//                 genuinely re-renders while the reviewer is typing.
//
// Three protection modes, so a test can watch the protection work and watch it
// fail:
//
//   veto        a target containing a protected element is skipped entirely.
//               This is Turbo's turbo:before-morph-element veto, and it is the
//               architecture's answer (D3).
//   permanent   the protected element is carried over into the new subtree by
//               id. This is data-turbo-permanent on its own, without the veto.
//   off         protection is ignored. This is the pre-fix behavior, and it is
//               what the negative self-tests use to prove the assertions bite.
//
// TWO HOOK FLAVORS, and this is what ranked test 1 (typed text does not revert)
// needs both of. 2B ships three protection layers, and the third one exists only
// because some frameworks offer nothing to cooperate with. A fixture that always
// offers a hook cannot tell a three-layer implementation from a one-layer one.
//
//   hooks "on"   (default) the engine behaves like a cooperative framework. It
//                fires a CANCELABLE pre-morph event on every element it is about
//                to touch (standing in for Turbo's turbo:before-morph-element),
//                and it honors a cooperative-skip attribute (standing in for
//                data-turbo-permanent) by carrying the live element over instead
//                of rebuilding it.
//   hooks "off"  the no-hook flavor. innerHTML is replaced wholesale, no events
//                are fired, no attribute is honored, and nothing can be vetoed.
//                Everything the reviewer typed is destroyed unless something
//                puts it back afterwards. This is the only flavor that scores
//                protection layer three.
//
// The veto event and the cooperative-skip attribute are TWO DIFFERENT framework
// features. A builder can implement one and believe they did both, so they are
// separate here, separately counted, and separately testable:
//
//   lahe:before-morph-element   cancelable, dispatched on the element
//   data-lahe-permanent         the cooperative-skip attribute
//
// Switchable two ways: ?repaint=no-hook in the fixture URL (so a test can pick
// the flavor before any script runs), or configure({ hooks: "off" }).
//
// Controls: window.__lahe.fixture.* (see test/helpers/repaint.js).
// Counters: window.__lahe.counters.repaints, .repaintsVetoed, .elementVetoes,
//           .elementsSkippedCooperative.

(function () {
  "use strict";

  const ns = window.__lahe || (window.__lahe = {});
  const counters = ns.counters || (ns.counters = {});
  counters.repaints = 0;
  counters.repaintsVetoed = 0;
  counters.elementVetoes = 0;
  counters.elementsSkippedCooperative = 0;

  // Standing in for Turbo's cancelable turbo:before-morph-element and for
  // data-turbo-permanent. Named here once so the harness README, the stub, and
  // whoever builds src/layer/protect.js all spell them the same way.
  const BEFORE_MORPH_ELEMENT = "lahe:before-morph-element";
  const SKIP_ATTRIBUTE = "data-lahe-permanent";

  // ?repaint=no-hook picks the flavor before any other script runs, which is how
  // a test gets a page whose framework never offered a hook in the first place.
  function hooksFromLocation() {
    try {
      const asked = new URL(window.location.href).searchParams.get("repaint");
      return asked === "no-hook" ? "off" : "on";
    } catch (err) {
      return "on";
    }
  }

  const state = {
    flavor: "turbo-frame",
    intervalMs: 200,
    target: "[data-repaint-target]",
    protection: "veto",
    hooks: hooksFromLocation(),
    timer: null
  };

  function hooksOn() {
    return state.hooks !== "off";
  }

  /**
   * The cancelable pre-morph event, on one element.
   *
   * Returns false when a listener called preventDefault, which is the veto: the
   * element and its whole subtree are left exactly as they are. Turbo's own
   * event works this way, and this is layer two of the three.
   */
  function morphAllowed(el) {
    if (!hooksOn()) return true;
    const event = new CustomEvent(BEFORE_MORPH_ELEMENT, {
      bubbles: true,
      cancelable: true,
      detail: { flavor: state.flavor }
    });
    const allowed = el.dispatchEvent(event);
    if (!allowed) counters.elementVetoes += 1;
    return allowed;
  }

  /** The cooperative-skip attribute, which is layer one and not layer two. */
  function cooperativelySkipped(el) {
    return hooksOn() && el.nodeType === 1 && el.hasAttribute(SKIP_ATTRIBUTE);
  }

  let server = new WeakMap();

  function targets() {
    return Array.from(document.querySelectorAll(state.target));
  }

  // Every subtree that COULD be a target, snapshotted at load whether or not it
  // is the current one. Pointing the engine at a different subtree must not make
  // that subtree's current contents become what the server believes; otherwise a
  // test that switches targets silently blesses whatever it just changed.
  function snapshotCandidates() {
    const seen = [];
    Array.from(document.querySelectorAll("[data-repaint-target]")).forEach(function (el) {
      seen.push(el);
    });
    targets().forEach(function (el) {
      if (seen.indexOf(el) === -1) seen.push(el);
    });
    return seen;
  }

  function textNodesIn(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const out = [];
    let node = walker.nextNode();
    while (node) {
      out.push(node);
      node = walker.nextNode();
    }
    return out;
  }

  function snapshot() {
    server = new WeakMap();
    const taken = [];
    snapshotCandidates().forEach(function (el) {
      server.set(el, {
        html: el.innerHTML,
        text: textNodesIn(el).map(function (node) {
          return node.nodeValue;
        })
      });
      taken.push(el.getAttribute("data-repaint-target") || el.id || el.tagName);
    });
    return taken;
  }

  function hasProtected(el) {
    return el.hasAttribute("data-lahe-protected") || !!el.querySelector("[data-lahe-protected]");
  }

  // The no-hook flavor: innerHTML, wholesale, no events, no attributes honored,
  // nothing skippable. A framework that offers a review tool nothing at all.
  function repaintNoHook(el, snap) {
    el.innerHTML = snap.html;
  }

  // Carry every cooperatively-skipped element across into the new subtree by id,
  // exactly as data-turbo-permanent does. The live node is MOVED, not copied, so
  // whatever the reviewer typed into it comes with it.
  function carryCooperativeSkips(el, staging) {
    if (!hooksOn()) return;
    const kept = {};
    Array.prototype.slice
      .call(el.querySelectorAll("[" + SKIP_ATTRIBUTE + "][id]"))
      .forEach(function (node) {
        kept[node.id] = node;
      });
    if (el.nodeType === 1 && el.hasAttribute(SKIP_ATTRIBUTE)) return;
    Array.prototype.slice.call(staging.querySelectorAll("[id]")).forEach(function (candidate) {
      const live = kept[candidate.id];
      if (live) {
        candidate.replaceWith(live);
        counters.elementsSkippedCooperative += 1;
      }
    });
  }

  function repaintTurboFrame(el, snap) {
    const staging = document.createElement("div");
    staging.innerHTML = snap.html;
    carryCooperativeSkips(el, staging);
    if (state.protection === "permanent") {
      const kept = {};
      Array.from(el.querySelectorAll("[data-lahe-protected][id]")).forEach(function (node) {
        kept[node.id] = node;
      });
      Array.from(staging.querySelectorAll("[id]")).forEach(function (candidate) {
        const live = kept[candidate.id];
        if (live) candidate.replaceWith(live);
      });
    }
    const incoming = Array.from(staging.childNodes);
    el.replaceChildren.apply(el, incoming);
  }

  // A per-element morph, which is what idiomorph (and therefore Turbo) actually
  // does. It walks the live tree against the server tree, updates text in place,
  // and leaves a vetoed element and its whole subtree completely alone. The rest
  // of the frame re-renders around it.
  //
  // This is the strongest repaint for a caret test: unlike the turbo-frame
  // flavor, which is vetoed for the entire frame, here the frame genuinely
  // re-renders while the reviewer is typing, and only the region they are in is
  // skipped.
  function morphNode(live, incoming) {
    const liveKids = Array.prototype.slice.call(live.childNodes);
    const newKids = Array.prototype.slice.call(incoming.childNodes);
    const length = Math.max(liveKids.length, newKids.length);

    for (let i = 0; i < length; i += 1) {
      const l = liveKids[i];
      const n = newKids[i];

      if (l && l.nodeType === 1 && state.protection !== "off" && l.hasAttribute("data-lahe-protected")) {
        // Vetoed. Not removed, not re-inserted, not descended into.
        counters.repaintsVetoed += 1;
        continue;
      }

      // Layer one: the cooperative-skip attribute. The framework flows around
      // the element because it was asked to, with no event and no listener.
      if (l && cooperativelySkipped(l)) {
        counters.elementsSkippedCooperative += 1;
        continue;
      }

      // Layer two: the cancelable event. A listener gets to refuse this element
      // in the moment, which is the only layer that can decide per repaint.
      if (l && l.nodeType === 1 && !morphAllowed(l)) {
        counters.repaintsVetoed += 1;
        continue;
      }

      if (l && n) {
        if (l.nodeType === 3 && n.nodeType === 3) {
          if (l.nodeValue !== n.nodeValue) l.nodeValue = n.nodeValue;
        } else if (l.nodeType === 1 && n.nodeType === 1 && l.tagName === n.tagName) {
          morphAttributes(l, n);
          morphNode(l, n);
        } else {
          l.replaceWith(n);
        }
      } else if (n) {
        live.appendChild(n);
      } else if (l) {
        l.remove();
      }
    }
  }

  function morphAttributes(live, incoming) {
    Array.prototype.slice.call(incoming.attributes).forEach(function (attr) {
      if (live.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
    });
    Array.prototype.slice.call(live.attributes).forEach(function (attr) {
      // The layer's own markers are the layer's business. A morph that stripped
      // data-lahe-protected would silently un-protect the region it is meant to
      // be flowing around.
      if (attr.name.indexOf("data-lahe-") === 0 || attr.name === "data-turbo-permanent") return;
      if (attr.name === "contenteditable" || attr.name === "spellcheck") return;
      if (!incoming.hasAttribute(attr.name)) live.removeAttribute(attr.name);
    });
  }

  function repaintMorph(el, snap) {
    const staging = document.createElement("div");
    staging.innerHTML = snap.html;
    morphNode(el, staging);
  }

  function repaintReactText(el, snap) {
    const nodes = textNodesIn(el);
    const limit = Math.min(nodes.length, snap.text.length);
    for (let i = 0; i < limit; i += 1) {
      const node = nodes[i];
      const owner0 = node.parentElement;
      if (owner0 && hooksOn() && owner0.closest("[" + SKIP_ATTRIBUTE + "]")) {
        counters.elementsSkippedCooperative += 1;
        continue;
      }
      if (owner0 && owner0.nodeType === 1 && !morphAllowed(owner0)) {
        counters.repaintsVetoed += 1;
        continue;
      }
      if (state.protection !== "off") {
        const owner = node.parentElement;
        if (owner && owner.closest("[data-lahe-protected]")) continue;
      }
      if (node.nodeValue !== snap.text[i]) node.nodeValue = snap.text[i];
    }
  }

  function repaintOnce(flavor) {
    const kind = flavor || state.flavor;
    targets().forEach(function (el) {
      const snap = server.get(el);
      if (!snap) return;
      if (!hooksOn()) {
        // No hook, no event, no attribute, no veto. Whatever is in there goes.
        repaintNoHook(el, snap);
        return;
      }
      if (kind === "morph") {
        // The morph vetoes per element, so it is never skipped wholesale.
        repaintMorph(el, snap);
        return;
      }
      // The frame-level veto. A listener on the frame refusing the event stops
      // the whole subtree from being rebuilt, which is what a turbo-frame
      // replacement gives a listener the chance to do.
      if (!morphAllowed(el)) {
        counters.repaintsVetoed += 1;
        return;
      }
      if (state.protection === "veto" && hasProtected(el)) {
        counters.repaintsVetoed += 1;
        return;
      }
      if (kind === "react-text") repaintReactText(el, snap);
      else repaintTurboFrame(el, snap);
    });
    counters.repaints += 1;
    document.dispatchEvent(new CustomEvent("lahe:repainted", { detail: { flavor: kind } }));
    return counters.repaints;
  }

  function stop() {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
    return counters.repaints;
  }

  function start(intervalMs) {
    stop();
    if (intervalMs) state.intervalMs = intervalMs;
    state.timer = window.setInterval(function () {
      repaintOnce();
    }, state.intervalMs);
    return state.intervalMs;
  }

  function configure(patch) {
    const next = patch || {};
    Object.keys(next).forEach(function (key) {
      state[key] = next[key];
    });
    // Only an explicit resnapshot changes what the server believes. Changing the
    // target selector does not, because every candidate subtree was snapshotted
    // at load.
    if (next.resnapshot) snapshot();
    return {
      flavor: state.flavor,
      intervalMs: state.intervalMs,
      target: state.target,
      protection: state.protection,
      hooks: state.hooks,
      running: !!state.timer
    };
  }

  snapshot();

  ns.fixture = {
    BEFORE_MORPH_ELEMENT: BEFORE_MORPH_ELEMENT,
    SKIP_ATTRIBUTE: SKIP_ATTRIBUTE,
    configure: configure,
    snapshot: snapshot,
    start: start,
    stop: stop,
    repaintOnce: repaintOnce,
    state: function () {
      return {
        flavor: state.flavor,
        intervalMs: state.intervalMs,
        target: state.target,
        protection: state.protection,
        hooks: state.hooks,
        running: !!state.timer
      };
    }
  };
})();
