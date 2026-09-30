#!/usr/bin/env node
// What normalize.cleanBlock costs on hostile input, measured.
//
// Written for the free-writing fix round (docs/features/20260928.01_free_writing,
// reviews_impl/security.md finding 2), to be run once against the code before
// the change and once after:
//
//   node scripts/measure_clean_block_cost.js [<tree root>] [--json]
//
// <tree root> is a checkout (or `git archive` of one) whose src/ is measured.
// It defaults to this repo. Each shape is built at four sizes, and each size is
// timed once with the wall clock. The shapes:
//
//   nested     N <em> followed by N </b>: every closing tag used to walk the
//              whole open stack, so the work was N x N
//   deep       N <em>, N words, N </em>: a real nesting, deep enough to have
//              overflowed the recursive tidy-up passes
//   merged     N times "a<em></em>": empty elements between words, so the text
//              is joined back together N times
//
// A result is "refused" when cleanBlock returned a refusal, "cleaned" when it
// returned markup, and "threw" when it threw (the stack overflow).
//
// Node-only. Not part of the tool.

"use strict";

var path = require("node:path");

var args = process.argv.slice(2);
var asJson = args.indexOf("--json") !== -1;
var rootArg = args.filter(function (a) {
  return a !== "--json";
})[0];
var ROOT = path.resolve(rootArg || path.join(__dirname, ".."));
var normalize = require(path.join(ROOT, "src", "shared", "normalize.js"));

function repeat(s, n) {
  var out = "";
  for (var i = 0; i < n; i += 1) out += s;
  return out;
}

var SHAPES = {
  nested: function (n) {
    return repeat("<em>", n) + "words" + repeat("</b>", n);
  },
  deep: function (n) {
    return repeat("<em>", n) + repeat("w ", n) + repeat("</em>", n);
  },
  merged: function (n) {
    return repeat("a<em></em>", n);
  }
};

// Sizes in bytes of input, roughly: each shape's unit is 4 to 10 characters.
var SIZES = [64 * 1024, 128 * 1024, 256 * 1024, 512 * 1024];
var UNIT = { nested: 8, deep: 11, merged: 10 };

var rows = [];
Object.keys(SHAPES).forEach(function (shape) {
  SIZES.forEach(function (bytes) {
    var n = Math.floor(bytes / UNIT[shape]);
    var html = SHAPES[shape](n);
    var start = process.hrtime.bigint();
    var outcome;
    try {
      var r = normalize.cleanBlock("p", html);
      outcome = typeof r.html === "string" ? "cleaned" : "refused";
    } catch (err) {
      outcome = "threw " + (err && err.name);
    }
    var ms = Number(process.hrtime.bigint() - start) / 1e6;
    rows.push({ shape: shape, bytes: html.length, ms: Math.round(ms * 10) / 10, outcome: outcome });
  });
});

if (asJson) {
  process.stdout.write(JSON.stringify({ root: ROOT, rows: rows }, null, 2) + "\n");
} else {
  process.stdout.write("cleanBlock cost, tree " + ROOT + "\n");
  process.stdout.write("shape    bytes      ms        outcome\n");
  rows.forEach(function (r) {
    process.stdout.write(
      (r.shape + "        ").slice(0, 9) + (String(r.bytes) + "           ").slice(0, 11) + (String(r.ms) + "          ").slice(0, 10) + r.outcome + "\n"
    );
  });
}
