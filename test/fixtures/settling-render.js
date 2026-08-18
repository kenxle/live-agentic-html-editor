// The reviewed page's own renderer, in miniature: what mermaid does to a
// section of a report a few hundred milliseconds after load.
//
// It runs in two beats, and the gap between them is the whole point. First the
// drawn copy goes in beside the source it was given, so for a moment the
// passage is on the page TWICE, which is a lost anchor exactly like being on it
// zero times: nothing can be written or moved when two places match. Then the
// source comes out and one copy is left.
//
// `data-mode` on this script tag says what the finished render leaves behind:
//   "same"  the passage, in the drawn section: a re-render, nothing is lost
//   "gone"  a diagram and no passage: a genuine loss
//
// The timers live here, in the fixture, because they are the reviewed page's
// behaviour rather than a test waiting on anything. The spec never waits out
// these numbers; it polls for what they produce.

(function () {
  "use strict";

  var script = document.currentScript;
  var mode = script.getAttribute("data-mode") || "same";
  var passage = script.getAttribute("data-passage") || "";
  var drawAt = Number(script.getAttribute("data-draw-ms") || 300);
  var removeAt = Number(script.getAttribute("data-remove-ms") || 700);
  var source = document.getElementById("source");

  setTimeout(function () {
    var drawn = document.createElement("section");
    drawn.id = "drawn";
    drawn.innerHTML =
      mode === "gone"
        ? '<p id="diagram">A diagram stands here now.</p>'
        : '<p id="passage">' + passage + "</p>";
    source.parentNode.insertBefore(drawn, source);
  }, drawAt);

  setTimeout(function () {
    source.remove();
  }, removeAt);
})();
