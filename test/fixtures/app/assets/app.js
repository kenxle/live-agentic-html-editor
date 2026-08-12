// The app fixture's own JavaScript. This is the reviewed application's code, not
// the tool's: it is what D3 (browse is fully native) promises will keep working
// once the library is on the page.
//
// It owns one namespace, window.__app, deliberately separate from the harness's
// window.__lahe, so a test can never confuse "the app still works" with "the
// harness still works".

(function () {
  "use strict";

  const app = window.__app || (window.__app = {});
  const counters = app.counters || (app.counters = {});

  counters.sessionClicks = 0;
  counters.feedPolls = 0;
  counters.morphPasses = 0;
  counters.morphedElements = 0;
  counters.morphsSkipped = 0;

  function wireSessionLogger() {
    const button = document.getElementById("log-session");
    const output = document.getElementById("session-count");
    if (!button || !output) return;

    button.addEventListener("click", function () {
      counters.sessionClicks += 1;
      output.textContent = String(counters.sessionClicks);
    });
  }

  wireSessionLogger();
})();
