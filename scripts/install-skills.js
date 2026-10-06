// Install the repository-owned LAHE skill where supported agents discover it.
// The repository is the source of truth. Installed files are replaceable
// projections, and a pre-existing hand-maintained LAHE skill is backed up once
// before migration rather than silently discarded.
//
// IT ALSO INSTALLS CLAUDE CODE'S STOP HOOK, `lahe hook stop` (the re-arm guard,
// docs/features/20261006.02_rearm_guard). One entry goes into
// ~/.claude/settings.json under hooks.Stop:
//
//   { "hooks": [ { "type": "command", "timeout": 10,
//                  "command": "\"/abs/node\" \"/abs/clone/bin/lahe.js\" hook stop 2>/dev/null || true" } ] }
//
// Both paths are absolute, as in install-cli's wrapper, so the hook runs
// whatever PATH and nvm are doing. The tail makes a moved clone or a removed
// Node a silent no-op instead of a hook error on every turn. From a git
// worktree the hook part is skipped with one line, because a worktree is
// usually removed when its work lands. The entry is recognised by its command
// ending in `lahe hook stop` (with or without the tail), so a second run changes
// nothing and a run from a moved clone replaces the old entry rather than adding
// one. Every other hook and setting is kept, the file is written beside and
// renamed, a symlinked settings.json is written through rather than replaced,
// and a file that does not parse is left alone with a message.
//
// To remove the hook: node scripts/install-skills.js --remove-hook

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var REPO_ROOT = path.join(__dirname, "..");
var SOURCE = path.join(REPO_ROOT, "skills", "lahe", "SKILL.md");
var MARKER = "<!-- lahe canonical skill: managed by the live-agentic-html-editor repository -->";

function defaultTargets(home) {
  // Codex and Gemini CLI both discover the Agent Skills standard user path.
  // Installing additional .codex or .gemini copies would expose the same
  // named skill more than once in clients that scan both locations. Claude
  // Code does not discover the shared path, so it needs one identical copy.
  return [
    { agent: "codex-gemini", file: path.join(home, ".agents", "skills", "lahe", "SKILL.md") },
    { agent: "claude", file: path.join(home, ".claude", "skills", "lahe", "SKILL.md") }
  ];
}

function isLaheSkill(text) {
  return typeof text === "string" && /^---\s*\nname:\s*lahe\s*$/m.test(text);
}

function backupPath(home, agent) {
  return path.join(home, ".local", "state", "lahe", "skill-backups", agent + "-SKILL.md.pre-repo-managed");
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var temp = file + ".tmp-" + process.pid;
  fs.writeFileSync(temp, text, { mode: 0o644 });
  fs.renameSync(temp, file);
}

function installOne(home, target, source) {
  var exists = fs.existsSync(target.file);
  var current = exists ? fs.readFileSync(target.file, "utf8") : null;
  if (exists && current.indexOf(MARKER) === -1) {
    if (!isLaheSkill(current)) {
      return { ok: false, action: "refused", target: target.file, reason: "the existing file is not a LAHE skill" };
    }
    var backup = backupPath(home, target.agent);
    if (fs.existsSync(backup) && fs.readFileSync(backup, "utf8") !== current) {
      return { ok: false, action: "refused", target: target.file, reason: "a different migration backup already exists at " + backup };
    }
    if (!fs.existsSync(backup)) writeAtomic(backup, current);
  }
  writeAtomic(target.file, source);
  return {
    ok: true,
    action: exists ? "updated" : "installed",
    target: target.file,
    backup: exists && current.indexOf(MARKER) === -1 ? backupPath(home, target.agent) : null
  };
}

// ---------------------------------------------------------------------------
// The Claude Code Stop hook
// ---------------------------------------------------------------------------

var ENTRY = path.join(REPO_ROOT, "bin", "lahe.js");
// Seconds. The hook answers in well under one; this only bounds a wedged disk.
var HOOK_TIMEOUT_SECONDS = 10;
var OUR_HOOK = /(^|[\s"'/\\])lahe(\.js)?["']?\s+hook\s+stop(\s+2>\s*\/dev\/null\s*\|\|\s*true)?\s*$/;
// The tail that keeps a missing clone or Node from showing a hook error on
// every turn in every project. The hook prints nothing on stderr itself, so
// nothing real is hidden.
var QUIET_TAIL = " 2>/dev/null || true";

function settingsPath(home) {
  return path.join(home, ".claude", "settings.json");
}

/** The command line, both paths absolute, quiet when either is gone. */
function hookCommand(paths) {
  return '"' + paths.node + '" "' + paths.entry + '" hook stop' + QUIET_TAIL;
}

/**
 * Is this clone a git worktree? `.git` is a file there and a directory in a
 * main clone. A worktree is usually removed when its work lands, which would
 * leave the hook pointing at nothing, so the hook is installed from the main
 * clone only.
 */
function isWorktree(repoRoot) {
  try {
    return fs.statSync(path.join(repoRoot, ".git")).isFile();
  } catch (err) {
    return false;
  }
}

/** Is this hook command one this script wrote (from any clone)? */
function isOurHook(command) {
  return typeof command === "string" && OUR_HOOK.test(command);
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Settings without lahe's Stop hook. A group left empty by the removal goes,
 * and so do an emptied Stop list and an emptied hooks object.
 *
 * @returns {{settings: object, changed: boolean}}
 */
function removeStopHook(settings) {
  var out = isObject(settings) ? settings : {};
  if (!isObject(out.hooks) || !Array.isArray(out.hooks.Stop)) return { settings: out, changed: false };
  var changed = false;
  var groups = [];
  out.hooks.Stop.forEach(function (group) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      groups.push(group);
      return;
    }
    var kept = group.hooks.filter(function (hook) { return !(isObject(hook) && isOurHook(hook.command)); });
    if (kept.length === group.hooks.length) {
      groups.push(group);
      return;
    }
    changed = true;
    if (kept.length > 0) groups.push(Object.assign({}, group, { hooks: kept }));
  });
  if (!changed) return { settings: out, changed: false };
  if (groups.length > 0) out.hooks.Stop = groups;
  else delete out.hooks.Stop;
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return { settings: out, changed: true };
}

/**
 * Settings with exactly one lahe Stop hook, running `command`.
 *
 * @returns {{settings: object, changed: boolean}}
 */
function mergeStopHook(settings, command) {
  var out = isObject(settings) ? settings : {};
  var existing = [];
  if (isObject(out.hooks) && Array.isArray(out.hooks.Stop)) {
    out.hooks.Stop.forEach(function (group) {
      if (!isObject(group) || !Array.isArray(group.hooks)) return;
      group.hooks.forEach(function (hook) {
        if (isObject(hook) && isOurHook(hook.command)) existing.push(hook);
      });
    });
  }
  if (existing.length === 1 && existing[0].command === command && existing[0].type === "command") {
    return { settings: out, changed: false };
  }
  out = removeStopHook(out).settings;
  if (!isObject(out.hooks)) out.hooks = {};
  if (!Array.isArray(out.hooks.Stop)) out.hooks.Stop = [];
  out.hooks.Stop.push({ hooks: [{ type: "command", command: command, timeout: HOOK_TIMEOUT_SECONDS }] });
  return { settings: out, changed: true };
}

/**
 * Read, change and write settings.json. `change` gets the parsed settings and
 * returns {settings, changed}. A file that does not parse is never written.
 *
 * @returns {{ok: boolean, changed?: boolean, file: string, reason?: string}}
 */
function editSettings(home, change) {
  var link = settingsPath(home);
  // Write through a symlink (a dotfiles repo, say) rather than replace it.
  var file = link;
  try {
    file = fs.realpathSync(link);
  } catch (err) {
    file = link;
  }
  var text = null;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") return { ok: false, file: link, reason: err.message };
  }
  var settings = {};
  if (text !== null && text.trim() !== "") {
    try {
      settings = JSON.parse(text);
    } catch (err) {
      return { ok: false, file: link, reason: "it is not valid JSON (" + err.message + ")" };
    }
    if (!isObject(settings)) return { ok: false, file: link, reason: "it is not a JSON object" };
  }
  var result = change(settings);
  if (!result.changed) return { ok: true, changed: false, file: link };
  var mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch (err) {
    mode = 0o600;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var temp = file + ".lahe-tmp-" + process.pid;
  fs.writeFileSync(temp, JSON.stringify(result.settings, null, 2) + "\n", { mode: mode });
  fs.renameSync(temp, file);
  return { ok: true, changed: true, file: link };
}

/**
 * @param {{home?: string, node?: string, entry?: string, stdout?: function, stderr?: function}} [options]
 * @returns {number} the exit code
 */
function installHook(options) {
  var opts = options || {};
  var home = opts.home || os.homedir();
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var err = opts.stderr || function (text) { process.stderr.write(text); };
  var repoRoot = path.resolve(opts.repoRoot || REPO_ROOT);
  if (!opts.entry && isWorktree(repoRoot)) {
    out(
      "lahe install-skills: skipped the Claude Code Stop hook: " + repoRoot +
        " is a git worktree, so install from the main clone instead\n"
    );
    return 0;
  }
  var command = hookCommand({
    node: opts.node || process.execPath,
    entry: path.resolve(opts.entry || path.join(repoRoot, "bin", "lahe.js"))
  });
  var result = editSettings(home, function (settings) { return mergeStopHook(settings, command); });
  if (!result.ok) {
    err("lahe install-skills: left " + result.file + " alone, so the Claude Code Stop hook is not installed: " + result.reason + "\n");
    return 1;
  }
  out(
    "lahe install-skills: " +
      (result.changed ? "added the Claude Code Stop hook to " : "the Claude Code Stop hook is already installed in ") +
      result.file + "\n" +
      "  hook   " + command + "\n" +
      "  remove node " + path.join(REPO_ROOT, "scripts", "install-skills.js") + " --remove-hook\n"
  );
  return 0;
}

/** Take lahe's Stop hook out of settings.json, leaving everything else. */
function uninstallHook(options) {
  var opts = options || {};
  var home = opts.home || os.homedir();
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var err = opts.stderr || function (text) { process.stderr.write(text); };
  var result = editSettings(home, removeStopHook);
  if (!result.ok) {
    err("lahe install-skills: left " + result.file + " alone: " + result.reason + "\n");
    return 1;
  }
  out("lahe install-skills: " + (result.changed ? "removed the Claude Code Stop hook from " : "no lahe Stop hook in ") + result.file + "\n");
  return 0;
}

function install(options) {
  var opts = options || {};
  var home = opts.home || os.homedir();
  var sourceFile = opts.source || SOURCE;
  var targets = opts.targets || defaultTargets(home);
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var err = opts.stderr || function (text) { process.stderr.write(text); };
  var source = fs.readFileSync(sourceFile, "utf8");
  if (source.indexOf(MARKER) === -1 || !isLaheSkill(source)) {
    err("lahe install-skills: canonical skill is missing its identity marker: " + sourceFile + "\n");
    return 1;
  }
  var failed = false;
  targets.forEach(function (target) {
    var result = installOne(home, target, source);
    if (!result.ok) {
      failed = true;
      err("lahe install-skills: left " + result.target + " alone: " + result.reason + "\n");
      return;
    }
    out("lahe install-skills: " + result.action + " " + result.target + "\n");
    if (result.backup) out("  preserved previous skill at " + result.backup + "\n");
  });
  if (opts.hook !== false) {
    var hookOptions = { home: home, stdout: out, stderr: err };
    if (opts.node) hookOptions.node = opts.node;
    if (opts.entry) hookOptions.entry = opts.entry;
    if (opts.repoRoot) hookOptions.repoRoot = opts.repoRoot;
    if (installHook(hookOptions) !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = process.argv.indexOf("--remove-hook") !== -1 ? uninstallHook() : install();
}

module.exports = {
  MARKER: MARKER,
  SOURCE: SOURCE,
  defaultTargets: defaultTargets,
  isLaheSkill: isLaheSkill,
  backupPath: backupPath,
  installOne: installOne,
  install: install,
  ENTRY: ENTRY,
  settingsPath: settingsPath,
  hookCommand: hookCommand,
  isOurHook: isOurHook,
  isWorktree: isWorktree,
  mergeStopHook: mergeStopHook,
  removeStopHook: removeStopHook,
  installHook: installHook,
  uninstallHook: uninstallHook
};
