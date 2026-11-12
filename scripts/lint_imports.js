/*
 * read-when: Lint reports a package import in an old .js file under src/ or bin/, or you are changing that check.
 */

// Lint check 5: an old .js file under src/ or in bin/ loads only a relative path
// or one of Node's own modules. Lahe has no runtime dependencies, and ESLint's
// no-restricted-imports only covers the .ts files, so without this a
// require("esbuild") in a .js file would pass the gate and break every clone
// that never ran npm install.
//
// The file is parsed with espree (installed with ESLint, which npm run lint
// needs anyway), so a package named in a comment or a string is not an import,
// and every form is seen: require(), import, export ... from, and import(). A
// require() or import() whose name is not a fixed string cannot be checked, so
// it fails too.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isBuiltin } = require("node:module");
const espree = require("espree");

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function allowed(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../") || isBuiltin(specifier);
}

function parse(text) {
  const options = { ecmaVersion: "latest", loc: true };
  try {
    return espree.parse(text, Object.assign({ sourceType: "commonjs" }, options));
  } catch (asScript) {
    return espree.parse(text, Object.assign({ sourceType: "module" }, options));
  }
}

/** The fixed string a module name node holds, or null when it is worked out at run time. */
function fixedName(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

/** Every module name the file loads, with its line; `name` is null when it is not a fixed string. */
function loads(ast) {
  const found = [];
  const visit = function (node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require") {
      found.push({ name: fixedName(node.arguments[0]), line: node.loc.start.line });
    } else if (node.type === "ImportExpression") {
      found.push({ name: fixedName(node.source), line: node.loc.start.line });
    } else if (
      (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      found.push({ name: fixedName(node.source), line: node.loc.start.line });
    }
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  return found;
}

/** One line per load in `files` that is not a relative path or a Node module, naming the file and line. */
function packageImports(files, root) {
  const problems = [];
  for (const file of files) {
    const where = relative(root, file);
    let ast;
    try {
      ast = parse(fs.readFileSync(file, "utf8").replace(/^#!.*/, ""));
    } catch (err) {
      problems.push(where + ": could not be parsed to check its imports (" + err.message + ")");
      continue;
    }
    for (const load of loads(ast)) {
      if (load.name === null) {
        problems.push(where + ":" + load.line + "  loads a module whose name is not a fixed string, so it cannot be checked");
      } else if (!allowed(load.name)) {
        problems.push(where + ":" + load.line + '  loads the package "' + load.name + '"');
      }
    }
  }
  return problems;
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Every .js file under src/ and directly in bin/. */
function filesToCheck(root) {
  const bin = path.join(root, "bin");
  const binFiles = fs.existsSync(bin)
    ? fs.readdirSync(bin, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
        .map((entry) => path.join(bin, entry.name))
    : [];
  return walk(path.join(root, "src"), []).concat(binFiles).sort();
}

module.exports = { packageImports, filesToCheck };
