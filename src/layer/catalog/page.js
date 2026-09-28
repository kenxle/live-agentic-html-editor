// The Library page script. PLACEHOLDER from Library Task 1.2; Task 2.2 replaces
// this file whole (the poll, the view model, rendering, Open's tab sequence).
//
// Served raw from src/ by catalog.asset, never bundled into dist/. It runs
// under script-src 'self', so it reads the Library token from the page's meta
// tag, and every name (the meta name, header names, route paths) from
// protocol.js, which the page loads first.
//
// Browser-only.

(function () {
  "use strict";
  var protocol = window.LAHE && window.LAHE.protocol;
  var status = document.getElementById("lahe-catalog-status");
  if (!protocol) {
    if (status) status.textContent = "The Library could not load its protocol file.";
    return;
  }
  var meta = document.querySelector('meta[name="' + protocol.CATALOG_TOKEN_META + '"]');
  if (status) {
    status.textContent = meta && meta.content ? "The Library page is being built." : "The Library token is missing. Reload this page.";
  }
})();
