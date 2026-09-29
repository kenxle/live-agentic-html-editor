#!/usr/bin/env node
// How many stored records are oversized today, per cause, and how many bytes
// that costs. READ-ONLY: it opens every review log for reading and writes one
// CSV under /private/tmp. It never writes, moves or rewrites a log.
//
// Written for docs/features/20260928.03_oversized_records:
//
//   node scripts/measure_oversized_records.js [<reviews dir>] [--csv <file>]
//
// <reviews dir> defaults to ~/.local/state/lahe/reviews. The CSV defaults to
// /private/tmp/claude-501/oversized_records.csv and has one row per affected
// record (review, item, cause).
//
// A "record" is one item. Its state TODAY is its latest line in the log. Every
// line of an item repeats the whole record, so an oversized field costs its
// size once per line that carries it; log_bytes counts that. committed_bytes
// is the part of log_bytes on lines that are not draft snapshots: the draft
// compaction (branch compact-draft-history) keeps every such line, so it is
// what stays after compaction at the least.
//
// The three causes, as exact rules over what a record stores:
//
//   context_ran_out   region.ref.text_unique is false and region.ref.
//                     context_level is above 0: mint found no ring that made
//                     the region unique and kept the widest ring it tried.
//                     Bytes: ref.prefix + ref.suffix + context.prefix +
//                     context.suffix.
//   embedded_repeated an embedded value (a data: URL) sits in two or more of
//                     region.ref.probe, context.subject.src and
//                     context.subject.html. Bytes: every copy past the first.
//   page_region       the region is the page: ref.path is "body>", or the
//                     fingerprint tag is body or html, or the region sits one
//                     level under the page with no words beside it (path depth
//                     1, stored prefix and suffix both empty). Bytes: the
//                     probe, which is the whole page's text.
//
// A record can match more than one cause, and gets one row per cause.
//
// Node-only. Not part of the tool.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var readline = require("node:readline");

var args = process.argv.slice(2);
var csvAt = args.indexOf("--csv");
var CSV = csvAt !== -1 ? args[csvAt + 1] : "/private/tmp/claude-501/oversized_records.csv";
var positional = args.filter(function (a, i) {
  return a !== "--csv" && (csvAt === -1 || i !== csvAt + 1);
});
var DIR = path.resolve(positional[0] || path.join(os.homedir(), ".local", "state", "lahe", "reviews"));

var CAUSES = ["context_ran_out", "embedded_repeated", "page_region"];

function bytes(value) {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

function isEmbedded(value) {
  return typeof value === "string" && /^\s*data:/i.test(value);
}

/** The embedded value a record carries, or null. */
function embeddedValueOf(ref, subject) {
  if (subject && isEmbedded(subject.src)) return subject.src.trim();
  var probe = ref && typeof ref.probe === "string" ? ref.probe : "";
  var m = /(?:^|\|)[^|=]+=\s*(data:[^|]*)/i.exec(probe);
  return m ? m[1] : null;
}

/** {cause: oversized bytes} for one record line. Only causes that hold. */
function causesOf(rec) {
  var out = {};
  var region = rec.region || {};
  var ref = region.ref || {};
  var ctx = rec.context || {};
  var subject = ctx.subject || null;

  if (ref.text_unique === false && typeof ref.context_level === "number" && ref.context_level > 0) {
    out.context_ran_out = bytes(ref.prefix) + bytes(ref.suffix) + bytes(ctx.prefix) + bytes(ctx.suffix);
  }

  var value = embeddedValueOf(ref, subject);
  if (value) {
    // The tail is what a copy of the value would share, whatever was escaped
    // or collapsed at its start.
    var tail = value.slice(-64);
    var copies = 0;
    [ref.probe, subject && subject.src, subject && subject.html].forEach(function (field) {
      if (typeof field === "string" && field.indexOf(tail) !== -1) copies += 1;
    });
    if (copies >= 2) out.embedded_repeated = (copies - 1) * bytes(value);
  }

  var p = typeof ref.path === "string" ? ref.path : "";
  var depth = p ? p.split(">").filter(Boolean).length - 1 : -1;
  var tag = ref.fingerprint && ref.fingerprint.tag;
  var bare = (ref.prefix || "") === "" && (ref.suffix || "") === "";
  if (p === "body>" || tag === "body" || tag === "html" || (depth === 1 && bare && bytes(ref.probe) > 0)) {
    out.page_region = bytes(ref.probe);
  }
  return out;
}

function csvCell(value) {
  var s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function scanLog(file, review, state) {
  var input = fs.createReadStream(file, { encoding: "utf8", flags: "r" });
  var lines = readline.createInterface({ input: input, crlfDelay: Infinity });
  for await (var line of lines) {
    state.logBytes += Buffer.byteLength(line, "utf8") + 1;
    state.lines += 1;
    if (line.indexOf('"record"') === -1) continue;
    var ev;
    try {
      ev = JSON.parse(line);
    } catch (err) {
      state.unparsed += 1;
      continue;
    }
    var rec = ev && ev.record;
    if (!rec || typeof rec !== "object" || !rec.id) continue;
    var key = review + "\u0000" + rec.id;
    var causes = causesOf(rec);
    var entry = state.items[key];
    if (!entry) {
      entry = state.items[key] = { review: review, id: rec.id, perCause: {}, latest: null };
    }
    Object.keys(causes).forEach(function (cause) {
      var c = entry.perCause[cause] || (entry.perCause[cause] = { lines: 0, logBytes: 0, committedBytes: 0 });
      c.lines += 1;
      c.logBytes += causes[cause];
      if (ev.draft !== true) c.committedBytes += causes[cause];
    });
    entry.latest = {
      causes: causes,
      lineBytes: Buffer.byteLength(line, "utf8"),
      kind: rec.kind || null,
      how: rec.context && rec.context.element ? "pick" : rec.context && rec.context.quote ? "selection" : "other",
      page: ev.page_path || rec.page_path || null,
      ts: ev.ts || null,
      path: rec.region && rec.region.ref ? rec.region.ref.path || null : null
    };
  }
}

async function main() {
  var reviews = fs.readdirSync(DIR).filter(function (name) {
    return fs.existsSync(path.join(DIR, name, "events.jsonl"));
  });
  var state = { items: {}, logBytes: 0, lines: 0, unparsed: 0 };
  for (var i = 0; i < reviews.length; i += 1) {
    await scanLog(path.join(DIR, reviews[i], "events.jsonl"), reviews[i], state);
  }

  var totals = {};
  CAUSES.forEach(function (cause) {
    totals[cause] = { records: 0, latestBytes: 0, logBytes: 0, committedBytes: 0, lines: 0, by_how: {} };
  });
  var rows = [
    ["review", "item", "cause", "kind", "how", "page_path", "region_path", "last_ts", "oversized_bytes_now", "latest_line_bytes", "lines_carrying", "log_bytes", "committed_bytes"]
  ];
  var anyRecords = 0;
  var items = Object.keys(state.items).map(function (k) {
    return state.items[k];
  });
  items.forEach(function (entry) {
    var now = entry.latest ? entry.latest.causes : {};
    var counted = false;
    CAUSES.forEach(function (cause) {
      if (!Object.prototype.hasOwnProperty.call(now, cause)) return;
      counted = true;
      var t = totals[cause];
      var c = entry.perCause[cause];
      t.records += 1;
      t.by_how[entry.latest.how] = (t.by_how[entry.latest.how] || 0) + 1;
      t.latestBytes += now[cause];
      t.logBytes += c.logBytes;
      t.committedBytes += c.committedBytes;
      t.lines += c.lines;
      rows.push([
        entry.review,
        entry.id,
        cause,
        entry.latest.kind,
        entry.latest.how,
        entry.latest.page,
        entry.latest.path,
        entry.latest.ts,
        now[cause],
        entry.latest.lineBytes,
        c.lines,
        c.logBytes,
        c.committedBytes
      ]);
    });
    if (counted) anyRecords += 1;
  });

  fs.mkdirSync(path.dirname(CSV), { recursive: true });
  fs.writeFileSync(
    CSV,
    rows
      .map(function (row) {
        return row.map(csvCell).join(",");
      })
      .join("\n") + "\n"
  );

  var summary = {
    reviews_dir: DIR,
    reviews: reviews.length,
    log_lines: state.lines,
    log_bytes: state.logBytes,
    unparsed_lines: state.unparsed,
    records: items.length,
    records_with_any_cause: anyRecords,
    per_cause: totals,
    csv: CSV,
    csv_rows: rows.length - 1
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

main().catch(function (err) {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
