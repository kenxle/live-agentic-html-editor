#!/usr/bin/env node
// What a page load costs when many worktrees have been removed.
//
// Written for docs/features/20261015.01_review_follows_document (R14), to be
// run once against the code before the change and once after:
//
//   node scripts/measure_moved_lookup.js [<tree root>] [--loads N] [--gap-ms M] [--json]
//
// <tree root> is a checkout (or `git archive` of one) whose src/ is measured.
// It defaults to this repo. The script builds a made-up state folder shaped
// like Ken's: 700 reviews of Markdown files in 20 agent sessions, three
// comments each, and 30 worktree sites of one main checkout, 20 of whose
// worktrees have been removed the way git removes them. Two pages are
// measured, each load being the page itself (the review pick, its spellings,
// the script tag) and then its records.read, the two requests a reviewer's tab
// makes on arrival:
//
//   ordinary  a reviewed page in an ordinary folder. Its numbers before and
//             after the change are the cost the move code adds to every page.
//   moved     a removed worktree's page, its main copy served. Before the
//             change it is read-only and its records are refused, so its
//             before numbers are not like for like; after, it carries the old
//             review and shows its records.
//
// Loads are spaced --gap-ms apart (2000 by default), not back to back, so a
// load does not run on caches the last one warmed
// (docs/lessons/service/a-back-to-back-benchmark-of-a-polled-route-measures-only-the-warm-path.md).
// The helper runs in this process, so the processor time counted includes the
// two small HTTP clients as well.
//
// What it does not do: the lesson's 10-minute idle windows on a copy of the
// real state folder. This lookup runs on page loads, not on a poll, and a
// script may not touch the real state folder.
//
// The temp folder is left in the OS temp directory, which the OS clears.
//
// Node-only. Not part of the tool.

"use strict";

var fs = require("node:fs");
var http = require("node:http");
var os = require("node:os");
var path = require("node:path");

var args = process.argv.slice(2);
var tree = path.resolve(__dirname, "..");
var loads = 15;
var gapMs = 2000;
var asJson = false;
for (var i = 0; i < args.length; i += 1) {
  if (args[i] === "--loads") loads = Number(args[++i]);
  else if (args[i] === "--gap-ms") gapMs = Number(args[++i]);
  else if (args[i] === "--json") asJson = true;
  else tree = path.resolve(args[i]);
}

var service = require(path.join(tree, "src", "service", "index.js"));
var agentSessions = require(path.join(tree, "src", "service", "agent_sessions.js"));
var protocol = require(path.join(tree, "src", "shared", "protocol.js"));
var record = require(path.join(tree, "src", "shared", "record.js"));

function writeFile(base, rel, text) {
  var full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

function get(port, host, pathName, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      host: "127.0.0.1", port: port, method: "GET", path: pathName, setHost: false, agent: false,
      headers: Object.assign({ host: host }, headers || {})
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }); });
    });
    req.on("error", reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function median(list) {
  var sorted = list.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.floor(sorted.length / 2)];
}

function p90(list) {
  var sorted = list.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
}

async function main() {
  var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-measure-moved-")));
  var home = path.join(root, "home");
  var state = path.join(root, "state");
  fs.mkdirSync(home);
  process.env.LAHE_HOME_DIR = home;
  var helper = await service.serve({ port: 0, stateDir: state, quiet: true, pagesPort: 0, sitesHome: home });
  try {
    var store = agentSessions.createStore({ dir: state });
    var sessions = [];
    for (var s = 0; s < 20; s += 1) sessions.push(store.create({ name: "session " + s }).id);
    var counter = 0;
    function comment(reviewId, origin, pagePath) {
      var item = record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "a comment", page_origin: origin, page_path: pagePath, page_title: "t", page_seq: 1 });
      counter += 1;
      helper.log.append(reviewId, [protocol.newEvent({
        event: protocol.EVENT.ITEM_READY, event_id: "ev_measure_" + counter, review: reviewId, item: item.id, rev: item.rev,
        page_path: pagePath, page_title: "t", page_seq: 1, payload: { draft: false, record: item }
      })]);
    }

    // 700 reviews of files in ordinary folders, 35 folders of 20.
    var many = path.join(home, "ws", "many");
    var ordinary = null;
    for (var r = 0; r < 670; r += 1) {
      var folder = path.join(many, "f" + Math.floor(r / 20));
      var file = writeFile(folder, "p" + r + ".md", "# Page " + r + "\n\nWords.\n");
      var review = helper.reviews.create({ target_path: path.join(state, "artifact-" + r + ".html"), source_path: file, agent_session_id: sessions[r % 20], origins: ["null"] });
      if (r % 20 === 0) {
        var bound = helper.sites.bind({ root: folder, mode: "folder", entry: "p" + r + ".md" });
        if (r === 0) ordinary = { review: review, name: bound.name, path: "/p0.md" };
      }
      var siteOrigin = protocol.siteOrigin(helper.sites.list().filter(function (e) { return e.site.root === folder; })[0].name, helper.pagesPort);
      for (var c = 0; c < 3; c += 1) comment(review.id, siteOrigin, "/p" + r + ".md");
    }

    // 30 worktrees of one main checkout, a reviewed page in each.
    var mainRepo = path.join(home, "ws", "repo");
    var measured = null;
    for (var k = 0; k < 30; k += 1) {
      var admin = path.join(mainRepo, ".git", "worktrees", "wt" + k);
      fs.mkdirSync(admin, { recursive: true });
      var wt = path.join(home, "ws", "repo-wt", "wt" + k);
      writeFile(wt, ".git", "gitdir: " + admin + "\n");
      writeFile(admin, "gitdir", path.join(wt, ".git") + "\n");
      var rel = path.join("docs", "features", "f" + k);
      var wtFile = writeFile(path.join(wt, rel), "progress.md", "# Progress " + k + "\n\nWords.\n");
      writeFile(path.join(mainRepo, rel), "progress.md", "# Progress " + k + "\n\nWords.\n");
      var wtReview = helper.reviews.create({ target_path: path.join(state, "artifact-wt" + k + ".html"), source_path: wtFile, agent_session_id: sessions[k % 20], origins: ["null"] });
      var wtSite = helper.sites.bind({ root: path.join(wt, rel), mode: "folder", entry: "progress.md" });
      var wtOrigin = protocol.siteOrigin(wtSite.name, helper.pagesPort);
      for (var c2 = 0; c2 < 3; c2 += 1) comment(wtReview.id, wtOrigin, "/progress.md");
      if (k < 20) {
        fs.renameSync(wt, wt + "-removed");
        fs.renameSync(admin, admin + "-removed");
      }
      if (k === 0) measured = { review: wtReview, rel: rel };
    }
    var mainSite = helper.sites.bind({ root: path.join(mainRepo, measured.rel), mode: "folder", entry: "progress.md" });

    async function measure(name, pagePath, review) {
      var host = name + ".lahe.localhost:" + helper.pagesPort;
      var wall = [];
      var cpu = [];
      var tagged = null;
      var records = null;
      for (var n = 0; n < loads; n += 1) {
        await sleep(gapMs);
        var cpu0 = process.cpuUsage();
        var t0 = process.hrtime.bigint();
        var page = await get(helper.pagesPort, host, pagePath);
        var read = await get(helper.port, "127.0.0.1:" + helper.port, protocol.route("records.read").path + "?review=" + review.id + "&page_path=" + encodeURIComponent(pagePath), {
          "x-lahe-client": "layer", "x-lahe-token": review.token, origin: "http://" + host
        });
        var t1 = process.hrtime.bigint();
        var used = process.cpuUsage(cpu0);
        wall.push(Number(t1 - t0) / 1e6);
        cpu.push((used.user + used.system) / 1000);
        tagged = /data-lahe-review="([^"]+)"/.exec(page.text);
        try { records = JSON.parse(read.text).records; } catch (err) { records = null; }
      }
      return {
        carries_review: !!tagged && tagged[1] === review.id,
        records_shown: Array.isArray(records) ? records.length : null,
        wall_ms_median: Number(median(wall).toFixed(2)),
        wall_ms_p90: Number(p90(wall).toFixed(2)),
        cpu_ms_median: Number(median(cpu).toFixed(2)),
        cpu_ms_p90: Number(p90(cpu).toFixed(2))
      };
    }

    var out = {
      tree: tree,
      reviews: 700,
      worktree_sites: 30,
      removed_worktrees: 20,
      loads: loads,
      gap_ms: gapMs,
      ordinary: await measure(ordinary.name, ordinary.path, ordinary.review),
      moved: await measure(mainSite.name, "/progress.md", measured.review),
      state_folder: state
    };
    if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    else {
      Object.keys(out).forEach(function (key) {
        process.stdout.write(key + ": " + (typeof out[key] === "object" ? JSON.stringify(out[key]) : out[key]) + "\n");
      });
    }
  } finally {
    await helper.close();
  }
}

main().catch(function (err) {
  process.stderr.write((err && err.stack) || String(err));
  process.exit(1);
});
