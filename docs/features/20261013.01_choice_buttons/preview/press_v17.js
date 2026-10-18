#!/usr/bin/env node
// V17: the rebuilt lesson queue, served by the branch's own helper, takes a press.
//
// Opens the served queue in Chromium with the layer live, presses the
// recommended answer on the first group, waits for the group to read open
// (stored), drains that helper's session with the real `lahe status`, and
// saves a screenshot of the page beside the drain line. Pass: the drain lists
// exactly one choice item naming that group, and the page shows the press.
//
// Usage, from the feature worktree:
//   node docs/features/20261013.01_choice_buttons/preview/press_v17.js --url <open url> --session <s_...> --state-dir <copy> --out <folder>

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..", "..", "..", "..");
const BIN = path.join(root, "bin", "lahe.js");
function arg(name) { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; }
const URL = arg("--url"), SESSION = arg("--session"), STATE = arg("--state-dir"), OUT = arg("--out") || path.join(__dirname, "..", "progress");
if (!URL || !SESSION || !STATE) { console.error("need --url, --session, --state-dir"); process.exit(2); }

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".choice:not([data-lahe-inert]) > button").length >= 2, null, { timeout: 15000 });
    const groups = await page.evaluate(() => Array.from(document.querySelectorAll(".choice")).map((g) => ({ name: g.getAttribute("data-choice"), inert: g.hasAttribute("data-lahe-inert") })));
    console.log("groups on the page: " + groups.length + ", inert: " + groups.filter((g) => g.inert).length);
    const first = groups[0].name;
    await page.click('.choice[data-choice="' + first + '"] > button[data-recommended]');
    await page.waitForFunction((g) => document.querySelector('.choice[data-choice="' + g + '"]').getAttribute("data-lahe-choice-state") === "open", first, { timeout: 20000 });
    const pressed = await page.evaluate((g) => document.querySelector('.choice[data-choice="' + g + '"] > button[data-lahe-pressed]').value, first);
    console.log("pressed " + pressed + " on " + first + "; the group reads open");
    fs.mkdirSync(OUT, { recursive: true });
    const shot = path.join(OUT, "v17_lesson_queue_light.png");
    await page.screenshot({ path: shot, fullPage: false });
    const drain = execFileSync(process.execPath, [BIN, "status", "--session", SESSION, "--json", "--quiet", "--state-dir", STATE], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((d) => d.kind === "choice");
    console.log("choice items on the drain: " + drain.length);
    drain.forEach((d) => console.log("  " + JSON.stringify({ id: d.id, choice: d.choice, heading: d.page && d.page.context && d.page.context.heading })));
    if (drain.length !== 1 || drain[0].choice.group !== first) { console.error("FAIL: the drain does not show exactly this press"); process.exit(1); }
    console.log("PASS. Screenshot: " + shot);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
