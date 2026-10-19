// Lint check 1b: a function declared twice at a file's top level.
//
// Compiled, never run: the file's text goes inside a strict-mode block inside a
// function. In a strict block a function declaration is lexical, so a second one
// with the same name is a SyntaxError, the same one Playwright's parser raises.
// The function wrapper keeps a CommonJS top-level `return` legal. Only the
// "already been declared" error is reported; anything else the wrapper trips on
// is not this check's business, and lint's syntax check covers real errors.

"use strict";

const fs = require("node:fs");
const vm = require("node:vm");

/** The error message when `file` declares a name twice at its top level, else null. */
function duplicateDeclaration(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^#!.*/, "");
  try {
    new vm.Script('(function () { "use strict"; {\n' + text + "\n} })", { filename: file });
  } catch (err) {
    if (/has already been declared/.test(err.message)) return err.message;
  }
  return null;
}

module.exports = { duplicateDeclaration };
