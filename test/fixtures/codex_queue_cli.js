#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.join(" ") === "queue --help") {
  process.stdout.write("codex queue --thread <id> --message <text>\n");
} else if (args[0] === "queue") {
  if (process.env.LAHE_TEST_CODEX_FAIL && fs.existsSync(process.env.LAHE_TEST_CODEX_FAIL)) {
    process.stderr.write("daemon is restarting\n");
    process.exitCode = 1;
  } else {
    fs.appendFileSync(process.env.LAHE_TEST_CODEX_LOG, JSON.stringify(args) + "\n");
  }
} else {
  process.stderr.write("Unexpected test command\n");
  process.exitCode = 1;
}
