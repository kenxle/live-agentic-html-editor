#!/usr/bin/env node
// Zero-dependency lint gate: syntax-checks every tracked .js file with
// `node --check`. This is not a style linter; it is the cheapest possible
// gate that catches a broken commit, without adding a devDependency beyond
// the test harness. Swap for a real linter later if the project wants one.

const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const skipDirs = new Set(["node_modules", ".git", "test-results", "playwright-report"]);

function collectJsFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectJsFiles(root, []);
let failed = false;

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failed = true;
    process.stderr.write(`Syntax error in ${path.relative(root, file)}:\n`);
    process.stderr.write(err.stderr ? err.stderr.toString() : String(err));
  }
}

if (failed) {
  console.error(`\nlint failed`);
  process.exit(1);
}

console.log(`lint passed (${files.length} files checked)`);
