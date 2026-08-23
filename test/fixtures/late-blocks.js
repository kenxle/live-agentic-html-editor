// The reviewed page's own renderer, in the shape that broke the highlights.
//
// test/fixtures/settling-render.js is the other shape: a passage on the page
// TWICE for a moment, which is a lost anchor. This one is the shape Ken hit on
// 2026-08-23. Everything the page will say is already in the document at load,
// but it is all in ONE container and none of it is in blocks yet, because the
// thing that makes blocks out of it (mermaid, a markdown renderer, a chart
// library swapping a figure in) has not run.
//
// While that is true, the innermost element holding any commented passage is
// that one container, so an anchor that binds by containment binds to the whole
// document, and a repaint that paints the resolved element paints everything.
//
// The timers live here, in the fixture, because this is the reviewed page's
// behaviour rather than a test waiting on anything. The spec polls for what
// they produce.

(function () {
  "use strict";

  var script = document.currentScript;
  var drawAt = Number(script.getAttribute("data-draw-ms") || 600);
  var heading = script.getAttribute("data-heading") || "";
  var passage = script.getAttribute("data-passage") || "";
  var tail = script.getAttribute("data-tail") || "";

  setTimeout(function () {
    var source = document.getElementById("source");
    if (!source) return;
    var built = document.createElement("div");
    built.id = "built";
    built.appendChild(block("h1", "heading", heading));
    built.appendChild(block("p", "passage", passage));
    built.appendChild(block("p", "tail", tail));
    source.parentNode.replaceChild(built, source);
  }, drawAt);

  function block(tag, id, text) {
    var el = document.createElement(tag);
    el.id = id;
    el.textContent = text;
    return el;
  }
})();
