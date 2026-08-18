// Install the repository-owned LAHE skill where supported agents discover it.
// The repository is the source of truth. Installed files are replaceable
// projections, and a pre-existing hand-maintained LAHE skill is backed up once
// before migration rather than silently discarded.

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
  return failed ? 1 : 0;
}

if (require.main === module) process.exitCode = install();

module.exports = {
  MARKER: MARKER,
  SOURCE: SOURCE,
  defaultTargets: defaultTargets,
  isLaheSkill: isLaheSkill,
  backupPath: backupPath,
  installOne: installOne,
  install: install
};
