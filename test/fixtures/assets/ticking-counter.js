// A page that changes itself: the countdown, the slide number, and a status
// line that rewrites itself in words rather than digits.
//
// This is the thing the change mark must never light up. It lives here rather
// than inside the spec because a fixture is allowed to have a timer and a test
// file is not (test/unit/no_arbitrary_sleeps.test.js), and change_highlight's
// page is built in a temp directory, so the spec reads this file and inlines it.
(function () {
  "use strict";
  var ticks = 0;
  var lines = [
    "Recalculating the pace band for this week right now.",
    "Holding the pace band steady for this week right now."
  ];
  function paint() {
    ticks += 1;
    var clock = document.getElementById("clock");
    var pagenum = document.getElementById("pagenum");
    var status = document.getElementById("status");
    if (clock) clock.textContent = "0:" + (10 + (ticks % 40));
    if (pagenum) pagenum.textContent = (1 + (ticks % 9)) + " / 40";
    if (status) status.textContent = lines[ticks % 2];
  }
  paint();
  setInterval(paint, 200);
})();
