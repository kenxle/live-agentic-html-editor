// read-when: A test needs a row of the route table in docs/ongoing/code/contract.md, the one place the requests and answers of each route are written.

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONTRACT_DOC = path.join(__dirname, "..", "..", "docs", "ongoing", "code", "contract.md");

function routeRow(name) {
  const row = fs.readFileSync(CONTRACT_DOC, "utf8").split("\n").filter((line) => line.startsWith("| `" + name + "` |"))[0];
  assert.ok(row, "docs/ongoing/code/contract.md has a row for " + name);
  return row;
}

module.exports = { routeRow };
