// Finding 8: helper.log is what AC8 ("outside cannot get in") rests on, so an
// attacker-controlled value that reaches it must not be able to forge a line.
// A review id with a newline wrote forged refusal lines (confirmed live). The
// defense is at the one chokepoint every caller passes through: helperLog
// neutralizes control characters and caps the length before the line is
// written, the same discipline encodeEventLine uses for events.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const stateDir = require("../../src/service/state_dir.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-loginj-"));
}

test("a newline in a logged value cannot forge a second log line (finding 8)", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });

  // The exact shape of the exploit: a review id an attacker controls, carrying a
  // newline and a forged refusal line after it.
  const evil = "rev%0A\n2026-01-01T00:00:00.000Z FORGED refused check=token [outside got in]";
  log.helperLog("review " + evil + " created");

  const contents = fs.readFileSync(stateDir.helperLogPath(dir), "utf8");
  const physicalLines = contents.split("\n").filter((l) => l.length > 0);
  assert.equal(physicalLines.length, 1, "one helperLog call is one physical line, whatever the value contains");
  assert.equal(/\n/.test(physicalLines[0]), false, "no raw newline survived into the written line");
  // The forged text is still recorded (nothing is hidden), just neutralized onto
  // the one line rather than promoted to its own.
  assert.match(physicalLines[0], /FORGED/);
});

test("an over-long logged value is capped rather than flooding the log", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  log.helperLog("x".repeat(50000));
  const line = fs.readFileSync(stateDir.helperLogPath(dir), "utf8");
  assert.equal(line.length < 50000, true, "the line is capped");
});
