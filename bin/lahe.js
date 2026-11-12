#!/usr/bin/env node
/*
 * read-when: Finding where the lahe command starts, or when its exit code or a startup crash looks wrong.
 */

// The command. There is no bin/ directory before this file, and no `bin` field
// in package.json yet either: 1A creates the entry point and wires `serve`, and
// 3B (install and add) adds the package.json field and the documented
// invocation alongside `add`.
//
// Everything real is in src/cli/index.js. This file exists so there is one path
// to type and one place the exit code is turned into a process exit.

// The Node check runs before anything else loads. Until it passes, this file
// uses only what a very old Node can parse and run: `var`, and `require("path")`
// without the `node:` prefix, which Node 14 and older reject. The clone's
// absolute path goes into the message so the user knows where to run the fix.
// See node_floor.js.

"use strict";

var path = require("path");
var floor = require("./node_floor.js");

if (require.main === module) {
  var tooOld = floor.problem(process.versions.node, path.resolve(__dirname, ".."));
  if (tooOld) {
    process.stderr.write("lahe: " + tooOld + "\n");
    process.exitCode = 1;
  } else {
    require("../src/cli/index.js")
      .main(process.argv.slice(2))
      .then(function (code) {
        process.exitCode = typeof code === "number" ? code : 0;
      })
      .catch(function (err) {
        process.stderr.write("lahe: " + (err && err.stack ? err.stack : String(err)) + "\n");
        process.exitCode = 1;
      });
  }
}
