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
    // The wording alternates, and the pass number never repeats. The alternation
    // is the point of this line: a self-changing block written in words rather
    // than digits, which the counter guard must not be what saves it. The pass
    // number is what makes the test of that deterministic. The tool reads this
    // page twice and excludes whatever moved in between, so a line with only two
    // values is excluded only when the two readings happen to land an odd number
    // of ticks apart: a coin flip, decided by how fast the machine is, and it
    // came up tails on CI. A value that never repeats is different at any two
    // moments, which is what the rule is actually meant to be tested against.
    if (status) status.textContent = lines[ticks % 2] + " Pass " + ticks + ".";
  }
  paint();
  setInterval(paint, 200);
})();
