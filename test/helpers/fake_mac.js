// A Mac, played, for the menu bar tests (test/unit/menubar*.test.js and the
// menu bar half of install_command.test.js). No real xcrun, swiftc or
// launchctl runs.
//
//   xcrun --find swiftc   answers, or fails the way a Mac without Apple's
//                         command line tools does
//   xcrun swiftc          "compiles" by writing the Swift source it was given
//                         into the -o file, so a test can tell which copy of
//                         the source was built
//   launchctl             keeps a loaded and running flag per label: bootstrap
//                         loads and starts (RunAtLoad), bootout unloads,
//                         kickstart starts a loaded job and exits 113 for an
//                         unknown one, print reports "state = running" or not
//
// `handles(command, args)` says whether a call is the Mac's to answer, so a
// test can put this in front of another fake service manager.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const XCRUN = "/usr/bin/xcrun";

function fakeMac(options) {
  const opts = Object.assign({ swiftc: true, compiles: true, labels: null }, options || {});
  const calls = [];
  const jobs = {};
  function job(target) {
    const label = target.split("/").pop();
    jobs[label] = jobs[label] || { loaded: false, running: false };
    return jobs[label];
  }
  function handles(command, args) {
    if (command === XCRUN) return true;
    if (command !== "launchctl") return false;
    if (!opts.labels) return true;
    const target = args[args.length - 1];
    return opts.labels.some((label) => target.endsWith("/" + label) || target.endsWith("/" + label + ".plist"));
  }
  const runner = (command, args) => {
    calls.push([command].concat(args));
    if (command === XCRUN && args[0] === "--find") {
      return opts.swiftc
        ? { status: 0, output: "/Library/Developer/CommandLineTools/usr/bin/swiftc\n" }
        : { status: 1, output: "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun" };
    }
    if (command === XCRUN && args[0] === "swiftc") {
      if (!opts.compiles) return { status: 1, output: "LaheMenuBar.swift:3:1: error: expected expression" };
      const out = args[args.indexOf("-o") + 1];
      const sources = args.filter((a) => a.endsWith(".swift"));
      fs.writeFileSync(out, sources.map((s) => fs.readFileSync(s, "utf8")).join(""));
      return { status: 0, output: "" };
    }
    if (command === "launchctl") {
      const verb = args[0];
      if (verb === "bootstrap") {
        const label = path.basename(args[2], ".plist");
        jobs[label] = { loaded: true, running: true };
        return { status: 0, output: "" };
      }
      const j = job(args[args.length - 1]);
      if (verb === "bootout") {
        const was = j.loaded;
        j.loaded = false;
        j.running = false;
        return was ? { status: 0, output: "" } : { status: 3, output: "Boot-out failed: 3: No such process" };
      }
      if (!j.loaded) return { status: 113, output: "Could not find service in domain for user gui: 501" };
      if (verb === "kickstart") { j.running = true; return { status: 0, output: "" }; }
      if (verb === "print") return { status: 0, output: "gui/501/x = {\n\tstate = " + (j.running ? "running" : "not running") + "\n}\n" };
    }
    return { status: 0, output: "" };
  };
  return { runner, calls, jobs, handles, job: (label) => jobs[label] || { loaded: false, running: false } };
}

/** The app's source, in the fixed file list's shape, under <clone>/macos/menubar. */
function writeMenubarSources(clone, swift) {
  const dir = path.join(clone, "macos", "menubar");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "LaheMenuBar.swift"), swift);
  fs.writeFileSync(path.join(dir, "Info.plist"), "<plist><dict><key>CFBundleExecutable</key><string>Lahe</string></dict></plist>\n");
  // Not on the fixed list: never copied, never part of the stamp.
  fs.writeFileSync(path.join(dir, "README.md"), "notes\n");
}

module.exports = { fakeMac, writeMenubarSources, XCRUN };
