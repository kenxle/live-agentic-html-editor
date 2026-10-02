// Style rules: the style id, the hex colour and the style name, spelled once.
//
// Owner: Style switcher 1.1. Imported by: src/service/styles.js (install,
// serve, the installed list) and the layer's style switch, which re-checks the
// list it fetches. See docs/features/20260930.01_style_switcher/, architecture
// "Data / State Changes".
//
// An id arrives from outside Lahe's own code in five places (install, a served
// path, Markdown frontmatter, a note, the fetched list) and is checked against
// this one pattern in all of them. A value that fails is no style at all.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
// It depends on nothing.
(function (root) {
  "use strict";

  var browser = typeof window !== "undefined" && !!window.document;

  // Lowercase letters, digits and hyphens, starting with a letter or digit, at
  // most 40 characters.
  var ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

  // The house style. Always there, never installed.
  var RESERVED_ID = "international";
  var RESERVED_NAME = "International Style";

  // # plus 3, 4, 6 or 8 hex digits. A palette value reaches an inline style
  // only after this check.
  var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

  // A name is written into the note to the agent, so it is letters, digits,
  // spaces, hyphens, apostrophes and ampersands only, and cannot carry an
  // instruction's punctuation.
  var NAME_CHARS = /^[\p{L}\p{N} '&-]+$/u;
  var NAME_MAX = 40;
  var DESCRIPTION_MAX = 300;
  // Only the first six palette colours are shown.
  var PALETTE_MAX = 6;

  function isStyleId(value) {
    return typeof value === "string" && ID_PATTERN.test(value);
  }

  function isHexColour(value) {
    return typeof value === "string" && HEX.test(value);
  }

  function isStyleName(value) {
    return typeof value === "string" && value.length > 0 && value.length <= NAME_MAX &&
      value === value.trim() && NAME_CHARS.test(value);
  }

  var api = {
    ID_PATTERN: ID_PATTERN,
    RESERVED_ID: RESERVED_ID,
    RESERVED_NAME: RESERVED_NAME,
    HEX: HEX,
    NAME_CHARS: NAME_CHARS,
    NAME_MAX: NAME_MAX,
    DESCRIPTION_MAX: DESCRIPTION_MAX,
    PALETTE_MAX: PALETTE_MAX,
    isStyleId: isStyleId,
    isHexColour: isHexColour,
    isStyleName: isStyleName
  };

  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.styleRules = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
