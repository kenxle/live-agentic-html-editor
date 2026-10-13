#!/usr/bin/env node
"use strict";
// check:menubar, part of `npm run gate`.
//
// On macOS: build the menu bar app with the one recipe in
// src/service/menubar.js and run the app's --self-test. Anywhere else, and on
// a Mac before the recipe exists, print one line and exit 0: the app is an
// optional Mac extra, and the gate must stay green on Linux CI and on a fresh
// clone. The install workstream (menu bar plan, Task 3.1) fills in the build
// and self-test below; the orchestrator wrote this skeleton in Step 0.
var fs = require("fs");
var path = require("path");

if (process.platform !== "darwin") {
  console.log("check:menubar skipped: the menu bar app is macOS only");
  process.exit(0);
}

var recipe = path.join(__dirname, "..", "src", "service", "menubar.js");
if (!fs.existsSync(recipe)) {
  console.log("check:menubar skipped: src/service/menubar.js is not written yet (menu bar plan, Task 3.1)");
  process.exit(0);
}

console.log("check:menubar: src/service/menubar.js exists but this script does not call it yet (Task 3.1 fills it in)");
process.exit(1);
