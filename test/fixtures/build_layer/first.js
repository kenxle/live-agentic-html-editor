(function (root) {
  "use strict";
  var api = { sawMiddle: !!(root.LAHE && root.LAHE.middle) };
  if (typeof window !== "undefined" && !!window.document) {
    root.LAHE = root.LAHE || {};
    root.LAHE.first = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
