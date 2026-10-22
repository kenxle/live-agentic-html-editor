// Lint check 1c: a syntax check for the Lua files under src/ (today, the pandoc
// filter src/service/lahe_render.lua). Lint used to read .js files only, so the
// filter got no check at all (LAHE-lint-non-js-files).
//
// Compiled, never run. `luac -p` when the machine has it; otherwise pandoc's
// own Lua, which is the interpreter the filter really runs in, compiles the
// file with loadfile and stops. With neither, the check is skipped and lint
// says so: pandoc is optional (CLAUDE.md), and a machine without it never runs
// the filter either.

"use strict";

const { spawnSync } = require("node:child_process");

const LOADFILE =
  'local f, e = loadfile(os.getenv("LAHE_LINT_LUA")); if not f then io.stderr:write(e, "\\n"); os.exit(1) end';

/** True when the program runs and exits 0 with these arguments. */
function runs(file, args) {
  const result = spawnSync(file, args, { stdio: "pipe" });
  return !result.error && result.status === 0;
}

/**
 * The Lua compiler this machine has, or null.
 * @returns {{name: string, file: string, args: function(string): string[]}|null}
 */
function findLuaChecker() {
  for (const name of ["luac", "luac5.4", "luac5.3"]) {
    if (runs(name, ["-v"])) return { name, file: name, args: (file) => ["-p", file] };
  }
  if (runs("pandoc", ["lua", "-e", "os.exit(0)"])) {
    return { name: "pandoc lua", file: "pandoc", args: () => ["lua", "-e", LOADFILE] };
  }
  return null;
}

/** The compiler's message when `file` does not compile, else null. */
function luaSyntaxError(file, checker) {
  const result = spawnSync(checker.file, checker.args(file), {
    stdio: "pipe",
    env: Object.assign({}, process.env, { LAHE_LINT_LUA: file })
  });
  if (result.error) return checker.name + " could not run: " + result.error.message;
  if (result.status === 0) return null;
  return (result.stderr.toString() || result.stdout.toString()).trim() || checker.name + " exited " + result.status;
}

module.exports = { findLuaChecker, luaSyntaxError };
