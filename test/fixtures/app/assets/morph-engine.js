// The app fixture's poll-and-morph engine: the reviewed application rewriting
// its own page underneath whoever is reading it.
//
// Plan task 0C, and the reason ranked test 1 (typed text does not revert) can be
// written honestly. Two flavors, chosen with the `morph` query parameter:
//
//   hooked (default)  A per-element morph that offers two ways to be told no,
//                     both modelled on Turbo: a cooperative-skip attribute
//                     (data-app-permanent, standing in for data-turbo-permanent)
//                     and a cancelable pre-morph element event
//                     (app:before-morph-element, standing in for
//                     turbo:before-morph-element). The element node survives; its
//                     contents are rewritten.
//
//   raw               No hook of any kind. The container's innerHTML is replaced
//                     wholesale, the attribute means nothing, no event is fired,
//                     and every node inside is destroyed. This is the framework
//                     that gives the library nothing, and the library still has
//                     to keep the reviewer's caret and text alive against it
//                     (D7's third layer, the selection snapshot and restore).
//
// A framework that only ever offered the polite path would let a library pass
// every test by being polite back, which is exactly the shape of the bug this
// project exists to kill.
//
// The timer here is the application's own behavior. The no-arbitrary-sleeps rule
// (test/unit/no_arbitrary_sleeps.test.js) is about the TEST waiting, and it skips
// test/fixtures for this reason: a page that repaints on a timer is the thing
// under test, not a guess about how long something takes.
//
// Controls and instruments:
//
//   window.__app.morph.flavor        'hooked' | 'raw'
//   window.__app.morph.intervalMs    poll period, set with ?poll=<ms>
//   window.__app.morph.start()       start polling (already started on load)
//   window.__app.morph.stop()        stop polling
//   window.__app.morph.pollNow()     one pass now, resolves when it has applied
//   window.__app.counters.feedPolls, .morphPasses, .morphedElements, .morphsSkipped

(function () {
  "use strict";

  const app = window.__app || (window.__app = {});
  const counters = app.counters || (app.counters = {});

  const FLAVORS = ["hooked", "raw"];
  const PERMANENT_ATTRIBUTE = "data-app-permanent";
  const BEFORE_MORPH_EVENT = "app:before-morph-element";
  const DEFAULT_INTERVAL_MS = 250;

  const params = new URLSearchParams(window.location.search);

  const requestedFlavor = params.get("morph") || "hooked";
  if (FLAVORS.indexOf(requestedFlavor) === -1) {
    // Fail loud. A typo'd flavor silently falling back to the polite one would
    // make a whole ranked test pass for the wrong reason.
    throw new Error(
      "app fixture: unknown morph flavor " + JSON.stringify(requestedFlavor) + ". Use one of: " + FLAVORS.join(", ")
    );
  }

  const requestedInterval = Number(params.get("poll"));
  const intervalMs = Number.isFinite(requestedInterval) && requestedInterval > 0 ? requestedInterval : DEFAULT_INTERVAL_MS;

  const container = document.querySelector("[data-morph-target]");

  const state = {
    flavor: requestedFlavor,
    intervalMs: intervalMs,
    timer: null,
    inFlight: false
  };

  function morphHooked(incoming) {
    incoming.forEach(function (next) {
      const existing = next.id ? document.getElementById(next.id) : null;

      if (!existing || !container.contains(existing)) {
        container.appendChild(next);
        counters.morphedElements += 1;
        return;
      }

      // Layer one: the cooperative-skip attribute. Checked before the event, the
      // way Turbo checks data-turbo-permanent, so an element can be kept without
      // anyone listening for anything.
      if (existing.hasAttribute(PERMANENT_ATTRIBUTE)) {
        counters.morphsSkipped += 1;
        return;
      }

      // Layer two: the cancelable pre-morph element event. It bubbles, so a
      // listener on the document sees every element about to be rewritten, and
      // preventDefault means "not this one".
      const event = new CustomEvent(BEFORE_MORPH_EVENT, {
        bubbles: true,
        cancelable: true,
        detail: { newElement: next, flavor: state.flavor }
      });
      const proceed = existing.dispatchEvent(event);
      if (!proceed) {
        counters.morphsSkipped += 1;
        return;
      }

      // The element node itself survives; its contents are rewritten. This is
      // what idiomorph, and therefore Turbo, actually does.
      existing.innerHTML = next.innerHTML;
      counters.morphedElements += 1;
    });
  }

  function morphRaw(incoming, html) {
    // No event, no attribute check, no survivors. Every node under the container
    // is destroyed and replaced, including the text node a caret was living in.
    container.innerHTML = html;
    counters.morphedElements += incoming.length;
  }

  function applyFeed(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const incoming = Array.prototype.slice.call(template.content.children);

    if (state.flavor === "hooked") {
      morphHooked(incoming);
    } else {
      morphRaw(incoming, html);
    }

    counters.morphPasses += 1;
  }

  function pollNow() {
    if (!container || state.inFlight) return Promise.resolve(false);
    state.inFlight = true;
    counters.feedPolls += 1;

    return fetch("/api/feed", { headers: { Accept: "text/html" } })
      .then(function (response) {
        if (!response.ok) throw new Error("app fixture: the feed poll failed with " + response.status);
        return response.text();
      })
      .then(function (html) {
        applyFeed(html);
        return true;
      })
      .finally(function () {
        state.inFlight = false;
      });
  }

  function start() {
    if (!container || state.timer !== null) return;
    state.timer = window.setInterval(pollNow, state.intervalMs);
  }

  function stop() {
    if (state.timer === null) return;
    window.clearInterval(state.timer);
    state.timer = null;
  }

  app.morph = {
    get flavor() {
      return state.flavor;
    },
    get intervalMs() {
      return state.intervalMs;
    },
    get polling() {
      return state.timer !== null;
    },
    hasTarget: Boolean(container),
    permanentAttribute: PERMANENT_ATTRIBUTE,
    beforeMorphEvent: BEFORE_MORPH_EVENT,
    start: start,
    stop: stop,
    pollNow: pollNow
  };

  start();
})();
