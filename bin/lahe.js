#!/usr/bin/env node
// The command. There is no bin/ directory before this file, and no `bin` field
// in package.json yet either: 1A creates the entry point and wires `serve`, and
// 3B (install and add) adds the package.json field and the documented
// invocation alongside `add`.
//
// Everything real is in src/cli/index.js. This file exists so there is one path
// to type and one place the exit code is turned into a process exit.

"use strict";

require("../src/cli/index.js")
  .main(process.argv.slice(2))
  .then(function (code) {
    process.exitCode = typeof code === "number" ? code : 0;
  })
  .catch(function (err) {
    process.stderr.write("lahe: " + (err && err.stack ? err.stack : String(err)) + "\n");
    process.exitCode = 1;
  });
