(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.last = factory(root.LAHE.middle);
  } else {
    module.exports = factory(require("./node_only.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (middle) {
  "use strict";
  var VERSION = "0.0.0-dev";
  return { greeting: middle.greet("reviewer"), version: VERSION };
});
