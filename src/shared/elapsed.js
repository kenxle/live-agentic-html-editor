// How long something has been going on, in words a person reads.
//
// Owner: 0A-kernel.
//
// ONE HOME, TWO CALLERS. The helper says it in the second-window refusal it
// sends back (src/service/reviews.js), and the rail says it again on the chip it
// draws from that refusal (src/layer/overlay.js). Both used to spell it
// themselves, so the reviewer could read "for the last 4 minutes" from one and
// "since 2026-08-18T04:35:45.006Z" from the other about the same window. A raw
// ISO timestamp is machine output in a sentence written for a person.
//
// The rule, and it is the whole module:
//
//   under a minute      "for less than a minute"
//   under 90 minutes    "for the last 12 minutes"
//   older               "since " plus a local date and time
//
// An unparseable value is passed through as "since <whatever it was>" rather
// than guessed at: a wrong duration is worse than an honest echo.
//
// Dual-environment module, no dependencies, so it uses the short wrapper form.
// See docs/CONTRACTS.md, "How a shared module loads".
(function (root) {
  "use strict";

  var RECENT_MINUTES_MAX = 90;

  /**
   * @param {string|number|Date} since when it started: an ISO string, epoch ms,
   *   or a Date
   * @param {{now?: number}} [options] `now` in epoch ms, so a test can pin the
   *   clock instead of sleeping
   * @returns {string} a phrase that follows a verb, as in "holding it <phrase>"
   */
  function elapsedPhrase(since, options) {
    var opts = options || {};
    var startedAt = since instanceof Date ? since : new Date(since);
    if (isNaN(startedAt.getTime())) return "since " + String(since);
    var now = typeof opts.now === "number" ? opts.now : Date.now();
    var seconds = Math.max(0, Math.round((now - startedAt.getTime()) / 1000));
    if (seconds < 60) return "for less than a minute";
    if (seconds < RECENT_MINUTES_MAX * 60) {
      var minutes = Math.round(seconds / 60);
      return "for the last " + minutes + (minutes === 1 ? " minute" : " minutes");
    }
    return "since " + startedAt.toLocaleString();
  }

  var api = {
    RECENT_MINUTES_MAX: RECENT_MINUTES_MAX,
    elapsedPhrase: elapsedPhrase
  };

  if (typeof window !== "undefined" && !!window.document) {
    root.LAHE = root.LAHE || {};
    root.LAHE.elapsed = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
