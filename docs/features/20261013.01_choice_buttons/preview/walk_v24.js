#!/usr/bin/env node
// The whole loop, walked once (plan Task 4.4, verification row V24).
//
//   1. Serve a copy of the choice fixture through the PREVIEW helper (the
//      branch's own helper on its own port, against the copied state folder).
//   2. Open it in Chromium with the layer live. Press one answer.
//   3. The button paints pressed and the group paints kept, then open once the
//      hold (3 s) has passed and the helper has stored it.
//   4. Drain with the real `lahe status`: one choice item, group and answer at
//      the top level, only path, quote and heading under page.
//   5. Reply handled with the real `lahe reply`, and write data-chosen onto the
//      chosen button in the source, as the agent is told to.
//   6. The page re-renders (the helper watches the file) and the group paints
//      done; the record is handled on the drain (nothing listed).
//   7. Render the source with no script tag at all and open that HTML: the
//      chosen button's computed background is the ink color and the others are
//      not. That is the decision kept in the file, with no Lahe running.
//
// Usage, from the feature worktree:
//   node docs/features/20261013.01_choice_buttons/preview/walk_v24.js --port 7819 --state-dir ~/Documents/lahe-choice-preview/state --pages-port 1484
//
// It writes only inside the --work folder it makes under the preview folder,
// stops the browser it starts, and deletes nothing. Exit 0 is a pass; every
// step prints what it saw.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..", "..", "..", "..");
const BIN = path.join(root, "bin", "lahe.js");
const markdown = require(path.join(root, "src/service/markdown.js"));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const PORT = arg("--port", "7819");
const STATE = arg("--state-dir", path.join(os.homedir(), "Documents/lahe-choice-preview/state"));
const PAGES_PORT = arg("--pages-port", "1484");
const WORK = arg("--work", path.join(os.homedir(), "Documents/lahe-choice-preview/walk-" + Date.now()));

function lahe(args) {
  return execFileSync(process.execPath, [BIN].concat(args, ["--port", PORT, "--state-dir", STATE]), {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { LAHE_PAGES_PORT: PAGES_PORT })
  });
}
function step(n, text) { console.log("[" + n + "] " + text); }
function fail(text) { console.error("FAIL: " + text); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const src = path.join(WORK, "choice-doc.md");
  fs.copyFileSync(path.join(root, "test/fixtures/choice-doc.md"), src);

  // 1. serve
  const served = lahe(["review", src]);
  const open = /open\s+(http\S+)/.exec(served);
  const session = /session\s+(s_[a-f0-9]+)/.exec(served);
  const review = /review\s+(r[a-f0-9]+)/.exec(served);
  if (!open || !session || !review) fail("lahe review did not print open, session and review:\n" + served);
  // The address prints without the pages port when port 80 is forwarded; add ours.
  let url = open[1];
  if (!/:\d+\//.test(url)) url = url.replace(".lahe.localhost/", ".lahe.localhost:" + PAGES_PORT + "/");
  step(1, "served " + url + " on session " + session[1] + ", review " + review[1]);

  // 2. open and press
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".choice:not([data-lahe-inert]) > button").length >= 2, null, { timeout: 15000 });
    const armed = await page.evaluate(() => document.querySelectorAll(".choice:not([data-lahe-inert])").length);
    const inert = await page.evaluate(() => document.querySelectorAll(".choice[data-lahe-inert]").length);
    const hasDoc = await page.evaluate(() => !!document.querySelector("script[data-lahe-document]"));
    step(2, armed + " groups armed, " + inert + " inert, tag carries data-lahe-document: " + hasDoc);
    if (!hasDoc || armed < 3) fail("expected a document page with at least three armed groups");

    const GROUP = "lesson-css-counter";
    await page.click('.choice[data-choice="' + GROUP + '"] > button[value="promote"]');
    await page.waitForFunction((g) => {
      const el = document.querySelector('.choice[data-choice="' + g + '"]');
      return el && el.getAttribute("data-lahe-choice-state") && el.querySelector('button[value="promote"][data-lahe-pressed]');
    }, GROUP, { timeout: 5000 });
    const kept = await page.getAttribute('.choice[data-choice="' + GROUP + '"]', "data-lahe-choice-state");
    step(3, "pressed; group state right after the click: " + kept);

    // 3. the hold passes and the helper stores it
    await page.waitForFunction((g) => document.querySelector('.choice[data-choice="' + g + '"]').getAttribute("data-lahe-choice-state") === "open", GROUP, { timeout: 20000 });
    step(3, "group state is open (stored) within 20 s");

    // 4. drain
    const drain = lahe(["status", "--session", session[1], "--json", "--quiet"]).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const items = drain.filter((d) => d.kind === "choice");
    if (items.length !== 1) fail("expected one choice item on the drain, got " + items.length + ":\n" + JSON.stringify(drain, null, 1));
    const item = items[0];
    const pageKeys = Object.keys(item.page || {}).sort().join(",");
    step(4, "drain: choice " + JSON.stringify(item.choice) + "; page keys: " + pageKeys);
    if (item.choice.group !== GROUP || item.choice.answer !== "promote") fail("wrong choice on the drain");
    if (pageKeys !== "context,path,quote") fail("page carries more than path, quote and context: " + pageKeys);
    if (Object.keys(item.page.context).sort().join(",") !== "heading") fail("context carries more than heading");

    // 5. reply handled and write the decision into the source
    let text = fs.readFileSync(src, "utf8");
    const before = text;
    text = text.replace(
      '<div class="choice" data-choice="' + GROUP + '">\n  <p class="choice-q">Promote this lesson?</p>\n  <button type="button" value="promote" data-recommended>Promote</button>',
      '<div class="choice" data-choice="' + GROUP + '">\n  <p class="choice-q">Promote this lesson?</p>\n  <button type="button" value="promote" data-recommended data-chosen>Promote</button>'
    );
    if (text === before) fail("could not write data-chosen into the source copy");
    fs.writeFileSync(src, text);
    lahe(["reply", "--review", review[1], "--item", item.id, "--rev", String(item.rev), "--status", "handled", "--agent", "walk", "--file", src, "--text", "Promoted; data-chosen written onto the button."]);
    step(5, "replied handled and wrote data-chosen onto the promote button in the source");

    // 6. the page re-renders and the group paints done; the drain is empty
    await page.waitForFunction((g) => {
      const el = document.querySelector('.choice[data-choice="' + g + '"]');
      return el && el.getAttribute("data-lahe-choice-state") === "done" && el.querySelector("button[data-chosen]");
    }, GROUP, { timeout: 30000 });
    const after = lahe(["status", "--session", session[1], "--json", "--quiet"]).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((d) => d.kind === "choice");
    step(6, "page re-rendered with data-chosen and the group paints done; choice items left on the drain: " + after.length);
    if (after.length !== 0) fail("the handled press is still on the drain");

    // 7. no Lahe at all: render the source and check the chosen button's look
    const rendered = markdown.renderPage(src, { assetPrefix: "" }).html;
    if (!/data-chosen/.test(rendered)) fail("the rendered page lost data-chosen");
    if (/data-lahe-review/.test(rendered)) fail("the bare render carries a script tag");
    const bare = path.join(WORK, "bare.html");
    fs.writeFileSync(bare, rendered);
    const plain = await browser.newPage();
    await plain.goto("file://" + bare);
    const looks = await plain.evaluate((g) => {
      const btns = Array.from(document.querySelectorAll('.choice[data-choice="' + g + '"] > button'));
      return btns.map((b) => ({ value: b.value, chosen: b.hasAttribute("data-chosen"), bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color }));
    }, GROUP);
    const word = await plain.evaluate((g) => getComputedStyle(document.querySelector('.choice[data-choice="' + g + '"]'), "::after").content, GROUP);
    step(7, "bare render: " + JSON.stringify(looks) + "; group word: " + word);
    const chosen = looks.find((l) => l.chosen);
    const others = looks.filter((l) => !l.chosen);
    if (!chosen || others.some((o) => o.bg === chosen.bg)) fail("the chosen button does not look different from the others with no Lahe running");
    if (!/Done/.test(word)) fail("the group does not read Done with no Lahe running");
    console.log("PASS: the whole loop holds. Work folder: " + WORK);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
