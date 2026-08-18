// `npm run install-cli`: put `lahe` somewhere the shell will actually find it.
//
// THE TRAP THIS EXISTS FOR. `npm link` puts the `lahe` symlink in the bin
// directory of WHICHEVER NODE RAN IT. Under nvm that is
// ~/.nvm/versions/node/vXX/bin, which is on PATH only while that version is
// selected. So the install prints success, and then `lahe` is command-not-found
// in every ordinary shell, which is a confusing failure for something whose
// whole promise is "clone it and it works".
//
// WHAT THIS WRITES. One executable shell wrapper at ~/.local/bin/lahe:
//
//   #!/bin/sh
//   # lahe wrapper written by scripts/install-cli.js
//   exec "/absolute/path/to/node" "/absolute/path/to/repo/bin/lahe.js" "$@"
//
// Both paths are absolute, so the wrapper keeps working whatever node is on
// PATH, whatever nvm is doing, and from any directory. ~/.local/bin is the
// conventional per-user bin directory and is already on PATH on most systems;
// when it is not, this says so and prints the line to add.
//
// IT NEVER OVERWRITES SOMETHING THAT IS NOT ITS OWN. The wrapper carries a
// marker comment, and a file at that path without the marker is left exactly
// where it is with a printed reason: silently replacing another tool's binary
// is a worse outcome than an install that did not finish.
//
// Node-only. No dependencies, like everything else here.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var MARKER = "# lahe wrapper written by scripts/install-cli.js";
var REPO_ROOT = path.join(__dirname, "..");
var ENTRY = path.join(REPO_ROOT, "bin", "lahe.js");

/**
 * The bytes of the wrapper.
 *
 * @param {{node: string, entry: string}} paths both absolute
 */
function wrapperSource(paths) {
  return [
    "#!/bin/sh",
    MARKER,
    "# Both paths are absolute on purpose: this must not depend on PATH or on nvm.",
    'exec "' + paths.node + '" "' + paths.entry + '" "$@"',
    ""
  ].join("\n");
}

/** Was this file written by this script? The marker is the whole test. */
function isOurWrapper(text) {
  return typeof text === "string" && text.indexOf(MARKER) !== -1;
}

/**
 * Decide what to do about the target path, without touching the filesystem.
 *
 * @param {{exists: boolean, current: string|null}} state
 * @returns {{action: "write"|"replace"|"refuse", why: string}}
 */
function decide(state) {
  if (!state.exists) return { action: "write", why: "nothing is at that path" };
  if (isOurWrapper(state.current)) return { action: "replace", why: "it is a lahe wrapper this script wrote" };
  return {
    action: "refuse",
    why: "something else is already at that path and this script did not write it"
  };
}

/** Is the directory on PATH, as the shell would see it? */
function onPath(dir, pathEnv) {
  return String(pathEnv || "")
    .split(path.delimiter)
    .filter(Boolean)
    .some(function (entry) {
      return path.resolve(entry) === path.resolve(dir);
    });
}

/**
 * @param {{home?: string, node?: string, entry?: string, pathEnv?: string,
 *          stdout?: function, stderr?: function}} [options]
 * @returns {number} the exit code
 */
function install(options) {
  var opts = options || {};
  var home = opts.home || os.homedir();
  var nodePath = opts.node || process.execPath;
  var entry = opts.entry || ENTRY;
  var pathEnv = opts.pathEnv === undefined ? process.env.PATH : opts.pathEnv;
  var out = opts.stdout || function (text) {
    process.stdout.write(text);
  };
  var err = opts.stderr || function (text) {
    process.stderr.write(text);
  };

  var binDir = path.join(home, ".local", "bin");
  var target = path.join(binDir, "lahe");

  var exists = fs.existsSync(target);
  var current = null;
  if (exists) {
    try {
      current = fs.readFileSync(target, "utf8");
    } catch (error) {
      current = null;
    }
  }

  var verdict = decide({ exists: exists, current: current });
  if (verdict.action === "refuse") {
    err(
      "lahe install-cli: leaving " +
        target +
        " alone, because " +
        verdict.why +
        ".\nMove or rename it, then run this again, or run `npm link` instead.\n"
    );
    return 1;
  }

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(target, wrapperSource({ node: nodePath, entry: entry }), { mode: 0o755 });
  // Written again explicitly: writeFileSync honors the mode only when it
  // creates the file, so replacing an older wrapper would otherwise keep
  // whatever mode that one had.
  fs.chmodSync(target, 0o755);

  out(
    [
      "lahe install-cli: " + (verdict.action === "replace" ? "replaced" : "wrote") + " " + target,
      "  node   " + nodePath,
      "  lahe   " + entry,
      ""
    ].join("\n")
  );

  if (!onPath(binDir, pathEnv)) {
    out(
      [
        "  " + binDir + " is not on your PATH, so the shell will not find `lahe` yet.",
        "  Add this to your shell profile (~/.zshrc or ~/.bashrc), then open a new shell:",
        "",
        '    export PATH="' + binDir + ':$PATH"',
        ""
      ].join("\n")
    );
  } else {
    out(["  Check it: lahe --help || echo \"not on PATH\"", ""].join("\n"));
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = install();
}

module.exports = {
  MARKER: MARKER,
  ENTRY: ENTRY,
  wrapperSource: wrapperSource,
  isOurWrapper: isOurWrapper,
  decide: decide,
  onPath: onPath,
  install: install
};
