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
// Controls: window.__lahe.fixture.* (see test/helpers/repaint.js).
// Counters: window.__lahe.counters.repaints and .repaintsVetoed.

(function () {
  "use strict";

  const ns = window.__lahe || (window.__lahe = {});
  const counters = ns.counters || (ns.counters = {});
  counters.repaints = 0;
  counters.repaintsVetoed = 0;

  const state = {
    flavor: "turbo-frame",
    intervalMs: 200,
    target: "[data-repaint-target]",
    protection: "veto",
    timer: null
  };

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

  function repaintTurboFrame(el, snap) {
    const staging = document.createElement("div");
    staging.innerHTML = snap.html;
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
      if (kind === "morph") {
        // The morph vetoes per element, so it is never skipped wholesale.
        repaintMorph(el, snap);
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
      running: !!state.timer
    };
  }

  snapshot();

  ns.fixture = {
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
        running: !!state.timer
      };
    }
  };
})();
