"use strict";

// scripts/catalog_opens.py, the Library's count script. LAHE Library plan,
// Task 3.3, "Count script (3.3)" in the Test List.
//
// The script runs as a real child process on the log that Task 2.1's route
// test captured (test/fixtures/catalog_log.txt), so gate:unit covers it. The
// fixture's week, in UTC:
//
//   Mon 21  open r_new (1 day), open r_page (16 days)
//   Tue 22  star only
//   Wed 23  open r_page (17 days), unstar
//   Thu 24  pickup only
//   Fri 25  open r_new (5 days)
//   Sat 26  open r_page (21 days)       a weekend Open
//   Mon 28  launch, open r_new (7 days) exactly 7 days is not older
//
// So: 6 Opens; working days Mon 21 to Mon 28 are six days holding 2, 0, 1, 0,
// 1, 1 Opens (5 in all); one weekend Open; 3 Opens older than 7 days.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const protocol = require("../../src/shared/protocol.js");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "catalog_opens.py");
const LOG = path.join(ROOT, "test", "fixtures", "catalog_log.txt");

function python() {
  for (const bin of ["python3", "python"]) {
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (probe.status === 0 && /Python 3\./.test(probe.stdout + probe.stderr)) return bin;
  }
  return null;
}
const PY = python();

function run(t, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-opens-"));
  const csv = path.join(dir, "opens.csv");
  const res = spawnSync(PY, [SCRIPT, LOG, "--csv", csv].concat(args), { encoding: "utf8" });
  assert.equal(res.status, 0, "script failed: " + res.stderr);
  return { stdout: res.stdout, csv: fs.readFileSync(csv, "utf8") };
}

test("with --tz UTC, the CSV has one row per Open with its age and whether it is older than the default view", { skip: !PY && "no python3" }, (t) => {
  const { csv } = run(t, ["--tz", "UTC"]);
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines[0], "review,time,age_days,older_than_default_view");
  assert.deepEqual(lines.slice(1), [
    "r_new,2026-09-21T14:00:00+00:00,1,no",
    "r_page,2026-09-21T15:00:00+00:00,16,yes",
    "r_page,2026-09-23T09:00:00+00:00,17,yes",
    "r_new,2026-09-25T17:00:00+00:00,5,no",
    "r_page,2026-09-26T12:00:00+00:00,21,yes",
    "r_new,2026-09-28T08:30:00+00:00,7,no"
  ]);
});

test("with --tz UTC, the summary prints Opens per working day and the older-than-7-days count", { skip: !PY && "no python3" }, (t) => {
  assert.equal(protocol.CATALOG.DEFAULT_VIEW_DAYS, 7, "the expectations below assume a 7-day default view");
  const { stdout } = run(t, ["--tz", "UTC"]);
  const perDay = stdout.split("\n").filter((line) => /^  \d{4}-\d{2}-\d{2} /.test(line));
  assert.deepEqual(perDay, [
    "  2026-09-21 Mon  2",
    "  2026-09-22 Tue  0",
    "  2026-09-23 Wed  1",
    "  2026-09-24 Thu  0",
    "  2026-09-25 Fri  1",
    "  2026-09-28 Mon  1"
  ]);
  assert.match(stdout, /^Opens: 6$/m);
  assert.match(stdout, /^Opens on working days: 5 over 6 working days, 0\.83 per working day$/m);
  assert.match(stdout, /^Opens on weekends: 1$/m);
  assert.match(stdout, /^Opens older than the default view \(7 days\): 3 of 6$/m);
});

test("--tz moves Opens across days: in Pacific/Auckland, Friday evening UTC is Saturday", { skip: !PY && "no python3" }, (t) => {
  const { stdout } = run(t, ["--tz", "Pacific/Auckland"]);
  const perDay = stdout.split("\n").filter((line) => /^  \d{4}-\d{2}-\d{2} /.test(line));
  assert.deepEqual(perDay, [
    "  2026-09-22 Tue  2",
    "  2026-09-23 Wed  1",
    "  2026-09-24 Thu  0",
    "  2026-09-25 Fri  0",
    "  2026-09-28 Mon  1"
  ]);
  assert.match(stdout, /^Opens on weekends: 2$/m);
  assert.match(stdout, /^Opens older than the default view \(7 days\): 3 of 6$/m);
});

test("lines that are not catalog Opens are ignored, including a Library error line and a torn last line", { skip: !PY && "no python3" }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-opens-"));
  const log = path.join(dir, "helper.log");
  fs.writeFileSync(log, [
    "2026-09-21T09:00:00.000Z helper started on 127.0.0.1:7817",
    "2026-09-21T10:00:00.000Z Library open refused review=r_x: not openable",
    "2026-09-21T11:00:00.000Z " + protocol.catalogLogLine(protocol.CATALOG_LOG.ACTION.OPEN, "r_a", 9),
    "2026-09-21T12:00:00.000Z " + protocol.catalogLogLine(protocol.CATALOG_LOG.ACTION.STAR, "r_a", 9),
    "2026-09-21T13:00:00.000Z catalog open review=r_b"
  ].join("\n"));
  const csv = path.join(dir, "opens.csv");
  const res = spawnSync(PY, [SCRIPT, log, "--csv", csv, "--tz", "UTC"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(fs.readFileSync(csv, "utf8").trim().split(/\r?\n/), [
    "review,time,age_days,older_than_default_view",
    "r_a,2026-09-21T11:00:00+00:00,9,yes"
  ]);
  assert.match(res.stdout, /^Opens: 1$/m);
});

test("an unknown --tz is refused with a message, not a traceback", { skip: !PY && "no python3" }, () => {
  const res = spawnSync(PY, [SCRIPT, LOG, "--tz", "Not/AZone", "--csv", path.join(os.tmpdir(), "unused.csv")], { encoding: "utf8" });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown time zone/);
  assert.doesNotMatch(res.stderr, /Traceback/);
});
