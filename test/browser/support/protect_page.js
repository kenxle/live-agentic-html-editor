// Loading the REAL protection layer into a fixture page, for 2B's specs.
//
// Owner: 2B. This is spec support, not harness: nothing outside
// test/browser/protection_*.spec.js reads it, and it does not live in
// test/helpers/ because it knows about src/ and the helpers deliberately do not.
//
// Why it exists. The harness self-tests run against
// test/fixtures/assets/harness-stub.js, a stand-in layer. A protection spec that
// ran against the stub would be scoring the stub. So these specs load the real
// modules out of src/ with addScriptTag, in dependency order, and wire them up:
//
//   - the stub script is BLOCKED at the network (route.abort) on any fixture
//     page that loads it, so nothing but the real protect.js can protect
//     anything, veto anything, or restore anything;
//   - window.__lahe.counters gains live getters over the real modules'
//     counters, so the harness assertions read protect.js and replay.js rather
//     than a copy;
//   - replay is scheduled from a document-level MutationObserver. That wiring
//     belongs to 2D (living in the page) in the shipped library and does not
//     exist yet, so it stands in here rather than being smuggled into
//     protect.js.
//   - 0C's app fixture has no window.__lahe at all, so a small adapter gives
//     test/helpers/repaint.js the fixture surface it expects (repaintOnce,
//     start, stop) over the app's own poll-and-morph engine.
//
// dist/ is not involved: builders may not rebuild it, so a spec that loaded the
// bundle would depend on an artifact this branch cannot refresh.

"use strict";

const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

// Dependency order, the same order src/shared/manifest.js concatenates them in.
// Only what protection needs: loading the whole layer would boot modules other
// Phase 2 tasks are still writing.
const MODULE_FILES = [
  "src/shared/markers.js",
  "src/shared/normalize.js",
  "src/shared/record.js",
  "src/shared/uniqueness.js",
  "src/shared/epoch.js",
  "src/layer/selection.js",
  "src/layer/replay.js",
  "src/layer/protect.js"
];

/**
 * Stop the stub layer from ever loading on this page.
 *
 * Called before page.goto. The fixture page's own script tag still fires; the
 * request is refused, so window.__lahe.stub never exists and every protection
 * assertion in the spec is about src/layer/protect.js.
 */
async function blockStubLayer(page) {
  await page.route("**/assets/harness-stub.js", function (route) {
    return route.abort();
  });
}

/**
 * Load the real modules into the page and wire them up.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{layers?: string[]}} [options] which protection layers to install.
 *   Naming one layer is how ranked test 1 scores a layer on its own: the plan
 *   requires the three to be tested separately, and a run with all three on
 *   cannot tell which one saved the caret.
 */
async function loadRealLayer(page, options = {}) {
  for (const relative of MODULE_FILES) {
    await page.addScriptTag({ path: path.join(REPO_ROOT, relative) });
  }

  return page.evaluate(function (opts) {
    const L = window.LAHE;
    if (!L || !L.protect) throw new Error("the real layer did not load: window.LAHE.protect is missing");
    if (window.__lahe && window.__lahe.stub) {
      throw new Error(
        "the stub layer is loaded on this page. Call blockStubLayer(page) before goto, or these " +
          "specs score the stub rather than src/layer/protect.js."
      );
    }

    const ns = window.__lahe || (window.__lahe = {});
    const counters = ns.counters || (ns.counters = {});

    // Live getters, not copies. readCounters does Object.assign({}, counters),
    // which reads them, so every assertion sees the module's real number at the
    // moment it looked.
    function mirror(name, read) {
      Object.defineProperty(counters, name, { configurable: true, enumerable: true, get: read });
    }
    mirror("replayPasses", function () {
      return L.replay.counters.passes;
    });
    mirror("regionsWritten", function () {
      return L.replay.counters.regionsWritten;
    });
    ["marked", "vetoes", "snapshots", "restores", "restoreFailures"].forEach(function (name) {
      mirror(name, function () {
        return L.protect.counters[name];
      });
    });

    // 0C's app fixture: give the repaint helpers the surface they read. The app
    // engine polls a real endpoint, so repaintOnce is a promise and the helper
    // awaits it.
    if (window.__app && window.__app.morph) {
      const app = window.__app;
      mirror("repaints", function () {
        return app.counters.morphPasses || 0;
      });
      let chain = Promise.resolve();
      ns.fixture = {
        start: function () {
          app.morph.start();
          return app.morph.intervalMs;
        },
        stop: function () {
          app.morph.stop();
          return app.counters.morphPasses || 0;
        },
        repaintOnce: function () {
          chain = chain.then(function () {
            return app.morph.pollNow();
          });
          return chain;
        },
        configure: function () {
          return { flavor: app.morph.flavor, running: app.morph.polling };
        },
        snapshot: function () {
          return [];
        },
        state: function () {
          return { flavor: app.morph.flavor, intervalMs: app.morph.intervalMs, running: app.morph.polling };
        }
      };
    }

    // 2D's job in the shipped library: the page changed, so replay gets a pass.
    // Standing in for it here keeps protect.js out of the business of deciding
    // when replay runs.
    const scheduler = new MutationObserver(function () {
      L.replay.schedule(L.replay.REASON.MUTATION);
    });
    scheduler.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });

    const handle = L.protect.install({ layers: opts.layers });

    // 2A's editing surface does not exist yet. A protection spec still has to
    // put a block in the state the reviewer would put it in, so the spec does
    // the two things 2A will do: make the block editable, and mark it.
    ns.enterEdit = function (selector) {
      const el = document.querySelector(selector);
      if (!el) throw new Error("enterEdit: no element matches " + selector);
      el.setAttribute("contenteditable", "true");
      el.setAttribute("spellcheck", "false");
      el.focus();
      L.protect.mark(el, { reason: "edit_block" });
      return { selector: selector, key: L.protect.regionKeyFor(el).value };
    };

    ns.commitEdit = function (selector) {
      const el = document.querySelector(selector);
      if (!el) throw new Error("commitEdit: no element matches " + selector);
      el.removeAttribute("contenteditable");
      return L.protect.release(el);
    };

    ns.protectHandle = handle;
    ns.real = L;
    return { layers: handle.layers, frameworks: handle.frameworks };
  }, { layers: options.layers || null });
}

/** The identity of the node currently holding a selector, for survival tests. */
async function tagNode(page, selector, token) {
  return page.evaluate(function (args) {
    const el = document.querySelector(args.selector);
    if (!el) throw new Error("tagNode: no element matches " + args.selector);
    const reg = window.__laheNodes || (window.__laheNodes = {});
    reg[args.token] = el;
    return { text: el.textContent };
  }, { selector: selector, token: token });
}

/** True when the selector still resolves to the very node tagNode remembered. */
async function nodeStillIdentical(page, selector, token) {
  return page.evaluate(function (args) {
    const reg = window.__laheNodes || {};
    const remembered = reg[args.token];
    const live = document.querySelector(args.selector);
    return {
      identical: !!remembered && remembered === live,
      connected: !!remembered && remembered.isConnected,
      text: live ? live.textContent : null
    };
  }, { selector: selector, token: token });
}

module.exports = {
  MODULE_FILES,
  blockStubLayer,
  loadRealLayer,
  tagNode,
  nodeStillIdentical
};
